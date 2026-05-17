// ==UserScript==
// @name         [RA] Date Jumper
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon-32x32.png
// @version      4.2
// @description  Adds a floating date selector that jumps to specific part of the page.
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
        RA_RED: "#ff4848",
        TEXT_DARK: "#151515",
        SCROLL_OFFSET: 100,
        SCROLL_DURATION_MS: 800,
        STICKY_FADE_THRESHOLD: 150,
        DEBOUNCE_MS: 200,
        ALLOWED_ORIGIN_SUFFIX: "ra.co"
    };

    const ICONS = {
        CALENDAR: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
        CLOSE: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
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
    // STYLING INJECTION (Native RA Theme)
    // ==========================================
    function injectStyles() {
        if (document.getElementById('ra-date-jumper-styles')) return;
        const style = document.createElement('style');
        style.id = 'ra-date-jumper-styles';
        style.textContent = `
            /* Hide native cookie settings badge to prevent overlap */
            #cookiescript_badge { display: none !important; }

            /* Universal Font Stack matching RA */
            .ra-native-font {
                font-family: RobotoMono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
            }

            #ra-date-jumper-container {
                position: fixed;
                bottom: calc(clamp(16px, 3vh, 32px) + env(safe-area-inset-bottom));
                left: clamp(16px, 3vw, 32px);
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }

            /* --- MATCHING "SUBMIT AN EVENT" BUTTON THEME --- */
            .ra-fab-btn {
                background-color: #ffffff !important;
                border: 1px solid ${CONFIG.RA_RED} !important;
                color: ${CONFIG.TEXT_DARK} !important;
                padding: 10px 18px !important;
                border-radius: 50px !important;
                font-size: 11px !important;
                font-weight: 500 !important;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08) !important;
                transition: all 0.2s ease-in-out !important;
                outline: none;
                user-select: none;
                box-sizing: border-box !important;
                height: 35px !important;
            }
            .ra-fab-btn:hover {
                background-color: ${CONFIG.RA_RED} !important;
                color: #ffffff !important;
            }
            .ra-fab-btn:active { transform: scale(0.98); }
            .ra-fab-btn:focus-visible { outline: 3px solid ${CONFIG.TEXT_DARK}; outline-offset: 2px; }
            .ra-fab-btn svg { flex-shrink: 0; display: block; }

            /* Active / Open State */
            .ra-fab-btn.is-open {
                background-color: ${CONFIG.RA_RED} !important;
                color: #ffffff !important;
                box-shadow: 0 4px 14px rgba(255, 72, 72, 0.2) !important;
            }

            /* Fluid Mobile Text Animation */
            .ra-fab-btn .btn-text {
                white-space: nowrap;
                overflow: hidden;
                max-width: 150px;
                opacity: 1;
                transition: max-width 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
            }

            @media (max-width: 768px) {
                .ra-fab-btn {
                    padding: 8px !important;
                    width: 35px !important;
                    height: 35px !important;
                    justify-content: center !important;
                    gap: 0 !important;
                }
                .ra-fab-btn .btn-text {
                    max-width: 0 !important;
                    opacity: 0 !important;
                }
            }

            /* --- MENU PANEL --- */
            .ra-date-menu {
                background: #ffffff;
                width: clamp(180px, 20vw, 240px);
                max-height: 0;
                overflow-y: auto;
                border: 1px solid transparent;
                border-radius: 12px;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                transform-origin: bottom left;
                transform: translateY(15px);
            }
            .ra-date-menu.is-open {
                max-height: clamp(200px, 50vh, 400px);
                border-color: #e2e8f0;
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            .ra-date-menu::-webkit-scrollbar { width: 6px; }
            .ra-date-menu::-webkit-scrollbar-track { background: #f3f4f6; border-radius: 8px; }
            .ra-date-menu::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }

            .ra-date-menu ul { list-style: none; padding: 6px 0; margin: 0; }
            .ra-date-menu li { border-bottom: 1px solid #f3f4f6; }
            .ra-date-menu li:last-child { border-bottom: none; }

            .ra-date-menu a {
                display: block;
                padding: clamp(10px, 1.5vh, 14px) clamp(16px, 1.5vw, 20px);
                color: #4b5563;
                text-decoration: none;
                font-size: 11px;
                font-weight: 500;
                transition: background 0.2s ease, color 0.2s ease, border-left 0.2s ease;
                outline: none;
                border-left: 3px solid transparent;
            }
            .ra-date-menu a:hover, .ra-date-menu a:focus-visible {
                background-color: #f9fafb;
                color: ${CONFIG.TEXT_DARK};
            }
            .ra-date-menu a.is-active {
                background-color: #f3f4f6;
                color: ${CONFIG.TEXT_DARK};
                border-left: 3px solid ${CONFIG.TEXT_DARK};
                font-weight: 700;
            }

            /* --- STICKY ELEVATOR HEADER (Visual Anchor) --- */
            #ra-sticky-header {
                position: fixed;
                top: clamp(60px, 8vh, 80px);
                left: 50%;
                transform: translateX(-50%);
                background-color: ${CONFIG.TEXT_DARK} !important;
                color: #ffffff !important;
                border: none !important;
                padding: 10px 18px !important;
                font-size: 11px !important;
                font-weight: 600;
                z-index: 2147483647;
                border-radius: 50px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
                pointer-events: none;
                opacity: 0;
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
        state.elements.btn.className = 'ra-fab-btn ra-native-font';
        state.elements.btn.setAttribute('aria-label', 'Toggle date menu');

        state.elements.menu = document.createElement('div');
        state.elements.menu.className = 'ra-date-menu ra-native-font';

        state.elements.menuList = document.createElement('ul');
        state.elements.menu.appendChild(state.elements.menuList);

        state.elements.container.appendChild(state.elements.menu);
        state.elements.container.appendChild(state.elements.btn);
        document.body.appendChild(state.elements.container);

        state.elements.stickyHeader = document.createElement('div');
        state.elements.stickyHeader.id = 'ra-sticky-header';
        state.elements.stickyHeader.className = 'ra-native-font';
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

        if (isOpen) {
            state.elements.btn.classList.add('is-open');
        } else {
            state.elements.btn.classList.remove('is-open');
        }
    }

    function openMenu() {
        state.isOpen = true;
        state.elements.menu.classList.add('is-open');
        updateBtnUI(true);
        setTimeout(() => {
            const activeLink = state.elements.menuList.querySelector('a.is-active');
            if (activeLink) activeLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
            if (state.isOpen && !state.elements.container.contains(e.target)) closeMenu();
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

            const newHeaders = [];
            for (let i = 0; i < headerNodes.length; i++) {
                const node = headerNodes[i];
                const text = node.textContent.replace(/[\n\r]+/g, ' ').trim();
                if (text) {
                    const relativeTop = node.getBoundingClientRect().top + iframeScrollY;
                    newHeaders.push({ node, text, relativeTop });
                }
            }
            state.headers = newHeaders;

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

        for (let i = 0; i < state.headers.length; i++) {
            const headerData = state.headers[i];
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
        }
    }

    function observeIframeChanges() {
        try {
            const iframeDoc = state.iframeNode.contentDocument || state.iframeNode.contentWindow.document;
            const observer = new MutationObserver(() => {
                if (state.mutationTimer) clearTimeout(state.mutationTimer);
                state.mutationTimer = setTimeout(cacheHeaderPositions, CONFIG.DEBOUNCE_MS);
            });
            observer.observe(iframeDoc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

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

        for (let i = 0; i < oldTexts.length; i++) {
            const el = oldTexts[i];
            el.classList.remove('is-active');
            el.classList.add(direction === 'down' ? 'is-leaving-up' : 'is-leaving-down');
            setTimeout(() => el.remove(), 300);
        }

        newTextEl.classList.remove('is-entering-up', 'is-entering-down');
        newTextEl.classList.add('is-active');
    }

    function updateScrollSpy(activeText) {
        const links = state.elements.menuList.querySelectorAll('a');
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            if (link.getAttribute('data-target-text') === activeText) {
                link.classList.add('is-active');
            } else {
                link.classList.remove('is-active');
            }
        }
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
