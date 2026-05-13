// ==UserScript==
// @name         Event Sales Extractor
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.eventbrite.com/favicon.ico
// @version      4.6
// @description  Extracts and copies ticket sales and revenue data from various event management dashboards.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @match        *://*.posh.vip/*
// @match        *://*.ra.co/pro/events/*/tickets/management
// @match        *://*.eventim.us/*
// @match        *://*.boletosexpress.com/*
// @match        *://*.tickeri.com/*
// @updateURL    https://myouisaur.github.io/Work_CN/event-sales-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/event-sales-extractor.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Prevent duplicate initialization in SPAs
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
        HISTORY_LIMIT: 5,
        COLORS: {
            RED: '#ef4444',
            YELLOW: '#f59e0b',
            GREEN: '#10b981'
        }
    };

    const State = {
        currentUrl: window.location.href,
        activeModule: null,
        hasFetchedData: false,
        pollCount: 0,
        pollTimer: null,
        scanTimer: null,
        history: JSON.parse(sessionStorage.getItem('uese_history') || '[]'),
        theme: localStorage.getItem('uese_theme') || 'dark'
    };

    // ============================================================================
    // 2. UTILITIES & LOGGER
    // ============================================================================

    const Logger = {
        log: (msg, ...args) => CONFIG.DEBUG && console.log(`[UESE] 🔵 ${msg}`, ...args),
        warn: (msg, ...args) => CONFIG.DEBUG && console.warn(`[UESE] 🟠 ${msg}`, ...args),
        error: (msg, ...args) => console.error(`[UESE] 🔴 ${msg}`, ...args),
    };

    const Utils = {
        parseNum: (str) => {
            if (!str) return 0;
            return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
        },
        createSvgIcon: (pathData, viewBox = "0 0 24 24") => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', viewBox);
            svg.setAttribute('width', '18');
            svg.setAttribute('height', '18');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            svg.appendChild(path);
            return svg;
        },
        saveHistory: (entry) => {
            State.history.unshift(entry);
            if (State.history.length > CONFIG.HISTORY_LIMIT) State.history.pop();
            sessionStorage.setItem('uese_history', JSON.stringify(State.history));
            UI.renderHistory();
        }
    };

    // ============================================================================
    // 3. SITE MODULES (Extraction Logic)
    // ============================================================================

    const siteModules = [
        {
            name: 'Eventbrite',
            domain: 'eventbrite.com',
            check: () => {
                // Strict Visual Match: Requires exact text, preventing "Total Tickets Sold" from triggering.
                const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, strong, b');
                const hasExactTicketsSold = Array.from(nodes).some(el => el.children.length === 0 && el.textContent.trim() === 'Tickets Sold');

                // Legacy Match check
                const legacyNodes = document.querySelectorAll('[data-testid="amount-card-title"]');
                const hasLegacyTitle = Array.from(legacyNodes).some(el => el.innerText.trim() === 'Tickets Sold');

                return hasExactTicketsSold || hasLegacyTitle;
            },
            extract: () => {
                let ticketsSold = '', netSales = '', freeTickets = undefined;

                const findCardByText = (targetText) => {
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

                const tixCard = findCardByText('Tickets Sold');
                if (tixCard) {
                    const tixMatch = tixCard.innerText.match(/(\d+)\s*\/\s*\d+/);
                    if (tixMatch) ticketsSold = tixMatch[1];

                    const freeMatch = tixCard.innerText.match(/(\d+)\s*free/i);
                    if (freeMatch) freeTickets = freeMatch[1];
                }

                const salesCard = findCardByText('Net Sales');
                if (salesCard) {
                    const moneyMatch = salesCard.innerText.match(/[$£€]\s*[\d,.]+/);
                    if (moneyMatch) netSales = moneyMatch[0];
                }

                if (!ticketsSold || !netSales) {
                    const titles = document.querySelectorAll('[data-testid="amount-card-title"]');
                    titles.forEach(titleElem => {
                        const titleText = titleElem.innerText.trim();
                        let card = titleElem.closest('div[class*="AmountCard"]')?.parentElement;
                        if (!card) card = titleElem.parentElement?.parentElement;
                        if (!card) return;

                        const valueElem = card.querySelector('[data-testid="amount-card-value"] p') || card.querySelector('[data-testid="amount-card-value"]') || card.querySelector('span');

                        if (titleText === "Tickets Sold" && !ticketsSold) {
                            const rawText = valueElem ? valueElem.innerText.trim() : '';
                            ticketsSold = rawText.split('/')[0].trim();
                            const freeMatch = card.innerText.match(/(\d+)\s*free/i);
                            if (freeMatch) freeTickets = freeMatch[1];
                        }
                        if (titleText === "Net Sales" && !netSales) {
                            netSales = valueElem ? valueElem.innerText.trim() : '';
                        }
                    });
                }

                if (!netSales) netSales = '$0';
                if (!ticketsSold) throw new Error("Eventbrite metrics not found. DOM might still be loading.");

                return { tickets: ticketsSold, revenue: netSales, freeTickets };
            }
        },
        {
            name: 'Posh',
            domain: 'posh.vip',
            check: () => !!document.querySelector('div.CrossSection__w3a2U'),
            extract: () => {
                let ticketsSold = '', totalRevenue = '0';
                document.querySelectorAll('div.CrossSection__w3a2U').forEach(div => {
                    const label = div.querySelector('p')?.innerText.trim();
                    if (label === "Total Tickets Sold" || label === "Total RSVPs") ticketsSold = div.querySelector('h3')?.innerText.trim();
                    if (label === "Total Revenue" || label === "Revenue") totalRevenue = div.querySelector('h3')?.innerText.trim();
                });
                if (!ticketsSold && totalRevenue === '0') throw new Error("Data missing.");
                return { tickets: ticketsSold, revenue: totalRevenue };
            }
        },
        {
            name: 'Resident Advisor',
            domain: 'ra.co',
            check: () => !!document.querySelector('span[color="primary"]'),
            extract: () => {
                let tickets = '0', revenue = '$0';
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
            check: () => !!document.querySelector('#table table'),
            extract: () => {
                const dataRow = document.querySelectorAll('#table table tr')[1];
                if (!dataRow) throw new Error("Data row missing.");
                const cells = dataRow.querySelectorAll('td');
                return { tickets: cells[0]?.innerText.trim() || '0', revenue: cells[cells.length - 1]?.innerText.trim() || '$0' };
            }
        },
        {
            name: 'Boletos Express',
            domain: 'boletosexpress.com',
            check: () => !!document.querySelector('#audit'),
            extract: () => {
                let tickets = '0';
                document.querySelectorAll('#audit dl').forEach(dl => {
                    if (dl.querySelector('dt')?.innerText.includes('Tickets Distributed')) {
                        tickets = dl.querySelector('dd b')?.innerText.trim() || '0';
                    }
                });
                const revElem = document.querySelector('#revenue_total b');
                return { tickets, revenue: revElem ? revElem.innerText.trim() : '$0.00' };
            }
        },
        {
            name: 'Tickeri',
            domain: 'tickeri.com',
            check: () => document.body.innerText.includes('Ticket Inventory'),
            extract: () => {
                let tickets = '0', revenue = '$0.00';
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
    // 4. UI & PRESENTATION
    // ============================================================================

    const UI = {
        els: {},
        isDragging: false,

        init() {
            this.injectStyles();
            this.buildWidget();
            this.buildHistoryPanel();
            this.buildToast();
            this.applyTheme(State.theme);
        },

        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                :root {
                    --uese-bg: #1e293b;
                    --uese-btn-bg: #334155;
                    --uese-btn-hover: #475569;
                    --uese-text: #f8fafc;
                    --uese-border: rgba(255,255,255,0.1);
                    --uese-shadow: 0 10px 25px -5px rgba(0,0,0,0.4);
                    --uese-history-hover: #334155;
                }
                .uese-theme-light {
                    --uese-bg: #ffffff;
                    --uese-btn-bg: #f1f5f9;
                    --uese-btn-hover: #e2e8f0;
                    --uese-text: #0f172a;
                    --uese-border: rgba(0,0,0,0.1);
                    --uese-shadow: 0 10px 25px -5px rgba(0,0,0,0.15);
                    --uese-history-hover: #f8fafc;
                }
                .uese-widget {
                    position: fixed; top: 20px; left: 50%; z-index: ${CONFIG.UI_Z_INDEX};
                    display: flex; align-items: center; gap: 6px;
                    background: var(--uese-bg); padding: 6px; border-radius: 12px;
                    box-shadow: var(--uese-shadow); border: 1px solid var(--uese-border);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    opacity: 0; pointer-events: none; transform: translateX(-50%) scale(0.95);
                    transition: opacity 0.3s, transform 0.3s; color: var(--uese-text);
                }
                .uese-widget.uese-visible { opacity: 1; pointer-events: auto; transform: translateX(-50%) scale(1); }
                .uese-widget.uese-dragged { transform: scale(1); }
                .uese-drag-handle { cursor: grab; padding: 8px 4px; display: flex; align-items: center; color: var(--uese-text); opacity: 0.5; transition: opacity 0.2s; }
                .uese-drag-handle:hover { opacity: 1; }
                .uese-drag-handle:active { cursor: grabbing; }
                .uese-btn { background: var(--uese-btn-bg); color: var(--uese-text); border: 1px solid var(--uese-border); padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.2s, transform 0.1s; min-height: 40px; }
                .uese-btn:hover { background: var(--uese-btn-hover); }
                .uese-btn:active { transform: scale(0.96); }
                .uese-btn.uese-icon-only { padding: 10px; }
                .uese-status-dot { width: 10px; height: 10px; border-radius: 50%; background: ${CONFIG.COLORS.RED}; box-shadow: 0 0 6px currentColor; transition: background 0.3s; }
                .uese-history-panel { position: fixed; width: 300px; background: var(--uese-bg); color: var(--uese-text); border: 1px solid var(--uese-border); border-radius: 12px; box-shadow: var(--uese-shadow); z-index: ${CONFIG.UI_Z_INDEX}; padding: 16px; font-family: sans-serif; opacity: 0; pointer-events: none; transition: opacity 0.2s ease, top 0.2s, bottom 0.2s, left 0.2s; }
                .uese-history-panel.uese-open { opacity: 1; pointer-events: auto; }
                .uese-history-header { font-weight: bold; margin-bottom: 12px; border-bottom: 1px solid var(--uese-border); padding-bottom: 8px; display: flex; justify-content: space-between; }
                .uese-history-item { font-size: 13px; padding: 10px; border-bottom: 1px solid var(--uese-border); cursor: pointer; display: flex; justify-content: space-between; transition: background 0.2s; border-radius: 6px; margin-bottom: 4px; }
                .uese-history-item:hover { background: var(--uese-history-hover); }
                .uese-history-item:last-child { border-bottom: none; margin-bottom: 0; }
                .uese-history-domain { opacity: 0.6; font-size: 11px; margin-top: 2px;}
                .uese-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--uese-bg); color: var(--uese-text); padding: 12px 24px; border-radius: 8px; font-family: sans-serif; font-size: 14px; font-weight: 500; z-index: ${CONFIG.UI_Z_INDEX + 1}; opacity: 0; pointer-events: none; transition: all 0.3s ease; border: 1px solid var(--uese-border); box-shadow: var(--uese-shadow); display: flex; align-items: center; gap: 12px; }
                .uese-toast.uese-show { opacity: 1; transform: translateX(-50%) translateY(0); }
                .uese-toast-success { border-left: 4px solid ${CONFIG.COLORS.GREEN}; }
                .uese-toast-error { border-left: 4px solid ${CONFIG.COLORS.RED}; }
            `;
            document.head.appendChild(style);
        },

        buildWidget() {
            this.els.wrapper = document.createElement('div');
            this.els.wrapper.className = 'uese-widget';

            this.els.dragHandle = document.createElement('div');
            this.els.dragHandle.className = 'uese-drag-handle';
            this.els.dragHandle.title = 'Drag to move (Double-Click to Reset)';
            this.els.dragHandle.appendChild(Utils.createSvgIcon("M9 5h2v2H9V5zm0 6h2v2H9v-2zm0 6h2v2H9v-2zm4-12h2v2h-2V5zm0 6h2v2h-2v-2zm0 6h2v2h-2v-2z"));

            this.els.copyBtn = document.createElement('button');
            this.els.copyBtn.className = 'uese-btn';
            this.els.copyBtn.title = 'Copy Stats (Shift+Click for JSON)';
            this.els.copyBtn.appendChild(Utils.createSvgIcon("M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"));
            const btnText = document.createElement('span');
            btnText.textContent = "Copy Stats";
            this.els.copyBtn.appendChild(btnText);
            this.els.dot = document.createElement('div');
            this.els.dot.className = 'uese-status-dot';
            this.els.copyBtn.appendChild(this.els.dot);

            this.els.themeBtn = document.createElement('button');
            this.els.themeBtn.className = 'uese-btn uese-icon-only';
            this.els.themeBtn.title = 'Toggle Dark/Light Mode';
            this.els.themeBtn.appendChild(Utils.createSvgIcon("M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"));

            this.els.refreshBtn = document.createElement('button');
            this.els.refreshBtn.className = 'uese-btn uese-icon-only';
            this.els.refreshBtn.title = 'Force Re-scan';
            this.els.refreshBtn.appendChild(Utils.createSvgIcon("M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"));

            this.els.historyBtn = document.createElement('button');
            this.els.historyBtn.className = 'uese-btn uese-icon-only';
            this.els.historyBtn.title = 'View Recent History';
            this.els.historyBtn.appendChild(Utils.createSvgIcon("M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"));

            this.els.wrapper.append(this.els.dragHandle, this.els.copyBtn, this.els.themeBtn, this.els.refreshBtn, this.els.historyBtn);
            document.body.appendChild(this.els.wrapper);

            this.loadSafePosition();

            this.els.copyBtn.addEventListener('click', (e) => Extractor.executeCopy(e.shiftKey));
            this.els.refreshBtn.addEventListener('click', () => App.resetAndScan(true));
            this.els.historyBtn.addEventListener('click', () => this.toggleHistory());
            this.els.themeBtn.addEventListener('click', () => this.toggleTheme());
            this.els.dragHandle.addEventListener('dblclick', () => this.resetPosition());

            this.initDraggable(this.els.wrapper, this.els.dragHandle);
        },

        ensureInDOM() {
            if (!this.els.wrapper) return;
            if (!document.body.contains(this.els.wrapper)) document.body.appendChild(this.els.wrapper);
            if (!document.body.contains(this.els.historyPanel)) document.body.appendChild(this.els.historyPanel);
            if (!document.body.contains(this.els.toast)) document.body.appendChild(this.els.toast);
        },

        loadSafePosition() {
            const savedX = parseInt(localStorage.getItem('uese_pos_x'), 10);
            const savedY = parseInt(localStorage.getItem('uese_pos_y'), 10);

            if (!isNaN(savedX) && !isNaN(savedY)) {
                const safeX = Math.max(0, Math.min(savedX, window.innerWidth - 350));
                const safeY = Math.max(0, Math.min(savedY, window.innerHeight - 60));

                this.els.wrapper.style.left = `${safeX}px`;
                this.els.wrapper.style.top = `${safeY}px`;
                this.els.wrapper.classList.add('uese-dragged');
            }
        },

        resetPosition() {
            this.els.wrapper.classList.remove('uese-dragged');
            this.els.wrapper.style.left = '50%';
            this.els.wrapper.style.top = '20px';
            localStorage.removeItem('uese_pos_x');
            localStorage.removeItem('uese_pos_y');
            this.showToast("Position Reset", "success");
            this.positionHistoryPanel();
        },

        initDraggable(el, handle) {
            let startX, startY, initialX, initialY;

            const onMouseMove = (e) => {
                if (!this.isDragging) return;

                const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
                const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;

                let newX = initialX + (clientX - startX);
                let newY = initialY + (clientY - startY);

                newX = Math.max(0, Math.min(newX, window.innerWidth - el.offsetWidth));
                newY = Math.max(0, Math.min(newY, window.innerHeight - el.offsetHeight));

                el.style.left = `${newX}px`;
                el.style.top = `${newY}px`;

                this.positionHistoryPanel();
            };

            const onMouseUp = () => {
                if (!this.isDragging) return;
                this.isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.removeEventListener('touchmove', onMouseMove);
                document.removeEventListener('touchend', onMouseUp);

                el.style.transition = 'opacity 0.3s, transform 0.3s';

                localStorage.setItem('uese_pos_x', parseInt(el.style.left, 10));
                localStorage.setItem('uese_pos_y', parseInt(el.style.top, 10));
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

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                document.addEventListener('touchmove', onMouseMove, { passive: false });
                document.addEventListener('touchend', onMouseUp);

                if(e.type === 'mousedown') e.preventDefault();
            };

            handle.addEventListener('mousedown', onMouseDown);
            handle.addEventListener('touchstart', onMouseDown, { passive: false });
        },

        buildHistoryPanel() {
            this.els.historyPanel = document.createElement('div');
            this.els.historyPanel.className = 'uese-history-panel';
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
            let idealLeft = widgetRect.left + (widgetRect.width / 2) - 150;
            idealLeft = Math.max(10, Math.min(idealLeft, window.innerWidth - 310));
            this.els.historyPanel.style.left = `${idealLeft}px`;
            this.els.historyPanel.style.right = 'auto';
        },

        buildToast() {
            this.els.toast = document.createElement('div');
            this.els.toast.className = 'uese-toast';
            document.body.appendChild(this.els.toast);
        },

        toggleTheme() {
            State.theme = State.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('uese_theme', State.theme);
            this.applyTheme(State.theme);
        },

        applyTheme(theme) {
            const elements = [this.els.wrapper, this.els.historyPanel, this.els.toast];
            elements.forEach(el => {
                if (!el) return;
                if (theme === 'light') el.classList.add('uese-theme-light');
                else el.classList.remove('uese-theme-light');
            });
        },

        toggleHistory() {
            const isOpen = this.els.historyPanel.classList.toggle('uese-open');
            if (isOpen) {
                this.positionHistoryPanel();
                this.renderHistory();
            }
        },

        renderHistory() {
            this.els.historyPanel.innerHTML = '<div class="uese-history-header"><span>Recent Extractions</span></div>';
            if (State.history.length === 0) {
                this.els.historyPanel.innerHTML += '<div style="opacity:0.5; font-size: 12px; text-align: center; padding: 10px;">No recent data</div>';
                return;
            }
            State.history.forEach(item => {
                const row = document.createElement('div');
                row.className = 'uese-history-item';
                row.innerHTML = `
                    <div>
                        <div style="font-weight: 500;">${item.tickets} Tix - ${item.revenue}</div>
                        <div class="uese-history-domain">${new URL(item.url).hostname}</div>
                    </div>
                    <div style="opacity:0.5; font-size: 16px; display:flex; align-items:center;">📋</div>
                `;
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
            } else {
                this.els.wrapper.classList.remove('uese-visible');
                this.els.historyPanel.classList.remove('uese-open');
            }
        },

        updateStatus(tickets, revenue) {
            this.ensureInDOM();
            const tVal = Utils.parseNum(tickets);
            const rVal = Utils.parseNum(revenue);

            let color = CONFIG.COLORS.GREEN;
            if (tVal === 0 && rVal === 0) color = CONFIG.COLORS.RED;
            else if (tVal > 0 && rVal === 0) color = CONFIG.COLORS.YELLOW;

            this.els.dot.style.backgroundColor = color;
            this.els.dot.style.color = color;
        },

        showToast(message, type = 'success') {
            this.ensureInDOM();
            this.els.toast.textContent = message;
            this.els.toast.className = `uese-toast uese-show uese-toast-${type}`;
            this.applyTheme(State.theme);

            if (this.els.toast.svg) this.els.toast.svg.remove();
            const iconStr = type === 'success'
                ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                : "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";

            this.els.toast.prepend(Utils.createSvgIcon(iconStr));

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
                Utils.saveHistory(exportData);

                UI.showToast(`Copied! ${data.tickets} tix - ${data.revenue}`, 'success');
                UI.updateStatus(data.tickets, data.revenue);
            } catch (err) {
                Logger.error("Extraction failed", err);
                UI.showToast(err.message || "Failed to extract data.", 'error');
            }
        },

        async performClipboardWrite(text) {
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    throw new Error("Clipboard API unavailable");
                }
            } catch (err) {
                Logger.warn("Falling back to execCommand");
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                const res = document.execCommand('copy');
                document.body.removeChild(ta);
                if (!res) throw new Error("Fallback clipboard failed");
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
                this.domObserver.observe(document.body, { childList: true, subtree: true });
            }
            this.startPolling();
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
            this.schedulePoll();
        },
        schedulePoll() {
            if (State.hasFetchedData || State.pollCount >= CONFIG.POLL_MAX_ATTEMPTS) return;
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
            }
            UI.updateVisibility(!!State.activeModule);
            if (State.activeModule && !State.hasFetchedData) {
                try {
                    const data = State.activeModule.extract();
                    if (data.tickets || data.revenue) {
                        UI.updateStatus(data.tickets, data.revenue);
                        State.hasFetchedData = true;
                        this.stopPolling();
                    }
                } catch (e) {
                    Logger.warn("Elements found, but data not ready yet.");
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
            Logger.log("Initializing Version 4.6");
            UI.init();
            Router.init();
            Observer.start();
        },
        resetAndScan(force = false) {
            State.currentUrl = window.location.href;
            State.activeModule = null;
            State.hasFetchedData = false;
            if (force) UI.showToast("Re-scanning dashboard...", "success");
            Observer.stopPolling();
            Observer.startPolling();
            Observer.scanPage();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }

})();
