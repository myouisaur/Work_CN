// ==UserScript==
// @name         [RA] Advanced Navigation
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon.svg
// @version      6.0
// @description  Highlights active ticket sales site-wide and adds a floating date jump menu on pro event pages.
// @author       Xiv
// @match        *://*.ra.co/*
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Work_CN/RA/advanced-navigation.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA/advanced-navigation.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Duplicate execution guard for SPA stability (per frame)
    if (window.xivInitialized) return;
    window.xivInitialized = true;

    // ==========================================
    // CONFIGURATION & CONSTANTS
    // ==========================================
    const CONFIG = {
        // Feature Flags
        FLAGS: {
            DEBUG: false // Set to true to view structured console logs
        },

        // Routes
        MAIN_EVENTS_PATH: "/pro/events",
        ALLOWED_ORIGIN_SUFFIX: "ra.co",

        // Selectors
        SELECTORS: {
            ROW_OLD: "li.myEvents",
            ROW_NEW: "ul[role='button']",
            IFRAME_OLD: "#iFrameResizer0",
            DATE_HEADER_OLD: "li.clearfix.f28",
            DATE_HEADER_NEW: "h2",
            TAB_BUTTONS: "button[role='tab']"
        },

        // Storage Keys
        STORAGE_FILTER_KEY: "xiv_sales_filtered",

        // Strings
        STRINGS: {
            EMPTY_SALES: "No active sales in this period.",
            TOGGLE_LABEL: "Active Sales Only",
            FAB_OPEN: "Jump to Date",
            FAB_CLOSE: "Close",
            BTN_TITLE_MOD: "Middle-click or Ctrl/Cmd-click to open Ticket Management in a new tab"
        },

        // UI Z-Index & Colors
        Z_INDEX: {
            OVERLAY: 2147483647
        },
        COLORS: {
            RA_RED: "#ff4848",
            TEXT_DARK: "#151515",
            ROW_MINT: "#90e0b4",
            VENUE_BLUE: "#1e3a8a"
        },

        // Timing & Animation
        TIMING: {
            SCROLL_OFFSET: 100,
            SCROLL_DURATION: 800,
            STICKY_FADE_THRESHOLD: 150,
            DEBOUNCE: 100,
            ANIMATION: 300,
            STAGGER: 30
        }
    };

    const ICONS = {
        CALENDAR: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
        CLOSE: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
    };

    // ==========================================
    // UTILITIES
    // ==========================================
    const Logger = {
        log: (msg, data = '') => { if (CONFIG.FLAGS.DEBUG) console.log(`[RA Pro Tools] ${msg}`, data); },
        warn: (msg, err) => { if (CONFIG.FLAGS.DEBUG) console.warn(`[RA Pro Tools] ${msg}`, err); }
    };

    const SafeStorage = {
        getBool: (key, defaultValue = false) => {
            try {
                const val = sessionStorage.getItem(key);
                return val !== null ? val === 'true' : defaultValue;
            }
            catch (e) {
                Logger.warn('Storage read failed. Privacy settings may be blocking it.', e);
                return defaultValue;
            }
        },
        set: (key, value) => {
            try { sessionStorage.setItem(key, value); }
            catch (e) { Logger.warn('Storage write failed.', e); }
        }
    };

    const isMainEventsPage = () => {
        return window.location.pathname.replace(/\/$/, '') === CONFIG.MAIN_EVENTS_PATH;
    };

    // ==========================================
    // APP STATE
    // ==========================================
    const state = {
        isTopWindow: window.top === window.self,
        jumper: {
            headers: [],
            isOpen: false,
            isTicking: false,
            resizeTimer: null,
            mutationTimer: null,
            scrollAnimId: null,
            lastStickyText: '',
            lastScrollY: 0,
            boundHandlers: {}, // Cached references for SPA teardown
            elements: { container: null, menu: null, menuList: null, btn: null, stickyHeader: null }
        },
        highlighter: {
            debounceTimer: null,
            observer: null,
            animId: 0
        }
    };

    // ==========================================
    // UNIFIED STYLING INJECTION
    // ==========================================
    function injectStyles() {
        if (document.getElementById('xiv-global-styles')) return;

        const style = document.createElement('style');
        style.id = 'xiv-global-styles';
        style.textContent = `
            /* --- GLOBAL UTILITIES --- */
            #cookiescript_badge { display: none !important; }
            .xiv-native-font { font-family: RobotoMono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important; }

            /* --- DATE JUMPER UI (Bottom Left) --- */
            #xiv-date-jumper-container {
                position: fixed;
                bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom));
                left: clamp(16px, 3vw, 32px);
                z-index: ${CONFIG.Z_INDEX.OVERLAY};
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }

            .xiv-fab-btn {
                background-color: #ffffff !important;
                border: 1px solid ${CONFIG.COLORS.RA_RED} !important;
                color: ${CONFIG.COLORS.TEXT_DARK} !important;
                padding: 10px 18px !important;
                border-radius: 50px !important;
                font-size: 11px !important;
                font-weight: 500 !important;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08) !important;
                transition: all 0.2s ease-in-out !important;
                outline: none;
                user-select: none;
                box-sizing: border-box !important;
                height: 35px !important;
            }
            .xiv-fab-btn:hover { background-color: ${CONFIG.COLORS.RA_RED} !important; color: #ffffff !important; }
            .xiv-fab-btn:active { transform: scale(0.98); }
            .xiv-fab-btn:focus-visible { outline: 3px solid ${CONFIG.COLORS.TEXT_DARK}; outline-offset: 2px; }
            .xiv-fab-btn svg { flex-shrink: 0; display: block; }
            .xiv-fab-btn.is-open {
                background-color: ${CONFIG.COLORS.RA_RED} !important;
                color: #ffffff !important;
                box-shadow: 0 4px 14px rgba(255, 72, 72, 0.2) !important;
            }
            .xiv-fab-btn .xiv-btn-text {
                white-space: nowrap; overflow: hidden; max-width: 150px; opacity: 1;
                transition: max-width 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
            }

            .xiv-date-menu {
                background: #ffffff;
                width: clamp(180px, 20vw, 240px);
                max-height: 0;
                overflow-y: auto;
                border: 1px solid transparent;
                border-radius: 12px;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                transform-origin: bottom left;
                transform: translateY(15px);
            }
            .xiv-date-menu.is-open {
                max-height: clamp(200px, 50vh, 400px);
                border-color: #e2e8f0;
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }
            .xiv-date-menu::-webkit-scrollbar { width: 6px; }
            .xiv-date-menu::-webkit-scrollbar-track { background: #f3f4f6; border-radius: 8px; }
            .xiv-date-menu::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }
            .xiv-date-menu ul { list-style: none; padding: 6px 0; margin: 0; }
            .xiv-date-menu li { border-bottom: 1px solid #f3f4f6; }
            .xiv-date-menu li:last-child { border-bottom: none; }
            .xiv-date-menu a {
                display: block;
                padding: clamp(10px, 1.5vh, 14px) clamp(16px, 1.5vw, 20px);
                color: #4b5563;
                text-decoration: none;
                font-size: 11px;
                font-weight: 500;
                transition: background 0.2s ease, color 0.2s ease, border-left 0.2s ease;
                outline: none;
                border-left: 3px solid transparent;
            }
            .xiv-date-menu a:hover, .xiv-date-menu a:focus-visible { background-color: #f9fafb; color: ${CONFIG.COLORS.TEXT_DARK}; }
            .xiv-date-menu a.is-active { background-color: #f3f4f6; color: ${CONFIG.COLORS.TEXT_DARK}; border-left: 3px solid ${CONFIG.COLORS.TEXT_DARK}; font-weight: 700; }

            #xiv-sticky-header {
                position: fixed;
                top: clamp(60px, 8vh, 80px);
                left: 50%;
                transform: translateX(-50%);
                background-color: ${CONFIG.COLORS.TEXT_DARK} !important;
                color: #ffffff !important;
                padding: 10px 18px !important;
                font-size: 11px !important;
                font-weight: 600;
                z-index: ${CONFIG.Z_INDEX.OVERLAY};
                border-radius: 50px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
                pointer-events: none;
                opacity: 0;
                overflow: hidden;
                min-width: 160px;
                display: grid;
                grid-template-columns: 1fr;
                align-items: center;
                justify-items: center;
                transition: opacity 0.3s ease;
                box-sizing: border-box;
            }
            .xiv-sticky-text { grid-area: 1 / 1; white-space: nowrap; transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease; }
            .xiv-sticky-text.is-active { transform: translateY(0); opacity: 1; }
            .xiv-sticky-text.is-entering-up { transform: translateY(100%); opacity: 0; }
            .xiv-sticky-text.is-entering-down { transform: translateY(-100%); opacity: 0; }
            .xiv-sticky-text.is-leaving-up { transform: translateY(-100%); opacity: 0; }
            .xiv-sticky-text.is-leaving-down { transform: translateY(100%); opacity: 0; }

            /* --- HIGHLIGHTER TOGGLE UI (Bottom Right) --- */
            #xiv-sales-toggle-container {
                position: fixed;
                bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom));
                right: clamp(16px, 3vw, 32px);
                z-index: ${CONFIG.Z_INDEX.OVERLAY};
                opacity: 0;
                visibility: hidden;
                transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s ease, background-color 0.2s ease, border-color 0.2s ease;
                background-color: #ffffff !important;
                border: 1px solid ${CONFIG.COLORS.RA_RED} !important;
                border-radius: 50px !important;
                padding: 10px 18px !important;
                height: 35px !important;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08) !important;
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                user-select: none;
                box-sizing: border-box !important;
            }
            #xiv-sales-toggle-container.is-visible { opacity: 1; visibility: visible; transform: translateY(0); }
            #xiv-sales-toggle-container.is-active { background-color: ${CONFIG.COLORS.RA_RED} !important; box-shadow: 0 4px 14px rgba(255, 72, 72, 0.2) !important; }
            #xiv-sales-toggle-container:focus-visible { outline: 3px solid ${CONFIG.COLORS.TEXT_DARK}; outline-offset: 2px; }

            .xiv-switch-track { width: 32px; height: 18px; background-color: #e5e7eb; border-radius: 20px; position: relative; transition: background-color 0.3s ease; flex-shrink: 0; }
            .xiv-switch-knob { width: 14px; height: 14px; background-color: #ffffff; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
            #xiv-sales-toggle-container.is-active .xiv-switch-track { background-color: rgba(255, 255, 255, 0.3) !important; }
            #xiv-sales-toggle-container.is-active .xiv-switch-knob { transform: translateX(14px); }

            .xiv-toggle-label { font-size: 11px !important; font-weight: 500 !important; color: ${CONFIG.COLORS.TEXT_DARK} !important; transition: color 0.2s ease, max-width 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease; white-space: nowrap; overflow: hidden; max-width: 150px; opacity: 1; }
            #xiv-sales-toggle-container.is-active .xiv-toggle-label { color: #ffffff !important; }

            /* --- HIGHLIGHTER ROW STYLES --- */
            .xiv-has-sales-bg {
                background-color: ${CONFIG.COLORS.ROW_MINT} !important;
                transition: background-color 0.4s ease !important;
                border-radius: 8px;
            }
            .xiv-has-sales-bg span:not(.xiv-venue-highlight),
            .xiv-has-sales-bg label,
            li.myEvents.xiv-has-sales .grey,
            li.myEvents.xiv-has-sales .grey a {
                color: #151515 !important;
            }

            .xiv-venue-highlight {
                color: ${CONFIG.COLORS.VENUE_BLUE} !important;
                font-weight: 800 !important;
                letter-spacing: 0.2px;
                transition: color 0.2s ease;
            }

            /* Flip Animation Engine & Filtering */
            .xiv-no-sales {
                transition: opacity ${CONFIG.TIMING.ANIMATION}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${CONFIG.TIMING.ANIMATION}ms cubic-bezier(0.4, 0, 0.2, 1) !important;
                transform-origin: center !important;
            }

            body.xiv-filter-fade .xiv-no-sales {
                opacity: 0 !important;
                transform: scale(0.95) !important;
                pointer-events: none !important;
            }

            body.xiv-filter-layout li.myEvents.xiv-no-sales,
            body.xiv-filter-layout div:has(> ul[role='button'].xiv-no-sales) {
                display: none !important;
            }

            /* PURE CSS EMPTY STATES (No DOM injection bugs) */
            @keyframes xiv-fade-in { from { opacity: 0; } to { opacity: 1; } }

            body.xiv-filter-layout div:has(> div > ul[role='button']):not(:has(.xiv-has-sales))::after,
            body.xiv-filter-layout ul:has(> li.myEvents):not(:has(.xiv-has-sales))::after {
                content: "${CONFIG.STRINGS.EMPTY_SALES}";
                display: block;
                padding: clamp(16px, 3vh, 24px);
                text-align: center;
                color: #666;
                font-size: clamp(13px, 1vw, 14px);
                background: #f5f5f5;
                border-radius: 8px;
                margin: 10px 0;
                font-style: italic;
                animation: xiv-fade-in 0.3s ease;
            }

            /* --- RESPONSIVE MOBILE --- */
            @media (max-width: 768px) {
                .xiv-fab-btn, #xiv-sales-toggle-container { padding: 8px !important; width: 35px !important; height: 35px !important; justify-content: center !important; gap: 0 !important; }
                .xiv-fab-btn .xiv-btn-text, .xiv-toggle-label { max-width: 0 !important; opacity: 0 !important; }
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // CROSS-FRAME COMMUNICATION (Router)
    // ==========================================
    function initMessageRouter() {
        window.addEventListener('message', (e) => {
            if (!isSafeOrigin(e.origin)) return;
            const action = e.data?.action;
            const payload = e.data?.payloadData;
            if (!action) return;

            if (action === 'XIV_SYNC_STATE') Highlighter.applyToggleState(true, payload === true);
            if (action === 'XIV_TOGGLE_FILTER') Highlighter.applyToggleState(false, payload === true);
            if (action === 'XIV_EVENTS_FOUND' && state.isTopWindow) Highlighter.showToggle();

            if (action === 'XIV_HIDE_LAYOUT' || action === 'XIV_SHOW_LAYOUT') {
                if (state.jumper.mutationTimer) clearTimeout(state.jumper.mutationTimer);
                state.jumper.mutationTimer = setTimeout(() => DateJumper.cacheHeaderPositions(), 50);
            }
            if (action === 'XIV_CLOSE_MENU' && state.jumper.isOpen) DateJumper.closeMenu();
        });
    }

    function broadcastCommand(action, payloadData = null) {
        const payload = { action, payloadData };
        const frames = document.querySelectorAll('iframe');
        for (let i = 0; i < frames.length; i++) {
            try {
                if (frames[i].contentWindow) frames[i].contentWindow.postMessage(payload, '*');
            } catch (error) {}
        }
        if (!state.isTopWindow) {
            window.top.postMessage(payload, '*');
        }
    }

    // ==========================================
    // MODULE: TICKET SALES HIGHLIGHTER
    // ==========================================
    const Highlighter = {
        initTopWindowUI() {
            if (document.getElementById('xiv-sales-toggle-container')) return;

            const container = document.createElement('div');
            container.id = 'xiv-sales-toggle-container';
            container.className = 'xiv-native-font';
            container.setAttribute('role', 'switch');
            container.setAttribute('tabindex', '0');

            const track = document.createElement('div');
            track.className = 'xiv-switch-track';

            const knob = document.createElement('div');
            knob.className = 'xiv-switch-knob';
            track.appendChild(knob);

            const label = document.createElement('span');
            label.className = 'xiv-toggle-label';
            label.textContent = CONFIG.STRINGS.TOGGLE_LABEL;

            container.appendChild(track);
            container.appendChild(label);
            document.body.appendChild(container);

            let isFiltered = SafeStorage.getBool(CONFIG.STORAGE_FILTER_KEY);
            this.updateUIState(container, isFiltered);

            const toggleFilter = () => {
                isFiltered = !isFiltered;
                SafeStorage.set(CONFIG.STORAGE_FILTER_KEY, isFiltered);
                this.updateUIState(container, isFiltered);
                broadcastCommand('XIV_TOGGLE_FILTER', isFiltered);
                this.applyToggleState(false, isFiltered);
            };

            container.addEventListener('click', toggleFilter);
            container.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter(); }
            });

            broadcastCommand('XIV_SYNC_STATE', isFiltered);
        },

        showToggle() {
            if (!isMainEventsPage()) return;
            const container = document.getElementById('xiv-sales-toggle-container');
            if (container) container.classList.add('is-visible');
        },

        updateUIState(container, isActive) {
            if (isActive) {
                container.classList.add('is-active');
                container.setAttribute('aria-checked', 'true');
            } else {
                container.classList.remove('is-active');
                container.setAttribute('aria-checked', 'false');
            }
        },

        animateListReflow(actionFn, onComplete, threadId) {
            const activeCards = document.querySelectorAll('.xiv-has-sales');
            if (activeCards.length === 0) {
                actionFn();
                if (onComplete) requestAnimationFrame(onComplete);
                return;
            }

            const firstRects = new Map();
            activeCards.forEach(card => firstRects.set(card, card.getBoundingClientRect()));
            actionFn();

            requestAnimationFrame(() => {
                if (state.highlighter.animId !== threadId) return;
                activeCards.forEach(card => {
                    const first = firstRects.get(card);
                    const last = card.getBoundingClientRect();
                    card.style.transition = 'none';
                    card.style.transform = `translate(${first.left - last.left}px, ${first.top - last.top}px)`;
                });

                requestAnimationFrame(() => {
                    if (state.highlighter.animId !== threadId) return;
                    activeCards.forEach(card => {
                        card.style.transition = `transform ${CONFIG.TIMING.ANIMATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
                        card.style.transform = 'translate(0, 0)';
                    });

                    setTimeout(() => {
                        if (state.highlighter.animId !== threadId) return;
                        activeCards.forEach(card => {
                            card.style.transition = '';
                            card.style.transform = '';
                        });
                        if (onComplete) onComplete();
                    }, CONFIG.TIMING.ANIMATION);
                });
            });
        },

        applyToggleState(instant = false, forcedState = null) {
            state.highlighter.animId++;
            const currentAnim = state.highlighter.animId;
            const isActive = forcedState !== null ? forcedState : SafeStorage.getBool(CONFIG.STORAGE_FILTER_KEY);

            const hiddenCards = document.querySelectorAll('.xiv-no-sales');
            document.querySelectorAll('.xiv-processed').forEach(card => card.style.removeProperty('transition-delay'));

            if (instant) {
                document.body.classList.toggle('xiv-filter-fade', isActive);
                document.body.classList.toggle('xiv-filter-layout', isActive);
                return;
            }

            if (isActive) {
                document.body.classList.add('xiv-filter-fade');
                setTimeout(() => {
                    if (state.highlighter.animId !== currentAnim) return;
                    this.animateListReflow(() => {
                        if (state.highlighter.animId !== currentAnim) return;
                        document.body.classList.add('xiv-filter-layout');
                    }, null, currentAnim);
                }, CONFIG.TIMING.ANIMATION);
            } else {
                hiddenCards.forEach((card, index) => {
                    card.style.setProperty('transition-delay', `${index * CONFIG.TIMING.STAGGER}ms`, 'important');
                });

                this.animateListReflow(() => {
                    if (state.highlighter.animId !== currentAnim) return;
                    document.body.classList.remove('xiv-filter-layout');
                }, null, currentAnim);

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (state.highlighter.animId !== currentAnim) return;
                        document.body.classList.remove('xiv-filter-fade');
                        setTimeout(() => {
                            if (state.highlighter.animId !== currentAnim) return;
                            hiddenCards.forEach(card => card.style.removeProperty('transition-delay'));
                        }, CONFIG.TIMING.ANIMATION + (hiddenCards.length * CONFIG.TIMING.STAGGER));
                    });
                });
            }
        },

        parseNewRowFormat(row) {
            let ticketCol = null;
            let locationCol = null;

            const lis = row.querySelectorAll('li');
            for (let i = 0; i < lis.length; i++) {
                const label = lis[i].querySelector('label');
                if (!label) continue;

                const text = label.textContent.toLowerCase();
                if (text.includes('tickets sold') || text.includes('allocated')) {
                    ticketCol = lis[i];
                } else if (text.includes('location')) {
                    locationCol = lis[i];
                }
            }
            return { ticketCol, locationCol };
        },

        extractVenueOldFormat(row) {
            const greyDivs = row.querySelectorAll('.grey');
            for (let i = 0; i < greyDivs.length; i++) {
                const childNodes = greyDivs[i].childNodes;
                for (let j = 0; j < childNodes.length; j++) {
                    const node = childNodes[j];
                    if (node.nodeType === 3) {
                        const match = node.nodeValue.match(/^(\s*at\s+)(.*?)(,\s*)?$/);
                        if (match && match[2]) return { node: node, match: match, isNew: false };
                    }
                }
            }
            return { node: null, match: null, isNew: false };
        },

        // Deep React Fiber Traversal + Caching
        extractReactUrl(el) {
            if (el.dataset.xivUrl) return el.dataset.xivUrl;

            try {
                const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
                if (!fiberKey) return null;

                const rootNode = el[fiberKey];
                let queue = [rootNode];
                let visited = new Set();

                let parent = rootNode.return;
                for(let i = 0; i < 4 && parent; i++) {
                    queue.push(parent);
                    parent = parent.return;
                }

                let depth = 0;
                while (queue.length > 0 && depth < 300) {
                    let node = queue.shift();
                    if (!node || visited.has(node)) continue;
                    visited.add(node);
                    depth++;

                    let props = node.memoizedProps;
                    let foundUrl = null;
                    if (props) {
                        const dataObj = props.event || props.rowData || props.item || props.data;
                        if (dataObj && dataObj.id && String(dataObj.id).match(/^\d{6,7}$/)) {
                            foundUrl = `/pro/events/${dataObj.id}/tickets/management`;
                        } else if (props.id && props.title && String(props.id).match(/^\d{6,7}$/)) {
                            foundUrl = `/pro/events/${props.id}/tickets/management`;
                        } else if (typeof props.href === 'string' && props.href.includes('/events/')) {
                            const idMatch = props.href.match(/\/events\/(\d{6,7})/);
                            if (idMatch) foundUrl = `/pro/events/${idMatch[1]}/tickets/management`;
                        }
                    }

                    if (foundUrl) {
                        el.dataset.xivUrl = foundUrl; // Cache result
                        return foundUrl;
                    }

                    if (node.child) queue.push(node.child);
                    if (node.sibling) queue.push(node.sibling);
                }
            } catch (e) {
                Logger.warn('Failed to extract React URL', e);
            }
            return null;
        },

        bindRowClicks(row) {
            if (row.hasAttribute('data-xiv-click-bound')) return;
            row.setAttribute('data-xiv-click-bound', 'true');
            row.style.cursor = 'pointer';

            const handleNativeOpen = (e) => {
                const targetUrl = this.extractReactUrl(row);
                if (targetUrl) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    window.open(targetUrl, '_blank', 'noopener,noreferrer');
                }
            };

            const isModifierClick = (e) => e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey));

            row.addEventListener('mouseover', () => {
                if (!row.hasAttribute('title')) {
                    const url = this.extractReactUrl(row);
                    if (url) row.title = CONFIG.STRINGS.BTN_TITLE_MOD;
                }
            });

            row.addEventListener('mousedown', (e) => {
                if (isModifierClick(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            }, true);

            row.addEventListener('mouseup', (e) => {
                if (isModifierClick(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handleNativeOpen(e);
                }
            }, true);

            row.addEventListener('click', (e) => {
                if (isModifierClick(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            }, true);
        },

        bindTabSwitchObserver() {
            document.addEventListener('click', (e) => {
                const tab = e.target.closest(CONFIG.SELECTORS.TAB_BUTTONS);
                if (tab && isMainEventsPage()) {
                    const isActive = SafeStorage.getBool(CONFIG.STORAGE_FILTER_KEY);
                    if (isActive) {
                        this.applyToggleState(true, false);
                        setTimeout(() => {
                            if (SafeStorage.getBool(CONFIG.STORAGE_FILTER_KEY)) {
                                this.processTicketSales();
                                this.applyToggleState(false, true);
                            }
                        }, 150);
                    }
                }
            }, true);
        },

        processTicketSales() {
            const eventRows = document.querySelectorAll(`${CONFIG.SELECTORS.ROW_OLD}:not(.xiv-processed), ${CONFIG.SELECTORS.ROW_NEW}:not(.xiv-processed)`);
            if (eventRows.length === 0) return;

            const targets = [];
            let newSalesFound = 0;

            for (let i = 0; i < eventRows.length; i++) {
                const row = eventRows[i];
                row.classList.add('xiv-processed');
                const isNewFormat = row.tagName === 'UL';

                if (isNewFormat) {
                    this.bindRowClicks(row);
                }

                let hasSales = false;
                let venueData = { node: null, match: null, isNew: isNewFormat };

                if (isNewFormat) {
                    const { ticketCol, locationCol } = this.parseNewRowFormat(row);

                    if (ticketCol) {
                        const progress = ticketCol.querySelector('progress');
                        if (progress && parseInt(progress.getAttribute('value') || '0', 10) > 0) {
                            hasSales = true;
                        } else {
                            const valSpan = ticketCol.querySelector('span:first-of-type');
                            if (valSpan && parseInt(valSpan.textContent || '0', 10) > 0) hasSales = true;
                        }
                    }
                    if (locationCol) {
                        const anchor = locationCol.querySelector('a');
                        if (anchor) venueData.node = anchor;
                    }
                } else {
                    const statsLink = row.querySelector('.stats a, .stats');
                    if (statsLink && statsLink.textContent) {
                        const match = statsLink.textContent.trim().match(/(\d+)\s*tickets?\s*sold/i);
                        if (match && parseInt(match[1], 10) > 0) hasSales = true;
                    }
                    venueData = this.extractVenueOldFormat(row);
                }

                if (hasSales) newSalesFound++;
                targets.push({ row, hasSales, venueData });
            }

            if (newSalesFound > 0) {
                if (state.isTopWindow) this.showToggle();
                broadcastCommand('XIV_EVENTS_FOUND');
            }

            requestAnimationFrame(() => {
                for (let i = 0; i < targets.length; i++) {
                    const { row, hasSales, venueData } = targets[i];

                    if (hasSales) {
                        row.classList.add('xiv-has-sales', 'xiv-has-sales-bg');
                        row.classList.remove('xiv-no-sales');

                        if (venueData.node) {
                            try {
                                if (venueData.isNew) {
                                    venueData.node.classList.add('xiv-venue-highlight');
                                } else if (venueData.match) {
                                    const parent = venueData.node.parentNode;
                                    const leadingNode = document.createTextNode(venueData.match[1]);
                                    const venueSpan = document.createElement('span');
                                    venueSpan.className = 'xiv-venue-highlight';
                                    venueSpan.textContent = venueData.match[2];
                                    const trailingNode = document.createTextNode(venueData.match[3] || "");

                                    parent.insertBefore(leadingNode, venueData.node);
                                    parent.insertBefore(venueSpan, venueData.node);
                                    parent.insertBefore(trailingNode, venueData.node);
                                    parent.removeChild(venueData.node);
                                }
                            } catch (e) {}
                        }
                    } else {
                        row.classList.add('xiv-no-sales');
                        row.classList.remove('xiv-has-sales', 'xiv-has-sales-bg');
                    }
                }
            });
        },

        initObserver() {
            state.highlighter.observer = new MutationObserver((mutations) => {
                let shouldProcess = false;
                for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];

                    if (m.target.nodeType === 1 && (m.target.classList?.contains('xiv-venue-highlight') || m.target.id === 'xiv-sales-toggle-container')) {
                        continue;
                    }

                    if (m.target.tagName === 'PROGRESS' || m.attributeName === 'value') {
                        const row = m.target.closest(CONFIG.SELECTORS.ROW_NEW);
                        if (row) row.classList.remove('xiv-processed');
                        shouldProcess = true;
                    }

                    if (m.addedNodes.length > 0) shouldProcess = true;
                }

                const toggle = document.getElementById('xiv-sales-toggle-container');
                if (toggle) {
                    const isMain = isMainEventsPage();
                    const hasSales = document.querySelectorAll('.xiv-has-sales').length > 0;
                    if (!isMain && toggle.classList.contains('is-visible')) {
                        toggle.classList.remove('is-visible');
                    } else if (isMain && hasSales && !toggle.classList.contains('is-visible')) {
                        toggle.classList.add('is-visible');
                    }
                }

                if (shouldProcess) {
                    if (state.highlighter.debounceTimer) clearTimeout(state.highlighter.debounceTimer);
                    state.highlighter.debounceTimer = setTimeout(() => this.processTicketSales(), CONFIG.TIMING.DEBOUNCE);
                }
            });

            state.highlighter.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['value']
            });

            // Page Visibility Integration (Pause Observer when tab is hidden)
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && state.highlighter.observer) {
                    Logger.log("Tab hidden, pausing DOM observer.");
                    state.highlighter.observer.disconnect();
                } else if (!document.hidden && state.highlighter.observer) {
                    Logger.log("Tab visible, resuming DOM observer.");
                    state.highlighter.observer.observe(document.body, {
                        childList: true, subtree: true, attributes: true, attributeFilter: ['value']
                    });
                    this.processTicketSales(); // Catch up on any missed changes
                }
            });
        }
    };

    // ==========================================
    // MODULE: DATE JUMPER (Top Window Only)
    // ==========================================
    const DateJumper = {
        buildUI() {
            if (document.getElementById('xiv-date-jumper-container')) return;

            const st = state.jumper;
            st.elements.container = document.createElement('div');
            st.elements.container.id = 'xiv-date-jumper-container';
            st.elements.container.style.display = 'none';

            st.elements.btn = document.createElement('button');
            st.elements.btn.className = 'xiv-fab-btn xiv-native-font';
            st.elements.btn.setAttribute('aria-label', 'Toggle date menu');

            st.elements.menu = document.createElement('div');
            st.elements.menu.className = 'xiv-date-menu xiv-native-font';

            st.elements.menuList = document.createElement('ul');
            st.elements.menu.appendChild(st.elements.menuList);

            st.elements.container.appendChild(st.elements.menu);
            st.elements.container.appendChild(st.elements.btn);
            document.body.appendChild(st.elements.container);

            st.elements.stickyHeader = document.createElement('div');
            st.elements.stickyHeader.id = 'xiv-sticky-header';
            st.elements.stickyHeader.className = 'xiv-native-font';
            document.body.appendChild(st.elements.stickyHeader);

            // User Requirement: Always closed by default
            this.closeMenu();
            this.bindEvents();
        },

        updateBtnUI(isOpen) {
            const btn = state.jumper.elements.btn;
            btn.innerHTML = isOpen ? ICONS.CLOSE : ICONS.CALENDAR;

            const textSpan = document.createElement('span');
            textSpan.className = 'xiv-btn-text';
            textSpan.textContent = isOpen ? CONFIG.STRINGS.FAB_CLOSE : CONFIG.STRINGS.FAB_OPEN;

            btn.appendChild(textSpan);
            btn.title = isOpen ? CONFIG.STRINGS.FAB_CLOSE : CONFIG.STRINGS.FAB_OPEN;
            btn.classList.toggle('is-open', isOpen);
        },

        openMenu() {
            state.jumper.isOpen = true;
            state.jumper.elements.menu.classList.add('is-open');
            this.updateBtnUI(true);
            setTimeout(() => {
                const activeLink = state.jumper.elements.menuList.querySelector('a.is-active');
                if (activeLink) activeLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 50);
        },

        closeMenu() {
            state.jumper.isOpen = false;
            if (state.jumper.elements.menu) state.jumper.elements.menu.classList.remove('is-open');
            if (state.jumper.elements.btn) this.updateBtnUI(false);
        },

        bindEvents() {
            const st = state.jumper;

            st.boundHandlers.toggleMenu = (e) => {
                e.stopPropagation();
                st.isOpen ? this.closeMenu() : this.openMenu();
            };
            st.elements.btn.addEventListener('click', st.boundHandlers.toggleMenu);

            st.boundHandlers.clickOutside = (e) => {
                if (st.isOpen && !st.elements.container.contains(e.target)) this.closeMenu();
            };
            document.addEventListener('click', st.boundHandlers.clickOutside);

            st.boundHandlers.resize = () => {
                if (st.resizeTimer) clearTimeout(st.resizeTimer);
                st.resizeTimer = setTimeout(() => this.cacheHeaderPositions(), CONFIG.TIMING.DEBOUNCE);
            };
            window.addEventListener('resize', st.boundHandlers.resize);

            st.boundHandlers.scroll = () => {
                if (!st.isTicking) {
                    window.requestAnimationFrame(() => {
                        this.processScrollTick();
                        st.isTicking = false;
                    });
                    st.isTicking = true;
                }
            };
            window.addEventListener('scroll', st.boundHandlers.scroll, { passive: true });

            // Accessibility: Keyboard Navigation
            st.boundHandlers.keydown = (e) => {
                if (!st.isOpen) return;
                if (e.key === 'Escape') {
                    this.closeMenu();
                    st.elements.btn.focus();
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const links = Array.from(st.elements.menuList.querySelectorAll('a'));
                    if (!links.length) return;
                    const activeIndex = links.indexOf(document.activeElement);
                    let nextIndex = e.key === 'ArrowDown' ? activeIndex + 1 : activeIndex - 1;
                    if (nextIndex < 0) nextIndex = links.length - 1;
                    if (nextIndex >= links.length) nextIndex = 0;
                    links[nextIndex].focus();
                }
            };
            document.addEventListener('keydown', st.boundHandlers.keydown);
        },

        unbindEvents() {
            const st = state.jumper;
            if (st.boundHandlers.clickOutside) document.removeEventListener('click', st.boundHandlers.clickOutside);
            if (st.boundHandlers.resize) window.removeEventListener('resize', st.boundHandlers.resize);
            if (st.boundHandlers.scroll) window.removeEventListener('scroll', st.boundHandlers.scroll);
            if (st.boundHandlers.keydown) document.removeEventListener('keydown', st.boundHandlers.keydown);
        },

        getLiveHeaders() {
            const unique = new Map();

            const h2s = document.querySelectorAll(CONFIG.SELECTORS.DATE_HEADER_NEW);
            h2s.forEach(h2 => {
                const text = h2.textContent.replace(/[\n\r]+/g, ' ').trim();
                if (/\d{4}/.test(text) && text.length < 25) {
                    if (!unique.has(text)) unique.set(text, h2);
                }
            });

            if (unique.size === 0) {
                const iframe = document.querySelector(CONFIG.SELECTORS.IFRAME_OLD);
                if (iframe) {
                    try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                        const headerNodes = iframeDoc.querySelectorAll(CONFIG.SELECTORS.DATE_HEADER_OLD);
                        headerNodes.forEach(node => {
                            const text = node.textContent.replace(/[\n\r]+/g, ' ').trim();
                            if (text && !unique.has(text)) unique.set(text, node);
                        });
                    } catch(e) {}
                }
            }

            return Array.from(unique, ([text, node]) => ({ text, node }));
        },

        cacheHeaderPositions() {
            try {
                const liveNodes = this.getLiveHeaders();
                const liveStrings = liveNodes.map(h => h.text);

                const isIdentical = liveStrings.length === state.jumper.headers.length &&
                                    liveStrings.every((val, index) => val === state.jumper.headers[index]);

                if (isIdentical) return;

                state.jumper.headers = liveStrings;

                if (state.jumper.headers.length === 0) {
                    if (state.jumper.elements.container) state.jumper.elements.container.style.display = 'none';
                    if (state.jumper.elements.stickyHeader) state.jumper.elements.stickyHeader.style.opacity = '0';
                } else {
                    if (!state.jumper.elements.container) this.buildUI();
                    state.jumper.elements.container.style.display = 'flex';
                    this.renderMenuList();
                    this.processScrollTick();
                }
            } catch (e) {
                Logger.warn('Failed to cache headers', e);
            }
        },

        renderMenuList() {
            state.jumper.elements.menuList.textContent = '';
            for (let i = 0; i < state.jumper.headers.length; i++) {
                const text = state.jumper.headers[i];
                const li = document.createElement('li');
                const a = document.createElement('a');

                a.textContent = text;
                a.href = "#";
                a.setAttribute('data-target-text', text);

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.triggerScroll(text);
                });

                li.appendChild(a);
                state.jumper.elements.menuList.appendChild(li);
            }
        },

        updateStickyHeaderText(newText, direction) {
            const st = state.jumper;
            if (!st.lastStickyText) {
                st.lastStickyText = newText;
                const newTextEl = document.createElement('span');
                newTextEl.className = 'xiv-sticky-text is-active';
                newTextEl.textContent = newText;
                st.elements.stickyHeader.appendChild(newTextEl);
                return;
            }

            if (newText === st.lastStickyText) return;
            st.lastStickyText = newText;

            const headerContainer = st.elements.stickyHeader;
            const oldTexts = headerContainer.querySelectorAll('.xiv-sticky-text');

            const newTextEl = document.createElement('span');
            newTextEl.className = `xiv-sticky-text ${direction === 'down' ? 'is-entering-up' : 'is-entering-down'}`;
            newTextEl.textContent = newText;
            headerContainer.appendChild(newTextEl);

            void newTextEl.offsetWidth; // trigger reflow

            for (let i = 0; i < oldTexts.length; i++) {
                const el = oldTexts[i];
                el.classList.remove('is-active');
                el.classList.add(direction === 'down' ? 'is-leaving-up' : 'is-leaving-down');
                setTimeout(() => el.remove(), 300);
            }

            newTextEl.classList.remove('is-entering-up', 'is-entering-down');
            newTextEl.classList.add('is-active');
        },

        updateScrollSpy(activeText) {
            if (!state.jumper.elements.menuList) return;
            const links = state.jumper.elements.menuList.querySelectorAll('a');
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                link.classList.toggle('is-active', link.getAttribute('data-target-text') === activeText);
            }
        },

        getAbsoluteTop(node) {
            let absoluteTop = node.getBoundingClientRect().top + window.scrollY;
            const iframe = document.querySelector(CONFIG.SELECTORS.IFRAME_OLD);
            if (iframe && iframe.contains(node)) {
                 absoluteTop = iframe.getBoundingClientRect().top + window.scrollY + node.getBoundingClientRect().top;
            }
            return absoluteTop;
        },

        processScrollTick() {
            const liveHeaders = this.getLiveHeaders();
            if (liveHeaders.length === 0) return;

            const scrollY = window.scrollY;
            const scrollDirection = scrollY > state.jumper.lastScrollY ? 'down' : 'up';
            state.jumper.lastScrollY = scrollY;
            const threshold = CONFIG.TIMING.SCROLL_OFFSET + 50;

            let currentText = '';
            for (let i = liveHeaders.length - 1; i >= 0; i--) {
                const { text, node } = liveHeaders[i];
                const absoluteTop = this.getAbsoluteTop(node);

                if (scrollY + threshold >= absoluteTop) {
                    currentText = text;
                    break;
                }
            }

            if (!currentText && liveHeaders.length > 0) currentText = liveHeaders[0].text;

            const st = state.jumper;
            if (currentText && st.elements.stickyHeader) {
                this.updateStickyHeaderText(currentText, scrollDirection);
                this.updateScrollSpy(currentText);
                st.elements.stickyHeader.style.opacity = scrollY > CONFIG.TIMING.STICKY_FADE_THRESHOLD ? '1' : '0';
            } else if (st.elements.stickyHeader) {
                st.elements.stickyHeader.style.opacity = '0';
            }
        },

        cleanupScrollListeners() {
            window.removeEventListener('wheel', DateJumper.abortScroll);
            window.removeEventListener('touchstart', DateJumper.abortScroll);
            window.removeEventListener('keydown', DateJumper.abortScroll);
        },

        abortScroll() {
            if (state.jumper.scrollAnimId) window.cancelAnimationFrame(state.jumper.scrollAnimId);
            DateJumper.cleanupScrollListeners();
        },

        customScrollTo(targetY, duration) {
            this.abortScroll();
            const startY = window.scrollY;
            const diff = targetY - startY;
            let startTime = null;

            window.addEventListener('wheel', DateJumper.abortScroll, { passive: true, once: true });
            window.addEventListener('touchstart', DateJumper.abortScroll, { passive: true, once: true });
            window.addEventListener('keydown', DateJumper.abortScroll, { passive: true, once: true });

            const step = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const timeElapsed = timestamp - startTime;
                const progress = Math.min(timeElapsed / duration, 1);
                const ease = 1 - (1 - progress) * (1 - progress);

                window.scrollTo(0, startY + (diff * ease));
                if (timeElapsed < duration) {
                    state.jumper.scrollAnimId = window.requestAnimationFrame(step);
                } else {
                    this.cleanupScrollListeners();
                }
            };
            state.jumper.scrollAnimId = window.requestAnimationFrame(step);
        },

        triggerScroll(targetText) {
            const liveHeaders = this.getLiveHeaders();
            const target = liveHeaders.find(h => h.text === targetText);

            if (target) {
                const targetPosition = this.getAbsoluteTop(target.node) - CONFIG.TIMING.SCROLL_OFFSET;
                this.customScrollTo(targetPosition, CONFIG.TIMING.SCROLL_DURATION);
            }

            if (window.innerWidth < 1024) this.closeMenu();
        },

        initSPAObserver() {
            let hasInitialized = false;

            const rootObserver = new MutationObserver(() => {
                // SPA Teardown Guard
                if (!isMainEventsPage()) {
                    if (hasInitialized) {
                        hasInitialized = false;
                        this.closeMenu();
                        this.unbindEvents();
                        if (state.jumper.elements.container) state.jumper.elements.container.style.display = 'none';
                        if (state.jumper.elements.stickyHeader) state.jumper.elements.stickyHeader.style.opacity = '0';
                    }
                    return;
                }

                const tableExists = document.querySelector(CONFIG.SELECTORS.ROW_NEW) || document.querySelector(CONFIG.SELECTORS.IFRAME_OLD);

                if (tableExists && !hasInitialized) {
                    hasInitialized = true;
                    this.buildUI();
                    setTimeout(() => this.cacheHeaderPositions(), 800);
                } else if (!tableExists && hasInitialized) {
                    hasInitialized = false;
                    this.closeMenu();
                    this.unbindEvents();
                    if (state.jumper.elements.container) state.jumper.elements.container.style.display = 'none';
                    if (state.jumper.elements.stickyHeader) state.jumper.elements.stickyHeader.style.opacity = '0';
                } else if (tableExists && hasInitialized) {
                    if (state.jumper.mutationTimer) clearTimeout(state.jumper.mutationTimer);
                    state.jumper.mutationTimer = setTimeout(() => this.cacheHeaderPositions(), CONFIG.TIMING.DEBOUNCE);
                }
            });

            rootObserver.observe(document.body, { childList: true, subtree: true });
        }
    };

    // ==========================================
    // BOOTSTRAP
    // ==========================================
    function init() {
        injectStyles();
        initMessageRouter();

        const isCurrentlyFiltered = SafeStorage.getBool(CONFIG.STORAGE_FILTER_KEY);
        if (isCurrentlyFiltered) document.body.classList.add('xiv-filter-active');

        if (state.isTopWindow) {
            Highlighter.initTopWindowUI();
            Highlighter.bindTabSwitchObserver();
        }

        Highlighter.processTicketSales();
        Highlighter.initObserver();

        if (state.isTopWindow) {
            DateJumper.initSPAObserver();
        }
    }

    init();

})();
