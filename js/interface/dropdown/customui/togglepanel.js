// Defines Sliding Panels: the sections of the Neurite account modal. The five that were in
// the Ai and Fractal panels are headed groups now, always open (#32), and the function
// console, which folded at the foot of the menu, is a `<details>` in the Ai panel (#78).

function togglePanel(panelContainer) {
    // Close any open custom dropdowns within the panel
    const openDropdowns = panelContainer.querySelectorAll('.options-replacer.show');
    openDropdowns.forEach(dropdown => {
        dropdown.classList.remove('show');
        const dropdownContainer = dropdown.closest('.select-replacer');
        if (dropdownContainer) {
            dropdownContainer.classList.add('closed');
        }
    });

    // Check if the panel is open or hidden
    if (panelContainer.classList.contains('hidden')) {
        panelContainer.classList.add('panel-open');
        panelContainer.classList.remove('hidden');
        panelContainer.style.display = ''; // Make it visible for height calculation
        panelContainer.inert = false;

        // Directly set the height to start the transition
        panelContainer.style.height = panelContainer.scrollHeight + 'px';
        // Then let the height go, once it has opened: frozen at what it measured now, a
        // panel clipped whatever grew in it afterwards -- a list opening inside it, a
        // label that rewrapped (#32).
        On.transitionend(panelContainer, function release(e){
            if (e.target !== panelContainer) return;

            Off.transitionend(panelContainer, release);
            if (panelContainer.classList.contains('panel-open')) panelContainer.style.height = 'auto';
        });
    } else {
        // From the height it has now, since `auto` to 0 does not transition.
        panelContainer.style.height = panelContainer.scrollHeight + 'px';
        void panelContainer.offsetHeight;

        // Close the panel
        panelContainer.classList.remove('panel-open');
        panelContainer.style.height = '0px'; // Trigger the collapse animation
        // Folded is out of reach: at height 0 its controls were still Tab stops, so a walk
        // through the menu went on into a console nobody could see.
        panelContainer.inert = true;

        // Wait for the transition to finish before adding 'hidden'
        function onTransitionEnd() {
            panelContainer.classList.add('hidden');
            panelContainer.style.display = 'none'; // Fully hide after animation
            Off.transitionend(panelContainer, onTransitionEnd);
        }
        On.transitionend(panelContainer, onTransitionEnd, { once: true });
    }
    return panelContainer.classList.contains('panel-open');
}
