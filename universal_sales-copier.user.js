// ==UserScript==
// @name         Universal Event Sales Copier
// @namespace    https://github.com/myouisaur/Work_CN
// @version      1.3
// @description  Adds a "Copy Numbers" button to sites.
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
    // 1. SITE CONFIGURATION
    // ============================================================================
    const siteModules = [
        {
            name: 'Eventbrite',
            domain: 'eventbrite.com',
            // FIX: Uses data-testid (stable) instead of random class names
            check: () => !!document.querySelector('[data-testid="amount-card-title"]'),
            extract: () => {
                let ticketsSold = '', netSales = '';
                // Select generic card containers or search by content
                // We grab parent cards by looking up from the titles to ensure we get the right block
                const titles = document.querySelectorAll('[data-testid="amount-card-title"]');

                titles.forEach(titleElem => {
                    const titleText = titleElem.innerText.trim();
                    // Traverse up to the card container (usually 2-3 levels up, but we search siblings)
                    // Simpler strategy: Look for the value sibling associated with this title
                    const card = titleElem.closest('div[class*="AmountCard"]')?.parentElement || titleElem.parentElement.parentElement;

                    if (titleText === "Tickets Sold") {
                        // Try standard span or specific class structures
                        const valueElem = card.querySelector('[data-testid="amount-card-value"] p') ||
                                          card.querySelector('[data-testid="amount-card-value"]') ||
                                          card.querySelector('span');
                        ticketsSold = valueElem ? valueElem.innerText.trim() : '';
                    }

                    if (titleText === "Net Sales") {
                        const valueElem = card.querySelector('[data-testid="amount-card-value"] p') ||
                                          card.querySelector('[data-testid="amount-card-value"]') ||
                                          card.querySelector('span');
                        netSales = valueElem ? valueElem.innerText.trim() : '';
                    }
                });

                if (!netSales) netSales = '$0';
                if (!ticketsSold && !netSales) throw new Error("Found dashboard but values are empty. Selectors may need update.");

                return { tickets: ticketsSold, revenue: netSales };
            }
        },
        {
            name: 'Posh.vip',
            domain: 'posh.vip',
            // Keep using the class if it works, otherwise query generic headers
            check: () => !!document.querySelector('div.CrossSection__w3a2U'),
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
    // 2. STYLES (Z-Index increased to ensure visibility)
    // ============================================================================
    const STYLES = `
        #ues-copy-btn {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-100px);
            z-index: 2147483647; /* Max Z-Index */
            background: #2563eb;
            color: white;
            border: none;
            padding: 10px 24px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
            pointer-events: none;
        }
        #ues-copy-btn.visible {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
            pointer-events: auto;
        }
        #ues-copy-btn:hover {
            background: #1d4ed8;
            transform: translateX(-50%) translateY(-2px);
        }
        #ues-copy-btn:active { transform: translateX(-50%) translateY(1px); }

        #ues-toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: #1f2937;
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 14px;
            z-index: 2147483647;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s ease;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        #ues-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        #ues-toast.error { background: #ef4444; }
        #ues-toast.success { background: #10b981; }
    `;

    GM_addStyle(STYLES);

    // ============================================================================
    // 3. CORE LOGIC (Optimized for RAM)
    // ============================================================================

    let activeModule = null;
    let button = null;
    let toast = null;
    let pollInterval = null;

    function init() {
        createButton();
        createToast();

        // 1. Check immediately
        scanPage();

        // 2. Hook into URL changes (SPA Navigation) - Low Cost
        const pushState = history.pushState;
        history.pushState = function() {
            pushState.apply(history, arguments);
            scanPage();
        };
        const replaceState = history.replaceState;
        history.replaceState = function() {
            replaceState.apply(history, arguments);
            scanPage();
        };
        window.addEventListener('popstate', scanPage);

        // 3. Start "Smart Polling"
        startPolling();

        // 4. Stop polling when tab is hidden to save RAM
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopPolling();
            } else {
                startPolling();
                scanPage(); // Check once immediately on wake
            }
        });
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        // Check every 3 seconds (Very slow = Low CPU/RAM)
        pollInterval = setInterval(scanPage, 3000);
    }

    function stopPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
    }

    function scanPage() {
        // Optimization: Don't scan if we are not on a supported domain pattern
        // (The @match header handles this mostly, but good for safety)

        const currentUrl = window.location.href;
        let foundModule = null;

        for (const mod of siteModules) {
            if (currentUrl.includes(mod.domain)) {
                // LIGHTWEIGHT CHECK: querySelector stops at the first match.
                // It does not create a large NodeList like querySelectorAll.
                if (mod.check()) {
                    foundModule = mod;
                }
                break;
            }
        }

        if (activeModule !== foundModule) {
            activeModule = foundModule;
            toggleButton(!!activeModule);
        }
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
        toast.className = '';
        toast.classList.add('show', type);
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    async function handleCopy() {
        if (!activeModule) return;
        try {
            const data = activeModule.extract();
            const url = window.location.href;
            const finalString = `${url}\t${data.tickets}\t${data.revenue}`;
            await navigator.clipboard.writeText(finalString);
            showToast(`Copied: ${data.tickets} / ${data.revenue}`, 'success');
        } catch (err) {
            console.error(err);
            showToast(`Error: ${err.message}`, 'error');
        }
    }

    init();

})();
