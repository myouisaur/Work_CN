// ==UserScript==
// @name         [RA] Ticket Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon-32x32.png
// @version      4.0
// @description  Highlights events with ticket sales.
// @author       Xiv
// @match        *://*.ra.co/*
// @updateURL    https://myouisaur.github.io/Work_CN/RA_ticket-sales-highlighter.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA_ticket-sales-highlighter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Duplicate execution guard for SPA stability
    if (window.__raTicketHighlighterRunning) return;
    window.__raTicketHighlighterRunning = true;

    // CONFIGURATION
    const CONFIG = {
        ROW_COLOR: "#90e0b4", // Mint Green highlight
        VENUE_COLOR: "#1e3a8a", // Deep Royal Blue for contrast
        RA_RED: "#ff4848", // RA Native Action Color
        ROW_SELECTOR: "li.myEvents:not(.ra-processed)",
        DEBOUNCE_MS: 100, // Reduced for snappier loading
        ALLOWED_ORIGIN_SUFFIX: "ra.co"
    };

    // APP STATE
    const state = {
        debounceTimer: null,
        observer: null,
        activeSalesCount: 0
    };

    // ==========================================
    // STYLING INJECTION (Runs in all frames)
    // ==========================================

    function injectBaseStyles() {
        if (document.getElementById('ra-custom-styles')) return;

        const style = document.createElement('style');
        style.id = 'ra-custom-styles';
        style.textContent = `
            /* Highlight Classes */
            .ra-has-sales-bg {
                background-color: ${CONFIG.ROW_COLOR} !important;
                transition: background-color 0.4s ease !important;
            }
            li.myEvents.ra-has-sales .grey,
            li.myEvents.ra-has-sales .grey a {
                color: #222222 !important;
            }
            .ra-venue-highlight {
                color: ${CONFIG.VENUE_COLOR} !important;
                font-weight: 800 !important;
                letter-spacing: 0.2px;
            }

            /* --- HARDWARE ACCELERATED ACCORDION ANIMATION --- */
            li.myEvents.ra-no-sales {
                transition: opacity 0.3s ease, max-height 0.3s ease, padding 0.3s ease, margin 0.3s ease, border 0.3s ease;
                transform-origin: top;
                max-height: 400px; /* Safe bounds for RA blocks */
                overflow: hidden; /* Required for fluid height collapse */
            }

            body.ra-filter-active li.myEvents.ra-no-sales {
                max-height: 0 !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                opacity: 0 !important;
                border: none !important;
                pointer-events: none !important;
            }

            /* Empty state styling */
            li.ra-empty-state {
                display: none;
                padding: clamp(16px, 3vh, 24px);
                text-align: center;
                color: #666;
                font-size: clamp(13px, 1vw, 14px);
                background: #f5f5f5;
                border-radius: 8px;
                margin: 10px 0;
                font-style: italic;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            body.ra-filter-active li.ra-empty-state.is-active {
                display: block;
                opacity: 1;
            }

            /* --- FLOATING SWITCH TOGGLE UI --- */
            #ra-sales-toggle-container {
                position: fixed;
                bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom));
                right: clamp(16px, 3vw, 32px);
                z-index: 2147483647;
                opacity: 0;
                visibility: hidden;
                transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s ease, border-color 0.3s ease;

                background-color: #ffffff;
                border: 1px solid #222222;
                border-radius: 50px;
                padding: 8px 16px 8px 12px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                user-select: none;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            }

            #ra-sales-toggle-container.is-visible {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            #ra-sales-toggle-container.is-active {
                border-color: ${CONFIG.RA_RED};
                box-shadow: 0 4px 14px rgba(255, 72, 72, 0.15);
            }

            .ra-switch-track {
                width: 36px;
                height: 20px;
                background-color: #cccccc;
                border-radius: 20px;
                position: relative;
                transition: background-color 0.3s ease;
                flex-shrink: 0;
            }

            .ra-switch-knob {
                width: 16px;
                height: 16px;
                background-color: #ffffff;
                border-radius: 50%;
                position: absolute;
                top: 2px;
                left: 2px;
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            }

            #ra-sales-toggle-container.is-active .ra-switch-track { background-color: ${CONFIG.RA_RED}; }
            #ra-sales-toggle-container.is-active .ra-switch-knob { transform: translateX(16px); }

            .ra-toggle-label {
                font-size: clamp(12px, 1vw, 13px);
                font-weight: 500;
                color: #222222;
                transition: color 0.3s ease;
            }
            #ra-sales-toggle-container.is-active .ra-toggle-label { color: ${CONFIG.RA_RED}; }

            #ra-sales-toggle-container:focus-visible { outline: 3px solid #222; outline-offset: 2px; }

            @media (max-width: 768px) {
                #ra-sales-toggle-container { padding: 10px; gap: 0; }
                .ra-toggle-label { display: none; }
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // TOP WINDOW UI LOGIC
    // ==========================================

    function initTopWindowUI() {
        if (document.getElementById('ra-sales-toggle-container')) return;

        const container = document.createElement('div');
        container.id = 'ra-sales-toggle-container';
        container.setAttribute('role', 'switch');
        container.setAttribute('tabindex', '0');

        const track = document.createElement('div');
        track.className = 'ra-switch-track';

        const knob = document.createElement('div');
        knob.className = 'ra-switch-knob';
        track.appendChild(knob);

        const label = document.createElement('span');
        label.className = 'ra-toggle-label';

        container.appendChild(track);
        container.appendChild(label);
        document.body.appendChild(container);

        let isFiltered = sessionStorage.getItem('ra-sales-filtered') === 'true';
        updateUIState(container, label, isFiltered);

        const toggleFilter = () => {
            isFiltered = !isFiltered;
            sessionStorage.setItem('ra-sales-filtered', isFiltered);
            updateUIState(container, label, isFiltered);
            broadcastCommand('RA_TOGGLE_FILTER', isFiltered);
        };

        container.addEventListener('click', toggleFilter);
        container.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleFilter();
            }
        });

        window.addEventListener('message', (e) => {
            if (!isSafeOrigin(e.origin)) return;
            if (e.data && e.data.action === 'RA_EVENTS_FOUND') {
                container.classList.add('is-visible');
            }
        });

        broadcastCommand('RA_SYNC_STATE', isFiltered);
    }

    function updateUIState(container, labelNode, isActive) {
        labelNode.textContent = "Active Sales Only";
        if (isActive) {
            container.classList.add('is-active');
            container.setAttribute('aria-checked', 'true');
        } else {
            container.classList.remove('is-active');
            container.setAttribute('aria-checked', 'false');
        }
    }

    function broadcastCommand(action, payloadData = null) {
        const payload = { action, payloadData };
        // Memory Opt: Native loop
        const frames = document.querySelectorAll('iframe');
        for (let i = 0; i < frames.length; i++) {
            try {
                if (frames[i].contentWindow) frames[i].contentWindow.postMessage(payload, '*');
            } catch (error) {}
        }
    }

    function isSafeOrigin(origin) {
        return origin && origin.endsWith(CONFIG.ALLOWED_ORIGIN_SUFFIX);
    }

    // ==========================================
    // DOM PROCESSING (Performance Optimized)
    // ==========================================

    function extractVenueNode(row) {
        const greyDivs = row.querySelectorAll('.grey');
        // Memory Opt: Native loops to prevent Array allocations
        for (let i = 0; i < greyDivs.length; i++) {
            const childNodes = greyDivs[i].childNodes;
            for (let j = 0; j < childNodes.length; j++) {
                const node = childNodes[j];
                if (node.nodeType === 3) { // Node.TEXT_NODE
                    const match = node.nodeValue.match(/^(\s*at\s+)(.*?)(,\s*)?$/);
                    if (match && match[2]) return { venueTextNode: node, venueMatch: match };
                }
            }
        }
        return { venueTextNode: null, venueMatch: null };
    }

    function processTicketSales() {
        const eventRows = document.querySelectorAll(CONFIG.ROW_SELECTOR);
        if (eventRows.length === 0) return;

        const targets = [];
        const containersToUpdate = new Set();
        let newSalesFound = 0;

        // PHASE 1: Fast DOM Read
        for (let i = 0; i < eventRows.length; i++) {
            const row = eventRows[i];
            row.classList.add('ra-processed'); // Mark early

            if (row.parentElement) containersToUpdate.add(row.parentElement);

            const statsLink = row.querySelector('.stats a, .stats');
            let hasSales = false;

            if (statsLink && statsLink.textContent) {
                const match = statsLink.textContent.trim().match(/(\d+)\s*tickets?\s*sold/i);
                if (match && parseInt(match[1], 10) > 0) {
                    hasSales = true;
                }
            }

            if (hasSales) {
                newSalesFound++;
                const { venueTextNode, venueMatch } = extractVenueNode(row);
                targets.push({ row, hasSales: true, venueTextNode, venueMatch });
            } else {
                targets.push({ row, hasSales: false });
            }
        }

        if (newSalesFound > 0) {
            state.activeSalesCount += newSalesFound;
            window.top.postMessage({ action: 'RA_EVENTS_FOUND' }, '*');
        }

        // PHASE 2: Batched DOM Write via rAF
        requestAnimationFrame(() => {
            for (let i = 0; i < targets.length; i++) {
                const { row, hasSales, venueTextNode, venueMatch } = targets[i];

                if (hasSales) {
                    row.classList.add('ra-has-sales', 'ra-has-sales-bg');
                    if (venueTextNode && venueMatch) {
                        try {
                            const parent = venueTextNode.parentNode;
                            const leadingNode = document.createTextNode(venueMatch[1]);
                            const venueSpan = document.createElement('span');
                            venueSpan.className = 'ra-venue-highlight';
                            venueSpan.textContent = venueMatch[2];
                            const trailingNode = document.createTextNode(venueMatch[3] || "");

                            parent.insertBefore(leadingNode, venueTextNode);
                            parent.insertBefore(venueSpan, venueTextNode);
                            parent.insertBefore(trailingNode, venueTextNode);
                            parent.removeChild(venueTextNode);
                        } catch (e) {}
                    }
                } else {
                    row.classList.add('ra-no-sales');
                }
            }

            // Efficient Empty State check (O(1) fast-exit via querySelector)
            containersToUpdate.forEach(container => {
                const hasAnySales = container.querySelector('.ra-has-sales') !== null;

                let emptyStateNode = container.querySelector('.ra-empty-state');
                if (!emptyStateNode) {
                    emptyStateNode = document.createElement('li');
                    emptyStateNode.className = 'ra-empty-state';
                    emptyStateNode.textContent = 'No active sales in this period.';
                    container.appendChild(emptyStateNode);
                }
                emptyStateNode.classList.toggle('is-active', !hasAnySales);
            });
        });
    }

    function initObserver() {
        state.observer = new MutationObserver((mutations) => {
            let shouldProcess = false;

            // Memory Opt: Prevent Arrays inside the observer
            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    let isOwnMutation = true;
                    for (let j = 0; j < mutation.addedNodes.length; j++) {
                        const node = mutation.addedNodes[j];
                        if (node.nodeType === 3) continue; // TEXT_NODE
                        if (node.nodeType === 1 && (node.classList.contains('ra-venue-highlight') || node.classList.contains('ra-empty-state'))) {
                            continue;
                        }
                        isOwnMutation = false;
                        break;
                    }

                    if (!isOwnMutation) {
                        shouldProcess = true;
                        break;
                    }
                }
            }

            if (shouldProcess) {
                if (state.debounceTimer) clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(processTicketSales, CONFIG.DEBOUNCE_MS);
            }
        });

        state.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // ==========================================
    // FRAME MESSAGE LISTENER
    // ==========================================

    function initMessageListener() {
        window.addEventListener('message', (e) => {
            if (!isSafeOrigin(e.origin)) return;
            const action = e.data?.action;
            if (!action) return;

            if (action === 'RA_SYNC_STATE' || action === 'RA_TOGGLE_FILTER') {
                const isActive = e.data.payloadData === true;
                document.body.classList.toggle('ra-filter-active', isActive);
            }
        });
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    function init() {
        injectBaseStyles();

        const isCurrentlyFiltered = sessionStorage.getItem('ra-sales-filtered') === 'true';
        if (isCurrentlyFiltered && window.top === window.self) {
            document.body.classList.add('ra-filter-active');
        }

        if (window.top === window.self) {
            initTopWindowUI();
        }

        initMessageListener();
        processTicketSales();
        initObserver();
    }

    init();

})();
