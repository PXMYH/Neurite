function createSyntaxTextarea() {
    const editorWrapper = Html.make.div('editor-wrapper');

    const className = 'editable-div custom-scrollbar textarea-override';
    const textarea = Html.make.textarea(className);
    // The placeholder is not set here. `TextNode.init` sets it, because that is the one
    // function both a new node and a restored one go through -- see `TextNode.PLACEHOLDER`.

    // Create the overlay div for syntax highlighting
    const displayDiv = Html.make.div('syntax-display-div custom-scrollbar');

    editorWrapper.append(displayDiv, textarea);

    // Reads only; the write it returns is run by `EditorHeights` after every other
    // card's read, so measuring one card never waits on a layout another card dirtied.
    function measureEditorHeight() {
        if (!editorWrapper.isConnected) return null;
        const wrapperHeight = editorWrapper.offsetHeight;
        const wrapperStyle = window.getComputedStyle(editorWrapper);
        const maxHeight = 300;
        if (wrapperStyle.height === '100%' || wrapperHeight >= maxHeight) return null;

        const wrapperRect = editorWrapper.getBoundingClientRect();
        const bottomOffset = 20; // Space to leave at the bottom of the screen
        if (wrapperRect.bottom + bottomOffset >= window.innerHeight) return null; // below it

        const height = textarea.scrollHeight + 'px';
        return ()=>{ editorWrapper.style.height = height };
    }

    On.input(textarea, ()=>EditorHeights.request(measureEditorHeight));

    return editorWrapper;
}

// A card's editor grows to fit its text, up to 300px, and measuring it costs a layout of
// the whole page. Measured inside each card's own input event, a burst of n notes paid n
// full layouts, each one bigger than the last: at 200 notes that was 9.4s of a 17s
// profile, with the page frozen through it. Queued instead, and run once a frame with
// every read taken before any height is written, so a burst costs one layout however
// many cards it touched.
const EditorHeights = {
    queue: new Set(),
    request(measure){
        if (this.queue.size === 0) requestAnimationFrame(this.flush);
        this.queue.add(measure);
    },
    flush: ()=>{
        const measures = [...EditorHeights.queue];
        EditorHeights.queue.clear();
        const writes = measures.map( (measure)=>measure() );
        for (const write of writes) write?.();
    }
};

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

    // A press in the body is text, and stays in the body -- except a press that is a gesture on
    // the card: Alt reaches the card underneath, and so does a primary press that connects
    // (the Connect tool, Shift, or any armed link: a click on the armed Node's own body drops
    // it, as a click on its header does, and places no caret) or selects (`Mod`). The body
    // is most of a card, and those gestures armed nothing and selected nothing there: measured,
    // 0 of 48 points on a card's body (#50).
    On.mousedown(userInputTextarea, (e)=>{
        if (!userInputTextarea.contains(e.target)) return;
        if (e.getModifierState(controls.altKey.value)) return;
        const gesture = App.interface.nodeMode.isOnFor(e) || Mod.isHeld(e) || Node.prev;
        if (Mod.isPrimary(e) && gesture) return;

        e.stopPropagation();
        // We still allow default behavior, so the contenteditable div remains interactable.
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

// The card's Title, which a note's head is read against (`splitHead`).
function cardTitleOf(elem) {
    return elem.closest?.('.window')?.querySelector('.title-input')?.value ?? '';
}

// The frontmatter's description, as the line above the card's text (`TextNode.init`).
function showCardDescription(userInputTextarea, description) {
    const line = userInputTextarea.closest?.('.editor-wrapper')?.previousElementSibling;
    if (!line?.classList.contains('card-description')) return;

    line.textContent = description;
    line.title = description;
    line.hidden = !description;
}

function syncInputTextareaWithHiddenTextarea(userInputTextarea, textarea) {
    if (!isHiddenTextareaProgrammaticChange) {
        isEditableDivProgrammaticChange = true;
        let previousContent = userInputTextarea.value;
        const {head, rest, description} = ZettelkastenParser.splitHead(textarea.value, cardTitleOf(userInputTextarea));
        const currentContent = ZettelkastenParser.splitTrailingRefs(rest).body;
        // What the card is not shown, which typing in it gives back (below).
        userInputTextarea.hiddenHead = head;
        showCardDescription(userInputTextarea, description);

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

        // The card never held the note's head or its trailing link lines, so typing in
        // it must not be read as deleting them. They come back off the note's own text,
        // which is still the copy this is about to overwrite -- there is no second
        // store of them to fall out of step with this one.
        const {head, rest} = ZettelkastenParser.splitHead(textareaValue, cardTitleOf(contentEditable));
        const {body, refs} = ZettelkastenParser.splitTrailingRefs(rest);
        // Count leading empty lines in the prose, which is what the card was given
        // -- counting them in the whole note would count the newline above the
        // links as well, and re-adding it every sync grew the note a line at a time.
        const leadingEmptyLines = (body.match(/^(\n*)/) || [''])[0];
        // Blank lines only, never the spaces the first line starts with: a line the import
        // escaped with one space (` ## Overview`) lost it on the first keystroke, and became
        // a Node Tag that took the rest of the note with it.
        const prose = contentEditableValue.replace(/^\s*\n/, '');
        // The links own their lines, never the newline above them: a note whose
        // prose is gone starts at its links, and one that has prose again puts a
        // newline back rather than running the two together.
        const links = refs.replace(/^\n/, '');

        // The head goes back in front only when the card was not shown it. A block the reader
        // types at the top of a card of their own is read as a head once the note holds it,
        // and the card, left alone while it is typed in, still shows it: the head was written
        // in front of it again at every key -- and, asked by whether the card still started
        // with it, again once a key inside the block made it start otherwise. A card never
        // filled from its note falls back on that question.
        const known = contentEditable.hiddenHead;
        const hidden = (known === undefined) ? (contentEditableValue.startsWith(head) ? '' : head)
                     : (known ? head : '');
        const newValue = hidden + leadingEmptyLines + prose + (prose && links ? '\n' : '') + links;

        if (textareaValue !== newValue) {
            textarea.value = newValue;
            textarea.dispatchEvent(new Event('input'));
        }

        Logger.debug("Synced hidden textarea:", textarea.value);
        isHiddenTextareaProgrammaticChange = false;
    }
}
