// ==UserScript==
// @name         [Tickeri] Event Filter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.tickeri.com/promoter/tickeri-eo-favicon.ico
// @version      4.4
// @description  Filters and highlights events on the dashboard by sales activity and text search.
// @author       Xiv
// @match        *://*.tickeri.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/tickeri_event-filter.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/tickeri_event-filter.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__tickeriOmniFilterRunning) return;
    window.__tickeriOmniFilterRunning = true;

    // ==========================================
    // CONFIGURATION & STATE
    // ==========================================

    const CONFIG = {
        DEBUG: false, // Set to true for diagnostic console logs
        COLOR_SOLD: "#81c784",
        COLOR_ZERO: "#e57373",
        DEBOUNCE_MS: 200,
        ANIMATION_MS: 300,
        STAGGER_MS: 30,
        TARGET_CONTAINER_SELECTOR: '.my-5.h-full.rounded.rounded-t-lg.bg-white.pb-2.shadow-sm',
        STRING_TICKETS_SOLD: 'Tickets sold'
    };

    const ICONS = {
        FILTER: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`,
        EMPTY: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 12px auto; opacity: 0.4;"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>`,
        SEARCH: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg>`,
        CLEAR: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`
    };

    const state = {
        debounceTimer: null,
        isMutating: false,
        animId: 0,
        observer: null,
        observedNode: null,
        activeSalesCount: 0,
        searchQuery: "",
        cachedFilterContainer: null,
        isSalesFilterActive: localStorage.getItem('tk-sales-filtered') === 'true' // Load preference across sessions
    };

    // ==========================================
    // UTILITIES
    // ==========================================

    function log(...args) {
        if (CONFIG.DEBUG) console.log('[Tickeri Omni Filter]', ...args);
    }

    const parsedIcons = {};
    function getIcon(key) {
        if (!parsedIcons[key]) {
            parsedIcons[key] = new DOMParser().parseFromString(ICONS[key], 'image/svg+xml').documentElement;
        }
        return parsedIcons[key].cloneNode(true);
    }

    function el(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') element.className = value;
            else if (key === 'textContent') element.textContent = value;
            else if (key === 'onClick') element.addEventListener('click', value);
            else if (key === 'onInput') element.addEventListener('input', value);
            else element.setAttribute(key, value);
        }
        children.forEach(child => element.appendChild(child));
        return element;
    }

    // ==========================================
    // STYLING INJECTION
    // ==========================================

    function injectStyles() {
        if (document.getElementById('tk-omni-styles')) return;
        const css = `
            /* CARD STATES */
            .tk-evt-highlight-wrapper { border-radius: 6px !important; padding: 4px 8px !important; transition: background-color 0.2s ease !important; }
            .tk-evt-highlight-wrapper h3 { color: #000000 !important; }
            .tk-evt-has-sales.tk-evt-highlight-wrapper { background-color: ${CONFIG.COLOR_SOLD} !important; }
            .tk-evt-no-sales.tk-evt-highlight-wrapper { background-color: ${CONFIG.COLOR_ZERO} !important; }

            /* UNIFIED ANIMATION ENGINE */
            li.tk-evt-card { transition: opacity ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) !important; transform-origin: center !important; }
            li.tk-evt-card.tk-fade-hidden { opacity: 0 !important; transform: scale(0.90) !important; pointer-events: none !important; }
            li.tk-evt-card.tk-layout-hidden { display: none !important; }

            /* SEARCH UI */
            .tk-search-container { display: flex; justify-content: flex-start; align-items: center; padding: 1rem 1.5rem 0.5rem 1.5rem; background: transparent; position: relative; z-index: 10; }
            .tk-search-wrapper { position: relative; flex: 1; min-width: 250px; }
            .tk-search-input { width: 100%; padding: 0.6rem 2.5rem 0.6rem 1.25rem; border: 1px solid #d1d5db; border-radius: 9999px; font-family: inherit; font-size: 0.875rem; color: #111827; background-color: #f9fafb; outline: none; transition: all 0.2s ease; box-sizing: border-box; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); }
            .tk-search-input:focus { background-color: #ffffff; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
            .tk-search-icon, .tk-search-clear-btn { position: absolute; top: 50%; transform: translateY(-50%); color: #9ca3af; display: flex; align-items: center; justify-content: center; width: 1.2rem; height: 1.2rem; }
            .tk-search-icon { right: 1.1rem; pointer-events: none; }
            .tk-search-clear-btn { right: 0.5rem; background: none; border: none; cursor: pointer; padding: 0.4rem; border-radius: 50%; display: none; transition: color 0.2s ease, background-color 0.2s ease; }
            .tk-search-clear-btn:hover { color: #374151; background-color: #e5e7eb; }
            .tk-search-wrapper.has-query .tk-search-icon { display: none; }
            .tk-search-wrapper.has-query .tk-search-clear-btn { display: flex; }

            /* DYNAMIC SEARCH COUNTER */
            .tk-search-counter { font-size: 0.875rem; color: #6b7280; font-weight: 500; white-space: nowrap; opacity: 0; max-width: 0; overflow: hidden; margin-left: 0; transform: translateX(-10px); transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
            .tk-search-counter.visible { opacity: 1; max-width: 300px; margin-left: 1rem; transform: translateX(0); }

            /* SHORTCUT HINT */
            .tk-shortcut-hint { position: absolute; right: 2.2rem; top: 50%; transform: translateY(-50%); font-size: 0.65rem; color: #9ca3af; border: 1px solid #d1d5db; border-radius: 4px; padding: 0.1rem 0.3rem; pointer-events: none; transition: opacity 0.2s ease; }
            .tk-search-wrapper.has-query .tk-shortcut-hint, .tk-search-input:focus + .tk-search-icon + .tk-shortcut-hint { opacity: 0; }

            /* SALES TOGGLE BUTTON */
            #tk-evt-toggle-btn { margin-left: auto !important; display: flex !important; align-items: center !important; justify-content: center !important; gap: 6px !important; height: 32px !important; padding: 0 16px !important; border: 2px solid transparent !important; transition: all 0.2s ease-in-out !important; box-sizing: border-box !important; border-radius: 50px !important; font-size: 0.75rem !important; }
            #tk-evt-toggle-btn.tk-is-active { background-color: ${CONFIG.COLOR_SOLD} !important; color: #000000 !important; border: 1px solid ${CONFIG.COLOR_SOLD} !important; box-shadow: 0 4px 12px rgba(129, 199, 132, 0.4) !important; font-weight: 700 !important; }
            #tk-evt-toggle-btn:not(.tk-is-active) { background-color: transparent !important; color: #4b5563 !important; border: 1px solid #9ca3af !important; }
            #tk-evt-toggle-btn:not(.tk-is-active):hover { background-color: #f3f4f6 !important; border-color: #6b7280 !important; color: #111827 !important; }

            /* EMPTY STATE */
            #tk-evt-empty-state { display: none; text-align: center; padding: 60px 20px; color: #6b7280; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 20px 0; opacity: 0; transition: opacity 0.3s ease; grid-column: 1 / -1; }
            .tk-evt-empty-title { font-size: 16px; font-weight: 600; color: #111827; }
            .tk-evt-empty-desc { font-size: 14px; margin-top: 4px; }

            /* MOBILE LAYOUT */
            @media (max-width: 640px) {
                .tk-search-container { padding: 1rem; flex-direction: column; align-items: flex-start; }
                .tk-search-wrapper { width: 100%; }
                .tk-search-counter.visible { margin-left: 0; margin-top: 0.5rem; }
                .tk-shortcut-hint { display: none; }
            }
        `;
        document.head.appendChild(el('style', { id: 'tk-omni-styles', textContent: css }));
    }

    // ==========================================
    // UI COMPONENTS
    // ==========================================

    function getFilterContainer(targetContainer) {
        if (state.cachedFilterContainer && targetContainer && targetContainer.contains(state.cachedFilterContainer)) {
            return state.cachedFilterContainer;
        }
        for (const btn of document.querySelectorAll('button')) {
            if (btn.textContent.trim().startsWith('All (')) {
                state.cachedFilterContainer = btn.parentElement;
                return state.cachedFilterContainer;
            }
        }
        return null;
    }

    function syncToggleUI(targetContainer) {
        const container = getFilterContainer(targetContainer);
        if (!container) return;

        let btn = document.getElementById('tk-evt-toggle-btn');
        if (!btn || !container.contains(btn)) {
            if (btn) btn.remove();

            const btnContent = [
                getIcon('FILTER'),
                el('span', { textContent: `Filter: Active Sales (${state.activeSalesCount})` })
            ];

            btn = el('button', {
                id: 'tk-evt-toggle-btn',
                type: 'button',
                className: "focus:shadow-outline-indigo font-semibold antialiased focus:outline-none whitespace-nowrap",
                onClick: () => {
                    state.isSalesFilterActive = !state.isSalesFilterActive;
                    localStorage.setItem('tk-sales-filtered', state.isSalesFilterActive);
                    applyUnifiedFilters(targetContainer, false);
                }
            }, btnContent);

            container.appendChild(btn);
        } else {
            const span = btn.querySelector('span');
            if (span) span.textContent = `Filter: Active Sales (${state.activeSalesCount})`;
        }

        btn.classList.toggle('tk-is-active', state.isSalesFilterActive);
    }

    function injectSearchBar(targetContainer) {
        if (document.getElementById('tk-evt-search-container')) return;

        const searchIconDiv = el('div', { className: 'tk-search-icon' }, [getIcon('SEARCH')]);
        const hintDiv = el('div', { className: 'tk-shortcut-hint', textContent: '/' });

        const searchInput = el('input', {
            type: 'text',
            id: 'tk-evt-search-input',
            className: 'tk-search-input',
            placeholder: 'Search events or venues...',
            onInput: (e) => {
                state.searchQuery = e.target.value;
                const wrapper = document.getElementById('tk-evt-search-wrapper');

                if (wrapper) {
                    wrapper.classList.toggle('has-query', state.searchQuery.trim().length > 0);
                }

                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(() => applyUnifiedFilters(targetContainer, false), CONFIG.DEBOUNCE_MS);
            }
        });

        const clearBtn = el('button', {
            className: 'tk-search-clear-btn',
            'aria-label': 'Clear search',
            onClick: () => {
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input'));
                searchInput.focus();
            }
        }, [getIcon('CLEAR')]);

        const wrapper = el('div', { id: 'tk-evt-search-wrapper', className: 'tk-search-wrapper' }, [
            searchInput, searchIconDiv, hintDiv, clearBtn
        ]);

        const counter = el('div', { id: 'tk-evt-search-counter', className: 'tk-search-counter' });
        const container = el('div', { id: 'tk-evt-search-container', className: 'tk-search-container' }, [wrapper, counter]);

        targetContainer.prepend(container);
    }

    function injectEmptyState(targetContainer) {
        if (document.getElementById('tk-evt-empty-state')) return;

        let targetGrid = null;
        for (const grid of targetContainer.querySelectorAll('ul[class*="grid"]')) {
            if (grid.firstElementChild && grid.firstElementChild.tagName === 'LI') {
                targetGrid = grid;
                break;
            }
        }

        if (targetGrid) {
            const emptyDiv = el('div', { id: 'tk-evt-empty-state' }, [
                getIcon('EMPTY'),
                el('div', { className: 'tk-evt-empty-title', textContent: 'No events found' }),
                el('div', { className: 'tk-evt-empty-desc', textContent: 'Try adjusting your search or filter settings.' })
            ]);
            targetGrid.parentNode.insertBefore(emptyDiv, targetGrid.nextSibling);
        }
    }

    // ==========================================
    // ACCESSIBILITY (Keyboard Shortcuts)
    // ==========================================

    function initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const searchInput = document.getElementById('tk-evt-search-input');
            if (!searchInput) return;

            // Esc to clear input & blur
            if (e.key === 'Escape' && document.activeElement === searchInput) {
                e.preventDefault();
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input'));
                searchInput.blur();
                return;
            }

            // '/' or 'Ctrl+K' to focus (if not typing elsewhere)
            if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !e.target.matches('input:not(#tk-evt-search-input), textarea')) {
                e.preventDefault();
                searchInput.focus();
            }
        });
    }

    // ==========================================
    // UNIFIED FLIP ORCHESTRATION ENGINE
    // ==========================================

    function applyUnifiedFilters(targetContainer, instant = false) {
        if (!targetContainer) return;
        state.animId++;
        const currentAnim = state.animId;

        const query = state.searchQuery.toLowerCase().trim();
        const allCards = Array.from(targetContainer.querySelectorAll('li.tk-evt-card'));

        let visibleCount = 0;
        const newlyHidden = [];
        const newlyVisible = [];
        const remainingVisible = [];

        // 1. Evaluate State Matrix
        allCards.forEach(card => {
            const hasSales = card.classList.contains('tk-evt-has-sales');
            const matchesSearch = query === '' || card.textContent.toLowerCase().includes(query);
            const shouldBeVisible = (!state.isSalesFilterActive || hasSales) && matchesSearch;
            const isCurrentlyVisible = !card.classList.contains('tk-layout-hidden');

            if (shouldBeVisible) {
                visibleCount++;
                if (isCurrentlyVisible) remainingVisible.push(card);
                else newlyVisible.push(card);
            } else {
                if (isCurrentlyVisible) newlyHidden.push(card);
            }
        });

        // 2. Sync UI Components
        syncToggleUI(targetContainer);
        const counter = document.getElementById('tk-evt-search-counter');
        if (counter) {
            if (query !== '') {
                counter.textContent = `Found ${visibleCount} of ${allCards.length} events`;
                counter.classList.add('visible');
            } else {
                counter.classList.remove('visible');
            }
        }

        const emptyState = document.getElementById('tk-evt-empty-state');
        const shouldShowEmpty = visibleCount === 0 && allCards.length > 0;

        // 3. Instant execution (Initial load / DOM mutations)
        if (instant) {
            allCards.forEach(card => {
                const hasSales = card.classList.contains('tk-evt-has-sales');
                const matchesSearch = query === '' || card.textContent.toLowerCase().includes(query);
                if ((!state.isSalesFilterActive || hasSales) && matchesSearch) {
                    card.classList.remove('tk-fade-hidden', 'tk-layout-hidden');
                } else {
                    card.classList.add('tk-fade-hidden', 'tk-layout-hidden');
                }
            });
            if (emptyState) {
                emptyState.style.display = shouldShowEmpty ? 'block' : 'none';
                emptyState.style.opacity = shouldShowEmpty ? '1' : '0';
            }
            return;
        }

        // 4. Orchestrated Execution (User interactions)
        newlyHidden.forEach(c => c.classList.add('tk-fade-hidden'));
        if (emptyState && !shouldShowEmpty) emptyState.style.opacity = '0';

        const fadeWaitTime = newlyHidden.length > 0 ? CONFIG.ANIMATION_MS : 0;

        setTimeout(() => {
            if (state.animId !== currentAnim) return;

            if (emptyState && !shouldShowEmpty) emptyState.style.display = 'none';

            // Snapshot existing active cards before layout change
            const firstRects = new Map();
            remainingVisible.forEach(card => firstRects.set(card, card.getBoundingClientRect()));

            // Apply layout changes safely
            newlyHidden.forEach(c => c.classList.add('tk-layout-hidden'));
            newlyVisible.forEach(c => {
                c.classList.remove('tk-layout-hidden');
                c.classList.add('tk-fade-hidden'); // Keep opaque for stagger fade-in
            });

            if (emptyState && shouldShowEmpty) {
                emptyState.style.display = 'block';
                void emptyState.offsetWidth; // Force layout
                emptyState.style.opacity = '1';
            }

            requestAnimationFrame(() => {
                if (state.animId !== currentAnim) return;

                // Invert layout shift
                remainingVisible.forEach(card => {
                    const first = firstRects.get(card);
                    const last = card.getBoundingClientRect();
                    card.style.transition = 'none';
                    card.style.transform = `translate(${first.left - last.left}px, ${first.top - last.top}px)`;
                });

                // Apply stagger rules
                newlyVisible.forEach((card, i) => {
                    card.style.setProperty('transition-delay', `${i * CONFIG.STAGGER_MS}ms`, 'important');
                });

                // Play Reflow
                requestAnimationFrame(() => {
                    if (state.animId !== currentAnim) return;

                    remainingVisible.forEach(card => {
                        card.style.transition = `transform ${CONFIG.ANIMATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
                        card.style.transform = 'translate(0, 0)';
                    });

                    newlyVisible.forEach(card => card.classList.remove('tk-fade-hidden'));

                    const maxDelay = newlyVisible.length > 0 ? (newlyVisible.length * CONFIG.STAGGER_MS) : 0;

                    // Clean up properties when finished
                    setTimeout(() => {
                        if (state.animId !== currentAnim) return;
                        remainingVisible.forEach(card => {
                            card.style.transition = '';
                            card.style.transform = '';
                        });
                        newlyVisible.forEach(card => card.style.removeProperty('transition-delay'));
                    }, CONFIG.ANIMATION_MS + maxDelay);
                });
            });
        }, fadeWaitTime);
    }

    // ==========================================
    // DOM PROCESSING
    // ==========================================

    function processTickets() {
        const targetContainer = document.querySelector(CONFIG.TARGET_CONTAINER_SELECTOR);
        if (!targetContainer) return;

        injectSearchBar(targetContainer);
        injectEmptyState(targetContainer);

        // Optimally scoped DOM query
        const h3Nodes = targetContainer.querySelectorAll('h3');
        let activeCount = 0;
        let requiresFilterUpdate = false;

        for (const node of h3Nodes) {
            if (node.textContent.trim() === CONFIG.STRING_TICKETS_SOLD) {
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

                        if (!liCard.classList.contains('tk-evt-card')) {
                            liCard.classList.add('tk-evt-card');
                            wrapper.classList.add('tk-evt-highlight-wrapper');
                            requiresFilterUpdate = true;
                        }

                        if (count > 0 && !liCard.classList.contains('tk-evt-has-sales')) {
                            wrapper.classList.add('tk-evt-has-sales');
                            wrapper.classList.remove('tk-evt-no-sales');
                            liCard.classList.add('tk-evt-has-sales');
                            liCard.classList.remove('tk-evt-no-sales');
                            requiresFilterUpdate = true;
                        } else if (count === 0 && !liCard.classList.contains('tk-evt-no-sales')) {
                            wrapper.classList.add('tk-evt-no-sales');
                            wrapper.classList.remove('tk-evt-has-sales');
                            liCard.classList.add('tk-evt-no-sales');
                            liCard.classList.remove('tk-evt-has-sales');
                            requiresFilterUpdate = true;
                        }
                    }
                }
            }
        }

        if (state.activeSalesCount !== activeCount || !document.getElementById('tk-evt-toggle-btn')) {
            state.activeSalesCount = activeCount;
            syncToggleUI(targetContainer);
        }

        if (requiresFilterUpdate) {
            applyUnifiedFilters(targetContainer, state.animId === 0);
        }
    }

    // ==========================================
    // SMART OBSERVER LIFECYCLE
    // ==========================================

    function initSmartObserver() {
        const connectToContainer = () => {
            const container = document.querySelector(CONFIG.TARGET_CONTAINER_SELECTOR);
            if (container) {
                if (state.observedNode !== container) {
                    if (state.observer) state.observer.disconnect();
                    state.observer.observe(container, { childList: true, subtree: true });
                    state.observedNode = container;
                    log('Performance check: Switched observation to target container.');
                }
                return true;
            }
            return false;
        };

        state.observer = new MutationObserver((mutations) => {
            // Reconnect to specific container when it loads (SPA handling)
            if (state.observedNode === document.body) {
                if (connectToContainer()) {
                    processTickets();
                    return;
                }
            }

            let isHeavyMutation = false;
            for (const m of mutations) {
                if (m.removedNodes.length > 5 || (m.removedNodes.length > 0 && m.target.tagName === 'UL')) {
                    isHeavyMutation = true;
                    break;
                }
            }

            if (isHeavyMutation) state.animId++;
            if (state.isMutating) return;

            if (state.debounceTimer) clearTimeout(state.debounceTimer);

            state.debounceTimer = setTimeout(() => {
                state.isMutating = true;
                requestAnimationFrame(() => {
                    processTickets();
                    state.isMutating = false;
                });
            }, CONFIG.DEBOUNCE_MS);
        });

        // Start watching body for the container arrival
        if (!connectToContainer()) {
            state.observer.observe(document.body, { childList: true, subtree: true });
            state.observedNode = document.body;
            log('Container not ready, observing body as fallback.');
        }
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    function bootstrap() {
        try {
            injectStyles();
            initKeyboardShortcuts();
            processTickets();
            initSmartObserver();
            log('Initialization complete.');
        } catch (error) {
            console.error('[Tickeri Omni Filter] Initialization failed:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

})();
