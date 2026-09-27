const Menu = View.List = {};
const MenuItem = View.Item = {};

Menu.Context = class {
    menu = Elem.byId('customContextMenu');
    targetModel = null;
    constructor(){
        this.fileInput = this.makeFileInput();

        ['click', 'mousedown', 'mouseup']
        .forEach(Event.stopPropagationByNameForThis, this.menu);
        On.mousedown(document, this.onMousedown);
    }

    // Measured with its contents in it and shown, or the flip away from the edge reads a
    // height of 0: the menu was placed before it was filled, and while it was hidden, so a
    // Node's menu opened near the bottom ran off the screen -- measured, a pinned action at
    // y 908 in a 900px window, where no click could reach it.
    position(x, y){
        const menu = this.menu;
        menu.style.display = 'block';

        // offset slightly from the cursor. 6px down is where the menu was drawn while
        // the <ul>'s own 16px margin moved it, which `margin: 0` now removes.
        const offsetX = 5;
        const offsetY = 6;

        const menuWidth = menu.offsetWidth;
        if (x + menuWidth + offsetX > window.innerWidth) { // off the right side
            x -= menuWidth + offsetX;
        } else {
            x += offsetX;
        }

        const menuHeight = menu.offsetHeight;
        if (y + menuHeight + offsetY > window.innerHeight) { // off the bottom
            y -= menuHeight + offsetY;
        } else {
            y += offsetY;
        }

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    }
    // Over the chrome -- the tool pill, the panel at the bottom left, a resize corner -- there
    // is nothing to offer: it opened a single "Generic Action" row that did nothing.
    open(x, y, target){
        this.menu.innerHTML = ''; // clear options
        const view = Graph.viewForElem(target);
        if (!view) return this.hide();

        this.targetModel = view.model;
        this[view.funcPopulate](x, y);
        this.position(x, y);
        App.menuSuggestions.repositionIfDisplayed(this.menu);
        this.inputField?.isConnected && this.focusSearch();
    }
    // The search takes the keys while the menu is open: they went to the canvas, where f and
    // d scaled the selection the menu was about.
    focusSearch(){
        const pinned = this.menu.querySelector('li.dynamic-option');
        if (pinned) this.inputField.dataset.quiet = '1';
        this.inputField.focus({preventScroll: true});
    }
    option(text, onClick, closing = true){
        const handler = (!closing) ? onClick
                    : async ()=>{ await onClick(); this.hide() } ;
        return Html.make.li(text, 'dynamic-option', handler);
    }
    removeMenuItem(text){
        const item = Elem.findChild(this.menu, Elem.hasTextContentThis, text);
        if (item) this.menu.removeChild(item);
    }

    makeInputField(){
        const input = Html.make.input('dynamic-input custom-node-method-input');
        input.type = 'text';
        input.placeholder = "Search actions";
        return input;
    }
    populateForNode(x, y){
        this.inputField = this.makeInputField();
        this.menu.append(Html.make.li(this.inputField, 'input-item'));
        this.setupSuggestions(x, y);
        this.loadPinnedItems();
    }
    populateForEdge(x, y){
        const edge = this.targetModel;
        // The one place the arrow turns (a plain click on an Edge does nothing). A turn that
        // takes a Ref out of a note asks first and names it: the Ref may sit in a sentence,
        // and there is no undo outside the Notes panel.
        const onDirection = async ()=>{
            const from = edge.turnTakesRefFrom();
            if (from) {
                const other = edge.pts.find( (pt)=>(pt !== from) ).getTitle();
                const ref = Tag.ref + other + (bracketsMap[Tag.ref] ?? '');
                const question = `Turn the arrow? That takes ${ref} out of "${from.getTitle()}".`;
                if (!await window.confirm(question)) return;
            }
            edge.toggleDirection();
        };
        const onDelete = edge.removeInstance.bind(edge);
        // Named for what they do, as the Help panel names them (#50).
        this.menu.append(
            this.option("Turn the arrow", onDirection, false),
            this.option("Delete edge", onDelete)
        );
    }
    populateForBackground(x, y){
        // Built as a list so the Ai entry can be left out entirely with AI
        // features off. The menu is repopulated on every open, so the switch takes
        // effect without a reload.
        const options = [
            // Option to create a Text Node (without calling draw)
            this.option("+ Note", createNodeFromWindow)
        ];
        if (AiFeatures.enabled) options.push(this.option("+ Ai", createAndDrawLlmNode));
        options.push(
            // Option to create a Link Node or Search Google
            this.option("+ Link", returnLinkNodes),
            this.option("+ File", this.fileInput.click.bind(this.fileInput)),
            this.option("Paste", this.onPasteOption.bind(null, this.targetModel))
        );
        this.menu.append(...options);
    }
    makeFileInput(){
        const input = Html.new.input();
        input.type = 'file';
        On.change(input, this.onFileInputChange);
        return input;
    }
    onFileInputChange(e){
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        On.load(reader, (e)=>{
            const data = e.target.result;
            const customEvent = {
                preventDefault: Function.nop,
                dataTransfer: {
                    getData: ()=>data ,
                    files: [file],
                    items: [{
                        kind: 'file',
                        getAsFile: ()=>file
                    }]
                }
            };
            dropHandlerInstance.handleDrop(customEvent);
        });
        reader.readAsText(file);
    }

    hide(){
        Elem.hide(this.menu);
        Elem.hideById('suggestions-container');
        this.targetModel = null;
    }

    onMousedown = (e)=>{
        const clickedInsideMenu = this.menu.contains(e.target);
        if (clickedInsideMenu) return;

        const suggestionsContainer = Elem.byId('suggestions-container');
        const clickedInsideSuggestions = suggestionsContainer && suggestionsContainer.contains(e.target);
        if (!clickedInsideSuggestions) this.hide();
    }
    async onPasteOption(target){
        try {
            const pastedData = await navigator.clipboard.readText();
            handlePasteData(pastedData, target);
        } catch (err) {
            Logger.err("In reading from clipboard:", err);
        }
    }

    addCopyOptionIfTextSelected(){
        if (window.getSelection().isCollapsed) return;

        this.menu.append(this.option("Copy", this.copySelectedText));
    }
    copySelectedText(){
        const selection = window.getSelection();
        if (!selection.isCollapsed) { // There is text selection
            return navigator.clipboard.writeText(selection.toString())
                .catch(Logger.err.bind(Logger, "Failed to copy text:"))
        }

        Logger.info("No text selected");
    }
}
