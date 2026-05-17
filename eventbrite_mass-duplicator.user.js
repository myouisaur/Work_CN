// ==UserScript==
// @name         [Eventbrite] Mass Duplicator
// @namespace    https://github.com/myouisaur/UserScript-Collection
// @icon         https://www.eventbrite.com/favicon.ico
// @version      2.6
// @description  Intercepts Eventbrite's native "Copy event" dropdown item to allow rapid multi-tab duplication across all management panels and dashboards.
// @author       Xiv
// @match        *://*.eventbrite.com/manage/events/*
// @match        *://*.eventbrite.com/events/*/dashboard*
// @match        *://*.eventbrite.com/myevent*
// @noframes
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_mass-duplicator.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_mass-duplicator.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Prevent duplicate initializations on SPA layout transitions using document datasets
    if (document.documentElement.dataset.ebMassDuplicatorRunning === 'true') return;
    document.documentElement.dataset.ebMassDuplicatorRunning = 'true';

    // State Management for Configuration
    const ConfigManager = {
        get(key, defaultVal) {
            if (typeof GM_getValue !== 'undefined') return GM_getValue(key, defaultVal);
            return defaultVal;
        },
        set(key, val) {
            if (typeof GM_setValue !== 'undefined') GM_setValue(key, val);
        }
    };

    // Centralized Architecture Values
    const CONFIG = {
        DEBUG: false,
        get CHUNK_SIZE() { return ConfigManager.get('CHUNK_SIZE', 2); },
        get CHUNKING_DELAY_MS() { return ConfigManager.get('CHUNKING_DELAY_MS', 500); },
        get MAX_COPIES_LIMIT() { return ConfigManager.get('MAX_COPIES_LIMIT', 15); },
        TOAST_DURATION_MS: 4000
    };

    const Logger = {
        log(msg, data = '') {
            if (CONFIG.DEBUG) console.log(`[EBDuplicator] ${msg}`, data);
        },
        error(msg, err = '') {
            console.error(`[EBDuplicator][Error] ${msg}`, err);
        }
    };

    // Safe DOM Creation Utility
    const ElementBuilder = {
        /**
         * Safely creates DOM elements without raw innerHTML
         * @param {string} tag
         * @param {Object} attributes
         * @param  {...(string|Node)} children
         * @returns {HTMLElement}
         */
        create(tag, attributes = {}, ...children) {
            const el = document.createElement(tag);
            for (const [key, value] of Object.entries(attributes)) {
                if (key === 'className') {
                    el.className = value;
                } else if (key.startsWith('on') && typeof value === 'function') {
                    el.addEventListener(key.substring(2).toLowerCase(), value);
                } else if (key === 'dataset') {
                    Object.assign(el.dataset, value);
                } else {
                    el.setAttribute(key, value);
                }
            }
            children.forEach(child => {
                if (typeof child === 'string' || typeof child === 'number') {
                    el.appendChild(document.createTextNode(String(child)));
                } else if (child instanceof Node) {
                    el.appendChild(child);
                }
            });
            return el;
        }
    };

    // Stylesheet Injection
    const Styles = {
        init() {
            const css = `
                /* Scoped Modal Styles */
                .eb-md-overlay {
                    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 999999; backdrop-filter: blur(3px);
                    opacity: 0; transition: opacity 0.2s ease;
                }
                .eb-md-overlay.eb-md-visible { opacity: 1; }

                .eb-md-modal {
                    background: #ffffff; padding: clamp(1.5rem, 4vw, 2rem);
                    border-radius: 12px; width: clamp(280px, 90vw, 420px);
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
                    transform: translateY(20px) scale(0.95);
                    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .eb-md-visible .eb-md-modal { transform: translateY(0) scale(1); }

                .eb-md-title { margin: 0 0 0.5rem 0; font-size: 1.25rem; color: #1e1e1e; font-weight: 600; }
                .eb-md-text { margin: 0 0 1.25rem 0; font-size: 0.95rem; color: #5a5a5a; line-height: 1.4; }

                .eb-md-input {
                    width: 100%; padding: 0.75rem; font-size: 1rem;
                    border: 1px solid #dcdcdc; border-radius: 6px;
                    box-sizing: border-box; margin-bottom: 1.25rem;
                    transition: border-color 0.2s ease;
                }
                .eb-md-input:focus { outline: none; border-color: #3659e3; }

                .eb-md-actions { display: flex; justify-content: flex-end; gap: 0.75rem; }
                .eb-md-btn {
                    padding: 0.6rem 1.2rem; font-size: 0.95rem; border-radius: 6px;
                    border: none; cursor: pointer; font-weight: 500;
                    transition: background 0.2s ease, opacity 0.2s ease;
                }
                .eb-md-btn-cancel { background: #f0f0f0; color: #333; }
                .eb-md-btn-cancel:hover { background: #e0e0e0; }
                .eb-md-btn-primary { background: #d1410c; color: white; }
                .eb-md-btn-primary:hover { opacity: 0.9; }

                /* Scoped Toast Styles */
                .eb-md-toast-container {
                    position: fixed; bottom: 1.5rem; right: 1.5rem;
                    display: flex; flex-direction: column; gap: 0.75rem;
                    z-index: 999999; pointer-events: none;
                }
                .eb-md-toast {
                    background: #ffffff; color: #1e1e1e; padding: 1rem 1.25rem;
                    border-radius: 8px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    font-size: 0.9rem; border-left: 4px solid #3659e3;
                    transform: translateX(120%); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    display: flex; align-items: center; gap: 0.75rem; pointer-events: auto;
                }
                .eb-md-toast.eb-md-toast-error { border-left-color: #e53935; }
                .eb-md-toast.eb-md-toast-success { border-left-color: #43a047; }
                .eb-md-toast.eb-md-toast-visible { transform: translateX(0); }

                .eb-md-toast-actions { margin-left: auto; padding-left: 1rem; }
                .eb-md-toast-btn-stop {
                    background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;
                    padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer;
                    font-size: 0.8rem; font-weight: 600; transition: all 0.2s ease;
                }
                .eb-md-toast-btn-stop:hover { background: #fecaca; color: #991b1b; }
            `;
            GM_addStyle(css);
        }
    };

    // User Interface Engine
    const UI = {
        toastContainer: null,

        /**
         * Clears all currently visible toasts (useful during SPA navigations)
         */
        clearAllToasts() {
            if (this.toastContainer) {
                while (this.toastContainer.firstChild) {
                    this.toastContainer.removeChild(this.toastContainer.firstChild);
                }
            }
        },

        /**
         * Renders an accessible, human-readable prompt avoiding thread-blocking window.prompt
         * @param {string} eventId
         * @returns {Promise<number|null>}
         */
        requestCopyCount(eventId) {
            return new Promise((resolve) => {
                const abortController = new AbortController();
                const { signal } = abortController;

                const overlay = ElementBuilder.create('div', { className: 'eb-md-overlay' });

                const title = ElementBuilder.create('h3', { className: 'eb-md-title', id: 'eb-md-title-id' }, 'Mass Duplicate Event');
                const desc = ElementBuilder.create('p', { className: 'eb-md-text' },
                    `How many copies of Event ID: ${eventId} would you like to open? `,
                    ElementBuilder.create('br'),
                    `(Safe maximum limit: ${CONFIG.MAX_COPIES_LIMIT})`
                );

                const input = ElementBuilder.create('input', {
                    className: 'eb-md-input', type: 'number',
                    min: '1', max: String(CONFIG.MAX_COPIES_LIMIT),
                    placeholder: 'Enter quantity...'
                });

                const btnCancel = ElementBuilder.create('button', { className: 'eb-md-btn eb-md-btn-cancel' }, 'Cancel');
                const btnConfirm = ElementBuilder.create('button', { className: 'eb-md-btn eb-md-btn-primary' }, 'Duplicate');
                const actions = ElementBuilder.create('div', { className: 'eb-md-actions' }, btnCancel, btnConfirm);

                const modal = ElementBuilder.create('div', {
                    className: 'eb-md-modal',
                    role: 'dialog',
                    'aria-modal': 'true',
                    'aria-labelledby': 'eb-md-title-id'
                }, title, desc, input, actions);

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                // Trigger animation and ensure focus grabs properly after the DOM paints
                requestAnimationFrame(() => {
                    overlay.classList.add('eb-md-visible');
                    setTimeout(() => input.focus(), 100);
                });

                const cleanup = () => {
                    abortController.abort(); // Strip all event listeners instantly
                    overlay.classList.remove('eb-md-visible');
                    setTimeout(() => overlay.remove(), 250); // wait for fade out
                };

                const handleConfirm = () => {
                    const val = parseInt(input.value, 10);
                    if (isNaN(val) || val <= 0) {
                        this.showToast('Please enter a valid positive number.', 'error');
                        input.focus();
                        return;
                    }
                    cleanup();
                    resolve(Math.min(val, CONFIG.MAX_COPIES_LIMIT));
                };

                btnCancel.addEventListener('click', () => { cleanup(); resolve(null); }, { signal });
                btnConfirm.addEventListener('click', handleConfirm, { signal });

                // Allow closing the modal by clicking the background overlay
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) { cleanup(); resolve(null); }
                }, { signal });

                // Keyboard interactions & Focus Trapping
                const focusableElements = [input, btnCancel, btnConfirm];
                overlay.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') handleConfirm();
                    if (e.key === 'Escape') { cleanup(); resolve(null); }
                    if (e.key === 'Tab') {
                        const first = focusableElements[0];
                        const last = focusableElements[focusableElements.length - 1];
                        if (e.shiftKey && document.activeElement === first) {
                            e.preventDefault();
                            last.focus();
                        } else if (!e.shiftKey && document.activeElement === last) {
                            e.preventDefault();
                            first.focus();
                        }
                    }
                }, { signal });
            });
        },

        /**
         * Displays a non-intrusive bottom-right toast
         * @param {string} message
         * @param {'info'|'success'|'error'} type
         * @param {Object} options Options for persistence or actions
         * @returns {function} A function to forcefully remove the toast early
         */
        showToast(message, type = 'info', options = {}) {
            if (!this.toastContainer) {
                this.toastContainer = ElementBuilder.create('div', { className: 'eb-md-toast-container' });
                document.body.appendChild(this.toastContainer);
            }

            const prefix = type === 'error' ? '⚠️ ' : type === 'success' ? '✅ ' : 'ℹ️ ';
            const content = ElementBuilder.create('span', {},
                ElementBuilder.create('strong', {}, prefix), message
            );

            const toast = ElementBuilder.create('div', { className: `eb-md-toast eb-md-toast-${type}`, role: 'alert' }, content);

            if (options.onCancel) {
                const btnStop = ElementBuilder.create('button', { className: 'eb-md-toast-btn-stop' }, 'Stop');
                btnStop.addEventListener('click', () => {
                    options.onCancel();
                    btnStop.disabled = true;
                    btnStop.textContent = 'Stopping...';
                });
                const actionContainer = ElementBuilder.create('div', { className: 'eb-md-toast-actions' }, btnStop);
                toast.appendChild(actionContainer);
            }

            this.toastContainer.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('eb-md-toast-visible'));

            const removeToast = () => {
                toast.classList.remove('eb-md-toast-visible');
                setTimeout(() => toast.remove(), 300);
            };

            // If duration is explicitly 0, it persists until programmatically closed
            if (options.duration !== 0) {
                setTimeout(removeToast, options.duration || CONFIG.TOAST_DURATION_MS);
            }

            return removeToast;
        }
    };

    // Core Business Engine
    const EventParser = {
        /**
         * Extracts the Event ID from various Eventbrite URL paradigms.
         * @returns {string|null} Event ID or null if undetected.
         */
        extractEventId() {
            const url = window.location.href;
            const manageMatch = url.match(/\/manage\/events\/(\d+)/);
            if (manageMatch && manageMatch[1]) return manageMatch[1];

            const dashboardMatch = url.match(/\/events\/(\d+)\/dashboard/);
            if (dashboardMatch && dashboardMatch[1]) return dashboardMatch[1];

            try {
                const urlObj = new URL(url);
                const eid = urlObj.searchParams.get('eid');
                if (eid && /^\d+$/.test(eid)) return eid;
            } catch (e) {
                Logger.error('Failed processing URL params object.', e);
            }
            return null;
        }
    };

    const TabEngine = {
        /**
         * Utility sleep for chunking with randomized jitter to reduce bot-like patterns
         * @param {number} baseMs
         */
        sleep(baseMs) {
            // Adds a +/- 15% random variance to the sleep time
            const jitter = Math.floor(Math.random() * (baseMs * 0.3)) - (baseMs * 0.15);
            return new Promise(resolve => setTimeout(resolve, baseMs + jitter));
        },

        /**
         * Spawns duplicate tabs across safe, non-blocking execution windows with cancellation support.
         * @param {string} eventId
         * @param {number} count
         */
        async executeDuplication(eventId, count) {
            if (typeof GM_openInTab === 'undefined') {
                UI.showToast('Permissions Error: Your userscript manager does not support GM_openInTab.', 'error');
                return;
            }

            const totalTabs = Math.min(count, CONFIG.MAX_COPIES_LIMIT);
            const targetUrl = `https://www.eventbrite.com/myevent/${eventId}/copy/`;

            let openedCount = 0;
            let isCancelled = false;

            const handleCancel = () => { isCancelled = true; };

            // Persistent toast while job is running
            const dismissMainToast = UI.showToast(
                `Duplicating ${totalTabs} events...`,
                'info',
                { duration: 0, onCancel: handleCancel }
            );

            while (openedCount < totalTabs) {
                if (isCancelled) {
                    dismissMainToast();
                    UI.showToast(`Job aborted. Spawned ${openedCount} / ${totalTabs} copies.`, 'error');
                    return;
                }

                const currentBatchSize = Math.min(CONFIG.CHUNK_SIZE, totalTabs - openedCount);

                for (let i = 0; i < currentBatchSize; i++) {
                    Logger.log(`Spawning tab: ${targetUrl}`);
                    GM_openInTab(targetUrl, { active: false, insert: true, setParent: true });
                    openedCount++;
                }

                if (openedCount < totalTabs) {
                    await this.sleep(CONFIG.CHUNKING_DELAY_MS);
                }
            }

            dismissMainToast();
            UI.showToast(`Successfully spawned all ${totalTabs} event copies.`, 'success');
        }
    };

    // Event Interception & Interaction Management Module
    const ActionHandler = {
        /**
         * Handles intercepting the dropdown click event natively and safely
         * @param {Event} event
         */
        async handleMenuClick(event) {
            // Security/Performance Guard: Ignore script-triggered, bot, or programmatic clicks entirely
            if (!event.isTrusted) return;

            // Route Guard: Do not intercept if we are currently on the destination /copy/ page.
            // Evaluated dynamically on click to properly handle SPA soft-navigations.
            if (window.location.pathname.includes('/copy/')) return;

            // Fast exit: Check if click happened anywhere near a menu item to prevent excessive DOM traversal
            const targetEl = event.target.closest('[role="menuitem"], ._action_xvkjn_1, [data-testid="copy-event"], button, a');
            if (!targetEl) return;

            // Use relaxed regex to account for Eventbrite localization (Spanish, French, etc.)
            const textContent = (targetEl.textContent || '').trim().toLowerCase();
            const isCopyBtn = /copy event|copiar evento|copier l'événement/i.test(textContent) || targetEl.dataset.action === 'copy';

            if (!isCopyBtn) return;

            // Intercept and halt Eventbrite's original single-copy redirect
            event.preventDefault();
            event.stopPropagation();
            Logger.log('Native "Copy event" click intercepted successfully.');

            const eventId = EventParser.extractEventId();
            if (!eventId) {
                UI.showToast('Could not resolve current Event ID from the URL.', 'error');
                return;
            }

            const count = await UI.requestCopyCount(eventId);
            if (count !== null) {
                TabEngine.executeDuplication(eventId, count);
            }
        }
    };

    // SPA Route Management Module
    const SPAMonitor = {
        /**
         * Wires up listeners to detect client-side route changes on the SPA
         */
        init() {
            const handleNavigation = () => {
                Logger.log('SPA navigation detected.');
                UI.clearAllToasts();
            };

            // Modern Navigation API (Chrome 102+)
            if (window.navigation) {
                window.navigation.addEventListener('navigate', handleNavigation);
            } else {
                // Fallback for older browsers: monkey-patch history methods
                const patchHistory = (type) => {
                    const original = history[type];
                    return function() {
                        const rv = original.apply(this, arguments);
                        const event = new Event(type);
                        window.dispatchEvent(event);
                        return rv;
                    };
                };
                history.pushState = patchHistory('pushState');
                history.replaceState = patchHistory('replaceState');

                window.addEventListener('pushState', handleNavigation);
                window.addEventListener('replaceState', handleNavigation);
                window.addEventListener('popstate', handleNavigation);
            }
        }
    };

    // Performance-optimized global event delegation loop
    const AppLifecycle = {
        init() {
            Styles.init();
            SPAMonitor.init();

            // Event delegation catches the dynamic menu insertion cleanly
            document.addEventListener('click', (e) => ActionHandler.handleMenuClick(e), true);

            Logger.log('Global event interception layer mounted.');
        }
    };

    // Run safe lifecycle bootstrap
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppLifecycle.init());
    } else {
        AppLifecycle.init();
    }
})();
