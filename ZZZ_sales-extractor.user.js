// ==UserScript==
// @name         [Multi-Site] Sales Extractor
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         //none
// @version      5.4
// @description  Extracts ticket sales and revenue data from event dashboards.
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

    if (window !== window.top) return; // Failsafe for @noframes
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
        HISTORY_LIMIT: 5,
        UI_Z_INDEX: 2147483647,
        DEFAULTS: {
            TICKETS: '0',
            REVENUE: '$0',
            TEXT_SOLD: 'Tickets Sold',
            TEXT_NET: 'Net Sales'
        }
    };

    const State = {
        currentUrl: window.location.href,
        activeModule: null,
        hasFetchedData: false,
        pollCount: 0,
        pollTimer: null,
        scanTimer: null,
        history: [],
        themeConfig: null
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
        init() {
            try {
                const oldHistory = sessionStorage.getItem('uese_history');
                if (oldHistory) {
                    GM_setValue('uese_history', JSON.parse(oldHistory));
                    sessionStorage.removeItem('uese_history');
                }
                const data = GM_getValue('uese_history', []);
                State.history = Array.isArray(data) ? data : [];
            } catch (err) {
                Logger.error('Storage', 'Failed to load history, resetting.', err);
                State.history = [];
            }
        },
        saveHistory(entry) {
            State.history.unshift(entry);
            if (State.history.length > CONFIG.HISTORY_LIMIT) State.history.pop();
            try {
                GM_setValue('uese_history', State.history);
                UI.renderHistory();
            } catch (err) {
                Logger.error('Storage', 'Failed to save history', err);
            }
        },
        getPosition() {
            return {
                x: GM_getValue('uese_pos_x', null),
                y: GM_getValue('uese_pos_y', null)
            };
        },
        setPosition(x, y) {
            GM_setValue('uese_pos_x', x);
            GM_setValue('uese_pos_y', y);
        },
        resetPosition() {
            GM_setValue('uese_pos_x', null);
            GM_setValue('uese_pos_y', null);
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
            theme: { bgRGB: '255, 255, 255', textRGB: '15, 15, 15', accent: '#D0410C', accentSec: '#3D64FF' },
            check: () => {
                const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, strong, b');
                const exactMatch = Array.from(nodes).some(el => el.children.length === 0 && el.textContent.trim() === CONFIG.DEFAULTS.TEXT_SOLD);
                const legacyMatch = Array.from(document.querySelectorAll('[data-testid="amount-card-title"]')).some(el => el.innerText.trim() === CONFIG.DEFAULTS.TEXT_SOLD);
                return exactMatch || legacyMatch;
            },
            extract: () => {
                let ticketsSold = '', netSales = '', freeTickets = undefined;

                const findCard = (targetText) => {
                    const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, strong, b');
                    const targetNode = Array.from(nodes).find(el => el.children.length === 0 && el.textContent.trim() === targetText);
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
            theme: { bgRGB: '0, 0, 0', textRGB: '255, 255, 255', accent: '#FFFFFF', accentSec: '#FFFFFF' },
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
            theme: { bgRGB: '255, 255, 255', textRGB: '0, 0, 0', accent: '#FF4848', accentSec: '#FF4848' },
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
            theme: { bgRGB: '255, 255, 255', textRGB: '0, 25, 38', accent: '#0C9A9A', accentSec: '#001926' },
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
            theme: { bgRGB: '247, 247, 248', textRGB: '20, 20, 20', accent: '#1C2A7C', accentSec: '#1C2A7C' },
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
            theme: { bgRGB: '255, 255, 255', textRGB: '0, 0, 0', accent: '#EB0045', accentSec: '#000000' },
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
            this.buildHistoryPanel();
            this.buildToast();
        },

        injectStyles() {
            GM_addStyle(`
                :root {
                    --uese-bg-rgb: 255, 255, 255;
                    --uese-text-rgb: 15, 15, 15;
                    --uese-accent: #D0410C;
                    --uese-accent-sec: #3D64FF;
                    --uese-accent-rgb: 208, 65, 12;
                    --uese-accent-sec-rgb: 61, 100, 255;

                    --uese-glass-bg: rgba(var(--uese-bg-rgb), 0.45);
                    --uese-glass-border: rgba(var(--uese-accent-rgb), 0.25);
                    --uese-glass-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.15), 0 0 15px rgba(var(--uese-accent-rgb), 0.1);
                }
                .uese-glass {
                    background: var(--uese-glass-bg);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid var(--uese-glass-border);
                    box-shadow: var(--uese-glass-shadow);
                    color: rgb(var(--uese-text-rgb));
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
                    transition: opacity 0.3s ease, transform 0.3s ease;
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
                    opacity: 0.6;
                    transition: opacity 0.2s, color 0.2s;
                }
                .uese-drag-handle:hover {
                    opacity: 1;
                    color: var(--uese-accent);
                }
                .uese-drag-handle:active { cursor: grabbing; }

                .uese-btn {
                    background: rgba(var(--uese-accent-rgb), 0.08);
                    color: rgb(var(--uese-text-rgb));
                    border: 1px solid rgba(var(--uese-accent-rgb), 0.15);
                    padding: 0.6rem 1rem;
                    border-radius: 10px;
                    font-weight: 600;
                    font-size: clamp(13px, 1.5vw, 14px);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    transition: all 0.2s ease;
                    min-height: 40px;
                    position: relative;
                }
                .uese-btn:hover, .uese-btn:focus-visible {
                    background: rgba(var(--uese-accent-sec-rgb), 0.15);
                    border-color: rgba(var(--uese-accent-sec-rgb), 0.4);
                    color: var(--uese-accent-sec);
                    outline: none;
                }
                .uese-btn:hover svg, .uese-btn:focus-visible svg {
                    stroke: var(--uese-accent-sec);
                }
                .uese-btn:active {
                    transform: scale(0.96);
                }
                .uese-btn.uese-icon-only {
                    padding: 0.6rem;
                }
                .uese-status-text {
                    transition: color 0.3s ease;
                }

                .uese-indicator {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background-color: var(--indicator-color, #888);
                    box-shadow: 0 0 6px var(--indicator-color, transparent);
                    transition: all 0.3s ease;
                    flex-shrink: 0;
                }
                .uese-indicator.green { --indicator-color: #10b981; }
                .uese-indicator.yellow { --indicator-color: #f59e0b; }
                .uese-indicator.red { --indicator-color: #ef4444; }
                .uese-indicator.scanning {
                    --indicator-color: #3b82f6;
                    animation: uese-pulse 1.5s infinite;
                }
                @keyframes uese-pulse {
                    0%, 100% { opacity: 0.6; box-shadow: 0 0 4px var(--indicator-color); }
                    50% { opacity: 1; box-shadow: 0 0 10px var(--indicator-color); }
                }

                .uese-tooltip {
                    position: absolute;
                    bottom: -35px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgb(var(--uese-text-rgb));
                    color: rgb(var(--uese-bg-rgb));
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 500;
                    white-space: nowrap;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                    border: 1px solid var(--uese-glass-border);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                .uese-btn:hover .uese-tooltip { opacity: 1; }

                .uese-history-panel {
                    position: fixed;
                    width: clamp(260px, 90vw, 320px);
                    border-radius: 14px;
                    z-index: ${CONFIG.UI_Z_INDEX};
                    padding: 1rem;
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                }
                .uese-history-panel.uese-open {
                    opacity: 1;
                    pointer-events: auto;
                }
                .uese-history-header {
                    font-weight: bold;
                    margin-bottom: 0.75rem;
                    padding-bottom: 0.5rem;
                    border-bottom: 1px solid var(--uese-glass-border);
                    display: flex;
                    justify-content: space-between;
                }
                .uese-history-item {
                    font-size: 0.85rem;
                    padding: 0.6rem;
                    border-bottom: 1px solid var(--uese-glass-border);
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    transition: background 0.2s, border-color 0.2s;
                    border-radius: 8px;
                    margin-bottom: 4px;
                }
                .uese-history-item:hover {
                    background: rgba(var(--uese-accent-sec-rgb), 0.08);
                    border-color: rgba(var(--uese-accent-sec-rgb), 0.3);
                }
                .uese-history-item:last-child {
                    border-bottom: none;
                    margin-bottom: 0;
                }
                .uese-history-domain {
                    opacity: 0.6;
                    font-size: 0.7rem;
                    margin-top: 2px;
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
                }
                .uese-toast.uese-show {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            `);
        },

        buildWidget() {
            this.els.wrapper = Utils.el('div', 'uese-widget uese-glass');
            this.els.dragHandle = Utils.el('div', 'uese-drag-handle');
            this.els.dragHandle.title = 'Drag to move (Double-Click to Reset)';
            this.els.dragHandle.appendChild(Utils.createSvgIcon("M9 5h2v2H9V5zm0 6h2v2H9v-2zm0 6h2v2H9v-2zm4-12h2v2h-2V5zm0 6h2v2h-2v-2zm0 6h2v2h-2v-2z"));

            this.els.copyBtn = Utils.el('button', 'uese-btn');

            this.els.indicator = Utils.el('div', 'uese-indicator scanning');
            this.els.copyBtn.appendChild(this.els.indicator);

            this.els.copyBtn.appendChild(Utils.createSvgIcon("M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"));

            this.els.statusText = Utils.el('span', 'uese-status-text', 'Scanning...');
            this.els.copyBtn.appendChild(this.els.statusText);

            this.els.statusIcon = Utils.createSvgIcon("M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", "rgba(var(--uese-text-rgb), 0.5)");
            this.els.copyBtn.appendChild(this.els.statusIcon);

            const tooltip = Utils.el('span', 'uese-tooltip', 'Shift+Click for JSON');
            this.els.copyBtn.appendChild(tooltip);

            this.els.refreshBtn = Utils.el('button', 'uese-btn uese-icon-only');
            this.els.refreshBtn.title = 'Force Re-scan';
            this.els.refreshBtn.appendChild(Utils.createSvgIcon("M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"));

            this.els.historyBtn = Utils.el('button', 'uese-btn uese-icon-only');
            this.els.historyBtn.title = 'View Recent History';
            this.els.historyBtn.appendChild(Utils.createSvgIcon("M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"));

            this.els.wrapper.append(this.els.dragHandle, this.els.copyBtn, this.els.refreshBtn, this.els.historyBtn);
            document.body.appendChild(this.els.wrapper);

            this.loadSafePosition();

            this.els.copyBtn.addEventListener('click', (e) => Extractor.executeCopy(e.shiftKey));
            this.els.refreshBtn.addEventListener('click', () => App.resetAndScan(true));
            this.els.historyBtn.addEventListener('click', () => this.toggleHistory());
            this.els.dragHandle.addEventListener('dblclick', () => this.resetPosition());

            this.initDraggable(this.els.wrapper, this.els.dragHandle);
        },

        ensureInDOM() {
            if (!this.els.wrapper) return;
            if (!document.body.contains(this.els.wrapper)) document.body.appendChild(this.els.wrapper);
            if (!document.body.contains(this.els.historyPanel)) document.body.appendChild(this.els.historyPanel);
            if (!document.body.contains(this.els.toast)) document.body.appendChild(this.els.toast);
        },

        applyTheme(themeObj) {
            if (!themeObj) return;
            const root = document.documentElement;
            root.style.setProperty('--uese-bg-rgb', themeObj.bgRGB);
            root.style.setProperty('--uese-text-rgb', themeObj.textRGB);
            root.style.setProperty('--uese-accent', themeObj.accent);
            root.style.setProperty('--uese-accent-sec', themeObj.accentSec || themeObj.accent);
            root.style.setProperty('--uese-accent-rgb', Utils.hexToRgb(themeObj.accent));
            root.style.setProperty('--uese-accent-sec-rgb', Utils.hexToRgb(themeObj.accentSec || themeObj.accent));
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
            this.positionHistoryPanel();
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
                        this.positionHistoryPanel();
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

                el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                Storage.setPosition(parseInt(el.style.left, 10), parseInt(el.style.top, 10));
            };

            const onMouseDown = (e) => {
                this.isDragging = true;
                el.style.transition = 'none';

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
        },

        buildHistoryPanel() {
            this.els.historyPanel = Utils.el('div', 'uese-history-panel uese-glass');
            document.body.appendChild(this.els.historyPanel);
            this.renderHistory();
        },

        positionHistoryPanel() {
            const widgetRect = this.els.wrapper.getBoundingClientRect();
            if (widgetRect.top > window.innerHeight / 2) {
                this.els.historyPanel.style.top = 'auto';
                this.els.historyPanel.style.bottom = `${window.innerHeight - widgetRect.top + 10}px`;
            } else {
                this.els.historyPanel.style.bottom = 'auto';
                this.els.historyPanel.style.top = `${widgetRect.bottom + 10}px`;
            }
            let idealLeft = widgetRect.left + (widgetRect.width / 2) - (this.els.historyPanel.offsetWidth / 2);
            idealLeft = Math.max(10, Math.min(idealLeft, window.innerWidth - this.els.historyPanel.offsetWidth - 10));
            this.els.historyPanel.style.left = `${idealLeft}px`;
            this.els.historyPanel.style.right = 'auto';
        },

        buildToast() {
            this.els.toast = Utils.el('div', 'uese-toast uese-glass');
            document.body.appendChild(this.els.toast);
        },

        toggleHistory() {
            const isOpen = this.els.historyPanel.classList.toggle('uese-open');
            if (isOpen) {
                this.positionHistoryPanel();
                this.renderHistory();
            }
        },

        renderHistory() {
            while (this.els.historyPanel.firstChild) {
                this.els.historyPanel.removeChild(this.els.historyPanel.firstChild);
            }

            const header = Utils.el('div', 'uese-history-header');
            header.appendChild(Utils.el('span', '', 'Recent Extractions'));
            this.els.historyPanel.appendChild(header);

            if (State.history.length === 0) {
                const empty = Utils.el('div', '', 'No recent data');
                empty.style.cssText = 'opacity:0.5; font-size: 12px; text-align: center; padding: 10px;';
                this.els.historyPanel.appendChild(empty);
                return;
            }

            State.history.forEach(item => {
                const row = Utils.el('div', 'uese-history-item');

                const leftCol = Utils.el('div');
                const title = Utils.el('div', '', `${item.tickets} Tix - ${item.revenue}`);
                title.style.fontWeight = '500';

                let domainText = 'Unknown';
                try { domainText = new URL(item.url).hostname; } catch (e) {}

                const domain = Utils.el('div', 'uese-history-domain', domainText);
                leftCol.append(title, domain);

                const rightCol = Utils.el('div', '', '📋');
                rightCol.style.cssText = 'opacity:0.5; font-size: 16px; display:flex; align-items:center;';

                row.append(leftCol, rightCol);
                row.addEventListener('click', () => {
                    Extractor.performClipboardWrite(item.rawString);
                    this.showToast("Copied from history!", "success");
                    this.toggleHistory();
                });
                this.els.historyPanel.appendChild(row);
            });
        },

        updateVisibility(visible) {
            this.ensureInDOM();
            if (visible) {
                this.els.wrapper.classList.add('uese-visible');
                this.positionHistoryPanel();
                if (State.themeConfig) this.applyTheme(State.themeConfig);
            } else {
                this.els.wrapper.classList.remove('uese-visible');
                this.els.historyPanel.classList.remove('uese-open');
            }
        },

        updateStatus(state, tickets = 0, revenue = 0) {
            this.ensureInDOM();
            if (this.els.statusIcon) this.els.statusIcon.remove();

            // Reset indicator classes and text colors
            this.els.indicator.className = 'uese-indicator';
            this.els.statusText.style.color = '';

            if (state === 'scanning') {
                this.els.statusText.textContent = "Scanning...";
                this.els.indicator.classList.add('scanning');
                this.els.statusIcon = Utils.createSvgIcon("M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", "rgba(var(--uese-text-rgb), 0.5)");
            } else if (state === 'not_found') {
                this.els.statusText.textContent = "Not Found";
                this.els.indicator.classList.add('red');
                this.els.statusIcon = Utils.createSvgIcon("M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z", "#f59e0b");
            } else if (state === 'found') {
                const tVal = Utils.parseNum(tickets);
                const rVal = Utils.parseNum(revenue);

                let iconColor = "var(--uese-accent)";
                let statusString = "";
                let statusColor = "";

                if (tVal === 0 && rVal === 0) {
                    this.els.indicator.classList.add('red');
                    iconColor = "#ef4444";
                    statusString = "No sales";
                    statusColor = "#ef4444";
                } else if (tVal > 0 && rVal === 0) {
                    this.els.indicator.classList.add('yellow');
                    iconColor = "#f59e0b";
                    statusString = "Free tickets";
                    statusColor = "#f59e0b";
                } else {
                    this.els.indicator.classList.add('green');
                    iconColor = "#10b981";
                    statusString = "With sales";
                    statusColor = "#10b981";
                }

                this.els.statusText.textContent = statusString;
                this.els.statusText.style.color = statusColor;
                this.els.statusIcon = Utils.createSvgIcon("M5 13l4 4L19 7", iconColor);
            }

            this.els.copyBtn.appendChild(this.els.statusIcon);
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
                else if (tVal > 0 && rVal > 0) fourthCol = 'check free tix';
                const exportData = { url, tickets: data.tickets, revenue: data.revenue, fourthCol, timestamp: Date.now() };
                const rawString = `${url}\t${data.tickets}\t${data.revenue}\t${fourthCol}`;
                const output = asJson ? JSON.stringify(exportData, null, 2) : rawString;

                await this.performClipboardWrite(output);
                exportData.rawString = rawString;
                Storage.saveHistory(exportData);
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
            this.domObserver.observe(document.body, { childList: true, subtree: true });
            this.startPolling();
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
                if (State.activeModule && State.activeModule.theme) {
                    State.themeConfig = State.activeModule.theme;
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
            history.pushState = function() { originalPush.apply(this, arguments); handleNav(); };
            const originalReplace = history.replaceState;
            history.replaceState = function() { originalReplace.apply(this, arguments); handleNav(); };
            window.addEventListener('popstate', handleNav);
        }
    };

    // ============================================================================
    // 8. APP BOOTSTRAP
    // ============================================================================

    const App = {
        init() {
            Logger.log("Bootstrap", "Initializing Version 5.4");
            Storage.init();
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
