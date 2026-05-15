// ==UserScript==
// @name         [Eventbrite] Frontend Enhancements
// @namespace    https://github.com/myouisaur/Eventbrite
// @icon         https://www.eventbrite.com/favicon.ico
// @version      1.7
// @description  Extracts high-resolution media, scales images to fit, and auto-expands descriptions on Eventbrite.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @noframes
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_frontend-enhancements.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_frontend-enhancements.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---------- Duplicate Execution Guard ----------
    if (window.__xivEbMediaEnhancerRunning) return;
    window.__xivEbMediaEnhancerRunning = true;

    // ---------- Configuration ----------
    const CONFIG = {
        selectors: {
            descriptionImage: '[data-testid="image-content"] img, .StructuredModuleRenderer_imageContent__mBfWj img',
            mainContainer: '.AboutThisEventEmbedded_container__wdFiD, [data-testid="event-details"]',
            readMoreBtn: 'button[aria-label="Read more about this event"]'
        },
        ui: {
            debounceMs: 250,
            successDurationMs: 2000
        }
    };

    // ---------- State ----------
    const processedElements = new WeakSet();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    // ---------- Icons (SVG Strings) ----------
    const ICONS = {
        download: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
        open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
        spinner: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="xiv-spin" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`,
        check: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    };

    // ---------- Styling ----------
    const STYLES = `
        /* Viewing Enhancements */
        .xiv-media-outer {
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
            width: 100% !important;
            height: auto !important;
            position: relative !important;
        }

        .xiv-media-inner {
            position: relative !important;
            display: inline-block !important; /* Hugs the image tightly for absolute button anchoring */
            max-width: 100% !important;
            height: auto !important;
        }

        .xiv-media-fit {
            display: block !important;
            max-height: 98vh !important;
            max-width: 100% !important;
            width: auto !important;
            height: auto !important;
            object-fit: contain !important;
            position: relative !important;
            inset: auto !important;
            margin: 0 auto !important;
        }

        /* Overlay Buttons */
        .xiv-eb-btn-container {
            position: absolute !important;
            top: clamp(0.5rem, 1.5vw, 1rem) !important;
            right: clamp(0.5rem, 1.5vw, 1rem) !important;
            display: flex !important;
            gap: clamp(0.5rem, 1vw, 0.75rem) !important;
            z-index: 999999 !important;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }

        .xiv-media-inner:hover .xiv-eb-btn-container {
            opacity: 1 !important;
            pointer-events: auto !important;
        }

        .xiv-eb-btn {
            width: clamp(32px, 3.5vw, 40px) !important;
            height: clamp(32px, 3.5vw, 40px) !important;
            background: rgba(0, 0, 0, 0.5) !important;
            backdrop-filter: blur(8px) !important;
            -webkit-backdrop-filter: blur(8px) !important;
            color: #ffffff !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
            transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
        }

        .xiv-eb-btn svg {
            width: 50% !important;
            height: 50% !important;
            display: block !important;
            fill: none !important;
            overflow: visible !important;
        }

        .xiv-eb-btn:hover {
            transform: scale(1.05) !important;
            background: rgba(0, 0, 0, 0.8) !important;
            border-color: rgba(255, 255, 255, 0.4) !important;
        }

        .xiv-eb-btn:active {
            transform: scale(0.95) !important;
        }

        .xiv-eb-btn[data-loading="1"] {
            pointer-events: none;
            opacity: 0.8;
        }

        @keyframes xiv-spin {
            100% { transform: rotate(360deg); }
        }
        .xiv-spin {
            animation: xiv-spin 1s linear infinite;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(STYLES);
    } else {
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ---------- Core Utilities ----------
    function generateId(len = 12) {
        return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }

    function createIconElement(svgString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        return doc.documentElement;
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // ---------- Layout Enhancements ----------
    function autoExpandDescription() {
        const readMoreBtn = document.querySelector(CONFIG.selectors.readMoreBtn);
        if (readMoreBtn && !readMoreBtn.dataset.xivClicked) {
            readMoreBtn.dataset.xivClicked = "true"; // Prevent infinite click loops
            readMoreBtn.click();
        }
    }

    // ---------- Image Processing ----------
    async function getHighResUrl(img) {
        return new Promise((resolve) => {
            try {
                if (img.srcset) {
                    const sources = img.srcset.split(',').map(s => s.trim());
                    let maxW = 0;
                    let bestUrl = img.src;

                    // Parse the srcset to find the highest width variant
                    for (const source of sources) {
                        const parts = source.split(/\s+/);
                        if (parts.length >= 2) {
                            const url = parts[0];
                            const w = parseInt(parts[1], 10);
                            if (w > maxW) {
                                maxW = w;
                                bestUrl = url;
                            }
                        }
                    }

                    // The srcset URL might be relative (e.g., "/e/_next/image...")
                    // Resolve as an absolute URL based on current host
                    return resolve(new URL(bestUrl, window.location.href).href);
                }

                resolve(img.src);
            } catch (e) {
                resolve(img.src);
            }
        });
    }

    function downloadImage(url, filename) {
        return new Promise((resolve) => {
            fetch(url)
                .then(r => r.ok ? r.blob() : Promise.reject(new Error("Network response not ok")))
                .then(blob => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                    resolve();
                })
                .catch(() => {
                    // Fallback if CORS prevents direct fetch
                    window.open(url, '_blank', 'noopener,noreferrer');
                    resolve();
                });
        });
    }

    // ---------- UI Interactions ----------
    async function executeWithVisualFeedback(btn, baseIcon, actionFn, showSuccess = true) {
        if (btn.dataset.loading === "1") return;

        btn.dataset.loading = "1";
        btn.replaceChildren(createIconElement(ICONS.spinner));

        try {
            await actionFn();
            if (showSuccess) {
                btn.replaceChildren(createIconElement(ICONS.check));
            } else {
                btn.replaceChildren(createIconElement(baseIcon));
            }
        } catch (error) {
            console.error("[Eventbrite Media Enhancer] Action failed:", error);
            btn.replaceChildren(createIconElement(baseIcon));
        } finally {
            if (showSuccess) {
                setTimeout(() => {
                    delete btn.dataset.loading;
                    btn.replaceChildren(createIconElement(baseIcon));
                }, CONFIG.ui.successDurationMs);
            } else {
                delete btn.dataset.loading;
            }
        }
    }

    // ---------- DOM Injection ----------
    function constructOverlay(imgEl, wrapper, filename) {
        const container = document.createElement('div');
        container.className = 'xiv-eb-btn-container';

        // Open Button
        const openBtn = document.createElement('div');
        openBtn.className = 'xiv-eb-btn';
        openBtn.title = 'Open High-Res Image';
        openBtn.appendChild(createIconElement(ICONS.open));
        openBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            executeWithVisualFeedback(openBtn, ICONS.open, async () => {
                const url = await getHighResUrl(imgEl);
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
            }, false);
        });

        // Download Button
        const dlBtn = document.createElement('div');
        dlBtn.className = 'xiv-eb-btn';
        dlBtn.title = 'Download Image';
        dlBtn.appendChild(createIconElement(ICONS.download));
        dlBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            executeWithVisualFeedback(dlBtn, ICONS.download, async () => {
                const url = await getHighResUrl(imgEl);
                if (url) await downloadImage(url, filename);
            });
        });

        container.appendChild(openBtn);
        container.appendChild(dlBtn);

        wrapper.appendChild(container);
    }

    function evaluateAndTag(img) {
        if (processedElements.has(img)) return;

        // Ensure this image is part of the event description payload
        if (!img.closest(CONFIG.selectors.mainContainer)) return;

        processedElements.add(img);

        // Apply viewing enhancements
        img.classList.add('xiv-media-fit');

        const parent = img.parentElement;
        if (!parent) return;

        // 1. Mark original parent to display as flexible container
        parent.classList.add('xiv-media-outer');

        // 2. Create a tightly wrapped inner container that fits the image's dimensions
        const tightWrapper = document.createElement('div');
        tightWrapper.className = 'xiv-media-inner';

        // 3. Move the image inside this new wrapper
        parent.insertBefore(tightWrapper, img);
        tightWrapper.appendChild(img);

        // Extract metadata for download naming
        const res = `${img.naturalWidth || img.offsetWidth || 0}x${img.naturalHeight || img.offsetHeight || 0}`;
        const ext = img.src.includes('.png') ? 'png' : 'jpg';
        const filename = `eventbrite-media-${res}-${generateId(8)}.${ext}`;

        // 4. Construct the overlay inside the tight wrapper
        constructOverlay(img, tightWrapper, filename);
    }

    const processTargets = debounce(() => {
        // Auto-expand the description to trigger lazy loading of hidden media
        autoExpandDescription();

        // Process visible images
        const images = document.querySelectorAll(CONFIG.selectors.descriptionImage);
        for (const img of images) {
            if (img.complete) {
                evaluateAndTag(img);
            } else {
                img.addEventListener('load', () => evaluateAndTag(img), { once: true });
            }
        }
    }, CONFIG.ui.debounceMs);


    // ---------- Lifecycle Observers ----------
    const domObserver = new MutationObserver((mutations) => {
        let requiresCheck = false;
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                requiresCheck = true;
                break;
            }
        }
        if (requiresCheck) processTargets();
    });

    function initObserver() {
        domObserver.observe(document.body, { childList: true, subtree: true });
        processTargets();
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            domObserver.disconnect();
        } else {
            initObserver();
        }
    });

    // Start
    initObserver();

})();
