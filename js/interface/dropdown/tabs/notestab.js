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

// Horizontal drag handle -- on the pane's right edge, which is the one that moves: the
// menu is anchored at the left of the screen, so the pane grows rightwards. It sat on the
// left edge and subtracted the drag, so it pulled the wrong way on an edge that cannot
// move; measured, a drag of +120px left the pane at 270px wide (#65).
let zetHorizDragHandle = Elem.byId('zetHorizDragHandle');
let zetIsHorizResizing = false;
let initialX;
let initialWidth;

On.mousedown(zetHorizDragHandle, (e)=>{
    updateMaxDimensions(); // Update dimensions at the start of each drag
    zetIsHorizResizing = true;
    initialX = e.clientX;
    initialWidth = App.zetPanes.container.offsetWidth;
    // The stylesheet's limit (`.zet-pane-container`), so the drag and the CSS agree on
    // how wide the pane may go. At 1000px they did not -- 926px against 900px -- and a
    // pane the CSS had clamped to 926px refused every narrowing drag short of 26px.
    maxWidth = parseFloat(getComputedStyle(App.zetPanes.container).maxWidth) || maxWidth;

    // Prevent text selection while resizing
    document.body.style.userSelect = 'none';
    On.mousemove(document, zetHandleHorizMouseMove);
    // Once: a listener added per drag and never removed piled up one more per drag.
    On.mouseup(document, zetEndResize.bind(null, zetHandleHorizMouseMove), {once: true});
});

// The end of either drag. CodeMirror measures its width when it lays text out and not
// when its box changes, so it is told to look again, or lines stay wrapped to the old one.
function zetEndResize(onMove){
    zetIsHorizResizing = false;
    zetIsVertResizing = false;
    // Enable text selection again after resizing
    document.body.style.userSelect = '';
    Off.mousemove(document, onMove);
    window.currentActiveZettelkastenMirror?.refresh();
}

function zetHandleHorizMouseMove(event) {
    if (!zetIsHorizResizing) return;

    requestAnimationFrame(() => {
        // Calculate the difference in the x position
        const dx = event.clientX - initialX;
        // Clamped, not refused: a move past either limit used to leave the pane where the
        // last move inside them had put it, however far the pointer went.
        const newWidth = Math.min(Math.max(initialWidth + dx, 50), maxWidth);
        App.zetPanes.container.style.width = newWidth + 'px';
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
    // The stylesheet's limit again, as for the width.
    maxHeight = parseFloat(getComputedStyle(App.zetPanes.container).maxHeight) || maxHeight;

    // Prevent text selection while resizing
    document.body.style.userSelect = 'none';
    On.mousemove(document, zetHandleVertMouseMove);
    On.mouseup(document, zetEndResize.bind(null, zetHandleVertMouseMove), {once: true});
});

function zetHandleVertMouseMove(event) {
    if (!zetIsVertResizing) return;

    requestAnimationFrame(() => {
        // Calculate the difference in the y position
        const dy = event.clientY - initialY;
        // Clamped, not refused, as the width is: +250px in one move left it where it was.
        const newHeight = Math.min(Math.max(initialHeight + dy, 50), maxHeight);
        App.zetPanes.container.style.height = newHeight + 'px';
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
    // The Archive controls in `notestab.html` (#64).
    select = Elem.byId('archiveSelect');
    status = Elem.byId('archiveStatus');
    // `window.zetPaneList` is the register of Panes. It used to be two registers:
    // that array, and the Archive dropdown's option list, which also held which Pane
    // was active. The select that came back reads the register and writes nothing to
    // it, so the array is still the only one.
    constructor(container) {
        this.container = container;
    }

    init(){
        CustomDropdown.setup(this.select);
        On.change(this.select, ()=>this.switchPane(this.select.value));
        On.click(Elem.byId('archiveNew'), this.onNew);
        On.click(Elem.byId('archiveRename'), this.onRename);
        On.click(Elem.byId('archiveDelete'), this.onDelete);
        this.addPane();
    }

    addPane() {
        const paneId = 'zet-pane-' + this.paneCounter;
        const pane = this.createPane(paneId, this.nextName());

        this.paneContent.appendChild(pane);
        this.switchPane(paneId);

        this.paneCounter += 1;
    }
    // The lowest "Archive n" no Archive is called. The counter only rose, so deleting
    // Archive 2 made the next one Archive 3; it still gives each Pane its own id.
    nextName(){
        const names = new Set(window.zetPaneList.map( (pane)=>this.getPaneName(pane.paneId).toLowerCase() ));
        let n = 1;
        while (names.has('archive ' + n)) n += 1;
        return 'Archive ' + n;
    }

    activePane(){
        return window.zetPaneList.find( (pane)=>(pane.cm === window.currentActiveZettelkastenMirror) );
    }
    // The Nodes an Archive's text makes: its notes and its AI Nodes. An image or a link
    // belongs to no Archive.
    static noteCount(pane){
        let count = 0;
        pane.processor.forEachNodeWrap( (wrap)=>{ if (!wrap.node.removed) count += 1 } );
        return count;
    }
    static notes(count){ return (count === 1 ? '1 note' : count + ' notes') }

    // The select lists every Archive with how many notes it holds, on the one shown, and
    // the status line under the text says why a Title line there makes no note. Every
    // pass calls this (`markTaken`), one per keystroke, so the list is rebuilt only when
    // what it says has changed.
    render = ()=>{
        const panes = window.zetPaneList;
        const active = this.activePane();
        const options = panes.map( (pane)=>[pane.paneId,
            this.getPaneName(pane.paneId) + ' · ' + ZetPanes.notes(ZetPanes.noteCount(pane))] );
        const said = JSON.stringify([options, active?.paneId]);
        if (said !== this.said && this.select) {
            this.said = said;
            this.select.replaceChildren(...options.map( ([value, text])=>new Option(text, value) ));
            if (active) this.select.value = active.paneId;
            CustomDropdown.refreshDisplay(this.select);
            Select.updateSelectedOption(this.select);
        }
        this.renderStatus(active);
    }
    onTaken(){ this.render() }
    renderStatus(pane){
        if (!this.status) return;

        const taken = pane?.processor.taken ?? [];
        this.status.hidden = (taken.length === 0);
        if (!taken.length) return (this.status.textContent = '');

        const where = (entry)=>{
            const holder = window.zetPaneList.find( (p)=>(p.processor === entry.holder) );
            return (holder === pane ? 'higher up in this Archive' : 'in ' + this.getPaneName(holder?.paneId));
        };
        const first = taken[0];
        this.status.textContent = (taken.length === 1)
            ? `“${first.title}” is already a note ${where(first)}, so line ${first.lineNo + 1} makes no note. Rename one of them to keep both.`
            : `${taken.length} Title lines make no note, because their Titles are already notes: `
              + taken.slice(0, 3).map( (t)=>`“${t.title}” (line ${t.lineNo + 1}, ${where(t)})` ).join(', ')
              + (taken.length > 3 ? ', and more.' : '.');
    }

    onNew = ()=>{
        this.addPane();
        window.currentActiveZettelkastenMirror?.focus();
    }
    onRename = async ()=>{
        const pane = this.activePane();
        if (!pane) return;

        const current = this.getPaneName(pane.paneId);
        const name = (await window.prompt(`Rename the Archive “${current}” to:`, current))?.trim();
        if (!name || name === current) return;

        const clash = window.zetPaneList.find( (other)=>(other !== pane
            && this.getPaneName(other.paneId).toLowerCase() === name.toLowerCase()) );
        if (clash) return window.alert(`“${name}” is already the name of an Archive.`);

        this.paneContent.querySelector('#' + pane.paneId).dataset.paneName = name;
        this.render();
    }
    // It says what goes with the Archive before it goes, and the last one explains itself:
    // the button returned without a word when one was left, which read as broken.
    onDelete = async ()=>{
        const pane = this.activePane();
        if (!pane) return;

        const name = this.getPaneName(pane.paneId);
        if (window.zetPaneList.length === 1) {
            return window.alert(`“${name}” is the only Archive, and new notes are written into the one shown, so it cannot be deleted. Make another first.`);
        }
        const count = ZetPanes.noteCount(pane);
        const question = (count === 0) ? `Delete the Archive “${name}”? It holds no notes.`
            : `Delete the Archive “${name}” and the ${count === 1 ? 'note' : count + ' notes'} written in it?`;
        if (!await window.confirm(question)) return;

        this.removePane(pane.paneId);
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
        // sample of the syntax, which is in the Help panel now -- see `zetcodemirror.js`.
        const cm = CodeMirror.fromTextArea(textarea, {
            lineWrapping: true,
            scrollbarStyle: 'simple',
            theme: 'default',
            mode: 'custom',
            virtualRendering: true,
            // Escape is the way out of the editor, as it is out of every panel (the Help
            // panel says so). The default keymap answers every Escape itself, and Tab
            // types a tab, so no key got the caret out.
            extraKeys: {Esc: false}
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
        this.render();
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
        else this.render();
    }

    resetAllPanes() {
        // Remove all panes
        this.paneContent.querySelectorAll('.zet-pane').forEach(pane => {
            this.removePane(pane.id)
        });
        this.paneCounter = 1; // Reset pane counter
        this.renamedOnLoad = [];
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
        // A Saved Graph from before #64 can give one Title to two sections, with a Node for
        // each: the later is renamed, and the load says so (`reportRenames`).
        for (const renamed of restored.processor.applyRenames()) {
            this.renamedOnLoad.push({...renamed, archive: paneName});
        }

        this.paneCounter += 1;
    }

    // One notice for a load that renamed anything, since the next autosave keeps the new
    // Titles: a rename nobody was told of is a note the reader cannot find by its name.
    reportRenames(){
        const renamed = (this.renamedOnLoad ?? []).splice(0);
        if (!renamed.length) return;

        const lines = renamed.map( (r)=>`“${r.from}” in ${r.archive} is now “${r.to}”.` );
        window.alert(['A Title names one note, and this graph had some Titles in two places, so one of each was renamed as it opened:', ...lines].join('\n'));
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
