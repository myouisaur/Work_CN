// ==UserScript==
// @name         [Eventbrite] Mass Duplicator
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.eventbrite.com/favicon.ico
// @version      4.9
// @description  Intercepts Eventbrite's native "Copy event" dropdown item to allow rapid multi-tab duplication and dynamic date injection across all management panels.
// @author       Xiv
// @match        *://*.eventbrite.com/*
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

    // Prevent duplicate initializations on SPA layout transitions
    if (document.documentElement.dataset.ebMassDuplicatorRunning === 'true') return;
    document.documentElement.dataset.ebMassDuplicatorRunning = 'true';

    // State Management for Configuration
    const ConfigManager = {
        get(key, defaultVal) {
            try {
                return typeof GM_getValue !== 'undefined' ? GM_getValue(key, defaultVal) : defaultVal;
            } catch (e) {
                Logger.error(`Failed to read config key: ${key}`, e);
                return defaultVal;
            }
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
        TOAST_DURATION_MS: 4000,
        INJECTION_DELAY_MS: 150,
        MAX_VISIBLE_TOASTS: 4
    };

    const Logger = {
        log(msg, data = '') { if (CONFIG.DEBUG) console.log(`[EBDuplicator] ${msg}`, data); },
        error(msg, err = '') { console.error(`[EBDuplicator][Error] ${msg}`, err); }
    };

    // Safe DOM Creation Utility
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

    // Date Processing Engine
    const DateEngine = {
        _monthsMap: {
            jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
            apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
            aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
            nov: 11, november: 11, dec: 12, december: 12
        },

        getNYToday() {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/New_York',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            });
            const parts = formatter.formatToParts(new Date());
            const mapped = {};
            for (const part of parts) {
                if (part.type !== 'literal') mapped[part.type] = parseInt(part.value, 10);
            }
            return new Date(mapped.year, mapped.month - 1, mapped.day);
        },

        parseFlexibleDate(inputStr, fallbackYear) {
            if (!inputStr) return null;
            const cleaned = inputStr.trim().toLowerCase().replace(/[.\/\-]/g, ' ');
            const parts = cleaned.split(/\s+/);

            if (parts.length < 2) return null;

            let m, d, y;
            // Enhanced layout validation to explicitly capture ISO YYYY-MM-DD variants cleanly
            if (parts[0].length === 4 && !isNaN(parts[0])) {
                y = parseInt(parts[0], 10);
                m = isNaN(parts[1]) ? this._monthsMap[parts[1]] : parseInt(parts[1], 10);
                d = parseInt(parts[2], 10);
            } else {
                m = isNaN(parts[0]) ? this._monthsMap[parts[0]] : parseInt(parts[0], 10);
                d = parseInt(parts[1], 10);
                if (parts.length >= 3) {
                    y = parseInt(parts[2], 10);
                    if (y < 100) y += 2000;
                } else {
                    y = fallbackYear || this.getNYToday().getFullYear();
                }
            }

            if (!m || isNaN(d) || isNaN(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
            const verifiedDate = new Date(y, m - 1, d);
            if (verifiedDate.getFullYear() !== y || verifiedDate.getMonth() !== m - 1 || verifiedDate.getDate() !== d) return null;
            return verifiedDate;
        },

        formatDateToString(dateObj) {
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const yyyy = dateObj.getFullYear();
            return `${mm}/${dd}/${yyyy}`;
        },

        formatToVerificationString(dateObj) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const mmm = months[dateObj.getMonth()];
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const yyyy = dateObj.getFullYear();
            return `${mmm} ${dd}, ${yyyy}`;
        }
    };

    // Stylesheet Injection
    const Styles = {
        init() {
            const css = `
                .eb-md-overlay {
                    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 2147483646 !important; backdrop-filter: blur(0.5rem);
                    opacity: 0; transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                    pointer-events: auto !important;
                }
                .eb-md-overlay.eb-md-visible { opacity: 1; }

                .eb-md-modal {
                    background: #ffffff; padding: 1.75rem;
                    border-radius: 1rem; width: 100%; max-width: 46rem;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                    transform: translateY(1rem) scale(0.98);
                    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    box-sizing: border-box;
                }
                .eb-md-visible .eb-md-modal { transform: translateY(0) scale(1); }

                .eb-md-title-container { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.375rem; }
                .eb-md-title { margin: 0; font-size: 1.5rem; color: #1f2937; font-weight: 700; letter-spacing: -0.02em; }
                .eb-md-text { margin: 0 0 1.25rem 0; font-size: 0.95rem; color: #4b5563; line-height: 1.5; }

                /* Structural Layout Container for Parallel Split Panel Orientation */
                .eb-md-split-container {
                    display: flex; gap: 1rem; width: 100%; margin-bottom: 0.75rem; align-items: stretch; box-sizing: border-box;
                }

                .eb-md-textarea {
                    flex: 1; width: 50%; padding: 0.875rem; font-size: 0.95rem; color: #1f2937;
                    border: 1px solid #d1d5db; border-radius: 0.625rem; box-sizing: border-box; margin-bottom: 0;
                    min-height: 10rem; height: 10rem; resize: none; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease; background: #fafafa;
                }
                .eb-md-textarea:focus { border-color: #3659e3; box-shadow: 0 0 0 4px rgba(54, 89, 227, 0.12); background: #ffffff; outline: none; }
                .eb-md-textarea:disabled { background: #f3f4f6; color: #9ca3af; cursor: not-allowed; }

                /* Horizontal Verification View Elements */
                .eb-md-preview-wrapper {
                    flex: 1; width: 50%; border: 1px solid #e5e7eb; border-radius: 0.625rem; background: #f9fafb;
                    padding: 0.75rem; min-height: 10rem; height: 10rem; max-height: 10rem; overflow-y: auto;
                    margin-bottom: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 0.375rem;
                }
                .eb-md-preview-line { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-family: ui-monospace, SFMono-Regular, monospace; line-height: 1.4; }
                .eb-md-preview-input { color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }
                .eb-md-preview-output { font-weight: 600; text-align: right; }
                .eb-md-preview-line.status-valid .eb-md-preview-output { color: #059669; }
                .eb-md-preview-line.status-invalid .eb-md-preview-output { color: #dc2626; font-weight: 500; }

                .eb-md-feedback { font-size: 0.88rem; min-height: 1.25rem; margin-bottom: 1.25rem; display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.375rem 0.75rem; border-radius: 0.375rem; width: 100%; box-sizing: border-box; }
                .eb-md-feedback-neutral { color: #4b5563; background: #f3f4f6; border: 1px solid #e5e7eb; }
                .eb-md-feedback-success { color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; font-weight: 500; }
                .eb-md-feedback-error { color: #991b1b; background: #fef2f2; border: 1px solid #fca5a5; font-weight: 500; }

                .eb-md-toggle-wrapper { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; cursor: pointer; user-select: none; width: max-content; }
                .eb-md-toggle-wrapper input { display: none; }
                .eb-md-toggle-slider { position: relative; width: 36px; height: 20px; background-color: #d1d5db; border-radius: 20px; transition: background-color 0.2s ease; }
                .eb-md-toggle-slider::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background-color: white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
                .eb-md-toggle-wrapper input:checked + .eb-md-toggle-slider { background-color: #3659e3; }
                .eb-md-toggle-wrapper input:checked + .eb-md-toggle-slider::after { transform: translateX(16px); }
                .eb-md-toggle-wrapper input:disabled + .eb-md-toggle-slider { opacity: 0.5; cursor: not-allowed; }
                .eb-md-toggle-label { font-size: 0.95rem; color: #1f2937; font-weight: 500; }

                .eb-md-actions { display: flex; align-items: center; justify-content: space-between; width: 100%; border-top: 1px solid #f3f4f6; padding-top: 1.25rem; }
                .eb-md-actions-right { display: flex; gap: 0.625rem; }
                .eb-md-btn { padding: 0.625rem 1.125rem; font-size: 0.95rem; border-radius: 0.5rem; border: 1px solid transparent; cursor: pointer; font-weight: 600; transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1); display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; height: 2.5rem; }
                .eb-md-btn:active { transform: scale(0.98); }
                .eb-md-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(54, 89, 227, 0.3); }

                .eb-md-btn-cancel { background: #ffffff; color: #39364f; border-color: #d1d5db; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
                .eb-md-btn-cancel:hover:not(:disabled) { background: #f9fafb; border-color: #b3b7bd; }
                .eb-md-btn-cancel:disabled { opacity: 0.6; cursor: not-allowed; }

                .eb-md-btn-primary { background: #d1410c; color: white; box-shadow: 0 2px 4px rgba(209, 65, 12, 0.15); }
                .eb-md-btn-primary:hover:not(:disabled) { background: #b2370a; box-shadow: 0 4px 8px rgba(209, 65, 12, 0.25); }
                .eb-md-btn-primary:disabled { background: #e5e7eb; color: #9ca3af; cursor: not-allowed; border: 1px solid transparent; box-shadow: none; }

                .eb-md-toast-container { position: fixed; bottom: 1.5rem; right: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem; z-index: 2147483647 !important; pointer-events: none; }
                .eb-md-toast { background: #ffffff; color: #1e1e1e; padding: 1rem 1.25rem; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 0.9rem; border-left: 4px solid #3659e3; transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); display: flex; align-items: center; gap: 0.75rem; pointer-events: auto; }
                .eb-md-toast.eb-md-toast-error { border-left-color: #c5162e; }
                .eb-md-toast.eb-md-toast-success { border-left-color: #0d7a54; }
                .eb-md-toast.eb-md-toast-visible { transform: translateX(0); }

                .eb-md-toast-actions { margin-left: auto; padding-left: 1rem; }
                .eb-md-toast-btn-stop { background: #fee2e2; color: #c5162e; border: 1px solid #fca5a5; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: all 0.2s ease; }
                .eb-md-toast-btn-stop:hover { background: #fecaca; color: #991b1b; }
                @keyframes ebmd-spin { 100% { transform: rotate(360deg); } }
            `;
            GM_addStyle(css);
        }
    };

    // User Interface Engine
    const UI = {
        toastContainer: null,
        draftText: '',
        draftSameDate: false,
        draftEventId: null,

        clearAllToasts() {
            if (this.toastContainer) {
                while (this.toastContainer.firstChild) {
                    this.toastContainer.removeChild(this.toastContainer.firstChild);
                }
            }
        },

        requestDates(eventId) {
            return new Promise((resolve) => {
                const abortController = new AbortController();
                const { signal } = abortController;

                // Reset draft state if the user opened the modal for a different event
                if (this.draftEventId !== eventId) {
                    this.draftText = '';
                    this.draftSameDate = false;
                    this.draftEventId = eventId;
                }

                const overlay = ElementBuilder.create('div', { className: 'eb-md-overlay' });
                const svgIcon = ElementBuilder.create('span', {});
                svgIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 4H5C3.89543 4 3 4.89543 3 6V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V6C21 4.89543 20.1046 4 19 4Z" stroke="#3659e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 2V6" stroke="#3659e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 2V6" stroke="#3659e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 10H21" stroke="#3659e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                const titleText = ElementBuilder.create('h3', { className: 'eb-md-title', id: 'eb-md-title-id' }, 'Mass Duplicate Event');
                const titleContainer = ElementBuilder.create('div', { className: 'eb-md-title-container' }, svgIcon, titleText);
                const desc = ElementBuilder.create('p', { className: 'eb-md-text' }, `Enter start dates for Event ID: ${eventId}. One date per line. `);

                // Hydrate inputs with preserved draft state
                const textarea = ElementBuilder.create('textarea', { className: 'eb-md-textarea', placeholder: "2026-06-20\n7.4\n8/15\nOct 31" });
                textarea.value = UI.draftText;

                const previewWrapper = ElementBuilder.create('div', { className: 'eb-md-preview-wrapper' });

                // Mount Split Row Wrapper Components
                const splitContainer = ElementBuilder.create('div', { className: 'eb-md-split-container' }, textarea, previewWrapper);
                const feedbackBar = ElementBuilder.create('div', { className: 'eb-md-feedback eb-md-feedback-neutral' }, 'Waiting for input...');

                const checkbox = ElementBuilder.create('input', { type: 'checkbox', id: 'eb-md-samedate' });
                checkbox.checked = UI.draftSameDate;

                const toggleSlider = ElementBuilder.create('div', { className: 'eb-md-toggle-slider' });
                const labelText = ElementBuilder.create('span', { className: 'eb-md-toggle-label' }, 'End date same as start date');
                const checkboxWrapper = ElementBuilder.create('label', { className: 'eb-md-toggle-wrapper', for: 'eb-md-samedate' }, checkbox, toggleSlider, labelText);

                const btnClear = ElementBuilder.create('button', { type: 'button', className: 'eb-md-btn eb-md-btn-cancel' }, 'Clear');
                const btnCancel = ElementBuilder.create('button', { type: 'button', className: 'eb-md-btn eb-md-btn-cancel' }, 'Cancel');
                const btnConfirm = ElementBuilder.create('button', { type: 'button', className: 'eb-md-btn eb-md-btn-primary', disabled: true }, 'Duplicate');

                const rightActions = ElementBuilder.create('div', { className: 'eb-md-actions-right' }, btnCancel, btnConfirm);
                const actions = ElementBuilder.create('div', { className: 'eb-md-actions' }, btnClear, rightActions);

                const modal = ElementBuilder.create('div', {
                    className: 'eb-md-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'eb-md-title-id'
                }, titleContainer, desc, splitContainer, checkboxWrapper, feedbackBar, actions);

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                const nyToday = DateEngine.getNYToday();
                const fallbackYear = nyToday.getFullYear();

                const validateLiveInput = () => {
                    // Update state persistence
                    UI.draftText = textarea.value;
                    UI.draftSameDate = checkbox.checked;

                    previewWrapper.textContent = '';
                    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l);

                    if (lines.length === 0) {
                        feedbackBar.textContent = 'Waiting for input...';
                        feedbackBar.className = 'eb-md-feedback eb-md-feedback-neutral';
                        btnConfirm.disabled = true;
                        return null;
                    }

                    if (lines.length > CONFIG.MAX_COPIES_LIMIT) {
                        feedbackBar.textContent = `⚠️ Maximum limit exceeded (${CONFIG.MAX_COPIES_LIMIT} allowed)`;
                        feedbackBar.className = 'eb-md-feedback eb-md-feedback-error';
                        btnConfirm.disabled = true;
                        return null;
                    }

                    const validDatePairs = [];
                    const isSameDate = checkbox.checked;
                    let containsErrors = false;

                    for (let i = 0; i < lines.length; i++) {
                        const dateObj = DateEngine.parseFlexibleDate(lines[i], fallbackYear);
                        const lineElement = ElementBuilder.create('div', { className: 'eb-md-preview-line' });
                        const inputSpan = ElementBuilder.create('span', { className: 'eb-md-preview-input' }, lines[i]);
                        const outputSpan = ElementBuilder.create('span', { className: 'eb-md-preview-output' });

                        lineElement.appendChild(inputSpan);
                        lineElement.appendChild(outputSpan);

                        if (!dateObj || isNaN(dateObj.getTime())) {
                            lineElement.classList.add('status-invalid');
                            outputSpan.textContent = '✕ Invalid format';
                            containsErrors = true;
                        } else {
                            const dayMidnight = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
                            if (dayMidnight < nyToday) {
                                lineElement.classList.add('status-invalid');
                                outputSpan.textContent = '✕ Past date';
                                containsErrors = true;
                            } else {
                                lineElement.classList.add('status-valid');
                                outputSpan.textContent = `✓ ${DateEngine.formatToVerificationString(dateObj)}`;

                                const startStr = DateEngine.formatDateToString(dateObj);
                                const endDateObj = new Date(dateObj);
                                if (!isSameDate) endDateObj.setDate(dateObj.getDate() + 1);
                                const endStr = DateEngine.formatDateToString(endDateObj);

                                validDatePairs.push({ start: startStr, end: endStr, timestamp: dateObj.getTime() });
                            }
                        }
                        previewWrapper.appendChild(lineElement);
                    }

                    if (containsErrors) {
                        feedbackBar.textContent = '⚠️ Resolve compilation validation flags before duplication.';
                        feedbackBar.className = 'eb-md-feedback eb-md-feedback-error';
                        btnConfirm.disabled = true;
                        return null;
                    }

                    feedbackBar.textContent = '';
                    feedbackBar.className = 'eb-md-feedback eb-md-feedback-success';
                    feedbackBar.appendChild(document.createTextNode('✅ '));
                    feedbackBar.appendChild(ElementBuilder.create('strong', {}, `${validDatePairs.length} valid date(s)`));
                    feedbackBar.appendChild(document.createTextNode(' verified successfully'));
                    btnConfirm.disabled = false;
                    return validDatePairs;
                };

                const debounce = (func, wait) => {
                    let timeout;
                    return (...args) => {
                        clearTimeout(timeout);
                        timeout = setTimeout(() => func(...args), wait);
                    };
                };

                const validateLiveInputDebounced = debounce(validateLiveInput, 200);

                const cleanup = () => {
                    abortController.abort();
                    overlay.classList.remove('eb-md-visible');
                    setTimeout(() => overlay.remove(), 250);
                };

                const handleConfirm = async () => {
                    const validDatePairs = validateLiveInput();
                    if (!validDatePairs) return;

                    validDatePairs.sort((a, b) => b.timestamp - a.timestamp);

                    btnConfirm.disabled = true;
                    btnConfirm.innerHTML = `<svg style="animation: ebmd-spin 1s linear infinite; margin-right: 8px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg> Processing...`;
                    textarea.disabled = true;
                    checkbox.disabled = true;
                    btnClear.disabled = true;
                    btnCancel.disabled = true;

                    // Erase draft memory state once successfully queued
                    UI.draftText = '';
                    UI.draftSameDate = false;

                    await new Promise(r => setTimeout(r, 400));
                    cleanup();
                    resolve(validDatePairs);
                };

                textarea.addEventListener('input', validateLiveInputDebounced, { signal });
                checkbox.addEventListener('change', validateLiveInput, { signal });

                btnClear.addEventListener('click', () => {
                    textarea.value = '';
                    checkbox.checked = false;
                    UI.draftText = '';
                    UI.draftSameDate = false;
                    validateLiveInput();
                    textarea.focus();
                }, { signal });

                requestAnimationFrame(() => {
                    overlay.classList.add('eb-md-visible');
                    validateLiveInput(); // Hydrate validation if resuming from drafted text
                    setTimeout(() => textarea.focus(), 250);
                });

                document.addEventListener('focusin', (e) => {
                    if (document.contains(modal) && !modal.contains(e.target)) {
                        e.stopPropagation();
                        textarea.focus();
                    }
                }, { capture: true, signal });

                btnClear.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
                btnCancel.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
                btnConfirm.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
                btnCancel.addEventListener('click', () => { cleanup(); resolve(null); }, { signal });
                btnConfirm.addEventListener('click', handleConfirm, { signal });
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) { cleanup(); resolve(null); }
                }, { signal });
                overlay.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') { cleanup(); resolve(null); }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleConfirm();
                }, { signal });
            });
        },

        showToast(message, type = 'info', options = {}) {
            if (!this.toastContainer) {
                this.toastContainer = ElementBuilder.create('div', { className: 'eb-md-toast-container' });
                document.body.appendChild(this.toastContainer);
            }

            // Enforce maximum visible toasts to prevent vertical stacking off-screen
            while (this.toastContainer.children.length >= CONFIG.MAX_VISIBLE_TOASTS) {
                this.toastContainer.firstElementChild.remove();
            }

            const prefix = type === 'error' ? '⚠️ ' : type === 'success' ? '✅ ' : 'ℹ️ ';
            const content = ElementBuilder.create('span', {}, ElementBuilder.create('strong', {}, prefix), message);
            const toast = ElementBuilder.create('div', { className: `eb-md-toast eb-md-toast-${type}`, role: 'alert' }, content);

            if (options.onCancel) {
                const btnStop = ElementBuilder.create('button', { className: 'eb-md-toast-btn-stop' }, 'Stop');
                btnStop.addEventListener('click', () => {
                    options.onCancel();
                    btnStop.disabled = true;
                    btnStop.textContent = 'Stopping...';
                });
                toast.appendChild(ElementBuilder.create('div', { className: 'eb-md-toast-actions' }, btnStop));
            }

            this.toastContainer.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('eb-md-toast-visible'));

            const removeToast = () => {
                toast.classList.remove('eb-md-toast-visible');
                setTimeout(() => toast.remove(), 300);
            };

            if (options.duration !== 0) setTimeout(removeToast, options.duration || CONFIG.TOAST_DURATION_MS);
            return removeToast;
        }
    };

    // Core Business Engines
    const EventParser = {
        extractEventId(targetEl) {
            // 1. Try extracting from the clicked element's href (useful for listing page dropdowns)
            if (targetEl && targetEl.href) {
                const hrefMatch = targetEl.href.match(/\/(?:events|myevent|manage\/events)\/(\d+)/i);
                if (hrefMatch && hrefMatch[1]) {
                    Logger.log('Extracted Event ID from element href:', hrefMatch[1]);
                    return hrefMatch[1];
                }
            }

            // 2. Fallback to current page URL
            const url = window.location.href;
            const pathMatch = url.match(/\/(?:events|myevent|manage\/events)\/(\d+)/i);
            if (pathMatch && pathMatch[1]) return pathMatch[1];

            try {
                const urlObj = new URL(url);
                const eid = urlObj.searchParams.get('eid');
                if (eid && /^\d+$/.test(eid)) return eid;
            } catch (e) { Logger.error('Failed processing URL params object.', e); }

            // 3. Fallback to page metadata
            const metaId = document.querySelector('meta[property="eventbrite:event_id"], meta[name="event_id"]');
            if (metaId && metaId.content) return metaId.content;
            if (document.body.dataset.eventId) return document.body.dataset.eventId;

            return null;
        }
    };

    const TabEngine = {
        sleep(baseMs) {
            const jitter = Math.floor(Math.random() * (baseMs * 0.3)) - (baseMs * 0.15);
            return new Promise(resolve => setTimeout(resolve, baseMs + jitter));
        },

        async executeDuplication(eventId, datePairs) {
            if (typeof GM_openInTab === 'undefined') {
                UI.showToast('Permissions Error: Your userscript manager does not support GM_openInTab.', 'error');
                return;
            }

            const totalTabs = datePairs.length;
            let openedCount = 0;
            let isCancelled = false;

            const handleCancel = () => { isCancelled = true; };
            const dismissMainToast = UI.showToast(`Duplicating ${totalTabs} events...`, 'info', { duration: 0, onCancel: handleCancel });

            while (openedCount < totalTabs) {
                if (isCancelled) {
                    dismissMainToast();
                    UI.showToast(`Job aborted. Spawned ${openedCount} / ${totalTabs} copies.`, 'error');
                    return;
                }

                const currentBatchSize = Math.min(CONFIG.CHUNK_SIZE, totalTabs - openedCount);
                for (let i = 0; i < currentBatchSize; i++) {
                    const currentPair = datePairs[openedCount];
                    const targetUrl = `https://www.eventbrite.com/myevent/${eventId}/copy/?ebmd_start=${encodeURIComponent(currentPair.start)}&ebmd_end=${encodeURIComponent(currentPair.end)}`;

                    Logger.log(`Spawning tab for date: ${currentPair.start}`);
                    GM_openInTab(targetUrl, { active: false, insert: true, setParent: true });
                    openedCount++;
                }

                if (openedCount < totalTabs) await this.sleep(CONFIG.CHUNKING_DELAY_MS);
            }

            dismissMainToast();
            UI.showToast(`Successfully spawned all ${totalTabs} event copies.`, 'success');
        }
    };

    // Child Tab Injection Engine
    const FormInjector = {
        observer: null,

        sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },

        async injectNativeValue(element, value) {
            element.focus();
            await this.sleep(CONFIG.INJECTION_DELAY_MS);

            const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
            const prototype = Object.getPrototypeOf(element);
            const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

            if (valueSetter && valueSetter !== prototypeValueSetter) {
                prototypeValueSetter.call(element, value);
            } else {
                valueSetter.call(element, value);
            }

            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));

            await this.sleep(CONFIG.INJECTION_DELAY_MS);
            element.blur();
            await this.sleep(CONFIG.INJECTION_DELAY_MS);
        },

        async simulateTabFlow(startElement) {
            Logger.log('Initiating synthetic tab flow for React validation.');
            const interactiveSelector = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

            // Grab all interactive elements and filter out visually hidden ones
            const elements = Array.from(document.querySelectorAll(interactiveSelector)).filter(el => {
                return (el.offsetWidth > 0 || el.offsetHeight > 0) && window.getComputedStyle(el).visibility !== 'hidden';
            });

            const startIndex = elements.indexOf(startElement);
            if (startIndex === -1) {
                Logger.log('Start element not found in interactive array. Cannot construct dynamic tab path.');
                return;
            }

            // Dynamically find the terminal "Copy Event" button
            const targetIndex = elements.findIndex(el => el.tagName === 'BUTTON' && el.textContent.trim().toLowerCase() === 'copy event');

            if (targetIndex === -1 || targetIndex <= startIndex) {
                Logger.log('Could not determine exact terminal destination. Falling back to direct target focus.');
                const copyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'copy event');
                if (copyBtn) copyBtn.focus();
                return;
            }

            // Step focus linearly through the path
            for (let i = startIndex; i <= targetIndex; i++) {
                elements[i].focus();
                elements[i].dispatchEvent(new FocusEvent('focus', { bubbles: true }));

                await this.sleep(CONFIG.INJECTION_DELAY_MS); // Allow React layout effects to process focus

                if (i < targetIndex) {
                    elements[i].blur();
                    elements[i].dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                }
            }

            Logger.log('Synthetic tab flow finalized. Final validation should now be unlocked.');
        },

        async init() {
            if (!window.location.pathname.includes('/copy/')) return;
            const urlParams = new URLSearchParams(window.location.search);
            const targetStart = urlParams.get('ebmd_start');
            const targetEnd = urlParams.get('ebmd_end');
            const hasDateParams = targetStart && targetEnd;

            if (hasDateParams) {
                Logger.log('Date injection parameters detected. Cleansing URL bar...');
                window.history.replaceState(null, '', window.location.pathname);
            }

            let timeoutId;
            const checkAndInject = async () => {
                const titleInput = document.getElementById('title');
                const startInput = document.getElementById('copy-startDate');
                const endInput = document.getElementById('copy-endDate');

                if (titleInput && startInput && endInput && titleInput.value.length > 0) {
                    if (this.observer) this.observer.disconnect();
                    clearTimeout(timeoutId);

                    Logger.log('Inputs hydrated by React. Commencing automation sequence.');

                    if (titleInput.value.startsWith("Copy of ")) {
                        const newTitle = titleInput.value.replace(/^Copy of /, '');
                        await this.injectNativeValue(titleInput, newTitle);
                        if (!hasDateParams) UI.showToast(`Event title automatically cleaned.`, 'success');
                    }

                    if (hasDateParams) {
                        await this.injectNativeValue(startInput, targetStart);
                        await this.injectNativeValue(endInput, targetEnd);
                        // Double-tap the start input to bypass any inverse date validation bugs natively inherent in Eventbrite
                        await this.injectNativeValue(startInput, targetStart);
                        UI.showToast(`Successfully injected dates and cleaned title.`, 'success');
                    }

                    // Force the SPA to validate completion by synthesizing standard keyboard UX
                    await this.simulateTabFlow(titleInput);
                    UI.showToast(`Automated form sweep complete.`, 'info');
                    return true;
                }
                return false;
            };

            // Immediate initial check in case elements rendered sync or fast
            if (await checkAndInject()) return;

            // Safe fallback observer for async rendering
            this.observer = new MutationObserver(async (mutations, obs) => {
                if (await checkAndInject()) obs.disconnect();
            });
            this.observer.observe(document.body, { childList: true, subtree: true });

            timeoutId = setTimeout(() => {
                if (this.observer) this.observer.disconnect();
                Logger.log('Form hydration timeout reached. Observer disconnected.');
            }, 10000);
        }
    };

    // Event Interception Module
    const ActionHandler = {
        async handleMenuClick(event) {
            if (!event.isTrusted) return;
            if (window.location.pathname.includes('/copy/')) return;

            const targetEl = event.target.closest('[role="menuitem"], ._action_xvkjn_1, [data-testid="copy-event"], button, a');
            if (!targetEl) return;

            const textContent = (targetEl.textContent || '').trim().toLowerCase();
            const isCopyBtn = /^(copy event|copiar evento|copier l'événement)$/i.test(textContent) || targetEl.dataset.action === 'copy';

            if (!isCopyBtn) return;

            event.preventDefault();
            event.stopPropagation();
            Logger.log('Native "Copy event" click intercepted successfully.');

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

            const eventId = EventParser.extractEventId(targetEl);
            if (!eventId) {
                UI.showToast('Could not resolve current Event ID from the URL or page metadata.', 'error');
                return;
            }

            const datePairs = await UI.requestDates(eventId);
            if (datePairs !== null) {
                TabEngine.executeDuplication(eventId, datePairs);
            }
        }
    };

    // SPA Route Management Module
    const SPAMonitor = {
        init() {
            const handleNavigation = () => { UI.clearAllToasts(); };
            if (window.navigation) {
                window.navigation.addEventListener('navigate', handleNavigation);
            } else {
                const patchHistory = (type) => {
                    const original = history[type];
                    return function() {
                        const rv = original.apply(this, arguments);
                        window.dispatchEvent(new Event(type));
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
            FormInjector.init();

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
