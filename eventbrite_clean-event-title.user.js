// ==UserScript==
// @name         [Eventbrite] Clean Event Title
// @namespace    https://github.com/myouisaur/Work_CN
// @icon         https://cdn.evbstatic.com/s3-build/prod/2-rc2025-08-21_20.04-py27-7956025/django/images/favicons/favicon.ico
// @version      1.2
// @description  Removes "Copy of " prefix.
// @author       Xiv
// @match        *://*.eventbrite.com/*
// @grant        none
// @updateURL    https://myouisaur.github.io/Work_CN/eventbrite_clean-event-title.user.js
// @downloadURL  https://myouisaur.github.io/Work_CN/eventbrite_clean-event-title.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_ID = 'eb-userscript-clean-title';

    // Helper: Force React to recognize the value change
    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function cleanTitleLogic() {
        const titleInput = document.querySelector('input#title');
        if (titleInput && titleInput.value.startsWith("Copy of ")) {
            const newValue = titleInput.value.replace(/^Copy of /, '');
            setNativeValue(titleInput, newValue);
        } else if (titleInput && !titleInput.value.startsWith("Copy of ")) {
            console.log("Title does not start with 'Copy of '");
        }
    }

    function injectButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const titleInput = document.getElementById('title');
        // Find the main section container (the wrapper from your HTML snippet)
        const container = titleInput?.closest('.eds-l-pad-top-4');

        if (container) {
            // Make the container the reference point for the button
            container.style.position = 'relative';

            const cleanBtn = document.createElement('button');
            cleanBtn.id = BUTTON_ID;
            cleanBtn.type = 'button';
            cleanBtn.className = 'eds-btn eds-btn--button eds-btn--neutral eds-btn--small';
            cleanBtn.innerText = 'Remove "Copy of"';

            // Styling to place it in the "Red Circle" area
            Object.assign(cleanBtn.style, {
                position: 'absolute',
                top: '-45px',      // Moves it up next to the "Copy Event" header
                right: '0px',      // Aligns it to the right edge
                border: '1px solid #3d64ff',
                color: '#3d64ff',
                zIndex: '10',      // Ensures it stays clickable
                backgroundColor: 'white'
            });

            cleanBtn.addEventListener('click', cleanTitleLogic);
            container.appendChild(cleanBtn);
        }
    }

    const observer = new MutationObserver(() => {
        if (document.getElementById('title') && !document.getElementById(BUTTON_ID)) {
            injectButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
