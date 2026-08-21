// ==UserScript==
// @name         [RA] Advanced Navigation
// @namespace    https://github.com/myouisaur/RA
// @icon         https://ra.co/static/favicon.svg
// @version      7.4
// @description  Highlights active ticket sales, provides floating multi-filter controls, and adds a sticky scroll-spy month tracker.
// @author       Xiv
// @match        *://*.ra.co/*
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/RA/advanced-navigation.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA/advanced-navigation.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Duplicate execution guard for SPA stability
    if (window.xivRaProToolsInitialized) return;
    window.xivRaProToolsInitialized = true;

    // ==========================================
    // CONFIGURATION & CONSTANTS
    // ==========================================
    const CONFIG = {
        // Feature Flags
        FLAGS: {
            DEBUG: false
        },

        // Routes
        TARGET_PATH: "/pro/events",

        // Selectors
        SELECTORS: {
            ROW: "ul[role='button']",
            COL_LABEL: "label",
            LINK_ANCHOR: "a",
            PROGRESS: "progress",
            TAB_ACTIVE: "button[role='tab'][aria-selected='true']",
            MONTH_HEADER: "h2"
        },

        // Storage Keys (sessionStorage)
        STORAGE: {
            SALES: 'xiv_ra_filter_sales',
            VENUE: 'xiv_ra_filter_venue',
            DATE_FROM: 'xiv_ra_filter_date_from',
            DATE_TO: 'xiv_ra_filter_date_to'
        },

        // CSS Classes & Data Attributes
        CLASSES: {
            PROCESSED: 'xiv-processed',
            HAS_SALES: 'xiv-has-sales',
            HAS_SALES_BG: 'xiv-has-sales-bg',
            SHOULD_HIDE: 'xiv-should-hide',
            FILTER_LAYOUT: 'xiv-filter-layout',
            ACTIVE_STACK: 'xiv-is-active-stack',
            FAB_CLEAR: 'xiv-fab-clear',
            STICKY_TEXT: 'xiv-sticky-text'
        },
        ATTRS: {
            VENUE: 'data-xiv-venue',
            SALES: 'data-xiv-has-sales',
            TIMESTAMP: 'data-xiv-timestamp',
            MONTH_LABEL: 'data-xiv-month',
            CLICK_BOUND: 'data-xiv-click-bound',
            URL_CACHE: 'data-xiv-url'
        },

        // Strings
        STRINGS: {
            TOGGLE_LABEL: 'Active Sales Only',
            FILTER_ALL_VENUES: 'All Venues',
            FILTER_VENUE_PREFIX: 'Venue: ',
            FILTER_DATE_DEFAULT: 'Filter by Date',
            EMPTY_STATE: 'No events match your current filters.',
            UNKNOWN_VENUE: 'Unknown Location',
            BTN_TITLE_MOD: 'Middle-click or Ctrl/Cmd-click to open Ticket Management in a new tab'
        },

        // UI Z-Index & Colors
        Z_INDEX: {
            OVERLAY: 2147483647,
            ACTIVE_MENU: 2147483648
        },
        COLORS: {
            RA_BG: '#ffffff',
            RA_HOVER: '#f9fafb',
            RA_HOVER_DARK: '#f3f4f6',
            RA_BORDER: '#e5e7eb',
            RA_BORDER_DARK: '#d1d5db',
            RA_TEXT_DARK: '#111827',
            RA_TEXT_MUTED: '#4b5563',
            RA_ACCENT: '#ff4848',        // RA Red
            HIGHLIGHT_BG: '#90e0b4',     // RA Mint
            HIGHLIGHT_TEXT: '#151515'
        },

        // Timing & Animation
        TIMING: {
            DEBOUNCE: 100,
            ANIMATION: 300,
            SCROLL_OFFSET: 60 // Aligned perfectly with RA's top sticky navigation bar height
        }
    };

    // ==========================================
    // UTILITIES
    // ==========================================
    const Logger = {
        log: (msg, data = '') => { if (CONFIG.FLAGS.DEBUG) console.log(`[RA Pro Tools] ${msg}`, data); },
        warn: (msg, err) => { if (CONFIG.FLAGS.DEBUG) console.warn(`[RA Pro Tools] ${msg}`, err); }
    };

    const SafeStorage = {
        get: (key, defaultValue) => {
            try {
                const val = sessionStorage.getItem(key);
                return val !== null ? JSON.parse(val) : defaultValue;
            } catch (e) {
                Logger.warn(`Storage read failed for ${key}`, e);
                return defaultValue;
            }
        },
        set: (key, value) => {
            try {
                if (value === null || value === undefined) {
                    sessionStorage.removeItem(key);
                } else {
                    sessionStorage.setItem(key, JSON.stringify(value));
                }
            } catch (e) {
                Logger.warn(`Storage write failed for ${key}`, e);
            }
        }
    };

    const RouteManager = {
        isEventsList: () => window.location.pathname.replace(/\/$/, '').endsWith(CONFIG.TARGET_PATH)
    };

    const SVGIcons = {
        create(type) {
            const ns = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(ns, "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2");
            svg.setAttribute("stroke-linecap", "round");
            svg.setAttribute("stroke-linejoin", "round");

            if (type === 'map-pin') {
                const path = document.createElementNS(ns, "path");
                path.setAttribute("d", "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z");
                const circle = document.createElementNS(ns, "circle");
                circle.setAttribute("cx", "12"); circle.setAttribute("cy", "10"); circle.setAttribute("r", "3");
                svg.appendChild(path); svg.appendChild(circle);
            } else if (type === 'calendar') {
                const rect = document.createElementNS(ns, "rect");
                rect.setAttribute("x", "3"); rect.setAttribute("y", "4"); rect.setAttribute("width", "18"); rect.setAttribute("height", "18"); rect.setAttribute("rx", "2"); rect.setAttribute("ry", "2");
                const l1 = document.createElementNS(ns, "line"); l1.setAttribute("x1", "16"); l1.setAttribute("y1", "2"); l1.setAttribute("x2", "16"); l1.setAttribute("y2", "6");
                const l2 = document.createElementNS(ns, "line"); l2.setAttribute("x1", "8"); l2.setAttribute("y1", "2"); l2.setAttribute("x2", "8"); l2.setAttribute("y2", "6");
                const l3 = document.createElementNS(ns, "line"); l3.setAttribute("x1", "3"); l3.setAttribute("y1", "10"); l3.setAttribute("x2", "21"); l3.setAttribute("y2", "10");
                svg.appendChild(rect); svg.appendChild(l1); svg.appendChild(l2); svg.appendChild(l3);
            } else if (type === 'x') {
                const l1 = document.createElementNS(ns, "line"); l1.setAttribute("x1", "18"); l1.setAttribute("y1", "6"); l1.setAttribute("x2", "6"); l1.setAttribute("y2", "18");
                const l2 = document.createElementNS(ns, "line"); l2.setAttribute("x1", "6"); l2.setAttribute("y1", "6"); l2.setAttribute("x2", "18"); l2.setAttribute("y2", "18");
                svg.appendChild(l1); svg.appendChild(l2);
            }
            return svg;
        }
    };

    // ==========================================
    // DATA STATE & CALENDAR ENGINE
    // ==========================================
    const AppState = {
        animId: 0,
        availableVenues: new Set(),
        availableMonths: new Map(), // Map<"Month Year", Element>

        isSalesFilterActive: SafeStorage.get(CONFIG.STORAGE.SALES, false),
        activeVenueFilter: SafeStorage.get(CONFIG.STORAGE.VENUE, null),
        dateFrom: SafeStorage.get(CONFIG.STORAGE.DATE_FROM, null),
        dateTo: SafeStorage.get(CONFIG.STORAGE.DATE_TO, null),

        venueMenuIsOpen: false,
        dateMenuIsOpen: false,

        scrollTimer: null,
        lastStickyMonth: ''
    };

    const DateUtils = {
        monthMap: { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 },
        monthNames: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],

        isPastActive() {
            const tab = document.querySelector(CONFIG.SELECTORS.TAB_ACTIVE);
            return tab ? tab.textContent.toLowerCase().includes('past') : false;
        },

        parseRowDate(dateStr, isPast) {
            const match = dateStr.trim().match(/(?:[a-zA-Z]{3},\s*)?(\d+)\s+([a-zA-Z]{3})/i);
            if (!match) return null;

            const day = parseInt(match[1], 10);
            const monthStr = match[2].toLowerCase();
            const month = this.monthMap[monthStr];

            if (month === undefined || isNaN(day)) return null;

            const now = new Date();
            const currentMonth = now.getMonth();
            const currentDay = now.getDate();
            let year = now.getFullYear();

            if (isPast) {
                if (month > currentMonth || (month === currentMonth && day > currentDay)) year--;
            } else {
                if (month < currentMonth || (month === currentMonth && day < currentDay)) year++;
            }

            const timestamp = new Date(year, month, day, 0, 0, 0, 0).getTime();
            const monthLabel = `${this.monthNames[month]} ${year}`;

            return { timestamp, monthLabel };
        },

        inputToTimestamp(dateStr, isEndOfDay = false) {
            if (!dateStr) return null;
            const [year, month, day] = dateStr.split('-');
            const d = new Date(year, month - 1, day);
            if (isEndOfDay) d.setHours(23, 59, 59, 999);
            else d.setHours(0, 0, 0, 0);
            return d.getTime();
        }
    };

    // ==========================================
    // MODULE: STYLES
    // ==========================================
    function injectStyles() {
        const css = `
            /* --- Control Stack (Bottom Left) --- */
            #xiv-control-stack {
                position: fixed; bottom: clamp(16px, 3vh, 32px); left: clamp(16px, 3vw, 32px);
                z-index: ${CONFIG.Z_INDEX.OVERLAY}; display: flex; flex-direction: column-reverse;
                align-items: flex-start; gap: 12px; pointer-events: none;
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
                opacity: 0; visibility: hidden; transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s ease;
            }
            #xiv-control-stack.xiv-is-visible { opacity: 1; visibility: visible; transform: translateY(0); }
            #xiv-control-stack > * { pointer-events: auto; }

            /* --- FAB Buttons --- */
            .xiv-fab-container { position: relative; z-index: 1; }
            .xiv-fab-container.${CONFIG.CLASSES.ACTIVE_STACK} { z-index: ${CONFIG.Z_INDEX.ACTIVE_MENU}; }

            .xiv-fab-btn {
                background-color: ${CONFIG.COLORS.RA_BG} !important; border: 1px solid ${CONFIG.COLORS.RA_BORDER} !important;
                color: ${CONFIG.COLORS.RA_TEXT_MUTED} !important; border-radius: 50px !important; padding: 10px 18px !important;
                height: 35px !important; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08) !important;
                display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px !important;
                font-weight: 500 !important; transition: all 0.2s ease !important; outline: none;
                user-select: none; box-sizing: border-box !important; white-space: nowrap;
            }
            .xiv-fab-btn:hover { border-color: ${CONFIG.COLORS.RA_BORDER_DARK} !important; background-color: ${CONFIG.COLORS.RA_HOVER} !important; color: ${CONFIG.COLORS.RA_TEXT_DARK} !important; }
            .xiv-fab-btn:focus-visible { outline: 2px solid ${CONFIG.COLORS.RA_ACCENT}; outline-offset: 2px; }
            .xiv-fab-btn.xiv-is-active { background-color: ${CONFIG.COLORS.RA_ACCENT} !important; color: #fff !important; font-weight: 600 !important; border-color: ${CONFIG.COLORS.RA_ACCENT} !important; box-shadow: 0 4px 14px rgba(255, 72, 72, 0.2) !important; }
            .xiv-fab-btn > svg { flex-shrink: 0; display: block; width: 14px; height: 14px; }

            .${CONFIG.CLASSES.FAB_CLEAR} {
                display: none; align-items: center; justify-content: center;
                border-radius: 50%; padding: 2px; margin-left: 2px; margin-right: -4px;
                transition: background-color 0.2s, color 0.2s; color: rgba(0,0,0,0.3);
            }
            .xiv-fab-btn.xiv-is-active .${CONFIG.CLASSES.FAB_CLEAR} { display: flex; color: rgba(255,255,255,0.8); }
            .${CONFIG.CLASSES.FAB_CLEAR}:hover { background-color: rgba(255,255,255,0.2); color: #fff; }
            .${CONFIG.CLASSES.FAB_CLEAR} svg { width: 14px; height: 14px; }

            /* --- Popup Menus --- */
            .xiv-popup-menu {
                position: absolute; bottom: 100%; left: 0; margin-bottom: 12px; background: ${CONFIG.COLORS.RA_BG};
                border: 1px solid ${CONFIG.COLORS.RA_BORDER}; border-radius: 12px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
                width: max-content; min-width: 220px; max-width: 85vw; opacity: 0; visibility: hidden;
                transform-origin: bottom left; transform: translateY(15px); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                color: ${CONFIG.COLORS.RA_TEXT_DARK}; display: flex; flex-direction: column;
            }
            .xiv-popup-menu.xiv-is-open { opacity: 1; visibility: visible; transform: translateY(0); }

            .xiv-menu-section { padding: 12px 16px; border-bottom: 1px solid ${CONFIG.COLORS.RA_HOVER_DARK}; }
            .xiv-menu-section:last-child { border-bottom: none; }
            .xiv-menu-title { font-size: 11px; color: ${CONFIG.COLORS.RA_TEXT_MUTED}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }

            /* Lists (Venue & Date Jump) */
            .xiv-scroll-list { max-height: 200px; overflow-y: auto; list-style: none; padding: 0; margin: 0; }
            .xiv-scroll-list::-webkit-scrollbar { width: 6px; }
            .xiv-scroll-list::-webkit-scrollbar-track { background: transparent; }
            .xiv-scroll-list::-webkit-scrollbar-thumb { background: ${CONFIG.COLORS.RA_BORDER_DARK}; border-radius: 8px; }
            .xiv-scroll-list li { border-bottom: 1px solid ${CONFIG.COLORS.RA_HOVER}; }
            .xiv-scroll-list li:last-child { border-bottom: none; }

            .xiv-menu-item {
                display: block; width: 100%; text-align: left; background: transparent; border: none;
                padding: 10px 16px; color: ${CONFIG.COLORS.RA_TEXT_MUTED}; font-size: 12px; font-weight: 500;
                transition: background 0.2s ease, color 0.2s ease; outline: none; cursor: pointer; border-left: 3px solid transparent;
            }
            .xiv-menu-item:hover, .xiv-menu-item:focus-visible { background-color: ${CONFIG.COLORS.RA_HOVER_DARK}; color: ${CONFIG.COLORS.RA_TEXT_DARK}; }
            .xiv-menu-item.xiv-is-selected { background-color: ${CONFIG.COLORS.RA_HOVER}; color: ${CONFIG.COLORS.RA_TEXT_DARK}; border-left: 3px solid ${CONFIG.COLORS.RA_ACCENT}; font-weight: 700; }

            /* Date Inputs */
            .xiv-date-inputs { display: flex; flex-direction: column; gap: 8px; }
            .xiv-date-field { display: flex; flex-direction: column; gap: 4px; }
            .xiv-date-field label { font-size: 11px; color: ${CONFIG.COLORS.RA_TEXT_MUTED}; }
            .xiv-date-input {
                background: ${CONFIG.COLORS.RA_BG}; border: 1px solid ${CONFIG.COLORS.RA_BORDER_DARK};
                color: ${CONFIG.COLORS.RA_TEXT_DARK}; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none;
                font-family: inherit; color-scheme: light; transition: border-color 0.2s;
            }
            .xiv-date-input:focus { border-color: ${CONFIG.COLORS.RA_ACCENT}; box-shadow: 0 0 0 1px ${CONFIG.COLORS.RA_ACCENT}; }
            .xiv-btn-clear {
                background: rgba(255, 72, 72, 0.1); border: 1px solid rgba(255, 72, 72, 0.3); color: ${CONFIG.COLORS.RA_ACCENT};
                padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;
                margin-top: 4px; width: 100%; display: block;
            }
            .xiv-btn-clear:hover { background: ${CONFIG.COLORS.RA_ACCENT}; color: #fff; border-color: ${CONFIG.COLORS.RA_ACCENT}; }

            /* --- Sales Toggle --- */
            #xiv-sales-toggle {
                background-color: ${CONFIG.COLORS.RA_BG} !important; border: 1px solid ${CONFIG.COLORS.RA_BORDER} !important;
                border-radius: 50px !important; padding: 10px 18px !important; height: 35px !important;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08) !important; display: flex; align-items: center; gap: 10px;
                cursor: pointer; user-select: none; box-sizing: border-box !important; position: relative; z-index: 1;
            }
            #xiv-sales-toggle:focus-visible { outline: 2px solid ${CONFIG.COLORS.RA_ACCENT}; outline-offset: 2px; }
            .xiv-switch-track { width: 32px; height: 18px; background-color: ${CONFIG.COLORS.RA_BORDER}; border-radius: 20px; position: relative; transition: background-color 0.3s ease; flex-shrink: 0; }
            .xiv-switch-knob { width: 14px; height: 14px; background-color: #fff; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
            #xiv-sales-toggle.xiv-is-active { border-color: ${CONFIG.COLORS.RA_ACCENT} !important; background-color: ${CONFIG.COLORS.RA_ACCENT} !important; box-shadow: 0 4px 14px rgba(255, 72, 72, 0.2) !important; }
            #xiv-sales-toggle.xiv-is-active .xiv-switch-track { background-color: rgba(255,255,255,0.3) !important; }
            #xiv-sales-toggle.xiv-is-active .xiv-switch-knob { transform: translateX(14px); }
            .xiv-toggle-label { font-size: 12px !important; font-weight: 500 !important; color: ${CONFIG.COLORS.RA_TEXT_MUTED} !important; transition: color 0.2s ease, font-weight 0.2s ease; white-space: nowrap; }
            #xiv-sales-toggle.xiv-is-active .xiv-toggle-label { color: #fff !important; font-weight: 600 !important; }

            /* --- Sticky Month Pill (Top Center) --- */
            #xiv-sticky-month {
                position: fixed; top: clamp(60px, 8vh, 80px); left: 50%; transform: translateX(-50%);
                background-color: ${CONFIG.COLORS.RA_BG} !important; color: ${CONFIG.COLORS.RA_TEXT_DARK} !important;
                padding: 10px 20px !important; font-size: 13px !important; font-weight: 700;
                z-index: ${CONFIG.Z_INDEX.OVERLAY}; border-radius: 50px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08); pointer-events: none;
                opacity: 0; overflow: hidden; display: grid; grid-template-columns: 1fr;
                align-items: center; justify-items: center; transition: opacity 0.3s ease; box-sizing: border-box;
                font-family: ui-sans-serif, system-ui, sans-serif; border: 1px solid ${CONFIG.COLORS.RA_BORDER};
            }
            .${CONFIG.CLASSES.STICKY_TEXT} { grid-area: 1 / 1; white-space: nowrap; transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease; }
            .${CONFIG.CLASSES.STICKY_TEXT}.xiv-is-active { transform: translateY(0); opacity: 1; }
            .${CONFIG.CLASSES.STICKY_TEXT}.xiv-enter-up { transform: translateY(100%); opacity: 0; }
            .${CONFIG.CLASSES.STICKY_TEXT}.xiv-enter-down { transform: translateY(-100%); opacity: 0; }
            .${CONFIG.CLASSES.STICKY_TEXT}.xiv-leave-up { transform: translateY(-100%); opacity: 0; }
            .${CONFIG.CLASSES.STICKY_TEXT}.xiv-leave-down { transform: translateY(100%); opacity: 0; }

            /* --- Highlighter & Layout Logic --- */
            .xiv-has-sales-bg { background-color: ${CONFIG.COLORS.HIGHLIGHT_BG} !important; transition: background-color 0.4s ease !important; border-radius: 8px; }
            .xiv-has-sales-bg span:not(.xiv-venue-highlight), .xiv-has-sales-bg label { color: ${CONFIG.COLORS.HIGHLIGHT_TEXT} !important; }

            .${CONFIG.CLASSES.SHOULD_HIDE} {
                transition: opacity ${CONFIG.TIMING.ANIMATION}ms ease, transform ${CONFIG.TIMING.ANIMATION}ms ease !important;
                transform-origin: center !important;
            }
            body.xiv-filter-fade .${CONFIG.CLASSES.SHOULD_HIDE} { opacity: 0 !important; transform: scale(0.95) !important; pointer-events: none !important; }
            body.${CONFIG.CLASSES.FILTER_LAYOUT} .${CONFIG.CLASSES.SHOULD_HIDE} { display: none !important; }

            /* Empty State Container Collapsing */
            body.${CONFIG.CLASSES.FILTER_LAYOUT} div:has(> ul[role='button'].${CONFIG.CLASSES.SHOULD_HIDE}) {
                display: none !important;
            }
            body.${CONFIG.CLASSES.FILTER_LAYOUT} div:has(> h2):has(ul[role='button']):not(:has(ul[role='button']:not(.${CONFIG.CLASSES.SHOULD_HIDE}))) {
                display: none !important;
            }

            /* Global Empty State Banner */
            #xiv-empty-state {
                display: none;
                text-align: center;
                padding: clamp(24px, 5vh, 48px);
                color: ${CONFIG.COLORS.RA_TEXT_MUTED};
                font-size: 14px;
                background: ${CONFIG.COLORS.RA_HOVER};
                border-radius: 8px;
                margin: 20px 0;
                border: 1px dashed ${CONFIG.COLORS.RA_BORDER_DARK};
            }
            body.${CONFIG.CLASSES.FILTER_LAYOUT}:not(:has(ul[role='button'].${CONFIG.CLASSES.PROCESSED}:not(.${CONFIG.CLASSES.SHOULD_HIDE}))) #xiv-empty-state {
                display: block;
                animation: xiv-fade-in 0.3s ease;
            }

            @keyframes xiv-fade-in { from { opacity: 0; } to { opacity: 1; } }

            /* --- Mobile --- */
            @media (max-width: 768px) {
                #xiv-control-stack { padding: 8px !important; }
                .xiv-fab-btn, #xiv-sales-toggle { padding: 10px !important; justify-content: center !important; gap: 0 !important; width: 35px; }
                .xiv-toggle-label, .xiv-btn-text, .${CONFIG.CLASSES.FAB_CLEAR} { display: none !important; }
            }
        `;
        GM_addStyle(css);
    }

    // ==========================================
    // MODULE: UI GENERATION & FILTER ENGINE
    // ==========================================
    const Engine = {
        initUI() {
            if (document.getElementById('xiv-control-stack')) return;

            const stack = document.createElement('div');
            stack.id = 'xiv-control-stack';

            const salesToggle = this.createSalesToggle();
            const venueWrapper = this.createVenueMenu();
            const dateWrapper = this.createDateMenu();

            stack.appendChild(salesToggle);
            stack.appendChild(venueWrapper.container);
            stack.appendChild(dateWrapper.container);

            document.body.appendChild(stack);

            this.createStickyMonthPill();
            this.bindGlobalEvents(venueWrapper, dateWrapper);

            this.updateToggleUI(salesToggle);
            this.updateVenueFABUI();
            this.updateDateFABUI();
        },

        closeAllMenus() {
            AppState.venueMenuIsOpen = false;
            AppState.dateMenuIsOpen = false;

            document.querySelectorAll('.xiv-popup-menu').forEach(m => m.classList.remove('xiv-is-open'));
            document.querySelectorAll('.xiv-fab-container').forEach(c => c.classList.remove(CONFIG.CLASSES.ACTIVE_STACK));
        },

        createSalesToggle() {
            const toggle = document.createElement('div');
            toggle.id = 'xiv-sales-toggle';
            toggle.setAttribute('role', 'switch');
            toggle.setAttribute('tabindex', '0');

            const track = document.createElement('div');
            track.className = 'xiv-switch-track';
            const knob = document.createElement('div');
            knob.className = 'xiv-switch-knob';
            track.appendChild(knob);

            const label = document.createElement('span');
            label.className = 'xiv-toggle-label';
            label.textContent = CONFIG.STRINGS.TOGGLE_LABEL;

            toggle.appendChild(track);
            toggle.appendChild(label);

            const trigger = () => {
                this.closeAllMenus();
                AppState.isSalesFilterActive = !AppState.isSalesFilterActive;
                SafeStorage.set(CONFIG.STORAGE.SALES, AppState.isSalesFilterActive);
                this.updateToggleUI(toggle);
                this.applyFilters(false);
            };

            toggle.addEventListener('click', trigger);
            toggle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }});

            return toggle;
        },

        createVenueMenu() {
            const container = document.createElement('div');
            container.className = 'xiv-fab-container';

            const btn = document.createElement('button');
            btn.id = 'xiv-venue-fab';
            btn.className = 'xiv-fab-btn';

            const textSpan = document.createElement('span');
            textSpan.className = 'xiv-btn-text';
            textSpan.textContent = CONFIG.STRINGS.FILTER_ALL_VENUES;

            const clearBtn = document.createElement('div');
            clearBtn.className = CONFIG.CLASSES.FAB_CLEAR;
            clearBtn.appendChild(SVGIcons.create('x'));
            clearBtn.addEventListener('click', e => {
                e.stopPropagation();
                AppState.activeVenueFilter = null;
                SafeStorage.set(CONFIG.STORAGE.VENUE, null);
                this.closeAllMenus();
                this.updateVenueFABUI();
                this.renderVenueMenu();
                this.applyFilters(false);
            });

            btn.appendChild(SVGIcons.create('map-pin'));
            btn.appendChild(textSpan);
            btn.appendChild(clearBtn);

            const menu = document.createElement('div');
            menu.id = 'xiv-venue-menu';
            menu.className = 'xiv-popup-menu';

            const listContainer = document.createElement('div');
            listContainer.className = 'xiv-menu-section';
            listContainer.style.padding = '0'; // Let list handle padding

            const list = document.createElement('ul');
            list.className = 'xiv-scroll-list';
            listContainer.appendChild(list);
            menu.appendChild(listContainer);

            btn.addEventListener('click', e => {
                e.stopPropagation();
                const isOpening = !AppState.venueMenuIsOpen;
                this.closeAllMenus();
                if (isOpening) {
                    AppState.venueMenuIsOpen = true;
                    menu.classList.add('xiv-is-open');
                    container.classList.add(CONFIG.CLASSES.ACTIVE_STACK);
                }
            });

            container.appendChild(menu);
            container.appendChild(btn);
            return { container, menu, btn };
        },

        createDateMenu() {
            const container = document.createElement('div');
            container.className = 'xiv-fab-container';

            const btn = document.createElement('button');
            btn.id = 'xiv-date-fab';
            btn.className = 'xiv-fab-btn';

            const textSpan = document.createElement('span');
            textSpan.className = 'xiv-btn-text';
            textSpan.textContent = CONFIG.STRINGS.FILTER_DATE_DEFAULT;

            btn.appendChild(SVGIcons.create('calendar'));
            btn.appendChild(textSpan);

            const menu = document.createElement('div');
            menu.id = 'xiv-date-menu';
            menu.className = 'xiv-popup-menu';

            // --- Jump Section ---
            const jumpSection = document.createElement('div');
            jumpSection.className = 'xiv-menu-section';
            const jumpTitle = document.createElement('div');
            jumpTitle.className = 'xiv-menu-title';
            jumpTitle.textContent = 'Jump to Month';
            const jumpList = document.createElement('ul');
            jumpList.id = 'xiv-jump-list';
            jumpList.className = 'xiv-scroll-list';
            jumpSection.appendChild(jumpTitle);
            jumpSection.appendChild(jumpList);

            // --- Filter Section ---
            const filterSection = document.createElement('div');
            filterSection.className = 'xiv-menu-section';
            const filterTitle = document.createElement('div');
            filterTitle.className = 'xiv-menu-title';
            filterTitle.textContent = 'Filter Range';

            const inputsDiv = document.createElement('div');
            inputsDiv.className = 'xiv-date-inputs';

            const createInput = (id, label) => {
                const field = document.createElement('div');
                field.className = 'xiv-date-field';
                const lbl = document.createElement('label'); lbl.htmlFor = id; lbl.textContent = label;
                const inp = document.createElement('input'); inp.type = 'date'; inp.id = id; inp.className = 'xiv-date-input';
                field.appendChild(lbl); field.appendChild(inp);
                return { field, inp };
            };

            const fromObj = createInput('xiv-date-from', 'From');
            const toObj = createInput('xiv-date-to', 'To');
            fromObj.inp.value = AppState.dateFrom || '';
            toObj.inp.value = AppState.dateTo || '';

            const clearBtn = document.createElement('button');
            clearBtn.className = 'xiv-btn-clear';
            clearBtn.textContent = 'Clear Dates';

            inputsDiv.appendChild(fromObj.field);
            inputsDiv.appendChild(toObj.field);
            inputsDiv.appendChild(clearBtn);
            filterSection.appendChild(filterTitle);
            filterSection.appendChild(inputsDiv);

            menu.appendChild(jumpSection);
            menu.appendChild(filterSection);

            // Logic
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const isOpening = !AppState.dateMenuIsOpen;
                this.closeAllMenus();
                if (isOpening) {
                    AppState.dateMenuIsOpen = true;
                    menu.classList.add('xiv-is-open');
                    container.classList.add(CONFIG.CLASSES.ACTIVE_STACK);
                }
            });

            menu.addEventListener('click', e => e.stopPropagation());

            const applyDates = () => {
                AppState.dateFrom = fromObj.inp.value || null;
                AppState.dateTo = toObj.inp.value || null;
                SafeStorage.set(CONFIG.STORAGE.DATE_FROM, AppState.dateFrom);
                SafeStorage.set(CONFIG.STORAGE.DATE_TO, AppState.dateTo);
                this.updateDateFABUI();
                this.applyFilters(false);
            };

            fromObj.inp.addEventListener('change', applyDates);
            toObj.inp.addEventListener('change', applyDates);

            clearBtn.addEventListener('click', () => {
                fromObj.inp.value = ''; toObj.inp.value = '';
                applyDates();
                this.closeAllMenus();
            });

            container.appendChild(menu);
            container.appendChild(btn);
            return { container, menu, btn };
        },

        createStickyMonthPill() {
            const pill = document.createElement('div');
            pill.id = 'xiv-sticky-month';
            document.body.appendChild(pill);

            // Setup scroll spy integration
            window.addEventListener('scroll', () => {
                if (!AppState.scrollTimer) {
                    window.requestAnimationFrame(() => {
                        this.processScrollTick();
                        AppState.scrollTimer = null;
                    });
                    AppState.scrollTimer = true;
                }
            }, { passive: true });
        },

        injectGlobalEmptyState() {
            if (document.getElementById('xiv-empty-state')) return;

            const emptyEl = document.createElement('div');
            emptyEl.id = 'xiv-empty-state';
            emptyEl.textContent = CONFIG.STRINGS.EMPTY_STATE;

            // Insert cleanly right before the first month header container
            const firstHeader = document.querySelector(CONFIG.SELECTORS.MONTH_HEADER);
            if (firstHeader && firstHeader.parentElement && firstHeader.parentElement.parentElement) {
                firstHeader.parentElement.parentElement.insertBefore(emptyEl, firstHeader.parentElement);
            }
        },

        bindGlobalEvents(venueWrapper, dateWrapper) {
            document.addEventListener('click', e => {
                if (!venueWrapper.container.contains(e.target) && !dateWrapper.container.contains(e.target)) {
                    this.closeAllMenus();
                }
            });
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    if (AppState.venueMenuIsOpen) { this.closeAllMenus(); venueWrapper.btn.focus(); }
                    else if (AppState.dateMenuIsOpen) { this.closeAllMenus(); dateWrapper.btn.focus(); }
                }
            });
        },

        updateToggleUI(toggleEl) {
            toggleEl.classList.toggle('xiv-is-active', AppState.isSalesFilterActive);
            toggleEl.setAttribute('aria-checked', String(AppState.isSalesFilterActive));
        },

        updateVenueFABUI() {
            const btn = document.getElementById('xiv-venue-fab');
            if (!btn) return;
            const textSpan = btn.querySelector('.xiv-btn-text');

            if (AppState.activeVenueFilter) {
                btn.classList.add('xiv-is-active');
                textSpan.textContent = `${CONFIG.STRINGS.FILTER_VENUE_PREFIX}${AppState.activeVenueFilter}`;
            } else {
                btn.classList.remove('xiv-is-active');
                textSpan.textContent = CONFIG.STRINGS.FILTER_ALL_VENUES;
            }
        },

        updateDateFABUI() {
            const btn = document.getElementById('xiv-date-fab');
            if (!btn) return;
            const textSpan = btn.querySelector('.xiv-btn-text');

            if (AppState.dateFrom || AppState.dateTo) {
                btn.classList.add('xiv-is-active');
                const format = d => d ? d.substring(5).replace('-', '/') : '...';
                textSpan.textContent = `${format(AppState.dateFrom)} → ${format(AppState.dateTo)}`;
            } else {
                btn.classList.remove('xiv-is-active');
                textSpan.textContent = CONFIG.STRINGS.FILTER_DATE_DEFAULT;
            }
        },

        renderVenueMenu() {
            const list = document.querySelector('#xiv-venue-menu .xiv-scroll-list');
            if (!list) return;
            list.textContent = '';

            const options = [null, ...Array.from(AppState.availableVenues).sort()];
            options.forEach(venue => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.className = 'xiv-menu-item';
                btn.textContent = venue === null ? CONFIG.STRINGS.FILTER_ALL_VENUES : venue;
                if (AppState.activeVenueFilter === venue) btn.classList.add('xiv-is-selected');

                btn.addEventListener('click', () => {
                    AppState.activeVenueFilter = venue;
                    SafeStorage.set(CONFIG.STORAGE.VENUE, venue);
                    this.closeAllMenus();
                    this.updateVenueFABUI();
                    this.renderVenueMenu();
                    this.applyFilters(false);
                });
                li.appendChild(btn); list.appendChild(li);
            });
        },

        renderDateJumpMenu() {
            const list = document.getElementById('xiv-jump-list');
            if (!list) return;
            list.textContent = '';

            if (AppState.availableMonths.size === 0) {
                const empty = document.createElement('li');
                empty.className = 'xiv-menu-item';
                empty.style.cursor = 'default';
                empty.style.color = '#9ca3af';
                empty.textContent = 'No months available';
                list.appendChild(empty);
                return;
            }

            AppState.availableMonths.forEach((targetElement, monthLabel) => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.className = 'xiv-menu-item';
                btn.textContent = monthLabel;

                btn.addEventListener('click', () => {
                    this.closeAllMenus();

                    // Dynamically locate the actual <h2> tag to ensure pixel-perfect scroll
                    const allHeaders = Array.from(document.querySelectorAll(CONFIG.SELECTORS.MONTH_HEADER));
                    const targetH2 = allHeaders.find(h2 => h2.textContent.trim() === monthLabel);

                    const scrollTarget = targetH2 || targetElement;
                    const top = scrollTarget.getBoundingClientRect().top + window.scrollY - CONFIG.TIMING.SCROLL_OFFSET;

                    window.scrollTo({ top, behavior: 'smooth' });
                });

                li.appendChild(btn); list.appendChild(li);
            });
        },

        processScrollTick() {
            const pill = document.getElementById('xiv-sticky-month');
            if (!pill) return;

            const rows = document.querySelectorAll(`${CONFIG.SELECTORS.ROW}:not(.${CONFIG.CLASSES.SHOULD_HIDE})`);
            if (rows.length === 0) {
                pill.style.opacity = '0';
                return;
            }

            const scrollY = window.scrollY;
            const threshold = CONFIG.TIMING.SCROLL_OFFSET + 50;
            let currentMonth = '';

            // Find topmost visible active row
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const top = row.getBoundingClientRect().top + window.scrollY;
                if (scrollY + threshold < top) break;
                currentMonth = row.getAttribute(CONFIG.ATTRS.MONTH_LABEL);
            }

            if (!currentMonth && rows.length > 0) currentMonth = rows[0].getAttribute(CONFIG.ATTRS.MONTH_LABEL);

            if (currentMonth) {
                const direction = scrollY > (this.lastY || 0) ? 'down' : 'up';
                this.lastY = scrollY;

                this.updateStickyPillText(currentMonth, direction, pill);
                pill.style.opacity = scrollY > 150 ? '1' : '0';
            } else {
                pill.style.opacity = '0';
            }
        },

        updateStickyPillText(newText, direction, container) {
            if (AppState.lastStickyMonth === newText) return;
            AppState.lastStickyMonth = newText;

            const oldTexts = container.querySelectorAll(`.${CONFIG.CLASSES.STICKY_TEXT}`);
            const newEl = document.createElement('span');
            newEl.className = `${CONFIG.CLASSES.STICKY_TEXT} ${direction === 'down' ? 'xiv-enter-up' : 'xiv-enter-down'}`;
            newEl.textContent = newText;
            container.appendChild(newEl);

            void newEl.offsetWidth; // Reflow

            oldTexts.forEach(el => {
                el.classList.remove('xiv-is-active');
                el.classList.add(direction === 'down' ? 'xiv-leave-up' : 'xiv-leave-down');
                setTimeout(() => el.remove(), 300);
            });

            newEl.classList.remove('xiv-enter-up', 'xiv-enter-down');
            newEl.classList.add('xiv-is-active');
        },

        applyFilters(instant = false) {
            AppState.animId++;
            const currentAnim = AppState.animId;
            const allCards = document.querySelectorAll(`.${CONFIG.CLASSES.PROCESSED}`);

            const msFrom = DateUtils.inputToTimestamp(AppState.dateFrom, false);
            const msTo = DateUtils.inputToTimestamp(AppState.dateTo, true);

            const firstRects = new Map();
            if (!instant) {
                allCards.forEach(c => {
                    if (!c.classList.contains(CONFIG.CLASSES.SHOULD_HIDE)) firstRects.set(c, c.getBoundingClientRect());
                });
            }

            // Step 1: Evaluate state and calculate surviving venues/months
            AppState.availableVenues.clear();
            AppState.availableMonths.clear();

            allCards.forEach(card => {
                const hasSales = card.getAttribute(CONFIG.ATTRS.SALES) === "true";
                const venue = card.getAttribute(CONFIG.ATTRS.VENUE);
                const timestamp = parseInt(card.getAttribute(CONFIG.ATTRS.TIMESTAMP), 10);
                const monthLabel = card.getAttribute(CONFIG.ATTRS.MONTH_LABEL);

                let hidden = false;
                if (AppState.isSalesFilterActive && !hasSales) hidden = true;
                if (!isNaN(timestamp)) {
                    if (msFrom && timestamp < msFrom) hidden = true;
                    if (msTo && timestamp > msTo) hidden = true;
                }

                if (!hidden) {
                    if (venue) AppState.availableVenues.add(venue);
                    if (monthLabel && !AppState.availableMonths.has(monthLabel)) {
                        AppState.availableMonths.set(monthLabel, card); // Map to first valid row
                    }
                }
            });

            // Auto-clear active venue if it was entirely filtered out by date/sales
            if (AppState.activeVenueFilter && !AppState.availableVenues.has(AppState.activeVenueFilter)) {
                AppState.activeVenueFilter = null;
                SafeStorage.set(CONFIG.STORAGE.VENUE, null);
                this.updateVenueFABUI();
            }

            this.renderVenueMenu();
            this.renderDateJumpMenu();

            // Step 2: Apply classes
            allCards.forEach(card => {
                const hasSales = card.getAttribute(CONFIG.ATTRS.SALES) === "true";
                const venue = card.getAttribute(CONFIG.ATTRS.VENUE);
                const timestamp = parseInt(card.getAttribute(CONFIG.ATTRS.TIMESTAMP), 10);

                let hide = false;
                if (AppState.isSalesFilterActive && !hasSales) hide = true;
                if (AppState.activeVenueFilter && venue !== AppState.activeVenueFilter) hide = true;
                if (!isNaN(timestamp)) {
                    if (msFrom && timestamp < msFrom) hide = true;
                    if (msTo && timestamp > msTo) hide = true;
                }

                if (hide) card.classList.add(CONFIG.CLASSES.SHOULD_HIDE);
                else card.classList.remove(CONFIG.CLASSES.SHOULD_HIDE);
            });

            this.processScrollTick();

            if (instant) {
                document.body.classList.add(CONFIG.CLASSES.FILTER_LAYOUT);
                return;
            }

            // Step 3: FLIP Animation for surviving elements
            document.body.classList.add('xiv-filter-fade');

            setTimeout(() => {
                if (AppState.animId !== currentAnim) return;
                document.body.classList.add(CONFIG.CLASSES.FILTER_LAYOUT);

                requestAnimationFrame(() => {
                    if (AppState.animId !== currentAnim) return;
                    const animating = [];

                    allCards.forEach(card => {
                        if (!card.classList.contains(CONFIG.CLASSES.SHOULD_HIDE) && firstRects.has(card)) {
                            const first = firstRects.get(card);
                            const last = card.getBoundingClientRect();
                            if (first.top !== last.top) {
                                card.style.transition = 'none';
                                card.style.transform = `translateY(${first.top - last.top}px)`;
                                animating.push(card);
                            }
                        }
                    });

                    requestAnimationFrame(() => {
                        if (AppState.animId !== currentAnim) return;
                        animating.forEach(c => {
                            c.style.transition = `transform ${CONFIG.TIMING.ANIMATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
                            c.style.transform = 'translateY(0)';
                        });

                        setTimeout(() => {
                            if (AppState.animId !== currentAnim) return;
                            animating.forEach(c => { c.style.transition = ''; c.style.transform = ''; });
                            document.body.classList.remove('xiv-filter-fade');
                        }, CONFIG.TIMING.ANIMATION);
                    });
                });
            }, CONFIG.TIMING.ANIMATION);
        },

        extractColumnNode(row, labelText) {
            const cols = row.querySelectorAll('li');
            for (let i = 0; i < cols.length; i++) {
                const label = cols[i].querySelector(CONFIG.SELECTORS.COL_LABEL);
                if (label && label.textContent.toLowerCase().includes(labelText.toLowerCase())) {
                    return cols[i];
                }
            }
            return null;
        },

        extractReactUrl(el) {
            if (el.hasAttribute(CONFIG.ATTRS.URL_CACHE)) return el.getAttribute(CONFIG.ATTRS.URL_CACHE);

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
                        el.setAttribute(CONFIG.ATTRS.URL_CACHE, foundUrl);
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
            if (row.hasAttribute(CONFIG.ATTRS.CLICK_BOUND)) return;
            row.setAttribute(CONFIG.ATTRS.CLICK_BOUND, 'true');
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
            }, { capture: true });

            row.addEventListener('mouseup', (e) => {
                if (isModifierClick(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    handleNativeOpen(e);
                }
            }, { capture: true });

            row.addEventListener('click', (e) => {
                if (isModifierClick(e)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            }, { capture: true });
        },

        processEventCards() {
            if (!RouteManager.isEventsList()) {
                const stack = document.getElementById('xiv-control-stack');
                if (stack) stack.classList.remove('xiv-is-visible');
                return;
            }

            this.injectGlobalEmptyState();

            const rows = document.querySelectorAll(`${CONFIG.SELECTORS.ROW}:not(.${CONFIG.CLASSES.PROCESSED})`);
            if (rows.length === 0) return;

            let structuralChanges = false;
            const isPast = DateUtils.isPastActive();

            rows.forEach(row => {
                row.classList.add(CONFIG.CLASSES.PROCESSED);
                structuralChanges = true;

                // Feature: Interactive Navigation
                this.bindRowClicks(row);

                // Extraction: Date
                const dateCol = this.extractColumnNode(row, 'date');
                if (dateCol) {
                    const span = dateCol.querySelector('span:last-child');
                    if (span) {
                        const parsed = DateUtils.parseRowDate(span.textContent, isPast);
                        if (parsed) {
                            row.setAttribute(CONFIG.ATTRS.TIMESTAMP, parsed.timestamp);
                            row.setAttribute(CONFIG.ATTRS.MONTH_LABEL, parsed.monthLabel);
                        }
                    }
                }

                // Extraction: Venue
                const venueCol = this.extractColumnNode(row, 'location');
                if (venueCol) {
                    const anchor = venueCol.querySelector(CONFIG.SELECTORS.LINK_ANCHOR);
                    if (anchor) {
                        const venueName = anchor.textContent.trim() || CONFIG.STRINGS.UNKNOWN_VENUE;
                        row.setAttribute(CONFIG.ATTRS.VENUE, venueName);
                    }
                }

                // Extraction: Sales
                let hasSales = false;
                const salesCol = this.extractColumnNode(row, 'tickets sold');
                if (salesCol) {
                    const prog = salesCol.querySelector(CONFIG.SELECTORS.PROGRESS);
                    if (prog && prog.hasAttribute('value')) {
                        if (parseInt(prog.getAttribute('value'), 10) > 0) hasSales = true;
                    } else {
                        // Regex carefully looks for the number strictly *before* the slash
                        const match = salesCol.textContent.match(/(\d+)\s*\//);
                        if (match && parseInt(match[1], 10) > 0) {
                            hasSales = true;
                        }
                    }
                }

                row.setAttribute(CONFIG.ATTRS.SALES, hasSales ? "true" : "false");
                if (hasSales) row.classList.add(CONFIG.CLASSES.HAS_SALES, CONFIG.CLASSES.HAS_SALES_BG);
            });

            if (structuralChanges) {
                const stack = document.getElementById('xiv-control-stack');
                if (stack) stack.classList.add('xiv-is-visible');
                this.applyFilters(true); // Instant apply for newly loaded rows
            }
        },

        initObserver() {
            const observer = new MutationObserver(mutations => {
                let trigger = false;
                for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];
                    if (m.addedNodes.length > 0 && m.target.id !== 'xiv-control-stack' && m.target.id !== 'xiv-sticky-month' && m.target.id !== 'xiv-empty-state') {
                        trigger = true; break;
                    }
                }
                if (trigger) {
                    if (this.debounceTimer) clearTimeout(this.debounceTimer);
                    this.debounceTimer = setTimeout(() => this.processEventCards(), CONFIG.TIMING.DEBOUNCE);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            // Tab Switch Awareness
            document.addEventListener('click', e => {
                if (e.target.closest("button[role='tab']")) {
                    setTimeout(() => {
                        document.querySelectorAll(`.${CONFIG.CLASSES.PROCESSED}`).forEach(r => r.classList.remove(CONFIG.CLASSES.PROCESSED));
                        this.processEventCards();
                    }, 500); // Wait for React to swap lists
                }
            }, true);
        }
    };

    // ==========================================
    // BOOTSTRAP
    // ==========================================
    function init() {
        injectStyles();
        Engine.initUI();
        Engine.processEventCards();
        Engine.initObserver();
    }

    init();

})();
