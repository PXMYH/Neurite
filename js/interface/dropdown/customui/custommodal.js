const Modals = {
    aiModal: new Modal('aiModal', "Experimental Ai Settings"),
    apiConfigModalContent: new Modal('apiConfigModalContent', "Custom Endpoint"),
    "controls-modal": new Modal('controls-modal', "Adjust Controls"),
    fileTreeModal: new Modal('fileTreeModal'),
    importLinkModalContent: new Modal('importLinkModalContent', "Import Text"),
    nodeConnectionModal: new Modal('nodeConnectionModal', "Connect Notes"),
    // Not openable: there is no `#noteModal` element to clone from. It is kept
    // because it is the store id the Zettelkasten controls persist under, and
    // `Modal.storeInputValue` keys its `ZetPath.updateOptions()` side effect off
    // that id. The controls themselves are in the Settings tab.
    noteModal: new Modal('noteModal', "Zettelkasten Settings"),
    ollamaManagerModal: new Modal('ollamaManagerModal', "Ollama Library"),
    promptLibraryModalContent: new Modal('promptLibraryModalContent', "Prompt Library"),
    vectorDbImportConfirmModal: new Modal('vectorDbImportConfirmModal', "Confirm Vector DB Import"),
    vectorDbModal: new Modal('vectorDbModal', "Vector Database"),
    vectorDbSearchModal: new Modal('vectorDbSearchModal', "Search Vector-DB"),
    // Nodes, not notes: it walks every Node in the Graph and ignores Panes. The
    // button that opens it is in the tool bar for the same reason.
    zetSearchModal: new Modal('zetSearchModal', "Search Nodes"),
    'neurite-modal': new Modal('neurite-modal', "Neurite"),
    // The three that wait for an answer, where the keyboard stays until it is given
    // (`Modal.holdTab`). The others are tools used beside the Graph, which stays in reach.
    // An alert or a confirm is an `alertdialog`, described by its message
    // (`customdialog.js`); a prompt names its box with the message instead.
    alertModal: Object.assign(new Modal('alertModal', 'Alert'), { customClass: 'alert-modal', asks: true, role: 'alertdialog' }),
    confirmModal: Object.assign(new Modal('confirmModal', 'Confirm'), { asks: true, role: 'alertdialog' }),
    // "Question", not "Prompt": a caller that names it nothing is asking the reader
    // something, and in this app a prompt is what is sent to a model.
    promptModal: Object.assign(new Modal('promptModal', 'Question'), { asks: true })
}

Modal.btnClose = Modal.div.querySelector('.close');
Modal.content = Modal.div.querySelector('.modal-content');
Modal.overlay = Modal.div.querySelector('.modal-overlay');
Modal.overlayCloseBtn = Modal.div.querySelector('.modal-overlay-close');
Modal.overlayBody = Modal.div.querySelector('.modal-overlay-body');

Modal.storeInputValue = debounce(function (input, contentId) {
    Modal.inputValues[input.id] = (input.type === 'checkbox' ? input.checked : input.value);
    localStorage.setItem('modalInputValues', JSON.stringify(Modal.inputValues));

    // modal-specific actions
    if (contentId === 'noteModal') ZetPath.updateOptions();
}, 100);

Modal.currentCustomClass = null;

Modal.open = function (contentId) {
    App.menuContext.hide();
    Logger.debug("Opened Modal:", contentId);

    // A dialog this one replaces is left unanswered, and its caller told so.
    Modal.settleUnanswered();

    // Where the keyboard was, to go back to: after a Rename it was left on `body`, twelve
    // Tabs from the button. Read before the body is replaced, which takes the focused
    // control with it. A dialog opened from inside another -- the alert Custom Endpoint
    // shows -- keeps the first one's, since the focus is in the modal or lost; but one
    // opened while the reader works beside an open modal goes back to where they were:
    // an alert over Search Nodes took the note's next keystroke to the tool bar.
    const at = document.activeElement;
    if (!Modal.current || (at !== document.body && !Modal.div.contains(at))) Modal.returnFocus = at;
    Modal.div.removeAttribute('aria-describedby');

    // Clear filepath input from header.
    const existingInput = document.querySelector('.modal-filepath-input');
    if (existingInput) existingInput.remove();

    const content = Elem.byId(contentId);
    if (!content) {
        Logger.err("No content found for ID:", contentId);
        return;
    }

    const modalBody = Modal.div.querySelector('.modal-body');
    if (!modalBody) {
        Logger.err("Modal body element is missing");
        return;
    }

    modalBody.innerHTML = content.innerHTML;

    const modal = Modals[contentId];
    const modalTitle = Modal.div.querySelector('.modal-title');
    modalTitle.textContent = modal?.title || '';
    if (modal.init) modal.init();

    Modal.div.setAttribute('role', modal?.role ?? 'dialog');
    Modal.div.setAttribute('aria-modal', String(Boolean(modal?.asks)));

    Modal.current = modal;
    Modal.div.style.display = 'flex';

    // Remove any previously applied custom class automatically.
    if (Modal.currentCustomClass) {
        Modal.div.classList.remove(Modal.currentCustomClass);
        Modal.currentCustomClass = null;
    }
    // Add the new custom class if it exists.
    if (modal?.customClass) {
        Modal.div.classList.add(modal.customClass);
        Modal.currentCustomClass = modal.customClass;
    }

    Modal.wireControls(modalBody, modal);
}
// Nothing here reads the DOM for a value: `Modal.inputValues` is the store, keyed
// by element id and backed by localStorage, and a control's only job is to edit
// it. So controls do not have to be inside a modal to belong to one. The Settings
// tab keeps the node placement controls in the page rather than in a modal body,
// and calls this with `Modals.noteModal` to get the same three things a modal
// gets: values restored on load, changes persisted, and the `storeInputValue`
// side effect for that id -- which for `noteModal` is `ZetPath.updateOptions()`.
Modal.wireControls = function (root, modal) {
    root.querySelectorAll('select.custom-select').forEach(Modal.setupSelect, modal);
    root.querySelectorAll('input[type=range]').forEach(Modal.setupSlider, modal);
    root.querySelectorAll('input:not([type=range]), textarea').forEach(Modal.setupInput, modal);
}
Modal.setupSelect = function (select) {
    CustomDropdown.setupModelSelect(select);

    const stored = Modal.inputValues[select.id];
    if (stored !== undefined) select.value = stored;

    On.change(select, Modal.storeInputValue.bind(null, select, this.id));
}
Modal.setupSlider = function (slider) {
    const stored = Modal.inputValues[slider.id];
    if (stored !== undefined) slider.value = stored;

    setSliderBackground(slider);
    On.input(slider, Modal.onSliderInput.bind(this, slider));
}
Modal.onSliderInput = function (slider, e) {
    setSliderBackground(slider);
    Modal.storeInputValue(slider, this.id);
}
Modal.setupInput = function (input) {
    if (input.type === 'file') return;

    const stored = Modal.inputValues[input.id];
    if (stored !== undefined) {
        const attr = (input.type === 'checkbox' ? 'checked' : 'value');
        input[attr] = stored;
    }

    On.input(input, Modal.storeInputValue.bind(null, input, this.id));
}

Modal.getInputValue = function (modalId, itemId, defaultValue = true) {
    return Modal.inputValues[itemId] ?? defaultValue;
}
Modal.getAiInputValue = Modal.getInputValue.bind(Modal, 'aiModal');

Modal.close = function () {
    switch (Modal.current?.id) {
        case 'zetSearchModal':
        case 'nodeConnectionModal':
            Graph.forEachNode(clearSearchHighlight);
            break;
        case 'vectorDbImportConfirmModal':
            if (window.currentVectorDbImportReject) {
                window.currentVectorDbImportReject(new Error("User cancelled the operation"));
                window.currentVectorDbImportReject = null;
            }
            break;
        default:
            break;
    }
    Modal.div.style.display = 'none';
    Modal.closeOverlay;
    Modal.current = null;
    Modal.settleUnanswered();

    // Only when the dialog had the keyboard: a click on the Graph behind moved it on.
    const back = Modal.returnFocus;
    Modal.returnFocus = null;
    const lost = (document.activeElement === document.body || Modal.div.contains(document.activeElement));
    if (lost && back?.isConnected && back !== document.body) back.focus({preventScroll: true});
}

On.click(Modal.btnClose, Modal.close);

// An alert, a confirm or a prompt is a promise its caller awaits, settled by its own
// buttons. Left by Escape or the ×, or replaced by another dialog, it settled nothing, and
// `await confirm(...)` never returned. Each leaves here what no answer means; its buttons
// resolve before they close, so this finds the promise already settled.
Modal.unanswered = null;
Modal.settleUnanswered = function () {
    const settle = Modal.unanswered;
    Modal.unanswered = null;
    settle?.();
}

// Tab goes round the dialog's own controls while it waits for an answer. It went on into
// the tool bar and the page behind, where nothing answers it. Every step is taken here, not
// only the wrap: WebKit's Tab passes over buttons, so from the text box it left the dialog.
Modal.holdTab = function (e) {
    if (e.key !== 'Tab' || !Modal.current?.asks) return;

    const stops = [...Modal.div.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter( (el)=>(!el.disabled && el.getClientRects().length > 0) );
    if (!stops.length) return;

    // Stopped here as well: CodeMirror, reached next when the key began in the editor,
    // notes where the focus is and puts it back in the editor when its handler is done.
    e.preventDefault();
    e.stopPropagation();
    const at = stops.indexOf(document.activeElement);
    const step = (e.shiftKey ? -1 : 1);
    const next = (at < 0) ? (e.shiftKey ? stops.length - 1 : 0) : (at + step + stops.length) % stops.length;
    stops[next].focus();
}
// Captured, so it comes first: CodeMirror answers Tab itself, and a Tab in the editor behind
// the dialog typed a tab into the note before it reached this.
On.keydown(window, Modal.holdTab, true);

// Escape closes a modal, and the nested explanation overlay first.
//
// Nothing did. The close control is a `<span class="close">` with no tabindex, no role and
// `&times;` as its whole accessible name, so it cannot be reached by keyboard -- and the
// menu's own Escape handler yields to an open modal (`dropdown.js:246`, `if (Modal.current)
// return`) on the assumption that the modal would take the key. Neither of them did, so
// with a modal open Escape did nothing at all and the only way out was a mouse click on a
// non-focusable span. Both adversarial reviews found it independently.
//
// The overlay goes first because it is the inner layer: a reader who opened an explanation
// on top of a modal means the explanation when they press Escape once.
On.keydown(window, (e)=>{
    if (e.key !== 'Escape') return;
    if (Modal.overlay?.style.display === 'block') {
        Modal.closeOverlay();
        e.stopPropagation();
        return;
    }
    if (!Modal.current) return;
    Modal.close();
    e.stopPropagation();
});

Modal.openOverlay = function (explanationId) {
    const explanationContent = Elem.byId(explanationId);
    if (!explanationContent) {
        Logger.err("No explanation found for ID:", explanationId);
        return;
    }

    Modal.overlayBody.innerHTML = explanationContent.innerHTML;
    Modal.overlay.style.display = 'block';
}

Modal.closeOverlay = function () {
    Modal.overlay.style.display = 'none';
    Modal.overlayBody.innerHTML = '';
}
On.click(Modal.overlayCloseBtn, Modal.closeOverlay);



[
    'click', 'dblclick', 'mousedown', 'touchstart',
    'touchend', 'wheel', 'dragstart', 'drag', 'drop'
].forEach(Event.stopPropagationByNameForThis, Modal.content);

Modal.startDragging = function (e) {
    if (isInputElement(e.target)) return;

    Modal.isDragging = true;
    Modal.mouseOffsetX = e.clientX - Modal.div.offsetLeft;
    Modal.mouseOffsetY = e.clientY - Modal.div.offsetTop;
}
function isInputElement(element) {
    const inputTypes = ['input', 'select', 'textarea', 'button'];
    return inputTypes.includes(element.tagName.toLowerCase()) ||
        element.classList.contains('custom-select') ||
        element.closest('.vdb-search-result') ||
        element.closest('#modal-file-tree-container') || element.classList.contains('modal-prompt-message');
}

Modal.dragContent = function (e) {
    if (!Modal.isDragging) return;

    e.preventDefault();
    Modal.div.style.left = (e.clientX - Modal.mouseOffsetX) + 'px';
    Modal.div.style.top = (e.clientY - Modal.mouseOffsetY) + 'px';
}
Modal.stopDragging = function () {
    Modal.isDragging = false;
}

On.mousedown(Modal.content, Modal.startDragging);
On.mousemove(document, Modal.dragContent);
On.mouseup(document, Modal.stopDragging);
