// ==UserScript==
// @name         [RA] Ticket Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon-32x32.png
// @version      1.4
// @description  Highlights rows with ticket sales.
// @author       Xiv
// @match        *://*.ra.co/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/RA_ticket-sales-highlighter.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA_ticket-sales-highlighter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // CONFIGURATION
    const COLOR_GOLD = "#ffd700"; // Gold
    const ROW_SELECTOR = "li.myEvents"; // The main container for the event line

    /**
     * Main function to scan and highlight.
     * Runs once, strictly linear execution.
     */
    function processTicketSales() {
        // Get all event rows based on the class provided in the snippet
        const eventRows = document.querySelectorAll(ROW_SELECTOR);

        eventRows.forEach(row => {
            // Find the element containing the "tickets sold" text
            // Based on snippet: <div class="stats fl"><a>0 tickets sold</a></div>
            // We search broadly within the row to be safe, or target .stats specifically
            const statsLink = row.querySelector('.stats a') || row.querySelector('.stats');

            if (statsLink && statsLink.textContent) {
                const text = statsLink.textContent.trim();

                // Regex to capture the number before "ticket" or "tickets"
                // Matches "10 tickets sold", "1 ticket sold", etc.
                const match = text.match(/(\d+)\s*tickets?\s*sold/i);

                if (match) {
                    const count = parseInt(match[1], 10);

                    // Logic: Only highlight if count > 0
                    if (!isNaN(count) && count > 0) {
                        row.style.backgroundColor = COLOR_GOLD;
                        row.style.transition = "background-color 0.2s ease";

                        // Optional: Add padding/radius if the existing layout feels too tight
                        // row.style.borderRadius = "4px";
                    }
                }
            }
        });
    }

    // Run once when the DOM is fully loaded
    window.addEventListener('load', processTicketSales);

})();
