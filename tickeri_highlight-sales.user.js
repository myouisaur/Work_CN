// ==UserScript==
// @name         [Tickeri] Ticket Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.tickeri.com/promoter/tickeri-eo-favicon.ico
// @version      3.3
// @description  Highlights events with sales.
// @author       Xiv
// @match        *://*.tickeri.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/tickeri_highlight-sales.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/tickeri_highlight-sales.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__tickeriHighlighterRunning) return;
    window.__tickeriHighlighterRunning = true;

    // ==========================================
    // CONFIGURATION & STATE
    // ==========================================
    const CONFIG = {
        COLOR_SOLD: "#81c784",
        COLOR_ZERO: "#e57373",
        DEBOUNCE_MS: 150,
        ANIMATION_MS: 300,
        STAGGER_MS: 30
    };

    const ICONS = {
        FILTER: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`,
        EMPTY: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 12px auto; opacity: 0.4;"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>`
    };

    const state = {
        debounceTimer: null,
        isMutating: false,
        animId: 0,
        observer: null,
        activeSalesCount: 0,
        cachedFilterContainer: null // Optimization: Prevent redundant DOM searching
    };

    // ==========================================
    // STYLING INJECTION
    // ==========================================

    function injectBaseStyles() {
        if (document.getElementById('tk-custom-styles')) return;
        const style = document.createElement('style');
        style.id = 'tk-custom-styles';
        style.textContent = `
            .tk-highlight-wrapper {
                border-radius: 6px !important;
                padding: 4px 8px !important;
                transition: background-color 0.2s ease !important;
            }
            .tk-highlight-wrapper h3 { color: #000000 !important; }
            .tk-has-sales.tk-highlight-wrapper { background-color: ${CONFIG.COLOR_SOLD} !important; }
            .tk-no-sales.tk-highlight-wrapper { background-color: ${CONFIG.COLOR_ZERO} !important; }

            /* ANIMATION ORCHESTRATION */
            li.tk-event-card.tk-no-sales {
                transition: opacity ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) !important;
                transform-origin: center !important;
            }
            body.tk-filter-fade li.tk-event-card.tk-no-sales {
                opacity: 0 !important;
                transform: scale(0.90) !important;
                pointer-events: none !important;
            }
            body.tk-filter-layout li.tk-event-card.tk-no-sales {
                display: none !important;
            }

            /* TOGGLE BUTTON STYLING */
            #tk-native-toggle-btn {
                margin-left: auto !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 6px !important;
                height: 32px !important;
                padding: 0 16px !important;
                border: 2px solid transparent !important;
                transition: all 0.2s ease-in-out !important;
                box-sizing: border-box !important;
                border-radius: 50px !important;
                font-size: 0.75rem !important;
            }
            #tk-native-toggle-btn.tk-is-active {
                background-color: ${CONFIG.COLOR_SOLD} !important;
                color: #000000 !important;
                border: 1px solid ${CONFIG.COLOR_SOLD} !important;
                box-shadow: 0 4px 12px rgba(129, 199, 132, 0.4) !important;
                font-weight: 700 !important;
            }
            #tk-native-toggle-btn:not(.tk-is-active) {
                background-color: transparent !important;
                color: #4b5563 !important;
                border: 1px solid #9ca3af !important;
            }
            #tk-native-toggle-btn:not(.tk-is-active):hover {
                background-color: #f3f4f6 !important;
                border-color: #6b7280 !important;
                color: #111827 !important;
            }

            /* EMPTY STATE */
            #tk-empty-state {
                display: none;
                text-align: center;
                padding: 60px 20px;
                color: #6b7280;
                background: white;
                border-radius: 8px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                margin: 20px 0;
                opacity: 0;
                transition: opacity 0.3s ease;
                grid-column: 1 / -1;
            }

            /* REACT-SAFE PAGINATION TELEPORTATION */
            .tk-relative-parent { position: relative !important; }
            .tk-pagination-teleported {
                position: absolute !important;
                top: 24px !important;
                right: 24px !important;
                margin: 0 !important;
                padding: 0 !important;
                z-index: 10 !important;
            }
            @media (max-width: 1024px) {
                .tk-pagination-teleported {
                    position: static !important;
                    margin-top: 1rem !important;
                    justify-content: flex-end !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // UI DOM MANIPULATION
    // ==========================================

    function getFilterContainer() {
        // Optimization: Cache validation
        if (state.cachedFilterContainer && document.body.contains(state.cachedFilterContainer)) {
            return state.cachedFilterContainer;
        }

        // Re-scan if lost
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent.trim().startsWith('All (')) {
                state.cachedFilterContainer = btn.parentElement;
                return state.cachedFilterContainer;
            }
        }
        return null;
    }

    function relocatePagination() {
        // Optimization: Early exit if already done
        if (document.querySelector('.tk-pagination-teleported')) return;

        const leftChevron = document.querySelector('svg[name="chevron_left"]');
        if (!leftChevron) return;

        const paginationWrapper = leftChevron.closest('.my-4.flex.justify-end') || leftChevron.closest('.flex.justify-end');
        if (!paginationWrapper) return;

        const mainContainer = paginationWrapper.closest('.my-5.h-full') || paginationWrapper.parentElement;
        if (mainContainer) {
            mainContainer.classList.add('tk-relative-parent');
            paginationWrapper.classList.add('tk-pagination-teleported');
            paginationWrapper.classList.remove('my-4');
        }
    }

    function injectEmptyState() {
        if (document.getElementById('tk-empty-state')) return;

        // Find the first grid list
        let targetGrid = null;
        for (const grid of document.querySelectorAll('ul[class*="grid"]')) {
            if (grid.firstElementChild && grid.firstElementChild.tagName === 'LI') {
                targetGrid = grid;
                break;
            }
        }

        if (targetGrid) {
            const emptyDiv = document.createElement('div');
            emptyDiv.id = 'tk-empty-state';
            emptyDiv.innerHTML = `
                ${ICONS.EMPTY}
                <div style="font-size: 16px; font-weight: 600; color: #111827;">No active sales found</div>
                <div style="font-size: 14px; margin-top: 4px;">Turn off the filter to see all events in this view.</div>
            `;
            targetGrid.parentNode.insertBefore(emptyDiv, targetGrid.nextSibling);
        }
    }

    function syncToggleUI() {
        const container = getFilterContainer();
        if (!container) return;

        let btn = document.getElementById('tk-native-toggle-btn');

        if (!btn || !container.contains(btn)) {
            if (btn) btn.remove();

            btn = document.createElement('button');
            btn.id = 'tk-native-toggle-btn';
            btn.type = 'button';
            btn.className = "focus:shadow-outline-indigo font-semibold antialiased focus:outline-none whitespace-nowrap";

            btn.addEventListener('click', () => {
                const isActive = sessionStorage.getItem('tk-sales-filtered') !== 'true';
                sessionStorage.setItem('tk-sales-filtered', isActive);
                applyToggleState(false);
            });

            container.appendChild(btn);
        }

        btn.innerHTML = `${ICONS.FILTER} <span>Filter: Active Sales (${state.activeSalesCount})</span>`;

        const isActive = sessionStorage.getItem('tk-sales-filtered') === 'true';
        btn.classList.toggle('tk-is-active', isActive);
    }

    // ==========================================
    // FLIP ENGINE & ORCHESTRATION
    // ==========================================

    function animateGridReflow(actionFn, onComplete, threadId) {
        const activeCards = document.querySelectorAll('li.tk-event-card.tk-has-sales');

        // Optimization: Early exit if no active cards to animate
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

    function applyToggleState(instant = false) {
        state.animId++;
        const currentAnim = state.animId;
        const isActive = sessionStorage.getItem('tk-sales-filtered') === 'true';

        const hiddenCards = document.querySelectorAll('li.tk-event-card.tk-no-sales');
        const totalCards = document.querySelectorAll('li.tk-event-card').length;
        const emptyState = document.getElementById('tk-empty-state');
        const shouldShowEmpty = isActive && state.activeSalesCount === 0 && totalCards > 0;

        // Clean orphaned styles safely
        document.querySelectorAll('li.tk-event-card').forEach(card => card.style.removeProperty('transition-delay'));

        if (instant) {
            document.body.classList.toggle('tk-filter-fade', isActive);
            document.body.classList.toggle('tk-filter-layout', isActive);
            if (emptyState) {
                emptyState.style.display = shouldShowEmpty ? 'block' : 'none';
                emptyState.style.opacity = shouldShowEmpty ? '1' : '0';
            }
            syncToggleUI();
            return;
        }

        if (isActive) {
            document.body.classList.add('tk-filter-fade');
            syncToggleUI();

            setTimeout(() => {
                if (state.animId !== currentAnim) return;

                animateGridReflow(() => {
                    if (state.animId !== currentAnim) return;
                    document.body.classList.add('tk-filter-layout');
                    if (shouldShowEmpty && emptyState) {
                        emptyState.style.display = 'block';
                        requestAnimationFrame(() => emptyState.style.opacity = '1');
                    }
                }, null, currentAnim);
            }, CONFIG.ANIMATION_MS);

        } else {
            syncToggleUI();

            if (emptyState) {
                emptyState.style.opacity = '0';
                setTimeout(() => {
                    if (state.animId === currentAnim && emptyState) emptyState.style.display = 'none';
                }, 200);
            }

            hiddenCards.forEach((card, index) => {
                card.style.setProperty('transition-delay', `${index * CONFIG.STAGGER_MS}ms`, 'important');
            });

            animateGridReflow(() => {
                if (state.animId !== currentAnim) return;
                document.body.classList.remove('tk-filter-layout');
            }, null, currentAnim);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (state.animId !== currentAnim) return;
                    document.body.classList.remove('tk-filter-fade');

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
    // DOM PROCESSING (Read & Write)
    // ==========================================

    function processTickets() {
        injectEmptyState();
        relocatePagination();

        // Optimization: Loop NodeList directly (no Array.from allocation)
        const h3Nodes = document.querySelectorAll('h3');
        const targets = [];
        let activeCount = 0;

        for (const node of h3Nodes) {
            if (node.textContent.trim() === 'Tickets sold') {
                const wrapper = node.parentNode;
                const flexDiv = wrapper.querySelector('div');
                if (!flexDiv) continue;

                const countNode = flexDiv.querySelector('h3');
                if (!countNode) continue;

                const count = parseInt(countNode.textContent.trim().replace(/,/g, ''), 10);

                if (!isNaN(count)) {
                    const liCard = wrapper.closest('li');
                    if (liCard) {
                        if (count > 0) activeCount++;

                        const needsProcessing = !wrapper.classList.contains('tk-processed') ||
                                              (count > 0 && wrapper.classList.contains('tk-no-sales')) ||
                                              (count === 0 && wrapper.classList.contains('tk-has-sales'));

                        if (needsProcessing) targets.push({ wrapper, liCard, count });
                    }
                }
            }
        }

        if (state.activeSalesCount !== activeCount || document.getElementById('tk-native-toggle-btn') === null) {
            state.activeSalesCount = activeCount;
            syncToggleUI();
        }

        if (targets.length === 0) return;

        state.isMutating = true;
        requestAnimationFrame(() => {
            for (const { wrapper, liCard, count } of targets) {
                // Apply classes explicitly instead of swapping redundantly
                wrapper.classList.add('tk-processed', 'tk-highlight-wrapper');
                liCard.classList.add('tk-event-card');

                if (count > 0) {
                    wrapper.classList.add('tk-has-sales');
                    wrapper.classList.remove('tk-no-sales');
                    liCard.classList.add('tk-has-sales');
                    liCard.classList.remove('tk-no-sales');
                } else {
                    wrapper.classList.add('tk-no-sales');
                    wrapper.classList.remove('tk-has-sales');
                    liCard.classList.add('tk-no-sales');
                    liCard.classList.remove('tk-has-sales');
                }
            }
            requestAnimationFrame(() => state.isMutating = false);
        });
    }

    function initObserver() {
        state.observer = new MutationObserver((mutations) => {
            let isTabSwitch = false;
            for (const m of mutations) {
                if (m.removedNodes.length > 5 || (m.removedNodes.length > 0 && m.target.tagName === 'UL')) {
                    isTabSwitch = true;
                    break;
                }
            }
            if (isTabSwitch) state.animId++;

            if (state.isMutating) return;

            if (state.debounceTimer) clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(processTickets, CONFIG.DEBOUNCE_MS);
        });

        state.observer.observe(document.body, { childList: true, subtree: true });
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    function init() {
        injectBaseStyles();
        applyToggleState(true);
        processTickets();
        initObserver();
    }

    init();

})();
