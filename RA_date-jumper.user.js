// ==UserScript==
// @name         [RA] Date Jumper
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon-32x32.png
// @version      4.1
// @description  Floating date jumper with scroll spy, auto-scrolling menu, premium UI alignment, cross-frame sync, and native UI cleanup.
// @author       Xiv
// @match        *://*.ra.co/pro/events
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/RA_date-jumper.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA_date-jumper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Duplicate execution guard
    if (window.__raDateJumperRunning) return;
    window.__raDateJumperRunning = true;

    // ==========================================
    // CONFIGURATION & CONSTANTS
    // ==========================================
    const CONFIG = {
        IFRAME_SELECTOR: '#iFrameResizer0',
        DATE_HEADER_SELECTOR: 'li.clearfix.f28',
        SCROLL_OFFSET: 100,
        SCROLL_DURATION_MS: 800,
        STICKY_FADE_THRESHOLD: 150,
        DEBOUNCE_MS: 200,
        ALLOWED_ORIGIN_SUFFIX: "ra.co"
    };

    const ICONS = {
        CALENDAR: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
        CLOSE: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
    };

    // ==========================================
    // APP STATE
    // ==========================================
    const state = {
        headers: [],
        iframeNode: null,
        isOpen: false,
        isTicking: false,
        resizeTimer: null,
        mutationTimer: null,
        scrollAnimId: null,
        lastStickyText: '',
        lastScrollY: 0,
        elements: {
            container: null,
            menu: null,
            menuList: null,
            btn: null,
            stickyHeader: null
        }
    };

    // ==========================================
    // STYLING INJECTION
    // ==========================================
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Hide the native cookie settings badge to prevent UI overlap */
            #cookiescript_badge {
                display: none !important;
            }

            #ra-date-jumper-container {
                position: fixed;
                bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom));
                left: clamp(16px, 3vw, 32px);
                z-index: 2147483647;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                flex-direction: column; /* Menu on top, button on bottom */
                align-items: flex-start;
                gap: 12px;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }

            .ra-fab-btn {
                background-color: #111;
                color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.15);
                padding: clamp(8px, 1.5vh, 12px) clamp(16px, 2vw, 20px);
                border-radius: 50px;
                font-family: inherit;
                font-size: clamp(13px, 1vw, 14px);
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                transition: all 0.2s ease;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                outline: none;
                user-select: none;
            }
            .ra-fab-btn:hover { background-color: #222; transform: scale(1.02); }
            .ra-fab-btn:active { transform: scale(0.98); }
            .ra-fab-btn:focus-visible { outline: 3px solid #111; outline-offset: 3px; }
            .ra-fab-btn svg { flex-shrink: 0; display: block; }

            .ra-date-menu {
                background: white;
                width: clamp(180px, 20vw, 240px);
                max-height: 0;
                overflow-y: auto;
                border-radius: 12px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                transform-origin: bottom left;
                transform: translateY(15px); /* Upward slide physics */
            }
            .ra-date-menu.is-open {
                max-height: clamp(200px, 50vh, 400px);
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            .ra-date-menu::-webkit-scrollbar { width: 6px; }
            .ra-date-menu::-webkit-scrollbar-track { background: #f5f5f5; border-radius: 8px; }
            .ra-date-menu::-webkit-scrollbar-thumb { background: #ccc; border-radius: 8px; }

            .ra-date-menu ul { list-style: none; padding: 6px 0; margin: 0; }
            .ra-date-menu li { border-bottom: 1px solid #f9f9f9; }
            .ra-date-menu li:last-child { border-bottom: none; }
            .ra-date-menu a {
                display: block;
                padding: clamp(10px, 1.5vh, 14px) clamp(16px, 1.5vw, 20px);
                color: #444;
                text-decoration: none;
                font-size: clamp(13px, 1vw, 14px);
                font-weight: 500;
                transition: background 0.2s ease, color 0.2s ease, border-left 0.2s ease;
                outline: none;
                border-left: 3px solid transparent;
            }

            /* RA Native styling mimic */
            .ra-date-menu a:hover, .ra-date-menu a:focus-visible {
                background-color: #f5f5f5;
                color: #111;
            }
            .ra-date-menu a.is-active {
                background-color: #f5f5f5;
                color: #111;
                border-left: 3px solid #111;
                font-weight: 600;
            }

            @media (prefers-color-scheme: light) {
                .ra-fab-btn {
                    background-color: #fff;
                    color: #111;
                    border: 1px solid rgba(0, 0, 0, 0.1);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                }
                .ra-fab-btn:hover { background-color: #f5f5f5; }
            }

            /* -----------------------------------------
               Sticky Header - Grid Elevator
               ----------------------------------------- */
            #ra-sticky-header {
                position: fixed;
                top: clamp(60px, 8vh, 80px);
                left: 50%;
                transform: translateX(-50%);
                background-color: rgba(30, 30, 30, 0.95);
                color: white;
                padding: clamp(6px, 1vh, 8px) 0;
                font-size: clamp(13px, 1vw, 14px);
                font-weight: 600;
                z-index: 2147483647;
                border-radius: 20px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                pointer-events: none;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                opacity: 0;
                letter-spacing: 0.5px;
                overflow: hidden;
                min-width: 160px;
                display: grid;
                grid-template-columns: 1fr;
                align-items: center;
                justify-items: center;
                transition: opacity 0.3s ease;
                box-sizing: border-box;
            }

            .ra-sticky-text {
                grid-area: 1 / 1;
                white-space: nowrap;
                transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease;
            }

            .ra-sticky-text.is-active { transform: translateY(0); opacity: 1; }
            .ra-sticky-text.is-entering-up { transform: translateY(100%); opacity: 0; }
            .ra-sticky-text.is-entering-down { transform: translateY(-100%); opacity: 0; }
            .ra-sticky-text.is-leaving-up { transform: translateY(-100%); opacity: 0; }
            .ra-sticky-text.is-leaving-down { transform: translateY(100%); opacity: 0; }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // UI CONSTRUCTION
    // ==========================================
    function buildUI() {
        state.elements.container = document.createElement('div');
        state.elements.container.id = 'ra-date-jumper-container';
        state.elements.container.style.display = 'none';

        state.elements.btn = document.createElement('button');
        state.elements.btn.className = 'ra-fab-btn';
        state.elements.btn.setAttribute('aria-label', 'Toggle date menu');

        state.elements.menu = document.createElement('div');
        state.elements.menu.className = 'ra-date-menu';

        state.elements.menuList = document.createElement('ul');
        state.elements.menu.appendChild(state.elements.menuList);

        state.elements.container.appendChild(state.elements.menu);
        state.elements.container.appendChild(state.elements.btn);
        document.body.appendChild(state.elements.container);

        state.elements.stickyHeader = document.createElement('div');
        state.elements.stickyHeader.id = 'ra-sticky-header';
        document.body.appendChild(state.elements.stickyHeader);

        const isDesktop = window.innerWidth >= 1024;
        if (isDesktop) {
            openMenu();
        } else {
            closeMenu();
        }

        bindEvents();
    }

    function updateBtnUI(isOpen) {
        state.elements.btn.textContent = '';
        state.elements.btn.insertAdjacentHTML('beforeend', isOpen ? ICONS.CLOSE : ICONS.CALENDAR);

        const textSpan = document.createElement('span');
        textSpan.className = 'btn-text';
        textSpan.textContent = isOpen ? 'Close' : 'Jump to Date';

        state.elements.btn.appendChild(textSpan);
        state.elements.btn.title = isOpen ? "Close Date Menu" : "Jump to Date";
    }

    function openMenu() {
        state.isOpen = true;
        state.elements.menu.classList.add('is-open');
        updateBtnUI(true);

        setTimeout(() => {
            const activeLink = state.elements.menuList.querySelector('a.is-active');
            if (activeLink) {
                activeLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    }

    function closeMenu() {
        state.isOpen = false;
        state.elements.menu.classList.remove('is-open');
        updateBtnUI(false);
    }

    function bindEvents() {
        state.elements.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.isOpen ? closeMenu() : openMenu();
        });

        document.addEventListener('click', (e) => {
            if (state.isOpen && !state.elements.container.contains(e.target)) {
                closeMenu();
            }
        });

        window.addEventListener('resize', () => {
            if (state.resizeTimer) clearTimeout(state.resizeTimer);
            state.resizeTimer = setTimeout(cacheHeaderPositions, CONFIG.DEBOUNCE_MS);
        });

        window.addEventListener('scroll', () => {
            if (!state.isTicking) {
                window.requestAnimationFrame(() => {
                    processScrollTick();
                    state.isTicking = false;
                });
                state.isTicking = true;
            }
        }, { passive: true });
    }

    // ==========================================
    // DATA CACHING & DYNAMIC UPDATES
    // ==========================================
    function cacheHeaderPositions() {
        if (!state.iframeNode) return;

        try {
            const iframeDoc = state.iframeNode.contentDocument || state.iframeNode.contentWindow.document;
            const headerNodes = iframeDoc.querySelectorAll(CONFIG.DATE_HEADER_SELECTOR);
            const iframeScrollY = iframeDoc.defaultView.scrollY || iframeDoc.documentElement.scrollTop || 0;

            state.headers = Array.from(headerNodes).map(node => {
                const text = node.textContent.replace(/[\n\r]+/g, ' ').trim();
                const relativeTop = node.getBoundingClientRect().top + iframeScrollY;
                return { node, text, relativeTop };
            }).filter(h => h.text);

            if (state.headers.length === 0) {
                state.elements.container.style.display = 'none';
                state.elements.stickyHeader.style.opacity = '0';
            } else {
                state.elements.container.style.display = 'flex';
                renderMenuList();
                processScrollTick();
            }
        } catch (e) {}
    }

    function renderMenuList() {
        state.elements.menuList.textContent = '';

        state.headers.forEach(headerData => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.textContent = headerData.text;
            a.href = "#";
            a.setAttribute('data-target-text', headerData.text);

            a.addEventListener('click', (e) => {
                e.preventDefault();
                triggerScroll(headerData.relativeTop);
            });

            li.appendChild(a);
            state.elements.menuList.appendChild(li);
        });
    }

    function observeIframeChanges() {
        try {
            const iframeDoc = state.iframeNode.contentDocument || state.iframeNode.contentWindow.document;
            const observer = new MutationObserver(() => {
                if (state.mutationTimer) clearTimeout(state.mutationTimer);
                state.mutationTimer = setTimeout(cacheHeaderPositions, CONFIG.DEBOUNCE_MS);
            });

            observer.observe(iframeDoc.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });

            iframeDoc.addEventListener('click', () => {
                window.top.postMessage({ action: 'RA_CLOSE_MENU' }, '*');
            });
        } catch (e) {}
    }

    // ==========================================
    // CROSS-SCRIPT SYNCHRONIZATION
    // ==========================================
    function isSafeOrigin(origin) {
        return origin && origin.endsWith(CONFIG.ALLOWED_ORIGIN_SUFFIX);
    }

    function initMessageListener() {
        window.addEventListener('message', (e) => {
            if (!isSafeOrigin(e.origin)) return;
            const action = e.data?.action;

            if (action === 'RA_HIDE_LAYOUT' || action === 'RA_SHOW_LAYOUT') {
                if (state.mutationTimer) clearTimeout(state.mutationTimer);
                state.mutationTimer = setTimeout(cacheHeaderPositions, 50);
            }

            if (action === 'RA_CLOSE_MENU' && state.isOpen) {
                closeMenu();
            }
        });
    }

    // ==========================================
    // SCROLL ENGINE & ELEVATOR LOGIC
    // ==========================================

    function updateStickyHeaderText(newText, direction) {
        if (!state.lastStickyText) {
            state.lastStickyText = newText;
            const newTextEl = document.createElement('span');
            newTextEl.className = 'ra-sticky-text is-active';
            newTextEl.textContent = newText;
            state.elements.stickyHeader.appendChild(newTextEl);
            return;
        }

        if (newText === state.lastStickyText) return;
        state.lastStickyText = newText;

        const headerContainer = state.elements.stickyHeader;
        const oldTexts = headerContainer.querySelectorAll('.ra-sticky-text');

        const newTextEl = document.createElement('span');
        newTextEl.className = `ra-sticky-text ${direction === 'down' ? 'is-entering-up' : 'is-entering-down'}`;
        newTextEl.textContent = newText;

        headerContainer.appendChild(newTextEl);

        void newTextEl.offsetWidth;

        oldTexts.forEach(el => {
            el.classList.remove('is-active');
            el.classList.add(direction === 'down' ? 'is-leaving-up' : 'is-leaving-down');
            setTimeout(() => el.remove(), 300);
        });

        newTextEl.classList.remove('is-entering-up', 'is-entering-down');
        newTextEl.classList.add('is-active');
    }

    function updateScrollSpy(activeText) {
        const links = state.elements.menuList.querySelectorAll('a');
        links.forEach(link => {
            if (link.getAttribute('data-target-text') === activeText) {
                link.classList.add('is-active');
            } else {
                link.classList.remove('is-active');
            }
        });
    }

    function processScrollTick() {
        if (state.headers.length === 0 || !state.iframeNode) return;

        const scrollY = window.scrollY;
        const scrollDirection = scrollY > state.lastScrollY ? 'down' : 'up';
        state.lastScrollY = scrollY;

        const threshold = CONFIG.SCROLL_OFFSET + 50;
        const iframeRectTop = state.iframeNode.getBoundingClientRect().top + scrollY;

        let currentText = '';

        for (let i = state.headers.length - 1; i >= 0; i--) {
            const absoluteTop = iframeRectTop + state.headers[i].relativeTop;
            if (scrollY + threshold >= absoluteTop) {
                currentText = state.headers[i].text;
                break;
            }
        }

        if (!currentText && state.headers.length > 0) {
            currentText = state.headers[0].text;
        }

        if (currentText) {
            updateStickyHeaderText(currentText, scrollDirection);
            updateScrollSpy(currentText);
            state.elements.stickyHeader.style.opacity = scrollY > CONFIG.STICKY_FADE_THRESHOLD ? '1' : '0';
        } else {
            state.elements.stickyHeader.style.opacity = '0';
        }
    }

    // --- Interruptible Custom Smooth Scroll ---
    const abortScroll = () => {
        if (state.scrollAnimId) window.cancelAnimationFrame(state.scrollAnimId);
        cleanupScrollListeners();
    };

    const cleanupScrollListeners = () => {
        window.removeEventListener('wheel', abortScroll);
        window.removeEventListener('touchstart', abortScroll);
        window.removeEventListener('keydown', abortScroll);
    };

    function customScrollTo(targetY, duration) {
        abortScroll();

        const startY = window.scrollY;
        const diff = targetY - startY;
        let startTime = null;

        window.addEventListener('wheel', abortScroll, { passive: true, once: true });
        window.addEventListener('touchstart', abortScroll, { passive: true, once: true });
        window.addEventListener('keydown', abortScroll, { passive: true, once: true });

        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            const timeElapsed = timestamp - startTime;
            const progress = Math.min(timeElapsed / duration, 1);
            const ease = 1 - (1 - progress) * (1 - progress);

            window.scrollTo(0, startY + (diff * ease));

            if (timeElapsed < duration) {
                state.scrollAnimId = window.requestAnimationFrame(step);
            } else {
                cleanupScrollListeners();
            }
        }
        state.scrollAnimId = window.requestAnimationFrame(step);
    }

    function triggerScroll(relativeTop) {
        const iframeRectTop = state.iframeNode.getBoundingClientRect().top + window.scrollY;
        const absoluteTop = iframeRectTop + relativeTop;
        const targetPosition = absoluteTop - CONFIG.SCROLL_OFFSET;

        customScrollTo(targetPosition, CONFIG.SCROLL_DURATION_MS);

        if (window.innerWidth < 1024) {
            closeMenu();
        }
    }

    // ==========================================
    // BOOTSTRAP & SPA LIFECYCLE
    // ==========================================
    function initializeSPA() {
        const checkIframe = () => {
            const iframe = document.querySelector(CONFIG.IFRAME_SELECTOR);
            if (iframe) {
                state.iframeNode = iframe;
                injectStyles();
                buildUI();
                initMessageListener();

                iframe.addEventListener('load', () => {
                    cacheHeaderPositions();
                    observeIframeChanges();
                });

                setTimeout(() => {
                    cacheHeaderPositions();
                    observeIframeChanges();
                }, 1000);
            }
        };

        const rootObserver = new MutationObserver(() => {
            const iframe = document.querySelector(CONFIG.IFRAME_SELECTOR);
            if (!iframe && state.iframeNode) {
                state.iframeNode = null;
                if (state.elements.container) state.elements.container.style.display = 'none';
                if (state.elements.stickyHeader) state.elements.stickyHeader.style.opacity = '0';
                closeMenu();
            } else if (iframe && !state.iframeNode) {
                checkIframe();
            }
        });

        rootObserver.observe(document.body, { childList: true, subtree: true });
        checkIframe();
    }

    initializeSPA();

})();
