// ==UserScript==
// @name         Advanced Form Filler
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         xx
// @version      1.12
// @description  Modern form filler with customizable element-value pairs
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @match        *://*.posh.vip/*
// @match        *://*.dice.fm/*
// @match        *://*.ra.co/*
// @match        *://*.eventim.us/*
// @match        *://*.boletosexpress.com/*
// @match        *://*.tickeri.com/*
// @match        *://*.feverup.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// @updateURL    https://myouisaur.github.io/Work_CN/advanced-form-filler.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/advanced-form-filler.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Storage key for saving form data
    const STORAGE_KEY = 'advanced_form_filler_data';

    // Create floating button
    function createFloatingButton() {
        const button = document.createElement('div');
        button.id = 'form-filler-button';
        button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="10,9 9,9 8,9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        button.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 48px;
            height: 48px;
            background: #2d2d30;
            border: 1px solid #3f3f46;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 10000;
            color: #e5e7eb;
            backdrop-filter: blur(8px);
        `;

        button.addEventListener('mouseenter', () => {
            button.style.background = '#3f3f46';
            button.style.borderColor = '#52525b';
            button.style.transform = 'translateY(-1px)';
            button.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.4), 0 3px 6px rgba(0, 0, 0, 0.3)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background = '#2d2d30';
            button.style.borderColor = '#3f3f46';
            button.style.transform = 'translateY(0)';
            button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2)';
        });

        document.body.appendChild(button);
        return button;
    }

    // Create popup panel (not modal)
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'form-filler-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 20px;
            width: 420px;
            max-width: calc(100vw - 40px);
            background: #1e1e1e;
            border: 1px solid #3f3f46;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 4px 8px rgba(0, 0, 0, 0.3);
            z-index: 10001;
            opacity: 0;
            visibility: hidden;
            transform: translateY(10px) scale(0.95);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            backdrop-filter: blur(12px);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Segoe UI Variable', Roboto, Helvetica, Arial, sans-serif;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            background: #252526;
            border-bottom: 1px solid #3f3f46;
            padding: 16px 20px;
            border-radius: 12px 12px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = `
            <div style="
                color: #e5e7eb;
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="color: #60a5fa;">
                    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Form Filler
            </div>
            <button id="close-panel" style="
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid #52525b;
                color: #e5e7eb;
                width: 32px;
                height: 32px;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                line-height: 1;
                transition: all 0.15s ease;
            ">×</button>
        `;

        const content = document.createElement('div');
        content.id = 'panel-content';
        content.style.cssText = `
            padding: 16px 20px;
            max-height: 400px;
            overflow-y: auto;
        `;

        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 12px 20px 16px;
            border-top: 1px solid #3f3f46;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            border-radius: 0 0 12px 12px;
            background: #252526;
        `;
        footer.innerHTML = `
            <div style="display: flex; gap: 8px;">
                <button id="add-row" style="
                    background: #0d7377;
                    border: 1px solid #14a085;
                    color: #ffffff;
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                ">+ Add</button>
                <button id="clear-all" style="
                    background: #991b1b;
                    border: 1px solid #dc2626;
                    color: #ffffff;
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s ease;
                ">Clear</button>
            </div>
            <button id="fill-form" style="
                background: #1d4ed8;
                border: 1px solid #2563eb;
                color: #ffffff;
                border-radius: 6px;
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
            ">Fill Form</button>
        `;

        // Add hover effects
        const addBtn = footer.querySelector('#add-row');
        const clearBtn = footer.querySelector('#clear-all');
        const fillBtn = footer.querySelector('#fill-form');

        addBtn.addEventListener('mouseenter', () => {
            addBtn.style.background = '#0f766e';
            addBtn.style.transform = 'translateY(-1px)';
        });
        addBtn.addEventListener('mouseleave', () => {
            addBtn.style.background = '#0d7377';
            addBtn.style.transform = 'translateY(0)';
        });

        clearBtn.addEventListener('mouseenter', () => {
            clearBtn.style.background = '#b91c1c';
            clearBtn.style.transform = 'translateY(-1px)';
        });
        clearBtn.addEventListener('mouseleave', () => {
            clearBtn.style.background = '#991b1b';
            clearBtn.style.transform = 'translateY(0)';
        });

        fillBtn.addEventListener('mouseenter', () => {
            fillBtn.style.background = '#1e40af';
            fillBtn.style.transform = 'translateY(-1px)';
        });
        fillBtn.addEventListener('mouseleave', () => {
            fillBtn.style.background = '#1d4ed8';
            fillBtn.style.transform = 'translateY(0)';
        });

        panel.appendChild(header);
        panel.appendChild(content);
        panel.appendChild(footer);
        document.body.appendChild(panel);

        return panel;
    }

    // Create a compact row for element-value pair
    function createRow(element = '', value = '') {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
            align-items: flex-start;
        `;

        row.innerHTML = `
            <div style="flex: 1; min-width: 0;">
                <div style="
                    color: #a1a1aa;
                    font-size: 11px;
                    font-weight: 500;
                    margin-bottom: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                ">Element</div>
                <textarea
                    class="element-input"
                    placeholder="CSS selector or HTML..."
                    style="
                        width: 100%;
                        padding: 8px 10px;
                        border: 1px solid #3f3f46;
                        border-radius: 6px;
                        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
                        font-size: 12px;
                        resize: none;
                        height: 32px;
                        transition: border-color 0.15s ease, box-shadow 0.15s ease;
                        background: #2d2d30;
                        color: #e5e7eb;
                        box-sizing: border-box;
                    "
                >${element}</textarea>
            </div>
            <div style="flex: 1; min-width: 0;">
                <div style="
                    color: #a1a1aa;
                    font-size: 11px;
                    font-weight: 500;
                    margin-bottom: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                ">Value</div>
                <textarea
                    class="value-input"
                    placeholder="Text to fill..."
                    style="
                        width: 100%;
                        padding: 8px 10px;
                        border: 1px solid #3f3f46;
                        border-radius: 6px;
                        font-size: 12px;
                        resize: none;
                        height: 32px;
                        transition: border-color 0.15s ease, box-shadow 0.15s ease;
                        background: #2d2d30;
                        color: #e5e7eb;
                        box-sizing: border-box;
                    "
                >${value}</textarea>
            </div>
            <button class="remove-row" style="
                background: #991b1b;
                border: 1px solid #dc2626;
                color: #ffffff;
                width: 32px;
                height: 32px;
                border-radius: 4px;
                cursor: pointer;
                margin-top: 20px;
                transition: all 0.15s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                line-height: 1;
                flex-shrink: 0;
            ">×</button>
        `;

        // Add focus effects
        row.querySelectorAll('textarea').forEach(textarea => {
            textarea.addEventListener('focus', () => {
                textarea.style.borderColor = '#60a5fa';
                textarea.style.boxShadow = '0 0 0 2px rgba(96, 165, 250, 0.1)';
            });
            textarea.addEventListener('blur', () => {
                textarea.style.borderColor = '#3f3f46';
                textarea.style.boxShadow = 'none';
            });
        });

        const removeBtn = row.querySelector('.remove-row');
        removeBtn.addEventListener('mouseenter', () => {
            removeBtn.style.background = '#b91c1c';
            removeBtn.style.transform = 'scale(1.05)';
        });
        removeBtn.addEventListener('mouseleave', () => {
            removeBtn.style.background = '#991b1b';
            removeBtn.style.transform = 'scale(1)';
        });

        return row;
    }

    // Load saved data
    function loadSavedData() {
        try {
            const saved = GM_getValue(STORAGE_KEY, '[]');
            return JSON.parse(saved);
        } catch (e) {
            return [];
        }
    }

    // Save data
    function saveData(data) {
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    // Get current form data
    function getCurrentFormData() {
        const rows = document.querySelectorAll('#panel-content > div');
        const data = [];
        rows.forEach(row => {
            const element = row.querySelector('.element-input')?.value.trim();
            const value = row.querySelector('.value-input')?.value.trim();
            if (element && value) {
                data.push({ element, value });
            }
        });
        return data;
    }

    // Update remove button visibility
    function updateRemoveButtonVisibility() {
        const rows = document.querySelectorAll('#panel-content > div');
        rows.forEach((row, index) => {
            const removeBtn = row.querySelector('.remove-row');
            if (rows.length === 1) {
                removeBtn.style.opacity = '0.3';
                removeBtn.style.pointerEvents = 'none';
                removeBtn.style.cursor = 'not-allowed';
            } else {
                removeBtn.style.opacity = '1';
                removeBtn.style.pointerEvents = 'auto';
                removeBtn.style.cursor = 'pointer';
            }
        });
    }

    // Populate panel with saved data
    function populatePanel() {
        const savedData = loadSavedData();
        const content = document.getElementById('panel-content');
        content.innerHTML = '';

        if (savedData.length === 0) {
            content.appendChild(createRow());
        } else {
            savedData.forEach(item => {
                content.appendChild(createRow(item.element, item.value));
            });
        }

        addRowEventListeners();
        updateRemoveButtonVisibility();
    }

    // Add event listeners to remove buttons
    function addRowEventListeners() {
        document.querySelectorAll('.remove-row').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rows = document.querySelectorAll('#panel-content > div');
                if (rows.length > 1) {
                    if (confirm('Remove this row?')) {
                        e.target.closest('div').remove();
                        saveData(getCurrentFormData());
                        updateRemoveButtonVisibility();
                    }
                }
            });
        });
    }

    // Extract selector from element HTML
    function extractSelector(elementText) {
        // If it looks like HTML, extract id or other attributes
        if (elementText.trim().startsWith('<')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = elementText;
            const element = tempDiv.firstElementChild;
            if (element) {
                if (element.id) return '#' + element.id;
                if (element.className) return '.' + element.className.split(' ')[0];
                if (element.name) return `[name="${element.name}"]`;
                return element.tagName.toLowerCase();
            }
        }
        // Otherwise, treat as selector
        return elementText;
    }

    // Fill form function
    function fillForm() {
        const data = getCurrentFormData();
        if (data.length === 0) {
            alert('Please add at least one element-value pair.');
            return;
        }

        let filledCount = 0;
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const textAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

        data.forEach(({ element, value }) => {
            try {
                const selector = extractSelector(element);
                const targetElement = document.querySelector(selector);

                if (targetElement) {
                    targetElement.focus();

                    // Use appropriate setter based on element type
                    if (targetElement.tagName === 'TEXTAREA') {
                        textAreaSetter.call(targetElement, value);
                    } else {
                        s.call(targetElement, value);
                    }

                    // Trigger events
                    const events = ['input', 'change', 'blur', 'keydown', 'keyup'];
                    events.forEach(eventType => {
                        targetElement.dispatchEvent(new Event(eventType, { bubbles: true }));
                    });

                    // Handle React components
                    if (window.React) {
                        const reactKey = Object.keys(targetElement).find(k =>
                            k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber')
                        );
                        if (reactKey) {
                            const reactInstance = targetElement[reactKey];
                            if (reactInstance?.memoizedProps?.onChange) {
                                reactInstance.memoizedProps.onChange({
                                    target: targetElement,
                                    currentTarget: targetElement
                                });
                            }
                        }
                    }

                    filledCount++;
                }
            } catch (error) {
                console.error('Error filling element:', error);
            }
        });

        // Save data and close panel
        saveData(data);
        hidePanel();
        alert(`Successfully filled ${filledCount}/${data.length} fields!`);
    }

    let isVisible = false;

    // Show panel
    function showPanel() {
        const panel = document.getElementById('form-filler-panel');
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';
        panel.style.transform = 'translateY(0) scale(1)';
        isVisible = true;
        populatePanel();
    }

    // Hide panel
    function hidePanel() {
        const panel = document.getElementById('form-filler-panel');
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(10px) scale(0.95)';
        setTimeout(() => {
            panel.style.visibility = 'hidden';
        }, 200);
        isVisible = false;
    }

    // Toggle panel
    function togglePanel() {
        if (isVisible) {
            hidePanel();
        } else {
            showPanel();
        }
    }

    // Initialize
    function init() {
        const button = createFloatingButton();
        const panel = createPanel();

        // Event listeners
        button.addEventListener('click', togglePanel);

        document.getElementById('close-panel').addEventListener('click', hidePanel);

        document.getElementById('add-row').addEventListener('click', () => {
            document.getElementById('panel-content').appendChild(createRow());
            addRowEventListeners();
            updateRemoveButtonVisibility();
        });

        document.getElementById('clear-all').addEventListener('click', () => {
            if (confirm('Clear all data? This cannot be undone.')) {
                document.getElementById('panel-content').innerHTML = '';
                document.getElementById('panel-content').appendChild(createRow());
                addRowEventListeners();
                updateRemoveButtonVisibility();
                GM_setValue(STORAGE_KEY, '[]');
            }
        });

        document.getElementById('fill-form').addEventListener('click', fillForm);

        // Auto-save on input change
        document.addEventListener('input', (e) => {
            if (e.target.matches('.element-input, .value-input')) {
                setTimeout(() => {
                    saveData(getCurrentFormData());
                }, 500);
            }
        });
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
