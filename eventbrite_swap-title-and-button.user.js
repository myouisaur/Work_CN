// ==UserScript==
// @name         [Eventbrite] Swap Title and Date Button
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.eventbrite.com/favicon.ico
// @version      4.1
// @description  Safely moves the date selector button above the event title on Eventbrite event cards.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        GM_addStyle
// @run-at       document-end
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_swap-title-and-button.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_swap-title-and-button.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Prevent duplicate execution on SPA framework hydration cycles
    if (window.__uesAlreadyRunning) return;
    window.__uesAlreadyRunning = true;

    // ============================================================================
    // CONFIGURATION & CONSTANTS
    // ============================================================================
    const CONFIG = {
        DEBUG: false,
        INITIAL_PHASE_MS: 4000,
        SELECTORS: {
            CARD: 'div[data-spec="event-description__event-card"]',
            TITLE: 'h3',
            BTN_TESTID: 'button[data-testid="child-recurring-event-dropdown-button"]',
            BTN_CLASS: 'button[class*="dateSelector" i]'
        }
    };

    // ============================================================================
    // UTILITIES & LOGGING
    // ============================================================================
    const Logger = {
        prefix: '[Eventbrite Swap]',
        warn: (msg, err) => console.warn(`${Logger.prefix} [WARN] ${msg}`, err || ''),
        error: (msg, err) => console.error(`${Logger.prefix} [ERROR] ${msg}`, err || ''),
        debug: (msg) => { if (CONFIG.DEBUG) console.log(`${Logger.prefix} [DEBUG] ${msg}`); }
    };

    const Styles = {
        inject() {
            const css = `
                .ues-date-btn-swapped {
                    margin-bottom: 0.75rem !important;
                    display: inline-flex !important;
                    order: 1;
                    animation: uesFadeIn 0.15s ease-out;
                }
                .ues-title-swapped {
                    margin-top: 0 !important;
                    order: 2;
                }
                @keyframes uesFadeIn {
                    from { opacity: 0; transform: translateY(-1px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `;
            GM_addStyle(css);
            Logger.debug('Namespaced layout styles injected successfully.');
        }
    };

    // ============================================================================
    // DOM MANIPULATION & PROCESSING
    // ============================================================================
    const DOMManager = {
        /**
         * Validates whether a target element is a legitimate Eventbrite date selection button
         * uses dynamic layout heuristics, attributes, and text indicators.
         */
        isDateButton(btn) {
            if (!btn || btn.tagName !== 'BUTTON') return false;

            // Strict Eventbrite tracking data descriptor
            if (btn.getAttribute('data-testid') === 'child-recurring-event-dropdown-button') return true;

            // Generic dynamic CSS fallback
            const className = typeof btn.className === 'string' ? btn.className.toLowerCase() : '';
            if (className.includes('dateselector')) return true;

            // Internationalization-safe layout verification: checks structure for contextual icons & interactive state
            const hasIcon = btn.querySelector('svg, i, .eds-icon') !== null;
            const hasText = (btn.textContent || '').trim().length > 0;
            const isDropdown = btn.getAttribute('aria-haspopup') === 'true' || className.includes('dropdown');

            return hasText && (hasIcon || isDropdown);
        },

        /**
         * Processes specific card components to swap structural layouts safely.
         * Runs inside scheduled animation frames to prevent layout thrashing.
         */
        processCard(card) {
            // Guard clause to ensure we don't redundant-process already modified elements
            if (card.getAttribute('data-ues-swapped') === 'true') return;

            try {
                const title = card.querySelector(CONFIG.SELECTORS.TITLE);
                if (!title) return; // Silent return; wait for framework layout hydration pass

                // Locate the target button component via structural fallback hierarchies
                const dateButton = card.querySelector(CONFIG.SELECTORS.BTN_CLASS) ||
                                   card.querySelector(CONFIG.SELECTORS.BTN_TESTID) ||
                                   Array.from(card.querySelectorAll('button')).find(btn => this.isDateButton(btn));

                if (this.isDateButton(dateButton)) {
                    // Execute physical DOM element reordering
                    card.insertBefore(dateButton, title);

                    // Append target presentation classes
                    dateButton.classList.add('ues-date-btn-swapped');
                    title.classList.add('ues-title-swapped');

                    card.setAttribute('data-ues-swapped', 'true');
                    Logger.debug('Successfully adjusted card element order hierarchy.');
                }
            } catch (err) {
                Logger.warn('Graceful layout separation failure on card instance:', err.message);
                card.setAttribute('data-ues-swapped', 'error');
            }
        },

        /**
         * Scans explicit DOM sub-trees to target precise layout fragments
         */
        scanContainer(root = document) {
            const cards = root.querySelectorAll(CONFIG.SELECTORS.CARD);
            if (cards.length === 0) return;

            requestAnimationFrame(() => {
                cards.forEach(card => this.processCard(card));
            });
        }
    };

    // ============================================================================
    // PERFORMANCE OBSERVER MANAGEMENT
    // ============================================================================
    const ObserverManager = {
        observer: null,

        start() {
            if (this.observer) return;

            const rootContainer = document.querySelector('main') || document.body;

            this.observer = new MutationObserver((mutations) => {
                const pendingCards = new Set();

                for (let i = 0; i < mutations.length; i++) {
                    const addedNodes = mutations[i].addedNodes;
                    for (let j = 0; j < addedNodes.length; j++) {
                        const node = addedNodes[j];
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;

                        // Case 1: The card container itself was added directly
                        if (node.matches(CONFIG.SELECTORS.CARD)) {
                            pendingCards.add(node);
                        }

                        // Case 2: Multi-card layout subtrees injected simultaneously
                        const nested = node.querySelectorAll(CONFIG.SELECTORS.CARD);
                        for (let k = 0; k < nested.length; k++) {
                            pendingCards.add(nested[k]);
                        }

                        // Case 3: Element hydration (button/title) occurring inside an existing card frame
                        const parentCard = node.closest(CONFIG.SELECTORS.CARD);
                        if (parentCard) {
                            pendingCards.add(parentCard);
                        }
                    }
                }

                if (pendingCards.size > 0) {
                    requestAnimationFrame(() => {
                        pendingCards.forEach(card => DOMManager.processCard(card));
                    });
                }
            });

            this.observer.observe(rootContainer, { childList: true, subtree: true });
            Logger.debug(`Observer lifecycle linked to <${rootContainer.tagName.toLowerCase()}> container layout.`);
        },

        stop() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
                Logger.debug('Observer disconnected safely.');
            }
        }
    };

    // ============================================================================
    // APPLICATION LIFECYCLE
    // ============================================================================
    const App = {
        initialPhase: true,

        init() {
            Styles.inject();
            ObserverManager.start();

            // Handle background-tab performance throttling rules
            document.addEventListener('visibilitychange', App.handleVisibility);

            // Execute instant bootstrap layout resolution
            DOMManager.scanContainer();

            // Manage initial-load grace phase transitions
            setTimeout(() => {
                App.initialPhase = false;
                App.handleVisibility();
            }, CONFIG.INITIAL_PHASE_MS);
        },

        handleVisibility() {
            if (App.initialPhase) return;

            if (document.hidden) {
                ObserverManager.stop();
            } else {
                ObserverManager.start();
                DOMManager.scanContainer();
            }
        }
    };

    // Instantiate Application Core
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }

})();
