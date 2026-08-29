function createSyntaxTextarea() {
    const editorWrapper = Html.make.div('editor-wrapper');

    const className = 'editable-div custom-scrollbar textarea-override';
    const textarea = Html.make.textarea(className);
    // An empty note used to be a blank rectangle with nothing to say it was
    // typeable, and nothing to say a reference tag is what draws an edge. This is
    // the last hint of that kind left: the notes pane had a matching one and no
    // longer does, so the syntax is taught in the ? tab now and here, on the card
    // where a link is actually typed. `.editable-div::placeholder` gives it a colour
    // of its own — the textarea's own text colour is near-invisible by design.
    const refTag = tagValues.refTag;
    const refExample = isBracketLinks ? refTag + 'Title' + getClosingBracket(refTag)
                                      : refTag + 'Title';
    textarea.placeholder = 'Write here. ' + refExample + ' links to another node.';

    // Create the overlay div for syntax highlighting
    const displayDiv = Html.make.div('syntax-display-div custom-scrollbar');

    editorWrapper.append(displayDiv, textarea);

    function updateEditorHeight() {
        const wrapperHeight = editorWrapper.offsetHeight;
        const wrapperStyle = window.getComputedStyle(editorWrapper);
        const maxHeight = 300;
        if (wrapperStyle.height === '100%' || wrapperHeight >= maxHeight) return;

        const wrapperRect = editorWrapper.getBoundingClientRect();
        const bottomOffset = 20; // Space to leave at the bottom of the screen
        if (wrapperRect.bottom + bottomOffset < window.innerHeight) { // above the bottom
            editorWrapper.style.height = textarea.scrollHeight + 'px';
        }
    }

    On.input(textarea, updateEditorHeight);

    return editorWrapper;
}

function addEventsToUserInputTextarea(userInputTextarea, textarea, node, displayDiv) {
    syncInputTextareaWithHiddenTextarea(userInputTextarea, textarea);
    ZetSyntaxDisplay.syncAndHighlight(displayDiv, userInputTextarea);

    On.input(userInputTextarea, (e)=>{
        if (isEditableDivProgrammaticChange) return;

        syncHiddenTextareaWithInputTextarea(textarea, userInputTextarea);
        if (displayDiv) {
            ZetSyntaxDisplay.syncAndHighlight(displayDiv, userInputTextarea);
        }
    });

    On.change(textarea, (e)=>{
        if (isEditableDivProgrammaticChange) return;
        // Never overwrite the copy being typed into. This fires on the echo of the
        // reader's own keystroke coming back around: the card writes the note, the note
        // rewrites the pane, a pass rewrites the note from the pane, and `TextArea.update`
        // dispatches this. That echo is one keystroke behind, so applying it dropped the
        // character typed in between. While the card has focus it is the newer copy, and
        // `On.blur` below takes whatever the note gained meanwhile.
        if (document.activeElement === userInputTextarea) return;

        syncInputTextareaWithHiddenTextarea(userInputTextarea, textarea);
        if (displayDiv) {
            ZetSyntaxDisplay.syncAndHighlight(displayDiv, userInputTextarea);
        }
        highlightWithDelay();
    });

    function syncScroll(){
        displayDiv.scrollTop = userInputTextarea.scrollTop;
        displayDiv.scrollLeft = userInputTextarea.scrollLeft;
    }
    On.scroll(userInputTextarea, syncScroll);
    On.scroll(displayDiv, syncScroll);

    const highlightWithDelay = debounce(() => {
        if (displayDiv) {
            ZetSyntaxDisplay.syncAndHighlight(displayDiv, userInputTextarea);
        }
    }, 3000);

    // Highlight Codemirror text on focus of contenteditable div
    On.focus(userInputTextarea, syncScroll);

    // Focus held the echo off, so the note may have moved on without the card --
    // an AI streaming into this node, or another pane rewriting it. Catch up now,
    // while there is no keystroke left to lose.
    On.blur(userInputTextarea, (e)=>{
        syncInputTextareaWithHiddenTextarea(userInputTextarea, textarea);
        if (displayDiv) ZetSyntaxDisplay.syncAndHighlight(displayDiv, userInputTextarea);
    });

    On.mousedown(userInputTextarea, (e)=>{
        if (userInputTextarea.contains(e.target) && !e.getModifierState(controls.altKey.value)) {
            e.stopPropagation();
            // We still allow default behavior, so the contenteditable div remains interactable.
        }
    }, true); // Use capture phase to catch the event early

    On.keydown(document, (e)=>{
        if (!e.getModifierState(controls.altKey.value) ||
            document.activeElement !== userInputTextarea) return;

        userInputTextarea.style.userSelect = 'none';
        userInputTextarea.style.pointerEvents = 'none';
    });

    On.keyup(document, (e)=>{
        if (e.getModifierState(controls.altKey.value)) return;

        userInputTextarea.style.userSelect = 'auto';
        userInputTextarea.style.pointerEvents = 'auto';
    });

    On.visibilitychange(document, (e)=>{
        if (document.visibilityState !== 'visible') return;

        userInputTextarea.style.userSelect = 'auto';
        userInputTextarea.style.pointerEvents = 'auto';
    });

    On.paste(userInputTextarea, Event.stopPropagation);
}

let isEditableDivProgrammaticChange = false;
let isHiddenTextareaProgrammaticChange = false;

// A text node keeps its body twice: `node.textarea` is the whole of it, and is
// what the notes pane and the saved graph are written from, while `.editable-div`
// is the copy on the card that a reader types into and the highlight overlay is
// built from. The two functions below are the only crossing between them, so they
// are also the one place the card's copy can differ from the note -- which is what
// keeps a link-only line off the card. See `splitTrailingRefs`.

function syncInputTextareaWithHiddenTextarea(userInputTextarea, textarea) {
    if (!isHiddenTextareaProgrammaticChange) {
        isEditableDivProgrammaticChange = true;
        let previousContent = userInputTextarea.value;
        const currentContent = ZettelkastenParser.splitTrailingRefs(textarea.value).body;

        if (previousContent !== currentContent) {
            const selectionStart = userInputTextarea.selectionStart;
            const selectionEnd = userInputTextarea.selectionEnd;
            userInputTextarea.value = currentContent;
            userInputTextarea.setSelectionRange(selectionStart, selectionEnd);
            userInputTextarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }

        Logger.debug("Synced input textarea:", userInputTextarea.value);
        isEditableDivProgrammaticChange = false;
    }
}

function syncHiddenTextareaWithInputTextarea(textarea, contentEditable) {
    if (!isEditableDivProgrammaticChange) {
        isHiddenTextareaProgrammaticChange = true;

        const contentEditableValue = contentEditable.value;
        const textareaValue = textarea.value;

        // The card never held the note's trailing link lines, so typing in it must
        // not be read as deleting them. They come back off the note's own text,
        // which is still the copy this is about to overwrite -- there is no second
        // store of them to fall out of step with this one.
        const {body, refs} = ZettelkastenParser.splitTrailingRefs(textareaValue);
        // Count leading empty lines in the prose, which is what the card was given
        // -- counting them in the whole note would count the newline above the
        // links as well, and re-adding it every sync grew the note a line at a time.
        const leadingEmptyLines = (body.match(/^(\n*)/) || [''])[0];
        const prose = contentEditableValue.trimStart();
        // The links own their lines, never the newline above them: a note whose
        // prose is gone starts at its links, and one that has prose again puts a
        // newline back rather than running the two together.
        const links = refs.replace(/^\n/, '');

        // Combine leading empty lines with the content editable value
        const newValue = leadingEmptyLines + prose + (prose && links ? '\n' : '') + links;

        if (textareaValue !== newValue) {
            textarea.value = newValue;
            textarea.dispatchEvent(new Event('input'));
        }

        Logger.debug("Synced hidden textarea:", textarea.value);
        isHiddenTextareaProgrammaticChange = false;
    }
}
