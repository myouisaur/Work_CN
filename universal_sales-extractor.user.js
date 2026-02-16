// ==UserScript==
// @name         Universal Event Sales Extractor
// @namespace    https://github.com/myouisaur/Work_CN
// @version      3.0
// @description  Adds a "Copy Numbers" button to sites.
// @author       Xiv
// @match        https://*.eventbrite.com/*
// @match        https://*.posh.vip/*
// @match        https://*.ra.co/*
// @match        https://*.eventim.us/*
// @match        https://*.boletosexpress.com/*
// @match        https://*.tickeri.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Work_CN/universal_sales-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/universal_sales-extractor.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // 1. HELPERS & CONFIG
    // ============================================================================

    // Helper to clean strings for logic checks (removes currency symbols, commas)
    const parseNum = (str) => {
        if (!str) return 0;
        return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
    };

    const siteModules = [
        {
            name: 'Eventbrite',
            domain: 'eventbrite.com',
            check: () => !!document.querySelector('[data-testid="amount-card-title"]'),
            extract: () => {
                let ticketsSold = '', netSales = '';
                const titles = document.querySelectorAll('[data-testid="amount-card-title"]');
                titles.forEach(titleElem => {
                    const titleText = titleElem.innerText.trim();
                    const card = titleElem.closest('div[class*="AmountCard"]')?.parentElement || titleElem.parentElement.parentElement;
                    if (titleText === "Tickets Sold") {
                        const valueElem = card.querySelector('[data-testid="amount-card-value"] p') || card.querySelector('[data-testid="amount-card-value"]') || card.querySelector('span');
                        ticketsSold = valueElem ? valueElem.innerText.trim() : '';
                    }
                    if (titleText === "Net Sales") {
                        const valueElem = card.querySelector('[data-testid="amount-card-value"] p') || card.querySelector('[data-testid="amount-card-value"]') || card.querySelector('span');
                        netSales = valueElem ? valueElem.innerText.trim() : '';
                    }
                });
                if (!netSales) netSales = '$0';
                if (!ticketsSold && !netSales) throw new Error("Dashboard empty.");
                return { tickets: ticketsSold, revenue: netSales };
            }
        },
        {
            name: 'Posh.vip',
            domain: 'posh.vip',
            check: () => !!document.querySelector('div.CrossSection__w3a2U'),
            extract: () => {
                let ticketsSold = '', totalRevenue = '';
                const divs = document.querySelectorAll('div.CrossSection__w3a2U');
                divs.forEach(div => {
                    const label = div.querySelector('p')?.innerText.trim();
                    if (label === "Total Tickets Sold" || label === "Total RSVPs") ticketsSold = div.querySelector('h3')?.innerText.trim();
                    if (label === "Total Revenue" || label === "Revenue") totalRevenue = div.querySelector('h3')?.innerText.trim();
                });
                if (ticketsSold && !totalRevenue) totalRevenue = '0';
                if (!ticketsSold && !totalRevenue) throw new Error("Data missing.");
                return { tickets: ticketsSold, revenue: totalRevenue };
            }
        },
        {
            name: 'Resident Advisor',
            domain: 'ra.co',
            check: () => !!document.querySelector('span[color="primary"]'),
            extract: () => {
                let tickets = '', revenue = '';
                const valueSpans = document.querySelectorAll('span[color="primary"]');
                valueSpans.forEach(span => {
                    const text = span.innerText.trim();
                    const sibling = span.nextElementSibling;
                    if (sibling && sibling.innerText.includes('/')) {
                        if (text.includes('$') || text.includes('£') || text.includes('€')) revenue = text;
                        else tickets = text;
                    }
                });
                if (!tickets && !revenue) throw new Error("Data missing.");
                return { tickets: tickets || '0', revenue: revenue || '$0' };
            }
        },
        {
            name: 'Seetickets / Eventim',
            domain: 'eventim.us',
            check: () => !!document.querySelector('#table table'),
            extract: () => {
                const table = document.querySelector('#table table');
                const dataRow = table.querySelectorAll('tr')[1];
                if (!dataRow) throw new Error("Row missing.");
                const cells = dataRow.querySelectorAll('td');
                const tickets = cells[0]?.innerText.trim();
                const revenue = cells[cells.length - 1]?.innerText.trim();
                return { tickets: tickets || '0', revenue: revenue || '$0' };
            }
        },
        {
            name: 'Boletos Express',
            domain: 'boletosexpress.com',
            check: () => !!document.querySelector('#audit'),
            extract: () => {
                let tickets = '';
                const auditSection = document.getElementById('audit');
                const dls = auditSection.querySelectorAll('dl');
                dls.forEach(dl => {
                    if (dl.querySelector('dt')?.innerText.includes('Tickets Distributed')) {
                        tickets = dl.querySelector('dd b')?.innerText.trim();
                    }
                });
                const revElem = document.querySelector('#revenue_total b');
                return { tickets: tickets || '0', revenue: revElem ? revElem.innerText.trim() : '$0.00' };
            }
        },
        {
            name: 'Tickeri',
            domain: 'tickeri.com',
            check: () => document.body.innerText.includes('Ticket Inventory'),
            extract: () => {
                let tickets = '0', revenue = '$0.00';
                const spans = Array.from(document.querySelectorAll('span'));
                const ticketLabel = spans.find(s => s.innerText.includes('Ticket Inventory'));
                if (ticketLabel?.nextElementSibling) tickets = ticketLabel.nextElementSibling.innerText.trim().split('/')[0].trim();
                const revenueLabel = spans.find(s => s.innerText.includes('Total revenue'));
                if (revenueLabel?.nextElementSibling) revenue = revenueLabel.nextElementSibling.innerText.trim();
                return { tickets, revenue };
            }
        }
    ];

    // ============================================================================
    // 2. STYLES (Revamped for better aesthetics)
    // ============================================================================
    const STYLES = `
        /* --- Main Button --- */
        #ues-copy-btn {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-150px);
            z-index: 2147483647;
            background: #334155; /* Slate 700 */
            color: #f8fafc;
            border: 1px solid #475569;
            padding: 8px 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-weight: 600;
            font-size: 14px;
            border-radius: 8px; /* Slightly less rounded */
            cursor: pointer;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            transition: all 0.3s ease;
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
            background: #1e293b; /* Slate 800 */
            border-color: #334155;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }
        #ues-copy-btn:active { transform: translateX(-50%) translateY(1px); }

        /* --- Status Badge (Pill) --- */
        #ues-status-badge {
            position: fixed;
            top: 65px; /* Directly below button */
            left: 50%;
            transform: translateX(-50%) scale(0.9);
            z-index: 2147483646;
            padding: 4px 12px;
            font-family: sans-serif;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-radius: 20px;
            color: #fff;
            opacity: 0;
            transition: all 0.3s ease;
            pointer-events: none;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        #ues-status-badge.visible {
            opacity: 1;
            transform: translateX(-50%) scale(1);
        }
        /* Stoplight Colors */
        .ues-badge-red { background-color: #ef4444; border: 1px solid #b91c1c; }   /* No Sales */
        .ues-badge-yellow { background-color: #f59e0b; border: 1px solid #b45309; color: #fff !important; } /* Free Tickets */
        .ues-badge-green { background-color: #10b981; border: 1px solid #047857; } /* With Sales */

        /* --- Toast Notification --- */
        #ues-toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: rgba(30, 41, 59, 0.95); /* Dark transparent */
            backdrop-filter: blur(4px);
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            font-family: sans-serif;
            font-size: 13px;
            z-index: 2147483647;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s ease;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        #ues-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        #ues-toast.error { border-left: 4px solid #ef4444; }
        #ues-toast.success { border-left: 4px solid #10b981; }
    `;

    GM_addStyle(STYLES);

    // ============================================================================
    // 3. CORE LOGIC
    // ============================================================================

    let activeModule = null;
    let button = null;
    let badge = null;
    let toast = null;
    let pollInterval = null;
    let hasFetchedData = false; // "Lock" to prevent RAM waste

    function init() {
        createUI();

        // Navigation Hooks
        const originalPush = history.pushState;
        history.pushState = function() { originalPush.apply(history, arguments); resetAndScan(); };
        const originalReplace = history.replaceState;
        history.replaceState = function() { originalReplace.apply(history, arguments); resetAndScan(); };
        window.addEventListener('popstate', resetAndScan);

        // Smart Polling
        startPolling();
        document.addEventListener('visibilitychange', () => {
            document.hidden ? stopPolling() : startPolling();
        });

        // Initial Check
        resetAndScan();
    }

    function createUI() {
        // Button
        if (!document.getElementById('ues-copy-btn')) {
            button = document.createElement('button');
            button.id = 'ues-copy-btn';
            button.innerHTML = `
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                Copy Numbers
            `;
            button.addEventListener('click', handleCopy);
            document.body.appendChild(button);
        }

        // Status Badge
        if (!document.getElementById('ues-status-badge')) {
            badge = document.createElement('div');
            badge.id = 'ues-status-badge';
            document.body.appendChild(badge);
        }

        // Toast
        if (!document.getElementById('ues-toast')) {
            toast = document.createElement('div');
            toast.id = 'ues-toast';
            document.body.appendChild(toast);
        }
    }

    // Reset when URL changes
    function resetAndScan() {
        activeModule = null;
        hasFetchedData = false;
        if(badge) badge.className = ''; // Hide badge
        scanPage();
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(scanPage, 2500); // Low frequency
    }

    function stopPolling() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
    }

    function scanPage() {
        const currentUrl = window.location.href;

        // 1. Find Module
        let foundModule = null;
        for (const mod of siteModules) {
            if (currentUrl.includes(mod.domain) && mod.check()) {
                foundModule = mod;
                break;
            }
        }

        // 2. Toggle Button
        activeModule = foundModule;
        if (button) {
            if (activeModule) button.classList.add('visible');
            else button.classList.remove('visible');
        }

        // 3. Update Badge (Only if we haven't successfully fetched yet)
        if (activeModule && !hasFetchedData) {
            try {
                const data = activeModule.extract();
                if (data.tickets || data.revenue) {
                    updateBadge(data.tickets, data.revenue);
                    hasFetchedData = true; // Stop processing extraction until URL changes
                }
            } catch (e) {
                // Ignore extraction errors during polling (DOM might not be ready)
            }
        }
    }

    function updateBadge(tickets, revenue) {
        if (!badge) return;

        const tVal = parseNum(tickets);
        const rVal = parseNum(revenue);

        let text = '';
        let colorClass = '';

        if (tVal === 0 && rVal === 0) {
            text = "No Sales";
            colorClass = "ues-badge-red";
        } else if (tVal > 0 && rVal === 0) {
            text = "Free Tickets";
            colorClass = "ues-badge-yellow";
        } else if (tVal > 0 && rVal > 0) {
            text = "With Sales";
            colorClass = "ues-badge-green";
        } else {
            // Edge case: Revenue but no tickets? Treat as green
            text = "With Sales";
            colorClass = "ues-badge-green";
        }

        badge.textContent = text;
        badge.className = `visible ${colorClass}`;
    }

    async function handleCopy() {
        if (!activeModule) return;

        try {
            const data = activeModule.extract();
            const url = window.location.href;

            // --- 4th Column Logic ---
            let fourthCol = '';
            const tVal = parseNum(data.tickets);
            const rVal = parseNum(data.revenue);

            if (tVal === 0 && rVal === 0) {
                fourthCol = '0';
            } else if (tVal > 0 && rVal === 0) {
                fourthCol = data.tickets; // Repeat ticket count
            } else if (tVal > 0 && rVal > 0) {
                fourthCol = 'check free tix';
            } else {
                fourthCol = '0'; // Default fallback
            }

            const finalString = `${url}\t${data.tickets}\t${data.revenue}\t${fourthCol}`;

            await navigator.clipboard.writeText(finalString);

            showToast(`Copied! ${data.tickets} tickets - ${data.revenue}`, 'success');

            // Ensure badge matches what we just copied
            updateBadge(data.tickets, data.revenue);

        } catch (err) {
            console.error("Copy Error:", err);
            showToast(`Error - ${err.message || "Unknown error"}`, 'error');
        }
    }

    function showToast(message, type) {
        if (!toast) return;
        toast.textContent = message;
        toast.className = type; // 'success' or 'error'
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Run
    init();

})();
