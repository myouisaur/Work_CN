// ==UserScript==
// @name         [Multi-Site] Sales Extractor
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRDA0MTBDIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDJ2MjBtLTctN2w3IDcgNy03Ii8+PC9zdmc+
// @version      6.6
// @description  Extracts ticket sales and revenue data from supported event dashboards.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @match        *://*.posh.vip/*
// @match        *://*.ra.co/pro/events/*/tickets/management
// @match        *://*.eventim.us/*
// @match        *://*.boletosexpress.com/*
// @match        *://*.tickeri.com/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Work_CN/ZZZ_sales-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/ZZZ_sales-extractor.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window !== window.top) return;
    if (window.__uese_initialized) return;
    window.__uese_initialized = true;

    // ============================================================================
    // 1. CONFIGURATION & STATE
    // ============================================================================

    const CONFIG = {
        DEBUG: false,
        DEBOUNCE_MS: 200,
        POLL_BASE_DELAY_MS: 1000,
        POLL_MAX_ATTEMPTS: 15,
        POLL_MULTIPLIER: 1.5,
        UI_Z_INDEX: 2147483647,
        DEFAULTS: {
            TICKETS: '0',
            REVENUE: '$0',
            TEXT_SOLD: 'Tickets Sold',
            TEXT_NET: 'Net Sales',
            TEXT_CHECK_FREE: 'check free tix'
        }
    };

    const State = {
        currentUrl: window.location.href,
        activeModule: null,
        hasFetchedData: false,
        pollCount: 0,
        pollTimer: null,
        scanTimer: null,
        themeConfig: null,
        observedRoot: document.body
    };

    // ============================================================================
    // 2. UTILITIES & STORAGE
    // ============================================================================

    const Logger = {
        log: (mod, msg, ...args) => CONFIG.DEBUG && console.log(`[EventSalesExtractor][${mod}] 🔵 ${msg}`, ...args),
        warn: (mod, msg, ...args) => CONFIG.DEBUG && console.warn(`[EventSalesExtractor][${mod}] 🟠 ${msg}`, ...args),
        error: (mod, msg, ...args) => console.error(`[EventSalesExtractor][${mod}] 🔴 ${msg}`, ...args),
    };

    const Storage = {
        get(key, def) {
            try {
                return typeof GM_getValue !== 'undefined' ?
                    GM_getValue(key, def) : (JSON.parse(localStorage.getItem(key)) ?? def);
            } catch { return def; }
        },
        set(key, val) {
            try {
                typeof GM_setValue !== 'undefined' ?
                    GM_setValue(key, val) : localStorage.setItem(key, JSON.stringify(val));
            } catch { /* Ignore gracefully */ }
        },
        getPosition() {
            return { x: this.get('uese_pos_x', null), y: this.get('uese_pos_y', null) };
        },
        setPosition(x, y) {
            this.set('uese_pos_x', x);
            this.set('uese_pos_y', y);
        },
        resetPosition() {
            this.set('uese_pos_x', null);
            this.set('uese_pos_y', null);
        }
    };

    const Utils = {
        parseNum: (str) => {
            if (!str) return 0;
            return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
        },
        hexToRgb: (hex) => {
            let r = 0, g = 0, b = 0;
            if (hex.length === 4) {
                r = parseInt(hex[1] + hex[1], 16);
                g = parseInt(hex[2] + hex[2], 16);
                b = parseInt(hex[3] + hex[3], 16);
            } else if (hex.length === 7) {
                r = parseInt(hex[1] + hex[2], 16);
                g = parseInt(hex[3] + hex[4], 16);
                b = parseInt(hex[5] + hex[6], 16);
            }
            return `${r}, ${g}, ${b}`;
        },
        createSvgIcon: (pathData, color = "currentColor", viewBox = "0 0 24 24") => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', viewBox);
            svg.setAttribute('width', '18');
            svg.setAttribute('height', '18');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', color);
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.style.transition = 'stroke 0.2s ease';

            const paths = pathData.split('|');
            paths.forEach(d => {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', d);
                svg.appendChild(path);
            });
            return svg;
        },
        el: (tag, className = '', text = '') => {
            const element = document.createElement(tag);
            if (className) element.className = className;
            if (text) element.textContent = text;
            return element;
        }
    };

    // ============================================================================
    // 3. SITE MODULES (Extraction Logic & Theme)
    // ============================================================================

    const siteModules = [
        {
            name: 'Eventbrite',
            domain: 'eventbrite.com',
            rootSelector: '#root, main',
            theme: { accent: '#D0410C', accentSec: '#D0410C' },
            check: () => {
                try {
                    const exactMatch = document.evaluate(`//*[not(*) and normalize-space(text())='${CONFIG.DEFAULTS.TEXT_SOLD}']`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    const legacyMatch = document.querySelector('[data-testid="amount-card-title"]');
                    return !!exactMatch || (legacyMatch && legacyMatch.innerText.trim() === CONFIG.DEFAULTS.TEXT_SOLD);
                } catch (e) { return false; }
            },
            extract: () => {
                let ticketsSold = '', netSales = '', freeTickets = undefined;
                const findCard = (targetText) => {
                    const targetNode = document.evaluate(`//*[not(*) and normalize-space(text())='${targetText}']`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (!targetNode) return null;
                    let parent = targetNode.parentElement;
                    for (let i = 0; i < 5; i++) {
                        if (parent && /\d/.test(parent.textContent)) return parent;
                        parent = parent?.parentElement;
                    }
                    return null;
                };

                const tixCard = findCard(CONFIG.DEFAULTS.TEXT_SOLD);
                if (tixCard) {
                    const tixMatch = tixCard.innerText.match(/(\d+)\s*\/\s*\d+/);
                    if (tixMatch) ticketsSold = tixMatch[1];
                    const freeMatch = tixCard.innerText.match(/(\d+)\s*free/i);
                    if (freeMatch) freeTickets = freeMatch[1];
                }

                const salesCard = findCard(CONFIG.DEFAULTS.TEXT_NET);
                if (salesCard) {
                    const moneyMatch = salesCard.innerText.match(/[$£€]\s*[\d,.]+/);
                    if (moneyMatch) netSales = moneyMatch[0];
                }

                if (!ticketsSold || !netSales) {
                    document.querySelectorAll('[data-testid="amount-card-title"]').forEach(titleElem => {
                        const titleText = titleElem.innerText.trim();
                        let card = titleElem.closest('div[class*="AmountCard"]')?.parentElement || titleElem.parentElement?.parentElement;
                        if (!card) return;
                        const valueElem = card.querySelector('[data-testid="amount-card-value"] p') || card.querySelector('span');
                        const rawText = valueElem ? valueElem.innerText.trim() : '';

                        if (titleText === CONFIG.DEFAULTS.TEXT_SOLD && !ticketsSold) {
                            ticketsSold = rawText.split('/')[0].trim();
                            const freeMatch = card.innerText.match(/(\d+)\s*free/i);
                            if (freeMatch) freeTickets = freeMatch[1];
                        }
                        if (titleText === CONFIG.DEFAULTS.TEXT_NET && !netSales) netSales = rawText;
                    });
                }

                if (!netSales) netSales = CONFIG.DEFAULTS.REVENUE;
                if (!ticketsSold) throw new Error("Metrics not found yet.");
                return { tickets: ticketsSold, revenue: netSales, freeTickets };
            }
        },
        {
            name: 'Posh',
            domain: 'posh.vip',
            rootSelector: '#__next, #root',
            theme: { accent: '#FFFFFF', accentSec: '#FFFFFF' },
            check: () => !!document.querySelector('div.CrossSection__w3a2U'),
            extract: () => {
                let ticketsSold = '', totalRevenue = CONFIG.DEFAULTS.REVENUE;
                document.querySelectorAll('div.CrossSection__w3a2U').forEach(div => {
                    const label = div.querySelector('p')?.innerText.trim();
                    if (label === "Total Tickets Sold" || label === "Total RSVPs") ticketsSold = div.querySelector('h3')?.innerText.trim();
                    if (label === "Total Revenue" || label === "Revenue") totalRevenue = div.querySelector('h3')?.innerText.trim();
                });
                if (!ticketsSold && totalRevenue === CONFIG.DEFAULTS.REVENUE) throw new Error("Data missing.");
                return { tickets: ticketsSold, revenue: totalRevenue };
            }
        },
        {
            name: 'Resident Advisor',
            domain: 'ra.co',
            rootSelector: '#__next',
            theme: { accent: '#FF4848', accentSec: '#FF4848' },
            check: () => !!document.querySelector('span[color="primary"]'),
            extract: () => {
                let tickets = CONFIG.DEFAULTS.TICKETS, revenue = CONFIG.DEFAULTS.REVENUE;
                document.querySelectorAll('span[color="primary"]').forEach(span => {
                    const text = span.innerText.trim();
                    const sibling = span.nextElementSibling;
                    if (sibling && sibling.innerText.includes('/')) {
                        if (/[$£€]/.test(text)) revenue = text;
                        else tickets = text;
                    }
                });
                return { tickets, revenue };
            }
        },
        {
            name: 'Seetickets / Eventim',
            domain: 'eventim.us',
            rootSelector: 'body',
            theme: { accent: '#0C9A9A', accentSec: '#0C9A9A' },
            check: () => !!document.querySelector('#table table'),
            extract: () => {
                const dataRow = document.querySelectorAll('#table table tr')[1];
                if (!dataRow) throw new Error("Data row missing.");
                const cells = dataRow.querySelectorAll('td');
                return {
                    tickets: cells[0]?.innerText.trim() || CONFIG.DEFAULTS.TICKETS,
                    revenue: cells[cells.length - 1]?.innerText.trim() || CONFIG.DEFAULTS.REVENUE
                };
            }
        },
        {
            name: 'Boletos Express',
            domain: 'boletosexpress.com',
            rootSelector: 'body',
            theme: { accent: '#1C2A7C', accentSec: '#1C2A7C' },
            check: () => !!document.querySelector('#audit'),
            extract: () => {
                let tickets = CONFIG.DEFAULTS.TICKETS;
                document.querySelectorAll('#audit dl').forEach(dl => {
                    if (dl.querySelector('dt')?.innerText.includes('Tickets Distributed')) {
                        tickets = dl.querySelector('dd b')?.innerText.trim() || CONFIG.DEFAULTS.TICKETS;
                    }
                });
                const revElem = document.querySelector('#revenue_total b');
                return { tickets, revenue: revElem ? revElem.innerText.trim() : CONFIG.DEFAULTS.REVENUE };
            }
        },
        {
            name: 'Tickeri',
            domain: 'tickeri.com',
            rootSelector: 'body',
            theme: { accent: '#EB0045', accentSec: '#EB0045' },
            check: () => document.body.innerText.includes('Ticket Inventory'),
            extract: () => {
                let tickets = CONFIG.DEFAULTS.TICKETS, revenue = CONFIG.DEFAULTS.REVENUE;
                const spans = Array.from(document.querySelectorAll('span'));
                const tLabel = spans.find(s => s.innerText.includes('Ticket Inventory'));
                if (tLabel?.nextElementSibling) tickets = tLabel.nextElementSibling.innerText.trim().split('/')[0].trim();
                const rLabel = spans.find(s => s.innerText.includes('Total revenue'));
                if (rLabel?.nextElementSibling) revenue = rLabel.nextElementSibling.innerText.trim();
                return { tickets, revenue };
            }
        }
    ];

    // ============================================================================
    // 4. UI & PRESENTATION (Glassmorphism & Responsive)
    // ============================================================================

    const UI = {
        els: {},
        isDragging: false,
        rafTicking: false,

        init() {
            this.injectStyles();
            this.buildWidget();
            this.buildToast();
        },

        injectStyles() {
            GM_addStyle(`
                :root {
                    --uese-text-rgb: 245, 245, 245;
                    --uese-accent: #D0410C;
                    --uese-accent-rgb: 208, 65, 12;

                    /* User-requested exact hex values converted to RGB */
                    --status-rgb-scan: 30, 41, 59;       /* Dark Slate (default) */
                    --status-rgb-green: 35, 134, 54;
                    --status-rgb-yellow: 249, 147, 56;
                    --status-rgb-red: 220, 0, 27;

                    /* Dynamic property for both background and indicator circle */
                    --uese-current-bg-rgb: var(--status-rgb-scan);
                }

                /* Apply dynamic status colors to the widget */
                .uese-widget.status-scanning { --uese-current-bg-rgb: var(--status-rgb-scan); }
                .uese-widget.status-green    { --uese-current-bg-rgb: var(--status-rgb-green); }
                .uese-widget.status-yellow   { --uese-current-bg-rgb: var(--status-rgb-yellow); }
                .uese-widget.status-red      { --uese-current-bg-rgb: var(--status-rgb-red); }

                .uese-glass {
                    background: rgba(var(--uese-current-bg-rgb), 0.85);
                    backdrop-filter: blur(24px);
                    -webkit-backdrop-filter: blur(24px);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4), 0 0 10px 1px rgba(0, 0, 0, 0.2);
                    color: rgb(var(--uese-text-rgb));
                    transition: background 0.4s ease, box-shadow 0.4s ease, opacity 0.3s ease, transform 0.3s ease;
                }
                .uese-widget {
                    position: fixed;
                    top: clamp(10px, 2vh, 40px);
                    left: 50%;
                    z-index: ${CONFIG.UI_Z_INDEX};
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    padding: 0.4rem;
                    border-radius: 14px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    opacity: 0;
                    pointer-events: none;
                    transform: translateX(-50%) translateY(-10px);
                }
                .uese-widget.uese-visible {
                    opacity: 1;
                    pointer-events: auto;
                    transform: translateX(-50%) translateY(0);
                }
                .uese-widget.uese-dragged {
                    transform: none;
                }
                .uese-drag-handle {
                    cursor: grab;
                    padding: 0.5rem 0.25rem;
                    display: flex;
                    align-items: center;
                    opacity: 0.7;
                    color: white;
                    transition: all 0.2s;
                    border-radius: 6px;
                }
                .uese-drag-handle:hover, .uese-drag-handle:focus-visible {
                    opacity: 1;
                    background: rgba(255, 255, 255, 0.08);
                    outline: 1px solid rgba(255, 255, 255, 0.15);
                    outline-offset: 2px;
                }
                .uese-drag-handle:active { cursor: grabbing; }

                .uese-btn {
                    background: rgba(255, 255, 255, 0.06);
                    color: rgb(var(--uese-text-rgb));
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    padding: 0.6rem 1rem;
                    border-radius: 10px;
                    font-weight: 600;
                    font-size: clamp(13px, 1.5vw, 14px);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.6rem;
                    transition: all 0.2s ease;
                    min-height: 40px;
                    position: relative;
                }
                .uese-btn:hover, .uese-btn:focus-visible {
                    background: rgba(255, 255, 255, 0.12);
                    border-color: rgba(255, 255, 255, 0.2);
                    color: #ffffff;
                    outline: none;
                }
                .uese-btn:hover svg, .uese-btn:focus-visible svg {
                    stroke: #ffffff;
                }
                .uese-btn:active {
                    transform: scale(0.96);
                }
                .uese-btn.uese-icon-only {
                    padding: 0.6rem;
                }

                @keyframes uese-spin {
                    100% { transform: rotate(360deg); }
                }
                .uese-spin svg {
                    animation: uese-spin 1s linear infinite;
                }

                /* Pill background provides subtle separation for the circle */
                .uese-status-pill {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    background: rgba(0, 0, 0, 0.25);
                    padding: 0.25rem 0.6rem;
                    border-radius: 8px;
                    border: 1px solid rgba(0, 0, 0, 0.15);
                }
                .uese-status-text {
                    color: #ffffff;
                    transition: color 0.3s ease;
                }

                /* The indicator now ALWAYS matches the current status color */
                .uese-indicator {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background-color: rgb(var(--uese-current-bg-rgb));
                    box-shadow: 0 0 6px rgb(var(--uese-current-bg-rgb)), inset 0 0 2px rgba(0,0,0,0.5);
                    border: 1px solid rgba(255, 255, 255, 0.4);
                    transition: all 0.3s ease;
                    flex-shrink: 0;
                }
                .uese-indicator.scanning {
                    animation: uese-pulse-status 1.5s infinite;
                }
                @keyframes uese-pulse-status {
                    0%, 100% { opacity: 0.6; box-shadow: 0 0 4px rgb(var(--uese-current-bg-rgb)); transform: scale(1); }
                    50% { opacity: 1; box-shadow: 0 0 10px rgb(var(--uese-current-bg-rgb)); transform: scale(1.1); }
                }

                .uese-tooltip {
                    position: absolute;
                    top: calc(100% + 10px);
                    left: 50%;
                    transform: translateX(-50%);
                    background: #ffffff;
                    color: #000000;
                    padding: 6px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    white-space: nowrap;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease, transform 0.2s ease;
                    border: 1px solid rgba(0, 0, 0, 0.1);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    z-index: 10;
                }
                .uese-tooltip.uese-flip {
                    top: auto;
                    bottom: calc(100% + 10px);
                }
                .uese-btn:hover .uese-tooltip, .uese-btn:focus-visible .uese-tooltip {
                    opacity: 1;
                }

                .uese-toast {
                    position: fixed;
                    bottom: clamp(10px, 4vh, 24px);
                    left: 50%;
                    transform: translateX(-50%) translateY(20px);
                    padding: 0.75rem 1.5rem;
                    border-radius: 10px;
                    font-family: sans-serif;
                    font-size: clamp(13px, 1.5vw, 14px);
                    font-weight: 500;
                    z-index: ${CONFIG.UI_Z_INDEX + 1};
                    opacity: 0;
                    pointer-events: none;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    background: rgba(20, 20, 20, 0.95);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    color: #fff;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                .uese-toast.uese-show {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            `);
        },

        buildWidget() {
            // Start with the scanning status as default
            this.els.wrapper = Utils.el('div', 'uese-widget uese-glass status-scanning');

            this.els.dragHandle = Utils.el('div', 'uese-drag-handle');
            this.els.dragHandle.title = 'Drag to move (Double-Click to Reset)';
            this.els.dragHandle.setAttribute('tabindex', '0');
            this.els.dragHandle.setAttribute('aria-label', 'Move Extractor Widget');
            this.els.dragHandle.appendChild(Utils.createSvgIcon("M9 5h2v2H9V5zm0 6h2v2H9v-2zm0 6h2v2H9v-2zm4-12h2v2h-2V5zm0 6h2v2h-2v-2zm0 6h2v2h-2v-2z"));

            this.els.copyBtn = Utils.el('button', 'uese-btn');
            this.els.copyBtn.setAttribute('aria-label', 'Copy Extracted Data');

            this.els.statusPill = Utils.el('div', 'uese-status-pill');

            // 1. Indicator
            this.els.indicator = Utils.el('div', 'uese-indicator scanning');
            this.els.statusPill.appendChild(this.els.indicator);

            // 2. Status Text
            this.els.statusText = Utils.el('span', 'uese-status-text', 'Scanning...');
            this.els.statusPill.appendChild(this.els.statusText);

            this.els.copyBtn.appendChild(this.els.statusPill);

            // 3. Copy Icon
            this.els.copyIcon = Utils.createSvgIcon("M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3");
            this.els.copyBtn.appendChild(this.els.copyIcon);

            this.els.tooltip = Utils.el('span', 'uese-tooltip', 'Shift+Click for JSON');
            this.els.copyBtn.appendChild(this.els.tooltip);

            this.els.refreshBtn = Utils.el('button', 'uese-btn uese-icon-only');
            this.els.refreshBtn.title = 'Force Re-scan';
            this.els.refreshBtn.setAttribute('aria-label', 'Force Re-scan');
            this.els.refreshBtn.appendChild(Utils.createSvgIcon("M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"));

            this.els.wrapper.append(this.els.dragHandle, this.els.copyBtn, this.els.refreshBtn);
            document.body.appendChild(this.els.wrapper);

            this.loadSafePosition();

            this.els.copyBtn.addEventListener('click', (e) => Extractor.executeCopy(e.shiftKey));
            this.els.refreshBtn.addEventListener('click', () => App.resetAndScan(true));
            this.els.dragHandle.addEventListener('dblclick', () => this.resetPosition());
            this.els.copyBtn.addEventListener('mouseenter', (e) => {
                const rect = e.target.getBoundingClientRect();
                if (window.innerHeight - rect.bottom < 60) {
                    this.els.tooltip.classList.add('uese-flip');
                } else {
                    this.els.tooltip.classList.remove('uese-flip');
                }
            });

            this.initDraggable(this.els.wrapper, this.els.dragHandle);
        },

        ensureInDOM() {
            if (!this.els.wrapper) return;
            if (!document.body.contains(this.els.wrapper)) document.body.appendChild(this.els.wrapper);
            if (!document.body.contains(this.els.toast)) document.body.appendChild(this.els.toast);
        },

        applyTheme(themeObj) {
            if (!themeObj) return;
            const root = document.documentElement;
            root.style.setProperty('--uese-accent', themeObj.accent);
            root.style.setProperty('--uese-accent-rgb', Utils.hexToRgb(themeObj.accent));
        },

        loadSafePosition() {
            const pos = Storage.getPosition();
            if (pos.x !== null && pos.y !== null) {
                const safeX = Math.max(0, Math.min(pos.x, window.innerWidth - 300));
                const safeY = Math.max(0, Math.min(pos.y, window.innerHeight - 60));
                this.els.wrapper.style.left = `${safeX}px`;
                this.els.wrapper.style.top = `${safeY}px`;
                this.els.wrapper.classList.add('uese-dragged');
            }
        },

        resetPosition() {
            this.els.wrapper.classList.remove('uese-dragged');
            this.els.wrapper.style.left = '50%';
            this.els.wrapper.style.top = 'clamp(10px, 2vh, 40px)';
            Storage.resetPosition();
            this.showToast("Position Reset", "success");
        },

        initDraggable(el, handle) {
            let startX, startY, initialX, initialY;

            const onMouseMove = (e) => {
                if (!this.isDragging) return;
                if (!this.rafTicking) {
                    window.requestAnimationFrame(() => {
                        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
                        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

                        let newX = initialX + (clientX - startX);
                        let newY = initialY + (clientY - startY);

                        newX = Math.max(0, Math.min(newX, window.innerWidth - el.offsetWidth));
                        newY = Math.max(0, Math.min(newY, window.innerHeight - el.offsetHeight));

                        el.style.left = `${newX}px`;
                        el.style.top = `${newY}px`;

                        this.rafTicking = false;
                    });
                    this.rafTicking = true;
                }
            };

            const onMouseUp = () => {
                if (!this.isDragging) return;
                this.isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.removeEventListener('touchmove', onMouseMove);
                document.removeEventListener('touchend', onMouseUp);
                el.style.transition = 'background 0.4s ease, box-shadow 0.4s ease, opacity 0.3s ease, transform 0.3s ease';
                Storage.setPosition(parseInt(el.style.left, 10), parseInt(el.style.top, 10));
            };

            const onMouseDown = (e) => {
                this.isDragging = true;
                el.style.transition = 'background 0.4s ease, box-shadow 0.4s ease'; // keep bg transitions, strip transform

                if (!el.classList.contains('uese-dragged')) {
                    const rect = el.getBoundingClientRect();
                    el.style.left = `${rect.left}px`;
                    el.style.top = `${rect.top}px`;
                    el.classList.add('uese-dragged');
                }

                const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
                const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

                startX = clientX;
                startY = clientY;
                const rect = el.getBoundingClientRect();
                initialX = rect.left;
                initialY = rect.top;

                document.addEventListener('mousemove', onMouseMove, { passive: true });
                document.addEventListener('mouseup', onMouseUp);
                document.addEventListener('touchmove', onMouseMove, { passive: true });
                document.addEventListener('touchend', onMouseUp);

                if (e.type === 'mousedown') e.preventDefault();
            };

            handle.addEventListener('mousedown', onMouseDown);
            handle.addEventListener('touchstart', onMouseDown, { passive: true });

            handle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.resetPosition();
                }
            });
        },

        buildToast() {
            this.els.toast = Utils.el('div', 'uese-toast');
            document.body.appendChild(this.els.toast);
        },

        updateVisibility(visible) {
            this.ensureInDOM();
            if (visible) {
                this.els.wrapper.classList.add('uese-visible');
                if (State.themeConfig) this.applyTheme(State.themeConfig);
            } else {
                this.els.wrapper.classList.remove('uese-visible');
            }
        },

        updateStatus(state, tickets = 0, revenue = 0) {
            this.ensureInDOM();

            // Clean up previous status classes on the widget background
            this.els.wrapper.classList.remove('status-scanning', 'status-green', 'status-yellow', 'status-red');
            this.els.indicator.className = 'uese-indicator'; // Reset indicator classes

            if (state === 'scanning') {
                this.els.refreshBtn.classList.add('uese-spin');
                this.els.statusText.textContent = "Scanning...";
                this.els.wrapper.classList.add('status-scanning');
                this.els.indicator.classList.add('scanning'); // Re-adds pulse animation
            } else {
                this.els.refreshBtn.classList.remove('uese-spin');
                if (state === 'not_found') {
                    this.els.statusText.textContent = "Not Found";
                    this.els.wrapper.classList.add('status-red');
                } else if (state === 'found') {
                    const tVal = Utils.parseNum(tickets);
                    const rVal = Utils.parseNum(revenue);

                    let statusString = "";
                    if (tVal === 0 && rVal === 0) {
                        this.els.wrapper.classList.add('status-red');
                        statusString = "No sales";
                    } else if (tVal > 0 && rVal === 0) {
                        this.els.wrapper.classList.add('status-yellow');
                        statusString = "Free tickets";
                    } else {
                        this.els.wrapper.classList.add('status-green');
                        statusString = "With sales";
                    }

                    this.els.statusText.textContent = statusString;
                }
            }
        },

        showToast(message, type = 'success') {
            this.ensureInDOM();
            while (this.els.toast.firstChild) {
                this.els.toast.removeChild(this.els.toast.firstChild);
            }

            const iconColor = type === 'success' ? 'var(--uese-accent)' : '#ef4444';
            const iconPath = type === 'success'
                ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                : "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";

            this.els.toast.appendChild(Utils.createSvgIcon(iconPath, iconColor));

            const textSpan = Utils.el('span', '', message);
            this.els.toast.appendChild(textSpan);

            // Use the site's accent color for the border highlight of the toast
            this.els.toast.style.borderLeft = `4px solid ${iconColor}`;
            this.els.toast.classList.add('uese-show');

            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => this.els.toast.classList.remove('uese-show'), 3000);
        }
    };

    // ============================================================================
    // 5. EXTRACTOR (Data Logic)
    // ============================================================================

    const Extractor = {
        async executeCopy(asJson = false) {
            if (!State.activeModule) return;

            try {
                const data = State.activeModule.extract();
                const url = window.location.href;

                let fourthCol = '0';
                const tVal = Utils.parseNum(data.tickets);
                const rVal = Utils.parseNum(data.revenue);

                if (data.freeTickets !== undefined) fourthCol = data.freeTickets;
                else if (tVal > 0 && rVal === 0) fourthCol = data.tickets;
                else if (tVal > 0 && rVal > 0) fourthCol = CONFIG.DEFAULTS.TEXT_CHECK_FREE;

                const exportData = { url, tickets: data.tickets, revenue: data.revenue, fourthCol, timestamp: Date.now() };
                const rawString = `${url}\t${data.tickets}\t${data.revenue}\t${fourthCol}`;
                const output = asJson ? JSON.stringify(exportData, null, 2) : rawString;

                await this.performClipboardWrite(output);

                UI.showToast(`Copied! ${data.tickets} tix - ${data.revenue}`, 'success');
                UI.updateStatus('found', data.tickets, data.revenue);
            } catch (err) {
                Logger.error("Extractor", "Extraction failed", err);
                UI.showToast(err.message || "Failed to extract data.", 'error');
            }
        },

        async performClipboardWrite(text) {
            const activeElement = document.activeElement;
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    throw new Error("Clipboard API unavailable");
                }
            } catch (err) {
                Logger.warn("Extractor", "Falling back to execCommand");
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                const res = document.execCommand('copy');
                document.body.removeChild(ta);
                if (!res) throw new Error("Fallback clipboard failed");
            } finally {
                if (activeElement && typeof activeElement.focus === 'function') {
                    activeElement.focus();
                }
            }
        }
    };

    // ============================================================================
    // 6. OBSERVERS (Resource Management)
    // ============================================================================

    const Observer = {
        domObserver: null,

        start() {
            if (!this.domObserver) {
                this.domObserver = new MutationObserver(() => this.handleMutation());
            }
            this.updateObservationRoot();
            this.startPolling();
        },

        updateObservationRoot() {
            if (this.domObserver) this.domObserver.disconnect();
            let targetRoot = document.body;
            if (State.activeModule && State.activeModule.rootSelector) {
                const specificRoot = document.querySelector(State.activeModule.rootSelector);
                if (specificRoot) targetRoot = specificRoot;
            }

            State.observedRoot = targetRoot;
            this.domObserver.observe(State.observedRoot, { childList: true, subtree: true });
        },

        stop() {
            if (this.domObserver) {
                this.domObserver.disconnect();
            }
            this.stopPolling();
        },

        stopPolling() {
            clearTimeout(State.scanTimer);
            clearTimeout(State.pollTimer);
        },

        handleMutation() {
            if (State.activeModule) UI.ensureInDOM();
            if (State.hasFetchedData) return;

            clearTimeout(State.scanTimer);
            State.scanTimer = setTimeout(() => this.scanPage(), CONFIG.DEBOUNCE_MS);
        },

        startPolling() {
            State.pollCount = 0;
            UI.updateStatus('scanning');
            this.schedulePoll();
        },

        schedulePoll() {
            if (State.hasFetchedData) return;
            if (State.pollCount >= CONFIG.POLL_MAX_ATTEMPTS) {
                Logger.warn("Observer", "Poll limit reached. Data not found.");
                UI.updateStatus('not_found');
                this.stop();
                return;
            }

            State.pollCount++;
            const delay = Math.min(CONFIG.POLL_BASE_DELAY_MS * Math.pow(CONFIG.POLL_MULTIPLIER, State.pollCount), 10000);

            State.pollTimer = setTimeout(() => {
                if (!State.hasFetchedData) {
                    this.scanPage();
                    this.schedulePoll();
                }
            }, delay);
        },

        scanPage() {
            if (!State.activeModule) {
                State.activeModule = siteModules.find(mod => State.currentUrl.includes(mod.domain) && mod.check());
                if (State.activeModule) {
                    if (State.activeModule.theme) State.themeConfig = State.activeModule.theme;
                    this.updateObservationRoot(); // Re-bind observer to specific root if found
                }
            }

            UI.updateVisibility(!!State.activeModule);
            if (State.activeModule && !State.hasFetchedData) {
                try {
                    const data = State.activeModule.extract();
                    if (data.tickets !== '' || data.revenue !== '') {
                        UI.updateStatus('found', data.tickets, data.revenue);
                        State.hasFetchedData = true;
                        this.stop();
                    }
                } catch (e) {
                    // Silently wait for next mutation/poll
                }
            }
        }
    };

    // ============================================================================
    // 7. ROUTER (SPA Navigation Support)
    // ============================================================================

    const Router = {
        init() {
            const handleNav = () => {
                try {
                    const oldUrl = new URL(State.currentUrl);
                    const newUrl = new URL(window.location.href);

                    if (oldUrl.pathname !== newUrl.pathname) {
                        App.resetAndScan();
                    } else {
                        State.currentUrl = window.location.href;
                    }
                } catch (e) {
                    App.resetAndScan();
                }
            };

            const originalPush = history.pushState;
            history.pushState = function() {
                const res = originalPush.apply(this, arguments);
                handleNav();
                return res;
            };

            const originalReplace = history.replaceState;
            history.replaceState = function() {
                const res = originalReplace.apply(this, arguments);
                handleNav();
                return res;
            };

            window.addEventListener('popstate', handleNav);
        }
    };

    // ============================================================================
    // 8. APP BOOTSTRAP
    // ============================================================================

    const App = {
        init() {
            Logger.log("Bootstrap", `Initializing Version ${GM_info?.script?.version || '6.5'}`);
            UI.init();
            Router.init();
            Observer.start();
        },
        resetAndScan(force = false) {
            State.currentUrl = window.location.href;
            State.activeModule = null;
            State.hasFetchedData = false;
            if (force) UI.showToast("Re-scanning dashboard...", "success");

            Observer.stop();
            Observer.start();
            Observer.scanPage();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }

})();
