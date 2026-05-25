// ==UserScript==
// @name         [Eventbrite] Recurring Date Highlight
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      2.5
// @description  Adds a calendar to recurring event icons and visually indicates if selected dates fall within the valid event schedule.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @noframes
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_recurring-date-highlight.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_recurring-date-highlight.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // 1. SAFEGUARDS & CONFIG
    // ============================================================================

    if (window.__ues_eb_recurring_running) return;
    window.__ues_eb_recurring_running = true;

    const CONFIG = {
        SELECTORS: {
            RECURRING_HEADING: ['p[class*="Typography_heading"]', 'h1', 'h2'],
            DATE_WRAPPER: ['div[class*="EventDateDisplay_eventDateDisplay"]', '.js-event-date-display'],
            DATE_TEXT: ['p', 'span'],
            ICON: ['i', 'svg']
        },
        GM_STORAGE_KEY: 'ues_eb_preferred_day',
        TIMERS: {
            OBSERVER_DEBOUNCE_MS: 200
        },
        LOGIC: {
            DEFAULT_DAY: 4, // 4 = Thursday
            DAYS_MAP: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        },
        ASSETS: {
            CALENDAR_SVG: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`
        }
    };

    // ============================================================================
    // 2. STYLES (Native Eventbrite UI & Flex Layout)
    // ============================================================================
    const STYLES = `
        :root {
            /* Eventbrite Brand Colors */
            --ues-eb-navy: #1e0a3c;
            --ues-eb-grey: #eeedf2;
            --ues-eb-blue: #3659e3;
            --ues-eb-orange: #f05537;

            /* Status Colors: Valid (Blue) */
            --ues-valid-bg: #ebf0ff;
            --ues-valid-text: var(--ues-eb-blue);
            --ues-valid-border: var(--ues-eb-blue);

            /* Status Colors: Invalid (Orange) */
            --ues-invalid-bg: #fdece9;
            --ues-invalid-text: var(--ues-eb-orange);
            --ues-invalid-border: var(--ues-eb-orange);

            --ues-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .ues-flex-container {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            flex-wrap: wrap !important;
        }

        .ues-date-badge {
            border-radius: 0.375rem;
            padding: 0.25rem 0.625rem !important;
            margin: 0 !important;
            transition: all 0.3s ease;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-weight: 500;
            line-height: 1 !important;
            box-sizing: border-box;
        }

        .ues-date-valid {
            background-color: var(--ues-valid-bg) !important;
            color: var(--ues-valid-text) !important;
            border: 1px solid var(--ues-valid-border) !important;
        }

        .ues-date-invalid {
            background-color: var(--ues-invalid-bg) !important;
            color: var(--ues-invalid-text) !important;
            border: 1px solid var(--ues-invalid-border) !important;
        }

        .ues-picker-btn {
            display: inline-flex !important;
            align-items: center !important;
            gap: 8px !important;
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            cursor: pointer !important;
            position: relative !important;
            outline: none !important;
            font-family: inherit !important;
        }

        .ues-calendar-icon-box {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-sizing: border-box !important;
            min-width: 36px !important;
            min-height: 36px !important;
            border-radius: 0.375rem !important;
            background-color: transparent !important;
            transition: all 0.2s ease !important;
            color: var(--ues-eb-navy) !important;
        }

        .ues-picker-btn.ues-is-valid:hover .ues-calendar-icon-box,
        .ues-picker-btn.ues-is-valid:focus-visible .ues-calendar-icon-box {
            background-color: rgba(54, 89, 227, 0.08) !important;
            box-shadow: inset 0 0 0 2px var(--ues-eb-blue) !important;
            transform: scale(1.05);
        }

        .ues-picker-btn.ues-is-invalid:hover .ues-calendar-icon-box,
        .ues-picker-btn.ues-is-invalid:focus-visible .ues-calendar-icon-box {
            background-color: rgba(240, 85, 55, 0.08) !important;
            box-shadow: inset 0 0 0 2px var(--ues-eb-orange) !important;
            transform: scale(1.05);
        }

        #ues-custom-tooltip {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background-color: var(--ues-eb-navy);
            color: #ffffff;
            padding: 0.5rem 0;
            width: clamp(100px, 8rem, 120px);
            box-sizing: border-box;
            border-radius: 0.5rem;
            font-size: clamp(0.75rem, 1vw, 0.875rem);
            font-weight: 600;
            box-shadow: var(--ues-shadow);
            white-space: nowrap;
            line-height: 1;
            transition: transform 0.2s ease;
        }

        .ues-picker-btn:hover #ues-custom-tooltip {
            transform: translateX(-2px);
        }

        #ues-custom-tooltip::after {
            content: '';
            position: absolute;
            top: 50%;
            right: -5px;
            transform: translateY(-50%);
            border-width: 6px 0 6px 6px;
            border-style: solid;
            border-color: transparent transparent transparent var(--ues-eb-navy);
        }

        .ues-hide-original-icon {
            display: none !important;
        }

        .ues-hidden-date-input {
            position: absolute;
            bottom: 0;
            right: 0;
            opacity: 0;
            pointer-events: none;
            width: 1px;
            height: 1px;
            border: none;
            padding: 0;
        }
    `;

    GM_addStyle(STYLES);

    // ============================================================================
    // 3. UTILITIES & DATA
    // ============================================================================

    const findFirstElement = (selectorArray, parent = document) => {
        for (const selector of selectorArray) {
            const el = parent.querySelector(selector);
            if (el) return el;
        }
        return null;
    };

    const getLatestDayOfWeek = () => {
        const d = new Date();
        // Shift the reference point to yesterday so we strictly scan the past 7 completed days
        d.setDate(d.getDate() - 1);

        const currentDay = d.getDay();
        const target = GM_getValue(CONFIG.GM_STORAGE_KEY, CONFIG.LOGIC.DEFAULT_DAY);
        const diff = (currentDay >= target) ? (currentDay - target) : (currentDay + (7 - target));

        d.setDate(d.getDate() - diff);
        d.setHours(0, 0, 0, 0);
        return d;
    };

    const formatDateToYYYYMMDD = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const formatForTooltip = (date) => {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const parseEndDate = (dateRangeStr) => {
        if (!dateRangeStr || typeof dateRangeStr !== 'string') return null;
        try {
            const parts = dateRangeStr.split('-');
            if (parts.length >= 2) {
                const parsedDate = new Date(parts[1].trim());
                if (!isNaN(parsedDate.getTime())) {
                    parsedDate.setHours(0, 0, 0, 0);
                    return parsedDate;
                }
            }
        } catch (err) {
            console.warn('[Eventbrite Date Highlight] Could not parse date string:', dateRangeStr);
        }
        return null;
    };

    // ============================================================================
    // 4. CORE LOGIC
    // ============================================================================

    let domObserver = null;
    let scanTimer = null;
    let hasInjected = false;

    function init() {
        // Register Power User Menu
        GM_registerMenuCommand("📅 Set Default Day", () => {
            const currentVal = GM_getValue(CONFIG.GM_STORAGE_KEY, CONFIG.LOGIC.DEFAULT_DAY);
            const input = prompt(
                `Enter the default day of the week you want the calendar to start on (e.g., Monday, Thursday):\n\nCurrent Default: ${CONFIG.LOGIC.DAYS_MAP[currentVal]}`
            );

            if (!input) return;

            const cleanInput = input.trim().toLowerCase();
            const dayIndex = CONFIG.LOGIC.DAYS_MAP.findIndex(d => d.toLowerCase().startsWith(cleanInput));

            if (dayIndex !== -1) {
                GM_setValue(CONFIG.GM_STORAGE_KEY, dayIndex);
                alert(`Success! Default day set to ${CONFIG.LOGIC.DAYS_MAP[dayIndex]}.`);
                resetAndScan();
            } else {
                alert("Invalid input. Please enter a full day name (like 'Monday').");
            }
        });

        const handleNavigation = () => {
            requestAnimationFrame(() => resetAndScan());
        };

        const originalPush = history.pushState;
        history.pushState = function() { originalPush.apply(history, arguments); handleNavigation(); };
        const originalReplace = history.replaceState;
        history.replaceState = function() { originalReplace.apply(history, arguments); handleNavigation(); };
        window.addEventListener('popstate', handleNavigation);

        resetAndScan();
        startObservers();
    }

    function cleanupOldElements() {
        const oldBtn = document.getElementById('ues-picker-btn');
        if (oldBtn) oldBtn.remove();

        const injectedIcons = document.querySelectorAll('[data-ues-injected]');
        injectedIcons.forEach(icon => {
            icon.removeAttribute('data-ues-injected');
            icon.classList.remove('ues-hide-original-icon');
        });
    }

    function resetAndScan() {
        hasInjected = false;
        cleanupOldElements();
        scanPage();
    }

    function startObservers() {
        if (!domObserver) {
            domObserver = new MutationObserver(() => {
                if (hasInjected && !document.getElementById('ues-picker-btn')) {
                    hasInjected = false;
                }

                if (!hasInjected) {
                    clearTimeout(scanTimer);
                    scanTimer = setTimeout(scanPage, CONFIG.TIMERS.OBSERVER_DEBOUNCE_MS);
                }
            });

            domObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    function scanPage() {
        if (hasInjected) return;

        try {
            const headings = Array.from(document.querySelectorAll(CONFIG.SELECTORS.RECURRING_HEADING.join(', ')));
            const isRecurring = headings.some(el => el.innerText.includes("Recurring event overview"));
            if (!isRecurring) return;

            const dateContainer = findFirstElement(CONFIG.SELECTORS.DATE_WRAPPER);
            if (!dateContainer) return;

            const dateTextElem = findFirstElement(CONFIG.SELECTORS.DATE_TEXT, dateContainer);
            const originalIcon = findFirstElement(CONFIG.SELECTORS.ICON, dateContainer);

            if (!dateTextElem || !originalIcon || originalIcon.hasAttribute('data-ues-injected')) return;

            const endDate = parseEndDate(dateTextElem.innerText);
            if (!endDate) return;

            injectDatePicker(dateContainer, originalIcon, dateTextElem, endDate);
            hasInjected = true;

        } catch (err) {
            console.error('[Eventbrite Date Highlight] Error during page scan:', err);
        }
    }

    function evaluateDateState(selectedDate, endDate, textElement, btnElement) {
        const isInvalid = selectedDate.getTime() > endDate.getTime();

        requestAnimationFrame(() => {
            textElement.classList.add('ues-date-badge');
            if (isInvalid) {
                textElement.classList.add('ues-date-invalid');
                textElement.classList.remove('ues-date-valid');
                btnElement.classList.add('ues-is-invalid');
                btnElement.classList.remove('ues-is-valid');
            } else {
                textElement.classList.add('ues-date-valid');
                textElement.classList.remove('ues-date-invalid');
                btnElement.classList.add('ues-is-valid');
                btnElement.classList.remove('ues-is-invalid');
            }
        });
    }

    function injectDatePicker(container, originalIcon, textElement, endDate) {
        container.classList.add('ues-flex-container');

        originalIcon.setAttribute('data-ues-injected', 'true');
        originalIcon.classList.add('ues-hide-original-icon');

        const btn = document.createElement('button');
        btn.id = 'ues-picker-btn';
        btn.className = 'ues-picker-btn';
        btn.setAttribute('type', 'button');
        btn.setAttribute('aria-label', 'Select a date to check availability');

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'ues-calendar-icon-box';
        iconWrapper.innerHTML = CONFIG.ASSETS.CALENDAR_SVG;

        const tooltip = document.createElement('div');
        tooltip.id = 'ues-custom-tooltip';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.className = 'ues-hidden-date-input';

        btn.appendChild(tooltip);
        btn.appendChild(iconWrapper);
        btn.appendChild(dateInput);

        container.insertBefore(btn, textElement);

        let currentSelectedDate = getLatestDayOfWeek();

        const applyVisualState = (dateObj) => {
            requestAnimationFrame(() => {
                dateInput.value = formatDateToYYYYMMDD(dateObj);
                tooltip.innerText = formatForTooltip(dateObj);
                evaluateDateState(dateObj, endDate, textElement, btn);
            });
        };

        applyVisualState(currentSelectedDate);

        const handleOpenPicker = (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                dateInput.showPicker();
            } catch (err) {
                dateInput.focus();
            }
        };

        btn.addEventListener('click', handleOpenPicker);
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') handleOpenPicker(e);
        });

        dateInput.addEventListener('change', (e) => {
            if (!e.target.value) return;

            const parts = e.target.value.split('-');
            currentSelectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
            currentSelectedDate.setHours(0, 0, 0, 0);

            applyVisualState(currentSelectedDate);
        });
    }

    init();

})();
