// ==UserScript==
// @name         [Eventbrite] Event Extractor
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.eventbrite.com/favicon.ico
// @version      2.6
// @description  Extracts and groups unique event dates and venues from the management dashboard into a copyable list.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_event-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_event-extractor.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (document.documentElement.dataset.ebExtractorRunning === 'true') return;
    document.documentElement.dataset.ebExtractorRunning = 'true';

    const CONFIG = {
        DEBUG: false,
        TOAST_DURATION_MS: 3000
    };

    const Logger = {
        log(msg, data = '') { if (CONFIG.DEBUG) console.log(`[EBExtractor] ${msg}`, data); },
        error(msg, err = '') { console.error(`[EBExtractor][Error] ${msg}`, err); }
    };

    const ConfigManager = {
        get timeVenues() {
            return GM_getValue('xiv_xt_time_venues', 'pier, skyport');
        },
        set timeVenues(val) {
            GM_setValue('xiv_xt_time_venues', val);
        },
        getTimeVenuesArray() {
            return this.timeVenues.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
        }
    };

    const DOMBuilder = {
        create(tag, attributes = {}, ...children) {
            const el = document.createElement(tag);
            for (const [key, value] of Object.entries(attributes)) {
                if (key === 'className') el.className = value;
                else if (key === 'style') el.style.cssText = value;
                else if (key === 'innerHTML') el.innerHTML = value;
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

    const Styles = {
        init() {
            const css = `
                /* * Eventbrite Native Design System (EDS) Variables */
                :root {
                    --eb-navy: #1e0a3c;
                    --eb-blue: #3659e3;
                    --eb-blue-hover: #2b47b5;
                    --eb-blue-light: #ebf0ff;
                    --eb-red: #c5162e;
                    --eb-red-hover: #a41226;
                    --eb-green: #059669;
                    --eb-surface: #ffffff;
                    --eb-bg-subtle: #f8f7fa;
                    --eb-border: #eeedf2;
                    --eb-border-dark: #d1d5db;
                    --eb-text-main: #39364f;
                    --eb-text-muted: #6f7287;
                    --eb-shadow-soft: 0 4px 12px rgba(0, 0, 0, 0.08);
                    --eb-shadow-float: 0 16px 48px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.04);
                }

                /* Primary Floating Action Button (Toggle) */
                .xiv-xt-fab {
                    position: fixed;
                    bottom: 2rem;
                    right: 2rem;
                    width: 3.5rem;
                    height: 3.5rem;
                    border-radius: 50%;
                    background: var(--eb-blue);
                    color: white;
                    border: none;
                    box-shadow: 0 4px 16px rgba(54, 89, 227, 0.35);
                    cursor: pointer;
                    z-index: 2147483640;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s ease, background-color 0.25s ease;
                }
                .xiv-xt-fab:hover { transform: translateY(-2px) scale(1.05); background: var(--eb-blue-hover); box-shadow: 0 6px 20px rgba(54, 89, 227, 0.4); }
                .xiv-xt-fab:active { transform: translateY(1px) scale(0.95); box-shadow: 0 2px 8px rgba(54, 89, 227, 0.3); }
                .xiv-xt-fab svg { width: 1.5rem; height: 1.5rem; fill: currentColor; }

                /* FAB Open State (Red / Close) */
                .xiv-xt-fab.xiv-xt-fab-open {
                    background: var(--eb-red);
                    box-shadow: 0 4px 16px rgba(197, 22, 46, 0.35);
                }
                .xiv-xt-fab.xiv-xt-fab-open:hover {
                    background: var(--eb-red-hover);
                    box-shadow: 0 6px 20px rgba(197, 22, 46, 0.4);
                }
                .xiv-xt-fab.xiv-xt-fab-open svg { fill: currentColor; }

                /* Anchored Pop-up Panel */
                .xiv-xt-popup {
                    position: fixed;
                    bottom: 6.5rem;
                    right: 2rem;
                    background: var(--eb-surface);
                    padding: 1.5rem;
                    border-radius: 12px;
                    width: clamp(300px, 90vw, 38rem);
                    box-shadow: var(--eb-shadow-float);
                    border: 1px solid var(--eb-border);

                    transform-origin: bottom right;
                    transform: translateY(1.5rem) scale(0.97);
                    opacity: 0;
                    pointer-events: none;
                    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease;

                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
                    display: flex;
                    flex-direction: column;
                    z-index: 2147483647;
                    box-sizing: border-box;
                }
                .xiv-xt-popup.xiv-xt-visible {
                    opacity: 1;
                    pointer-events: auto;
                    transform: translateY(0) scale(1);
                }

                /* Header */
                .xiv-xt-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.25rem; }
                .xiv-xt-title { margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--eb-navy); letter-spacing: -0.01em; }

                /* Integrated Inline Toast / Alert Banner */
                .xiv-xt-toast {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 0.875rem;
                    font-weight: 600;
                    border-radius: 8px;
                    overflow: hidden;

                    max-height: 0;
                    opacity: 0;
                    padding: 0 1rem;
                    margin-bottom: 0;
                    border: 0px solid transparent;
                    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                    box-sizing: border-box;
                }
                .xiv-xt-toast.xiv-xt-show {
                    max-height: 4rem;
                    opacity: 1;
                    padding: 0.75rem 1rem;
                    margin-bottom: 1rem;
                    border-width: 1px;
                }
                .xiv-xt-toast svg { width: 1.25rem; height: 1.25rem; flex-shrink: 0; }

                .xiv-xt-toast.xiv-xt-success { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
                .xiv-xt-toast.xiv-xt-warning { background: #fffbeb; color: #b45309; border-color: #fde68a; }

                /* Rendered Log Container & Custom Scrollbar */
                .xiv-xt-log-container {
                    width: 100%;
                    height: 24rem;
                    padding: 0.75rem 1rem;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 0.85rem;
                    line-height: 1.7;
                    color: var(--eb-text-main);
                    border: 1px solid var(--eb-border-dark);
                    border-radius: 8px;
                    background: var(--eb-bg-subtle);
                    box-sizing: border-box;
                    overflow-y: auto;
                    position: relative;
                }
                .xiv-xt-log-container::-webkit-scrollbar { width: 8px; }
                .xiv-xt-log-container::-webkit-scrollbar-track { background: transparent; }
                .xiv-xt-log-container::-webkit-scrollbar-thumb { background-color: #d1d5db; border-radius: 20px; border: 2px solid var(--eb-bg-subtle); }
                .xiv-xt-log-container::-webkit-scrollbar-thumb:hover { background-color: #9ca3af; }

                .xiv-xt-year {
                    margin: 1rem 0 0.25rem 0;
                    font-weight: 700;
                    color: var(--eb-navy);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 1rem;
                    border-bottom: 2px solid var(--eb-border);
                    padding-bottom: 0.25rem;
                }
                .xiv-xt-log-container .xiv-xt-year:first-child { margin-top: 0; }

                .xiv-xt-log-line {
                    padding: 0.125rem 0.5rem;
                    border-radius: 4px;
                    margin-bottom: 2px;
                    border-left: 3px solid transparent;
                    display: flex;
                    align-items: center;
                }

                .xiv-xt-placeholder {
                    color: var(--eb-text-muted);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    gap: 0.75rem;
                }

                /* Smooth Slide-in Animation for New Events */
                @keyframes xiv-xt-glow-in {
                    0% {
                        opacity: 0;
                        background-color: rgba(5, 150, 105, 0.15);
                        border-left-color: var(--eb-green);
                        transform: translateX(-10px);
                    }
                    20% { opacity: 1; transform: translateX(0); }
                    100% {
                        background-color: transparent;
                        border-left-color: transparent;
                    }
                }
                .xiv-xt-log-new {
                    animation: xiv-xt-glow-in 2.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }

                /* Redesigned Buttons */
                .xiv-xt-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 1.25rem; }
                .xiv-xt-btn-group { display: flex; gap: 0.75rem; }

                .xiv-xt-btn {
                    display: inline-flex; align-items: center; justify-content: center;
                    padding: 0.6rem 1.25rem; font-size: 0.875rem; font-weight: 600;
                    border-radius: 8px; cursor: pointer; border: 1px solid transparent;
                    transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                    font-family: inherit; gap: 0.5rem;
                }
                .xiv-xt-btn svg { width: 1.125rem; height: 1.125rem; fill: currentColor; }

                .xiv-xt-btn-primary {
                    background: var(--eb-blue); color: white;
                    box-shadow: 0 2px 8px rgba(54, 89, 227, 0.2);
                }
                .xiv-xt-btn-primary:hover { background: var(--eb-blue-hover); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(54, 89, 227, 0.3); }
                .xiv-xt-btn-primary:active { transform: translateY(1px); box-shadow: none; }

                .xiv-xt-btn-secondary {
                    background: white; color: var(--eb-text-main); border-color: var(--eb-border-dark);
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }
                .xiv-xt-btn-secondary:hover { background: var(--eb-bg-subtle); border-color: #9ca3af; transform: translateY(-1px); }
                .xiv-xt-btn-secondary:active { transform: translateY(1px); box-shadow: none; }

                /* Settings Modal */
                .xiv-xt-overlay {
                    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 2147483649; backdrop-filter: blur(4px);
                    opacity: 0; transition: opacity 0.2s ease; pointer-events: none;
                }
                .xiv-xt-overlay.xiv-xt-visible { opacity: 1; pointer-events: auto; }

                .xiv-xt-settings-modal {
                    background: var(--eb-surface); padding: 1.5rem; border-radius: 12px;
                    width: 90%; max-width: 28rem; box-shadow: var(--eb-shadow-float);
                    transform: translateY(1rem) scale(0.95);
                    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    display: flex; flex-direction: column; gap: 1rem; box-sizing: border-box;
                }
                .xiv-xt-overlay.xiv-xt-visible .xiv-xt-settings-modal { transform: translateY(0) scale(1); }

                .xiv-xt-settings-desc { font-size: 0.875rem; color: var(--eb-text-muted); line-height: 1.5; margin: 0; }
                .xiv-xt-input {
                    width: 100%; padding: 0.75rem 1rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: 0.875rem; color: var(--eb-text-main);
                    border: 1px solid var(--eb-border-dark); border-radius: 8px; background: var(--eb-bg-subtle);
                    box-sizing: border-box; outline: none; transition: all 0.2s;
                }
                .xiv-xt-input:focus { border-color: var(--eb-blue); box-shadow: 0 0 0 3px rgba(54, 89, 227, 0.1); background: var(--eb-surface); }
            `;
            GM_addStyle(css);
        }
    };

    const Extractor = {
        monthsMap: {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        },

        persistedMemory: {},

        getTotalCount() {
            let total = 0;
            Object.values(this.persistedMemory).forEach(set => total += set.size);
            return total;
        },

        parseEvents() {
            const items = document.querySelectorAll('[data-spec="edit-list-item"]');
            const newlyAdded = new Set();
            const timeVenues = ConfigManager.getTimeVenuesArray();
            let count = 0;

            items.forEach(item => {
                try {
                    if (item.querySelector('[data-spec="event-list-item-series"]')) return;

                    const timeEl = item.querySelector('[data-spec="event-list-item-time"], [data-spec="event-list-item-datetime"]');
                    const venueEl = item.querySelector('[data-spec="event-list-item-venue"]');

                    if (!timeEl || !venueEl) return;

                    const timeText = timeEl.textContent.trim();
                    const venueText = venueEl.textContent.trim() || 'Unknown Venue';

                    const dateMatch = timeText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s+(\d{4})/i);

                    // Broadened time extraction regex to catch optional "at" prefixes and optional minutes
                    let timeStr = "";
                    const timeMatch = timeText.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
                    if (timeMatch) {
                        const hour = timeMatch[1];
                        const min = timeMatch[2] ? `:${timeMatch[2]}` : "";
                        const period = timeMatch[3].toUpperCase();
                        timeStr = `${hour}${min}${period}`;
                    }

                    if (dateMatch) {
                        const monthRaw = dateMatch[1].toLowerCase();
                        const month = this.monthsMap[monthRaw];
                        const day = dateMatch[2].padStart(2, '0');
                        const year = dateMatch[3];

                        if (!this.persistedMemory[year]) this.persistedMemory[year] = new Set();

                        let formattedString = `${month}.${day}   ${venueText}`;

                        const requiresTime = timeVenues.some(keyword => venueText.toLowerCase().includes(keyword));
                        if (requiresTime && timeStr) {
                            formattedString += ` - ${timeStr}`;
                        }

                        if (!this.persistedMemory[year].has(formattedString)) {
                            this.persistedMemory[year].add(formattedString);
                            newlyAdded.add(formattedString);
                            count++;
                        }
                    }
                } catch (e) {
                    Logger.error('Failed to parse event card', e);
                }
            });

            Logger.log(`Sweep complete. Added ${count} new unique events to memory.`);
            return newlyAdded;
        },

        formatOutputText() {
            const years = Object.keys(this.persistedMemory).sort((a, b) => parseInt(b) - parseInt(a));
            if (years.length === 0) return "";

            const outputLines = [];
            years.forEach(year => {
                outputLines.push(year);

                const sortedEntries = Array.from(this.persistedMemory[year]).sort((a, b) => a.localeCompare(b));
                sortedEntries.forEach(entry => {
                    outputLines.push(entry);
                });
            });

            return outputLines.join('\n');
        }
    };

    const UI = {
        fabEl: null,
        popupBox: null,
        logContainer: null,
        toastEl: null,
        toastTimeout: null,

        settingsOverlay: null,
        settingsInput: null,

        icons: {
            extract: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h3m10 0h3v3M4 17v3h3m10 0h3v-3M9 8h6m-6 4h6m-6 4h4"/></svg>`,
            close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
            check: `<path d="M20 6L9 17l-5-5"/>`,
            alert: `<path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
            generate: `<svg viewBox="0 0 24 24"><path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/></svg>`,
            clear: `<svg viewBox="0 0 24 24"><path d="M15 16h4v2h-4zm0-8h7v2h-7zm0 4h6v2h-6zM3 18c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V8H3v10zM14 5h-3l-1-1H6L5 5H2v2h12z"/></svg>`,
            copy: `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
            export: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m14-7l-5 5-5-5m5 5V3"/></svg>`
        },

        init() {
            this.buildFAB();
            this.buildToast();
            this.handleEsc = this.handleEsc.bind(this);
            this.handleSettingsEsc = this.handleSettingsEsc.bind(this);
        },

        buildFAB() {
            this.fabEl = DOMBuilder.create('button', {
                className: 'xiv-xt-fab',
                title: 'Open Extractor Panel',
                innerHTML: this.icons.extract,
                onclick: (e) => {
                    e.stopPropagation();
                    this.togglePopup();
                }
            });
            document.body.appendChild(this.fabEl);
        },

        buildToast() {
            this.toastEl = DOMBuilder.create('div', { className: 'xiv-xt-toast' });
        },

        // Security Improvement: Replacing arbitrary innerHTML injection with controlled textContent
        showToast(message, type = 'success') {
            this.toastEl.innerHTML = '';

            const iconSvg = type === 'success' ? this.icons.check : this.icons.alert;
            const iconContainer = document.createElement('div');
            iconContainer.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>`;

            const textNode = document.createElement('span');
            textNode.textContent = message;

            this.toastEl.appendChild(iconContainer.firstElementChild);
            this.toastEl.appendChild(textNode);

            this.toastEl.classList.remove('xiv-xt-success', 'xiv-xt-warning');
            this.toastEl.classList.add(`xiv-xt-${type}`);
            this.toastEl.classList.add('xiv-xt-show');

            clearTimeout(this.toastTimeout);
            this.toastTimeout = setTimeout(() => {
                this.toastEl.classList.remove('xiv-xt-show');
            }, CONFIG.TOAST_DURATION_MS);
        },

        updateHeaderCount() {
            if (!this.popupBox) return;
            const total = Extractor.getTotalCount();
            const titleEl = this.popupBox.querySelector('.xiv-xt-title');
            if (titleEl) {
                titleEl.textContent = `Event Extraction${total > 0 ? ` — ${total} Total` : ''}`;
            }
        },

        togglePopup() {
            if (this.popupBox) {
                if (this.popupBox.classList.contains('xiv-xt-visible')) {
                    this.closePopup();
                } else {
                    this.openPopup();
                }
                return;
            }

            this.logContainer = DOMBuilder.create('div', { className: 'xiv-xt-log-container' });
            const titleText = DOMBuilder.create('h2', { className: 'xiv-xt-title' }, 'Event Extraction');
            const header = DOMBuilder.create('div', { className: 'xiv-xt-header' }, titleText);

            const btnGenerate = DOMBuilder.create('button', {
                className: 'xiv-xt-btn xiv-xt-btn-primary',
                innerHTML: `${this.icons.generate} <span>Generate</span>`,
                onclick: () => this.generateData()
            });
            const btnClear = DOMBuilder.create('button', {
                className: 'xiv-xt-btn xiv-xt-btn-secondary',
                innerHTML: `${this.icons.clear} <span>Clear</span>`,
                onclick: () => this.clearData()
            });
            const btnCopy = DOMBuilder.create('button', {
                className: 'xiv-xt-btn xiv-xt-btn-primary',
                innerHTML: `${this.icons.copy} <span>Copy</span>`,
                onclick: () => this.copyToClipboard()
            });
            const btnExport = DOMBuilder.create('button', {
                className: 'xiv-xt-btn xiv-xt-btn-secondary',
                innerHTML: `${this.icons.export} <span>Export</span>`,
                onclick: () => this.exportData()
            });

            const leftActions = DOMBuilder.create('div', { className: 'xiv-xt-btn-group' }, btnGenerate, btnClear);
            const rightActions = DOMBuilder.create('div', { className: 'xiv-xt-btn-group' }, btnExport, btnCopy);
            const actions = DOMBuilder.create('div', { className: 'xiv-xt-actions' }, leftActions, rightActions);

            this.popupBox = DOMBuilder.create('div', { className: 'xiv-xt-popup' }, header, this.toastEl, this.logContainer, actions);
            document.body.appendChild(this.popupBox);

            requestAnimationFrame(() => this.openPopup());
        },

        openPopup() {
            this.fabEl.innerHTML = this.icons.close;
            this.fabEl.classList.add('xiv-xt-fab-open');
            this.fabEl.title = 'Close Panel';

            this.renderList(new Set());
            this.popupBox.classList.add('xiv-xt-visible');
            document.addEventListener('keydown', this.handleEsc);
        },

        closePopup() {
            if (!this.popupBox) return;

            this.fabEl.innerHTML = this.icons.extract;
            this.fabEl.classList.remove('xiv-xt-fab-open');
            this.fabEl.title = 'Open Extractor Panel';

            this.popupBox.classList.remove('xiv-xt-visible');
            document.removeEventListener('keydown', this.handleEsc);
        },

        buildSettings() {
            this.settingsInput = DOMBuilder.create('input', {
                className: 'xiv-xt-input',
                type: 'text',
                placeholder: 'e.g. pier, skyport, rooftop',
                onkeydown: (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.saveSettings();
                    }
                }
            });

            const title = DOMBuilder.create('h2', { className: 'xiv-xt-title' }, 'Configuration');
            const desc = DOMBuilder.create('p', { className: 'xiv-xt-settings-desc' }, 'Enter venue keywords that require time extraction (comma-separated):');

            const btnCancel = DOMBuilder.create('button', {
                className: 'xiv-xt-btn xiv-xt-btn-secondary',
                innerHTML: 'Cancel',
                onclick: () => this.closeSettings()
            });
            const btnSave = DOMBuilder.create('button', {
                className: 'xiv-xt-btn xiv-xt-btn-primary',
                innerHTML: 'Save',
                onclick: () => this.saveSettings()
            });
            const actions = DOMBuilder.create('div', { className: 'xiv-xt-btn-group', style: 'justify-content: flex-end;' }, btnCancel, btnSave);

            const modal = DOMBuilder.create('div', { className: 'xiv-xt-settings-modal' }, title, desc, this.settingsInput, actions);

            this.settingsOverlay = DOMBuilder.create('div', {
                className: 'xiv-xt-overlay',
                onclick: (e) => { if (e.target === this.settingsOverlay) this.closeSettings(); }
            }, modal);

            document.body.appendChild(this.settingsOverlay);
        },

        openSettings() {
            if (!this.settingsOverlay) {
                this.buildSettings();
            }
            this.settingsInput.value = ConfigManager.timeVenues;

            requestAnimationFrame(() => {
                this.settingsOverlay.classList.add('xiv-xt-visible');
                this.settingsInput.focus();
            });
            document.addEventListener('keydown', this.handleSettingsEsc);
        },

        closeSettings() {
            if (!this.settingsOverlay) return;
            this.settingsOverlay.classList.remove('xiv-xt-visible');
            document.removeEventListener('keydown', this.handleSettingsEsc);
        },

        saveSettings() {
            ConfigManager.timeVenues = this.settingsInput.value;
            this.closeSettings();
            this.showToast('Configuration saved!', 'success');

            if (this.popupBox && this.popupBox.classList.contains('xiv-xt-visible')) {
                this.generateData();
            }
        },

        generateData() {
            if (!this.logContainer) return;
            const newlyAdded = Extractor.parseEvents();

            if (newlyAdded.size === 0) {
                this.showToast('No new events found on this page.', 'warning');
            } else {
                this.showToast(`Extracted ${newlyAdded.size} new event(s)`, 'success');
                this.renderList(newlyAdded);
            }
        },

        clearData() {
            Extractor.persistedMemory = {};
            this.renderList(new Set());
            this.showToast('Memory wiped. Data cleared.', 'warning');
        },

        renderList(newlyAddedSet) {
            this.logContainer.innerHTML = '';

            const years = Object.keys(Extractor.persistedMemory).sort((a, b) => parseInt(b) - parseInt(a));

            if (years.length === 0) {
                const text = DOMBuilder.create('span', {}, 'Click "Generate" to extract and accumulate events from the current page.');
                const placeholder = DOMBuilder.create('div', { className: 'xiv-xt-placeholder' }, text);
                this.logContainer.appendChild(placeholder);
                this.updateHeaderCount();
                return;
            }

            // Performance Improvement: Batched DOM writes using DocumentFragment
            const frag = document.createDocumentFragment();

            years.forEach(year => {
                const yearEl = DOMBuilder.create('div', { className: 'xiv-xt-log-line xiv-xt-year' }, year);
                frag.appendChild(yearEl);

                const sortedEntries = Array.from(Extractor.persistedMemory[year]).sort((a, b) => a.localeCompare(b));
                sortedEntries.forEach(entry => {
                    const lineEl = DOMBuilder.create('div', { className: 'xiv-xt-log-line' }, entry);
                    if (newlyAddedSet.has(entry)) lineEl.classList.add('xiv-xt-log-new');
                    frag.appendChild(lineEl);
                });
            });

            this.logContainer.appendChild(frag);
            this.updateHeaderCount();

            if (newlyAddedSet.size > 0) {
                const firstNewItem = this.logContainer.querySelector('.xiv-xt-log-new');
                if (firstNewItem) {
                    firstNewItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        },

        handleEsc(e) {
            if (e.key === 'Escape') this.closePopup();
        },

        handleSettingsEsc(e) {
            // Need to ensure the event isn't intercepted by text input unnecessarily
            if (e.key === 'Escape') this.closeSettings();
        },

        async copyToClipboard() {
            const textToCopy = Extractor.formatOutputText();
            if (!textToCopy) {
                this.showToast('Nothing to copy!', 'warning');
                return;
            }

            // Compatibility Improvement: Prioritizing modern clipboard API
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(textToCopy);
                    this.showToast('Copied to clipboard!', 'success');
                } else {
                    throw new Error('Clipboard API unavailable, falling back...');
                }
            } catch (err) {
                const tempTA = document.createElement('textarea');
                tempTA.value = textToCopy;
                document.body.appendChild(tempTA);
                tempTA.select();
                try {
                    document.execCommand('copy');
                    this.showToast('Copied to clipboard!', 'success');
                } catch (fallbackErr) {
                    Logger.error('Failed to copy text', fallbackErr);
                    this.showToast('Failed to copy text.', 'warning');
                }
                document.body.removeChild(tempTA);
                window.getSelection().removeAllRanges();
            }
        },

        exportData() {
            const textToCopy = Extractor.formatOutputText();
            if (!textToCopy) {
                this.showToast('Nothing to export!', 'warning');
                return;
            }

            const blob = new Blob([textToCopy], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `eventbrite_extract_${new Date().toISOString().slice(0, 10)}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showToast('Exported to TXT!', 'success');
        }
    };

    const AppLifecycle = {
        init() {
            Styles.init();
            UI.init();

            if (typeof GM_registerMenuCommand !== 'undefined') {
                GM_registerMenuCommand("⚙️ Configure Time-Venues", () => UI.openSettings());
            }

            Logger.log('Extractor module initialized.');
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppLifecycle.init());
    } else {
        AppLifecycle.init();
    }
})();
