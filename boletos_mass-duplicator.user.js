// ==UserScript==
// @name         [Boletos Express] Mass Duplicator
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.boletosexpress.com/favicon.ico
// @version      1.8
// @description  Automates multi-tab event duplication with custom date insertion, dynamic presenter validation, and automated field cleanup.
// @author       Xiv
// @match        *://*.boletosexpress.com/promoters/*
// @noframes
// @grant        GM_openInTab
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Work_CN/boletos_mass-duplicator.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/boletos_mass-duplicator.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__bxMassDuplicatorRunning) return;
    window.__bxMassDuplicatorRunning = true;

    const CONFIG = {
        DEBUG: false,
        CHUNK_SIZE: 3,
        CHUNKING_DELAY_MS: 500,
        MAX_COPIES_LIMIT: 20,
        TOAST_DURATION_MS: 4000,
        SESSION_KEY: 'bx_mass_dupe_target_date',
        MAX_PRESENTER_LENGTH: 60,
        STATUS_ACTIVE: "1",
        COPY_REGEX: /\s*\(Copy\)$/,
        COLORS: {
            brand: '#1C2A7C',
            brandHover: '#121C56',
            success: '#10b981',
            errorBg: '#fef2f2',
            errorBorder: '#ef4444',
            neutralBg: '#f8f9fa',
            neutralHover: '#eeeff2',
            textPrimary: '#1f2937',
            textSecondary: '#4b5563',
            borderDefault: '#d1d5db'
        }
    };

    const Logger = {
        log(msg, data = '') { if (CONFIG.DEBUG) console.log(`[BX Duplicator] ${msg}`, data); },
        error(msg, err = '') { console.error(`[BX Duplicator][Error] ${msg}`, err); }
    };

    const ElementBuilder = {
        create(tag, attributes = {}, ...children) {
            const el = document.createElement(tag);
            for (const [key, value] of Object.entries(attributes)) {
                if (key === 'className') el.className = value;
                else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.substring(2).toLowerCase(), value);
                else if (key === 'dataset') Object.assign(el.dataset, value);
                else el.setAttribute(key, value);
            }
            children.forEach(child => {
                if (typeof child === 'string' || typeof child === 'number') el.appendChild(document.createTextNode(String(child)));
                else if (child instanceof Node) el.appendChild(child);
            });
            return el;
        }
    };

    const DateEngine = {
        _monthsMap: {
            jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
            apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
            aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
            nov: 11, november: 11, dec: 12, december: 12
        },

        getNYToday() {
            const nyDateString = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
            const nyNow = new Date(nyDateString);
            return new Date(nyNow.getFullYear(), nyNow.getMonth(), nyNow.getDate());
        },

        parseFlexibleDate(inputStr, fallbackYear) {
            if (!inputStr) return null;
            const cleaned = inputStr.trim().toLowerCase().replace(/[.\/\-]/g, ' ');
            const parts = cleaned.split(/\s+/);

            if (parts.length < 2) return null;

            let m, d, y;
            if (isNaN(parts[0])) m = this._monthsMap[parts[0]];
            else m = parseInt(parts[0], 10);

            d = parseInt(parts[1], 10);
            if (parts.length >= 3) {
                y = parseInt(parts[2], 10);
                if (y < 100) y += 2000;
            } else {
                y = fallbackYear || this.getNYToday().getFullYear();
            }

            if (!m || isNaN(d) || isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
            return new Date(y, m - 1, d);
        },

        formatForBoletos(dateObj) {
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const yyyy = dateObj.getFullYear();
            return `${yyyy}-${mm}-${dd}`;
        }
    };

    const Styles = {
        init() {
            const css = `
                .bx-md-overlay {
                    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 2147483646 !important; backdrop-filter: blur(0.5rem);
                    opacity: 0; transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                    pointer-events: auto !important;
                }
                .bx-md-overlay.bx-md-visible { opacity: 1; }

                .bx-md-modal {
                    background: #ffffff; padding: 1.75rem;
                    border-radius: 1rem; width: 100%; max-width: 30rem;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                    transform: translateY(1rem) scale(0.98);
                    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    box-sizing: border-box;
                }
                .bx-md-visible .bx-md-modal { transform: translateY(0) scale(1); }

                .bx-md-title { margin: 0 0 0.375rem 0; font-size: 1.5rem; color: ${CONFIG.COLORS.textPrimary}; font-weight: 700; letter-spacing: -0.02em; }
                .bx-md-text { margin: 0 0 1.25rem 0; font-size: 0.95rem; color: ${CONFIG.COLORS.textSecondary}; line-height: 1.5; }

                .bx-md-textarea {
                    width: 100%; padding: 0.875rem; font-size: 1rem; color: ${CONFIG.COLORS.textPrimary};
                    border: 1px solid ${CONFIG.COLORS.borderDefault}; border-radius: 0.625rem; box-sizing: border-box; margin-bottom: 0.375rem;
                    min-height: 8.75rem; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                    background: #fafafa;
                }
                .bx-md-textarea:focus { outline: none; border-color: ${CONFIG.COLORS.brand}; box-shadow: 0 0 0 4px rgba(28, 42, 124, 0.12); background: #ffffff; }

                .bx-md-feedback { font-size: 0.88rem; min-height: 1.25rem; margin-bottom: 1.5rem; display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.375rem 0.75rem; border-radius: 0.375rem; width: 100%; box-sizing: border-box; }
                .bx-md-feedback-neutral { color: ${CONFIG.COLORS.textSecondary}; background: ${CONFIG.COLORS.neutralBg}; border: 1px solid #e5e7eb; }
                .bx-md-feedback-success { color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; font-weight: 500; }
                .bx-md-feedback-error { color: #991b1b; background: #fef2f2; border: 1px solid #fca5a5; font-weight: 500; }

                .bx-md-actions { display: flex; align-items: center; justify-content: flex-end; gap: 0.625rem; width: 100%; border-top: 1px solid #f3f4f6; padding-top: 1.25rem; }

                .bx-md-btn {
                    padding: 0.625rem 1.125rem; font-size: 0.95rem; border-radius: 0.5rem; border: 1px solid transparent; cursor: pointer; font-weight: 600;
                    transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1); display: inline-flex; align-items: center; justify-content: center;
                    box-sizing: border-box; height: 2.5rem;
                }
                .bx-md-btn:active { transform: scale(0.98); }

                .bx-md-btn-primary { background: ${CONFIG.COLORS.brand}; color: #ffffff; box-shadow: 0 2px 4px rgba(28, 42, 124, 0.15); }
                .bx-md-btn-primary:hover:not(:disabled) { background: ${CONFIG.COLORS.brandHover}; box-shadow: 0 4px 8px rgba(28, 42, 124, 0.25); }
                .bx-md-btn-primary:disabled { background: #e5e7eb; color: #9ca3af; cursor: not-allowed; box-shadow: none; border-color: transparent; }

                .bx-md-btn-secondary { background: #ffffff; color: ${CONFIG.COLORS.textPrimary}; border-color: ${CONFIG.COLORS.borderDefault}; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
                .bx-md-btn-secondary:hover:not(:disabled) { background: ${CONFIG.COLORS.neutralBg}; border-color: #b3b7bd; }

                .bx-md-btn-cancel { background: #ffffff; color: #ef4444; border-color: transparent; }
                .bx-md-btn-cancel:hover:not(:disabled) { background: #fef2f2; color: #b91c1c; }

                .bx-md-toast-container { position: fixed; bottom: 1.5rem; right: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem; z-index: 2147483647 !important; pointer-events: none; }
                .bx-md-toast {
                    background: #ffffff; color: #1e1e1e; padding: 1rem 1.25rem; border-radius: 0.5rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 0.9rem; border-left: 4px solid ${CONFIG.COLORS.brand};
                    transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    display: flex; align-items: center; gap: 0.75rem; pointer-events: auto;
                }
                .bx-md-toast-error { border-left-color: ${CONFIG.COLORS.errorBorder}; }
                .bx-md-toast-success { border-left-color: ${CONFIG.COLORS.success}; }
                .bx-md-toast-visible { transform: translateX(0); }

                .bx-presenter-counter { font-size: 0.75rem; color: ${CONFIG.COLORS.textSecondary}; margin-top: 0.25rem; font-weight: 500; display: block; }
                .bx-presenter-counter.bx-counter-overflow { color: ${CONFIG.COLORS.errorBorder}; font-weight: 600; }
            `;
            GM_addStyle(css);
        }
    };

    const UI = {
        toastContainer: null,

        showToast(message, type = 'info', options = {}) {
            if (!this.toastContainer) {
                this.toastContainer = ElementBuilder.create('div', { className: 'bx-md-toast-container' });
                document.body.appendChild(this.toastContainer);
            }

            const prefix = type === 'error' ? '⚠️ ' : type === 'success' ? '✅ ' : 'ℹ️ ';
            const content = ElementBuilder.create('span', {}, ElementBuilder.create('strong', {}, prefix), message);
            const toast = ElementBuilder.create('div', { className: `bx-md-toast bx-md-toast-${type}`, role: 'alert' }, content);

            this.toastContainer.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('bx-md-toast-visible'));

            const removeToast = () => {
                toast.classList.remove('bx-md-toast-visible');
                setTimeout(() => toast.remove(), 300);
            };

            if (options.duration !== 0) setTimeout(removeToast, options.duration || CONFIG.TOAST_DURATION_MS);
            return removeToast;
        },

        requestDates(eventId) {
            return new Promise((resolve) => {
                const modalController = new AbortController();
                const { signal } = modalController;

                const overlay = ElementBuilder.create('div', { className: 'bx-md-overlay' });
                const titleText = ElementBuilder.create('h3', { className: 'bx-md-title' }, 'Mass Duplicate Event');
                const desc = ElementBuilder.create('p', { className: 'bx-md-text' }, `Enter target dates for Event ID: ${eventId}. One date per line.`);
                const textarea = ElementBuilder.create('textarea', { className: 'bx-md-textarea', placeholder: "7.4\n8/15\nOct 31\nJan 1 2027" });

                const feedbackBar = ElementBuilder.create('div', { className: 'bx-md-feedback bx-md-feedback-neutral' }, 'Waiting for input...');

                const btnStandard = ElementBuilder.create('button', { type: 'button', className: 'bx-md-btn bx-md-btn-secondary', style: 'margin-right: auto;' }, 'Standard Copy');
                const btnCancel = ElementBuilder.create('button', { type: 'button', className: 'bx-md-btn bx-md-btn-cancel' }, 'Cancel');
                const btnConfirm = ElementBuilder.create('button', { type: 'button', className: 'bx-md-btn bx-md-btn-primary', disabled: true }, 'Duplicate');

                const actions = ElementBuilder.create('div', { className: 'bx-md-actions' }, btnStandard, btnCancel, btnConfirm);
                const modal = ElementBuilder.create('div', { className: 'bx-md-modal', role: 'dialog', 'aria-modal': 'true' }, titleText, desc, textarea, feedbackBar, actions);

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                const nyToday = DateEngine.getNYToday();
                const fallbackYear = nyToday.getFullYear(); // Optimized: Cached once per validation lifecycle run

                const validateLiveInput = () => {
                    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);
                    if (lines.length === 0) {
                        feedbackBar.textContent = 'Waiting for input...';
                        feedbackBar.className = 'bx-md-feedback bx-md-feedback-neutral';
                        btnConfirm.disabled = true;
                        return null;
                    }
                    if (lines.length > CONFIG.MAX_COPIES_LIMIT) {
                        feedbackBar.textContent = `⚠️ Maximum limit exceeded (${CONFIG.MAX_COPIES_LIMIT} allowed)`;
                        feedbackBar.className = 'bx-md-feedback bx-md-feedback-error';
                        btnConfirm.disabled = true;
                        return null;
                    }

                    const validDates = [];
                    for (let i = 0; i < lines.length; i++) {
                        const dateObj = DateEngine.parseFlexibleDate(lines[i], fallbackYear);
                        if (!dateObj || isNaN(dateObj.getTime())) {
                            // Security: Enforced strict DOM node construction to mitigate Reflected XSS risks
                            feedbackBar.textContent = '';
                            feedbackBar.className = 'bx-md-feedback bx-md-feedback-error';
                            feedbackBar.appendChild(document.createTextNode('⚠️ '));
                            feedbackBar.appendChild(ElementBuilder.create('strong', {}, `Line ${i + 1}:`));
                            feedbackBar.appendChild(document.createTextNode(` Invalid format ("${lines[i]}")`));
                            btnConfirm.disabled = true;
                            return null;
                        }

                        const dayMidnight = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
                        if (dayMidnight < nyToday) {
                            feedbackBar.textContent = '';
                            feedbackBar.className = 'bx-md-feedback bx-md-feedback-error';
                            feedbackBar.appendChild(document.createTextNode('⚠️ '));
                            feedbackBar.appendChild(ElementBuilder.create('strong', {}, `Line ${i + 1}:`));
                            feedbackBar.appendChild(document.createTextNode(' Date is in the past'));
                            btnConfirm.disabled = true;
                            return null;
                        }

                        validDates.push({ string: DateEngine.formatForBoletos(dateObj), timestamp: dateObj.getTime() });
                    }

                    feedbackBar.textContent = '';
                    feedbackBar.className = 'bx-md-feedback bx-md-feedback-success';
                    feedbackBar.appendChild(document.createTextNode('✅ '));
                    feedbackBar.appendChild(ElementBuilder.create('strong', {}, `${validDates.length} valid date(s)`));
                    feedbackBar.appendChild(document.createTextNode(' parsed sequentially'));
                    btnConfirm.disabled = false;
                    return validDates;
                };

                const cleanup = () => {
                    modalController.abort();
                    overlay.classList.remove('bx-md-visible');
                    setTimeout(() => overlay.remove(), 250);
                };

                const handleConfirm = (validDates) => {
                    validDates.sort((a, b) => b.timestamp - a.timestamp);
                    btnConfirm.disabled = true;
                    btnConfirm.textContent = 'Processing...';
                    cleanup();
                    resolve(validDates);
                };

                textarea.addEventListener('input', validateLiveInput, { signal });

                requestAnimationFrame(() => {
                    overlay.classList.add('bx-md-visible');
                    setTimeout(() => textarea.focus(), 220);
                });

                document.addEventListener('focusin', (e) => {
                    if (document.contains(modal) && !modal.contains(e.target)) {
                        e.stopPropagation();
                        textarea.focus();
                    }
                }, { capture: true, signal });

                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        cleanup();
                        resolve(null);
                    }
                }, { signal });

                btnCancel.addEventListener('click', () => { cleanup(); resolve(null); }, { signal });
                btnStandard.addEventListener('click', () => { cleanup(); resolve('STANDARD'); }, { signal });

                btnConfirm.addEventListener('click', () => {
                    const validDates = validateLiveInput();
                    if (validDates) handleConfirm(validDates);
                }, { signal });

                overlay.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        cleanup();
                        resolve(null);
                    }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        const validDates = validateLiveInput();
                        if (validDates) handleConfirm(validDates);
                    }
                }, { signal });
            });
        }
    };

    const TabEngine = {
        async executeDuplication(eventId, datesList) {
            if (typeof GM_openInTab === 'undefined') {
                UI.showToast('Your userscript manager does not support background tab spawning.', 'error');
                return;
            }

            const dismissSpawning = UI.showToast(`Spawning ${datesList.length} events...`, 'info', { duration: 0 });

            for (let i = 0; i < datesList.length; i++) {
                const current = datesList[i];
                const targetUrl = `https://www.boletosexpress.com/promoters/event-copy.php?event_id=${eventId}&bxmd_target_date=${encodeURIComponent(current.string)}`;

                GM_openInTab(targetUrl, { active: false, insert: true, setParent: true });
                if (i < datesList.length - 1) {
                    await new Promise(r => setTimeout(r, CONFIG.CHUNKING_DELAY_MS));
                }
            }

            dismissSpawning();
            UI.showToast(`Spawned all ${datesList.length} event tabs. Check your browser.`, 'success');
        }
    };

    const WorkflowEngine = {
        sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },

        initPresenterCounter() {
            const presenterInput = document.querySelector('input[name="presenter"]');
            if (!presenterInput || document.getElementById('bx-presenter-counter')) return;

            const counter = ElementBuilder.create('div', {
                id: 'bx-presenter-counter',
                className: 'bx-presenter-counter'
            });

            const updateCounter = () => {
                const len = presenterInput.value.length;
                counter.textContent = `Character count: ${len} / ${CONFIG.MAX_PRESENTER_LENGTH} max for duplication cleanup (Form limit: 127)`;
                if (len > CONFIG.MAX_PRESENTER_LENGTH) {
                    counter.classList.add('bx-counter-overflow');
                } else {
                    counter.classList.remove('bx-counter-overflow');
                }
            };

            presenterInput.parentNode.insertBefore(counter, presenterInput.nextSibling);
            presenterInput.addEventListener('input', updateCounter);
            updateCounter();
        },

        async runCleanLogic(targetDate) {
            try {
                // 1. Inject Date Value
                const dateInput = document.querySelector('input[name="date"]');
                if (dateInput) {
                    dateInput.value = targetDate;
                    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
                    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // 2. Clean Name and enforce Blank Slugs natively
                const nameInput = document.querySelector('input[name="name"]');
                if (nameInput && CONFIG.COPY_REGEX.test(nameInput.value)) {
                    nameInput.value = nameInput.value.replace(CONFIG.COPY_REGEX, '');
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                const slugInput = document.querySelector('input[name="slug"]');
                if (slugInput) {
                    slugInput.value = '';
                    slugInput.dispatchEvent(new Event('input', { bubbles: true }));
                    slugInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // 3. Set Status Active
                const select = document.querySelector('select[name="status"]');
                if (select && select.value !== CONFIG.STATUS_ACTIVE) {
                    select.value = CONFIG.STATUS_ACTIVE;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // 4. Truncate Presenter & Update dynamic counters
                const presenter = document.querySelector('input[name="presenter"]');
                if (presenter) { // Optimized: Cached element reference instead of double execution querying
                    if (presenter.value.length > CONFIG.MAX_PRESENTER_LENGTH) {
                        presenter.value = presenter.value.slice(0, CONFIG.MAX_PRESENTER_LENGTH);
                        presenter.dispatchEvent(new Event('input', { bubbles: true }));
                        presenter.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    presenter.dispatchEvent(new Event('input'));
                }

                UI.showToast(`Mass Duplicator Applied! Date set to ${targetDate}. You can now save.`, 'success', { duration: 8000 });
            } catch (err) {
                Logger.error('Clean logic failed', err);
                UI.showToast('Clean logic encountered an error.', 'error');
            }
        },

        handleCopyPageLifecycle() {
            let copyObserver = null;

            const cleanupObserver = () => {
                if (copyObserver) {
                    copyObserver.disconnect();
                    copyObserver = null;
                }
            };

            const checkStatus = () => {
                const pageText = document.body.innerText || document.body.textContent;

                if (/event\s+copied/i.test(pageText)) {
                    cleanupObserver();
                    const editLink = document.querySelector('.nav li a[href*="event-addedit.php"]') ||
                                     document.querySelector('a[href*="event-addedit.php"]') ||
                                     document.querySelector('#event_editing_nav a');
                    if (editLink) {
                        UI.showToast('Duplication confirmed. Routing to form configurations...', 'success', { duration: 2000 });
                        setTimeout(() => window.location.href = editLink.href, 300);
                    } else {
                        UI.showToast('Error: Failed to trace event edit configuration path.', 'error');
                    }
                    return true;
                }

                const copyConfirmBtn = document.querySelector('input[type="submit"][value="Copy Event" i]');
                if (copyConfirmBtn && !copyConfirmBtn.dataset.bxAutomationTriggered) {
                    cleanupObserver();
                    copyConfirmBtn.dataset.bxAutomationTriggered = "true";
                    UI.showToast('Executing automated form configuration...', 'info', { duration: 2000 });
                    setTimeout(() => copyConfirmBtn.click(), 400);
                    return true;
                }
                return false;
            };

            if (checkStatus()) return;

            copyObserver = new MutationObserver(() => { checkStatus(); });
            copyObserver.observe(document.body, { childList: true, subtree: true });

            // Stability Cleanup: Unbind mutation handlers cleanly to mitigate race conditions
            setTimeout(() => { cleanupObserver(); }, 10000);
        },

        async handlePageLoad() {
            try {
                const urlParams = new URLSearchParams(window.location.search);

                if (urlParams.has('bxmd_target_date')) {
                    sessionStorage.setItem(CONFIG.SESSION_KEY, urlParams.get('bxmd_target_date'));
                    window.history.replaceState(null, '', window.location.pathname + '?event_id=' + urlParams.get('event_id'));
                }

                const path = window.location.pathname;

                if (path.includes('event-addedit.php')) {
                    this.initPresenterCounter();
                }

                const targetDate = sessionStorage.getItem(CONFIG.SESSION_KEY);
                if (!targetDate) return;

                if (path.includes('event-copy.php')) {
                    this.handleCopyPageLifecycle();
                }
                else if (path.includes('event-addedit.php')) {
                    const dismissApplying = UI.showToast('Applying Dates and CleanLogic...', 'info', { duration: 0 });
                    await this.sleep(500);
                    await this.runCleanLogic(targetDate);
                    dismissApplying();
                    sessionStorage.removeItem(CONFIG.SESSION_KEY);
                }
            } catch (err) {
                Logger.error('Global page load processing engine crashed safely:', err);
            }
        }
    };

    const ActionHandler = {
        async handleMenuClick(event) {
            const targetEl = event.target.closest('a[href*="event-copy.php"]');
            if (!targetEl || !targetEl.href) return;

            if (window.location.pathname.includes('event-copy.php') || sessionStorage.getItem(CONFIG.SESSION_KEY)) return;

            event.preventDefault();
            event.stopPropagation();

            const urlObj = new URL(targetEl.href);
            const eventId = urlObj.searchParams.get('event_id');

            if (!eventId) {
                UI.showToast('Could not extract Event ID from link.', 'error');
                return;
            }

            const datesList = await UI.requestDates(eventId);

            if (datesList === 'STANDARD') {
                window.location.href = targetEl.href;
            } else if (datesList !== null) {
                TabEngine.executeDuplication(eventId, datesList);
            }
        }
    };

    const AppLifecycle = {
        init() {
            Styles.init();
            document.addEventListener('click', (e) => ActionHandler.handleMenuClick(e), true);
            WorkflowEngine.handlePageLoad();
            Logger.log('Boletos Mass Duplicator initialized.');
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppLifecycle.init());
    } else {
        AppLifecycle.init();
    }
})();
