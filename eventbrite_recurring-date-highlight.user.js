// ==UserScript==
// @name         [Eventbrite] Recurring Date Highlight
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      1.6
// @description  Adds a calendar to the recurring event icon, and highlights date.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_recurring-date-highlight.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_recurring-date-highlight.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // 1. HELPERS & CONFIG
    // ============================================================================

    const getLatestThursday = () => {
        const d = new Date();
        const day = d.getDay();
        const diff = (day >= 4) ? (day - 4) : (day + 3);
        d.setDate(d.getDate() - diff);
        return d;
    };

    const formatDateToYYYYMMDD = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    // Formats date to "Apr 23, 2026"
    const formatForTooltip = (date) => {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const parseEndDate = (dateRangeStr) => {
        if (!dateRangeStr) return null;
        const parts = dateRangeStr.split('-');
        if (parts.length >= 2) {
            return new Date(parts[1].trim());
        }
        return null;
    };

    // ============================================================================
    // 2. STYLES
    // ============================================================================
    const STYLES = `
        /* --- Date Badge Base --- */
        .ues-date-badge {
            border-radius: 6px;
            /* Use symmetric padding and line-height: 1 to perfectly center text inside */
            padding: 4px 10px !important;
            margin-left: 8px !important;
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            transition: all 0.3s ease;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-weight: 500;
            line-height: 1 !important;
            vertical-align: middle;
            box-sizing: border-box;
        }

        /* --- Valid Date (Stronger Green) --- */
        .ues-date-valid {
            background-color: #a7f3d0 !important;
            color: #064e3b !important;
            border: 1px solid #10b981 !important;
        }

        /* --- Invalid Date (Stronger Red) --- */
        .ues-date-invalid {
            background-color: #fecaca !important;
            color: #7f1d1d !important;
            border: 1px solid #ef4444 !important;
        }

        /* --- Clickable Calendar Icon --- */
        .ues-calendar-trigger {
            cursor: pointer !important;
            border-radius: 4px;
            transition: all 0.2s ease;
            padding: 2px;
            vertical-align: middle;
            display: inline-flex;
            align-items: center;
        }
        .ues-calendar-trigger:hover {
            transform: scale(1.1);
            background-color: rgba(0,0,0,0.05);
        }

        /* --- Permanent Custom Date Display --- */
        #ues-custom-tooltip {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            vertical-align: middle;
            background-color: #ffffff;
            color: #1e1b4b;
            border: 1px solid #d1d5db;
            padding: 8px 0; /* Remove side padding since we are using fixed width */
            width: 115px; /* Fixed width prevents neighboring elements from shifting */
            box-sizing: border-box;
            border-radius: 8px;
            font-family: "Neue Plak", -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
            margin-right: 14px;
            white-space: nowrap;
            z-index: 10;
            line-height: 1;
        }

        /* Tooltip Arrow Border */
        #ues-custom-tooltip::before {
            content: '';
            position: absolute;
            top: 50%;
            right: -8px;
            transform: translateY(-50%);
            border-width: 8px 0 8px 8px;
            border-style: solid;
            border-color: transparent transparent transparent #d1d5db;
        }

        /* Tooltip Arrow Inner Fill */
        #ues-custom-tooltip::after {
            content: '';
            position: absolute;
            top: 50%;
            right: -7px;
            transform: translateY(-50%);
            border-width: 7px 0 7px 7px;
            border-style: solid;
            border-color: transparent transparent transparent #ffffff;
        }

        /* --- Hidden Native Date Input --- */
        .ues-hidden-date-input {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }
    `;

    GM_addStyle(STYLES);

    // ============================================================================
    // 3. CORE LOGIC
    // ============================================================================

    let domObserver = null;
    let scanTimer = null;
    let hasInjected = false;

    function init() {
        const originalPush = history.pushState;
        history.pushState = function() { originalPush.apply(history, arguments); resetAndScan(); };
        const originalReplace = history.replaceState;
        history.replaceState = function() { originalReplace.apply(history, arguments); resetAndScan(); };
        window.addEventListener('popstate', resetAndScan);

        startObservers();
        document.addEventListener('visibilitychange', () => {
            document.hidden ? stopObservers() : startObservers();
        });

        resetAndScan();
    }

    function resetAndScan() {
        hasInjected = false;
        scanPage();
    }

    function startObservers() {
        if (!domObserver) {
            domObserver = new MutationObserver(() => {
                if (!hasInjected) {
                    clearTimeout(scanTimer);
                    scanTimer = setTimeout(scanPage, 150);
                }
            });
            domObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    function stopObservers() {
        if (domObserver) { domObserver.disconnect(); domObserver = null; }
        clearTimeout(scanTimer);
    }

    function scanPage() {
        if (hasInjected) return;

        const isRecurring = Array.from(document.querySelectorAll('p[class*="Typography_heading"]'))
            .some(p => p.innerText.includes("Recurring event overview"));

        if (!isRecurring) return;

        const dateContainer = document.querySelector('div[class*="EventDateDisplay_eventDateDisplay"]');
        if (!dateContainer) return;

        const dateTextElem = dateContainer.querySelector('p');
        const iconElem = dateContainer.querySelector('i');

        if (!dateTextElem || !iconElem || iconElem.hasAttribute('data-ues-injected')) return;

        const endDate = parseEndDate(dateTextElem.innerText);
        if (!endDate || isNaN(endDate.getTime())) return;

        injectDatePicker(dateContainer, iconElem, dateTextElem, endDate);
        hasInjected = true;
    }

    function evaluateDateState(selectedDate, endDate, textElement) {
        selectedDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        textElement.classList.add('ues-date-badge');

        if (selectedDate > endDate) {
            textElement.classList.add('ues-date-invalid');
            textElement.classList.remove('ues-date-valid');
        } else {
            textElement.classList.add('ues-date-valid');
            textElement.classList.remove('ues-date-invalid');
        }
    }

    function injectDatePicker(container, icon, textElement, endDate) {
        icon.setAttribute('data-ues-injected', 'true');
        icon.classList.add('ues-calendar-trigger');

        // Setup hidden date input
        let dateInput = document.getElementById('ues-eb-date-picker');
        if (!dateInput) {
            dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.id = 'ues-eb-date-picker';
            dateInput.classList.add('ues-hidden-date-input');
            document.body.appendChild(dateInput);
        }

        // Setup the permanent custom date display
        let tooltip = document.getElementById('ues-custom-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'ues-custom-tooltip';
            icon.parentNode.insertBefore(tooltip, icon);
        }

        // Set Default Date and visually populate
        let currentSelectedDate = getLatestThursday();
        dateInput.value = formatDateToYYYYMMDD(currentSelectedDate);
        tooltip.innerText = formatForTooltip(currentSelectedDate);
        evaluateDateState(currentSelectedDate, endDate, textElement);

        // Click Event (Opens Native Calendar)
        icon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const rect = icon.getBoundingClientRect();
                dateInput.style.top = `${rect.bottom + window.scrollY}px`;
                dateInput.style.left = `${rect.left + window.scrollX}px`;

                dateInput.showPicker();
            } catch (err) {
                console.warn("Browser doesn't support showPicker(), falling back to focus.", err);
                dateInput.focus();
            }
        });

        // Date Change Event (Updates UI)
        dateInput.addEventListener('change', (e) => {
            if (!e.target.value) return;

            const parts = e.target.value.split('-');
            currentSelectedDate = new Date(parts[0], parts[1] - 1, parts[2]);

            tooltip.innerText = formatForTooltip(currentSelectedDate);
            evaluateDateState(currentSelectedDate, endDate, textElement);
        });
    }

    init();

})();
