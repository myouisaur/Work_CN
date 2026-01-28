// ==UserScript==
// @name         [Eventbrite] Advanced Date Setter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      1.4
// @description  Adds a button to set Event date
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_advanced-date-setter.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_advanced-date-setter.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_ID = 'eb-userscript-smart-date';
    const DELAY_MS = 200;

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // NEW: Flexible Date Parser
    function parseFlexibleDate(inputStr) {
        if (!inputStr) return null;

        // Clean input: lowercase and replace separators ( . / - ) with spaces
        const cleaned = inputStr.trim().toLowerCase().replace(/[.\/\-]/g, ' ');
        const parts = cleaned.split(/\s+/);

        if (parts.length < 2) return null;

        const monthsMap = {
            jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
            apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
            aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
            nov: 11, november: 11, dec: 12, december: 12
        };

        let m, d, y;

        // Part 1: Month (Check if it's a name like 'feb' or a number)
        if (isNaN(parts[0])) {
            m = monthsMap[parts[0]];
        } else {
            m = parseInt(parts[0], 10);
        }

        // Part 2: Day
        d = parseInt(parts[1], 10);

        // Part 3: Year (Handle presence/absence and 2-digit format)
        if (parts.length >= 3) {
            y = parseInt(parts[2], 10);
            if (y < 100) y += 2000; // '26' becomes '2026'
        } else {
            y = new Date().getFullYear(); // Default to 2026
        }

        // Validation
        if (!m || isNaN(d) || isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;

        return new Date(y, m - 1, d);
    }

    function formatDateToString(dateObj) {
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const yyyy = dateObj.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    }

    async function handleButtonClick() {
        const startInput = document.getElementById('copy-startDate');
        const endInput = document.getElementById('copy-endDate');

        if (!startInput || !endInput) {
            alert('Error: Date input boxes not found.');
            return;
        }

        const userInput = prompt("Enter Start Date:\n(Examples: '2.5', '2-5', 'feb 5', 'february 5 2026')");
        if (!userInput) return;

        const startDateObj = parseFlexibleDate(userInput);
        if (!startDateObj || isNaN(startDateObj.getTime())) {
            alert("Invalid date format. Please try m/d, m.d, or Month Day.");
            return;
        }

        const startStr = formatDateToString(startDateObj);
        const endDateObj = new Date(startDateObj);
        endDateObj.setDate(startDateObj.getDate() + 1);
        const endStr = formatDateToString(endDateObj);

        // START DATE SEQUENCE
        setNativeValue(startInput, startStr);
        startInput.focus();
        await delay(DELAY_MS);
        startInput.blur();
        await delay(DELAY_MS);

        // END DATE SEQUENCE
        setNativeValue(endInput, endStr);
        endInput.focus();
        await delay(DELAY_MS);
        endInput.blur();
    }

    function init() {
        if (document.getElementById(BUTTON_ID)) return;

        const buttons = Array.from(document.querySelectorAll('button'));
        const cancelButton = buttons.find(b => b.textContent.trim() === 'Cancel');

        if (cancelButton) {
            const cancelCell = cancelButton.closest('.eds-g-cell');
            if (cancelCell) {
                const newCell = document.createElement('div');
                newCell.className = 'eds-g-cell';
                newCell.innerHTML = '<div class="eds-l-pad-right-2"></div>';

                const myBtn = document.createElement('button');
                myBtn.id = BUTTON_ID;
                myBtn.type = 'button';
                myBtn.className = 'eds-btn eds-btn--button eds-btn--neutral eds-btn--block';
                myBtn.innerText = 'Smart Input';
                myBtn.style.border = '1px solid #3d64ff';
                myBtn.style.color = '#3d64ff';

                myBtn.addEventListener('click', handleButtonClick);

                newCell.firstElementChild.appendChild(myBtn);
                cancelCell.parentNode.insertBefore(newCell, cancelCell);
            }
        }
    }

    const observer = new MutationObserver(() => {
        if (document.getElementById('copy-startDate') && !document.getElementById(BUTTON_ID)) {
            init();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
