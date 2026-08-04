// ==UserScript==
// @name         [Eventbrite] Recurring Date Highlight
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      2.6
// @description  Adds an interactive calendar button to recurring events to visually indicate if your selected dates fall within the valid schedule.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/Eventbrite/recurring-date-highlight.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/Eventbrite/recurring-date-highlight.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Prevent duplicate execution
    if (window.xivInitialized) return;
    window.xivInitialized = true;

    // ============================================================================
    // 1. CONFIGURATION
    // ============================================================================

    const CONFIG = {
        // Selectors
        SELECTORS: {
            OBSERVER_TARGET: ['#__next', '#root', 'main', 'body'],
            RECURRING_HEADING: ['p[class*="Typography_heading"]', 'h1', 'h2'],
            DATE_WRAPPER: ['div[class*="EventDateDisplay"][class*="eventDateDisplay"]', '.js-event-date-display'],
            DATE_TEXT: ['p', 'span'],
            ICON: ['i', 'svg']
        },

        // CSS Classes
        CLASSES: {
            CONTAINER: 'xiv-flex-container',
            BADGE: 'xiv-date-badge',
            VALID_DATE: 'xiv-date-valid',
            INVALID_DATE: 'xiv-date-invalid',
            BTN: 'xiv-picker-btn',
            BTN_VALID: 'xiv-is-valid',
            BTN_INVALID: 'xiv-is-invalid',
            ICON_BOX: 'xiv-calendar-icon-box',
            TOOLTIP: 'xiv-custom-tooltip',
            HIDE_ORIGINAL: 'xiv-hide-original-icon',
            HIDDEN_INPUT: 'xiv-hidden-date-input'
        },

        // Storage Keys
        STORAGE: {
            DEFAULT_DAY: 'xiv_eb_preferred_day'
        },

        // Timing
        TIMING: {
            DEBOUNCE_MS: 200
        },

        // Data & Assets
        DATA: {
            DEFAULT_DAY_INDEX: 4, // 4 = Thursday
            DAYS_MAP: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            CALENDAR_SVG: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`
        }
    };

    // ============================================================================
    // 2. STYLES
    // ============================================================================

    const STYLES = `
        :root {
            /* Eventbrite Brand Colors */
            --xiv-eb-navy: #1e0a3c;
            --xiv-eb-blue: #3659e3;
            --xiv-eb-orange: #f05537;

            /* Status Colors: Valid (Blue) */
            --xiv-valid-bg: #ebf0ff;
            --xiv-valid-text: var(--xiv-eb-blue);
            --xiv-valid-border: var(--xiv-eb-blue);

            /* Status Colors: Invalid (Orange) */
            --xiv-invalid-bg: #fdece9;
            --xiv-invalid-text: var(--xiv-eb-orange);
            --xiv-invalid-border: var(--xiv-eb-orange);

            --xiv-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .${CONFIG.CLASSES.CONTAINER} {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            flex-wrap: wrap !important;
        }

        .${CONFIG.CLASSES.BADGE} {
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

        .${CONFIG.CLASSES.VALID_DATE} {
            background-color: var(--xiv-valid-bg) !important;
            color: var(--xiv-valid-text) !important;
            border: 1px solid var(--xiv-valid-border) !important;
        }

        .${CONFIG.CLASSES.INVALID_DATE} {
            background-color: var(--xiv-invalid-bg) !important;
            color: var(--xiv-invalid-text) !important;
            border: 1px solid var(--xiv-invalid-border) !important;
        }

        .${CONFIG.CLASSES.BTN} {
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

        .${CONFIG.CLASSES.ICON_BOX} {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-sizing: border-box !important;
            min-width: 36px !important;
            min-height: 36px !important;
            border-radius: 0.375rem !important;
            background-color: transparent !important;
            transition: all 0.2s ease !important;
            color: var(--xiv-eb-navy) !important;
        }

        .${CONFIG.CLASSES.BTN}.${CONFIG.CLASSES.BTN_VALID}:hover .${CONFIG.CLASSES.ICON_BOX},
        .${CONFIG.CLASSES.BTN}.${CONFIG.CLASSES.BTN_VALID}:focus-visible .${CONFIG.CLASSES.ICON_BOX} {
            background-color: rgba(54, 89, 227, 0.08) !important;
            box-shadow: inset 0 0 0 2px var(--xiv-eb-blue) !important;
            transform: scale(1.05);
        }

        .${CONFIG.CLASSES.BTN}.${CONFIG.CLASSES.BTN_INVALID}:hover .${CONFIG.CLASSES.ICON_BOX},
        .${CONFIG.CLASSES.BTN}.${CONFIG.CLASSES.BTN_INVALID}:focus-visible .${CONFIG.CLASSES.ICON_BOX} {
            background-color: rgba(240, 85, 55, 0.08) !important;
            box-shadow: inset 0 0 0 2px var(--xiv-eb-orange) !important;
            transform: scale(1.05);
        }

        #${CONFIG.CLASSES.TOOLTIP} {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background-color: var(--xiv-eb-navy);
            color: #ffffff;
            padding: 0.5rem 0;
            width: clamp(100px, 8rem, 120px);
            box-sizing: border-box;
            border-radius: 0.5rem;
            font-size: clamp(0.75rem, 1vw, 0.875rem);
            font-weight: 600;
            box-shadow: var(--xiv-shadow);
            white-space: nowrap;
            line-height: 1;
            transition: transform 0.2s ease;
        }

        .${CONFIG.CLASSES.BTN}:hover #${CONFIG.CLASSES.TOOLTIP} {
            transform: translateX(-2px);
        }

        #${CONFIG.CLASSES.TOOLTIP}::after {
            content: '';
            position: absolute;
            top: 50%;
            right: -5px;
            transform: translateY(-50%);
            border-width: 6px 0 6px 6px;
            border-style: solid;
            border-color: transparent transparent transparent var(--xiv-eb-navy);
        }

        .${CONFIG.CLASSES.HIDE_ORIGINAL} {
            display: none !important;
        }

        .${CONFIG.CLASSES.HIDDEN_INPUT} {
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

    const getObserverTarget = () => {
        return findFirstElement(CONFIG.SELECTORS.OBSERVER_TARGET);
    };

    const getLatestDayOfWeek = () => {
        const d = new Date();
        // Shift the reference point to yesterday to strictly scan the past 7 completed days
        d.setDate(d.getDate() - 1);

        const currentDay = d.getDay();
        const target = GM_getValue(CONFIG.STORAGE.DEFAULT_DAY, CONFIG.DATA.DEFAULT_DAY_INDEX);

        // Safety bound: fallback to default if stored data is corrupted
        const safeTarget = (typeof target === 'number' && target >= 0 && target <= 6) ? target : CONFIG.DATA.DEFAULT_DAY_INDEX;
        const diff = (currentDay >= safeTarget) ? (currentDay - safeTarget) : (currentDay + (7 - safeTarget));

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
            console.warn('[Eventbrite Recurring Highlight][Core] Could not parse date string:', err);
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
        GM_addStyle(STYLES);

        // Power User Menu Configuration
        GM_registerMenuCommand("📅 Set Default Day", () => {
            const currentVal = GM_getValue(CONFIG.STORAGE.DEFAULT_DAY, CONFIG.DATA.DEFAULT_DAY_INDEX);
            const input = prompt(
                `Enter the default day of the week you want the calendar to start on (e.g., Monday, Thursday):\n\nCurrent Default: ${CONFIG.DATA.DAYS_MAP[currentVal]}`
            );

            if (!input) return;

            const cleanInput = input.trim().toLowerCase();
            const dayIndex = CONFIG.DATA.DAYS_MAP.findIndex(d => d.toLowerCase().startsWith(cleanInput));

            if (dayIndex !== -1) {
                GM_setValue(CONFIG.STORAGE.DEFAULT_DAY, dayIndex);
                alert(`Success! Default day set to ${CONFIG.DATA.DAYS_MAP[dayIndex]}.`);
                resetAndScan();
            } else {
                alert("Invalid input. Please enter a full day name (like 'Monday').");
            }
        });

        // Intercept SPA navigations to ensure UI rebuilds correctly
        const handleNavigation = () => requestAnimationFrame(() => resetAndScan());

        const originalPush = history.pushState;
        history.pushState = function() { originalPush.apply(history, arguments); handleNavigation(); };
        const originalReplace = history.replaceState;
        history.replaceState = function() { originalReplace.apply(history, arguments); handleNavigation(); };
        window.addEventListener('popstate', handleNavigation);

        resetAndScan();
        startObservers();
    }

    function cleanupOldElements() {
        const oldBtn = document.getElementById('xiv-picker-btn');
        if (oldBtn) oldBtn.remove();

        const injectedIcons = document.querySelectorAll('[data-xiv-injected]');
        injectedIcons.forEach(icon => {
            icon.removeAttribute('data-xiv-injected');
            icon.classList.remove(CONFIG.CLASSES.HIDE_ORIGINAL);
        });
    }

    function resetAndScan() {
        hasInjected = false;
        cleanupOldElements();
        scanPage();
    }

    function startObservers() {
        if (domObserver) domObserver.disconnect();

        const target = getObserverTarget();
        if (!target) return; // Fallback handled; if even body is missing, page isn't ready

        domObserver = new MutationObserver(() => {
            try {
                if (hasInjected && !document.getElementById('xiv-picker-btn')) {
                    hasInjected = false;
                }
                if (!hasInjected) {
                    clearTimeout(scanTimer);
                    scanTimer = setTimeout(scanPage, CONFIG.TIMING.DEBOUNCE_MS);
                }
            } catch (err) {
                console.warn('[Eventbrite Recurring Highlight][Observer] Observer error:', err);
            }
        });

        domObserver.observe(target, { childList: true, subtree: true });
    }

    function scanPage() {
        if (hasInjected) return;

        try {
            // Check if page contains "Recurring event overview" (using layout-independent textContent)
            const headings = Array.from(document.querySelectorAll(CONFIG.SELECTORS.RECURRING_HEADING.join(', ')));
            const isRecurring = headings.some(el => (el.textContent || '').includes("Recurring event overview"));
            if (!isRecurring) return;

            const dateContainer = findFirstElement(CONFIG.SELECTORS.DATE_WRAPPER);
            if (!dateContainer) return;

            const dateTextElem = findFirstElement(CONFIG.SELECTORS.DATE_TEXT, dateContainer);
            const originalIcon = findFirstElement(CONFIG.SELECTORS.ICON, dateContainer);

            if (!dateTextElem || !originalIcon || originalIcon.hasAttribute('data-xiv-injected')) return;

            const endDate = parseEndDate(dateTextElem.textContent);
            if (!endDate) return;

            injectDatePicker(dateContainer, originalIcon, dateTextElem, endDate);
            hasInjected = true;

        } catch (err) {
            console.warn('[Eventbrite Recurring Highlight][Core] Error during page scan:', err);
        }
    }

    function evaluateDateState(selectedDate, endDate, textElement, btnElement) {
        const isInvalid = selectedDate.getTime() > endDate.getTime();

        requestAnimationFrame(() => {
            textElement.classList.add(CONFIG.CLASSES.BADGE);
            if (isInvalid) {
                textElement.classList.add(CONFIG.CLASSES.INVALID_DATE);
                textElement.classList.remove(CONFIG.CLASSES.VALID_DATE);
                btnElement.classList.add(CONFIG.CLASSES.BTN_INVALID);
                btnElement.classList.remove(CONFIG.CLASSES.BTN_VALID);
            } else {
                textElement.classList.add(CONFIG.CLASSES.VALID_DATE);
                textElement.classList.remove(CONFIG.CLASSES.INVALID_DATE);
                btnElement.classList.add(CONFIG.CLASSES.BTN_VALID);
                btnElement.classList.remove(CONFIG.CLASSES.BTN_INVALID);
            }
        });
    }

    function injectDatePicker(container, originalIcon, textElement, endDate) {
        container.classList.add(CONFIG.CLASSES.CONTAINER);

        originalIcon.setAttribute('data-xiv-injected', 'true');
        originalIcon.classList.add(CONFIG.CLASSES.HIDE_ORIGINAL);

        const btn = document.createElement('button');
        btn.id = 'xiv-picker-btn';
        btn.className = CONFIG.CLASSES.BTN;
        btn.setAttribute('type', 'button');
        btn.setAttribute('aria-label', 'Select a date to check availability');

        const iconWrapper = document.createElement('div');
        iconWrapper.className = CONFIG.CLASSES.ICON_BOX;
        iconWrapper.innerHTML = CONFIG.DATA.CALENDAR_SVG;

        const tooltip = document.createElement('div');
        tooltip.id = CONFIG.CLASSES.TOOLTIP;

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.className = CONFIG.CLASSES.HIDDEN_INPUT;

        btn.appendChild(tooltip);
        btn.appendChild(iconWrapper);
        btn.appendChild(dateInput);

        container.insertBefore(btn, textElement);

        let currentSelectedDate = getLatestDayOfWeek();

        const applyVisualState = (dateObj) => {
            requestAnimationFrame(() => {
                dateInput.value = formatDateToYYYYMMDD(dateObj);
                tooltip.textContent = formatForTooltip(dateObj);
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
            if (parts.length === 3) {
                currentSelectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
                currentSelectedDate.setHours(0, 0, 0, 0);
                applyVisualState(currentSelectedDate);
            }
        });
    }

    // Initialize Script
    init();

})();
