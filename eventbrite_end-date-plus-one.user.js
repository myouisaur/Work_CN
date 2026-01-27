// ==UserScript==
// @name         [Eventbrite] Set End Date +1 Day
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      1.2
// @description  Adds a button to set Event End date to Event Start + 1 Day
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_end-date-plus-one.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_end-date-plus-one.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_ID = 'eb-userscript-plus-one-day';

    // Helper: Eventbrite uses React/Internal state.
    // Simply setting .value = "x" won't save the data. We must trigger the native setter and events.
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

    function addOneDay() {
        const startInput = document.getElementById('copy-startDate');
        const endInput = document.getElementById('copy-endDate');

        if (!startInput || !endInput) {
            console.error('Eventbrite Userscript: Date inputs not found.');
            return;
        }

        const startVal = startInput.value;

        // Validation: Check for blank input
        if (!startVal || startVal.trim() === '') {
            alert('Please enter an Event Start date first.');
            startInput.focus();
            return;
        }

        try {
            // Parse MM/DD/YYYY
            const parts = startVal.split('/'); // [MM, DD, YYYY]
            if (parts.length !== 3) {
                alert('Invalid date format. Expected MM/DD/YYYY');
                return;
            }

            // Note: Month is 0-indexed in JS Date (0 = Jan, 1 = Feb)
            const currentObj = new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));

            // Add 1 Day
            currentObj.setDate(currentObj.getDate() + 1);

            // Format back to MM/DD/YYYY
            const newMm = String(currentObj.getMonth() + 1).padStart(2, '0');
            const newDd = String(currentObj.getDate()).padStart(2, '0');
            const newYyyy = currentObj.getFullYear();

            const newDateString = `${newMm}/${newDd}/${newYyyy}`;

            // 1. Set the value using the React-safe helper
            setNativeValue(endInput, newDateString);

            // 2. FOCUS (Simulate user clicking inside)
            endInput.focus();

            // 3. BLUR (Simulate user clicking away) - with a tiny delay to ensure validation catches it
            setTimeout(() => {
                endInput.blur();
            }, 100);

        } catch (e) {
            console.error(e);
            alert('Error calculating date. Please check the start date format.');
        }
    }

    function init() {
        // Prevent duplicate buttons
        if (document.getElementById(BUTTON_ID)) return;

        // Locate the "Cancel" button to use as an anchor
        const buttons = Array.from(document.querySelectorAll('button'));
        const cancelButton = buttons.find(b => b.textContent.trim() === 'Cancel');

        if (cancelButton) {
            // Find the container cell <div class="eds-g-cell">
            const cancelCell = cancelButton.closest('.eds-g-cell');

            if (cancelCell) {
                // Create the container cell for our button
                const newCell = document.createElement('div');
                newCell.className = 'eds-g-cell';
                newCell.innerHTML = '<div class="eds-l-pad-right-2"></div>';

                // Create the button
                const myBtn = document.createElement('button');
                myBtn.id = BUTTON_ID;
                myBtn.type = 'button';
                myBtn.className = 'eds-btn eds-btn--button eds-btn--neutral eds-btn--block';
                myBtn.innerText = '+1 Day';
                myBtn.style.border = '1px solid #3d64ff';
                myBtn.style.color = '#3d64ff';

                myBtn.addEventListener('click', addOneDay);

                // Append button to inner div
                newCell.firstElementChild.appendChild(myBtn);

                // Insert before the cancel cell
                cancelCell.parentNode.insertBefore(newCell, cancelCell);
            }
        }
    }

    // Use a MutationObserver to handle page loads (SPA behavior)
    const observer = new MutationObserver((mutations) => {
        if (document.getElementById('copy-startDate') && !document.getElementById(BUTTON_ID)) {
            init();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
