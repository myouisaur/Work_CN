// ==UserScript==
// @name         [Eventbrite] Base Price Calculator
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      2.1
// @description  Shows the base price (price minus fees) on Eventbrite ticket listings
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_show-base-price.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_show-base-price.user.js
// ==/UserScript==

(function() {
    'use strict';

    function addBasePrices() {
        // Find all ticket price sections
        const priceElements = document.querySelectorAll('[data-testid="ticket-price"]');

        priceElements.forEach(priceElement => {
            // Skip if we've already processed this element
            if (priceElement.querySelector('.base-price-display')) {
                return;
            }

            const priceSpan = priceElement.querySelector('[data-testid="ticket-price__price"]');
            const feeSpan = priceElement.querySelector('[data-testid="ticket-price__fees"]');

            if (priceSpan && feeSpan) {
                // Extract price (remove $ and convert to number)
                const priceText = priceSpan.textContent.replace('$', '');
                const totalPrice = parseFloat(priceText);

                // Extract fee amount
                const feeText = feeSpan.textContent;
                const feeMatch = feeText.match(/\$([0-9.]+)/);

                if (feeMatch && !isNaN(totalPrice)) {
                    const feeAmount = parseFloat(feeMatch[1]);
                    const basePrice = totalPrice - feeAmount;

                    // Create base price display element
                    const basePriceElement = document.createElement('span');
                    basePriceElement.className = 'base-price-display';
                    basePriceElement.style.cssText = `
                        background: #ff8000;
                        color: white;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 11px;
                        font-weight: 500;
                        margin-left: 6px;
                        display: inline-block;
                        font-family: inherit;
                        vertical-align: middle;
                    `;
                    basePriceElement.textContent = `BASE ${basePrice.toFixed(2)}`;

                    // Insert the base price after the fee information
                    feeSpan.appendChild(basePriceElement);
                }
            }
        });
    }

    // Run immediately
    addBasePrices();

    // Run when new content is loaded (for dynamic content)
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length > 0) {
                // Small delay to ensure DOM is fully updated
                setTimeout(addBasePrices, 100);
            }
        });
    });

    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Also run on scroll/resize in case of lazy loading
    let debounceTimer;
    function debounceAddBasePrices() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(addBasePrices, 300);
    }

    window.addEventListener('scroll', debounceAddBasePrices);
    window.addEventListener('resize', debounceAddBasePrices);

})();
