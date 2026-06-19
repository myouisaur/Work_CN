// ==UserScript==
// @name         [POSH] Ticket Manager
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://posh.vip/favicon.ico
// @version      11.8
// @description  Automatically creates, edits, and deletes event tickets in bulk using a queue-based interface.
// @author       Xiv
// @match        *://*.posh.vip/*
// @noframes
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Work_CN/posh_ticket-manager.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/posh_ticket-manager.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__xivPoshRunning) return;
    window.__xivPoshRunning = true;

    // ==========================================
    // CONFIG & STATE (Fully Centralized)
    // ==========================================
    const CONFIG = {
        DELAYS: {
            MODAL_OPEN: 1500,
            ACCORDION_OPEN: 200,
            TYPING: 100,
            SAVE: 500,
            DELETE_WAIT: 1500,
            LOOP_SETTLE: 2500,
            HYDRATION_BUFFER: 800,
            TOAST_SHORT: 2000,
            TOAST_LONG: 4000,
            TOAST_FADE: 300
        },
        POLLING: {
            MAX_TRIES: 15,
            INTERVAL: 300,
            LIMIT_RENDER_TRIES: 20,
            LIMIT_RENDER_INTERVAL: 150,
            ASSERTER: 500
        },
        RETRIES: {
            TYPING_VERIFICATION: 3,
            MAX_FAILURES: 3
        },
        SELECTORS: {
            TABLE_WRAPPER: '.TableWrapper__MdLHj',
            MODAL_ACTIVE: 'div[role="dialog"][data-state="open"]:not(#xiv-bulk-modal)',
            CLOSE_BTN: 'button[aria-label="Close"]',
            TIPTAP_EDITOR: '.tiptap.ProseMirror',
            TRASH_ICON: 'svg.lucide-trash-2',
            NUMERIC_INPUTS: 'input[inputmode="numeric"]'
        },
        AUDIO: {
            SUCCESS: [
                { freq: 523.25, type: 'sine', start: 0, dur: 0.4, vol: 0.6 },
                { freq: 659.25, type: 'sine', start: 0.15, dur: 0.4, vol: 0.6 },
                { freq: 783.99, type: 'sine', start: 0.3, dur: 0.6, vol: 0.6 }
            ],
            ERROR: [
                { freq: 150, type: 'sawtooth', start: 0, dur: 0.3, vol: 0.7 },
                { freq: 120, type: 'sawtooth', start: 0.25, dur: 0.4, vol: 0.7 }
            ]
        },
        STRINGS: {
            WARN_DELETE_ALL: '⚠️ WARNING: This will permanently delete ALL tickets. Proceed?',
            WARN_DELETE_SINGLE: '⚠️ Are you sure you want to delete this specific ticket?',
            TRASH_SVG: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`
        }
    };

    const STATE = {
        rows: [],
        isRunning: false,
        modalOpen: false,
        isEditMode: false,
        focusRowId: null
    };

    // ==========================================
    // KILL SWITCH & STATE MANAGEMENT
    // ==========================================
    function setRunningState(isRun) {
        STATE.isRunning = isRun;
    }

    // ==========================================
    // AUDIO ENGINE (Web Audio API Synthesis)
    // ==========================================
    let sharedAudioCtx = null;
    function playAudioAlert(type) {
        try {
            if (!sharedAudioCtx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) sharedAudioCtx = new AudioContext();
            }
            if (!sharedAudioCtx) return;
            if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();

            const playTone = (note) => {
                const osc = sharedAudioCtx.createOscillator();
                const gain = sharedAudioCtx.createGain();
                osc.type = note.type;
                osc.frequency.setValueAtTime(note.freq, sharedAudioCtx.currentTime + note.start);
                gain.gain.setValueAtTime(note.vol, sharedAudioCtx.currentTime + note.start);
                gain.gain.exponentialRampToValueAtTime(0.01, sharedAudioCtx.currentTime + note.start + note.dur);
                osc.connect(gain);
                gain.connect(sharedAudioCtx.destination);
                osc.start(sharedAudioCtx.currentTime + note.start);
                osc.stop(sharedAudioCtx.currentTime + note.start + note.dur);
            };

            if (type === 'success' && CONFIG.AUDIO.SUCCESS) CONFIG.AUDIO.SUCCESS.forEach(playTone);
            else if (type === 'error' && CONFIG.AUDIO.ERROR) CONFIG.AUDIO.ERROR.forEach(playTone);
        } catch (e) {
            console.error('Audio alert failed:', e);
        }
    }

    // ==========================================
    // BACKGROUND-IMMUNE TIMING ENGINE (Web Worker)
    // ==========================================
    const workerCode = `
        self.onmessage = function(e) {
            setTimeout(() => self.postMessage(e.data.id), e.data.ms);
        };
    `;
    const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
    const timerWorker = new Worker(URL.createObjectURL(workerBlob));

    let _timerId = 0;
    const _pendingTimers = new Map();

    timerWorker.onmessage = function(e) {
        const id = e.data;
        if (_pendingTimers.has(id)) {
            _pendingTimers.get(id)();
            _pendingTimers.delete(id);
        }
    };

    const delay = ms => new Promise(res => {
        const id = ++_timerId;
        _pendingTimers.set(id, res);
        timerWorker.postMessage({ id, ms });
    });

    // ==========================================
    // DOM UTILITIES & HELPERS
    // ==========================================
    function el(tag, attributes = {}, ...children) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') element.className = value;
            else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
            else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.substring(2).toLowerCase(), value);
            else if (key === 'value' || key === 'checked') element[key] = value;
            else if (value !== null && value !== undefined) element.setAttribute(key, value);
        }
        for (const child of children) {
            if (typeof child === 'string' || typeof child === 'number') element.appendChild(document.createTextNode(String(child)));
            else if (child instanceof Node) element.appendChild(child);
        }
        return element;
    }

    function syntheticClick(element, fullPointerChain = true) {
        if (!element) return;
        if (fullPointerChain) element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        if (fullPointerChain) element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    function getActivePoshModal() {
        const activeModals = Array.from(document.querySelectorAll(CONFIG.SELECTORS.MODAL_ACTIVE));
        return activeModals[activeModals.length - 1];
    }

    function forceCloseModal(activeModalElement) {
        const activeModal = activeModalElement || getActivePoshModal();
        let closeBtn = null;
        if (activeModal) {
            closeBtn = activeModal.querySelector(CONFIG.SELECTORS.CLOSE_BTN) || Array.from(activeModal.querySelectorAll('button')).find(b => b.textContent.includes('Cancel'));
        } else {
            closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Cancel'));
        }

        if (closeBtn) syntheticClick(closeBtn, false);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }

    async function getTipTapText(editor) {
        if (!editor) return '';
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(100);
        editor.focus();
        editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        await delay(200);

        const paragraphs = Array.from(editor.querySelectorAll('p'));
        return paragraphs.length > 0 ? paragraphs.map(p => p.textContent).join('\n') : editor.textContent;
    }

    async function setTipTapText(editor, text) {
        if (!editor || text === undefined) return;
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(100);
        editor.focus();
        editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        await delay(100);

        const range = document.createRange();
        range.selectNodeContents(editor);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        await delay(100);

        const htmlContent = text.split('\n').map(line => `<p>${line || '<br>'}</p>`).join('');
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/html', htmlContent);
        dataTransfer.setData('text/plain', text);

        const pasteEvent = new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true });
        editor.dispatchEvent(pasteEvent);
        if (editor.textContent.trim() === '') {
            editor.innerHTML = htmlContent;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await delay(300);
        editor.blur();
        editor.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        await delay(100);
    }

    // ==========================================
    // STYLES (Tailwind/Radix Mimic, Toast & Progress)
    // ==========================================
    GM_addStyle(`
        .xiv-modal-overlay { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; pointer-events: auto !important; }
        .xiv-modal-content { background: #0a0a0a; border: 1px solid #222; border-radius: 1rem; width: 90vw; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        .xiv-modal-header { padding: 1.5rem; border-bottom: 1px solid #222; }
        .xiv-modal-title { margin: 0; font-size: 1.25rem; font-weight: 600; color: #fff; }
        .xiv-modal-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        .xiv-modal-footer { padding: 1.5rem; border-top: 1px solid #222; display: flex; justify-content: space-between; align-items: center; }

        .xiv-grid-header { display: grid; grid-template-columns: 4fr 1fr 1fr 1fr 1fr 6fr auto; gap: 0.75rem; margin-bottom: 0.5rem; padding: 0 0.5rem; }
        .xiv-grid-label { font-size: 0.75rem; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }

        .xiv-row-container { margin-bottom: 0.5rem; border: 1px solid transparent; border-radius: 0.5rem; transition: background 0.2s; }
        .xiv-row-container:hover { background: #111; border-color: #222; }
        .xiv-grid-row { display: grid; grid-template-columns: 4fr 1fr 1fr 1fr 1fr 6fr auto; gap: 0.75rem; align-items: start; padding: 0.5rem; }

        .xiv-input { width: 100%; background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 0.6rem 0.75rem; border-radius: 0.5rem; font-size: 0.875rem; outline: none; transition: border 0.2s; box-sizing: border-box; }
        .xiv-input:focus { border-color: #666; }

        .xiv-icon-btn { background: none; border: none; color: #666; cursor: pointer; padding: 0.5rem; border-radius: 0.25rem; transition: color 0.2s, background 0.2s; display: flex; align-items: center; justify-content: center; margin-top: 0.15rem; }
        .xiv-icon-btn:hover { color: #fff; background: #222; }
        .xiv-icon-danger:hover { color: #ff4444; background: rgba(255,68,68,0.1); }

        .xiv-btn { padding: 0.5rem 1rem; border-radius: 9999px; font-weight: 500; font-size: 0.875rem; cursor: pointer; border: none; transition: opacity 0.2s; }
        .xiv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .xiv-btn-ghost { background: transparent; color: #888; border: 1px dashed #444; width: 100%; text-align: center; margin-top: 0.5rem; border-radius: 0.5rem; }
        .xiv-btn-ghost:hover { color: #fff; border-color: #666; background: #111; }
        .xiv-btn-primary { background: #fff; color: #000; }
        .xiv-btn-secondary { background: transparent; color: #888; }
        .xiv-btn-secondary:hover { color: #fff; }

        /* Modernized Integrated Toast */
        .xiv-toast { position: fixed; bottom: 1.5rem; left: 1.5rem; z-index: 999999; background: #111; border: 1px solid #333; color: #fff; padding: 1rem 1.5rem; border-radius: 0.5rem; font-family: system-ui, sans-serif; font-size: 0.875rem; box-shadow: 0 10px 25px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 0.75rem; transition: all 0.3s ease; transform: translateY(100px); opacity: 0; pointer-events: none; min-width: 300px; max-width: 90vw; }
        .xiv-toast.xiv-toast-show { transform: translateY(0); opacity: 1; pointer-events: auto; }
        .xiv-toast-success { border-color: #22c55e; }
        .xiv-toast-error { border-color: #ef4444; }

        .xiv-toast-body { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
        .xiv-toast-text { display: flex; align-items: center; gap: 0.75rem; flex: 1; line-height: 1.4; }

        /* Spinner & Progress */
        .xiv-spinner { width: 18px; height: 18px; min-width: 18px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #fff; border-radius: 50%; animation: xiv-spin 1s linear infinite; }
        .xiv-toast-progress-bg { width: 100%; height: 4px; background: #333; border-radius: 2px; overflow: hidden; }
        .xiv-toast-progress-fill { height: 100%; background: #fff; width: 0%; transition: width 0.3s ease; }
        .xiv-toast-success .xiv-toast-progress-fill { background: #22c55e; }
        .xiv-toast-error .xiv-toast-progress-fill { background: #ef4444; }

        /* Integrated Stop Button */
        .xiv-toast-stop-btn { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.5); color: #ef4444; border-radius: 0.25rem; padding: 0.35rem 0.6rem; cursor: pointer; transition: all 0.2s; font-size: 0.75rem; font-weight: 600; display: flex; align-items: center; gap: 0.35rem; pointer-events: auto; outline: none; }
        .xiv-toast-stop-btn:hover { background: #ef4444; color: #fff; border-color: #ef4444; }
        .xiv-toast-stop-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes xiv-spin { to { transform: rotate(360deg); } }

        /* Custom Native Injection Styles */
        .xiv-native-delete-btn { background: transparent; border: none; cursor: pointer; color: white; opacity: 1; transition: all 0.2s; padding: 0; display: inline-flex; align-items: center; justify-content: center; outline: none; }
        .xiv-native-delete-btn:hover { color: #ef4444; transform: scale(1.15); }
        .xiv-native-delete-btn svg { width: 16px; height: 16px; }
        .xiv-icon-container-mod { width: auto !important; display: flex !important; align-items: center !important; gap: 8px !important; }

        /* Flavor Modifiers for Native poshBtn */
        .xiv-flavor-add { background-color: #222 !important; color: #fff !important; border: 1px solid #333 !important; }
        .xiv-flavor-add:hover { background-color: #333 !important; border-color: #555 !important; }
        .xiv-flavor-edit { background-color: transparent !important; color: #ccc !important; border: 1px solid #444 !important; }
        .xiv-flavor-edit:hover { background-color: rgba(255, 255, 255, 0.05) !important; color: #fff !important; border-color: #666 !important; }
        .xiv-flavor-delete { background-color: transparent !important; color: #ef4444 !important; border: 1px solid #ef4444 !important; }
        .xiv-flavor-delete:hover { background-color: rgba(239, 68, 68, 0.1) !important; }
    `);

    // ==========================================
    // TOAST NOTIFICATION LOGIC (Progress & Stop-Aware)
    // ==========================================
    function showToast(htmlMessage, type = 'info') {
        let toast = document.getElementById('xiv-automation-toast');
        if (!toast) {
            toast = el('div', { id: 'xiv-automation-toast', className: 'xiv-toast' });
            document.body.appendChild(toast);
        }

        toast.className = 'xiv-toast xiv-toast-show';
        if (type === 'success') toast.classList.add('xiv-toast-success');
        if (type === 'error') toast.classList.add('xiv-toast-error');

        // Dynamically parse progress (e.g., "(2/5)") from the message
        let progressHtml = '';
        const progressMatch = htmlMessage.match(/\((\d+)\/(\d+)\)/);
        if (progressMatch && !isNaN(parseInt(progressMatch[2]))) {
            const pct = Math.min(100, Math.max(0, (parseInt(progressMatch[1]) / parseInt(progressMatch[2])) * 100));
            progressHtml = `<div class="xiv-toast-progress-bg"><div class="xiv-toast-progress-fill" style="width: ${pct}%"></div></div>`;
        }

        const spinnerHtml = type === 'info' ? `<div class="xiv-spinner"></div>` : '';

        let stopHtml = '';
        if (STATE.isRunning && type === 'info') {
            stopHtml = `<button id="xiv-toast-stop-btn" class="xiv-toast-stop-btn" title="Stop Automation"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14"></rect></svg> Stop</button>`;
        }

        toast.innerHTML = `
            <div class="xiv-toast-body">
                <div class="xiv-toast-text">${spinnerHtml} <span>${htmlMessage}</span></div>
                ${stopHtml}
            </div>
            ${progressHtml}
        `;

        const stopBtn = document.getElementById('xiv-toast-stop-btn');
        if (stopBtn) {
            stopBtn.onclick = () => {
                setRunningState(false);
                stopBtn.disabled = true;
                stopBtn.innerHTML = 'Stopping...';
                stopBtn.style.opacity = '0.5';
                showToast('🛑 Automation manually aborted.', 'error');
                playAudioAlert('error');
            };
        }
    }

    function removeToast(delayMs = 0) {
        setTimeout(() => {
            const toast = document.getElementById('xiv-automation-toast');
            if (toast) {
                toast.classList.remove('xiv-toast-show');
                setTimeout(() => toast.remove(), CONFIG.DELAYS.TOAST_FADE);
            }
        }, delayMs);
    }

    // ==========================================
    // UI RENDERING
    // ==========================================
    function openModal() {
        if (STATE.modalOpen) return;
        STATE.modalOpen = true;
        if (STATE.rows.length === 0) addRow();
        else STATE.focusRowId = STATE.rows[0].id;
        renderModal();
    }

    function closeModal() {
        const overlay = document.getElementById('xiv-bulk-modal');
        if (overlay) overlay.remove();
        STATE.modalOpen = false;
    }

    function addRow(data = {}) {
        const newId = Date.now() + Math.random();
        STATE.rows.push({
            id: newId,
            rowIndex: data.rowIndex !== undefined ? data.rowIndex : -1,
            originalName: data.originalName !== undefined ? data.originalName : '',
            originalQty: data.originalQty !== undefined ? data.originalQty : '',
            originalPrice: data.originalPrice !== undefined ? data.originalPrice : '',
            originalMin: data.originalMin !== undefined ? data.originalMin : '',
            originalMax: data.originalMax !== undefined ? data.originalMax : '',
            originalDesc: data.originalDesc !== undefined ? data.originalDesc : '',
            name: data.name || '',
            qty: data.qty || '',
            price: data.price || '',
            min: data.min || '',
            max: data.max || '',
            desc: data.desc || ''
        });
        STATE.focusRowId = newId;
        if (STATE.modalOpen) renderRows();
    }

    function removeRow(id) {
        STATE.rows = STATE.rows.filter(r => r.id !== id);
        if (STATE.rows.length === 0) addRow();
        renderRows();
    }

    function updateRow(id, field, value) {
        const row = STATE.rows.find(r => r.id === id);
        if (row) row[field] = value;
    }

    function renderModal() {
        const existing = document.getElementById('xiv-bulk-modal');
        if (existing) existing.remove();

        const overlay = el('div', { id: 'xiv-bulk-modal', className: 'xiv-modal-overlay' });
        const content = el('div', { className: 'xiv-modal-content' });

        content.appendChild(el('div', { className: 'xiv-modal-header' }, el('h2', { className: 'xiv-modal-title' }, STATE.isEditMode ? 'Bulk Edit Tickets' : 'Create Multiple Tickets')));
        const body = el('div', { className: 'xiv-modal-body', id: 'xiv-modal-body' });
        body.appendChild(el('div', { className: 'xiv-grid-header' },
            el('div', { className: 'xiv-grid-label' }, 'Name'), el('div', { className: 'xiv-grid-label' }, 'Qty'),
            el('div', { className: 'xiv-grid-label' }, 'Price'), el('div', { className: 'xiv-grid-label' }, 'Min'),
            el('div', { className: 'xiv-grid-label' }, 'Max'), el('div', { className: 'xiv-grid-label' }, 'Description'),
            el('div', { className: 'xiv-grid-label', style: { width: '35px' } }, '')
        ));

        body.appendChild(el('div', { id: 'xiv-rows-container' }));
        body.appendChild(el('button', { className: 'xiv-btn xiv-btn-ghost', onClick: () => addRow() }, '+ Add Ticket'));
        content.appendChild(body);

        const footer = el('div', { className: 'xiv-modal-footer' },
            el('div', { id: 'xiv-modal-status', style: { fontSize: '0.875rem', color: '#888' } }),
            el('div', { style: { display: 'flex', gap: '1rem' } },
                el('button', { className: 'xiv-btn xiv-btn-secondary', id: 'xiv-cancel-btn', onClick: closeModal }, 'Cancel'),
                el('button', { className: 'xiv-btn xiv-btn-primary', id: 'xiv-run-btn', onClick: startAutomation }, STATE.isEditMode ? 'Update Tickets' : 'Create Tickets')
            )
        );
        content.appendChild(footer);
        overlay.appendChild(content);
        document.body.appendChild(overlay);
        renderRows();
    }

    function renderRows() {
        const container = document.getElementById('xiv-rows-container');
        if (!container) return;
        container.innerHTML = '';

        STATE.rows.forEach((row) => {
            const rowWrapper = el('div', { className: 'xiv-row-container' });
            const grid = el('div', { className: 'xiv-grid-row' });

            const nameInput = el('input', { className: 'xiv-input', placeholder: 'General Admission', value: row.name, onInput: (e) => updateRow(row.id, 'name', e.target.value) });
            grid.appendChild(nameInput);

            grid.appendChild(el('input', { className: 'xiv-input', type: 'number', placeholder: 'Unltd', value: row.qty, onInput: (e) => updateRow(row.id, 'qty', e.target.value) }));
            grid.appendChild(el('input', { className: 'xiv-input', type: 'number', placeholder: 'Free', value: row.price, onInput: (e) => updateRow(row.id, 'price', e.target.value) }));
            grid.appendChild(el('input', { className: 'xiv-input', type: 'number', placeholder: '1', value: row.min, onInput: (e) => updateRow(row.id, 'min', e.target.value) }));
            grid.appendChild(el('input', { className: 'xiv-input', type: 'number', placeholder: '1000', value: row.max, onInput: (e) => updateRow(row.id, 'max', e.target.value) }));

            const descArea = el('textarea', {
                className: 'xiv-input', rows: '1', placeholder: 'Ticket details...',
                style: { resize: 'none', overflow: 'hidden' },
                value: row.desc,
                onInput: (e) => {
                    updateRow(row.id, 'desc', e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = (e.target.scrollHeight) + 'px';
                }
            });
            setTimeout(() => { if (descArea.value) { descArea.style.height = 'auto'; descArea.style.height = (descArea.scrollHeight) + 'px'; } }, 0);
            grid.appendChild(descArea);
            const actions = el('div', { style: { display: 'flex', gap: '0.25rem' } },
                el('button', { className: 'xiv-icon-btn xiv-icon-danger', title: 'Delete', onClick: () => removeRow(row.id) }, '🗑️')
            );
            grid.appendChild(actions);

            rowWrapper.appendChild(grid);
            container.appendChild(rowWrapper);

            if (STATE.focusRowId === row.id) {
                setTimeout(() => {
                    nameInput.focus();
                    STATE.focusRowId = null;
                }, 50);
            }
        });
    }

    function setStatus(text, isError = false) {
        const st = document.getElementById('xiv-modal-status');
        if (st) { st.textContent = text; st.style.color = isError ? '#ff4444' : '#fff'; }
    }

    function injectNativeUI() {
        if (STATE.modalOpen || STATE.isRunning) return;

        // 1. Inject Main Buttons
        if (!document.getElementById('xiv-bulk-trigger')) {
            const buttons = document.getElementsByTagName('button');
            let nativeBtn = null;

            for (let i = 0; i < buttons.length; i++) {
                if (buttons[i].textContent.toLowerCase().includes('add ticket') && !buttons[i].id.includes('xiv')) {
                    nativeBtn = buttons[i];
                    break;
                }
            }

            if (nativeBtn && nativeBtn.parentElement) {
                const bulkAddBtn = el('button', {
                    id: 'xiv-bulk-trigger',
                    className: 'poshBtn xiv-flavor-add',
                    style: { textTransform: 'capitalize', marginLeft: '8px' },
                    onClick: () => { STATE.isEditMode = false; STATE.rows = []; openModal(); }
                }, 'Bulk Add');
                const bulkEditBtn = el('button', {
                    id: 'xiv-edit-trigger',
                    className: 'poshBtn xiv-flavor-edit',
                    style: { textTransform: 'capitalize', marginLeft: '8px' },
                    onClick: scrapeExistingTickets
                }, 'Bulk Edit');
                const deleteBtn = el('button', {
                    id: 'xiv-delete-trigger',
                    className: 'poshBtn xiv-flavor-delete',
                    style: { textTransform: 'capitalize', marginLeft: '8px' },
                    onClick: startDeleteAllAutomation
                }, 'Delete All');

                nativeBtn.after(bulkAddBtn);
                bulkAddBtn.after(bulkEditBtn);
                bulkEditBtn.after(deleteBtn);
            }
        }

        // 2. Inject Single Row Delete Buttons
        const tableWrap = document.querySelector(CONFIG.SELECTORS.TABLE_WRAPPER);
        if (tableWrap) {
            const rows = Array.from(tableWrap.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 1);
            rows.forEach(tr => {
                if (!tr.querySelector('.xiv-native-delete-btn')) {
                    const targetTd = tr.lastElementChild;
                    if (targetTd) {
                        const iconContainer = targetTd.querySelector('div[class*="ActionButtons"]') || targetTd.querySelector('div') || targetTd;

                        if (iconContainer) {
                            if (!iconContainer.classList.contains('xiv-icon-container-mod')) {
                                iconContainer.classList.add('xiv-icon-container-mod');
                            }

                            const delBtn = document.createElement('button');
                            delBtn.className = 'xiv-native-delete-btn';
                            delBtn.title = 'Quick Delete';
                            delBtn.innerHTML = CONFIG.STRINGS.TRASH_SVG;
                            delBtn.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startSingleDelete(tr);
                            };

                            iconContainer.appendChild(delBtn);
                        }
                    }
                }
            });
        }
    }

    // ==========================================
    // SCRAPING ENGINE (For Bulk Edit)
    // ==========================================
    async function scrapeExistingTickets() {
        if (STATE.isRunning) return;
        setRunningState(true);
        STATE.rows = [];

        const tableWrap = document.querySelector(CONFIG.SELECTORS.TABLE_WRAPPER);
        if (!tableWrap) {
            showToast('❌ No tickets found to edit.', 'error');
            playAudioAlert('error');
            setRunningState(false);
            return;
        }

        const initialCount = Array.from(tableWrap.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 1).length;
        if (initialCount === 0) {
            showToast('❌ No tickets found to edit.', 'error');
            playAudioAlert('error');
            setRunningState(false);
            return;
        }

        for (let i = 0; i < initialCount; i++) {
            if (!STATE.isRunning) break; // Check Kill Switch

            showToast(`🔍 Reading ticket data (${i+1}/${initialCount})...`, 'info');
            if (i > 0) await delay(CONFIG.DELAYS.LOOP_SETTLE);

            try {
                const currentWrap = document.querySelector(CONFIG.SELECTORS.TABLE_WRAPPER);
                const freshRows = Array.from(currentWrap.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 1);
                const targetRow = freshRows[i];
                if (!targetRow) continue;

                targetRow.click();
                await delay(CONFIG.DELAYS.MODAL_OPEN);
                const activeModal = getActivePoshModal();
                if (!activeModal) throw new Error('Modal failed to open for scraping');

                const inputs = Array.from(activeModal.querySelectorAll('input'));
                const nameInp = inputs.find(inp => inp.name === 'name' || inp.placeholder.toLowerCase().includes('name'));
                const qtyInp = inputs.find(inp => inp.placeholder.toLowerCase().includes('unlimited') || inp.id.includes('qty'));
                const priceInpRaw = inputs.find(inp => inp.placeholder.toLowerCase().includes('free') || inp.id.includes('price') || inp.name.includes('price'));
                let cleanedPrice = '';
                if (priceInpRaw && priceInpRaw.value) {
                    cleanedPrice = priceInpRaw.value.replace(/[^0-9.]/g, '');
                }

                let cleanedQty = '';
                if (qtyInp && qtyInp.value) {
                    cleanedQty = qtyInp.value.toLowerCase().includes('unlimited') ? '' : qtyInp.value.replace(/[^0-9]/g, '');
                }

                let min = '', max = '';
                const limitInputs = Array.from(activeModal.querySelectorAll(CONFIG.SELECTORS.NUMERIC_INPUTS)).filter(inp => inp.placeholder === '1' || inp.placeholder === '1000');
                if (limitInputs.length >= 2) { min = limitInputs[0].value; max = limitInputs[1].value; }

                const desc = await getTipTapText(activeModal.querySelector(CONFIG.SELECTORS.TIPTAP_EDITOR));

                addRow({
                    rowIndex: i,
                    originalName: nameInp ? nameInp.value : '',
                    originalQty: cleanedQty,
                    originalPrice: cleanedPrice,
                    originalMin: min,
                    originalMax: max,
                    originalDesc: desc,
                    name: nameInp ? nameInp.value : '',
                    qty: cleanedQty,
                    price: cleanedPrice,
                    min: min, max: max, desc: desc
                });
                forceCloseModal(activeModal);

                for (let w = 0; w < CONFIG.POLLING.MAX_TRIES; w++) {
                    await delay(CONFIG.POLLING.INTERVAL);
                    if (!getActivePoshModal()) break;
                }

            } catch (err) {
                console.error(err);
                forceCloseModal();
                await delay(CONFIG.DELAYS.MODAL_OPEN);
            }
        }

        if (!STATE.isRunning) return; // Check if aborted mid-flight

        setRunningState(false);
        STATE.isEditMode = true;
        showToast('✅ Finished reading ticket data!', 'success');
        playAudioAlert('success');
        removeToast(CONFIG.DELAYS.TOAST_SHORT);
        openModal();
    }

    // ==========================================
    // DELETE AUTOMATION ENGINE
    // ==========================================
    async function startDeleteAllAutomation() {
        if (!confirm(CONFIG.STRINGS.WARN_DELETE_ALL)) return;
        if (STATE.isRunning) return;

        setRunningState(true);
        closeModal();
        let failures = 0;
        let deletedCount = 1;
        let totalTickets = 0;
        const initTable = document.querySelector(CONFIG.SELECTORS.TABLE_WRAPPER);
        if (initTable) {
            totalTickets = Array.from(initTable.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 1).length;
        }

        while (STATE.isRunning) {
            const tableWrap = document.querySelector(CONFIG.SELECTORS.TABLE_WRAPPER);
            if (!tableWrap) break;

            const validRows = Array.from(tableWrap.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 1);
            if (validRows.length === 0) break;
            const editTrigger = validRows[0];
            showToast(`🗑️ Deleting ticket (${deletedCount}/${totalTickets || '?'})...`, 'info');
            try {
                editTrigger.click();
                await delay(CONFIG.DELAYS.MODAL_OPEN);
                const activeModal = getActivePoshModal();
                if (!activeModal) throw new Error('Edit modal did not open. Row might be invalid.');
                const labels = Array.from(activeModal.querySelectorAll('label'));
                const delLabel = labels.find(l => l.textContent.includes('Delete Ticket'));
                let trashSvg = delLabel ? (delLabel.parentElement.querySelector(CONFIG.SELECTORS.TRASH_ICON) || delLabel.nextElementSibling) : activeModal.querySelector(CONFIG.SELECTORS.TRASH_ICON);

                if (!trashSvg) throw new Error('Trash icon not found');

                syntheticClick(trashSvg, true);
                await delay(800);
                const confirmBtns = Array.from(activeModal.querySelectorAll('button')).filter(b =>
                    b.textContent.toLowerCase().includes('delete') || b.textContent.toLowerCase().includes('confirm') || b.textContent.toLowerCase().includes('yes')
                );
                if (confirmBtns.length > 0) confirmBtns[confirmBtns.length - 1].click();

                for(let w = 0; w < CONFIG.POLLING.MAX_TRIES; w++) {
                    await delay(CONFIG.POLLING.INTERVAL);
                    if(!getActivePoshModal()) break;
                }

                failures = 0;
                deletedCount++;

            } catch(e) {
                console.error(e);
                failures++;
                if (failures >= CONFIG.RETRIES.MAX_FAILURES) {
                    showToast('❌ Too many failures, stopping deletion.', 'error');
                    playAudioAlert('error');
                    setRunningState(false);
                    return;
                }
                forceCloseModal();
                await delay(CONFIG.DELAYS.MODAL_OPEN);
            }
        }

        if (!STATE.isRunning && deletedCount > 1) return; // Only show success if naturally finished

        showToast('✅ All tickets deleted.', 'success');
        playAudioAlert('success');
        removeToast(CONFIG.DELAYS.TOAST_LONG);
        setRunningState(false);
    }

    async function startSingleDelete(targetRow) {
        if (!confirm(CONFIG.STRINGS.WARN_DELETE_SINGLE)) return;
        if (STATE.isRunning) return;

        setRunningState(true);
        showToast(`🗑️ Deleting ticket...`, 'info');
        try {
            targetRow.click();
            await delay(CONFIG.DELAYS.MODAL_OPEN);

            const activeModal = getActivePoshModal();
            if (!activeModal) throw new Error('Edit modal did not open.');

            const labels = Array.from(activeModal.querySelectorAll('label'));
            const delLabel = labels.find(l => l.textContent.includes('Delete Ticket'));
            let trashSvg = delLabel ? (delLabel.parentElement.querySelector(CONFIG.SELECTORS.TRASH_ICON) || delLabel.nextElementSibling) : activeModal.querySelector(CONFIG.SELECTORS.TRASH_ICON);

            if (!trashSvg) throw new Error('Trash icon not found');

            syntheticClick(trashSvg, true);
            await delay(800);

            const confirmBtns = Array.from(activeModal.querySelectorAll('button')).filter(b =>
                b.textContent.toLowerCase().includes('delete') || b.textContent.toLowerCase().includes('confirm') || b.textContent.toLowerCase().includes('yes')
            );
            if (confirmBtns.length > 0) confirmBtns[confirmBtns.length - 1].click();

            for(let w = 0; w < CONFIG.POLLING.MAX_TRIES; w++) {
                await delay(CONFIG.POLLING.INTERVAL);
                if(!getActivePoshModal()) break;
            }

            showToast('✅ Ticket deleted.', 'success');
            playAudioAlert('success');
            removeToast(CONFIG.DELAYS.TOAST_LONG);
        } catch(e) {
            console.error(e);
            showToast('❌ Failed to delete ticket.', 'error');
            playAudioAlert('error');
            forceCloseModal();
        } finally {
            setRunningState(false);
        }
    }

    // ==========================================
    // CREATE & UPDATE AUTOMATION ENGINE
    // ==========================================

    async function setReactValueAsync(input, value) {
        if (!input || value === '' || value === undefined) return;
        for (let attempt = 1; attempt <= CONFIG.RETRIES.TYPING_VERIFICATION; attempt++) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await delay(100);

            syntheticClick(input, false);
            await delay(50);

            input.focus();
            input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            await delay(100);

            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (!setter) return;

            try { input.select(); } catch(e) {}
            await delay(100);
            setter.call(input, '');
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            await delay(200);

            setter.call(input, value);
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            await delay(CONFIG.DELAYS.TYPING);
            input.blur();
            input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            await delay(100);

            if (input.value == value) {
                break;
            } else {
                const valA = parseFloat(String(input.value).replace(/[^0-9.-]/g, ''));
                const valB = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
                if (!isNaN(valA) && !isNaN(valB) && valA === valB) {
                    break;
                }

                if (attempt < CONFIG.RETRIES.TYPING_VERIFICATION) {
                    console.log(`[POSH Automation] React dropped value '${value}' (Current: '${input.value}'). Retrying attempt ${attempt + 1}...`);
                    await delay(400);
                }
            }
        }
    }

    async function ensureSwitch(container, idOrLabel, state) {
        let target = container.querySelector(`[id*="${idOrLabel.toLowerCase().replace(/\s+/g, '-')}"]`);
        if (!target) {
            const buttons = Array.from(container.querySelectorAll('button[role="switch"], button[role="checkbox"]'));
            target = buttons.find(b => b.parentElement && b.parentElement.textContent.toLowerCase().includes(idOrLabel.toLowerCase()));
        }

        if (target && (target.getAttribute('aria-checked') === 'true') !== state) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await delay(100);

            target.focus();
            target.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            await delay(100);

            target.click();
            for (let i = 0; i < CONFIG.POLLING.MAX_TRIES; i++) {
                await delay(150);
                if (target.getAttribute('aria-checked') === String(state)) break;
            }
            await delay(CONFIG.DELAYS.ACCORDION_OPEN);
        }
    }

    async function startAutomation() {
        const validRows = STATE.rows.filter(r => r.name.trim() !== '');
        if (validRows.length === 0) return setStatus('Please enter at least one ticket name.', true);

        if (STATE.isRunning) return;
        setRunningState(true);
        closeModal();

        for (let i = 0; i < validRows.length; i++) {
            if (!STATE.isRunning) break; // Check Kill Switch

            const ticket = validRows[i];
            const isUpdate = STATE.isEditMode && ticket.rowIndex !== undefined && ticket.rowIndex >= 0;
            if (isUpdate) {
                const hasChanges =
                    ticket.name.trim() !== ticket.originalName.trim() ||
                    ticket.qty.trim() !== ticket.originalQty.trim() ||
                    ticket.price.trim() !== ticket.originalPrice.trim() ||
                    ticket.min.trim() !== ticket.originalMin.trim() ||
                    ticket.max.trim() !== ticket.originalMax.trim() ||
                    ticket.desc.trim() !== ticket.originalDesc.trim();
                if (!hasChanges) {
                    showToast(`⏭️ No changes for <strong>${ticket.name}</strong>. Skipping...`, 'info');
                    continue;
                }
            }

            showToast(`⏳ ${isUpdate ? 'Updating' : 'Processing'} (${i+1}/${validRows.length}): <strong>${ticket.name}</strong>...`, 'info');
            if (i > 0) await delay(CONFIG.DELAYS.LOOP_SETTLE);

            try {
                if (isUpdate) {
                    const currentWrap = document.querySelector(CONFIG.SELECTORS.TABLE_WRAPPER);
                    const freshRows = Array.from(currentWrap.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 1);
                    const targetRow = freshRows[ticket.rowIndex];
                    if (!targetRow) throw new Error(`Ticket row index ${ticket.rowIndex} not found on page.`);
                    syntheticClick(targetRow, true);
                } else {
                    const buttons = document.getElementsByTagName('button');
                    let addBtn = null;
                    for (let j = 0; j < buttons.length; j++) {
                        if (buttons[j].textContent.includes('Add Ticket') && !buttons[j].id.includes('xiv')) {
                            addBtn = buttons[j];
                            break;
                        }
                    }
                    if (addBtn && !addBtn.disabled) {
                        syntheticClick(addBtn, true);
                    }
                    else throw new Error('Add Ticket button missing or disabled');
                }

                await delay(CONFIG.DELAYS.MODAL_OPEN);
                const activeModal = getActivePoshModal();
                if (!activeModal) throw new Error('POSH modal missing or not active');

                // PHASE 1: LIMITS
                if (ticket.min || ticket.max) {
                    await ensureSwitch(activeModal, 'limit-purchase-quantity', true);
                    let limitInputs = [];
                    for (let w = 0; w < CONFIG.POLLING.LIMIT_RENDER_TRIES; w++) {
                        limitInputs = Array.from(activeModal.querySelectorAll(CONFIG.SELECTORS.NUMERIC_INPUTS)).filter(inp => inp.placeholder === '1' || inp.placeholder === '1000');
                        if (limitInputs.length >= 2) break;
                        await delay(CONFIG.POLLING.LIMIT_RENDER_INTERVAL);
                    }

                    await delay(CONFIG.DELAYS.HYDRATION_BUFFER);
                    limitInputs = Array.from(activeModal.querySelectorAll(CONFIG.SELECTORS.NUMERIC_INPUTS)).filter(inp => inp.placeholder === '1' || inp.placeholder === '1000');
                    if (limitInputs.length >= 2) {
                        await setReactValueAsync(limitInputs[0], ticket.min);
                        await delay(300);
                        await setReactValueAsync(limitInputs[1], ticket.max);
                    }
                }

                // PHASE 2: DESCRIPTION
                if (ticket.desc !== undefined) {
                    await setTipTapText(activeModal.querySelector(CONFIG.SELECTORS.TIPTAP_EDITOR), ticket.desc);
                }

                // PHASE 3: STANDARD INPUTS
                const inputs = Array.from(activeModal.querySelectorAll('input'));
                await setReactValueAsync(inputs.find(inp => inp.name === 'name' || inp.placeholder.toLowerCase().includes('name')), ticket.name);
                await setReactValueAsync(inputs.find(inp => inp.placeholder.toLowerCase().includes('unlimited') || inp.id.includes('qty')), ticket.qty);
                await setReactValueAsync(inputs.find(inp => inp.placeholder.toLowerCase().includes('free') || inp.id.includes('price')), ticket.price);

                await delay(300);

                // PHASE 4: SAVE & VALIDATE
                let saveBtn = null;
                for (let w = 0; w < CONFIG.POLLING.MAX_TRIES; w++) {
                    saveBtn = Array.from(activeModal.querySelectorAll('button')).find(b =>
                        b.textContent.includes('Create') ||
                        b.textContent.includes('Save') ||
                        b.textContent.includes('Update')
                    );
                    if (saveBtn && !saveBtn.disabled) break;
                    await delay(CONFIG.POLLING.INTERVAL);
                }

                if (saveBtn && !saveBtn.disabled) {
                    syntheticClick(saveBtn, true);
                    for (let w = 0; w < CONFIG.POLLING.MAX_TRIES; w++) {
                        await delay(CONFIG.POLLING.INTERVAL);
                        if (!getActivePoshModal()) break;
                    }
                } else {
                    throw new Error('Save button remained disabled. Validation likely failed.');
                }

            } catch (err) {
                console.error(err);
                showToast(`❌ Failed on <strong>${ticket.name}</strong>. Moving to next...`, 'error');
                playAudioAlert('error');
                forceCloseModal();
                await delay(CONFIG.DELAYS.MODAL_OPEN);
            }
        }

        if (!STATE.isRunning) return; // Check if aborted mid-flight

        showToast(`✅ All tickets ${STATE.isEditMode ? 'updated' : 'created'} successfully!`, 'success');
        playAudioAlert('success');
        removeToast(CONFIG.DELAYS.TOAST_LONG);

        setRunningState(false);
        STATE.rows = [];
    }

    // ==========================================
    // THE "STICKY" ASSERTER (Existence Loop)
    // ==========================================
    setInterval(() => {
        if (!window.location.pathname.includes('/tickets')) return;
        injectNativeUI();
    }, CONFIG.POLLING.ASSERTER);

})();
