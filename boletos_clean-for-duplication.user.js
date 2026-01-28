// ==UserScript==
// @name         [Boletos] Clean for Duplication
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.boletosexpress.com/favicon.ico
// @version      1.2
// @description  Adds a high-visibility "Clean for duplication" button to the quicklinks bar.
// @author       Xiv
// @match        *://*.boletosexpress.com/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/boletos_clean-for-duplication.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/boletos_clean-for-duplication.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_ID = 'bx-clean-dupe-btn';

    function executeCleanLogic() {
        // 1. Remove " (Copy)" from Name
        const input = document.querySelector('input[name="name"]');
        if (input) {
            input.value = input.value.replace(/\s*\(Copy\)$/, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 2. Set Status to "1"
        const select = document.querySelector('select[name="status"]');
        if (select) {
            select.value = "1";
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 3. Truncate Presenter
        const presenter = document.querySelector('input[name="presenter"]');
        if (presenter) {
            presenter.value = presenter.value.slice(0, 60);
            presenter.dispatchEvent(new Event('input', { bubbles: true }));
            presenter.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function injectButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const quicklinks = document.getElementById('quicklinks');
        if (quicklinks) {
            const cleanLink = document.createElement('a');
            cleanLink.id = BUTTON_ID;
            cleanLink.href = "javascript:void(0);";
            cleanLink.style.cursor = "pointer";
            cleanLink.style.fontWeight = "bold"; // Make text bold to stand out

            // Icon: Bright Pink/Red background + Broom emoji
            cleanLink.innerHTML = `
                <span class="icons" style="background-color: #e91e63; color: white; display: inline-flex; align-items: center; justify-content: center;">
                    🧹
                </span>
                <span style="color: #e91e63;">Clean for duplication</span>
            `;

            cleanLink.addEventListener('click', (e) => {
                e.preventDefault();
                executeCleanLogic();

                // Temporary visual feedback
                const icon = cleanLink.querySelector('.icons');
                const originalColor = icon.style.backgroundColor;
                icon.style.backgroundColor = "#4caf50"; // Turn green on success
                setTimeout(() => { icon.style.backgroundColor = originalColor; }, 1000);
            });

            // Prepend to nav
            quicklinks.prepend(cleanLink);
            quicklinks.insertBefore(document.createTextNode(' '), quicklinks.childNodes[1]);
        }
    }

    injectButton();

    const observer = new MutationObserver(() => {
        if (document.getElementById('quicklinks') && !document.getElementById(BUTTON_ID)) {
            injectButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
