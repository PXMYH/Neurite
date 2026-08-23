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
    constructor(container) {
        this.container = container;
        this.paneDropdown = container.querySelector('#zetPaneDropdown');
        this.addPaneButton = container.querySelector('.zet-add-pane-button');
        this.deletePaneButton = container.querySelector('.zet-delete-pane-button');
        this.searchButton = container.querySelector('#notesSearchButton');
        this.settingsButton = container.querySelector('.zet-settings-button');
    }

    init(){
        CustomDropdown.setupHtmlOptions(this.paneDropdown, createZetContainerDropdown, false);

        // + and X buttons
        On.click(this.addPaneButton, this.addPane.bind(this));
        On.click(this.deletePaneButton, this.removeSelectedPane);
        On.change(this.paneDropdown, ()=>{ this.switchPane(this.paneDropdown.value) } );
        On.click(this.searchButton, ZetPanes.openSearchModal);
        // These are Zettelkasten settings, so they belong beside the archive
        // controls. They used to hang off a click on the node palette's note
        // icon, where nothing suggested they existed.
        On.click(this.settingsButton, ZetPanes.openSettingsModal);

        this.addPane();
    }

    addPane() {
        const paneId = 'zet-pane-' + this.paneCounter;
        const paneName = 'Archive ' + this.paneCounter;
        const pane = this.createPane(paneId, paneName);

        CustomDropdown.addHtmlOption(this.paneDropdown, { text: paneName, value: paneId }, createZetContainerDropdown);
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

        const cm = CodeMirror.fromTextArea(textarea, {
            lineWrapping: true,
            scrollbarStyle: 'simple',
            theme: 'default',
            mode: 'custom',
            virtualRendering: true,
            placeholder: generateCmPlaceholder()
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

                this.paneDropdown.value = paneId;
                Select.updateSelectedOption(this.paneDropdown);
            } else {
                pane.classList.remove('active');
            }
        });
    }

    removeSelectedPane = ()=>{
        const selectedPaneId = this.paneDropdown.value;
        if (!selectedPaneId) return;

        const selectedPaneName = this.getPaneName(selectedPaneId);
        if (this.paneDropdown.options.length === 1) return;

        // "Archive" is the word on screen -- it is the name this pane is given and
        // what the header's titles call it. This asked about a "slip-box", a third
        // word for the same thing that appeared nowhere else, so the dialog read as
        // being about something other than the row that opened it.
        window.confirm(`Delete the Archive "${selectedPaneName}" and every note in it?`)
            .then((confirmDelete) => {
                if (confirmDelete) this.removePane(selectedPaneId);
            })
            .catch((error) => {
                console.error("Confirmation failed:", error);
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

        const paneDropdown = this.paneDropdown;
        const option = paneDropdown.querySelector(`option[value="${paneId}"]`);
        if (!option) return;

        const currentIndex = Array.from(paneDropdown.options).indexOf(option);
        option.remove();
        refreshHtmlDropdownDisplay(paneDropdown, createZetContainerDropdown);

        if (paneDropdown.options.length > 0) {
            const newIndex = (currentIndex >= paneDropdown.options.length ? currentIndex - 1 : currentIndex);
            const newPaneId = paneDropdown.options[newIndex].value;
            this.switchPane(newPaneId);
        }
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

        CustomDropdown.addHtmlOption(this.paneDropdown, { text: paneName, value: paneId }, createZetContainerDropdown);
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

    static openSearchModal(){
        Modal.open('zetSearchModal');
        setupZettelkastenSearchBar();
        performZettelkastenSearch(Elem.byId('Searchbar').value);
    }

    static openSettingsModal(){
        Modal.open('noteModal'); // titled "Zettelkasten Settings"
    }
}
