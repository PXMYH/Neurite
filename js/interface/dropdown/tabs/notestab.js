function handleKeyDown(event) {
    if (event.key === 'Enter') {
        if (event.shiftKey) {
            // Shift + Enter was pressed, insert a newline
            event.preventDefault();
            // insert a newline at the cursor
            const cursorPosition = event.target.selectionStart;
            event.target.value = event.target.value.substring(0, cursorPosition) + '\n' + event.target.value.substring(cursorPosition);
            // position the cursor after the newline
            event.target.selectionStart = cursorPosition + 1;
            event.target.selectionEnd = cursorPosition + 1;
            // force the textarea to resize
            autoGrow(event);
        } else {
            // Enter was pressed without Shift
            event.preventDefault();
            sendMessage(event);
        }
    }
    return true;
}


const promptInput = Elem.byId('prompt');
if (promptInput) On.keydown(promptInput, handleKeyDown);


function autoGrow(event) {
    const textarea = event.target;
    // Temporarily make the height 'auto' so the scrollHeight is not affected by the current height
    textarea.style.height = 'auto';
    let maxHeight = 200;
    if (textarea.scrollHeight < maxHeight) {
        textarea.style.height = textarea.scrollHeight + 'px';
        textarea.style.overflowY = 'hidden';
    } else {
        textarea.style.height = maxHeight + 'px';
        textarea.style.overflowY = 'auto';
    }
}

let maxWidth, maxHeight;

function updateMaxDimensions() {
    maxWidth = window.innerWidth * 0.9;
    maxHeight = window.innerHeight * 0.7;
}

updateMaxDimensions();
On.resize(window, updateMaxDimensions);

// Horizontal drag handle
let zetHorizDragHandle = Elem.byId('zetHorizDragHandle');
let zetIsHorizResizing = false;
let initialX;
let initialWidth;

On.mousedown(zetHorizDragHandle, (e)=>{
    updateMaxDimensions(); // Update dimensions at the start of each drag
    zetIsHorizResizing = true;
    initialX = e.clientX;
    initialWidth = App.zetPanes.container.offsetWidth;

    // Prevent text selection while resizing
    document.body.style.userSelect = 'none';
    On.mousemove(document, zetHandleHorizMouseMove);
    On.mouseup(document, (e)=>{
        zetIsHorizResizing = false;
        // Enable text selection again after resizing
        document.body.style.userSelect = '';
        Off.mousemove(document, zetHandleHorizMouseMove);
    });
});

function zetHandleHorizMouseMove(event) {
    if (!zetIsHorizResizing) return;

    requestAnimationFrame(() => {
        // Calculate the difference in the x position
        const dx = event.clientX - initialX;
        const newWidth = initialWidth - dx;

        // Update the width if within the boundaries
        if (newWidth > 50 && newWidth <= maxWidth) {
            App.zetPanes.container.style.width = newWidth + 'px';
        }
    });
}

// Vertical drag handle
let zetVertDragHandle = Elem.byId('zetVertDragHandle');
let zetIsVertResizing = false;
let initialY;
let initialHeight;

On.mousedown(zetVertDragHandle, (e)=>{
    updateMaxDimensions(); // Update dimensions at the start of each drag
    zetIsVertResizing = true;
    initialY = e.clientY;
    initialHeight = App.zetPanes.container.offsetHeight;

    // Prevent text selection while resizing
    document.body.style.userSelect = 'none';
    On.mousemove(document, zetHandleVertMouseMove);
    On.mouseup(document, (e)=>{
        zetIsVertResizing = false;
        // Enable text selection again after resizing
        document.body.style.userSelect = '';
        Off.mousemove(document, zetHandleVertMouseMove);
    });
});

function zetHandleVertMouseMove(event) {
    if (!zetIsVertResizing) return;

    requestAnimationFrame(() => {
        // Calculate the difference in the y position
        const dy = event.clientY - initialY;
        const newHeight = initialHeight + dy;

        // Update the height if within the boundaries
        if (newHeight > 50 && newHeight <= maxHeight) {
            App.zetPanes.container.style.height = newHeight + 'px';
        }
    });
}

// One entry per Pane: its id, its editor, and the three objects built around that
// editor. This was four arrays correlated by position, and removal filtered only
// the first of them, so a deleted Pane's parser, UI and processor stayed
// registered for the rest of the session -- re-parsed on every save, and still
// counted by the index arithmetic that recovered Pane names.
//
// Keeping the id here is what lets a Pane be found by identity instead of by
// position. `savenet.js` needed that: it read a name with `'zet-pane-' + (index+1)`,
// which is only the right Pane until one is deleted.
window.zetPaneList = window.zetPaneList || [];
window.currentActiveZettelkastenMirror = null;

class ZetPanes {
    paneContent = document.querySelector('.zet-pane-content');
    paneCounter = 1;
    // `window.zetPaneList` is the register of Panes. It used to be two registers:
    // that array, and the Archive dropdown's option list, which also held which Pane
    // was active. The dropdown is gone (issue #64), so the array is the only one, and
    // the methods below read it instead of reading the DOM back.
    constructor(container) {
        this.container = container;
    }

    init(){
        this.addPane();
    }

    addPane() {
        const paneId = 'zet-pane-' + this.paneCounter;
        const paneName = 'Archive ' + this.paneCounter;
        const pane = this.createPane(paneId, paneName);

        this.paneContent.appendChild(pane);
        this.switchPane(paneId);

        this.paneCounter += 1;
    }

    createPane(paneId, paneName) {
        const pane = Html.make.div('zet-pane');
        pane.id = paneId;
        pane.dataset.paneName = paneName;

        const textarea = Html.make.textarea('zet-zettelkasten');
        textarea.id = 'zet-note-input-' + this.paneCounter;
        textarea.rows = 10;
        textarea.cols = 50;
        pane.appendChild(textarea);

        // No `placeholder`: the editor opens empty. It used to hold a four-line
        // sample of the syntax, which is in the ? tab now -- see `zetcodemirror.js`.
        const cm = CodeMirror.fromTextArea(textarea, {
            lineWrapping: true,
            scrollbarStyle: 'simple',
            theme: 'default',
            mode: 'custom',
            virtualRendering: true
        });

        const zettelkastenParser = new ZettelkastenParser(cm);
        zettelkastenParser.updateMode(); // Update the mode

        const zettelkastenUI = new ZettelkastenUI(cm, textarea, zettelkastenParser);

        const zettelkastenProcessor = new ZettelkastenProcessor(cm, zettelkastenParser);
        ZetPath.updateOptions(zettelkastenProcessor); // Update the placement path only for the new processor

        window.zetPaneList.push({
            paneId,
            cm,
            parser: zettelkastenParser,
            ui: zettelkastenUI,
            processor: zettelkastenProcessor
        });

        return pane;
    }

    switchPane(paneId) {
        const panes = this.paneContent.querySelectorAll('.zet-pane');

        panes.forEach(pane => {
            if (pane.id === paneId) {
                pane.classList.add('active');
                const zetPane = window.zetPaneList.find((entry)=>(entry.paneId === paneId));
                const cm = zetPane && zetPane.cm;

                window.currentActiveZettelkastenMirror = cm;

                if (cm) {
                    cm.refresh();
                } else {
                    Logger.err("CodeMirror instance not found for the active pane.")
                }
            } else {
                pane.classList.remove('active');
            }
        });
    }

    getPaneName(paneId) {
        const pane = this.paneContent.querySelector('#' + paneId);
        return (pane) ? pane.dataset.paneName : '';
    }

    removePane(paneId) {
        const pane = this.paneContent.querySelector('#' + paneId);
        if (!pane) return;

        const index = window.zetPaneList.findIndex((entry)=>(entry.paneId === paneId));
        if (index !== -1) {
            const cm = window.zetPaneList[index].cm;
            cm.setValue('');
            cm.clearHistory();
            // One splice retires the editor, parser, UI and processor together. As
            // four arrays this dropped the editor only, and the processor kept
            // running on every save for the rest of the session.
            window.zetPaneList.splice(index, 1);
        }

        pane.remove();

        // Fall through to whichever Pane took this one's place in the register, or to
        // the last one if this was the end of it. `resetAllPanes` runs this over every
        // Pane, so the register does empty, and then there is nothing to switch to.
        const next = window.zetPaneList[index] || window.zetPaneList.at(-1);
        if (next) this.switchPane(next.paneId);
    }

    resetAllPanes() {
        // Remove all panes
        this.paneContent.querySelectorAll('.zet-pane').forEach(pane => {
            this.removePane(pane.id)
        });
        this.paneCounter = 1; // Reset pane counter
    }

    restorePane(paneName, paneContent) {
        const paneId = `zet-pane-${this.paneCounter}`;
        const pane = this.createPane(paneId, paneName);

        this.paneContent.appendChild(pane);
        this.switchPane(paneId);

        // Every title in paneContent already has a node, so the pass must bind to
        // it rather than spawn a duplicate.
        const restored = window.zetPaneList.at(-1);
        restored.processor.writeAs(ZettelkastenProcessor.Pass.restore,
            ()=>restored.cm.setValue(paneContent));

        this.paneCounter += 1;
    }

    getActiveTextarea() {
        const activeCodeMirror = window.currentActiveZettelkastenMirror;
        if (!activeCodeMirror) return;

        const textareas = this.paneContent.querySelectorAll('textarea');
        for (const textarea of textareas) {
            if (activeCodeMirror.getTextArea() === textarea) return textarea;
        }
    }

    // `openSearchModal` was here, because the button that called it was in this
    // container's header. It searches every Node in the Graph rather than anything
    // about a Pane, so it moved to the tool bar with the button: `openNodeSearch`
    // in `js/interface/searchapi/search.js`.
}
