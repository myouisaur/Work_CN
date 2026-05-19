// ==UserScript==
// @name         [RA] Ticket Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon.svg
// @version      4.2
// @description  Highlights events with sales.
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
        TEXT_DARK: "#151515",
        ROW_SELECTOR: "li.myEvents:not(.ra-processed)",
        DEBOUNCE_MS: 100,
        ANIMATION_MS: 300,
        STAGGER_MS: 30,
        ALLOWED_ORIGIN_SUFFIX: "ra.co"
    };

    // APP STATE
    const state = {
        debounceTimer: null,
        observer: null,
        animId: 0,
        isMutating: false
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

            /* --- LIGHTWEIGHT FLIP ANIMATION ENGINE --- */
            li.myEvents.ra-no-sales {
                transition: opacity ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) !important;
                transform-origin: center !important;
            }

            body.ra-filter-fade li.myEvents.ra-no-sales {
                opacity: 0 !important;
                transform: scale(0.95) !important;
                pointer-events: none !important;
            }

            body.ra-filter-layout li.myEvents.ra-no-sales {
                display: none !important;
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
                opacity: 1;
            }

            /* --- FLOATING SWITCH TOGGLE UI (Matching "Submit an event") --- */
            #ra-sales-toggle-container {
                position: fixed;
                bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom));
                right: clamp(16px, 3vw, 32px);
                z-index: 2147483647;
                opacity: 0;
                visibility: hidden;
                transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.3s ease, background-color 0.2s ease, border-color 0.2s ease;

                background-color: #ffffff !important;
                border: 1px solid ${CONFIG.RA_RED} !important;
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

                font-family: RobotoMono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
            }

            #ra-sales-toggle-container.is-visible {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            /* Active State Inversion */
            #ra-sales-toggle-container.is-active {
                background-color: ${CONFIG.RA_RED} !important;
                box-shadow: 0 4px 14px rgba(255, 72, 72, 0.2) !important;
            }

            /* The Switch Track */
            .ra-switch-track {
                width: 32px;
                height: 18px;
                background-color: #e5e7eb;
                border-radius: 20px;
                position: relative;
                transition: background-color 0.3s ease;
                flex-shrink: 0;
            }

            /* The Switch Knob */
            .ra-switch-knob {
                width: 14px;
                height: 14px;
                background-color: #ffffff;
                border-radius: 50%;
                position: absolute;
                top: 2px;
                left: 2px;
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            }

            /* Active Track & Knob overrides */
            #ra-sales-toggle-container.is-active .ra-switch-track {
                background-color: rgba(255, 255, 255, 0.3) !important;
            }
            #ra-sales-toggle-container.is-active .ra-switch-knob {
                transform: translateX(14px);
            }

            /* Text Label */
            .ra-toggle-label {
                font-size: 11px !important;
                font-weight: 500 !important;
                color: ${CONFIG.TEXT_DARK} !important;
                transition: color 0.2s ease, max-width 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
                white-space: nowrap;
                overflow: hidden;
                max-width: 150px;
                opacity: 1;
            }
            #ra-sales-toggle-container.is-active .ra-toggle-label {
                color: #ffffff !important;
            }

            #ra-sales-toggle-container:focus-visible { outline: 3px solid ${CONFIG.TEXT_DARK}; outline-offset: 2px; }

            /* Responsive Mobile Compact View */
            @media (max-width: 768px) {
                #ra-sales-toggle-container {
                    padding: 8px !important;
                    width: 35px !important;
                    height: 35px !important;
                    justify-content: center !important;
                    gap: 0 !important;
                }
                .ra-toggle-label {
                    max-width: 0 !important;
                    opacity: 0 !important;
                }
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
        label.textContent = "Active Sales Only";

        container.appendChild(track);
        container.appendChild(label);
        document.body.appendChild(container);

        let isFiltered = sessionStorage.getItem('ra-sales-filtered') === 'true';
        updateUIState(container, isFiltered);

        const toggleFilter = () => {
            isFiltered = !isFiltered;
            sessionStorage.setItem('ra-sales-filtered', isFiltered);
            updateUIState(container, isFiltered);
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

    function updateUIState(container, isActive) {
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
    // FLIP ANIMATION ENGINE (Lightweight CPU Compositing)
    // ==========================================

    function animateListReflow(actionFn, onComplete, threadId) {
        const activeCards = document.querySelectorAll('li.myEvents.ra-has-sales, li.ra-empty-state.is-active');

        if (activeCards.length === 0) {
            actionFn();
            if (onComplete) requestAnimationFrame(onComplete);
            return;
        }

        const firstRects = new Map();
        activeCards.forEach(card => firstRects.set(card, card.getBoundingClientRect()));

        actionFn();

        requestAnimationFrame(() => {
            if (state.animId !== threadId) return;

            activeCards.forEach(card => {
                const first = firstRects.get(card);
                const last = card.getBoundingClientRect();
                card.style.transition = 'none';
                card.style.transform = `translate(${first.left - last.left}px, ${first.top - last.top}px)`;
            });

            requestAnimationFrame(() => {
                if (state.animId !== threadId) return;

                activeCards.forEach(card => {
                    card.style.transition = `transform ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
                    card.style.transform = 'translate(0, 0)';
                });

                setTimeout(() => {
                    if (state.animId !== threadId) return;
                    activeCards.forEach(card => {
                        card.style.transition = '';
                        card.style.transform = '';
                    });
                    if (onComplete) onComplete();
                }, CONFIG.ANIMATION_MS);
            });
        });
    }

    function applyToggleState(instant = false, forcedState = null) {
        state.animId++;
        const currentAnim = state.animId;
        const isActive = forcedState !== null ? forcedState : (sessionStorage.getItem('ra-sales-filtered') === 'true');

        const hiddenCards = document.querySelectorAll('li.myEvents.ra-no-sales');
        const emptyState = document.querySelector('.ra-empty-state');
        const hasAnySales = document.querySelectorAll('li.myEvents.ra-has-sales').length > 0;
        const shouldShowEmpty = isActive && !hasAnySales;

        // Clean orphaned styles safely
        document.querySelectorAll('li.myEvents').forEach(card => card.style.removeProperty('transition-delay'));

        if (instant) {
            document.body.classList.toggle('ra-filter-fade', isActive);
            document.body.classList.toggle('ra-filter-layout', isActive);
            if (emptyState) {
                emptyState.style.display = shouldShowEmpty ? 'block' : 'none';
                emptyState.style.opacity = shouldShowEmpty ? '1' : '0';
            }
            return;
        }

        if (isActive) {
            document.body.classList.add('ra-filter-fade');

            setTimeout(() => {
                if (state.animId !== currentAnim) return;

                animateListReflow(() => {
                    if (state.animId !== currentAnim) return;
                    document.body.classList.add('ra-filter-layout');

                    if (shouldShowEmpty && emptyState) {
                        emptyState.style.display = 'block';
                        requestAnimationFrame(() => emptyState.style.opacity = '1');
                    }
                }, null, currentAnim);
            }, CONFIG.ANIMATION_MS);

        } else {
            if (emptyState) {
                emptyState.style.opacity = '0';
                setTimeout(() => {
                    if (state.animId === currentAnim && emptyState) emptyState.style.display = 'none';
                }, 200);
            }

            hiddenCards.forEach((card, index) => {
                card.style.setProperty('transition-delay', `${index * CONFIG.STAGGER_MS}ms`, 'important');
            });

            animateListReflow(() => {
                if (state.animId !== currentAnim) return;
                document.body.classList.remove('ra-filter-layout');
            }, null, currentAnim);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (state.animId !== currentAnim) return;
                    document.body.classList.remove('ra-filter-fade');

                    const totalWaterfallTime = CONFIG.ANIMATION_MS + (hiddenCards.length * CONFIG.STAGGER_MS);
                    setTimeout(() => {
                        if (state.animId !== currentAnim) return;
                        hiddenCards.forEach(card => card.style.removeProperty('transition-delay'));
                    }, totalWaterfallTime);
                });
            });
        }
    }

    // ==========================================
    // DOM PROCESSING (Performance Optimized)
    // ==========================================

    function extractVenueNode(row) {
        const greyDivs = row.querySelectorAll('.grey');
        for (let i = 0; i < greyDivs.length; i++) {
            const childNodes = greyDivs[i].childNodes;
            for (let j = 0; j < childNodes.length; j++) {
                const node = childNodes[j];
                if (node.nodeType === 3) {
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

        for (let i = 0; i < eventRows.length; i++) {
            const row = eventRows[i];
            row.classList.add('ra-processed');

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
            window.top.postMessage({ action: 'RA_EVENTS_FOUND' }, '*');
        }

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

            containersToUpdate.forEach(container => {
                const hasAnySales = container.querySelector('.ra-has-sales') !== null;
                let emptyStateNode = container.querySelector('.ra-empty-state');

                if (!emptyStateNode) {
                    emptyStateNode = document.createElement('li');
                    emptyStateNode.className = 'ra-empty-state';
                    emptyStateNode.textContent = 'No active sales in this period.';
                    container.appendChild(emptyStateNode);
                }

                const isActive = sessionStorage.getItem('ra-sales-filtered') === 'true';
                if (isActive && !hasAnySales) {
                    emptyStateNode.style.display = 'block';
                    emptyStateNode.style.opacity = '1';
                }
            });
        });
    }

    function initObserver() {
        state.observer = new MutationObserver((mutations) => {
            let shouldProcess = false;

            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    let isOwnMutation = true;
                    for (let j = 0; j < mutation.addedNodes.length; j++) {
                        const node = mutation.addedNodes[j];
                        if (node.nodeType === 3) continue;
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

            if (action === 'RA_SYNC_STATE') {
                applyToggleState(true, e.data.payloadData === true);
            } else if (action === 'RA_TOGGLE_FILTER') {
                applyToggleState(false, e.data.payloadData === true);
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
