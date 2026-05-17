// ==UserScript==
// @name         [RA] Ticket Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon-32x32.png
// @version      3.4
// @description  Highlights events with ticket sales, isolates venue names safely, and features a data-aware fluid filter.
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
        ROW_SELECTOR: "li.myEvents:not(.ra-processed)",
        DEBOUNCE_MS: 150,
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
        const style = document.createElement('style');
        style.textContent = `
            /* Phase 1: Visual Fade */
            li.myEvents.ra-no-sales {
                transition: opacity 0.3s ease;
            }
            body.ra-filter-fade li.myEvents.ra-no-sales {
                opacity: 0 !important;
                pointer-events: none;
            }

            /* Phase 2: Layout Collapse */
            body.ra-filter-layout li.myEvents.ra-no-sales {
                display: none !important;
            }

            /* Fixes text contrast for standard text on highlighted rows */
            li.myEvents.ra-has-sales .grey,
            li.myEvents.ra-has-sales .grey a {
                color: #222222 !important;
            }

            /* Makes the isolated venue name pop out */
            .ra-venue-highlight {
                color: ${CONFIG.VENUE_COLOR} !important;
                font-weight: 800 !important;
                letter-spacing: 0.2px;
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
            body.ra-filter-layout li.ra-empty-state.is-active {
                display: block;
            }
            body.ra-filter-fade li.ra-empty-state.is-active {
                opacity: 1;
            }

            /* Floating UI for the top window */
            #ra-sales-toggle-container {
                position: fixed;
                bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom));
                right: clamp(16px, 3vw, 32px);
                z-index: 2147483647;
                opacity: 0;
                visibility: hidden;
                transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s ease;
            }
            #ra-sales-toggle-container.is-visible {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }
            #ra-sales-toggle-btn {
                background-color: #111;
                color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.15);
                padding: clamp(8px, 1.5vh, 12px) clamp(16px, 2vw, 20px);
                border-radius: 50px;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: clamp(13px, 1vw, 14px);
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                transition: all 0.2s ease;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                outline: none;
            }

            /* Accessibility: Focus States */
            #ra-sales-toggle-btn:focus-visible {
                outline: 3px solid ${CONFIG.ROW_COLOR};
                outline-offset: 3px;
            }

            #ra-sales-toggle-btn:hover {
                background-color: #222;
                transform: scale(1.02);
            }
            #ra-sales-toggle-btn:active {
                transform: scale(0.98);
            }
            #ra-sales-toggle-btn .indicator {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background-color: #555;
                transition: background-color 0.2s ease;
                flex-shrink: 0;
            }
            #ra-sales-toggle-btn.is-active .indicator {
                background-color: ${CONFIG.ROW_COLOR};
                box-shadow: 0 0 8px ${CONFIG.ROW_COLOR};
            }
            .btn-text {
                transition: opacity 0.2s ease;
            }

            @media (prefers-color-scheme: light) {
                #ra-sales-toggle-btn {
                    background-color: #fff;
                    color: #111;
                    border: 1px solid rgba(0, 0, 0, 0.1);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                }
                #ra-sales-toggle-btn:hover {
                    background-color: #f5f5f5;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // TOP WINDOW UI LOGIC & ORCHESTRATION
    // ==========================================

    function initTopWindowUI() {
        if (document.getElementById('ra-sales-toggle-container')) return;

        // Toggle Filter UI
        const container = document.createElement('div');
        container.id = 'ra-sales-toggle-container';

        const btn = document.createElement('button');
        btn.id = 'ra-sales-toggle-btn';

        const indicator = document.createElement('div');
        indicator.className = 'indicator';

        const textSpan = document.createElement('span');
        textSpan.className = 'btn-text';

        btn.appendChild(indicator);
        btn.appendChild(textSpan);
        container.appendChild(btn);
        document.body.appendChild(container);

        // State initialization
        let isFiltered = sessionStorage.getItem('ra-sales-filtered') === 'true';
        let currentSalesCount = null;
        updateUIState(btn, isFiltered, currentSalesCount);

        let isAnimating = false;

        btn.addEventListener('click', () => {
            if (isAnimating) return;
            isAnimating = true;

            isFiltered = !isFiltered;
            sessionStorage.setItem('ra-sales-filtered', isFiltered);
            updateUIState(btn, isFiltered, currentSalesCount);

            if (isFiltered) {
                broadcastCommand('RA_FADE_OUT');
                setTimeout(() => {
                    broadcastCommand('RA_HIDE_LAYOUT');
                    isAnimating = false;
                }, 300);
            } else {
                broadcastCommand('RA_SHOW_LAYOUT');
                setTimeout(() => {
                    broadcastCommand('RA_FADE_IN');
                    isAnimating = false;
                }, 50);
            }
        });

        // Message Listener for revealing the button and updating counts
        window.addEventListener('message', (e) => {
            if (!isSafeOrigin(e.origin)) return;

            if (e.data && e.data.action === 'RA_EVENTS_FOUND') {
                container.classList.add('is-visible');

                if (typeof e.data.count === 'number') {
                    currentSalesCount = e.data.count;
                    updateUIState(btn, isFiltered, currentSalesCount);
                }
            }
        });

        // Immediately sync truth state down to iframes to bypass sessionStorage isolation
        broadcastCommand('RA_SYNC_STATE', isFiltered);
    }

    function updateUIState(btn, isActive, count) {
        const textSpan = btn.querySelector('.btn-text');
        const countText = count !== null ? ` (${count})` : '';

        if (isActive) {
            btn.classList.add('is-active');
            textSpan.textContent = `Filtered: Active sales only${countText}`;
        } else {
            btn.classList.remove('is-active');
            textSpan.textContent = `Show only events with sales${countText}`;
        }
    }

    function broadcastCommand(action, payloadData = null) {
        const payload = { action, payloadData };
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                if (iframe.contentWindow) iframe.contentWindow.postMessage(payload, '*');
            } catch (error) {}
        });
    }

    function isSafeOrigin(origin) {
        return origin && origin.endsWith(CONFIG.ALLOWED_ORIGIN_SUFFIX);
    }

    // ==========================================
    // EVENT PROCESSING (Runs where events exist)
    // ==========================================

    /**
     * Extracts the specific venue text node safely, preventing deep nesting.
     */
    function extractVenueNode(row) {
        const greyDivs = row.querySelectorAll('.grey');
        for (const div of greyDivs) {
            for (const node of div.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    // Captures: 1 = "at ", 2 = Venue Name, 3 = ", "
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

        const rowsWithSales = [];
        const parentContainers = new Set();
        let newSalesFound = 0;

        // Phase 1: DOM Read & Mark
        eventRows.forEach(row => {
            row.classList.add('ra-processed');
            if (row.parentElement) parentContainers.add(row.parentElement);

            const statsLink = row.querySelector('.stats a') || row.querySelector('.stats');
            let hasSales = false;

            if (statsLink && statsLink.textContent) {
                const text = statsLink.textContent.trim();
                const match = text.match(/(\d+)\s*tickets?\s*sold/i);

                if (match) {
                    const count = parseInt(match[1], 10);
                    if (!isNaN(count) && count > 0) {
                        hasSales = true;
                    }
                }
            }

            if (hasSales) {
                newSalesFound++;
                const { venueTextNode, venueMatch } = extractVenueNode(row);
                rowsWithSales.push({ row, venueTextNode, venueMatch });
                row.classList.add('ra-has-sales');
            } else {
                row.classList.add('ra-no-sales');
            }
        });

        state.activeSalesCount += newSalesFound;

        // Phase 2: Batched Style Mutations
        if (rowsWithSales.length > 0 || parentContainers.size > 0) {
            requestAnimationFrame(() => {
                rowsWithSales.forEach(({ row, venueTextNode, venueMatch }) => {
                    row.style.setProperty('background-color', CONFIG.ROW_COLOR, 'important');
                    row.style.setProperty('transition', 'background-color 0.4s ease', 'important');

                    // Security: Try/Catch isolates DOM manipulation errors per row
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
                        } catch (e) {
                            console.warn("[RA Ticket Sales] Failed to isolate venue name:", e);
                        }
                    }
                });

                parentContainers.forEach(container => {
                    let emptyStateNode = container.querySelector('.ra-empty-state');
                    if (!emptyStateNode) {
                        emptyStateNode = document.createElement('li');
                        emptyStateNode.className = 'ra-empty-state';
                        emptyStateNode.textContent = 'No active sales in this period.';
                        container.appendChild(emptyStateNode);
                    }

                    const allEvents = Array.from(container.querySelectorAll('li.myEvents'));
                    const anySales = allEvents.some(li => li.classList.contains('ra-has-sales'));

                    if (!anySales) {
                        emptyStateNode.classList.add('is-active');
                    } else {
                        emptyStateNode.classList.remove('is-active');
                    }
                });
            });
        }

        // Broadcast success and count to the orchestrator window
        window.top.postMessage({ action: 'RA_EVENTS_FOUND', count: state.activeSalesCount }, '*');
    }

    function initObserver() {
        state.observer = new MutationObserver((mutations) => {
            let shouldProcess = false;

            // Performance: Intelligently ignore the script's own DOM mutations to prevent loops
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    const isOwnMutation = Array.from(mutation.addedNodes).every(node => {
                        if (node.nodeType === Node.TEXT_NODE) return true;
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            return node.classList.contains('ra-venue-highlight') ||
                                   node.classList.contains('ra-empty-state');
                        }
                        return false;
                    });

                    if (!isOwnMutation) {
                        shouldProcess = true;
                        break;
                    }
                }
            }

            if (shouldProcess) {
                if (state.debounceTimer) clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(() => {
                    processTicketSales();
                }, CONFIG.DEBOUNCE_MS);
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

            switch(action) {
                case 'RA_SYNC_STATE':
                    // Force state sync directly from top window immediately on load
                    if (e.data.payloadData === true) {
                        document.body.classList.add('ra-filter-fade', 'ra-filter-layout');
                    }
                    break;
                case 'RA_FADE_OUT':
                    document.body.classList.add('ra-filter-fade');
                    break;
                case 'RA_FADE_IN':
                    document.body.classList.remove('ra-filter-fade');
                    break;
                case 'RA_HIDE_LAYOUT':
                    document.body.classList.add('ra-filter-layout');
                    break;
                case 'RA_SHOW_LAYOUT':
                    document.body.classList.remove('ra-filter-layout');
                    break;
            }
        });
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    function init() {
        injectBaseStyles();

        // Best effort fallback sync for isolated tabs (if not iframed)
        const isCurrentlyFiltered = sessionStorage.getItem('ra-sales-filtered') === 'true';
        if (isCurrentlyFiltered && window.top === window.self) {
            document.body.classList.add('ra-filter-fade', 'ra-filter-layout');
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
