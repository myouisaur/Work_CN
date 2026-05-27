// ==UserScript==
// @name         [Boletos Express] Event Filter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.boletosexpress.com/favicon.ico
// @version      2.0
// @description  Adds advanced text, date range, section filtering, sorting, and high-performance infinite scroll to the Boletos Express promoter dashboard.
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
        CHUNK_SIZE: 50, // Events to render per scroll tick
        PROCESS_CHUNK_SIZE: 200, // Events to extract from DOM per animation frame
        PAST_DAYS_LIMIT: 30, // Days to show for past events on initial load
        SELECTORS: {
            EVENT_CARD: '.event',
            UPCOMING_CONTAINER: '#upcoming_events',
            PAST_CONTAINER: '#past_events',
            TIME_ELEMENT: 'time',
            TARGET_PARENT: 'main'
        }
    };

    const isEventsPage = window.location.pathname.includes('events.php');

    const state = {
        query: '',
        dateFrom: null,
        dateTo: null,
        sortUpcoming: 'date-asc',
        sortPast: 'date-desc',
        showUpcoming: !isEventsPage, // OFF by default on events.php, ON for dashboard
        showPast: true,
        debounceTimer: null,
        observerTimer: null,
        io: null,
        isMutating: false,

        // High-Performance Memory Architecture
        pool: [],
        filtered: { upcoming: [], past: [] },
        renderIndex: { upcoming: 0, past: 0 },
        containers: { upcoming: null, past: null },

        totalEvents: 0,
        visibleEvents: 0,
        isEventsPage: isEventsPage
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

        const match = timeStr.match(/([a-zA-Z]+)\s+(\d+),\s+(\d{4})/);
        if (match) {
            const date = new Date(match[0]);
            date.setHours(0, 0, 0, 0);
            return date.getTime();
        }
        return null;
    }

    function parseInputDateToLocal(dateString, isEndOfDay = false) {
        if (!dateString) return null;

        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day);

        if (isEndOfDay) {
            date.setHours(23, 59, 59, 999);
        } else {
            date.setHours(0, 0, 0, 0);
        }
        return date.getTime();
    }

    function getIconSvg() {
        return new DOMParser().parseFromString(
            `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.4;"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>`,
            'image/svg+xml'
        ).documentElement;
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
                align-items: flex-end;
            }

            .bx-ef-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
                flex: 1;
                min-width: 140px;
            }

            .bx-ef-label {
                font-size: 0.85rem;
                font-weight: 600;
                color: #4b5563;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .bx-ef-input, .bx-ef-select {
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
                font-family: inherit;
            }

            .bx-ef-input:focus, .bx-ef-select:focus, .bx-ef-toggle:focus {
                border-color: #1C2A7C;
                background-color: #ffffff;
                box-shadow: 0 0 0 3px rgba(28, 42, 124, 0.15);
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
                flex-wrap: wrap;
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
                display: inline-flex;
                align-items: center;
                gap: 6px;
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
                margin-left: auto;
                opacity: 0;
                pointer-events: none;
                transform: scale(0.95);
            }

            .bx-ef-reset.bx-ef-visible {
                opacity: 1;
                pointer-events: auto;
                transform: scale(1);
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
                display: none;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px 20px;
                color: #6b7280;
                background: #f9fafb;
                border-radius: 8px;
                border: 2px dashed #d1d5db;
                margin-top: 20px;
                margin-bottom: 20px;
                width: 100%;
                box-sizing: border-box;
            }
        `;

        document.head.appendChild(el('style', { id: 'bx-ef-styles', textContent: css }));
    }

    // ==========================================
    // INFINITE SCROLL & MEMORY MANAGEMENT
    // ==========================================

    function initContainers() {
        state.containers.upcoming = document.querySelector(CONFIG.SELECTORS.UPCOMING_CONTAINER);
        state.containers.past = document.querySelector(CONFIG.SELECTORS.PAST_CONTAINER);
    }

    function preprocessEvents() {
        return new Promise(resolve => {
            state.isMutating = true;
            // Target only events that haven't been processed yet
            const events = document.querySelectorAll(`${CONFIG.SELECTORS.EVENT_CARD}:not([data-bx-processed="true"])`);
            let addedNew = false;
            let i = 0;

            function processChunk() {
                const end = Math.min(i + CONFIG.PROCESS_CHUNK_SIZE, events.length);

                for (; i < end; i++) {
                    const card = events[i];
                    const searchStr = card.textContent.toLowerCase().trim();
                    const timeEl = card.querySelector(CONFIG.SELECTORS.TIME_ELEMENT);
                    const timestamp = timeEl ? parseEventDate(timeEl.textContent) : null;
                    const isPast = !!card.closest(CONFIG.SELECTORS.PAST_CONTAINER);
                    const section = isPast ? 'past' : 'upcoming';

                    card.dataset.bxProcessed = 'true';

                    state.pool.push({ el: card, searchStr, timestamp, section });

                    // Instantly remove to clear browser memory constraints
                    card.remove();
                    addedNew = true;
                }

                if (i < events.length) {
                    // Yield to main thread to prevent UI freezing on massive payloads
                    requestAnimationFrame(processChunk);
                } else {
                    if (addedNew) {
                        state.totalEvents = state.pool.length;
                    }
                    setTimeout(() => { state.isMutating = false; }, 0);
                    resolve(addedNew);
                }
            }

            if (events.length > 0) {
                processChunk();
            } else {
                state.isMutating = false;
                resolve(false);
            }
        });
    }

    function sortFilteredEvents(section, sortVal) {
        state.filtered[section].sort((a, b) => {
            let valA, valB;
            if (sortVal === 'date-asc' || sortVal === 'date-desc') {
                valA = parseInt(a.timestamp, 10) || Number.MAX_SAFE_INTEGER;
                valB = parseInt(b.timestamp, 10) || Number.MAX_SAFE_INTEGER;
                return sortVal === 'date-asc' ? valA - valB : valB - valA;
            } else if (sortVal === 'title-asc') {
                return a.searchStr.localeCompare(b.searchStr);
            }
        });
    }

    function renderNextPage(section, targetEndIndex = null) {
        const container = state.containers[section];
        if (!container) return;

        const sentinel = document.getElementById(`bx-ef-sentinel-${section}`);
        const list = state.filtered[section];
        const start = state.renderIndex[section];

        let end = targetEndIndex !== null ? targetEndIndex : start + CONFIG.CHUNK_SIZE;
        end = Math.min(end, list.length);

        if (start >= end) return;

        state.isMutating = true;
        const fragment = document.createDocumentFragment();

        for (let i = start; i < end; i++) {
            fragment.appendChild(list[i].el);
        }

        if (sentinel) {
            container.insertBefore(fragment, sentinel);
        } else {
            container.appendChild(fragment);
        }

        state.renderIndex[section] = end;
        setTimeout(() => { state.isMutating = false; }, 0);
    }

    function executeFilter() {
        // 1. Process Filtering In-Memory
        state.filtered.upcoming = [];
        state.filtered.past = [];
        let visibleCount = 0;

        state.pool.forEach(item => {
            let isVisible = true;

            if (item.section === 'past' && !state.showPast) isVisible = false;
            if (item.section === 'upcoming' && !state.showUpcoming) isVisible = false;

            if (isVisible && state.query) {
                if (!item.searchStr.includes(state.query)) isVisible = false;
            }

            if (isVisible && !isNaN(item.timestamp)) {
                if (state.dateFrom && item.timestamp < state.dateFrom) isVisible = false;
                if (state.dateTo && item.timestamp > state.dateTo) isVisible = false;
            }

            if (isVisible) {
                state.filtered[item.section].push(item);
                visibleCount++;
            } else {
                if (item.el.parentNode) item.el.remove();
            }
        });

        state.visibleEvents = visibleCount;

        // 2. Process Sorting In-Memory
        sortFilteredEvents('upcoming', state.sortUpcoming);
        sortFilteredEvents('past', state.sortPast);

        // 3. Clear existing DOM renders cleanly
        state.isMutating = true;
        state.filtered.upcoming.forEach(item => { if (item.el.parentNode) item.el.remove(); });
        state.filtered.past.forEach(item => { if (item.el.parentNode) item.el.remove(); });
        state.isMutating = false;

        // 4. Smart Initial Render
        state.renderIndex = { upcoming: 0, past: 0 };

        // UPCOMING: Render all events instantly
        renderNextPage('upcoming', state.filtered.upcoming.length);

        // PAST: Render everything up to the cutoff limit instantly
        const limitMs = CONFIG.PAST_DAYS_LIMIT * 24 * 60 * 60 * 1000;
        const cutoffDate = Date.now() - limitMs;
        let pastInitialCount = 0;

        for (let i = 0; i < state.filtered.past.length; i++) {
            if (state.filtered.past[i].timestamp >= cutoffDate) {
                pastInitialCount++;
            } else if (state.sortPast === 'date-desc') {
                break;
            }
        }

        // Ensure we always render a small initial chunk so the scrollbar exists to trigger the infinite observer
        pastInitialCount = Math.max(pastInitialCount, 25);
        renderNextPage('past', pastInitialCount);

        updateStatsUI();
        updateEmptyStates();
        updateClearButtonState();
    }

    function updateEmptyStates() {
        const matrix = {
            upcoming: state.filtered.upcoming.length,
            past: state.filtered.past.length
        };

        const globalEmpty = document.getElementById('bx-ef-global-empty');
        const allTogglesOff = !state.showUpcoming && (!state.isEventsPage || !state.showPast);

        if (globalEmpty) {
            if (allTogglesOff) {
                globalEmpty.classList.remove('bx-ef-hidden');
                globalEmpty.style.display = 'flex';
            } else {
                globalEmpty.classList.add('bx-ef-hidden');
                globalEmpty.style.display = 'none';
            }
        }

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

            if (isActiveToggle && sec.count === 0 && state.pool.filter(i => i.section === sec.name).length > 0) {
                if (!emptyMsg) {
                    emptyMsg = el('div', { className: 'bx-ef-empty-msg' }, [
                        getIconSvg(),
                        el('div', { textContent: 'No events found', style: 'font-weight: 600; color: #111827; margin-bottom: 4px;' }),
                        el('div', { textContent: 'Try adjusting your filters or date range.', style: 'font-size: 0.85rem;' })
                    ]);
                    container.appendChild(emptyMsg);
                }
                emptyMsg.style.display = 'flex';
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

    function updateClearButtonState() {
        const btnReset = document.getElementById('bx-ef-reset-btn');
        if (!btnReset) return;

        const isFilterActive = state.query !== '' || state.dateFrom !== null || state.dateTo !== null;
        btnReset.classList.toggle('bx-ef-visible', isFilterActive);
    }

    // ==========================================
    // UI CONSTRUCTION & KEYBOARD
    // ==========================================

    function createSortSelect(id, defaultVal, onChange) {
        const select = el('select', { id: id, className: 'bx-ef-select', onChange: onChange });
        const options = [
            { value: 'date-asc', text: 'Date: Earliest First' },
            { value: 'date-desc', text: 'Date: Latest First' },
            { value: 'title-asc', text: 'Title: A-Z' }
        ];
        options.forEach(opt => {
            const option = el('option', { value: opt.value, textContent: opt.text });
            if (opt.value === defaultVal) option.selected = true;
            select.appendChild(option);
        });
        return select;
    }

    function buildFilterPanel() {
        const searchInput = el('input', {
            type: 'text',
            id: 'bx-ef-search',
            className: 'bx-ef-input',
            placeholder: 'Search by title, venue, or address...',
            onInput: (e) => {
                state.query = e.target.value.toLowerCase().trim();
                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(executeFilter, CONFIG.DEBOUNCE_MS);
            }
        });

        const sortUpcomingSelect = createSortSelect('bx-ef-sort-upcoming', state.sortUpcoming, (e) => {
            state.sortUpcoming = e.target.value;
            executeFilter();
        });

        const sortPastSelect = createSortSelect('bx-ef-sort-past', state.sortPast, (e) => {
            state.sortPast = e.target.value;
            executeFilter();
        });

        const dateFromInput = el('input', { type: 'date', id: 'bx-ef-date-from', className: 'bx-ef-input bx-ef-date' });
        const dateToInput = el('input', { type: 'date', id: 'bx-ef-date-to', className: 'bx-ef-input bx-ef-date' });
        const dateErrorMsg = el('div', { className: 'bx-ef-error-text bx-ef-hidden', textContent: 'End date cannot be before start date.' });

        function validateDates() {
            const valFrom = dateFromInput.value;
            const valTo = dateToInput.value;

            state.dateFrom = parseInputDateToLocal(valFrom, false);
            state.dateTo = parseInputDateToLocal(valTo, true);

            if (valFrom) dateToInput.setAttribute('min', valFrom);
            else dateToInput.removeAttribute('min');

            if (valTo) dateFromInput.setAttribute('max', valTo);
            else dateFromInput.removeAttribute('max');

            if (state.dateFrom && state.dateTo && state.dateFrom > state.dateTo) {
                dateFromInput.classList.add('bx-ef-input-error');
                dateToInput.classList.add('bx-ef-input-error');
            } else {
                dateFromInput.classList.remove('bx-ef-input-error');
                dateToInput.classList.remove('bx-ef-input-error');
            }

            executeFilter();
        }

        dateFromInput.addEventListener('change', validateDates);
        dateToInput.addEventListener('change', validateDates);

        const btnUpcoming = el('button', {
            type: 'button',
            'aria-pressed': state.showUpcoming.toString(),
            className: `bx-ef-toggle ${state.showUpcoming ? 'active' : ''}`,
            textContent: 'Upcoming Events',
            onClick: (e) => {
                state.showUpcoming = !state.showUpcoming;
                e.target.classList.toggle('active', state.showUpcoming);
                e.target.setAttribute('aria-pressed', state.showUpcoming.toString());
                executeFilter();
            }
        });

        const btnReset = el('button', {
            type: 'button',
            id: 'bx-ef-reset-btn',
            className: 'bx-ef-toggle bx-ef-reset',
            textContent: 'Clear Filters',
            onClick: () => {
                searchInput.value = '';
                dateFromInput.value = '';
                dateToInput.value = '';
                state.query = '';

                sortUpcomingSelect.value = 'date-asc';
                state.sortUpcoming = 'date-asc';

                if (state.isEventsPage) {
                    sortPastSelect.value = 'date-desc';
                    state.sortPast = 'date-desc';
                }

                // Hard strip all constraint attributes
                dateFromInput.removeAttribute('max');
                dateToInput.removeAttribute('min');
                dateFromInput.classList.remove('bx-ef-input-error');
                dateToInput.classList.remove('bx-ef-input-error');

                validateDates();
            }
        });

        const togglesContainer = el('div', { className: 'bx-ef-toggles', style: 'flex: 1;' }, [btnUpcoming]);

        if (state.isEventsPage) {
            const btnPast = el('button', {
                type: 'button',
                'aria-pressed': 'true',
                className: 'bx-ef-toggle active',
                textContent: 'Past Events',
                onClick: (e) => {
                    state.showPast = !state.showPast;
                    e.target.classList.toggle('active', state.showPast);
                    e.target.setAttribute('aria-pressed', state.showPast.toString());
                    executeFilter();
                }
            });
            togglesContainer.appendChild(btnPast);
        }

        togglesContainer.appendChild(btnReset);

        const panel = el('div', { id: 'bx-ef-panel', className: 'bx-ef-panel' }, [
            el('div', { className: 'bx-ef-row' }, [
                el('div', { className: 'bx-ef-group', style: 'flex: 3; min-width: 250px;' }, [
                    el('label', { className: 'bx-ef-label', htmlFor: 'bx-ef-search', textContent: 'Filter' }),
                    searchInput
                ]),
                el('div', { className: 'bx-ef-group', style: 'flex: 1; min-width: 140px;' }, [
                    el('label', { className: 'bx-ef-label', htmlFor: 'bx-ef-date-from', textContent: 'From' }),
                    dateFromInput
                ]),
                el('div', { className: 'bx-ef-group', style: 'flex: 1; min-width: 140px;' }, [
                    el('label', { className: 'bx-ef-label', htmlFor: 'bx-ef-date-to', textContent: 'To' }),
                    dateToInput
                ])
            ]),
            el('div', { className: 'bx-ef-row' }, [
                el('div', { className: 'bx-ef-group', style: 'flex: 1; min-width: 150px;' }, [
                    el('label', { className: 'bx-ef-label', htmlFor: 'bx-ef-sort-upcoming', textContent: 'Sort Upcoming' }),
                    sortUpcomingSelect
                ]),
                ...(state.isEventsPage ? [
                    el('div', { className: 'bx-ef-group', style: 'flex: 1; min-width: 150px;' }, [
                        el('label', { className: 'bx-ef-label', htmlFor: 'bx-ef-sort-past', textContent: 'Sort Past' }),
                        sortPastSelect
                    ])
                ] : [])
            ]),
            el('div', { className: 'bx-ef-row', style: 'border-top: 1px solid #e5e7eb; padding-top: 16px;' }, [
                togglesContainer,
                el('div', { className: 'bx-ef-stats', id: 'bx-ef-stats-text' })
            ])
        ]);

        return panel;
    }

    function initKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            const searchInput = document.getElementById('bx-ef-search');
            if (!searchInput) return;

            if (e.key === 'Escape' && document.activeElement === searchInput) {
                searchInput.blur();
                return;
            }

            if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !e.target.matches('input, textarea, select')) {
                e.preventDefault();
                searchInput.focus();
            }
        });
    }

    function setupInfiniteScroll() {
        // Disconnect old observer if rebuilding after SPA load
        if (state.io) state.io.disconnect();

        state.io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const sec = entry.target.dataset.section;
                    if (state.filtered[sec] && state.renderIndex[sec] < state.filtered[sec].length) {
                        renderNextPage(sec);
                    }
                }
            });
        }, { rootMargin: '400px' });

        ['upcoming', 'past'].forEach(sec => {
            const container = state.containers[sec];
            if (container && !document.getElementById(`bx-ef-sentinel-${sec}`)) {
                const sentinel = el('div', { id: `bx-ef-sentinel-${sec}`, 'data-section': sec, style: 'height: 1px; width: 100%; clear: both;' });
                container.appendChild(sentinel);
                state.io.observe(sentinel);
            }
        });
    }

    function injectUI() {
        if (document.getElementById('bx-ef-panel')) return;

        const mainContainer = document.querySelector(CONFIG.SELECTORS.TARGET_PARENT);
        if (!mainContainer) {
            log('Main container not found, aborting injection.');
            return;
        }

        const filterPanel = buildFilterPanel();

        const globalEmpty = el('div', { id: 'bx-ef-global-empty', className: 'bx-ef-empty-msg bx-ef-hidden' }, [
            getIconSvg(),
            el('div', { textContent: 'All Events Hidden', style: 'font-weight: 600; color: #111827; margin-bottom: 4px;' }),
            el('div', { textContent: 'You have toggled off all event sections. Please enable Upcoming or Past events to view them.', style: 'font-size: 0.85rem;' })
        ]);

        const firstEventsSection = document.querySelector('.events');
        if (firstEventsSection) {
            firstEventsSection.parentNode.insertBefore(filterPanel, firstEventsSection);
            firstEventsSection.parentNode.insertBefore(globalEmpty, firstEventsSection);
        } else {
            mainContainer.prepend(globalEmpty);
            mainContainer.prepend(filterPanel);
        }

        initKeyboardNavigation();
    }

    // ==========================================
    // OBSERVER LIFECYCLE
    // ==========================================

    function setupObserver() {
        const targetNode = document.querySelector(CONFIG.SELECTORS.TARGET_PARENT) || document.body;

        const observer = new MutationObserver((mutations) => {
            if (state.isMutating) return;

            let hasNewUnprocessed = false;
            let containersReplaced = false;

            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {

                            // Check if the site completely swapped out the container wrappers (SPA Navigation)
                            if (node.matches(CONFIG.SELECTORS.UPCOMING_CONTAINER) || node.matches(CONFIG.SELECTORS.PAST_CONTAINER)) {
                                containersReplaced = true;
                            }

                            // Check for raw events
                            if (node.matches && node.matches(CONFIG.SELECTORS.EVENT_CARD) && node.dataset.bxProcessed !== 'true') {
                                hasNewUnprocessed = true;
                            } else if (!hasNewUnprocessed && node.querySelector && node.querySelector(`${CONFIG.SELECTORS.EVENT_CARD}:not([data-bx-processed="true"])`)) {
                                hasNewUnprocessed = true;
                            }
                        }
                    }
                }
            }

            if (containersReplaced) {
                log('Containers replaced by site framework. Re-initializing containers and sentinels...');
                initContainers();
                setupInfiniteScroll();
            }

            if (hasNewUnprocessed) {
                log('New unprocessed events detected from site JS. Re-indexing...');
                clearTimeout(state.observerTimer);
                state.observerTimer = setTimeout(async () => {
                    const added = await preprocessEvents();
                    if (added) executeFilter();
                }, CONFIG.DEBOUNCE_MS);
            }
        });

        observer.observe(targetNode, { childList: true, subtree: true });
    }

    // ==========================================
    // BOOTSTRAP
    // ==========================================

    async function init() {
        try {
            log('Initializing filter engine v2.0...');
            injectStyles();
            injectUI();
            initContainers();

            // Wait for initial bulk extraction to finish off main-thread
            await preprocessEvents();

            setupInfiniteScroll();
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
