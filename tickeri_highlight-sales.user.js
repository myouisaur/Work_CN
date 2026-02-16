// ==UserScript==
// @name         [Tickeri] Ticket Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.tickeri.com/promoter/tickeri-eo-favicon.ico
// @version      1.3
// @description  Highlights ticket sold.
// @author       Xiv
// @match        *://*.tickeri.com/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/tickeri_highlight-sales.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/tickeri_highlight-sales.user.js
// ==/UserScript==

(function() {
    'use strict';

    // CONFIGURATION
    const TARGET_TEXT = "Tickets sold";

    // Increased visibility colors (Material Design 300 series)
    const COLOR_SOLD = "#81c784"; // Clear Green for sales
    const COLOR_ZERO = "#e57373"; // Soft Red for zero sales

    const PROCESSED_CLASS = "tm-checked"; // Flag to prevent re-processing

    /**
     * Scans the document for specific 'Tickets sold' elements.
     * Highlights Green if > 0, Red if 0.
     */
    function highlightTickets() {
        // Find all H3 elements containing "Tickets sold"
        const xpath = `//h3[contains(text(), '${TARGET_TEXT}')]`;
        const snapshot = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

        for (let i = 0; i < snapshot.snapshotLength; i++) {
            const labelNode = snapshot.snapshotItem(i);
            const container = labelNode.parentNode; // The main wrapper div

            // OPTIMIZATION: Skip if we have already colored this one
            if (container.classList.contains(PROCESSED_CLASS)) continue;

            // Find the number value.
            // Structure: Container -> div (flex wrapper) -> h3 (Number)
            const countWrapper = container.querySelector('div');

            if (countWrapper) {
                const countHeader = countWrapper.querySelector('h3');
                if (countHeader) {
                    // Clean the number (remove commas)
                    const countText = countHeader.textContent.trim();
                    const count = parseInt(countText.replace(/,/g, ''), 10);

                    if (!isNaN(count)) {
                        // Apply Styling
                        container.style.borderRadius = "6px";
                        container.style.padding = "4px 8px";
                        container.style.transition = "background-color 0.2s ease";

                        // Force text color to black to ensure contrast against green/red backgrounds
                        // (This fixes potential issues if the user is in Dark Mode)
                        container.style.color = "#000000";
                        labelNode.style.color = "#000000";
                        countHeader.style.color = "#000000";

                        if (count > 0) {
                            container.style.backgroundColor = COLOR_SOLD;
                        } else {
                            container.style.backgroundColor = COLOR_ZERO;
                        }
                    }
                }
            }

            // Mark as done so we don't process it again
            container.classList.add(PROCESSED_CLASS);
        }
    }

    // 1. Run immediately on load
    highlightTickets();

    // 2. Watch for "Next Page" or dynamic content loading
    const observer = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldScan = true;
                break;
            }
        }
        if (shouldScan) {
            highlightTickets();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
