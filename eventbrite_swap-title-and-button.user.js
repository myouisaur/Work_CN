// ==UserScript==
// @name         [Eventbrite] Swap Title and Date Button
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      2.0
// @description  Safely moves the date selector button above the event title on Eventbrite event cards.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_swap-title-and-button.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_swap-title-and-button.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // 1. STYLES (UX Improvement)
    // ============================================================================
    // Injecting CSS ensures we don't rely on hardcoded inline pixels, which can
    // break on mobile devices or if Eventbrite changes their base styling.
    const STYLES = `
        .ues-date-btn-swapped {
            margin-bottom: 12px !important;
            display: inline-flex !important; /* Keeps the button shape intact */
        }
        .ues-title-swapped {
            margin-top: 0 !important;
        }
    `;
    GM_addStyle(STYLES);

    // ============================================================================
    // 2. CORE STATE & OBSERVERS (Performance Optimization)
    // ============================================================================
    let domObserver = null;
    let scanTimer = null;

    function init() {
        // SPA Handling: Intercept history changes
        const originalPush = history.pushState;
        history.pushState = function() { originalPush.apply(history, arguments); triggerScan(); };
        const originalReplace = history.replaceState;
        history.replaceState = function() { originalReplace.apply(history, arguments); triggerScan(); };
        window.addEventListener('popstate', triggerScan);

        // Start observers, pausing when the user switches tabs to save CPU
        startObservers();
        document.addEventListener('visibilitychange', () => {
            document.hidden ? stopObservers() : startObservers();
        });

        triggerScan();
    }

    function triggerScan() {
        clearTimeout(scanTimer);
        // Debounce: Wait 150ms after the last DOM change before scanning
        scanTimer = setTimeout(scanPage, 150);
    }

    function startObservers() {
        if (!domObserver) {
            domObserver = new MutationObserver((mutations) => {
                // Only trigger a scan if nodes were actually added to the DOM
                const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
                if (hasNewNodes) triggerScan();
            });
            domObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    function stopObservers() {
        if (domObserver) {
            domObserver.disconnect();
            domObserver = null;
        }
        clearTimeout(scanTimer);
    }

    // ============================================================================
    // 3. LOGIC & SAFETY NETS (Bulletproofing)
    // ============================================================================

    // Strict Verification: Make absolutely sure the button is a Date Selector
    function isDateButton(btn) {
        if (!btn || btn.tagName !== 'BUTTON') return false;

        // 1. Check known Eventbrite test ID
        if (btn.getAttribute('data-testid') === 'child-recurring-event-dropdown-button') return true;

        // 2. Check dynamic CSS class naming convention
        if (btn.className && btn.className.toLowerCase().includes('dateselector')) return true;

        // 3. Fallback: Check if it has an SVG and date-related text
        const textContent = btn.textContent || '';
        const hasSvg = btn.querySelector('svg') !== null;
        const hasDateText = textContent.includes('Select a date') ||
                            /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(textContent);

        return hasSvg && hasDateText;
    }

    function scanPage() {
        // Find cards that haven't been processed OR haven't errored out
        const eventCards = document.querySelectorAll('div[data-spec="event-description__event-card"]:not([data-ues-swapped])');

        eventCards.forEach(card => {
            try {
                const title = card.querySelector('h3');
                if (!title) throw new Error("Title element not found.");

                // Find the button within the card structure
                const dateButton = card.querySelector('button[class*="dateSelector" i]') ||
                                   card.querySelector('button[data-testid="child-recurring-event-dropdown-button"]') ||
                                   (title.nextElementSibling && title.nextElementSibling.tagName === 'BUTTON' ? title.nextElementSibling : null);

                // Strictly verify before touching the DOM
                if (isDateButton(dateButton)) {
                    // Perform the swap
                    card.insertBefore(dateButton, title);

                    // Apply our injected CSS classes safely
                    dateButton.classList.add('ues-date-btn-swapped');
                    title.classList.add('ues-title-swapped');

                    // Mark as successfully swapped
                    card.setAttribute('data-ues-swapped', 'true');
                } else {
                    // Mark as ignored so we don't keep trying and wasting CPU
                    card.setAttribute('data-ues-swapped', 'ignored');
                }

            } catch (err) {
                // Error Boundary: If the layout changes drastically, catch the error gracefully.
                // This prevents the script from freezing the page or breaking Eventbrite's own JS.
                console.warn('[Eventbrite Swap Script] Layout changed. Failed to swap card elements:', err);

                // Mark as errored so the observer doesn't create an infinite loop of retries
                card.setAttribute('data-ues-swapped', 'error');
            }
        });
    }

    init();

})();
