// ==UserScript==
// @name         [Posh] Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://posh.vip/favicon.ico
// @version      6.2
// @description  Highlights active ticket sales, injects venue names, provides tab-isolated multi-filter controls, and summarizes sales with timeline badges.
// @author       Xiv
// @match        *://*.posh.vip/*
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/Posh/sales-highlighter.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/Posh/sales-highlighter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Duplicate execution guard for SPA stability
    if (window.xivInitialized) return;
    window.xivInitialized = true;

    // ==========================================
    // CONFIGURATION & CONSTANTS
    // ==========================================
    const CONFIG = {
        // Feature Flags
        FLAGS: {
            DEBUG: false
        },

        // Selectors
        SELECTORS: {
            CARD: '.border.rounded-2xl.bg-card',
            TICKET_ICON: '.lucide-ticket-check',
            INLINE_CONTAINER: '[data-slot="inline"]',
            TICKET_SPAN: 'span.truncate',
            MUTED_TEXT: 'span.truncate.text-muted-foreground',
            TIMELINE_ITEM: '[data-slot="timeline-item"]',
            TIMELINE_TITLE: '[data-slot="timeline-title"] > div > span:first-child',
            TIMELINE_TITLE_INLINE: '[data-slot="timeline-title"] [data-slot="inline"]',
            TIMEFRAME_TOGGLE_ACTIVE: 'button[role="radio"][aria-checked="true"]'
        },

        // Storage Keys (Tab-isolated)
        STORAGE_KEYS: {
            SALES: 'xiv_posh_filter_sales',
            VENUE: 'xiv_posh_filter_venue',
            DATE_FROM: 'xiv_posh_filter_date_from',
            DATE_TO: 'xiv_posh_filter_date_to'
        },

        // CSS Classes & Data Attributes
        CLASSES: {
            PROCESSED: 'xiv-processed',
            HAS_SALES: 'xiv-has-sales',
            HAS_SALES_BG: 'xiv-has-sales-bg',
            SHOULD_HIDE: 'xiv-should-hide',
            FILTER_LAYOUT: 'xiv-filter-layout',
            VENUE_KNOWN: 'xiv-venue-known',
            VENUE_UNKNOWN: 'xiv-venue-unknown',
            ACTIVE_STACK: 'is-active-stack',
            BADGE_CONTAINER: 'xiv-badge-container',
            VENUE_BADGE: 'xiv-venue-badge',
            VENUE_BADGE_UNKNOWN: 'xiv-venue-badge-unknown',
            FAB_CLEAR: 'xiv-fab-clear'
        },
        ATTRS: {
            VENUE_PROCESSED: 'data-xiv-venue-processed',
            DATA_VENUE: 'data-xiv-venue',
            DATA_SALES: 'data-xiv-has-sales',
            DATA_TIMESTAMP: 'data-xiv-timestamp'
        },

        // Strings
        STRINGS: {
            TOGGLE_LABEL: 'Active Sales Only',
            UNKNOWN_VENUE: '[UNKNOWN VENUE]',
            FILTER_ALL_VENUES: 'All Venues',
            FILTER_VENUE_PREFIX: 'Venue: ',
            FILTER_DATE_DEFAULT: 'Filter by Date'
        },

        // UI Z-Index & Colors
        Z_INDEX: {
            OVERLAY: 2147483647,
            ACTIVE_MENU: 10
        },
        COLORS: {
            POSH_ACCENT: '#ffffff',
            POSH_BG: '#0a0a0a',
            POSH_BG_HOVER: '#1a1a1a',
            POSH_BORDER: '#333333',
            HIGHLIGHT_BORDER: '#10b981',
            HIGHLIGHT_BG: 'rgba(16, 185, 129, 0.08)',
            VENUE_KNOWN: '#3b82f6',
            VENUE_UNKNOWN: '#ef4444',
            DANGER: '#ef4444',
            BADGE_BG: 'rgba(59, 130, 246, 0.15)',
            BADGE_TEXT: '#60a5fa',
            BADGE_BORDER: 'rgba(59, 130, 246, 0.3)'
        },

        // Timing & Animation
        TIMING: {
            DEBOUNCE: 100,
            ANIMATION: 300
        },

        // Venue Dictionary (Name -> Array of address strings)
        VENUES: {
            "Avenida": ["1 Pennsylvania Plaza, New York, NY 10119"],
            "Bar 13": ["121 University Place, New York, NY 10003"],
            "Brooklyn Warehouse": ["650 Sackett St, Brooklyn, NY 11217"],
            "Chocolate Factory": ["70 Scott Ave, Brooklyn, NY 11237"],
            "Club Lambda": ["1031 Grand St, Brooklyn, NY 11211"],
            "Diamond Club": ["101 Railroad Pl, Danbury, CT 06810"],
            "Dive Bar BK": ["408 Troutman St, Brooklyn, NY 11237"],
            "Don Rique": [
                "2 Knickerbocker Ave, Brooklyn, NY 11237",
                "2 Knickerbocker Ave, Brooklyn, NY 11237, EE. UU."
            ],
            "Dream Hotel": ["355 W 16th St, New York, NY 10011"],
            "Elegance": ["2964 Main St, Hartford, CT 06120"],
            "Elsie Rooftop": ["1412 Broadway, New York, NY 10018"],
            "Highbar": ["346 W 40th St, New York, NY 10018"],
            "Highwater": ["120 Water St, New York, NY 10005"],
            "HK Hall": ["605 W 48th St, New York, NY 10036"],
            "La Canchita": ["6 Delay St, Danbury, CT 06810"],
            "Lost in Paradise": ["11-01 43rd Ave, Long Island City, NY 11101"],
            "Mehanata": ["113 Ludlow St, New York, NY 10002"],
            "Nexo": ["29 W 36th St., New York, NY 10018"],
            "Pa'l Karajo Lounge": ["62-17 Northern Blvd, Flushing, NY 11377"],
            "Park Slope Warehouse": ["153 26th St, Brooklyn, NY 11232"],
            "Pier 36": ["299 South St, New York, NY 10002"],
            "Pier 78": [
                "455 12th Ave, New York, NY 10018",
                "455 12th Ave, NY 10018"
            ],
            "Ritmos": [
                "32-23 Steinway St, Astoria, NY 11103",
                "32-23 Steinway St, Long Island City, NY 11103"
            ],
            "San Antonios": ["247 Eldridge St, New York, NY 10002"],
            "Secret Location": ["63-01 Fresh Pond Rd, Ridgewood, NY 11385"],
            "Silver Lining": ["145 Bowery, New York, NY 10002"],
            "Superior Ingredients": ["74 Wythe Ave, Brooklyn, NY 11249"],
            "The Meadows": ["17 Meadow St, Brooklyn, NY 11206"],
            "The Rose": ["160 West 25th Street, New York, NY 10001"],
            "The Vault": ["45-06 Pearson St, Long Island City, NY 11101"],
            "Treadwell": ["1125 1st Ave, New York, NY 10065"],
            "V14": ["2100 14th St NW, Washington, DC 20009"],
            "Watermark": [
                "78 South St, New York, NY 10038",
                "78 South St Pier 15, New York, NY 10038"
            ],
            "Zona VIP": ["1310 Cedar Lane Rd, Greenville, SC 29617"]
        }
    };

    // ==========================================
    // UTILITIES & ROUTING
    // ==========================================
    const Logger = {
        log: (msg, data = '') => { if (CONFIG.FLAGS.DEBUG) console.log(`[Posh Tools] ${msg}`, data); },
        warn: (msg, err) => { if (CONFIG.FLAGS.DEBUG) console.warn(`[Posh Tools] ${msg}`, err); }
    };

    const RouteManager = {
        isEventsList() {
            return /\/organization\/[a-f0-9]+\/events\/?$/i.test(window.location.pathname);
        }
    };

    const SafeStorage = {
        get: (key, defaultValue) => {
            try {
                const val = sessionStorage.getItem(key);
                if (val === null) return defaultValue;
                return JSON.parse(val);
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
                circle.setAttribute("cx", "12");
                circle.setAttribute("cy", "10");
                circle.setAttribute("r", "3");
                svg.appendChild(path);
                svg.appendChild(circle);
            } else if (type === 'calendar') {
                const rect = document.createElementNS(ns, "rect");
                rect.setAttribute("x", "3"); rect.setAttribute("y", "4"); rect.setAttribute("width", "18"); rect.setAttribute("height", "18"); rect.setAttribute("rx", "2"); rect.setAttribute("ry", "2");
                const line1 = document.createElementNS(ns, "line"); line1.setAttribute("x1", "16"); line1.setAttribute("y1", "2"); line1.setAttribute("x2", "16"); line1.setAttribute("y2", "6");
                const line2 = document.createElementNS(ns, "line"); line2.setAttribute("x1", "8"); line2.setAttribute("y1", "2"); line2.setAttribute("x2", "8"); line2.setAttribute("y2", "6");
                const line3 = document.createElementNS(ns, "line"); line3.setAttribute("x1", "3"); line3.setAttribute("y1", "10"); line3.setAttribute("x2", "21"); line3.setAttribute("y2", "10");
                svg.appendChild(rect); svg.appendChild(line1); svg.appendChild(line2); svg.appendChild(line3);
            } else if (type === 'x') {
                const line1 = document.createElementNS(ns, "line");
                line1.setAttribute("x1", "18"); line1.setAttribute("y1", "6"); line1.setAttribute("x2", "6"); line1.setAttribute("y2", "18");
                const line2 = document.createElementNS(ns, "line");
                line2.setAttribute("x1", "6"); line2.setAttribute("y1", "6"); line2.setAttribute("x2", "18"); line2.setAttribute("y2", "18");
                svg.appendChild(line1);
                svg.appendChild(line2);
            }
            return svg;
        }
    };

    // ==========================================
    // DATA STATE & ENGINE
    // ==========================================
    const AppState = {
        debounceTimer: null,
        observer: null,
        animId: 0,
        venueMap: new Map(),
        presentVenues: new Set(),
        availableVenues: new Set(),

        isSalesFilterActive: false,
        activeVenueFilter: null,
        dateFrom: null,
        dateTo: null,

        venueMenuIsOpen: false,
        dateMenuIsOpen: false,

        timelineDateCache: new Map()
    };

    const DateUtils = {
        monthMap: { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 },

        isUpcomingActive() {
            const toggle = document.querySelector(CONFIG.SELECTORS.TIMEFRAME_TOGGLE_ACTIVE);
            return toggle ? toggle.textContent.trim().toLowerCase() === 'upcoming' : true;
        },

        parseToTimestamp(dateStr, isUpcoming) {
            const match = dateStr.trim().match(/^([a-zA-Z]{3})\s+(\d+)(?:st|nd|rd|th)?/i);
            if (!match) return null;

            const monthStr = match[1].toLowerCase();
            const day = parseInt(match[2], 10);
            const month = this.monthMap[monthStr];

            if (month === undefined || isNaN(day)) return null;

            const now = new Date();
            const currentMonth = now.getMonth();
            const currentDay = now.getDate();
            let year = now.getFullYear();

            if (isUpcoming) {
                if (month < currentMonth || (month === currentMonth && day < currentDay)) year++;
            } else {
                if (month > currentMonth || (month === currentMonth && day > currentDay)) year--;
            }

            return new Date(year, month, day, 0, 0, 0, 0).getTime();
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

    function normalizeAddress(addr) {
        if (!addr) return '';
        let norm = addr.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        if (norm.endsWith(' usa')) norm = norm.slice(0, -4).trim();
        return norm;
    }

    function buildVenueMap() {
        for (const [name, addresses] of Object.entries(CONFIG.VENUES)) {
            addresses.forEach(address => {
                AppState.venueMap.set(normalizeAddress(address), name);
            });
        }
    }

    // ==========================================
    // MODULE: STYLES
    // ==========================================
    function injectStyles() {
        if (document.getElementById('xiv-global-styles')) return;

        const style = document.createElement('style');
        style.id = 'xiv-global-styles';
        style.textContent = `
            /* --- CONTROL STACK (Bottom Left) --- */
            #xiv-control-stack {
                position: fixed; bottom: clamp(16px, 3vh, 32px); left: clamp(16px, 3vw, 32px);
                z-index: ${CONFIG.Z_INDEX.OVERLAY}; display: flex; flex-direction: column-reverse;
                align-items: flex-start; gap: 12px; pointer-events: none;
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                opacity: 0; visibility: hidden; transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s ease;
            }
            #xiv-control-stack.is-visible { opacity: 1; visibility: visible; transform: translateY(0); }
            #xiv-control-stack > * { pointer-events: auto; }

            /* --- FAB BUTTONS --- */
            .xiv-fab-container { position: relative; z-index: 1; }
            .xiv-fab-container.${CONFIG.CLASSES.ACTIVE_STACK} { z-index: ${CONFIG.Z_INDEX.ACTIVE_MENU}; }

            .xiv-fab-btn {
                background-color: ${CONFIG.COLORS.POSH_BG} !important; border: 1px solid ${CONFIG.COLORS.POSH_BORDER} !important;
                color: #a3a3a3 !important; border-radius: 50px !important; padding: 10px 18px !important;
                height: 35px !important; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
                display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px !important;
                font-weight: 500 !important; transition: all 0.2s ease !important; outline: none;
                user-select: none; box-sizing: border-box !important; white-space: nowrap;
            }
            .xiv-fab-btn:hover { border-color: #666 !important; color: #ffffff !important; }
            .xiv-fab-btn:focus-visible { outline: 2px solid ${CONFIG.COLORS.POSH_ACCENT}; outline-offset: 2px; }
            .xiv-fab-btn.is-active { background-color: ${CONFIG.COLORS.POSH_ACCENT} !important; color: #000000 !important; font-weight: 600 !important; border-color: ${CONFIG.COLORS.POSH_ACCENT} !important; }
            .xiv-fab-btn > svg { flex-shrink: 0; display: block; width: 14px; height: 14px; }

            .${CONFIG.CLASSES.FAB_CLEAR} {
                display: none; align-items: center; justify-content: center;
                border-radius: 50%; padding: 2px; margin-left: 2px; margin-right: -4px;
                transition: background-color 0.2s, color 0.2s; color: rgba(0,0,0,0.5);
            }
            .xiv-fab-btn.is-active .${CONFIG.CLASSES.FAB_CLEAR} { display: flex; }
            .${CONFIG.CLASSES.FAB_CLEAR}:hover { background-color: rgba(0,0,0,0.15); color: #000; }
            .${CONFIG.CLASSES.FAB_CLEAR} svg { width: 14px; height: 14px; }

            /* --- POPUP MENUS --- */
            .xiv-popup-menu {
                position: absolute; bottom: 100%; left: 0; margin-bottom: 12px; background: ${CONFIG.COLORS.POSH_BG};
                border: 1px solid ${CONFIG.COLORS.POSH_BORDER}; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);
                width: max-content; min-width: 220px; max-width: 85vw; opacity: 0; visibility: hidden;
                transform-origin: bottom left; transform: translateY(15px); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .xiv-popup-menu.is-open { opacity: 1; visibility: visible; transform: translateY(0); }

            /* Venue Menu */
            #xiv-venue-menu.is-open { max-height: clamp(200px, 50vh, 400px); overflow-y: auto; }
            #xiv-venue-menu::-webkit-scrollbar { width: 6px; }
            #xiv-venue-menu::-webkit-scrollbar-track { background: transparent; }
            #xiv-venue-menu::-webkit-scrollbar-thumb { background: ${CONFIG.COLORS.POSH_BORDER}; border-radius: 8px; }
            #xiv-venue-menu ul { list-style: none; padding: 6px 0; margin: 0; }
            #xiv-venue-menu li { border-bottom: 1px solid #1a1a1a; }
            #xiv-venue-menu li:last-child { border-bottom: none; }
            .xiv-menu-item {
                display: block; width: 100%; text-align: left; background: transparent; border: none;
                padding: 10px 16px; color: #a3a3a3; font-size: 12px; font-weight: 500;
                transition: background 0.2s ease, color 0.2s ease; outline: none; cursor: pointer; border-left: 3px solid transparent;
            }
            .xiv-menu-item:hover, .xiv-menu-item:focus-visible { background-color: ${CONFIG.COLORS.POSH_BG_HOVER}; color: #ffffff; }
            .xiv-menu-item.is-selected { background-color: ${CONFIG.COLORS.POSH_BG_HOVER}; color: #ffffff; border-left: 3px solid ${CONFIG.COLORS.POSH_ACCENT}; font-weight: 700; }

            /* Date Menu */
            #xiv-date-menu { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
            .xiv-date-field { display: flex; flex-direction: column; gap: 6px; }
            .xiv-date-field label { font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
            .xiv-date-input {
                background: ${CONFIG.COLORS.POSH_BG_HOVER}; border: 1px solid ${CONFIG.COLORS.POSH_BORDER};
                color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none;
                font-family: inherit; color-scheme: dark; transition: border-color 0.2s;
            }
            .xiv-date-input:focus { border-color: ${CONFIG.COLORS.POSH_ACCENT}; }
            .xiv-btn-clear {
                background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: ${CONFIG.COLORS.DANGER};
                padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;
                margin-top: 4px; width: 100%; display: block;
            }
            .xiv-btn-clear:hover { background: ${CONFIG.COLORS.DANGER}; color: #fff; border-color: ${CONFIG.COLORS.DANGER}; }

            /* --- SALES TOGGLE --- */
            #xiv-sales-toggle {
                background-color: ${CONFIG.COLORS.POSH_BG} !important; border: 1px solid ${CONFIG.COLORS.POSH_BORDER} !important;
                border-radius: 50px !important; padding: 10px 18px !important; height: 35px !important;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important; display: flex; align-items: center; gap: 10px;
                cursor: pointer; user-select: none; box-sizing: border-box !important; position: relative; z-index: 1;
            }
            #xiv-sales-toggle:focus-visible { outline: 2px solid ${CONFIG.COLORS.POSH_ACCENT}; outline-offset: 2px; }
            .xiv-switch-track { width: 32px; height: 18px; background-color: #404040; border-radius: 20px; position: relative; transition: background-color 0.3s ease; flex-shrink: 0; }
            .xiv-switch-knob { width: 14px; height: 14px; background-color: #ffffff; border-radius: 50%; position: absolute; top: 2px; left: 2px; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
            #xiv-sales-toggle.is-active { border-color: ${CONFIG.COLORS.POSH_ACCENT} !important; }
            #xiv-sales-toggle.is-active .xiv-switch-track { background-color: ${CONFIG.COLORS.POSH_ACCENT} !important; }
            #xiv-sales-toggle.is-active .xiv-switch-knob { transform: translateX(14px); background-color: #000000; }
            .xiv-toggle-label { font-size: 12px !important; font-weight: 500 !important; color: #a3a3a3 !important; transition: color 0.2s ease, font-weight 0.2s ease; white-space: nowrap; }
            #xiv-sales-toggle.is-active .xiv-toggle-label { color: #ffffff !important; font-weight: 600 !important; }

            /* --- TIMELINE BADGES --- */
            .${CONFIG.CLASSES.BADGE_CONTAINER} {
                display: flex; flex-wrap: wrap; gap: 6px; margin-left: 8px; align-items: center; padding-bottom: 2px;
            }
            .${CONFIG.CLASSES.VENUE_BADGE} {
                background-color: ${CONFIG.COLORS.BADGE_BG}; color: ${CONFIG.COLORS.BADGE_TEXT};
                border: 1px solid ${CONFIG.COLORS.BADGE_BORDER}; padding: 2px 8px; border-radius: 9999px;
                font-size: 11px; font-weight: 600; letter-spacing: 0.2px; line-height: 1.2;
                white-space: nowrap; transition: opacity 0.2s ease, transform 0.2s ease;
                display: inline-block;
            }
            .${CONFIG.CLASSES.VENUE_BADGE_UNKNOWN} {
                background-color: rgba(239, 68, 68, 0.15) !important;
                color: ${CONFIG.COLORS.DANGER} !important;
                border-color: rgba(239, 68, 68, 0.3) !important;
            }

            /* --- HIGHLIGHTER ROW STYLES & FILTERING --- */
            .xiv-has-sales-bg { border-color: ${CONFIG.COLORS.HIGHLIGHT_BORDER} !important; background-color: ${CONFIG.COLORS.HIGHLIGHT_BG} !important; transition: background-color 0.4s ease, border-color 0.4s ease !important; }
            .${CONFIG.CLASSES.SHOULD_HIDE} { display: none !important; }

            /* --- VENUE INJECTION --- */
            .${CONFIG.CLASSES.VENUE_KNOWN} { color: ${CONFIG.COLORS.VENUE_KNOWN} !important; font-weight: 600 !important; }
            .${CONFIG.CLASSES.VENUE_UNKNOWN} { color: ${CONFIG.COLORS.VENUE_UNKNOWN} !important; font-weight: 700 !important; letter-spacing: 0.5px; }

            /* --- RESPONSIVE MOBILE --- */
            @media (max-width: 768px) {
                #xiv-control-stack { padding: 8px !important; }
                .xiv-fab-btn, #xiv-sales-toggle { padding: 10px !important; justify-content: center !important; gap: 0 !important; width: 35px; }
                .xiv-toggle-label, .xiv-btn-text, .${CONFIG.CLASSES.FAB_CLEAR} { display: none !important; }
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // MODULE: UI GENERATION & FILTER ENGINE
    // ==========================================
    const Engine = {
        initUI() {
            if (document.getElementById('xiv-control-stack')) return;

            AppState.isSalesFilterActive = SafeStorage.get(CONFIG.STORAGE_KEYS.SALES, false);
            AppState.activeVenueFilter = SafeStorage.get(CONFIG.STORAGE_KEYS.VENUE, null);
            AppState.dateFrom = SafeStorage.get(CONFIG.STORAGE_KEYS.DATE_FROM, null);
            AppState.dateTo = SafeStorage.get(CONFIG.STORAGE_KEYS.DATE_TO, null);

            const stack = document.createElement('div');
            stack.id = 'xiv-control-stack';

            const salesToggle = this.createSalesToggle();
            const venueWrapper = this.createVenueMenu();
            const dateWrapper = this.createDateMenu();

            stack.appendChild(salesToggle);
            stack.appendChild(venueWrapper.container);
            stack.appendChild(dateWrapper.container);
            document.body.appendChild(stack);

            this.bindGlobalEvents(venueWrapper, dateWrapper);
            this.updateToggleUI(salesToggle);
            this.updateVenueFABUI();
            this.updateDateFABUI();

            this.applyFilters(true);
        },

        closeAllMenus() {
            AppState.venueMenuIsOpen = false;
            AppState.dateMenuIsOpen = false;

            const venueMenu = document.getElementById('xiv-venue-menu');
            const dateMenu = document.getElementById('xiv-date-menu');

            if (venueMenu) venueMenu.classList.remove('is-open');
            if (dateMenu) dateMenu.classList.remove('is-open');

            document.querySelectorAll('.xiv-fab-container').forEach(c => {
                c.classList.remove(CONFIG.CLASSES.ACTIVE_STACK);
            });
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
                SafeStorage.set(CONFIG.STORAGE_KEYS.SALES, AppState.isSalesFilterActive);
                this.updateToggleUI(toggle);
                this.applyFilters(false);
            };

            toggle.addEventListener('click', trigger);
            toggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
            });

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

            // X Clear button (injected inside the FAB)
            const clearBtn = document.createElement('div');
            clearBtn.className = CONFIG.CLASSES.FAB_CLEAR;
            clearBtn.title = 'Clear venue filter';
            clearBtn.appendChild(SVGIcons.create('x'));

            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent dropdown from opening
                AppState.activeVenueFilter = null;
                SafeStorage.set(CONFIG.STORAGE_KEYS.VENUE, null);
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
            menu.appendChild(document.createElement('ul'));

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpening = !AppState.venueMenuIsOpen;
                this.closeAllMenus();

                if (isOpening) {
                    AppState.venueMenuIsOpen = true;
                    menu.classList.add('is-open');
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

            const fieldFrom = document.createElement('div');
            fieldFrom.className = 'xiv-date-field';
            const labelFrom = document.createElement('label');
            labelFrom.htmlFor = 'xiv-date-from';
            labelFrom.textContent = 'From';
            const inputFrom = document.createElement('input');
            inputFrom.type = 'date';
            inputFrom.id = 'xiv-date-from';
            inputFrom.className = 'xiv-date-input';
            inputFrom.value = AppState.dateFrom || '';
            fieldFrom.appendChild(labelFrom);
            fieldFrom.appendChild(inputFrom);

            const fieldTo = document.createElement('div');
            fieldTo.className = 'xiv-date-field';
            const labelTo = document.createElement('label');
            labelTo.htmlFor = 'xiv-date-to';
            labelTo.textContent = 'To';
            const inputTo = document.createElement('input');
            inputTo.type = 'date';
            inputTo.id = 'xiv-date-to';
            inputTo.className = 'xiv-date-input';
            inputTo.value = AppState.dateTo || '';
            fieldTo.appendChild(labelTo);
            fieldTo.appendChild(inputTo);

            const clearBtn = document.createElement('button');
            clearBtn.id = 'xiv-date-clear';
            clearBtn.className = 'xiv-btn-clear';
            clearBtn.textContent = 'Clear Dates';

            menu.appendChild(fieldFrom);
            menu.appendChild(fieldTo);
            menu.appendChild(clearBtn);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpening = !AppState.dateMenuIsOpen;
                this.closeAllMenus();

                if (isOpening) {
                    AppState.dateMenuIsOpen = true;
                    menu.classList.add('is-open');
                    container.classList.add(CONFIG.CLASSES.ACTIVE_STACK);
                }
            });

            menu.addEventListener('click', e => e.stopPropagation());

            const applyDateChange = () => {
                AppState.dateFrom = inputFrom.value || null;
                AppState.dateTo = inputTo.value || null;
                SafeStorage.set(CONFIG.STORAGE_KEYS.DATE_FROM, AppState.dateFrom);
                SafeStorage.set(CONFIG.STORAGE_KEYS.DATE_TO, AppState.dateTo);

                this.updateDateFABUI();
                this.applyFilters(false);
            };

            inputFrom.addEventListener('change', applyDateChange);
            inputTo.addEventListener('change', applyDateChange);

            clearBtn.addEventListener('click', () => {
                inputFrom.value = '';
                inputTo.value = '';
                applyDateChange();
                this.closeAllMenus();
            });

            container.appendChild(menu);
            container.appendChild(btn);
            return { container, menu, btn };
        },

        bindGlobalEvents(venueWrapper, dateWrapper) {
            document.addEventListener('click', (e) => {
                const isInsideVenue = venueWrapper.container.contains(e.target);
                const isInsideDate = dateWrapper.container.contains(e.target);

                if (!isInsideVenue && !isInsideDate) {
                    this.closeAllMenus();
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (AppState.venueMenuIsOpen) {
                        this.closeAllMenus();
                        venueWrapper.btn.focus();
                    } else if (AppState.dateMenuIsOpen) {
                        this.closeAllMenus();
                        dateWrapper.btn.focus();
                    }
                }
            });
        },

        showControls() {
            const stack = document.getElementById('xiv-control-stack');
            if (stack && !stack.classList.contains('is-visible')) {
                stack.classList.add('is-visible');
            }
        },

        hideControls() {
            const stack = document.getElementById('xiv-control-stack');
            if (stack) stack.classList.remove('is-visible');
            this.closeAllMenus();
        },

        updateToggleUI(toggleEl) {
            toggleEl.classList.toggle('is-active', AppState.isSalesFilterActive);
            toggleEl.setAttribute('aria-checked', String(AppState.isSalesFilterActive));
        },

        updateVenueFABUI() {
            const btn = document.getElementById('xiv-venue-fab');
            const textSpan = btn?.querySelector('.xiv-btn-text');
            if (!btn || !textSpan) return;

            if (AppState.activeVenueFilter) {
                btn.classList.add('is-active');
                textSpan.textContent = `${CONFIG.STRINGS.FILTER_VENUE_PREFIX}${AppState.activeVenueFilter}`;
            } else {
                btn.classList.remove('is-active');
                textSpan.textContent = CONFIG.STRINGS.FILTER_ALL_VENUES;
            }
        },

        updateDateFABUI() {
            const btn = document.getElementById('xiv-date-fab');
            const textSpan = btn?.querySelector('.xiv-btn-text');
            if (!btn || !textSpan) return;

            if (AppState.dateFrom || AppState.dateTo) {
                btn.classList.add('is-active');
                const format = d => d ? d.substring(5).replace('-', '/') : '...'; // MM/DD
                textSpan.textContent = `${format(AppState.dateFrom)} → ${format(AppState.dateTo)}`;
            } else {
                btn.classList.remove('is-active');
                textSpan.textContent = CONFIG.STRINGS.FILTER_DATE_DEFAULT;
            }
        },

        renderVenueMenu() {
            const menuList = document.querySelector('#xiv-venue-menu ul');
            if (!menuList) return;

            menuList.innerHTML = '';
            const options = [null, ...Array.from(AppState.availableVenues).sort()];

            options.forEach(venue => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.className = 'xiv-menu-item';
                btn.textContent = venue === null ? CONFIG.STRINGS.FILTER_ALL_VENUES : venue;

                if (AppState.activeVenueFilter === venue) btn.classList.add('is-selected');

                btn.addEventListener('click', () => {
                    AppState.activeVenueFilter = venue;
                    SafeStorage.set(CONFIG.STORAGE_KEYS.VENUE, venue);

                    this.closeAllMenus();
                    this.updateVenueFABUI();
                    this.renderVenueMenu();
                    this.applyFilters(false);
                });

                li.appendChild(btn);
                menuList.appendChild(li);
            });
        },

        updateTimelineBadges() {
            const timelines = document.querySelectorAll(CONFIG.SELECTORS.TIMELINE_ITEM);

            timelines.forEach(timeline => {
                const titleContainer = timeline.querySelector(CONFIG.SELECTORS.TIMELINE_TITLE_INLINE);
                if (!titleContainer) return;

                // Tabulate visible cards with active sales grouped by venue
                const venueCounts = new Map();
                const cards = timeline.querySelectorAll(`.${CONFIG.CLASSES.PROCESSED}:not(.${CONFIG.CLASSES.SHOULD_HIDE})`);

                cards.forEach(card => {
                    if (card.getAttribute(CONFIG.ATTRS.DATA_SALES) === "true") {
                        const venue = card.getAttribute(CONFIG.ATTRS.DATA_VENUE);
                        if (venue) {
                            venueCounts.set(venue, (venueCounts.get(venue) || 0) + 1);
                        }
                    }
                });

                // Find or inject the badge container next to the date string
                let badgeContainer = titleContainer.querySelector(`.${CONFIG.CLASSES.BADGE_CONTAINER}`);
                if (!badgeContainer) {
                    badgeContainer = document.createElement('div');
                    badgeContainer.className = CONFIG.CLASSES.BADGE_CONTAINER;
                    titleContainer.appendChild(badgeContainer);
                }

                // Clear previous badges securely
                badgeContainer.textContent = '';

                if (venueCounts.size === 0) {
                    badgeContainer.style.display = 'none';
                    return;
                }

                badgeContainer.style.display = 'flex';

                // Sort alphabetically and generate DOM elements
                const sortedVenues = Array.from(venueCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));

                sortedVenues.forEach(([venue, count]) => {
                    const badge = document.createElement('span');
                    badge.className = CONFIG.CLASSES.VENUE_BADGE;
                    if (venue === CONFIG.STRINGS.UNKNOWN_VENUE) {
                        badge.classList.add(CONFIG.CLASSES.VENUE_BADGE_UNKNOWN);
                    }
                    badge.textContent = count > 1 ? `${venue} [${count}]` : venue;
                    badgeContainer.appendChild(badge);
                });
            });
        },

        applyFilters(instant = false) {
            AppState.animId++;
            const currentAnim = AppState.animId;
            const allCards = document.querySelectorAll(`.${CONFIG.CLASSES.PROCESSED}`);

            const msFrom = DateUtils.inputToTimestamp(AppState.dateFrom, false);
            const msTo = DateUtils.inputToTimestamp(AppState.dateTo, true);

            const visibleBefore = Array.from(allCards).filter(c => !c.classList.contains(CONFIG.CLASSES.SHOULD_HIDE));
            const firstRects = new Map();
            visibleBefore.forEach(c => firstRects.set(c, c.getBoundingClientRect()));

            // Step 1: Evaluate Date and Sales filters to determine Available Venues
            AppState.availableVenues.clear();

            allCards.forEach(card => {
                const hasSales = card.getAttribute(CONFIG.ATTRS.DATA_SALES) === "true";
                const venue = card.getAttribute(CONFIG.ATTRS.DATA_VENUE);
                const timestamp = parseInt(card.getAttribute(CONFIG.ATTRS.DATA_TIMESTAMP), 10);

                const hideForSales = AppState.isSalesFilterActive && !hasSales;
                let hideForDate = false;
                if (!isNaN(timestamp)) {
                    if (msFrom && timestamp < msFrom) hideForDate = true;
                    if (msTo && timestamp > msTo) hideForDate = true;
                }

                if (!hideForSales && !hideForDate && venue) {
                    AppState.availableVenues.add(venue);
                }
            });

            if (AppState.activeVenueFilter && !AppState.availableVenues.has(AppState.activeVenueFilter)) {
                AppState.activeVenueFilter = null;
                SafeStorage.set(CONFIG.STORAGE_KEYS.VENUE, null);
                this.updateVenueFABUI();
            }

            this.renderVenueMenu();

            // Step 2: Apply final visibility state
            allCards.forEach(card => {
                const hasSales = card.getAttribute(CONFIG.ATTRS.DATA_SALES) === "true";
                const venue = card.getAttribute(CONFIG.ATTRS.DATA_VENUE);
                const timestamp = parseInt(card.getAttribute(CONFIG.ATTRS.DATA_TIMESTAMP), 10);

                const hideForSales = AppState.isSalesFilterActive && !hasSales;
                const hideForVenue = AppState.activeVenueFilter && venue !== AppState.activeVenueFilter;

                let hideForDate = false;
                if (!isNaN(timestamp)) {
                    if (msFrom && timestamp < msFrom) hideForDate = true;
                    if (msTo && timestamp > msTo) hideForDate = true;
                }

                card.classList.toggle(CONFIG.CLASSES.SHOULD_HIDE, hideForSales || hideForVenue || hideForDate);
                card.style.removeProperty('transition-delay');
            });

            // Synchronously update badges immediately after DOM visibility classes change
            this.updateTimelineBadges();

            if (instant) {
                document.body.classList.add(CONFIG.CLASSES.FILTER_LAYOUT);
                return;
            }

            // Step 3: Animate layout shift for surviving cards
            setTimeout(() => {
                if (AppState.animId !== currentAnim) return;

                document.body.classList.add(CONFIG.CLASSES.FILTER_LAYOUT);

                requestAnimationFrame(() => {
                    if (AppState.animId !== currentAnim) return;

                    const animatingCards = [];
                    allCards.forEach(card => {
                        if (!card.classList.contains(CONFIG.CLASSES.SHOULD_HIDE) && firstRects.has(card)) {
                            const first = firstRects.get(card);
                            const last = card.getBoundingClientRect();
                            if (first.top !== last.top || first.left !== last.left) {
                                card.style.transition = 'none';
                                card.style.transform = `translate(${first.left - last.left}px, ${first.top - last.top}px)`;
                                animatingCards.push(card);
                            }
                        }
                    });

                    requestAnimationFrame(() => {
                        if (AppState.animId !== currentAnim) return;

                        animatingCards.forEach((card, index) => {
                            card.style.transition = `transform ${CONFIG.TIMING.ANIMATION}ms cubic-bezier(0.4, 0, 0.2, 1) ${index * 10}ms`;
                            card.style.transform = 'translate(0, 0)';
                        });

                        setTimeout(() => {
                            if (AppState.animId !== currentAnim) return;
                            animatingCards.forEach(card => {
                                card.style.transition = '';
                                card.style.transform = '';
                            });
                        }, CONFIG.TIMING.ANIMATION + (animatingCards.length * 10));
                    });
                });
            }, CONFIG.TIMING.ANIMATION);
        },

        processVenueInjection(card) {
            const mutedSpans = Array.from(card.querySelectorAll(CONFIG.SELECTORS.MUTED_TEXT));
            if (mutedSpans.length < 2) return null;

            const addressSpan = mutedSpans.pop();
            if (!addressSpan) return null;

            if (addressSpan.hasAttribute(CONFIG.ATTRS.VENUE_PROCESSED)) {
                return card.getAttribute(CONFIG.ATTRS.DATA_VENUE);
            }

            const rawAddress = addressSpan.textContent.trim();
            if (!rawAddress) return null;

            addressSpan.setAttribute(CONFIG.ATTRS.VENUE_PROCESSED, 'true');

            const normalized = normalizeAddress(rawAddress);
            let venueName = AppState.venueMap.get(normalized);

            const isKnown = !!venueName;
            if (!isKnown) venueName = CONFIG.STRINGS.UNKNOWN_VENUE;

            addressSpan.textContent = '';
            const venueNameEl = document.createElement('span');
            venueNameEl.className = isKnown ? CONFIG.CLASSES.VENUE_KNOWN : CONFIG.CLASSES.VENUE_UNKNOWN;
            venueNameEl.textContent = venueName;

            addressSpan.appendChild(venueNameEl);
            addressSpan.appendChild(document.createTextNode(' - ' + rawAddress));

            return venueName;
        },

        processEventCards() {
            if (!RouteManager.isEventsList()) {
                this.hideControls();
                return;
            }

            const eventRows = document.querySelectorAll(`${CONFIG.SELECTORS.CARD}:not(.${CONFIG.CLASSES.PROCESSED})`);
            if (eventRows.length === 0) return;

            let newSalesFound = false;
            let venuesChanged = false;
            const isUpcoming = DateUtils.isUpcomingActive();

            eventRows.forEach(card => {
                card.classList.add(CONFIG.CLASSES.PROCESSED);

                const venueName = this.processVenueInjection(card);
                if (venueName) {
                    card.setAttribute(CONFIG.ATTRS.DATA_VENUE, venueName);
                    if (!AppState.presentVenues.has(venueName)) {
                        AppState.presentVenues.add(venueName);
                        venuesChanged = true;
                    }
                }

                const timelineGroup = card.closest(CONFIG.SELECTORS.TIMELINE_ITEM);
                if (timelineGroup) {
                    const titleEl = timelineGroup.querySelector(CONFIG.SELECTORS.TIMELINE_TITLE);
                    if (titleEl) {
                        const dateText = titleEl.textContent;
                        const cacheKey = `${isUpcoming ? 'up' : 'past'}-${dateText}`;
                        let ms = AppState.timelineDateCache.get(cacheKey);

                        if (!ms) {
                            ms = DateUtils.parseToTimestamp(dateText, isUpcoming);
                            if (ms) AppState.timelineDateCache.set(cacheKey, ms);
                        }

                        if (ms) card.setAttribute(CONFIG.ATTRS.DATA_TIMESTAMP, ms);
                    }
                }

                const ticketIcon = card.querySelector(CONFIG.SELECTORS.TICKET_ICON);
                if (!ticketIcon) return;
                const inlineContainer = ticketIcon.closest(CONFIG.SELECTORS.INLINE_CONTAINER);
                if (!inlineContainer) return;
                const textSpan = inlineContainer.querySelector(CONFIG.SELECTORS.TICKET_SPAN);
                if (!textSpan) return;

                let hasSales = false;
                const match = textSpan.textContent.trim().match(/^([\d,]+)\s+of\s+/i);
                if (match && match[1]) {
                    const soldCount = parseInt(match[1].replace(/,/g, ''), 10);
                    if (!isNaN(soldCount) && soldCount > 0) hasSales = true;
                }

                card.setAttribute(CONFIG.ATTRS.DATA_SALES, hasSales ? "true" : "false");

                if (hasSales) {
                    newSalesFound = true;
                    card.classList.add(CONFIG.CLASSES.HAS_SALES, CONFIG.CLASSES.HAS_SALES_BG);
                }
            });

            if (newSalesFound || eventRows.length > 0) this.showControls();

            // Instantly apply filters (and update badges) without animation for newly loaded cards.
            this.applyFilters(true);
        },

        initObserver() {
            AppState.observer = new MutationObserver((mutations) => {
                let shouldProcess = false;
                for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];
                    if (m.addedNodes.length > 0 && m.target.id !== 'xiv-control-stack') {
                        shouldProcess = true;
                        break;
                    }
                }

                if (shouldProcess) {
                    if (AppState.debounceTimer) clearTimeout(AppState.debounceTimer);
                    AppState.debounceTimer = setTimeout(() => this.processEventCards(), CONFIG.TIMING.DEBOUNCE);
                }
            });

            AppState.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    };

    // ==========================================
    // BOOTSTRAP
    // ==========================================
    function init() {
        buildVenueMap();
        injectStyles();
        Engine.initUI();
        Engine.processEventCards();
        Engine.initObserver();
    }

    init();

})();
