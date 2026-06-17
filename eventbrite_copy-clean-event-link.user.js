// ==UserScript==
// @name         [Eventbrite] Copy Clean Event Link
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://www.eventbrite.com/favicon.ico
// @version      1.2
// @description  Adds a floating button to instantly copy a shortened, tracker-free event URL.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @run-at       document-start
// @noframes
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_copy-clean-event-link.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_copy-clean-event-link.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Prevent duplicate initialization on SPA rerenders
    if (window.__xivEbLinkCopierRunning) return;
    window.__xivEbLinkCopierRunning = true;

    const CONFIG = {
        colors: {
            bg: '#d1410c', // Eventbrite Accent
            text: '#ffffff',
            hoverBg: '#e5480d' // Slightly lighter for tactile feedback
        },
        classes: {
            button: 'xiv-eb-clean-link-btn',
            iconWrapper: 'xiv-eb-icon-wrapper',
            text: 'xiv-eb-text',
            hidden: 'xiv-eb-hidden'
        },
        timings: {
            feedbackMs: 2000
        },
        zIndex: 2147483647 // Max 32-bit int to guarantee it stays above site overlays
    };

    let buttonElement = null;
    let textSpanElement = null;
    let currentCleanUrl = null;
    let feedbackTimeout = null;

    /**
     * Extracts the numeric Event ID from an Eventbrite URL.
     * Handles both shortened (/e/123) and slug (/e/name-tickets-123) formats.
     */
    const extractEventId = (url) => {
        const match = url.match(/\/e\/(?:.*?-)?(\d+)(?:[/?#]|$)/);
        return match ? match[1] : null;
    };

    /**
     * Generates a safe SVG element without using innerHTML.
     */
    const createCopyIcon = () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('fill', 'currentColor');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // Standard copy icon path
        path.setAttribute('d', 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H8V6h11v14z');

        svg.appendChild(path);
        return svg;
    };

    /**
     * Injects scoped CSS dynamically.
     */
    const injectStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
            .${CONFIG.classes.button} {
                position: fixed;
                top: clamp(75px, 10vh, 90px); /* Positioned safely below the top header */
                left: clamp(16px, 2vw, 24px);
                z-index: ${CONFIG.zIndex};
                background-color: ${CONFIG.colors.bg};
                color: ${CONFIG.colors.text};
                border: none;
                border-radius: 22px; /* Circular radius for 44px height */
                height: 44px;
                width: 44px; /* Starts as a perfect circle */
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease, box-shadow 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                overflow: hidden;
                white-space: nowrap;
            }
            .${CONFIG.classes.button}:hover {
                width: 170px; /* Expands to pill shape */
                background-color: ${CONFIG.colors.hoverBg};
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
            }
            .${CONFIG.classes.button}:active {
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            .${CONFIG.classes.iconWrapper} {
                min-width: 44px; /* Matches button height */
                width: 44px;
                height: 100%;
                display: flex;
                justify-content: center;
                align-items: center;
                flex-shrink: 0; /* Ensures the icon area never squishes */
            }
            .${CONFIG.classes.text} {
                flex-shrink: 0; /* Forces text to hold its shape while masked by overflow: hidden */
                padding-right: 16px; /* Spacing on the right edge when expanded */
            }
            .${CONFIG.classes.button}.${CONFIG.classes.hidden} {
                display: none !important;
            }
        `;
        document.documentElement.appendChild(style);
    };

    /**
     * Temporarily changes button text to provide success feedback.
     */
    const showFeedback = (message) => {
        if (!textSpanElement) return;

        clearTimeout(feedbackTimeout);
        textSpanElement.textContent = message;

        feedbackTimeout = setTimeout(() => {
            textSpanElement.textContent = 'Copy Clean Link';
        }, CONFIG.timings.feedbackMs);
    };

    /**
     * Fallback copy mechanism for older browsers or if Clipboard API permissions fail.
     */
    const fallbackCopy = (text) => {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showFeedback('Copied!');
        } catch (err) {
            console.error('[Eventbrite Clean Link] Fallback copy failed', err);
            showFeedback('Failed');
        }
    };

    /**
     * Main click handler.
     */
    const handleCopy = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!currentCleanUrl) return;

        try {
            await navigator.clipboard.writeText(currentCleanUrl);
            showFeedback('Copied!');
        } catch (err) {
            console.warn('[Eventbrite Clean Link] Clipboard API failed, attempting fallback...', err);
            fallbackCopy(currentCleanUrl);
        }
    };

    /**
     * Constructs and injects the UI. Handles document-start timing gracefully.
     */
    const injectButton = () => {
        if (buttonElement) return;

        buttonElement = document.createElement('button');
        buttonElement.className = CONFIG.classes.button;
        buttonElement.setAttribute('aria-label', 'Copy Clean Event URL');

        const iconWrapper = document.createElement('div');
        iconWrapper.className = CONFIG.classes.iconWrapper;
        iconWrapper.appendChild(createCopyIcon());

        textSpanElement = document.createElement('span');
        textSpanElement.className = CONFIG.classes.text;
        textSpanElement.textContent = 'Copy Clean Link';

        buttonElement.appendChild(iconWrapper);
        buttonElement.appendChild(textSpanElement);

        buttonElement.addEventListener('click', handleCopy);

        // Inject into body if ready, otherwise documentElement (html) for instant render
        const target = document.body || document.documentElement;
        target.appendChild(buttonElement);

        // If injected into html, migrate it to body safely once body parses
        if (!document.body) {
            const bodyObserver = new MutationObserver((mutations, obs) => {
                if (document.body) {
                    document.body.appendChild(buttonElement);
                    obs.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
        }
    };

    /**
     * Re-evaluates the current URL. Hides the button if not on an event page.
     */
    const evaluateUrl = () => {
        const eventId = extractEventId(window.location.href);

        if (eventId) {
            currentCleanUrl = `https://www.eventbrite.com/e/${eventId}`;
            if (buttonElement) {
                buttonElement.classList.remove(CONFIG.classes.hidden);
            }
        } else {
            currentCleanUrl = null;
            if (buttonElement) {
                buttonElement.classList.add(CONFIG.classes.hidden);
            }
        }
    };

    /**
     * Hooks into the History API to handle SPA navigation seamlessly.
     */
    const setupSPAObserver = () => {
        const originalPush = history.pushState;
        const originalReplace = history.replaceState;

        history.pushState = function() {
            originalPush.apply(this, arguments);
            window.dispatchEvent(new Event('xiv-locationchange'));
        };

        history.replaceState = function() {
            originalReplace.apply(this, arguments);
            window.dispatchEvent(new Event('xiv-locationchange'));
        };

        window.addEventListener('popstate', () => {
            window.dispatchEvent(new Event('xiv-locationchange'));
        });

        window.addEventListener('xiv-locationchange', () => {
            evaluateUrl();
            // Re-append the button if the SPA framework wiped it during navigation
            if (buttonElement && document.body && !document.body.contains(buttonElement)) {
                document.body.appendChild(buttonElement);
            }
        });
    };

    /**
     * Initialization Sequence
     */
    const init = () => {
        injectStyles();
        injectButton();
        evaluateUrl();
        setupSPAObserver();
    };

    // Execute immediately. Safe because document.documentElement exists at document-start.
    init();

})();
