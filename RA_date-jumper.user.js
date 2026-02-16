// ==UserScript==
// @name         [RA] Date Jumper
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://ra.co/static/favicon-32x32.png
// @version      3.2
// @description  Adds a floating button to jump dates within the page.
// @author       Xiv
// @match        *://*.ra.co/pro/events
// @grant        none
// @run-at       document-end
// @updateURL    https://myouisaur.github.io/Work_CN/RA_date-jumper.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/RA_date-jumper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const IFRAME_SELECTOR = '#iFrameResizer0';
    const DATE_HEADER_SELECTOR = 'li.clearfix.f28';
    const CONTAINER_ID = 'ra-date-jumper-container';
    const SCROLL_OFFSET = 100; // Space above the header (in pixels)
    const SCROLL_DURATION = 800; // Animation speed in ms

    // --- CSS Styles ---
    const styles = `
        /* Container */
        #${CONTAINER_ID} {
            position: fixed;
            bottom: 30px;
            left: 30px;
            z-index: 2147483647;
            font-family: 'Helvetica Neue', Arial, sans-serif;
            display: flex;
            flex-direction: column-reverse;
            align-items: flex-start;
        }

        /* FAB Button */
        .ra-fab-btn {
            width: 56px;
            height: 56px;
            background-color: #ff4848;
            color: white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.2s ease, background 0.2s;
            font-size: 24px;
            user-select: none;
        }
        .ra-fab-btn:hover { transform: scale(1.05); background-color: #e03e3e; }
        .ra-fab-btn:active { transform: scale(0.95); }

        /* Menu */
        .ra-date-menu {
            background: white;
            width: 180px;
            max-height: 0;
            overflow-y: auto;
            border-radius: 12px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.2);
            margin-bottom: 15px;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            transform-origin: bottom left;
            transform: scale(0.8) translateY(20px);
        }

        .ra-date-menu.open {
            max-height: 50vh;
            opacity: 1;
            visibility: visible;
            transform: scale(1) translateY(0);
        }

        /* Menu Scrollbar */
        .ra-date-menu::-webkit-scrollbar { width: 6px; }
        .ra-date-menu::-webkit-scrollbar-track { background: #f5f5f5; border-radius: 8px; }
        .ra-date-menu::-webkit-scrollbar-thumb { background: #ccc; border-radius: 8px; }

        /* Links */
        .ra-date-menu ul { list-style: none; padding: 0; margin: 0; }
        .ra-date-menu li { border-bottom: 1px solid #f0f0f0; }
        .ra-date-menu a {
            display: block;
            padding: 12px 16px;
            color: #333;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.2s;
        }
        .ra-date-menu a:hover {
            background-color: #fff0f0;
            color: #ff4848;
        }
    `;

    // --- Custom Smooth Scroll Engine ---
    function customScrollTo(targetY, duration) {
        const startY = window.scrollY;
        const diff = targetY - startY;
        let startTime = null;

        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            const timeElapsed = timestamp - startTime;
            const progress = Math.min(timeElapsed / duration, 1);

            // Ease Out Quad Formula
            const ease = 1 - (1 - progress) * (1 - progress);

            window.scrollTo(0, startY + (diff * ease));

            if (timeElapsed < duration) {
                window.requestAnimationFrame(step);
            }
        }

        window.requestAnimationFrame(step);
    }

    function triggerScroll(element, iframe) {
        if (!element) return;

        const iframeRect = iframe.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        const absoluteTop = window.scrollY + iframeRect.top + elementRect.top;
        const targetPosition = absoluteTop - SCROLL_OFFSET;

        customScrollTo(targetPosition, SCROLL_DURATION);
    }

    // --- Initialization ---
    function init() {
        const iframe = document.querySelector(IFRAME_SELECTOR);
        if (!iframe) {
            setTimeout(init, 500);
            return;
        }

        let attempts = 0;
        const checkRows = setInterval(() => {
            attempts++;
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const headers = iframeDoc.querySelectorAll(DATE_HEADER_SELECTOR);

                if (headers.length > 0) {
                    clearInterval(checkRows);
                    buildUI(headers, iframe);
                }
            } catch (e) {
                // Ignore cross-origin issues
            }
            if (attempts > 20) clearInterval(checkRows);
        }, 500);
    }

    function buildUI(headers, iframe) {
        // Inject CSS
        const styleNode = document.createElement('style');
        styleNode.textContent = styles;
        document.head.appendChild(styleNode);

        // Container
        const container = document.createElement('div');
        container.id = CONTAINER_ID;

        // FAB Button
        const btn = document.createElement('div');
        btn.className = 'ra-fab-btn';
        btn.innerHTML = '📅';
        btn.title = "Jump to Date";

        // Menu
        const menu = document.createElement('div');
        menu.className = 'ra-date-menu';
        const ul = document.createElement('ul');

        headers.forEach((header) => {
            const text = header.innerText.replace(/[\n\r]+/g, ' ').trim();
            if (!text) return;

            const li = document.createElement('li');
            const a = document.createElement('a');
            a.innerText = text;
            a.href = "#";

            a.addEventListener('click', (e) => {
                e.preventDefault();
                triggerScroll(header, iframe);
                // NOTE: removed the auto-close logic here
            });

            li.appendChild(a);
            ul.appendChild(li);
        });

        menu.appendChild(ul);
        container.appendChild(menu);
        container.appendChild(btn);
        document.body.appendChild(container);

        // Toggle Actions
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.classList.toggle('open');
            btn.innerHTML = isOpen ? '✕' : '📅';
        });

        // Close when clicking outside (still good for UX)
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                menu.classList.remove('open');
                btn.innerHTML = '📅';
            }
        });

        console.log(`[RA Nav] Loaded ${headers.length} dates.`);
    }

    // Start
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

})();
