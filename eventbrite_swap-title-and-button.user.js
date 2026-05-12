// ==UserScript==
// @name         [Eventbrite] Swap Title and Date Button
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      3.0
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

    // Prevent duplicate execution on SPA frameworks
    if (window.__uesAlreadyRunning) return;
    window.__uesAlreadyRunning = true;

    // ============================================================================
    // CONFIGURATION & CONSTANTS
    // ============================================================================
    const CONFIG = {
        DEBUG: false, // Set to true to see verbose console logs
        DEBOUNCE_MS: 150,
        // Grace period for background tabs:
        // Allows the script to stay fully active for the first 4 seconds even if unfocused.
        INITIAL_PHASE_MS: 4000,
        SELECTORS: {
            CARD: 'div[data-spec="event-description__event-card"]:not([data-ues-swapped])',
            TITLE: 'h3',
            BTN_TESTID: 'button[data-testid="child-recurring-event-dropdown-button"]',
            BTN_CLASS: 'button[class*="dateSelector" i]'
        }
    };

    // ============================================================================
    // UTILITIES
    // ============================================================================
    const Logger = {
        prefix: '[Eventbrite Swap]',
        warn: (msg, err) => console.warn(`${Logger.prefix} [WARN] ${msg}`, err || ''),
        error: (msg, err) => console.error(`${Logger.prefix} [ERROR] ${msg}`, err || ''),
        debug: (msg) => { if (CONFIG.DEBUG) console.log(`${Logger.prefix} [DEBUG] ${msg}`); }
    };

    const Styles = {
        inject() {
            // Highly specific, namespaced classes to prevent site-wide collisions
            const css = `
                .ues-date-btn-swapped {
                    margin-bottom: 12px !important;
                    display: inline-flex !important; /* Preserves button shape globally */
                    order: 1; /* Safety net for flexbox containers */
                }
                .ues-title-swapped {
                    margin-top: 0 !important;
                    order: 2; /* Safety net for flexbox containers */
                }
            `;
            GM_addStyle(css);
            Logger.debug('Styles injected.');
        }
    };

    // ============================================================================
    // DOM MANIPULATION (Core Logic)
    // ============================================================================
    const DOMManager = {
        isDateButton(btn) {
            if (!btn || btn.tagName !== 'BUTTON') return false;

            // 1. Check strict Eventbrite data-testid
            if (btn.getAttribute('data-testid') === 'child-recurring-event-dropdown-button') return true;

            // 2. Check dynamic CSS class names safely
            if (btn.className && typeof btn.className === 'string' && btn.className.toLowerCase().includes('dateselector')) return true;

            // 3. Fallback: i18n-safe structural check
            // Removes the regex that breaks on non-English sites. Looks for an SVG icon + text.
            const hasSvg = btn.querySelector('svg') !== null;
            const textContent = (btn.textContent || '').trim();
            return hasSvg && textContent.length > 0;
        },

        scan() {
            const cards = document.querySelectorAll(CONFIG.SELECTORS.CARD);
            if (cards.length === 0) return;

            cards.forEach(card => this.processCard(card));
        },

        processCard(card) {
            try {
                const title = card.querySelector(CONFIG.SELECTORS.TITLE);
                if (!title) throw new Error("Title element not found. Waiting for render.");

                // Locate the button using cascading fallbacks
                const dateButton = card.querySelector(CONFIG.SELECTORS.BTN_CLASS) ||
                                   card.querySelector(CONFIG.SELECTORS.BTN_TESTID) ||
                                   (title.nextElementSibling?.tagName === 'BUTTON' ? title.nextElementSibling : null);

                if (this.isDateButton(dateButton)) {
                    // Physical DOM swap (Wrapped safely to prevent React crashes)
                    card.insertBefore(dateButton, title);

                    // Apply visual classes
                    dateButton.classList.add('ues-date-btn-swapped');
                    title.classList.add('ues-title-swapped');

                    // Mark as successfully processed
                    card.setAttribute('data-ues-swapped', 'true');
                    Logger.debug('Successfully swapped a card.');
                } else {
                    // Mark ignored so we don't infinitely re-process this node
                    card.setAttribute('data-ues-swapped', 'ignored');
                }
            } catch (err) {
                Logger.warn('Failed to process a card layout:', err.message);
                card.setAttribute('data-ues-swapped', 'error');
            }
        }
    };

    // ============================================================================
    // OBSERVER & PERFORMANCE MANAGEMENT
    // ============================================================================
    const ObserverManager = {
        observer: null,
        scanTimer: null,

        start() {
            if (this.observer) return;

            // Optimization: Try to observe the main content area rather than the whole body
            const rootContainer = document.querySelector('main') || document.body;

            this.observer = new MutationObserver((mutations) => {
                const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
                if (hasNewNodes) this.triggerScan();
            });

            this.observer.observe(rootContainer, { childList: true, subtree: true });
            Logger.debug(`Observer started on <${rootContainer.tagName.toLowerCase()}>.`);
        },

        stop() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
                Logger.debug('Observer stopped (Tab inactive).');
            }
            clearTimeout(this.scanTimer);
        },

        triggerScan() {
            clearTimeout(this.scanTimer);
            this.scanTimer = setTimeout(() => DOMManager.scan(), CONFIG.DEBOUNCE_MS);
        }
    };

    // ============================================================================
    // APPLICATION LIFECYCLE
    // ============================================================================
    const App = {
        initialPhase: true,

        init() {
            Logger.debug('Initializing Eventbrite UX Script...');
            Styles.inject();
            ObserverManager.start();

            // SPA Routing Interception
            const originalPush = history.pushState;
            history.pushState = function() { originalPush.apply(history, arguments); App.handleRouting(); };
            const originalReplace = history.replaceState;
            history.replaceState = function() { originalReplace.apply(history, arguments); App.handleRouting(); };
            window.addEventListener('popstate', App.handleRouting);

            // Tab Visibility Interception
            document.addEventListener('visibilitychange', App.handleVisibility);

            // Trigger an immediate scan just in case elements exist
            DOMManager.scan();

            // Background Tab Fix: Keep observer running regardless of visibility
            // for the first few seconds to ensure the initial load completes.
            setTimeout(() => {
                Logger.debug('Initial load phase complete. Visibility rules engaged.');
                App.initialPhase = false;

                // If the user happens to be on another tab when the timer expires, pause now.
                App.handleVisibility();
            }, CONFIG.INITIAL_PHASE_MS);
        },

        handleRouting() {
            Logger.debug('SPA Navigation detected.');
            // Give the router a split second to destroy the old DOM before scanning
            setTimeout(() => DOMManager.scan(), 50);
        },

        handleVisibility() {
            // Ignore visibility throttling during the crucial initial load phase
            if (App.initialPhase) return;

            if (document.hidden) {
                ObserverManager.stop();
            } else {
                ObserverManager.start();
                DOMManager.scan(); // Catch anything missed while asleep
            }
        }
    };

    // Boot
    App.init();

})();
