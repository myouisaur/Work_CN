// ==UserScript==
// @name         [RA] Create Events
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon.svg
// @version      3.9
// @description  Allows bulk creation of multiple events simultaneously.
// @author       Xiv
// @match        *://*.ra.co/pro*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @updateURL    https://myouisaur.github.io/Work_CN/RA/create-events.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA/create-events.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__raMassCreatorRunning) return;
    window.__raMassCreatorRunning = true;

    // Centralized Architecture Configuration
    const CONFIG = {
        DEBUG: false,
        MAX_CREATION_LIMIT: 15,
        SPAWN_DELAY_MS: 400,
        INJECTION_DELAY_MS: 250,
        POLL_TIMEOUT_MS: 25000,
        DEFAULT_LINEUP: 'TBA',
        DEFAULT_PROMOTER: 'iBoatNYC',
        STORAGE_KEY_DESC: 'ramc_shared_description_payload',
        SESSION_KEY_ALLOC: 'ramc_allocation',
        SESSION_KEY_PRICE: 'ramc_price',

        KEYS: {
            TITLE: 'ramc_title',
            START_DATE: 'ramc_sdate',
            START_TIME: 'ramc_stime',
            END_DATE: 'ramc_edate',
            END_TIME: 'ramc_etime',
            VENUE: 'ramc_venue',
            YOUTUBE: 'ramc_youtube',
            ALLOCATION: 'ramc_allocation',
            PRICE: 'ramc_price'
        }
    };

    // Persistent Internal Memory Cache State Machine
    const ModalStateCache = {
        title: '',
        venue: '',
        youtube: '',
        description: '',
        dates: '',
        allocation: '',
        price: '',
        startTime: '',
        endTime: '',

        flush() {
            this.title = '';
            this.venue = '';
            this.youtube = '';
            this.description = '';
            this.dates = '';
            this.allocation = '';
            this.price = '';
            this.startTime = '';
            this.endTime = '';
        }
    };

    // Immutable Operational State Container for Active Tab Lifecycle Runtime
    const TabRuntimeCache = {
        youtubeLink: '',
        isActiveAutomation: false
    };

    const Logger = {
        log(msg, data = '') { if (CONFIG.DEBUG) console.log(`[RA Creator] ${msg}`, data); },
        error(msg, err = '') { console.error(`[RA Creator][Error] ${msg}`, err); }
    };

    // Safe DOM Architecture Utility
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

    // Advanced Cross-Platform Date Engine
    const DateEngine = {
        _monthsMap: {
            jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
            apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
            aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
            nov: 11, november: 11, dec: 12, december: 12
        },

        getNYToday() {
            const nyString = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
            const nyDate = new Date(nyString);
            return new Date(nyDate.getFullYear(), nyDate.getMonth(), nyDate.getDate());
        },

        parseFlexibleDate(inputStr, fallbackYear) {
            if (!inputStr) return null;
            const cleaned = inputStr.trim().toLowerCase().replace(/[.\/\-]/g, ' ');
            const parts = cleaned.split(/\s+/);

            if (parts.length < 2) return null;

            let m, d, y;
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

        formatToISO(dateObj) {
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            return `${dateObj.getFullYear()}-${mm}-${dd}`;
        },

        formatToPresentation(dateObj) {
            const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
            return dateObj.toLocaleDateString('en-GB', options).replace(/,/g, '');
        },

        calculateEndDate(startDateISO, startTimeStr, endTimeStr) {
            if (!startTimeStr || !endTimeStr) return startDateISO;
            const [sHour, sMin] = startTimeStr.split(':').map(Number);
            const [eHour, eMin] = endTimeStr.split(':').map(Number);

            const startMinutes = sHour * 60 + sMin;
            const endMinutes = eHour * 60 + eMin;

            if (endMinutes <= startMinutes) {
                const parts = startDateISO.split('-').map(Number);
                const date = new Date(parts[0], parts[1] - 1, parts[2]);
                date.setDate(date.getDate() + 1);
                return this.formatToISO(date);
            }
            return startDateISO;
        }
    };

    // UI Feedback System
    const Toast = {
        show(message) {
            const toast = ElementBuilder.create('div', { className: 'ra-mc-toast' }, message);
            document.body.appendChild(toast);

            requestAnimationFrame(() => {
                toast.classList.add('is-visible');
                setTimeout(() => {
                    toast.classList.remove('is-visible');
                    setTimeout(() => toast.remove(), 300);
                }, 3000);
            });
        }
    };

    // Premium Grade Modern View Layout Styling
    const Styles = {
        init() {
            if (document.documentElement.dataset.ramcStylesMounted) return;
            document.documentElement.dataset.ramcStylesMounted = 'true';

            const css = `
                .ra-mc-overlay { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.75); display: flex; align-items: center; justify-content: center; z-index: 2147483645 !important; backdrop-filter: blur(8px); opacity: 0; transition: opacity 0.25s ease; pointer-events: auto !important; }
                .ra-mc-overlay.is-visible { opacity: 1; }

                /* Modal Restructuring for Sticky Footer */
                .ra-mc-modal { background: #ffffff; border-radius: 1.25rem; width: clamp(320px, 90vw, 960px); max-height: 90vh; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); transform: translateY(20px) scale(0.98); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; box-sizing: border-box; display: flex; flex-direction: column; pointer-events: auto !important; overflow: hidden; }
                .ra-mc-overlay.is-visible .ra-mc-modal { transform: translateY(0) scale(1); }

                .ra-mc-header { border-bottom: 1px solid #e5e7eb; padding: 2.25rem 2.5rem 1.25rem; flex-shrink: 0; background: #ffffff; }
                .ra-mc-body { padding: 1.5rem 2.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.5rem; flex-grow: 1; outline: none; }
                .ra-mc-footer { border-top: 1px solid #e5e7eb; padding: 1.5rem 2.5rem 2.25rem; background: #ffffff; display: flex; flex-direction: column; gap: 1.25rem; flex-shrink: 0; }

                /* Custom Scrollbar Target Updates */
                .ra-mc-body::-webkit-scrollbar, .ra-mc-textarea::-webkit-scrollbar, .ra-mc-preview::-webkit-scrollbar { width: 8px; }
                .ra-mc-body::-webkit-scrollbar-track, .ra-mc-textarea::-webkit-scrollbar-track, .ra-mc-preview::-webkit-scrollbar-track { background: transparent; }
                .ra-mc-body::-webkit-scrollbar-thumb, .ra-mc-textarea::-webkit-scrollbar-thumb, .ra-mc-preview::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                .ra-mc-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

                .ra-mc-title { margin: 0; font-size: 1.5rem; font-weight: 800; color: #111827; letter-spacing: -0.02em; }
                .ra-mc-row { display: flex; gap: 1.25rem; width: 100%; flex-wrap: wrap; }
                .ra-mc-field { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 0.4rem; }
                .ra-mc-field.full-width { width: 100%; flex: none; }
                .ra-mc-label { font-size: 0.75rem; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 0.1rem; }
                .ra-mc-input, .ra-mc-select, .ra-mc-textarea { width: 100%; padding: 0.8rem 1rem; font-size: 0.95rem; color: #111827; border: 1px solid #d1d5db; border-radius: 0.6rem; background: #f9fafb; box-sizing: border-box; font-family: inherit; transition: all 0.2s ease; line-height: 1.5; }
                .ra-mc-input:hover, .ra-mc-select:hover, .ra-mc-textarea:hover { border-color: #9ca3af; }
                .ra-mc-input:focus, .ra-mc-select:focus, .ra-mc-textarea:focus { outline: none; border-color: #ff4848; background: #ffffff; box-shadow: 0 0 0 3px rgba(255, 72, 72, 0.15); }
                .ra-mc-textarea { height: 100px; resize: vertical; min-height: 80px; }
                .ra-mc-textarea.code-box { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85rem; height: 140px; resize: none; line-height: 28px !important; }
                .ra-mc-split { display: flex; gap: 1.25rem; width: 100%; align-items: stretch; }
                .ra-mc-split > .ra-mc-field { flex: 1; }
                .ra-mc-preview { width: 100%; border: 1px solid #d1d5db; border-radius: 0.6rem; background: #f9fafb; padding: 0.8rem 1rem; height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 0; box-sizing: border-box; }
                .ra-mc-preview-line { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; padding: 0 0.5rem; margin: 0 -0.5rem; height: 28px; min-height: 28px; border-radius: 0.4rem; animation: ra-fade-in 0.2s ease-out; }
                .ra-mc-preview-line:hover { background: rgba(0,0,0,0.03); }
                @keyframes ra-fade-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
                .ra-mc-preview-in { color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; font-family: ui-monospace, SFMono-Regular, monospace; }
                .ra-mc-preview-out { font-weight: 600; text-align: right; padding: 0.15rem 0.6rem; border-radius: 1rem; font-size: 0.75rem; line-height: 1.2; }
                .ra-mc-preview-line.is-valid .ra-mc-preview-out { background: #ecfdf5; color: #059669; }
                .ra-mc-preview-line.is-invalid .ra-mc-preview-out { background: #fef2f2; color: #dc2626; }

                .ra-mc-feedback { font-size: 0.85rem; padding: 0.75rem 1rem; border-radius: 0.5rem; font-weight: 500; display: flex; align-items: center; gap: 0.5rem; transition: all 0.2s ease; }
                .ra-mc-fb-neutral { background: #f9fafb; color: #6b7280; border: 1px solid transparent; }
                .ra-mc-fb-error { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
                .ra-mc-fb-success { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }

                @keyframes ra-mc-shake {
                    0%, 100% { transform: translateX(0); }
                    20%, 60% { transform: translateX(-5px); }
                    40%, 80% { transform: translateX(5px); }
                }
                .ra-mc-shake { animation: ra-mc-shake 0.4s ease; }

                .ra-mc-actions { display: flex; justify-content: flex-end; gap: 0.75rem; align-items: center; width: 100%; }
                .ra-mc-btn { padding: 0.6rem 1.5rem; font-size: 0.9rem; border-radius: 50px; border: 1px solid transparent; cursor: pointer; font-weight: 600; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; height: 42px; outline: none; }
                .ra-mc-btn:active { transform: scale(0.96); }
                .ra-mc-btn-cancel { background: #ffffff; color: #111827; border-color: #d1d5db; }
                .ra-mc-btn-cancel:hover { background: #f9fafb; border-color: #9ca3af; }

                .ra-mc-btn-primary { background: #ff4848; color: #ffffff; box-shadow: 0 4px 6px -1px rgba(255, 72, 72, 0.2); }
                .ra-mc-btn-primary:hover:not(.is-disabled) { background: #e03e3e; box-shadow: 0 6px 8px -1px rgba(255, 72, 72, 0.3); }

                /* Visual disabled state to allow click interception for toasts */
                .ra-mc-btn-primary.is-disabled { background: #f9fafb; color: #9ca3af; border-color: #e5e7eb; cursor: not-allowed; box-shadow: none; }

                .ra-mc-btn-reset { background: transparent; color: #6b7280; padding: 0.6rem 1rem; margin-right: auto; }
                .ra-mc-btn-reset:hover { color: #dc2626; background: #fef2f2; }

                /* Native Button Target Glow & Unified Styling */
                @keyframes ra-mc-trigger-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(255, 72, 72, 0.9), 0 4px 10px rgba(255, 72, 72, 0.6); }
                    70% { box-shadow: 0 0 0 20px rgba(255, 72, 72, 0), 0 4px 15px rgba(255, 72, 72, 0.8); }
                    100% { box-shadow: 0 0 0 0 rgba(255, 72, 72, 0), 0 4px 10px rgba(255, 72, 72, 0.6); }
                }

                a[data-tracking-id*="/pro/event/create"],
                a[href$="/pro/event/create"],
                a[href*="/pro/event/create"] {
                    animation: ra-mc-trigger-pulse 1.5s infinite !important;
                    transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease !important;
                    background-color: rgba(255, 72, 72, 0.08) !important;
                    position: relative !important;
                    z-index: 10 !important;
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    min-width: 160px !important;
                    height: 42px !important;
                    padding: 0 1.5rem !important;
                    box-sizing: border-box !important;
                    text-decoration: none !important;
                    margin: 0 !important;
                    border-radius: 50px !important;
                    font-size: 0 !important;
                    color: transparent !important;
                }

                a[data-tracking-id*="/pro/event/create"] > *,
                a[href$="/pro/event/create"] > *,
                a[href*="/pro/event/create"] > * {
                    display: none !important;
                }

                a[data-tracking-id*="/pro/event/create"]::after,
                a[href$="/pro/event/create"]::after,
                a[href*="/pro/event/create"]::after {
                    content: 'Create Events' !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                    font-size: 14px !important;
                    font-weight: 700 !important;
                    color: #ff4848 !important;
                    letter-spacing: 0.02em !important;
                    transition: color 0.2s ease !important;
                    visibility: visible !important;
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                }

                a[data-tracking-id*="/pro/event/create"]:hover,
                a[href$="/pro/event/create"]:hover,
                a[href*="/pro/event/create"]:hover {
                    animation: none !important;
                    box-shadow: 0 0 20px 4px rgba(255, 72, 72, 0.8) !important;
                    transform: scale(1.05) !important;
                    background-color: #ff4848 !important;
                }

                a[data-tracking-id*="/pro/event/create"]:hover::after,
                a[href$="/pro/event/create"]:hover::after,
                a[href*="/pro/event/create"]:hover::after {
                    color: #ffffff !important;
                }

                /* Toast System */
                .ra-mc-toast { position: fixed; bottom: 2rem; right: 2rem; background: #111827; color: #ffffff; padding: 1rem 1.5rem; border-radius: 0.5rem; font-family: -apple-system, sans-serif; font-size: 0.9rem; font-weight: 500; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); z-index: 2147483647; opacity: 0; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); pointer-events: none; }
                .ra-mc-toast.is-visible { opacity: 1; transform: translateY(0); }
            `;
            if (typeof GM_addStyle !== 'undefined') {
                GM_addStyle(css);
            } else {
                const styleNode = document.createElement('style');
                styleNode.textContent = css;
                (document.head || document.documentElement).appendChild(styleNode);
            }
        }
    };

    // Structural Application Interface Engine
    const UI = {
        requestBulkCreationDates() {
            return new Promise((resolve) => {
                const overlay = ElementBuilder.create('div', { className: 'ra-mc-overlay' });

                // Modal Header
                const header = ElementBuilder.create('div', { className: 'ra-mc-header' },
                    ElementBuilder.create('h3', { className: 'ra-mc-title' }, 'Create Event')
                );

                // Group 1: Event Name & Venue
                const inputName = ElementBuilder.create('input', { type: 'text', className: 'ra-mc-input', value: ModalStateCache.title, placeholder: 'e.g., Underground Transmission' });
                const fieldTitle = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Event Name'), inputName
                );

                const inputVenue = ElementBuilder.create('input', { type: 'text', className: 'ra-mc-input', value: ModalStateCache.venue, placeholder: 'e.g., Mehanata Bar' });
                const fieldVenue = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Venue'), inputVenue
                );
                const rowNameVenue = ElementBuilder.create('div', { className: 'ra-mc-row' }, fieldTitle, fieldVenue);

                // Group 2: Target Dates & Verification
                const textareaDates = ElementBuilder.create('textarea', { className: 'ra-mc-textarea code-box', placeholder: '2026-06-20\nJuly 4\n10/31/2026', wrap: 'off' });
                textareaDates.value = ModalStateCache.dates;
                const fieldDates = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Target Dates (One per line)'), textareaDates
                );

                const panelPreview = ElementBuilder.create('div', { className: 'ra-mc-preview' });
                const fieldPreview = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Date Verification'), panelPreview
                );
                const workspaceSplit = ElementBuilder.create('div', { className: 'ra-mc-split' }, fieldDates, fieldPreview);

                // Group 3: Start and End Times
                const generateTimeOptions = (defaultSel) => {
                    const fragment = document.createDocumentFragment();
                    // Blank, disabled default placeholder option
                    const defaultOpt = ElementBuilder.create('option', { value: '', disabled: 'true' }, '');
                    if (!defaultSel) defaultOpt.selected = true;
                    fragment.appendChild(defaultOpt);

                    for (let h = 0; h < 24; h++) {
                        ['00', '30'].forEach(m => {
                            const timeStr = `${String(h).padStart(2, '0')}:${m}`;
                            const opt = ElementBuilder.create('option', { value: timeStr }, timeStr);
                            if (timeStr === defaultSel) opt.selected = true;
                            fragment.appendChild(opt);
                        });
                    }
                    const finalOpt = ElementBuilder.create('option', { value: '23:59' }, '23:59');
                    if (defaultSel === '23:59') finalOpt.selected = true;
                    fragment.appendChild(finalOpt);
                    return fragment;
                };

                const selectStartTime = ElementBuilder.create('select', { className: 'ra-mc-select' }, generateTimeOptions(ModalStateCache.startTime));
                const selectEndTime = ElementBuilder.create('select', { className: 'ra-mc-select' }, generateTimeOptions(ModalStateCache.endTime));

                const fieldStartTime = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Start Time'), selectStartTime
                );
                const fieldEndTime = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'End Time'), selectEndTime
                );
                const rowTimes = ElementBuilder.create('div', { className: 'ra-mc-row' }, fieldStartTime, fieldEndTime);

                // Group 4: Description
                const textareaDesc = ElementBuilder.create('textarea', { className: 'ra-mc-textarea', placeholder: 'Enter event description paragraphs here...' });
                textareaDesc.value = ModalStateCache.description;
                const fieldDescription = ElementBuilder.create('div', { className: 'ra-mc-field full-width' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Event Description'), textareaDesc
                );

                // Group 5: Available Tickets and Price
                const inputAllocation = ElementBuilder.create('input', { type: 'number', className: 'ra-mc-input', value: ModalStateCache.allocation, placeholder: 'e.g. 100', min: '1' });
                const fieldAllocation = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Available Tickets'), inputAllocation
                );
                const inputPrice = ElementBuilder.create('input', { type: 'number', className: 'ra-mc-input', value: ModalStateCache.price, placeholder: 'e.g. 25', min: '0' });
                const fieldPrice = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Price (USD)'), inputPrice
                );
                const rowTicketsInfo = ElementBuilder.create('div', { className: 'ra-mc-row' }, fieldAllocation, fieldPrice);

                // Group 6: YouTube Link (Optional)
                const inputYoutube = ElementBuilder.create('input', { type: 'text', className: 'ra-mc-input', value: ModalStateCache.youtube, placeholder: 'https://youtu.be/xxxxxxxxxxx' });
                const fieldYoutube = ElementBuilder.create('div', { className: 'ra-mc-field full-width' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'YouTube Link (Optional)'), inputYoutube
                );

                // Construct Scrollable Body
                const modalBody = ElementBuilder.create('div', { className: 'ra-mc-body', tabindex: "-1" },
                    rowNameVenue,
                    workspaceSplit,
                    rowTimes,
                    fieldDescription,
                    rowTicketsInfo,
                    fieldYoutube
                );

                // Construct Sticky Footer
                const feedbackBar = ElementBuilder.create('div', { className: 'ra-mc-feedback ra-mc-fb-neutral' }, 'Awaiting configuration variables...');
                const btnReset = ElementBuilder.create('button', { type: 'button', className: 'ra-mc-btn ra-mc-btn-reset' }, 'Reset Fields');
                const btnCancel = ElementBuilder.create('button', { type: 'button', className: 'ra-mc-btn ra-mc-btn-cancel' }, 'Cancel');
                const btnConfirm = ElementBuilder.create('button', { type: 'button', className: 'ra-mc-btn ra-mc-btn-primary is-disabled' }, 'Create');
                const rowActions = ElementBuilder.create('div', { className: 'ra-mc-actions' }, btnReset, btnCancel, btnConfirm);
                const modalFooter = ElementBuilder.create('div', { className: 'ra-mc-footer' }, feedbackBar, rowActions);

                // Construct Main Modal
                const modal = ElementBuilder.create('div', { className: 'ra-mc-modal' },
                    header,
                    modalBody,
                    modalFooter
                );

                function handleConfirmAction(dataPayload) {
                    if (dataPayload) {
                        ModalStateCache.flush();
                        dataPayload.sort((a, b) => b.timestamp - a.timestamp);
                        tearDown();
                        resolve(dataPayload);
                    }
                }

                // Shake animation trigger for validation failure
                function triggerFeedbackShake() {
                    feedbackBar.classList.remove('ra-mc-shake');
                    void feedbackBar.offsetWidth; // Force reflow
                    feedbackBar.classList.add('ra-mc-shake');
                    Toast.show('Please fill all required fields before creating.');
                }

                // Global Ctrl+Enter Listener inside the modal body
                modalBody.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        if (btnConfirm.classList.contains('is-disabled')) {
                            triggerFeedbackShake();
                        } else {
                            const dataPayload = liveValidate();
                            if (dataPayload) handleConfirmAction(dataPayload);
                        }
                    }
                });

                // Synchronize scrolling between the input area and output preview
                let isSyncingLeft = false;
                let isSyncingRight = false;
                textareaDates.addEventListener('scroll', () => {
                    if (!isSyncingLeft) {
                        isSyncingRight = true;
                        panelPreview.scrollTop = textareaDates.scrollTop;
                    }
                    isSyncingLeft = false;
                });

                panelPreview.addEventListener('scroll', () => {
                    if (!isSyncingRight) {
                        isSyncingLeft = true;
                        textareaDates.scrollTop = panelPreview.scrollTop;
                    }
                    isSyncingRight = false;
                });

                const liveValidate = () => {
                    panelPreview.textContent = '';
                    ModalStateCache.title = inputName.value;
                    ModalStateCache.venue = inputVenue.value;
                    ModalStateCache.youtube = inputYoutube.value;
                    ModalStateCache.allocation = inputAllocation.value;
                    ModalStateCache.price = inputPrice.value;
                    ModalStateCache.description = textareaDesc.value;
                    ModalStateCache.dates = textareaDates.value;
                    ModalStateCache.startTime = selectStartTime.value;
                    ModalStateCache.endTime = selectEndTime.value;

                    const titleVal = ModalStateCache.title.trim();
                    const venueVal = ModalStateCache.venue.trim();
                    const allocVal = ModalStateCache.allocation.trim();
                    const priceVal = ModalStateCache.price.trim();
                    const descVal = ModalStateCache.description.trim();

                    const rawLines = ModalStateCache.dates.split('\n');
                    const activeLines = rawLines.filter(l => l.trim());

                    const fallbackYear = DateEngine.getNYToday().getFullYear();
                    const validatedPairs = [];
                    let dateErrorStatus = false;
                    let dateLimitExceeded = activeLines.length > CONFIG.MAX_CREATION_LIMIT;

                    // Evaluate and build dates independent of the overall form completion state
                    rawLines.forEach(line => {
                        const trimmed = line.trim();

                        if (!trimmed) {
                            const spacer = ElementBuilder.create('div', { className: 'ra-mc-preview-line' });
                            panelPreview.appendChild(spacer);
                            return;
                        }

                        const dateObj = DateEngine.parseFlexibleDate(trimmed, fallbackYear);
                        const rowWrapper = ElementBuilder.create('div', { className: 'ra-mc-preview-line' },
                            ElementBuilder.create('span', { className: 'ra-mc-preview-in' }, trimmed)
                        );
                        const outputSpan = ElementBuilder.create('span', { className: 'ra-mc-preview-out' });

                        if (!dateObj) {
                            rowWrapper.classList.add('is-invalid');
                            outputSpan.textContent = 'Invalid Format';
                            dateErrorStatus = true;
                        } else if (dateObj < DateEngine.getNYToday()) {
                            rowWrapper.classList.add('is-invalid');
                            outputSpan.textContent = 'Past Date';
                            dateErrorStatus = true;
                        } else {
                            rowWrapper.classList.add('is-valid');
                            outputSpan.textContent = DateEngine.formatToISO(dateObj);

                            const sdateISO = DateEngine.formatToISO(dateObj);
                            const edateISO = DateEngine.calculateEndDate(sdateISO, ModalStateCache.startTime, ModalStateCache.endTime);
                            const cleanSanitizedDescription = ModalStateCache.description.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');

                            validatedPairs.push({
                                title: titleVal,
                                venue: venueVal,
                                description: cleanSanitizedDescription,
                                allocation: allocVal,
                                price: priceVal,
                                startDate: sdateISO,
                                startTime: ModalStateCache.startTime,
                                endDate: edateISO,
                                endTime: ModalStateCache.endTime,
                                youtube: ModalStateCache.youtube.trim(),
                                timestamp: dateObj.getTime()
                            });
                        }
                        rowWrapper.appendChild(outputSpan);
                        panelPreview.appendChild(rowWrapper);
                    });

                    // Evaluate holistic form requirements after date mapping is complete
                    const isFormFilled = titleVal && venueVal && allocVal && priceVal && descVal && ModalStateCache.startTime && ModalStateCache.endTime;

                    if (activeLines.length === 0) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-neutral';
                        feedbackBar.textContent = isFormFilled ? 'Enter target dates to begin verification...' : 'Please fill all required fields and enter target dates.';
                        btnConfirm.classList.add('is-disabled');
                        return null;
                    }

                    if (dateLimitExceeded) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-error';
                        feedbackBar.textContent = `Maximum limit exceeded (${CONFIG.MAX_CREATION_LIMIT} instances allowed).`;
                        btnConfirm.classList.add('is-disabled');
                        return null;
                    }

                    if (dateErrorStatus) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-error';
                        feedbackBar.textContent = 'Resolve date compilation errors before executing.';
                        btnConfirm.classList.add('is-disabled');
                        return null;
                    }

                    if (!isFormFilled) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-neutral';
                        feedbackBar.textContent = 'Dates verified. Please fill the remaining required fields to continue.';
                        btnConfirm.classList.add('is-disabled');
                        return null;
                    }

                    feedbackBar.className = 'ra-mc-feedback ra-mc-fb-success';
                    feedbackBar.textContent = `Verified ${validatedPairs.length} profiles. Ready to launch.`;
                    btnConfirm.classList.remove('is-disabled');
                    return validatedPairs;
                };

                const tearDown = () => {
                    overlay.classList.remove('is-visible');
                    setTimeout(() => overlay.remove(), 250);
                };

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                liveValidate();

                inputName.addEventListener('input', liveValidate);
                inputVenue.addEventListener('input', liveValidate);
                inputYoutube.addEventListener('input', liveValidate);
                inputAllocation.addEventListener('input', liveValidate);
                inputPrice.addEventListener('input', liveValidate);
                textareaDesc.addEventListener('input', liveValidate);
                selectStartTime.addEventListener('change', liveValidate);
                selectEndTime.addEventListener('change', liveValidate);
                textareaDates.addEventListener('input', liveValidate);

                btnReset.addEventListener('click', () => {
                    ModalStateCache.flush();
                    inputName.value = '';
                    inputVenue.value = '';
                    inputYoutube.value = '';
                    inputAllocation.value = '';
                    inputPrice.value = '';
                    textareaDesc.value = '';
                    textareaDates.value = '';
                    selectStartTime.value = '';
                    selectEndTime.value = '';
                    liveValidate();
                    inputName.focus();
                });

                overlay.addEventListener('mousedown', (e) => {
                    if (e.target === overlay) {
                        tearDown();
                        resolve(null);
                    }
                });

                btnCancel.addEventListener('click', () => { tearDown(); resolve(null); });

                btnConfirm.addEventListener('click', (e) => {
                    if (btnConfirm.classList.contains('is-disabled')) {
                        e.preventDefault();
                        triggerFeedbackShake();
                        return;
                    }
                    const dataPayload = liveValidate();
                    handleConfirmAction(dataPayload);
                });

                requestAnimationFrame(() => {
                    overlay.classList.add('is-visible');
                    setTimeout(() => {
                        if (!inputName.value) {
                            inputName.focus();
                        }
                    }, 220);
                });
            });
        }
    };

    // Parallel Background Workspace Engine
    const TabEngine = {
        async deployExecutionBatches(payloadList) {
            if (typeof GM_openInTab === 'undefined') {
                alert('Permissions Error: Userscript configuration manager prevents execution context of GM_openInTab.');
                return;
            }

            if (payloadList.length > 0) {
                try {
                    GM_setValue(CONFIG.STORAGE_KEY_DESC, payloadList[0].description);
                } catch (e) {
                    Logger.error('Unable to map payload to local origin storage boundaries.', e);
                }
            }

            for (let i = 0; i < payloadList.length; i++) {
                const item = payloadList[i];
                const params = new URLSearchParams();

                params.set(CONFIG.KEYS.TITLE, item.title);
                params.set(CONFIG.KEYS.VENUE, item.venue);
                params.set(CONFIG.KEYS.START_DATE, item.startDate);
                params.set(CONFIG.KEYS.START_TIME, item.startTime);
                params.set(CONFIG.KEYS.END_DATE, item.endDate);
                params.set(CONFIG.KEYS.END_TIME, item.endTime);
                params.set(CONFIG.KEYS.YOUTUBE, item.youtube);

                if (item.allocation) params.set(CONFIG.KEYS.ALLOCATION, item.allocation);
                if (item.price) params.set(CONFIG.KEYS.PRICE, item.price);

                const generationUrl = `https://ra.co/pro/event/create?${params.toString()}`;
                Logger.log(`Spawning execution tab canvas profile for: ${item.startDate}`);
                GM_openInTab(generationUrl, { active: false, insert: true, setParent: true });

                if (i < payloadList.length - 1) {
                    await new Promise(r => setTimeout(r, CONFIG.SPAWN_DELAY_MS));
                }
            }
        }
    };

    // Framework Hydration Engine
    const FormInjector = {
        sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

        async forceValueForReactInput(inputElement, rawValue) {
            if (!inputElement) return;
            inputElement.focus();
            await this.sleep(50);

            const elementPrototype = inputElement.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeSetterDescriptor = Object.getOwnPropertyDescriptor(elementPrototype, 'value');

            if (nativeSetterDescriptor && nativeSetterDescriptor.set) {
                nativeSetterDescriptor.set.call(inputElement, rawValue);
            } else {
                inputElement.value = rawValue;
            }

            // Safety Harness: Thorough event dispatching required for React's synthetic bindings
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
            inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
            await this.sleep(50);
            inputElement.blur();
        },

        async forceValueForReactSelect(selectElement, targetValue) {
            if (!selectElement) return;
            selectElement.focus();

            selectElement.value = targetValue;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            selectElement.dispatchEvent(new Event('blur', { bubbles: true }));
            await this.sleep(50);
        },

        async executeHydrationSequence(directPackage = null) {
            let dataPackage = directPackage;

            if (!dataPackage) {
                const urlParams = new URLSearchParams(window.location.search);
                if (!urlParams.has(CONFIG.KEYS.TITLE)) return;

                Logger.log('Valid automation pipeline parameter signatures located inside active URL layout.');
                TabRuntimeCache.isActiveAutomation = true;

                dataPackage = {
                    title: urlParams.get(CONFIG.KEYS.TITLE),
                    venue: urlParams.get(CONFIG.KEYS.VENUE) || '',
                    sdate: urlParams.get(CONFIG.KEYS.START_DATE),
                    stime: urlParams.get(CONFIG.KEYS.START_TIME),
                    edate: urlParams.get(CONFIG.KEYS.END_DATE),
                    etime: urlParams.get(CONFIG.KEYS.END_TIME),
                    youtube: urlParams.get(CONFIG.KEYS.YOUTUBE) || '',
                    allocation: urlParams.get(CONFIG.KEYS.ALLOCATION) || '',
                    price: urlParams.get(CONFIG.KEYS.PRICE) || ''
                };

                TabRuntimeCache.youtubeLink = dataPackage.youtube;
                if (dataPackage.allocation && dataPackage.price) {
                    sessionStorage.setItem(CONFIG.SESSION_KEY_ALLOC, dataPackage.allocation);
                    sessionStorage.setItem(CONFIG.SESSION_KEY_PRICE, dataPackage.price);
                }

                window.history.replaceState(null, '', window.location.pathname);
            } else {
                TabRuntimeCache.isActiveAutomation = true;
                TabRuntimeCache.youtubeLink = dataPackage.youtube;

                if (dataPackage.allocation && dataPackage.price) {
                    sessionStorage.setItem(CONFIG.SESSION_KEY_ALLOC, dataPackage.allocation);
                    sessionStorage.setItem(CONFIG.SESSION_KEY_PRICE, dataPackage.price);
                }
            }

            let pollingAttempts = 0;
            const checkAndInject = setInterval(async () => {
                const inputTitle = document.getElementById('title');
                const nativeDatePickers = document.querySelectorAll('input[data-testid="hidden-native-date-input"]');
                const selectStartTime = document.getElementById('startTime');
                const selectEndTime = document.getElementById('endTime');
                const inputVenueSearch = document.getElementById('venueId-input');

                if (inputTitle && nativeDatePickers.length >= 2 && selectStartTime && selectEndTime && inputVenueSearch) {
                    clearInterval(checkAndInject);
                    Logger.log('React DOM form nodes compiled fully. Commencing framework injection routines.');

                    await this.sleep(CONFIG.INJECTION_DELAY_MS);

                    await this.forceValueForReactInput(inputTitle, dataPackage.title);

                    const hiddenOriginalSDate = nativeDatePickers[0];
                    await this.forceValueForReactInput(hiddenOriginalSDate, dataPackage.sdate);
                    const customSDatePresentation = hiddenOriginalSDate.closest('.SelectDate__Container-sc-1kjd8zz-1, .Box-sc-1mwsjw2-0')?.querySelector('input[name="startDate"]');
                    if (customSDatePresentation) {
                        const parsedObj = new Date(dataPackage.sdate + 'T00:00:00');
                        customSDatePresentation.value = DateEngine.formatToPresentation(parsedObj);
                    }

                    await this.forceValueForReactSelect(selectStartTime, dataPackage.stime);

                    const hiddenOriginalEDate = nativeDatePickers[1];
                    await this.forceValueForReactInput(hiddenOriginalEDate, dataPackage.edate);

                    const customEDatePresentation = hiddenOriginalEDate.closest('.SelectDate__Container-sc-1kjd8zz-1, .Box-sc-1mwsjw2-0')?.querySelector('input[name="endDate"]');
                    if (customEDatePresentation) {
                        const parsedObj = new Date(dataPackage.edate + 'T00:00:00');
                        customEDatePresentation.value = DateEngine.formatToPresentation(parsedObj);
                    }

                    await this.forceValueForReactSelect(selectEndTime, dataPackage.etime);

                    if (dataPackage.venue) {
                        await this.forceValueForReactInput(inputVenueSearch, dataPackage.venue);
                    }

                    inputTitle.dispatchEvent(new Event('keyup', { bubbles: true }));
                    Logger.log('Framework injection pipeline verified completely initialized.');
                }

                pollingAttempts++;
                if (pollingAttempts > (CONFIG.POLL_TIMEOUT_MS / 100)) {
                    clearInterval(checkAndInject);
                    Logger.error('Execution context timeout: Unable to map required reactive Formik nodes before boundary cutoff.');
                }
            }, 100);
        },

        monitorLineupStepHydration() {
            setInterval(async () => {
                if (!TabRuntimeCache.isActiveAutomation) return;

                const tagifyEditableSpan = document.getElementById('lineup-tagify-input');
                const nativeFormTextarea = document.querySelector('textarea[name="lineup"]');

                if (tagifyEditableSpan && nativeFormTextarea && !tagifyEditableSpan.dataset.ramcLineupProcessed) {
                    tagifyEditableSpan.dataset.ramcLineupProcessed = "true";
                    Logger.log('Step 2 Lineup nodes detected. Commencing default value pre-fill.');

                    await this.sleep(CONFIG.INJECTION_DELAY_MS);

                    tagifyEditableSpan.focus();
                    tagifyEditableSpan.textContent = CONFIG.DEFAULT_LINEUP;

                    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                    nativeValueSetter.call(nativeFormTextarea, CONFIG.DEFAULT_LINEUP);

                    tagifyEditableSpan.dispatchEvent(new Event('input', { bubbles: true }));
                    nativeFormTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                    nativeFormTextarea.dispatchEvent(new Event('change', { bubbles: true }));

                    await this.sleep(50);
                    tagifyEditableSpan.blur();
                    Logger.log('Default Lineup pre-fill completed smoothly.');
                }
            }, 250);
        },

        monitorDetailsStepHydration() {
            setInterval(async () => {
                if (!TabRuntimeCache.isActiveAutomation) return;

                const textareaDetailsContent = document.getElementById('content');

                if (textareaDetailsContent && !textareaDetailsContent.dataset.ramcDetailsProcessed) {
                    const sharedDescriptionMemory = GM_getValue(CONFIG.STORAGE_KEY_DESC, '');
                    if (!sharedDescriptionMemory) return;

                    textareaDetailsContent.dataset.ramcDetailsProcessed = "true";
                    Logger.log('Step 3 Details Description node detected. Initiating framework hydration routines.');

                    await this.sleep(CONFIG.INJECTION_DELAY_MS);

                    await this.forceValueForReactInput(textareaDetailsContent, sharedDescriptionMemory);
                    textareaDetailsContent.dispatchEvent(new Event('keyup', { bubbles: true }));
                    textareaDetailsContent.dispatchEvent(new Event('blur', { bubbles: true }));

                    Logger.log('Event Description pre-fill completed successfully.');
                }
            }, 250);
        },

        monitorPromotionalStepHydration() {
            setInterval(async () => {
                if (!TabRuntimeCache.isActiveAutomation) return;

                const inputPromoter = document.getElementById('promoterIds.0-input');
                const inputMedia = document.getElementById('playerLinks.0.sourceId');

                if ((inputPromoter || inputMedia) && !document.documentElement.dataset.ramcPromotionalProcessed) {
                    document.documentElement.dataset.ramcPromotionalProcessed = "true";
                    Logger.log('Step 4 Promotional view nodes loaded. Initializing field injections.');

                    await this.sleep(CONFIG.INJECTION_DELAY_MS);

                    if (inputPromoter) {
                        await this.forceValueForReactInput(inputPromoter, CONFIG.DEFAULT_PROMOTER);
                    }

                    if (inputMedia && TabRuntimeCache.youtubeLink) {
                        await this.forceValueForReactInput(inputMedia, TabRuntimeCache.youtubeLink);
                    }

                    Logger.log('Step 4 pre-fill parameters complete.');
                }

                if (!inputPromoter && !inputMedia && document.documentElement.dataset.ramcPromotionalProcessed) {
                    document.documentElement.removeAttribute('data-ramc-promotional-processed');
                }
            }, 250);
        }
    };

    // Subsystem for post-creation Ticket Event Pipeline
    const TicketManager = {
        isRunning: false,

        monitorNavigation() {
            setInterval(async () => {
                if (this.isRunning) return;

                if (window.location.pathname.match(/\/pro\/events\/\d+\/tickets\/management/)) {
                    const alloc = sessionStorage.getItem(CONFIG.SESSION_KEY_ALLOC);
                    const price = sessionStorage.getItem(CONFIG.SESSION_KEY_PRICE);

                    if (alloc && price) {
                        this.isRunning = true;
                        Logger.log('Ticket management portal detected. Launching ticket automation payload.');

                        // Clear to prevent endless loops on manual refreshes
                        sessionStorage.removeItem(CONFIG.SESSION_KEY_ALLOC);
                        sessionStorage.removeItem(CONFIG.SESSION_KEY_PRICE);

                        await this.executeTicketCreation(alloc, price);
                        this.isRunning = false;
                    }
                }
            }, 500);
        },

        waitForElement(selector, textMatch = null, exactMatch = false, requireEnabled = false, timeout = 20000) {
            return new Promise(resolve => {
                const check = () => {
                    const elements = Array.from(document.querySelectorAll(selector));
                    const found = elements.find(el => {
                        if (textMatch) {
                            const rawText = el.innerText || el.textContent || '';
                            const txt = rawText.replace(/\s+/g, ' ').trim().toLowerCase();
                            const searchTxt = textMatch.toLowerCase();

                            if (exactMatch && txt !== searchTxt) return false;
                            if (!exactMatch && !txt.includes(searchTxt)) return false;
                        }
                        if (requireEnabled && (el.disabled || el.getAttribute('aria-disabled') === 'true')) return false;
                        return true;
                    });

                    if (found) resolve(found);
                    else setTimeout(check, 250);
                };
                check();
                setTimeout(() => resolve(null), timeout);
            });
        },

        waitForDisappearance(selector, timeout = 10000) {
            return new Promise(resolve => {
                const check = () => {
                    if (!document.querySelector(selector)) resolve(true);
                    else setTimeout(check, 250);
                };
                check();
                setTimeout(() => resolve(false), timeout);
            });
        },

        async executeTicketCreation(allocation, price, attempt = 1) {
            try {
                Logger.log(`Initializing Ticket Creation payload (Attempt ${attempt}/2)...`);
                await FormInjector.sleep(1500);

                // 1. Locate and engage "Add Ticket" interaction
                const addTicketBtn = await this.waitForElement('button', 'Add ticket', false, true);
                if (!addTicketBtn) {
                    throw new Error('Timeout locating "Add Ticket" hook. Slide-in interaction unavailable.');
                }

                Logger.log('Add Ticket button located. Engaging...');
                addTicketBtn.click();

                // 2. Wait for Slide-in Modal render
                await FormInjector.sleep(800);
                const inputAlloc = await this.waitForElement('input#allocation');
                const inputPrice = await this.waitForElement('input#revenuePerTicket');

                if (!inputAlloc || !inputPrice) {
                    throw new Error('Timeout compiling ticket form geometry. Slide-in modal failed to load.');
                }

                // 3. Hydrate Ticket Details
                Logger.log('Ticket modal loaded. Hydrating parameters...');
                await FormInjector.forceValueForReactInput(inputAlloc, allocation);
                await FormInjector.forceValueForReactInput(inputPrice, price);

                // 4. Force React State Flush
                inputAlloc.blur();
                inputPrice.blur();

                const modalHeading = await this.waitForElement('h2', 'Add ticket');
                if (modalHeading) {
                    modalHeading.click();
                } else {
                    document.body.click();
                }
                await FormInjector.sleep(500);

                // 5. Submit Transaction
                let saveBtn = await this.waitForElement('button', 'Save', true, true, 8000);
                if (!saveBtn) {
                    Logger.log('Safety Harness: Forcing React re-render to activate Save button...');
                    await FormInjector.forceValueForReactInput(inputPrice, price); // Re-firing inject
                    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

                    saveBtn = await this.waitForElement('button', 'Save', true, true, 8000);
                    if (!saveBtn) throw new Error('Save button remains stubbornly disabled after secondary safety flush.');
                }

                Logger.log('Form validated. Submitting transaction...');
                saveBtn.click();

                // 6. Wait for Modal Collapse
                await this.waitForDisappearance('input#allocation');
                Logger.log('Ticket successfully logged.');

                // 7. Extract Clean URL and Copy to Clipboard
                await FormInjector.sleep(1500);
                const cleanUrl = window.location.origin + window.location.pathname;
                if (typeof GM_setClipboard !== 'undefined') {
                    GM_setClipboard(cleanUrl);
                } else {
                    await navigator.clipboard.writeText(cleanUrl);
                }
                Toast.show('Event link copied to clipboard');

            } catch (err) {
                Logger.error(`Ticket creation pipeline interrupted.`, err);
                if (attempt < 2) {
                    Logger.log('Safety Harness: Reloading pipeline and initiating failover retry...');
                    await FormInjector.sleep(2000);
                    return this.executeTicketCreation(allocation, price, attempt + 1);
                } else {
                    Toast.show('Automation halted: Could not complete ticket creation process.');
                }
            }
        }
    };

    // System Orchestration Lifecycle Layer
    const WorkflowEngine = {
        async invokeModalWorkflow() {
            Styles.init();
            const operationalBatch = await UI.requestBulkCreationDates();

            if (operationalBatch && operationalBatch.length > 0) {
                if (window.location.pathname.endsWith('/pro/event/create')) {
                    const activeTabSlice = operationalBatch.pop();
                    try {
                        GM_setValue(CONFIG.STORAGE_KEY_DESC, activeTabSlice.description);
                    } catch (e) {
                        Logger.error('Storage buffer assignment failure.', e);
                    }

                    if (operationalBatch.length > 0) {
                        TabEngine.deployExecutionBatches(operationalBatch);
                    }
                    FormInjector.executeHydrationSequence(activeTabSlice);

                } else {
                    TabEngine.deployExecutionBatches(operationalBatch);
                }
            }
        },

        async handleDirectCreationPageIntercept() {
            if (window.location.pathname.endsWith('/pro/event/create') && !new URLSearchParams(window.location.search).has(CONFIG.KEYS.TITLE)) {
                Logger.log('Direct creation route identified without query attributes. Forcing local invocation layer.');
                this.invokeModalWorkflow();
            }
        },

        async handleDashboardClicks(event) {
            if (!event.isTrusted) return;

            let trueTarget = event.composedPath ? event.composedPath()[0] : event.target;

            if (trueTarget && trueTarget.nodeType === Node.TEXT_NODE) {
                trueTarget = trueTarget.parentElement;
            }

            if (!trueTarget || typeof trueTarget.closest !== 'function') return;

            const triggerAnchor = trueTarget.closest(
                'a[data-tracking-id*="/pro/event/create"], ' +
                'a[href$="/pro/event/create"], ' +
                'a[href*="/pro/event/create"]'
            );

            if (!triggerAnchor) return;

            const hrefAttr = triggerAnchor.getAttribute('href') || '';
            if (hrefAttr && !hrefAttr.includes('/pro/event/create')) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            Logger.log('Intercepted dashboard event creation pipeline request.');

            if (window !== window.top) {
                Logger.log('Iframe execution detected. Forwarding activation hook to parent workspace.');
                window.parent.postMessage('RAMC_TRIGGER_MODAL', '*');
            } else {
                this.invokeModalWorkflow();
            }
        }
    };

    const AppLifecycle = {
        initEarlyHooks() {
            window.addEventListener('message', (event) => {
                if (event.data === 'RAMC_TRIGGER_MODAL' && window === window.top) {
                    WorkflowEngine.invokeModalWorkflow();
                }
            });
            document.addEventListener('click', (e) => WorkflowEngine.handleDashboardClicks(e), true);
        },
        initDelayedModules() {
            Styles.init();
            WorkflowEngine.handleDirectCreationPageIntercept();
            FormInjector.executeHydrationSequence();
            FormInjector.monitorLineupStepHydration();
            FormInjector.monitorDetailsStepHydration();
            FormInjector.monitorPromotionalStepHydration();
            TicketManager.monitorNavigation();
        }
    };

    AppLifecycle.initEarlyHooks();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppLifecycle.initDelayedModules());
    } else {
        AppLifecycle.initDelayedModules();
    }
})();
