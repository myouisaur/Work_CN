// ==UserScript==
// @name         [Multi-Site] Sales Extractor
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTBiOTgxIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMTYgOGgtNmEyIDIgMCAxIDAgMCA0aDRhMiAyIDAgMSAxIDAgNEg4Ii8+PHBhdGggZD0iTTEyIDE4VjYiLz48L3N2Zz4=
// @version      8.2
// @description  Extracts and displays ticket sales and revenue metrics directly within supported event dashboards.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @match        *://*.posh.vip/*
// @match        *://*.ra.co/pro/events/*/tickets/management
// @match        *://*.eventim.us/*
// @match        *://*.boletosexpress.com/*
// @match        *://*.tickeri.com/*
// @run-at       document-idle
// @noframes
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
    if (window.xivInitialized) return;
    window.xivInitialized = true;

    // ============================================================================
    // 1. CONFIGURATION & STATE
    // ============================================================================

    const CONFIG = {
        VERSION: '7.12',
        DEBUG: false,

        TIMING: {
            DEBOUNCE_MS: 300,
            POLL_BASE_DELAY_MS: 1000,
            POLL_MAX_ATTEMPTS: 15,
            POLL_MULTIPLIER: 1.5,
            TOAST_DURATION_MS: 3000
        },

        UI: {
            Z_INDEX: 2147483647,
        },

        STORAGE_KEYS: {
            POS_X: 'xiv_pos_x',
            POS_Y: 'xiv_pos_y'
        },

        DEFAULTS: {
            TICKETS: '0',
            REVENUE: '$0',
            TEXT_SOLD: 'Tickets Sold',
            TEXT_NET: 'Net Sales',
            TEXT_CHECK_FREE: 'check free tix'
        },

        ICONS: {
            DRAG_HANDLE: "M9 5h2v2H9V5zm0 6h2v2H9v-2zm0 6h2v2H9v-2zm4-12h2v2h-2V5zm0 6h2v2h-2v-2zm0 6h2v2h-2v-2z",
            COPY: "M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3",
            REFRESH: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
            SUCCESS: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
            ERROR: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
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
    // 2. UTILITIES, STORAGE & AUDIO
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
            const x = parseInt(this.get(CONFIG.STORAGE_KEYS.POS_X, null), 10);
            const y = parseInt(this.get(CONFIG.STORAGE_KEYS.POS_Y, null), 10);
            return {
                x: isNaN(x) ? null : x,
                y: isNaN(y) ? null : y
            };
        },
        setPosition(x, y) {
            this.set(CONFIG.STORAGE_KEYS.POS_X, x);
            this.set(CONFIG.STORAGE_KEYS.POS_Y, y);
        },
        resetPosition() {
            this.set(CONFIG.STORAGE_KEYS.POS_X, null);
            this.set(CONFIG.STORAGE_KEYS.POS_Y, null);
        }
    };

    const AudioNotifier = {
        ctx: null,
        init() {
            if (!this.ctx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) this.ctx = new AudioContext();
            }
        },
        play(type) {
            try {
                this.init();
                if (!this.ctx) return;
                if (this.ctx.state === 'suspended') this.ctx.resume();

                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain);
                gain.connect(this.ctx.destination);

                const now = this.ctx.currentTime;
                if (type === 'success') {
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(880, now); // A5
                    osc.frequency.setValueAtTime(1108.73, now + 0.1); // C#6
                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
                    gain.gain.linearRampToValueAtTime(0, now + 0.2);
                    osc.start(now);
                    osc.stop(now + 0.2);
                } else {
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(220, now); // A3
                    osc.frequency.setValueAtTime(200, now + 0.1);
                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
                    gain.gain.linearRampToValueAtTime(0, now + 0.3);
                    osc.start(now);
                    osc.stop(now + 0.3);
                }
            } catch (e) {
                Logger.warn("AudioNotifier", "Failed to play audio feedback.", e);
            }
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
        getTextNode: (text, exact = false, root = document) => {
            const condition = exact
                ? `normalize-space(text())='${text}'`
                : `contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')`;
            return document.evaluate(`.//*[not(self::script or self::style or self::noscript) and ${condition}]`, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        },
        findCardByText: (text, exact = false, root = document) => {
            const node = Utils.getTextNode(text, exact, root);
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

    CONFIG.SITES = [
        {
            name: 'Eventbrite',
            domain: 'eventbrite.com',
            rootSelector: '#root, main',
            theme: { accent: '#D0410C', accentSec: '#D0410C' },
            check: (root) => !!Utils.getTextNode(CONFIG.DEFAULTS.TEXT_SOLD, true, root),
            extract: (root) => {
                let ticketsSold = '', netSales = '', freeTickets = undefined;

                const tixCard = Utils.findCardByText(CONFIG.DEFAULTS.TEXT_SOLD, true, root);
                if (tixCard) {
                    const rawText = tixCard.textContent || '';
                    const tixMatch = rawText.match(/(\d+)\s*\/\s*\d+/);
                    if (tixMatch) ticketsSold = tixMatch[1];
                    const freeMatch = rawText.match(/(\d+)\s*free/i);
                    if (freeMatch) freeTickets = freeMatch[1];
                }

                const salesCard = Utils.findCardByText(CONFIG.DEFAULTS.TEXT_NET, true, root);
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
            rootSelector: '#__next, #root, body',
            theme: { accent: '#FFFFFF', accentSec: '#FFFFFF' },
            check: (root) => {
                const path = window.location.pathname;
                const isEventDashboard = /\/events\/[a-fA-F0-9]+\//i.test(path);
                const isPublicEvent = path.startsWith('/e/');

                if (!isEventDashboard && !isPublicEvent) return false;

                return !!root.querySelector('div.CrossSection__w3a2U') || !!root.querySelector('[data-slot="stat-card"]');
            },
            extract: (root) => {
                let ticketsSold = '', totalRevenue = CONFIG.DEFAULTS.REVENUE;

                const statCards = root.querySelectorAll('[data-slot="stat-card"]');
                if (statCards.length > 0) {
                    statCards.forEach(card => {
                        const labelEl = card.querySelector('span.text-muted-foreground');
                        if (!labelEl) return;

                        const labelText = labelEl.textContent.trim().toLowerCase();
                        const valueContainer = card.querySelector('span.text-xl > span');

                        if (!valueContainer) return;

                        if (labelText.includes('net tickets sold') || labelText.includes('gross tickets sold')) {
                            ticketsSold = valueContainer.textContent.trim();
                        } else if (labelText.includes('net revenue') || labelText.includes('gross revenue')) {
                            totalRevenue = valueContainer.textContent.trim();
                        }
                    });
                }

                if (!ticketsSold && totalRevenue === CONFIG.DEFAULTS.REVENUE) {
                    root.querySelectorAll('div.CrossSection__w3a2U').forEach(div => {
                        const label = div.querySelector('p')?.textContent?.trim();
                        if (label === "Total Tickets Sold" || label === "Total RSVPs") {
                            ticketsSold = div.querySelector('h3')?.textContent?.trim();
                        }
                        if (label === "Total Revenue" || label === "Revenue") {
                            totalRevenue = div.querySelector('h3')?.textContent?.trim();
                        }
                    });
                }

                if (!ticketsSold && totalRevenue === CONFIG.DEFAULTS.REVENUE) {
                    throw new Error("Data missing.");
                }

                return { tickets: ticketsSold, revenue: totalRevenue };
            }
        },
        {
            name: 'Resident Advisor',
            domain: 'ra.co',
            rootSelector: '#__next',
            theme: { accent: '#FF4848', accentSec: '#FF4848' },
            check: (root) => window.location.pathname.includes('/tickets/management') && !!root.querySelector('span[color="primary"]'),
            extract: (root) => {
                let tickets = CONFIG.DEFAULTS.TICKETS, revenue = CONFIG.DEFAULTS.REVENUE;

                root.querySelectorAll('span[color="primary"]').forEach(span => {
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
            check: (root) => !!root.querySelector('#table table'),
            extract: (root) => {
                const dataRow = root.querySelectorAll('#table table tr')[1];
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
            check: (root) => !!root.querySelector('#audit'),
            extract: (root) => {
                let tickets = CONFIG.DEFAULTS.TICKETS;
                root.querySelectorAll('#audit dl').forEach(dl => {
                    if (dl.querySelector('dt')?.textContent?.includes('Tickets Distributed')) {
                        tickets = dl.querySelector('dd b')?.textContent?.trim() || CONFIG.DEFAULTS.TICKETS;
                    }
                });
                const revElem = root.querySelector('#revenue_total b');
                return { tickets, revenue: revElem ? revElem.textContent.trim() : CONFIG.DEFAULTS.REVENUE };
            }
        },
        {
            name: 'Tickeri',
            domain: 'tickeri.com',
            rootSelector: 'body',
            theme: { accent: '#EB0045', accentSec: '#EB0045' },
            check: (root) => window.location.pathname.includes('/event/') && document.body.textContent.includes('Ticket Inventory'),
            extract: (root) => {
                let tickets = CONFIG.DEFAULTS.TICKETS, revenue = CONFIG.DEFAULTS.REVENUE;

                const elements = Array.from(root.querySelectorAll('span, div, p')).filter(el => el.children.length === 0);

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
    // 4. UI & PRESENTATION (Liquid Glass Component V5)
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
                    --xiv-current-status-rgb: var(--status-rgb-scan);
                }

                .xiv-dragging-global * {
                    user-select: none !important;
                }

                .xiv-glass-scope.status-scanning { --xiv-current-status-rgb: var(--status-rgb-scan); }
                .xiv-glass-scope.status-green    { --xiv-current-status-rgb: var(--status-rgb-green); }
                .xiv-glass-scope.status-yellow   { --xiv-current-status-rgb: var(--status-rgb-yellow); }
                .xiv-glass-scope.status-red      { --xiv-current-status-rgb: var(--status-rgb-red); }

                /* ── Scope (Positioning Wrapper) ────────────────────────────────────── */
                .xiv-glass-scope {
                    position: fixed;
                    top: clamp(10px, 2vh, 40px);
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: ${CONFIG.UI.Z_INDEX};

                    /* CRITICAL: No opacity transitions here! Visibility swaps instantly. */
                    visibility: hidden;
                    transition: visibility 0s linear 0.3s;
                }

                .xiv-glass-scope.is-visible {
                    visibility: visible;
                    transition: visibility 0s;
                }

                .xiv-glass-scope.xiv-dragged {
                    transform: none !important;
                }

                /* ── Shell (Base Glass Surface) ─────────────────────────────────────── */
                .xiv-glass-shell {
                    position: relative;
                    overflow: hidden;
                    border: none;
                    outline: none;
                    border-radius: 9999px;
                    font-size: 14px !important; /* Establishes strictly controlled relative em sizing */

                    background: rgba(255, 255, 255, 0.14); /* Liquid Glass V5 Standard */
                    backdrop-filter: blur(0.5em) saturate(180%) brightness(1.1);
                    -webkit-backdrop-filter: blur(0.5em) saturate(180%) brightness(1.1);

                    box-shadow:
                        inset 0     0.09em 0    rgba(255,255,255,0.75),
                        inset 0    -0.09em 0    rgba(255,255,255,0.06),
                        inset  0.06em 0    0    rgba(255,255,255,0.30),
                        inset -0.06em 0    0    rgba(255,255,255,0.10),
                        0 0 0       0.03em      rgba(255,255,255,0.20),
                        0 0.4em     1.25em      rgba(var(--xiv-current-status-rgb), 0.35),
                        0 0.15em    0.4em       rgba(0,0,0,0.20);

                    /* CRITICAL: Hardware acceleration and independent opacity state */
                    opacity: 0;
                    will-change: transform, opacity;
                    transform: translateZ(0) scale(0.9) translateY(4px);

                    transition:
                        transform  0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                        opacity    0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                        box-shadow 0.35s ease,
                        background 0.35s ease;
                }

                .xiv-glass-scope.is-visible .xiv-glass-shell {
                    opacity: 1;
                    transform: translateZ(0) scale(1) translateY(0);
                }

                /* ── Gradient Border Ring ─────────────────────── */
                .xiv-glass-shell::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    padding: 0.06em;
                    background: linear-gradient(155deg,
                        rgba(255,255,255,0.72) 0%,
                        rgba(255,255,255,0.35) 25%,
                        rgba(255,255,255,0.08) 55%,
                        rgba(255,255,255,0.22) 100%);
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    pointer-events: none;
                    z-index: 5;
                }

                /* ── Top Glare ─────────────────────────────────── */
                .xiv-glass-shell::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 58%;
                    background: radial-gradient(ellipse 75% 70% at 50% -8%,
                        rgba(255,255,255,0.58) 0%,
                        rgba(255,255,255,0.20) 40%,
                        rgba(255,255,255,0.05) 70%,
                        transparent 90%);
                    border-radius: inherit;
                    pointer-events: none;
                    z-index: 5;
                }

                /* ── Inner Depth Layers ───────────────────────────────────────── */
                .xiv-glass-lens {
                    position: absolute; inset: 0; border-radius: inherit;
                    background: radial-gradient(ellipse at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
                    pointer-events: none; z-index: 1;
                }

                .xiv-glass-scatter {
                    position: absolute; inset: 0.12em; border-radius: inherit;
                    background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
                    pointer-events: none; z-index: 2;
                }

                .xiv-glass-chroma {
                    position: absolute; inset: 0; border-radius: inherit;
                    background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
                    pointer-events: none; z-index: 3;
                }

                .xiv-glass-rim {
                    position: absolute; bottom: 0; left: 10%; right: 10%; height: 40%;
                    border-radius: 0 0 inherit inherit;
                    background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
                    pointer-events: none; z-index: 4;
                }

                /* ── Content Layer ───────────────────────────────────────────────────── */
                .xiv-glass-content {
                    position: relative;
                    z-index: 6;
                    display: inline-flex;
                    align-items: center;
                    gap: 0.5em;
                    padding: 0.4em 0.75em;
                    color: rgba(255, 255, 255, 0.96);
                    filter: drop-shadow(0 0 0.25em rgba(0,0,0,0.65)) drop-shadow(0 0.06em 0.19em rgba(0,0,0,0.50));
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }

                /* Inner interactive elements */
                .xiv-drag-handle {
                    cursor: grab;
                    padding: 0.4em 0.2em;
                    display: flex;
                    align-items: center;
                    opacity: 0.65;
                    transition: opacity 0.2s;
                }
                .xiv-drag-handle:hover { opacity: 1; }
                .xiv-drag-handle:active { cursor: grabbing; }

                .xiv-data-display {
                    display: flex;
                    align-items: center;
                    gap: 0.55em;
                    padding: 0.25em 0.55em;
                    border-radius: 9999px;
                    font-size: 0.95em;
                    font-weight: 600;
                    letter-spacing: -0.02em;
                    cursor: pointer;
                    user-select: none;
                    transition: background 0.2s ease;
                }
                .xiv-data-display:hover { background: rgba(255, 255, 255, 0.1); }

                .xiv-indicator {
                    width: 0.5em;
                    height: 0.5em;
                    border-radius: 50%;
                    background-color: rgb(var(--xiv-current-status-rgb));
                    box-shadow: 0 0 0.6em 0.1em rgb(var(--xiv-current-status-rgb));
                    transition: all 0.4s ease;
                    flex-shrink: 0;
                }
                .xiv-indicator.scanning { animation: xiv-pulse-status 1.6s infinite; }

                .xiv-data-text {
                    white-space: nowrap;
                }

                .xiv-divider {
                    width: 1px;
                    height: 1em;
                    background: rgba(255, 255, 255, 0.25);
                    margin: 0 0.1em;
                }

                .xiv-btn {
                    background: transparent;
                    color: rgba(255,255,255,0.75);
                    border: none;
                    padding: 0.4em;
                    border-radius: 9999px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }
                .xiv-btn:hover { background: rgba(255, 255, 255, 0.15); color: #ffffff; }
                .xiv-btn:active { transform: scale(0.92); }

                @keyframes xiv-spin { 100% { transform: rotate(360deg); } }
                .xiv-spin svg { animation: xiv-spin 1s linear infinite; }

                /* Strict isolated Toast styling - Protected against host CSS bleed */
                .xiv-toast {
                    all: initial !important;
                    position: fixed !important;
                    bottom: clamp(10px, 4vh, 24px) !important;
                    left: 50% !important;
                    transform: translateX(-50%) translateY(20px) !important;
                    padding: 0.6rem 1.2rem !important;
                    border-radius: 9999px !important;
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                    font-size: 13px !important;
                    line-height: 1.5 !important;
                    font-weight: 500 !important;
                    z-index: ${CONFIG.UI.Z_INDEX + 1} !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 10px !important;
                    background: rgba(15, 23, 42, 0.92) !important;
                    backdrop-filter: blur(12px) !important;
                    -webkit-backdrop-filter: blur(12px) !important;
                    color: #fff !important;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
                    border: 1px solid rgba(255, 255, 255, 0.08) !important;
                    box-sizing: border-box !important;
                    min-height: 0 !important;
                    min-width: 0 !important;
                    width: auto !important;
                    height: auto !important;
                    white-space: nowrap !important;
                }
                .xiv-toast.xiv-show {
                    opacity: 1 !important;
                    transform: translateX(-50%) translateY(0) !important;
                }
                .xiv-toast span {
                    all: unset !important;
                    font-family: inherit !important;
                    font-size: inherit !important;
                    font-weight: inherit !important;
                    color: inherit !important;
                    line-height: inherit !important;
                }
                .xiv-toast svg {
                    width: 16px !important;
                    height: 16px !important;
                    min-width: 16px !important;
                    min-height: 16px !important;
                    margin: 0 !important;
                }
            `);
        },

        buildWidget() {
            this.els.scope = Utils.el('div', 'xiv-glass-scope status-scanning');
            this.els.shell = Utils.el('div', 'xiv-glass-shell');

            this.els.lens = Utils.el('div', 'xiv-glass-lens');
            this.els.scatter = Utils.el('div', 'xiv-glass-scatter');
            this.els.chroma = Utils.el('div', 'xiv-glass-chroma');
            this.els.rim = Utils.el('div', 'xiv-glass-rim');
            this.els.content = Utils.el('div', 'xiv-glass-content');

            this.els.dragHandle = Utils.el('div', 'xiv-drag-handle');
            this.els.dragHandle.title = 'Drag to move (Double-Click to Reset)';
            this.els.dragHandle.setAttribute('tabindex', '0');
            this.els.dragHandle.appendChild(Utils.createSvgIcon(CONFIG.ICONS.DRAG_HANDLE));

            this.els.dataDisplay = Utils.el('div', 'xiv-data-display');
            this.els.indicator = Utils.el('div', 'xiv-indicator scanning');
            this.els.dataText = Utils.el('span', 'xiv-data-text', 'SCANNING...');
            this.els.dataDisplay.append(this.els.indicator, this.els.dataText);

            this.els.divider = Utils.el('div', 'xiv-divider');

            this.els.copyBtn = Utils.el('button', 'xiv-btn');
            this.els.copyBtn.title = 'Copy Extracted Data';
            this.els.copyBtn.appendChild(Utils.createSvgIcon(CONFIG.ICONS.COPY));

            this.els.refreshBtn = Utils.el('button', 'xiv-btn');
            this.els.refreshBtn.title = 'Force Re-scan';
            this.els.refreshBtn.appendChild(Utils.createSvgIcon(CONFIG.ICONS.REFRESH));

            this.els.content.append(
                this.els.dragHandle,
                this.els.dataDisplay,
                this.els.divider,
                this.els.copyBtn,
                this.els.refreshBtn
            );

            this.els.shell.append(
                this.els.lens,
                this.els.scatter,
                this.els.chroma,
                this.els.rim,
                this.els.content
            );

            this.els.scope.append(this.els.shell);
            document.body.appendChild(this.els.scope);

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

            this.initDraggable(this.els.scope, this.els.dragHandle);
        },

        buildToast() {
            this.els.toast = Utils.el('div', 'xiv-toast');
            this.els.toastIcon = Utils.createSvgIcon(CONFIG.ICONS.SUCCESS, "currentColor");
            this.els.toastText = Utils.el('span');
            this.els.toast.append(this.els.toastIcon, this.els.toastText);
            document.body.appendChild(this.els.toast);
        },

        ensureInDOM() {
            if (!this.els.scope) return;
            if (!document.body.contains(this.els.scope)) document.body.appendChild(this.els.scope);
            if (!document.body.contains(this.els.toast)) document.body.appendChild(this.els.toast);
        },

        applyTheme(themeObj) {
            if (!themeObj) return;
            const root = document.documentElement;
            root.style.setProperty('--xiv-accent', themeObj.accent);
            root.style.setProperty('--xiv-accent-rgb', Utils.hexToRgb(themeObj.accent));
        },

        loadSafePosition() {
            const pos = Storage.getPosition();
            if (pos.x !== null && pos.y !== null) {
                requestAnimationFrame(() => {
                    const width = this.els.scope.offsetWidth || 300;
                    const height = this.els.scope.offsetHeight || 50;

                    const safeX = Math.max(0, Math.min(pos.x, window.innerWidth - width));
                    const safeY = Math.max(0, Math.min(pos.y, window.innerHeight - height));

                    this.els.scope.style.left = `${safeX}px`;
                    this.els.scope.style.top = `${safeY}px`;
                    this.els.scope.classList.add('xiv-dragged');
                });
            }
        },

        resetPosition() {
            this.els.scope.classList.remove('xiv-dragged');
            this.els.scope.style.left = '50%';
            this.els.scope.style.top = 'clamp(10px, 2vh, 40px)';
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
                document.body.classList.remove('xiv-dragging-global');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.removeEventListener('touchmove', onMouseMove);
                document.removeEventListener('touchend', onMouseUp);
                Storage.setPosition(parseInt(el.style.left, 10), parseInt(el.style.top, 10));
            };
            const onMouseDown = (e) => {
                this.isDragging = true;
                document.body.classList.add('xiv-dragging-global');

                if (!el.classList.contains('xiv-dragged')) {
                    const rect = el.getBoundingClientRect();
                    el.style.left = `${rect.left}px`;
                    el.style.top = `${rect.top}px`;
                    el.classList.add('xiv-dragged');
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
                this.els.scope.classList.add('is-visible');
                if (State.themeConfig) this.applyTheme(State.themeConfig);
            } else {
                this.els.scope.classList.remove('is-visible');
            }
        },

        updateStatus(state, tickets = '', revenue = '') {
            this.ensureInDOM();
            this.els.scope.classList.remove('status-scanning', 'status-green', 'status-yellow', 'status-red');
            this.els.indicator.className = 'xiv-indicator';

            if (state === 'scanning') {
                this.els.refreshBtn.classList.add('xiv-spin');
                this.els.dataText.textContent = "SCANNING...";
                this.els.scope.classList.add('status-scanning');
                this.els.indicator.classList.add('scanning');
            } else if (state === 'not_found') {
                this.els.refreshBtn.classList.remove('xiv-spin');
                this.els.dataText.textContent = "NOT FOUND";
                this.els.scope.classList.add('status-red');
            } else if (state === 'found') {
                this.els.refreshBtn.classList.remove('xiv-spin');
                const tVal = Utils.parseNum(tickets);
                const rVal = Utils.parseNum(revenue);

                let statusText = "";
                if (tVal === 0 && rVal === 0) {
                    this.els.scope.classList.add('status-red');
                    statusText = "NO SALES";
                } else if (tVal > 0 && rVal === 0) {
                    this.els.scope.classList.add('status-yellow');
                    statusText = "FREE TICKETS";
                } else {
                    this.els.scope.classList.add('status-green');
                    statusText = "WITH SALES";
                }

                this.els.dataText.textContent = `${statusText} • ${tickets} sold • ${revenue}`;
            }
        },

        showToast(message, type = 'success') {
            this.ensureInDOM();
            const iconColor = type === 'success' ? 'rgba(var(--status-rgb-green), 1)' : 'rgba(var(--status-rgb-red), 1)';
            const iconPath = type === 'success' ? CONFIG.ICONS.SUCCESS : CONFIG.ICONS.ERROR;

            this.els.toastIcon.setAttribute('stroke', iconColor);
            this.els.toastIcon.querySelector('path').setAttribute('d', iconPath);
            this.els.toastText.textContent = message;
            this.els.toast.style.setProperty('border-left', `3px solid ${iconColor}`, 'important');

            // Force reflow to reset CSS animation state on spam clicks
            this.els.toast.classList.remove('xiv-show');
            void this.els.toast.offsetWidth;
            this.els.toast.classList.add('xiv-show');

            AudioNotifier.play(type);

            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => {
                if (this.els.toast) this.els.toast.classList.remove('xiv-show');
            }, CONFIG.TIMING.TOAST_DURATION_MS);
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
                if (!data) data = State.activeModule.extract(State.observedRoot || document);
                const url = window.location.href;

                const tVal = Utils.parseNum(data.tickets);
                const rVal = Utils.parseNum(data.revenue);

                const fourthCol = data.freeTickets ?? (tVal > 0 ? (rVal === 0 ? data.tickets : CONFIG.DEFAULTS.TEXT_CHECK_FREE) : '0');

                const rawString = `${url}\t${data.tickets}\t${data.revenue}\t${fourthCol}`;
                await this.performClipboardWrite(rawString);

                UI.showToast(`Copied! ${data.tickets} tickets - ${data.revenue}`, 'success');
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
            State.scanTimer = setTimeout(() => this.scanPage(), CONFIG.TIMING.DEBOUNCE_MS);
        },

        startPolling() {
            State.pollCount = 0;
            UI.updateStatus('scanning');
            this.schedulePoll();
        },

        schedulePoll() {
            if (State.hasFetchedData) return;
            if (State.pollCount >= CONFIG.TIMING.POLL_MAX_ATTEMPTS) {
                Logger.warn("Observer", "Poll limit reached. Data not found.");
                UI.updateStatus('not_found');
                return;
            }

            State.pollCount++;
            const delay = Math.min(CONFIG.TIMING.POLL_BASE_DELAY_MS * Math.pow(CONFIG.TIMING.POLL_MULTIPLIER, State.pollCount), 10000);

            State.pollTimer = setTimeout(() => {
                if (!State.hasFetchedData) {
                    this.scanPage();
                    this.schedulePoll();
                }
            }, delay);
        },

        scanPage() {
            const root = State.observedRoot || document;

            if (!State.activeModule) {
                State.activeModule = CONFIG.SITES.find(mod => State.currentUrl.includes(mod.domain) && mod.check(root));
                if (State.activeModule) {
                    if (State.activeModule.theme) State.themeConfig = State.activeModule.theme;
                    this.updateObservationRoot();
                }
            }

            UI.updateVisibility(!!State.activeModule);

            if (State.activeModule) {
                try {
                    const data = State.activeModule.extract(State.observedRoot || document);
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
            Logger.log("Bootstrap", `Initializing Version ${CONFIG.VERSION}`);
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
