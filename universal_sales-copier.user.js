// ==UserScript==
// @name         Universal Event Sales Copier
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.google.com/s2/favicons?sz=64&domain=eventbrite.com
// @version      1.0
// @description  Adds a modular "Copy Numbers" button to Eventbrite, Posh.vip, and etc.
// @author       Xiv
// @match        https://*.eventbrite.com/*
// @match        https://*.posh.vip/*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Work_CN/universal_sales-copier.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/universal_sales-copier.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // 1. SITE CONFIGURATION (MODULAR SECTION)
    // Add new sites here.
    // 'check': Returns true if elements exist (controls button visibility).
    // 'extract': Returns { tickets, revenue } or throws error.
    // ============================================================================
    const siteModules = [
        {
            name: 'Eventbrite',
            domain: 'eventbrite.com',
            check: () => document.querySelectorAll('.dashboard-amount-card, .AmountCard_dashboardAmountCard__EajNf').length > 0,
            extract: () => {
                let ticketsSold = '', netSales = '';
                const cards = document.querySelectorAll('.dashboard-amount-card, .AmountCard_dashboardAmountCard__EajNf');

                cards.forEach(card => {
                    const title = card.querySelector('[data-testid="amount-card-title"]')?.innerText.trim();

                    if (title === "Tickets Sold") {
                        const spanValue = card.querySelector('span')?.innerText.trim();
                        // Note: Class names with random hashes (like ___Ji3j) can change, relying on the user's provided logic
                        const ticketsCountValue = card.querySelector('.TicketsSoldAmountCard_ticketsCount___Ji3j p')?.innerText.trim();
                        ticketsSold = spanValue || ticketsCountValue || '';
                    }

                    if (title === "Net Sales") {
                        const oldValue = card.querySelector('[data-testid="amount-card-value"]')?.innerText.trim();
                        const newValue = card.querySelector('.AmountCard_amountText__kae4k[data-testid="amount-card-value"] p')?.innerText.trim();
                        netSales = oldValue || newValue || '';
                    }
                });

                if (!netSales) netSales = '$0';
                if (!ticketsSold && !netSales) throw new Error("Could not find Ticket or Sales data.");

                return { tickets: ticketsSold, revenue: netSales };
            }
        },
        {
            name: 'Posh.vip',
            domain: 'posh.vip',
            check: () => document.querySelectorAll('div.CrossSection__w3a2U').length > 0,
            extract: () => {
                let ticketsSold = '', totalRevenue = '';
                const divs = document.querySelectorAll('div.CrossSection__w3a2U');

                divs.forEach(div => {
                    const label = div.querySelector('p')?.innerText.trim();
                    if (label === "Total Tickets Sold" || label === "Total RSVPs") {
                        ticketsSold = div.querySelector('h3')?.innerText.trim();
                    }
                    if (label === "Total Revenue" || label === "Revenue") {
                        totalRevenue = div.querySelector('h3')?.innerText.trim();
                    }
                });

                if (ticketsSold && !totalRevenue) totalRevenue = '0';
                if (!ticketsSold && !totalRevenue) throw new Error("Could not find CrossSection data.");

                return { tickets: ticketsSold, revenue: totalRevenue };
            }
        }
    ];

    // ============================================================================
    // 2. STYLES & UI
    // ============================================================================
    const STYLES = `
        #ues-copy-btn {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-100px); /* Start hidden */
            z-index: 99999;
            background: #2563eb;
            color: white;
            border: none;
            padding: 10px 24px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-weight: 600;
            font-size: 14px;
            border-radius: 50px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(37, 99, 235, 0.3);
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            opacity: 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        #ues-copy-btn.visible {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }

        #ues-copy-btn:hover {
            background: #1d4ed8;
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4);
            transform: translateX(-50%) translateY(-2px);
        }

        #ues-copy-btn:active {
            transform: translateX(-50%) translateY(1px);
        }

        /* Notification Toast */
        #ues-toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: #1f2937;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            z-index: 99999;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s ease;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 200px;
            justify-content: center;
        }

        #ues-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        #ues-toast.error {
            background: #ef4444;
        }
        #ues-toast.success {
            background: #10b981;
        }
    `;

    GM_addStyle(STYLES);

    // ============================================================================
    // 3. CORE LOGIC
    // ============================================================================

    let activeModule = null;
    let button = null;
    let toast = null;

    function init() {
        // Create UI Elements
        createButton();
        createToast();

        // Start Scanner to detect if we are on a supported page/state
        setInterval(scanPage, 2000);
        scanPage(); // Run immediately
    }

    function scanPage() {
        const currentUrl = window.location.href;
        let foundModule = null;

        // Find which module applies to this domain
        for (const mod of siteModules) {
            if (currentUrl.includes(mod.domain)) {
                // Check if the specific elements exist right now
                if (mod.check()) {
                    foundModule = mod;
                }
                break;
            }
        }

        activeModule = foundModule;
        toggleButton(!!activeModule);
    }

    function createButton() {
        if (document.getElementById('ues-copy-btn')) return;

        button = document.createElement('button');
        button.id = 'ues-copy-btn';
        button.innerHTML = `
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
            Copy Numbers
        `;
        button.addEventListener('click', handleCopy);
        document.body.appendChild(button);
    }

    function createToast() {
        if (document.getElementById('ues-toast')) return;

        toast = document.createElement('div');
        toast.id = 'ues-toast';
        document.body.appendChild(toast);
    }

    function toggleButton(show) {
        if (!button) return;
        if (show) {
            button.classList.add('visible');
        } else {
            button.classList.remove('visible');
        }
    }

    function showToast(message, type = 'success') {
        if (!toast) return;

        toast.textContent = message;
        toast.className = ''; // reset
        toast.classList.add('show', type);

        // Hide after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    async function handleCopy() {
        if (!activeModule) return;

        try {
            // 1. Extract Data
            const data = activeModule.extract();
            const url = window.location.href;

            // 2. Format: URL [tab] Tickets [tab] Revenue
            const finalString = `${url}\t${data.tickets}\t${data.revenue}`;

            // 3. Copy to Clipboard
            await navigator.clipboard.writeText(finalString);

            // 4. Notify Success
            showToast(`Copied: ${data.tickets} / ${data.revenue}`, 'success');

        } catch (err) {
            console.error('Extraction Error:', err);
            // 5. Notify Error
            showToast(`Error: ${err.message || 'Unknown error'}`, 'error');
        }
    }

    // Run the script
    init();

})();
