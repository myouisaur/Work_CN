// ==UserScript==
// @name         [Multi-Site] Sales Extractor
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRDA0MTBDIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDJ2MjBtLTctN2w3IDcgNy03Ii8+PC9zdmc+
// @version      7.7
// @description  Extracts and displays ticket sales and revenue metrics directly within event dashboards.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @match        *://*.posh.vip/*
// @match        *://*.ra.co/pro/events/*/tickets/management
// @match        *://*.eventim.us/*
// @match        *://*.boletosexpress.com/*
// @match        *://*.tickeri.com/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
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
        DEBOUNCE_MS: 300,
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
        cachedData: null,
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
                if (typeof GM_getValue !== 'undefined') return GM_getValue(key, def);
                const localVal = localStorage.getItem(key);
                if (localVal === null) return def;
                try { return JSON.parse(localVal); } catch { return def; }
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
            svg.setAttribute('width', '16');
            svg.setAttribute('height', '16');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', color);
            svg.setAttribute('stroke-width', '2.5');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.style.transition = 'stroke 0.2s ease';
            svg.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))';

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
        },
        getTextNode: (text, exact = false) => {
            const condition = exact
                ? `normalize-space(text())='${text}'`
                : `contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')`;
            return document.evaluate(`//*[not(self::script or self::style or self::noscript) and ${condition}]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        },
        findCardByText: (text, exact = false) => {
            const node = Utils.getTextNode(text, exact);
            if (!node) return null;
            let parent = node.parentElement;
            for (let i = 0; i < 5; i++) {
                if (parent && /\d/.test(parent.textContent)) return parent;
                parent = parent.parentElement;
            }
            return null;
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
            check: () => !!Utils.getTextNode(CONFIG.DEFAULTS.TEXT_SOLD, true),
            extract: () => {
                let ticketsSold = '', netSales = '', freeTickets = undefined;

                const tixCard = Utils.findCardByText(CONFIG.DEFAULTS.TEXT_SOLD, true);
                if (tixCard) {
                    const rawText = tixCard.textContent || '';
                    const tixMatch = rawText.match(/(\d+)\s*\/\s*\d+/);
                    if (tixMatch) ticketsSold = tixMatch[1];
                    const freeMatch = rawText.match(/(\d+)\s*free/i);
                    if (freeMatch) freeTickets = freeMatch[1];
                }

                const salesCard = Utils.findCardByText(CONFIG.DEFAULTS.TEXT_NET, true);
                if (salesCard) {
                    const moneyMatch = (salesCard.textContent || '').match(/[$£€]\s*[\d,.]+/);
                    if (moneyMatch) netSales = moneyMatch[0];
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
                    const label = div.querySelector('p')?.textContent?.trim();
                    if (label === "Total Tickets Sold" || label === "Total RSVPs") ticketsSold = div.querySelector('h3')?.textContent?.trim();
                    if (label === "Total Revenue" || label === "Revenue") totalRevenue = div.querySelector('h3')?.textContent?.trim();
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
            // Added strict URL path requirement to prevent widget ghosting on the /pro dashboard
            check: () => window.location.pathname.includes('/tickets/management') && !!document.querySelector('span[color="primary"]'),
            extract: () => {
                let tickets = CONFIG.DEFAULTS.TICKETS, revenue = CONFIG.DEFAULTS.REVENUE;

                document.querySelectorAll('span[color="primary"]').forEach(span => {
                    const text = span.textContent.trim();
                    const sibling = span.nextElementSibling;
                    if (sibling && sibling.textContent.includes('/')) {
                        if (/[$£€]/.test(text)) revenue = text;
                        else tickets = text;
                    }
                });

                if (tickets === CONFIG.DEFAULTS.TICKETS && revenue === CONFIG.DEFAULTS.REVENUE) {
                    throw new Error("Metrics not found yet.");
                }
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
                    tickets: cells[0]?.textContent?.trim() || CONFIG.DEFAULTS.TICKETS,
                    revenue: cells[cells.length - 1]?.textContent?.trim() || CONFIG.DEFAULTS.REVENUE
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
                    if (dl.querySelector('dt')?.textContent?.includes('Tickets Distributed')) {
                        tickets = dl.querySelector('dd b')?.textContent?.trim() || CONFIG.DEFAULTS.TICKETS;
                    }
                });
                const revElem = document.querySelector('#revenue_total b');
                return { tickets, revenue: revElem ? revElem.textContent.trim() : CONFIG.DEFAULTS.REVENUE };
            }
        },
        {
            name: 'Tickeri',
            domain: 'tickeri.com',
            rootSelector: 'body',
            theme: { accent: '#EB0045', accentSec: '#EB0045' },
            check: () => window.location.pathname.includes('/event/') && document.body.textContent.includes('Ticket Inventory'),
            extract: () => {
                let tickets = CONFIG.DEFAULTS.TICKETS, revenue = CONFIG.DEFAULTS.REVENUE;

                const elements = Array.from(document.querySelectorAll('span, div, p')).filter(el => el.children.length === 0);

                const tLabel = elements.find(s => s.textContent.includes('Ticket Inventory'));
                if (tLabel) {
                    if (tLabel.nextElementSibling) {
                        tickets = tLabel.nextElementSibling.textContent.trim().split('/')[0].trim();
                    } else if (tLabel.parentElement) {
                        const match = tLabel.parentElement.textContent.replace(tLabel.textContent, '').match(/(\d+)/);
                        if (match) tickets = match[1];
                    }
                }

                const rLabel = elements.find(s => s.textContent.includes('Total revenue'));
                if (rLabel) {
                    if (rLabel.nextElementSibling) {
                        revenue = rLabel.nextElementSibling.textContent.trim();
                    } else if (rLabel.parentElement) {
                        const match = rLabel.parentElement.textContent.match(/[$£€]\s*[\d,.]+/);
                        if (match) revenue = match[0];
                    }
                }

                return { tickets, revenue };
            }
        }
    ];

    // ============================================================================
    // 4. UI & PRESENTATION (Liquid Glass Component)
    // ============================================================================

    const UI = {
        els: {},
        isDragging: false,
        rafTicking: false,

        init() {
            this.injectStyles();
            this.buildWidget();
            this.buildToast();
            if (typeof GM_registerMenuCommand !== 'undefined') {
                GM_registerMenuCommand('Reset Extractor Position', () => this.resetPosition());
            }
        },

        injectStyles() {
            GM_addStyle(`
                :root {
                    --status-rgb-scan: 148, 163, 184;
                    --status-rgb-green: 16, 185, 129;
                    --status-rgb-yellow: 245, 158, 11;
                    --status-rgb-red: 239, 68, 68;
                    --uese-current-status-rgb: var(--status-rgb-scan);
                }

                .uese-widget.status-scanning { --uese-current-status-rgb: var(--status-rgb-scan); }
                .uese-widget.status-green    { --uese-current-status-rgb: var(--status-rgb-green); }
                .uese-widget.status-yellow   { --uese-current-status-rgb: var(--status-rgb-yellow); }
                .uese-widget.status-red      { --uese-current-status-rgb: var(--status-rgb-red); }

                .uese-widget {
                    position: fixed;
                    top: clamp(10px, 2vh, 40px);
                    left: 50%;
                    z-index: ${CONFIG.UI_Z_INDEX};
                    display: inline-flex;
                    align-items: center;
                    gap: 0.5rem;
                    padding: 0.4rem 0.75rem;
                    border-radius: 9999px;
                    border: none;
                    outline: none;
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    cursor: default;

                    background: rgba(15, 23, 42, 0.45);
                    backdrop-filter: blur(28px) saturate(200%) brightness(1.08);
                    -webkit-backdrop-filter: blur(28px) saturate(200%) brightness(1.08);

                    box-shadow:
                        inset 0  1.5px 0   rgba(255,255,255,0.75),
                        inset 0 -1.5px 0   rgba(255,255,255,0.06),
                        inset  1px 0   0   rgba(255,255,255,0.30),
                        inset -1px 0   0   rgba(255,255,255,0.10),
                        0 0 0 0.5px        rgba(255,255,255,0.18),
                        0 8px 32px         rgba(var(--uese-current-status-rgb), 0.35),
                        0 2px  8px         rgba(0,0,0,0.30);

                    opacity: 0;
                    pointer-events: none;
                    transform: translateX(-50%) translateY(-10px);
                    transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease, box-shadow 0.4s ease;
                }

                .uese-widget.uese-visible {
                    opacity: 1;
                    pointer-events: auto;
                    transform: translateX(-50%) translateY(0);
                }

                .uese-widget.uese-dragged {
                    transform: none;
                }

                .uese-widget::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: 9999px;
                    padding: 1px;
                    background: linear-gradient(
                        155deg,
                        rgba(255,255,255,0.72) 0%,
                        rgba(255,255,255,0.35) 25%,
                        rgba(255,255,255,0.08) 55%,
                        rgba(255,255,255,0.22) 100%
                    );
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    mask:         linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    pointer-events: none;
                    z-index: 5;
                }

                .uese-widget::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 58%;
                    background: radial-gradient(
                        ellipse 75% 70% at 50% -8%,
                        rgba(255,255,255,0.40)  0%,
                        rgba(255,255,255,0.15) 40%,
                        rgba(255,255,255,0.04) 70%,
                        transparent            90%
                    );
                    border-radius: 9999px 9999px 0 0;
                    pointer-events: none;
                    z-index: 5;
                }

                .uese-glass-scatter {
                    position: absolute;
                    inset: 2px;
                    border-radius: 9999px;
                    background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.08) 0%, transparent 65%);
                    pointer-events: none;
                    z-index: 1;
                }

                .uese-glass-chroma {
                    position: absolute;
                    inset: 0;
                    border-radius: 9999px;
                    background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.12) 74%, rgba(255,80,100,0.09) 84%, transparent 92%);
                    pointer-events: none;
                    z-index: 2;
                }

                .uese-glass-rim {
                    position: absolute;
                    bottom: 0; left: 12%; right: 12%;
                    height: 40%;
                    background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
                    border-radius: 0 0 9999px 9999px;
                    pointer-events: none;
                    z-index: 3;
                }

                .uese-drag-handle, .uese-data-display, .uese-divider, .uese-btn {
                    position: relative;
                    z-index: 6;
                }

                .uese-drag-handle {
                    cursor: grab;
                    padding: 0.4rem 0.2rem;
                    display: flex;
                    align-items: center;
                    opacity: 0.65;
                    color: white;
                    transition: opacity 0.2s;
                }
                .uese-drag-handle:hover { opacity: 1; }
                .uese-drag-handle:active { cursor: grabbing; }

                .uese-data-display {
                    display: flex;
                    align-items: center;
                    gap: 0.55rem;
                    padding: 0.25rem 0.55rem;
                    border-radius: 9999px;
                    font-size: clamp(12px, 1.25vw, 13.5px);
                    font-weight: 600;
                    letter-spacing: -0.02em;
                    cursor: pointer;
                    user-select: none;
                    transition: background 0.2s ease;
                }
                .uese-data-display:hover { background: rgba(255, 255, 255, 0.1); }

                .uese-indicator {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background-color: rgb(var(--uese-current-status-rgb));
                    box-shadow: 0 0 8px 1px rgb(var(--uese-current-status-rgb));
                    transition: all 0.4s ease;
                    flex-shrink: 0;
                }
                .uese-indicator.scanning { animation: uese-pulse-status 1.6s infinite; }

                @keyframes uese-pulse-status {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.15); }
                }

                .uese-data-text {
                    white-space: nowrap;
                    color: rgba(255, 255, 255, 0.98);
                    text-shadow: 0 1px 3px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
                }

                .uese-divider {
                    width: 1px;
                    height: 14px;
                    background: rgba(255, 255, 255, 0.25);
                    box-shadow: 1px 0 0 rgba(0,0,0,0.15);
                    margin: 0 0.1rem;
                }

                .uese-btn {
                    background: transparent;
                    color: rgba(255,255,255,0.75);
                    border: none;
                    padding: 0.4rem;
                    border-radius: 9999px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }
                .uese-btn:hover {
                    background: rgba(255, 255, 255, 0.15);
                    color: #ffffff;
                }
                .uese-btn:active { transform: scale(0.92); }

                @keyframes uese-spin { 100% { transform: rotate(360deg); } }
                .uese-spin svg { animation: uese-spin 1s linear infinite; }

                .uese-toast {
                    position: fixed;
                    bottom: clamp(10px, 4vh, 24px);
                    left: 50%;
                    transform: translateX(-50%) translateY(20px);
                    padding: 0.6rem 1.2rem;
                    border-radius: 9999px;
                    font-family: sans-serif;
                    font-size: clamp(12px, 1.4vw, 13px);
                    font-weight: 500;
                    z-index: ${CONFIG.UI_Z_INDEX + 1};
                    opacity: 0;
                    pointer-events: none;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 0.6rem;
                    background: rgba(15, 23, 42, 0.92);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    color: #fff;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                }
                .uese-toast.uese-show {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            `);
        },

        buildWidget() {
            this.els.wrapper = Utils.el('div', 'uese-widget status-scanning');

            this.els.glassScatter = Utils.el('div', 'uese-glass-scatter');
            this.els.glassChroma = Utils.el('div', 'uese-glass-chroma');
            this.els.glassRim = Utils.el('div', 'uese-glass-rim');

            this.els.dragHandle = Utils.el('div', 'uese-drag-handle');
            this.els.dragHandle.title = 'Drag to move (Double-Click to Reset)';
            this.els.dragHandle.setAttribute('tabindex', '0');
            this.els.dragHandle.appendChild(Utils.createSvgIcon("M9 5h2v2H9V5zm0 6h2v2H9v-2zm0 6h2v2H9v-2zm4-12h2v2h-2V5zm0 6h2v2h-2v-2zm0 6h2v2h-2v-2z"));

            this.els.dataDisplay = Utils.el('div', 'uese-data-display');
            this.els.indicator = Utils.el('div', 'uese-indicator scanning');
            this.els.dataText = Utils.el('span', 'uese-data-text', 'SCANNING...');
            this.els.dataDisplay.append(this.els.indicator, this.els.dataText);

            this.els.divider = Utils.el('div', 'uese-divider');

            this.els.copyBtn = Utils.el('button', 'uese-btn');
            this.els.copyBtn.title = 'Copy Extracted Data';
            this.els.copyBtn.appendChild(Utils.createSvgIcon("M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"));

            this.els.refreshBtn = Utils.el('button', 'uese-btn');
            this.els.refreshBtn.title = 'Force Re-scan';
            this.els.refreshBtn.appendChild(Utils.createSvgIcon("M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"));

            this.els.wrapper.append(
                this.els.glassScatter,
                this.els.glassChroma,
                this.els.glassRim,
                this.els.dragHandle,
                this.els.dataDisplay,
                this.els.divider,
                this.els.copyBtn,
                this.els.refreshBtn
            );
            document.body.appendChild(this.els.wrapper);
            this.loadSafePosition();

            const handleCopy = (e) => {
                e.preventDefault();
                e.stopPropagation();
                Extractor.executeCopy();
            };

            this.els.copyBtn.addEventListener('click', handleCopy);
            this.els.dataDisplay.addEventListener('click', handleCopy);
            this.els.refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                App.resetAndScan(true);
            });
            this.els.dragHandle.addEventListener('dblclick', () => this.resetPosition());

            this.initDraggable(this.els.wrapper, this.els.dragHandle);
        },

        buildToast() {
            this.els.toast = Utils.el('div', 'uese-toast');
            this.els.toastIcon = Utils.createSvgIcon("M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", "currentColor");
            this.els.toastText = Utils.el('span');
            this.els.toast.append(this.els.toastIcon, this.els.toastText);
            document.body.appendChild(this.els.toast);
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
                requestAnimationFrame(() => {
                    const width = this.els.wrapper.offsetWidth || 300;
                    const height = this.els.wrapper.offsetHeight || 50;

                    const safeX = Math.max(0, Math.min(pos.x, window.innerWidth - width));
                    const safeY = Math.max(0, Math.min(pos.y, window.innerHeight - height));

                    this.els.wrapper.style.left = `${safeX}px`;
                    this.els.wrapper.style.top = `${safeY}px`;
                    this.els.wrapper.classList.add('uese-dragged');
                });
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
                el.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease, box-shadow 0.4s ease';
                Storage.setPosition(parseInt(el.style.left, 10), parseInt(el.style.top, 10));
            };
            const onMouseDown = (e) => {
                this.isDragging = true;
                el.style.transition = 'box-shadow 0.4s ease';

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

        updateVisibility(visible) {
            this.ensureInDOM();
            if (visible) {
                this.els.wrapper.classList.add('uese-visible');
                if (State.themeConfig) this.applyTheme(State.themeConfig);
            } else {
                this.els.wrapper.classList.remove('uese-visible');
            }
        },

        updateStatus(state, tickets = '', revenue = '') {
            this.ensureInDOM();
            this.els.wrapper.classList.remove('status-scanning', 'status-green', 'status-yellow', 'status-red');
            this.els.indicator.className = 'uese-indicator';

            if (state === 'scanning') {
                this.els.refreshBtn.classList.add('uese-spin');
                this.els.dataText.textContent = "SCANNING...";
                this.els.wrapper.classList.add('status-scanning');
                this.els.indicator.classList.add('scanning');
            } else if (state === 'not_found') {
                this.els.refreshBtn.classList.remove('uese-spin');
                this.els.dataText.textContent = "NOT FOUND";
                this.els.wrapper.classList.add('status-red');
            } else if (state === 'found') {
                this.els.refreshBtn.classList.remove('uese-spin');
                const tVal = Utils.parseNum(tickets);
                const rVal = Utils.parseNum(revenue);

                let statusText = "";
                if (tVal === 0 && rVal === 0) {
                    this.els.wrapper.classList.add('status-red');
                    statusText = "NO SALES";
                } else if (tVal > 0 && rVal === 0) {
                    this.els.wrapper.classList.add('status-yellow');
                    statusText = "FREE TICKETS";
                } else {
                    this.els.wrapper.classList.add('status-green');
                    statusText = "WITH SALES";
                }

                this.els.dataText.textContent = `${statusText} • ${tickets} sold • ${revenue}`;
            }
        },

        showToast(message, type = 'success') {
            this.ensureInDOM();
            const iconColor = type === 'success' ? 'rgba(var(--status-rgb-green), 1)' : 'rgba(var(--status-rgb-red), 1)';
            const iconPath = type === 'success'
                ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                : "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";

            this.els.toastIcon.setAttribute('stroke', iconColor);
            this.els.toastIcon.querySelector('path').setAttribute('d', iconPath);
            this.els.toastText.textContent = message;

            this.els.toast.style.borderLeft = `3px solid ${iconColor}`;
            this.els.toast.classList.add('uese-show');

            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => this.els.toast.classList.remove('uese-show'), 3000);
        }
    };

    // ============================================================================
    // 5. EXTRACTOR (Data Logic)
    // ============================================================================

    const Extractor = {
        async executeCopy() {
            if (!State.activeModule) return;

            let data = State.cachedData;

            try {
                if (!data) data = State.activeModule.extract();
                const url = window.location.href;

                let fourthCol = '0';
                const tVal = Utils.parseNum(data.tickets);
                const rVal = Utils.parseNum(data.revenue);
                if (data.freeTickets !== undefined) fourthCol = data.freeTickets;
                else if (tVal > 0 && rVal === 0) fourthCol = data.tickets;
                else if (tVal > 0 && rVal > 0) fourthCol = CONFIG.DEFAULTS.TEXT_CHECK_FREE;

                const rawString = `${url}\t${data.tickets}\t${data.revenue}\t${fourthCol}`;
                await this.performClipboardWrite(rawString);
                UI.showToast(`Copied! ${data.tickets} tix - ${data.revenue}`, 'success');
                UI.updateStatus('found', data.tickets, data.revenue);
            } catch (err) {
                Logger.error("Extractor", "Extraction failed", err);
                UI.showToast("Failed to extract data.", 'error');
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
            if (this.domObserver) this.domObserver.disconnect();
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
                    this.updateObservationRoot();
                }
            }

            UI.updateVisibility(!!State.activeModule);

            if (State.activeModule) {
                try {
                    const data = State.activeModule.extract();
                    if (data.tickets !== '' || data.revenue !== '') {
                        State.cachedData = data;
                        State.hasFetchedData = true;
                        UI.updateStatus('found', data.tickets, data.revenue);

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
                if (window.location.href.split('?')[0] !== State.currentUrl.split('?')[0]) {
                    handleNav();
                }
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
            Logger.log("Bootstrap", `Initializing Version ${GM_info?.script?.version || '7.7'}`);
            UI.init();
            Router.init();
            Observer.start();
        },
        resetAndScan(force = false) {
            State.currentUrl = window.location.href;
            State.activeModule = null;
            State.hasFetchedData = false;
            State.cachedData = null;
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
