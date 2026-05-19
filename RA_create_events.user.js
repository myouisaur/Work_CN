// ==UserScript==
// @name         [RA] Create Events
// @namespace    https://github.com/myouisaur/UserScript-Collection
// @icon         https://ra.co/static/favicon.svg
// @version      2.4
// @description  Allows bulk creation of multiple events simultaneously.
// @author       Xiv
// @match        *://*.ra.co/pro*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://myouisaur.github.io/Work_CN/RA_create_events.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA_create_events.user.js
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
        POLL_TIMEOUT_MS: 10000,
        DEFAULT_LINEUP: 'TBA',
        DEFAULT_PROMOTER: 'iBoatNYC',
        STORAGE_KEY_DESC: 'ramc_shared_description_payload',
        KEYS: {
            TITLE: 'ramc_title',
            START_DATE: 'ramc_sdate',
            START_TIME: 'ramc_stime',
            END_DATE: 'ramc_edate',
            END_TIME: 'ramc_etime',
            VENUE: 'ramc_venue',
            YOUTUBE: 'ramc_youtube'
        }
    };

    // Persistent Internal Memory Cache State Machine
    const ModalStateCache = {
        title: '',
        venue: '',
        youtube: '',
        description: '',
        dates: '',
        startTime: '23:00',
        endTime: '06:00',

        flush() {
            this.title = '';
            this.venue = '';
            this.youtube = '';
            this.description = '';
            this.dates = '';
            this.startTime = '23:00';
            this.endTime = '06:00';
        }
    };

    // Immutable Operational State Container for Active Tab Lifecycle Runtime
    const TabRuntimeCache = {
        youtubeLink: ''
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

    // Premium Grade Modern View Layout Styling
    const Styles = {
        init() {
            if (document.documentElement.dataset.ramcStylesMounted) return;
            document.documentElement.dataset.ramcStylesMounted = 'true';

            const css = `
                .ra-mc-overlay { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.75); display: flex; align-items: center; justify-content: center; z-index: 2147483645 !important; backdrop-filter: blur(8px); opacity: 0; transition: opacity 0.25s ease; pointer-events: auto !important; }
                .ra-mc-overlay.is-visible { opacity: 1; }
                .ra-mc-modal { background: #ffffff; padding: 2.25rem 2.5rem; border-radius: 1.25rem; width: clamp(320px, 90vw, 860px); max-height: 90vh; overflow-y: auto; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); transform: translateY(20px) scale(0.98); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.5rem; pointer-events: auto !important; }
                .ra-mc-overlay.is-visible .ra-mc-modal { transform: translateY(0) scale(1); }
                .ra-mc-modal::-webkit-scrollbar, .ra-mc-textarea::-webkit-scrollbar, .ra-mc-preview::-webkit-scrollbar { width: 8px; }
                .ra-mc-modal::-webkit-scrollbar-track, .ra-mc-textarea::-webkit-scrollbar-track, .ra-mc-preview::-webkit-scrollbar-track { background: transparent; }
                .ra-mc-modal::-webkit-scrollbar-thumb, .ra-mc-textarea::-webkit-scrollbar-thumb, .ra-mc-preview::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                .ra-mc-modal::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .ra-mc-header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1rem; }
                .ra-mc-title { margin: 0; font-size: 1.5rem; font-weight: 800; color: #111827; letter-spacing: -0.02em; }
                .ra-mc-row { display: flex; gap: 1.25rem; width: 100%; flex-wrap: wrap; }
                .ra-mc-field { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 0.4rem; }
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
                .ra-mc-actions { display: flex; justify-content: flex-end; gap: 0.75rem; border-top: 1px solid #e5e7eb; padding-top: 1.5rem; align-items: center; }
                .ra-mc-btn { padding: 0.6rem 1.5rem; font-size: 0.9rem; border-radius: 50px; border: 1px solid transparent; cursor: pointer; font-weight: 600; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; height: 42px; }
                .ra-mc-btn:active { transform: scale(0.96); }
                .ra-mc-btn-cancel { background: #ffffff; color: #111827; border-color: #d1d5db; }
                .ra-mc-btn-cancel:hover { background: #f9fafb; border-color: #9ca3af; }
                .ra-mc-btn-primary { background: #ff4848; color: #ffffff; box-shadow: 0 4px 6px -1px rgba(255, 72, 72, 0.2); }
                .ra-mc-btn-primary:hover:not(:disabled) { background: #e03e3e; box-shadow: 0 6px 8px -1px rgba(255, 72, 72, 0.3); }
                .ra-mc-btn-primary:disabled { background: #f9fafb; color: #9ca3af; border-color: #e5e7eb; cursor: not-allowed; box-shadow: none; }
                .ra-mc-btn-reset { background: transparent; color: #6b7280; padding: 0.6rem 1rem; margin-right: auto; }
                .ra-mc-btn-reset:hover { color: #dc2626; background: #fef2f2; }
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

                const header = ElementBuilder.create('div', { className: 'ra-mc-header' },
                    ElementBuilder.create('h3', { className: 'ra-mc-title' }, 'Create Event')
                );

                const inputName = ElementBuilder.create('input', { type: 'text', className: 'ra-mc-input', value: ModalStateCache.title, placeholder: 'e.g., Underground Transmission Party' });
                const fieldTitle = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Event Name'), inputName
                );

                const inputVenue = ElementBuilder.create('input', { type: 'text', className: 'ra-mc-input', value: ModalStateCache.venue, placeholder: 'e.g., Mehanata Bar' });
                const fieldVenue = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Venue'), inputVenue
                );

                const inputYoutube = ElementBuilder.create('input', { type: 'text', className: 'ra-mc-input', value: ModalStateCache.youtube, placeholder: 'https://youtube.com/watch?v=...' });
                const fieldYoutube = ElementBuilder.create('div', { className: 'ra-mc-field' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'YouTube'), inputYoutube
                );

                const rowSharedInfo = ElementBuilder.create('div', { className: 'ra-mc-row' }, fieldTitle, fieldVenue, fieldYoutube);

                const generateTimeOptions = (defaultSel) => {
                    const fragment = document.createDocumentFragment();
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

                const textareaDesc = ElementBuilder.create('textarea', { className: 'ra-mc-textarea', placeholder: 'Enter event description paragraphs here...' });
                textareaDesc.value = ModalStateCache.description;
                const fieldDescription = ElementBuilder.create('div', { className: 'ra-mc-field full-width' },
                    ElementBuilder.create('label', { className: 'ra-mc-label' }, 'Event Description'), textareaDesc
                );

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

                const feedbackBar = ElementBuilder.create('div', { className: 'ra-mc-feedback ra-mc-fb-neutral' }, 'Awaiting configuration variables...');

                const btnReset = ElementBuilder.create('button', { type: 'button', className: 'ra-mc-btn ra-mc-btn-reset' }, 'Reset Fields');
                const btnCancel = ElementBuilder.create('button', { type: 'button', className: 'ra-mc-btn ra-mc-btn-cancel' }, 'Cancel');
                const btnConfirm = ElementBuilder.create('button', { type: 'button', className: 'ra-mc-btn ra-mc-btn-primary', disabled: true }, 'Create Events');

                const rowActions = ElementBuilder.create('div', { className: 'ra-mc-actions' }, btnReset, btnCancel, btnConfirm);

                const modal = ElementBuilder.create('div', { className: 'ra-mc-modal' },
                    header, rowSharedInfo, rowTimes, fieldDescription, workspaceSplit, feedbackBar, rowActions
                );

                function handleConfirmAction(dataPayload) {
                    if (dataPayload) {
                        ModalStateCache.flush();
                        dataPayload.sort((a, b) => b.timestamp - a.timestamp);
                        tearDown();
                        resolve(dataPayload);
                    }
                }

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
                    ModalStateCache.description = textareaDesc.value;
                    ModalStateCache.dates = textareaDates.value;
                    ModalStateCache.startTime = selectStartTime.value;
                    ModalStateCache.endTime = selectEndTime.value;

                    const titleVal = ModalStateCache.title.trim();
                    const venueVal = ModalStateCache.venue.trim();
                    const youtubeVal = ModalStateCache.youtube.trim();

                    // Don't filter empty lines immediately so we can map them visually 1:1
                    const rawLines = ModalStateCache.dates.split('\n');
                    const activeLines = rawLines.filter(l => l.trim());

                    if (!titleVal) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-error';
                        feedbackBar.textContent = 'Event name is required to initialize automation.';
                        btnConfirm.disabled = true;
                        return null;
                    }

                    if (activeLines.length === 0) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-neutral';
                        feedbackBar.textContent = 'Enter target dates to begin verification...';
                        btnConfirm.disabled = true;
                        return null;
                    }

                    if (activeLines.length > CONFIG.MAX_CREATION_LIMIT) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-error';
                        feedbackBar.textContent = `Maximum limit exceeded (${CONFIG.MAX_CREATION_LIMIT} instances allowed).`;
                        btnConfirm.disabled = true;
                        return null;
                    }

                    const fallbackYear = DateEngine.getNYToday().getFullYear();
                    const validatedPairs = [];
                    let localErrorStatus = false;

                    rawLines.forEach(line => {
                        const trimmed = line.trim();

                        // Render blank spaces in the preview map for empty lines to maintain 1:1 row alignment
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
                            localErrorStatus = true;
                        } else if (dateObj < DateEngine.getNYToday()) {
                            rowWrapper.classList.add('is-invalid');
                            outputSpan.textContent = 'Past Date';
                            localErrorStatus = true;
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
                                startDate: sdateISO,
                                startTime: ModalStateCache.startTime,
                                endDate: edateISO,
                                endTime: ModalStateCache.endTime,
                                youtube: youtubeVal,
                                timestamp: dateObj.getTime()
                             });
                        }
                        rowWrapper.appendChild(outputSpan);
                        panelPreview.appendChild(rowWrapper);
                    });

                    if (localErrorStatus) {
                        feedbackBar.className = 'ra-mc-feedback ra-mc-fb-error';
                        feedbackBar.textContent = 'Resolve date compilation errors before executing.';
                        btnConfirm.disabled = true;
                        return null;
                    }

                    feedbackBar.className = 'ra-mc-feedback ra-mc-fb-success';
                    feedbackBar.textContent = `Verified ${validatedPairs.length} clean platform creation profiles. Ready to launch.`;
                    btnConfirm.disabled = false;
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
                textareaDesc.addEventListener('input', liveValidate);
                selectStartTime.addEventListener('change', liveValidate);
                selectEndTime.addEventListener('change', liveValidate);
                textareaDates.addEventListener('input', liveValidate);

                textareaDates.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        const dataPayload = liveValidate();
                        if (dataPayload) handleConfirmAction(dataPayload);
                    }
                });

                btnReset.addEventListener('click', () => {
                    ModalStateCache.flush();
                    inputName.value = '';
                    inputVenue.value = '';
                    inputYoutube.value = '';
                    textareaDesc.value = '';
                    textareaDates.value = '';
                    selectStartTime.value = '23:00';
                    selectEndTime.value = '06:00';
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

                btnConfirm.addEventListener('click', () => {
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

            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
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

                dataPackage = {
                    title: urlParams.get(CONFIG.KEYS.TITLE),
                    venue: urlParams.get(CONFIG.KEYS.VENUE) || '',
                    sdate: urlParams.get(CONFIG.KEYS.START_DATE),
                    stime: urlParams.get(CONFIG.KEYS.START_TIME),
                    edate: urlParams.get(CONFIG.KEYS.END_DATE),
                    etime: urlParams.get(CONFIG.KEYS.END_TIME),
                    youtube: urlParams.get(CONFIG.KEYS.YOUTUBE) || ''
                };

                TabRuntimeCache.youtubeLink = dataPackage.youtube;
                window.history.replaceState(null, '', window.location.pathname);
            } else {
                TabRuntimeCache.youtubeLink = dataPackage.youtube;
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

            // Re-map target to penetrate encapsulated Web Components (Shadow DOM) if present
            let trueTarget = event.composedPath ? event.composedPath()[0] : event.target;

            // Safeguard against clicking purely on text nodes which don't support .closest()
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

            // Check if we are running inside an iframe widget
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
            // Setup cross-frame communication bridge to catch calls from internal widget iframes
            window.addEventListener('message', (event) => {
                if (event.data === 'RAMC_TRIGGER_MODAL' && window === window.top) {
                    WorkflowEngine.invokeModalWorkflow();
                }
            });

            document.addEventListener('click', (e) => WorkflowEngine.handleDashboardClicks(e), true);
        },
        initDelayedModules() {
            WorkflowEngine.handleDirectCreationPageIntercept();
            FormInjector.executeHydrationSequence();
            FormInjector.monitorLineupStepHydration();
            FormInjector.monitorDetailsStepHydration();
            FormInjector.monitorPromotionalStepHydration();
        }
    };

    AppLifecycle.initEarlyHooks();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppLifecycle.initDelayedModules());
    } else {
        AppLifecycle.initDelayedModules();
    }
})();
