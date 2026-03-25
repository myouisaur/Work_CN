// ==UserScript==
// @name         [RA] Ticket Sales Highlighter
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon-32x32.png
// @version      2.0
// @description  Highlights rows with ticket sales with a futuristic gradient notification.
// @author       Xiv
// @match        *://*.ra.co/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/RA_ticket-sales-highlighter.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA_ticket-sales-highlighter.user.js
// ==/UserScript==

(function() {
    'use strict';

    // CONFIGURATION
    const ROW_COLOR = "#90e0b4"; // Mint Green highlight
    const ROW_SELECTOR = "li.myEvents:not(.ra-processed)";

    let debounceTimer = null;
    let notificationTimer = null;

    /**
     * Creates and shows a futuristic, gradient-styled notification.
     */
    function showNotification(message) {
        let notif = document.getElementById('ra-highlighter-notif');
        if (!notif) {
            notif = document.createElement('div');
            notif.id = 'ra-highlighter-notif';

            // Futuristic Styling: Matches the RA header gradient
            Object.assign(notif.style, {
                position: 'fixed',
                top: '24px',
                left: '50%',
                transform: 'translateX(-50%) translateY(-20px) scale(0.9)',
                // Pink/Red to Deep Blue/Purple gradient matching the top bar
                background: 'linear-gradient(90deg, #f21f5b 0%, #2b00ff 100%)',
                color: '#FFFFFF',
                padding: '12px 28px',
                borderRadius: '50px',
                border: 'none',
                fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                fontSize: '15px',
                fontWeight: '500',
                letterSpacing: '0.5px', // Slightly spaced out for a sleek look
                zIndex: '2147483647',
                opacity: '0',
                transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                pointerEvents: 'none',
                // A soft, glowing purple/blue shadow to match the gradient
                boxShadow: '0 8px 20px rgba(43, 0, 255, 0.3)'
            });

            document.body.appendChild(notif);
        }

        // Clean UI text (just the active sales count)
        notif.innerHTML = message;

        // Force reflow
        void notif.offsetWidth;

        // Active state
        notif.style.transform = 'translateX(-50%) translateY(0) scale(1)';
        notif.style.opacity = '1';

        if (notificationTimer) clearTimeout(notificationTimer);

        notificationTimer = setTimeout(() => {
            // Outro state
            notif.style.transform = 'translateX(-50%) translateY(-15px) scale(0.95)';
            notif.style.opacity = '0';
        }, 3000);
    }

    /**
     * Main function to scan and highlight.
     */
    function processTicketSales() {
        const eventRows = document.querySelectorAll(ROW_SELECTOR);

        if (eventRows.length === 0) return;

        let newlyHighlightedCount = 0;

        eventRows.forEach(row => {
            row.classList.add('ra-processed');

            const statsLink = row.querySelector('.stats a') || row.querySelector('.stats');

            if (statsLink && statsLink.textContent) {
                const text = statsLink.textContent.trim();
                const match = text.match(/(\d+)\s*tickets?\s*sold/i);

                if (match) {
                    const count = parseInt(match[1], 10);
                    if (!isNaN(count) && count > 0) {
                        row.style.backgroundColor = ROW_COLOR;
                        row.style.transition = "background-color 0.4s ease";
                        newlyHighlightedCount++;
                    }
                }
            }
        });

        // Trigger the notification
        if (newlyHighlightedCount > 0) {
            // Stripped down text, bolding the number for quick readability
            showNotification(`Found <strong>${newlyHighlightedCount}</strong> active sales`);
        }
    }

    // The Debounce Function
    function debouncedProcess() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            processTicketSales();
        }, 150);
    }

    // Run once immediately
    processTicketSales();

    // Set up the observer
    const observer = new MutationObserver(() => {
        debouncedProcess();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
