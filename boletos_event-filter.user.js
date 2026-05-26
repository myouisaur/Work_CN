// ==UserScript==
// @name         [Boletos Express] Event Filter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.boletosexpress.com/favicon.ico
// @version      1.3
// @description  Adds advanced text, date range, and section filtering to the Boletos Express promoter dashboard.
// @author       Xiv
// @match        *://*.boletosexpress.com/promoters/dashboard.php*
// @match        *://*.boletosexpress.com/promoters/events.php*
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/boletos_event-filter.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/boletos_event-filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__bxEventFilterRunning) return;
    window.__bxEventFilterRunning = true;

    // ==========================================
    // CONFIGURATION & STATE
    // ==========================================

    const CONFIG = {
        DEBUG: false,
        DEBOUNCE_MS: 250,
        SELECTORS: {
            EVENT_CARD: '.event',
            UPCOMING_CONTAINER: '#upcoming_events',
            PAST_CONTAINER: '#past_events',
            TIME_ELEMENT: 'time',
            TARGET_PARENT: 'main'
        }
    };

    const state = {
        query: '',
        dateFrom: null,
        dateTo: null,
        showUpcoming: true, // Always ON upon initial load
        showPast: true,     // Always ON upon initial load
        debounceTimer: null,
        totalEvents: 0,
        visibleEvents: 0,
        animId: 0,
        isEventsPage: window.location.pathname.includes('events.php')
    };

    // ==========================================
    // UTILITIES
    // ==========================================

    function log(...args) {
        if (CONFIG.DEBUG) console.log('[BX Event Filter]', ...args);
    }

    function el(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') element.className = value;
            else if (key === 'textContent') element.textContent = value;
            else if (key === 'onClick') element.addEventListener('click', value);
            else if (key === 'onInput') element.addEventListener('input', value);
            else if (key === 'onChange') element.addEventListener('change', value);
            else element.setAttribute(key, value);
        }
        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
        return element;
    }

    function parseEventDate(timeStr) {
        if (!timeStr) return null;

        // Target specifically the "Month DD, YYYY" portion
        const match = timeStr.match(/([a-zA-Z]+)\s+(\d+),\s+(\d{4})/);
        if (match) {
            const date = new Date(match[0]);
            date.setHours(0, 0, 0, 0); // Normalize to local midnight
            return date.getTime();
        }
        return null;
    }

    function parseInputDateToLocal(dateString, isEndOfDay = false) {
        if (!dateString) return null;

        // dateString format: "YYYY-MM-DD". Force local timezone evaluation.
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day);

        if (isEndOfDay) {
            date.setHours(23, 59, 59, 999);
        } else {
            date.setHours(0, 0, 0, 0);
        }
        return date.getTime();
    }

    // ==========================================
    // STYLING INJECTION
    // ==========================================

    function injectStyles() {
        if (document.getElementById('bx-ef-styles')) return;

        const css = `
            .bx-ef-panel {
                background-color: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                padding: clamp(12px, 2vw, 20px);
                margin: 20px 0;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                display: flex;
                flex-direction: column;
                gap: 16px;
                font-family: inherit;
            }

            .bx-ef-row {
                display: flex;
                flex-wrap: wrap;
                gap: 16px;
                align-items: flex-start;
            }

            .bx-ef-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
                flex: 1;
                min-width: 200px;
            }

            .bx-ef-label {
                font-size: 0.85rem;
                font-weight: 600;
                color: #4b5563;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .bx-ef-input {
                padding: 10px 14px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 0.95rem;
                color: #1f2937;
                background-color: #f9fafb;
                transition: all 0.2s ease;
                outline: none;
                width: 100%;
                box-sizing: border-box;
            }

            .bx-ef-input:focus {
                border-color: #1C2A7C;
                background-color: #ffffff;
                box-shadow: 0 0 0 3px rgba(28, 42, 124, 0.1);
            }

            .bx-ef-input-error {
                border-color: #ef4444 !important;
                background-color: #fef2f2 !important;
                color: #991b1b !important;
            }

            .bx-ef-error-text {
                color: #ef4444;
                font-size: 0.8rem;
                font-weight: 500;
                margin-top: 2px;
            }

            .bx-ef-date-container {
                display: flex;
                align-items: center;
                gap: 10px;
                flex: 1;
                min-width: 280px;
            }

            .bx-ef-toggles {
                display: flex;
                gap: 10px;
                align-items: center;
            }

            .bx-ef-toggle {
                padding: 8px 16px;
                border-radius: 9999px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                border: 1px solid #d1d5db;
                background-color: #f3f4f6;
                color: #6b7280;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
            }

            .bx-ef-toggle.active {
                background-color: #1C2A7C;
                color: #ffffff;
                border-color: #1C2A7C;
            }

            .bx-ef-toggle:hover:not(.active) {
                background-color: #e5e7eb;
                color: #374151;
            }

            .bx-ef-reset {
                background-color: #ffffff;
                color: #ef4444;
                border-color: #fca5a5;
                margin-left: 8px;
            }

            .bx-ef-reset:hover {
                background-color: #fef2f2 !important;
                color: #b91c1c !important;
                border-color: #ef4444 !important;
            }

            .bx-ef-stats {
                font-size: 0.9rem;
                color: #6b7280;
                font-weight: 500;
                margin-left: auto;
                align-self: center;
            }

            .bx-ef-hidden {
                display: none !important;
            }

            .bx-ef-empty-msg {
                padding: 30px;
                text-align: center;
                color: #6b7280;
                font-size: 1rem;
                background: #f9fafb;
                border-radius: 8px;
                border: 2px dashed #d1d5db;
                grid-column: 1 / -1;
                width: 100%;
                box-sizing: border-box;
            }
        `;

        document.head.appendChild(el('style', { id: 'bx-ef-styles', textContent: css }));
    }

    // ==========================================
    // DOM PROCESSING & FILTERING
    // ==========================================

    function preprocessEvents() {
        const events = document.querySelectorAll(CONFIG.SELECTORS.EVENT_CARD);

        events.forEach(card => {
            if (card.dataset.bxProcessed === 'true') return;

            // 1. Text indexing
            card.dataset.bxSearchText = card.textContent.toLowerCase().trim();

            // 2. Date parsing
            const timeEl = card.querySelector(CONFIG.SELECTORS.TIME_ELEMENT);
            const parsedTime = timeEl ? parseEventDate(timeEl.textContent) : null;
            if (parsedTime !== null) {
                card.dataset.bxTimestamp = parsedTime;
            }

            // 3. Section determination
            const isPast = !!card.closest(CONFIG.SELECTORS.PAST_CONTAINER);
            card.dataset.bxSection = isPast ? 'past' : 'upcoming';

            card.dataset.bxProcessed = 'true';
        });

        state.totalEvents = events.length;
    }

    function executeFilter() {
        state.animId++;
        const currentAnim = state.animId;

        requestAnimationFrame(() => {
            if (state.animId !== currentAnim) return;

            const events = document.querySelectorAll(CONFIG.SELECTORS.EVENT_CARD);
            let visibleCount = 0;
            const visibilityMatrix = { upcoming: 0, past: 0 };

            events.forEach(card => {
                const section = card.dataset.bxSection;
                const searchStr = card.dataset.bxSearchText || '';
                const timestamp = parseInt(card.dataset.bxTimestamp, 10);

                let isVisible = true;

                // 1. Toggle Filter
                if (section === 'past' && !state.showPast) isVisible = false;
                if (section === 'upcoming' && !state.showUpcoming) isVisible = false;

                // 2. Text Search Filter
                if (isVisible && state.query) {
                    if (!searchStr.includes(state.query)) {
                        isVisible = false;
                    }
                }

                // 3. Date Range Filter
                if (isVisible && !isNaN(timestamp)) {
                    if (state.dateFrom && timestamp < state.dateFrom) isVisible = false;
                    if (state.dateTo && timestamp > state.dateTo) isVisible = false;
                }

                card.classList.toggle('bx-ef-hidden', !isVisible);

                if (isVisible) {
                    visibleCount++;
                    visibilityMatrix[section]++;
                }
            });

            state.visibleEvents = visibleCount;
            updateStatsUI();
            updateEmptyStates(visibilityMatrix);
        });
    }

    function updateEmptyStates(matrix) {
        const sections = [
            { id: CONFIG.SELECTORS.UPCOMING_CONTAINER, count: matrix.upcoming, name: 'upcoming' },
            { id: CONFIG.SELECTORS.PAST_CONTAINER, count: matrix.past, name: 'past' }
        ];

        sections.forEach(sec => {
            const container = document.querySelector(sec.id);
            if (!container) return;

            let emptyMsg = container.querySelector('.bx-ef-empty-msg');
            const isActiveToggle = sec.name === 'past' ? state.showPast : state.showUpcoming;

            container.classList.toggle('bx-ef-hidden', !isActiveToggle);

            if (isActiveToggle && sec.count === 0 && document.querySelectorAll(`${sec.id} ${CONFIG.SELECTORS.EVENT_CARD}`).length > 0) {
                if (!emptyMsg) {
                    emptyMsg = el('div', { className: 'bx-ef-empty-msg', textContent: 'No events match your current filters.' });
                    container.appendChild(emptyMsg);
                }
                emptyMsg.style.display = 'block';
            } else if (emptyMsg) {
                emptyMsg.style.display = 'none';
            }
        });
    }

    function updateStatsUI() {
        const statsEl = document.getElementById('bx-ef-stats-text');
        if (statsEl) {
            statsEl.textContent = `Showing ${state.visibleEvents} of ${state.totalEvents} events`;
        }
    }

    // ==========================================
    // UI CONSTRUCTION
    // ==========================================

    function buildFilterPanel() {
        const searchInput = el('input', {
            type: 'text',
            className: 'bx-ef-input',
            placeholder: 'Search by title, venue, or address...',
            onInput: (e) => {
                state.query = e.target.value.toLowerCase().trim();
                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(executeFilter, CONFIG.DEBOUNCE_MS);
            }
        });

        const dateFromInput = el('input', { type: 'date', className: 'bx-ef-input bx-ef-date' });
        const dateToInput = el('input', { type: 'date', className: 'bx-ef-input bx-ef-date' });
        const dateErrorMsg = el('div', { className: 'bx-ef-error-text bx-ef-hidden', textContent: 'End date cannot be before start date.' });

        // Logic to validate dates, control limits, and execute
        function validateDates() {
            const valFrom = dateFromInput.value;
            const valTo = dateToInput.value;

            state.dateFrom = parseInputDateToLocal(valFrom, false);
            state.dateTo = parseInputDateToLocal(valTo, true);

            // Constrain calendar pickers dynamically
            if (valFrom) dateToInput.setAttribute('min', valFrom);
            else dateToInput.removeAttribute('min');

            if (valTo) dateFromInput.setAttribute('max', valTo);
            else dateFromInput.removeAttribute('max');

            // Handle manual typing of invalid ranges
            if (state.dateFrom && state.dateTo && state.dateFrom > state.dateTo) {
                dateErrorMsg.classList.remove('bx-ef-hidden');
                dateToInput.classList.add('bx-ef-input-error');
            } else {
                dateErrorMsg.classList.add('bx-ef-hidden');
                dateToInput.classList.remove('bx-ef-input-error');
            }

            executeFilter();
        }

        dateFromInput.addEventListener('change', validateDates);
        dateToInput.addEventListener('change', validateDates);

        const btnUpcoming = el('button', {
            type: 'button',
            className: `bx-ef-toggle ${state.showUpcoming ? 'active' : ''}`,
            textContent: 'Upcoming Events',
            onClick: (e) => {
                state.showUpcoming = !state.showUpcoming;
                e.target.classList.toggle('active', state.showUpcoming);
                executeFilter();
            }
        });

        const btnReset = el('button', {
            type: 'button',
            className: 'bx-ef-toggle bx-ef-reset',
            textContent: 'Clear Filters',
            onClick: () => {
                searchInput.value = '';
                dateFromInput.value = '';
                dateToInput.value = '';
                state.query = '';
                validateDates(); // Cleanly resets the date state, constraints, and triggers refilter
            }
        });

        const togglesContainer = el('div', { className: 'bx-ef-toggles' }, [btnUpcoming]);

        if (state.isEventsPage) {
            const btnPast = el('button', {
                type: 'button',
                className: `bx-ef-toggle ${state.showPast ? 'active' : ''}`,
                textContent: 'Past Events',
                onClick: (e) => {
                    state.showPast = !state.showPast;
                    e.target.classList.toggle('active', state.showPast);
                    executeFilter();
                }
            });
            togglesContainer.appendChild(btnPast);
        }

        togglesContainer.appendChild(btnReset);

        const panel = el('div', { id: 'bx-ef-panel', className: 'bx-ef-panel' }, [
            el('div', { className: 'bx-ef-row' }, [
                el('div', { className: 'bx-ef-group', style: 'flex: 2;' }, [
                    el('label', { className: 'bx-ef-label', textContent: 'Filter' }),
                    searchInput
                ]),
                el('div', { className: 'bx-ef-group' }, [
                    el('label', { className: 'bx-ef-label', textContent: 'Date Range' }),
                    el('div', { className: 'bx-ef-date-container' }, [
                        dateFromInput,
                        el('span', { textContent: 'to', style: 'color: #6b7280; font-size: 0.85rem; font-weight: 600;' }),
                        dateToInput
                    ]),
                    dateErrorMsg
                ])
            ]),
            el('div', { className: 'bx-ef-row', style: 'border-top: 1px solid #e5e7eb; padding-top: 16px;' }, [
                togglesContainer,
                el('div', { className: 'bx-ef-stats', id: 'bx-ef-stats-text' })
            ])
        ]);

        return panel;
    }

    function injectUI() {
        if (document.getElementById('bx-ef-panel')) return;

        const mainContainer = document.querySelector(CONFIG.SELECTORS.TARGET_PARENT);
        if (!mainContainer) {
            log('Main container not found, aborting injection.');
            return;
        }

        const firstEventsSection = document.querySelector('.events');
        if (firstEventsSection) {
            firstEventsSection.parentNode.insertBefore(buildFilterPanel(), firstEventsSection);
        } else {
            mainContainer.prepend(buildFilterPanel());
        }
    }

    // ==========================================
    // OBSERVER LIFECYCLE
    // ==========================================

    function setupObserver() {
        const targetNode = document.querySelector(CONFIG.SELECTORS.TARGET_PARENT) || document.body;

        const observer = new MutationObserver((mutations) => {
            let shouldReIndex = false;

            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE &&
                           (node.matches(CONFIG.SELECTORS.EVENT_CARD) || node.querySelector(CONFIG.SELECTORS.EVENT_CARD))) {
                            shouldReIndex = true;
                            break;
                        }
                    }
                }
                if (shouldReIndex) break;
            }

            if (shouldReIndex) {
                log('Dynamic content detected. Re-indexing events.');
                preprocessEvents();
                executeFilter();
            }
        });

        observer.observe(targetNode, { childList: true, subtree: true });
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    function init() {
        try {
            log('Initializing filter engine...');
            injectStyles();
            injectUI();
            preprocessEvents();
            executeFilter();
            setupObserver();
        } catch (error) {
            console.error('[BX Event Filter] Initialization failed:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
