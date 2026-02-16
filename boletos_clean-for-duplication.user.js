// ==UserScript==
// @name         [Boletos] Clean for Duplication
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.boletosexpress.com/favicon.ico
// @version      2.0
// @description  Adds a high-visibility, modern "Clean for duplication" button to the quicklinks bar.
// @author       Xiv
// @match        *://*.boletosexpress.com/promoters/event-addedit.php?event_id=*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/boletos_clean-for-duplication.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/boletos_clean-for-duplication.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_ID = 'bx-clean-dupe-btn';

    // --- Core Logic (Functionality kept intact) ---
    function executeCleanLogic() {
        // 1. Remove " (Copy)" from Name
        const input = document.querySelector('input[name="name"]');
        if (input) {
            input.value = input.value.replace(/\s*\(Copy\)$/, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 2. Set Status to "1" (Active)
        const select = document.querySelector('select[name="status"]');
        if (select) {
            select.value = "1";
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 3. Truncate Presenter to 60 chars
        const presenter = document.querySelector('input[name="presenter"]');
        if (presenter) {
            presenter.value = presenter.value.slice(0, 60);
            presenter.dispatchEvent(new Event('input', { bubbles: true }));
            presenter.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // --- UI/UX & Styles ---
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Container styling to align nicely in nav */
            #${BUTTON_ID} {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background-color: #e91e63; /* High visibility Pink */
                color: white !important;
                padding: 6px 16px;
                border-radius: 20px; /* Modern Pill shape */
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-weight: 600;
                font-size: 13px;
                text-decoration: none;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 4px rgba(233, 30, 99, 0.3);
                border: 1px solid transparent;
                cursor: pointer;
                margin-right: 15px; /* Separation from other links */
                vertical-align: middle;
            }

            /* Hover State */
            #${BUTTON_ID}:hover {
                background-color: #c2185b;
                transform: translateY(-1px);
                box-shadow: 0 4px 8px rgba(233, 30, 99, 0.4);
                text-decoration: none;
            }

            /* Active/Click State */
            #${BUTTON_ID}:active {
                transform: translateY(1px);
                box-shadow: 0 1px 2px rgba(233, 30, 99, 0.3);
            }

            /* Success State (Green) */
            #${BUTTON_ID}.success-state {
                background-color: #10b981; /* Emerald Green */
                box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
                pointer-events: none; /* Prevent double clicks */
            }

            /* Icon Styling */
            #${BUTTON_ID} svg {
                width: 16px;
                height: 16px;
                fill: currentColor;
                transition: transform 0.3s ease;
            }

            /* Icon animation on hover */
            #${BUTTON_ID}:hover svg {
                transform: rotate(-10deg);
            }
        `;
        document.head.appendChild(style);
    }

    function getIcons() {
        // SVG paths
        return {
            broom: `<svg viewBox="0 0 24 24"><path d="M19.31 18.9c.56-.99.04-2.28-1.04-2.58l-8.12-2.25c-1.3-.36-2.61.43-2.9 1.73l-2.25 8.12c-.36 1.3.43 2.61 1.73 2.9.99.27 1.99-.21 2.34-1.09l.48-1.74 3.96 1.1 1.74.48c.88.24 1.81-.35 2.06-1.24l.11-.39 1.54.43c.27.07.54.02.77-.11.22-.14.37-.36.42-.62.09-.39-.14-.79-.53-.9l-1.54-.43 1.23-2.81zm-8.8 3.51l1.74-.48-3.96-1.1-.48 1.74c-.12.43-.57.69-.99.57-.43-.12-.69-.57-.57-.99l2.25-8.12c.12-.43.57-.69.99-.57l8.12 2.25c.43.12.69.57.57.99l-1.12 4.07-5.06-1.4 1.5-3.41c.21-.49-.02-1.07-.51-1.28-.49-.21-1.07.02-1.28.51l-1.78 4.04c-.1.21-.08.45.04.65.12.2.33.32.56.32l.18-.01zm7.84-9.33c-.2-.05-.4-.01-.58.1l-1.9 1.15c-.46.28-.61.88-.33 1.34s.88.61 1.34.33l1.9-1.15c.18-.11.29-.29.33-.48.04-.2.22-.32.42-.27.24.06.39.31.33.55-.07.28-.24.53-.51.7l-1.9 1.15c-.77.46-1.01 1.46-.55 2.23.46.77 1.46 1.01 2.23.55l1.9-1.15c.29-.18.6-.14.81.1.22.25.17.65-.11.82l-1.9 1.15c-.28.17-.37.53-.2.81.17.28.53.37.81.2l1.9-1.15c.78-.47 1.02-1.47.55-2.24-.26-.44-.68-.72-1.14-.81.21-.29.28-.67.14-1.03-.13-.34-.41-.59-.75-.68.12-.34.05-.72-.18-1.01-.23-.29-.58-.45-.94-.42z"></path></svg>`,
            check: `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`
        };
    }

    function injectButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const quicklinks = document.getElementById('quicklinks');
        if (quicklinks) {
            addStyles();
            const icons = getIcons();

            const cleanBtn = document.createElement('a');
            cleanBtn.id = BUTTON_ID;
            cleanBtn.href = "javascript:void(0);";

            // Initial Inner HTML
            cleanBtn.innerHTML = `
                ${icons.broom}
                <span>Clean for duplication</span>
            `;

            cleanBtn.addEventListener('click', (e) => {
                e.preventDefault();
                executeCleanLogic();

                // UX Feedback: Change to Success State
                cleanBtn.classList.add('success-state');
                cleanBtn.innerHTML = `
                    ${icons.check}
                    <span>Cleaned!</span>
                `;

                // Revert after 1.5 seconds
                setTimeout(() => {
                    cleanBtn.classList.remove('success-state');
                    cleanBtn.innerHTML = `
                        ${icons.broom}
                        <span>Clean for duplication</span>
                    `;
                }, 1500);
            });

            // Insert as the very first item in quicklinks for visibility
            quicklinks.prepend(cleanBtn);
        }
    }

    // --- Initialization ---
    injectButton();

    // Observer to handle dynamic page loads/re-renders
    const observer = new MutationObserver(() => {
        if (document.getElementById('quicklinks') && !document.getElementById(BUTTON_ID)) {
            injectButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
