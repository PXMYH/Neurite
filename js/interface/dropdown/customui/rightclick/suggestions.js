Menu.Suggestions = class {
    constructor() {
        this.container = this.makeDivContainer();
        this.init();
    }
    makeDivContainer() {
        const div = Html.make.div('suggestions-container');
        div.id = 'suggestions-container';
        return div;
    }
    init() {
        On.wheel(this.container, e => {
            e.stopPropagation();
        }, true);

        On.contextmenu(this.container, e => {
            e.preventDefault();
            e.stopPropagation();
        }, true);

        document.body.appendChild(this.container);
    }
    // Under the menu it belongs to and aligned with it, or above the menu where there is no
    // room below, and never off the screen. It was anchored to the pointer instead -- above
    // and to its left, with its last row under it, so the click that dismissed the menu ran
    // that row, and near the left edge its labels began at x -215.
    placeBeside(menu) {
        const style = this.container.style;
        style.transform = '';
        style.display = 'block';

        const m = menu.getBoundingClientRect();
        const w = this.container.offsetWidth, h = this.container.offsetHeight;
        const below = m.bottom + 4;
        const y = (below + h <= innerHeight - 8) ? below : Math.max(8, m.top - 4 - h);
        style.left = Math.max(8, Math.min(m.left, innerWidth - w - 8)) + 'px';
        style.top = y + 'px';
    }
    clear() {
        this.container.innerHTML = '';
    }
    addSuggestion(id, text, onSelect, onPin, isPinned){
        const item = new MenuItem.Suggestion(id, text, onSelect, onPin, isPinned);
        item.init();
        this.container.appendChild(item.divItem);
    }
    repositionIfDisplayed(menu){
        if (this.container.style.display === 'block') this.placeBeside(menu)
    }
    hide() {
        this.container.style.display = 'none';
    }
}
// One action in a Node's menu: a click on the row runs it, and the pin beside it keeps it
// in the menu itself. The whole row was the pin (#50) -- a click on "delete" deleted
// nothing and pinned "delete" -- and the pin drew nothing, because its two icons were
// retired with the old sprite.
MenuItem.Suggestion = class {
    constructor(id, text, onSelect, onPin, isPinned){
        this.id = id;
        this.isPinned = isPinned;
        this.onSelect = onSelect;
        this.onPin = onPin;
        this.text = text;
        this.btnPin = this.makeBtnPin();
        this.spanText = this.makeSpanText();
        this.divItem = this.makeDivItem();
    }
    init(){
        this.updatePin();
        On.click(this.divItem, this.onSelect);
        On.click(this.btnPin, this.togglePin);
    }

    makeBtnPin(){
        const button = Html.make.button('pin-button');
        button.setAttribute('aria-label', "Pin " + this.text);
        button.append(this.makeSvgIcon('pin-icon'));
        return button;
    }
    makeDivItem(){
        const div = Html.make.div('suggestion-item');
        div.append(this.spanText, this.btnPin);
        return div;
    }
    makeSpanText(){
        const span = Html.new.span();
        span.textContent = this.text;
        return span;
    }
    makeSvgIcon(id){
        const svg = Svg.new.svg();
        svg.setAttribute('class', 'icon ' + id);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '1em');
        svg.setAttribute('height', '1em');
        svg.setAttribute('aria-hidden', 'true');
        const use = Svg.new.use();
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + id);
        svg.appendChild(use);
        return svg;
    }

    togglePin = (e)=>{
        e.preventDefault();
        e.stopPropagation();

        this.isPinned = !this.isPinned;
        this.updatePin();

        this.onPin(this.id, this.isPinned);
    }
    updatePin(){
        this.btnPin.classList.toggle('pinned', this.isPinned);
        this.btnPin.setAttribute('aria-pressed', String(this.isPinned));
        this.btnPin.title = (this.isPinned ? "Unpin from this menu" : "Pin to this menu");
    }
}

Manager.RecentSuggestions = class {
    constructor(storageId, max = 6) { // Keep only the 6 most recent suggestions
        this.storageId = storageId;
        this.max = max;
        this.items = this.loadFromLocalStorage();
    }

    loadFromLocalStorage() {
        const storedCalls = localStorage.getItem(this.storageId);
        return storedCalls ? JSON.parse(storedCalls) : [];
    }

    saveToLocalStorage() {
        localStorage.setItem(this.storageId, JSON.stringify(this.items))
    }

    add(suggestion){
        this.items = this.items.reduce( (newItems, item)=>{
            if (newItems.length < this.max
                && item !== suggestion) newItems.push(item);
            return newItems;
        }, [suggestion]);
        this.saveToLocalStorage();
    }

    get(){ return this.items.toReversed() }
}

Manager.PinnedItems = class {
    constructor(storageId) {
        this.storageId = storageId;
        this.items = this.loadFromLocalStorage();
    }

    loadFromLocalStorage() {
        const storedItems = localStorage.getItem(this.storageId);
        return (storedItems ? JSON.parse(storedItems) : []);
    }
    saveToLocalStorage() {
        localStorage.setItem(this.storageId, JSON.stringify(this.items));
    }

    addItem(item) {
        if (this.isItemPinned(item)) return;

        this.items.push(item);
        this.saveToLocalStorage();
    }
    removeItem(item) {
        this.items = this.items.filter(pinnedItem => pinnedItem !== item);
        this.saveToLocalStorage();
    }

    forEach(cb, ct){ return this.items.forEach(cb, ct) }
    isItemPinned(item){ return this.items.includes(item) }
}

Menu.Context.prototype.pinSuggestion = function(id){
    if (this.itemById(id)) return;

    const nodeActions = NodeActions.forNode(this.targetModel);
    const menuItem = this.option(nodeActions.label(id), ()=>this.runAction(id, nodeActions), false);
    menuItem.dataset.id = id;

    this.menu.appendChild(menuItem);
    App.pinnedItems.addItem(id);
}

// One of a Node's actions, run from its menu, which closes first: `delete` asks before it
// deletes, and the question should not sit under the menu that asked it.
Menu.Context.prototype.runAction = function(id, nodeActions){
    this.hide();
    if (typeof nodeActions[id] !== 'function') return Logger.err("Invalid action:", id);

    App.recentSuggestions.add(id);
    return nodeActions[id]();
}

Menu.Context.prototype.loadPinnedItems = function(){
    const nodeActions = NodeActions.forNode(this.targetModel);
    App.pinnedItems.forEach(
        (id)=>{ if (id in nodeActions) this.pinSuggestion(id) }
    );
}

Menu.Context.prototype.setupSuggestions = function(pageX, pageY){
    const inputField = this.inputField;
    const node = this.targetModel;

    On.input(inputField, (e)=>displaySuggestions(e.target.value) );

    // Focused when the menu opens (`populateForNode`), so typing searches; a focus that only
    // puts the caret there leaves a menu of pinned actions as short as it was.
    On.focus(inputField, (e)=>{
        const quiet = inputField.dataset.quiet;
        delete inputField.dataset.quiet;
        if (inputField.value === '' && !quiet) displaySuggestions('');
    });
    // And a click into it asks for the whole list, focused already or not.
    On.click(inputField, (e)=>{
        if (inputField.value === '') displaySuggestions('');
    });

    // Enter runs the first action the text finds, as the list shows it. A method called by
    // name with its arguments, `moveNode(0, 0.05)`, is still run as it is written.
    On.keypress(inputField, (e)=>{
        if (e.key !== 'Enter') return;

        const value = e.target.value;
        e.target.value = '';
        const first = (value.trim() && !value.includes('('))
                    ? getNodeMethodSuggestions(value, node)[0] : undefined;
        if (first) return this.runAction(first, NodeActions.forNode(node));

        App.menuSuggestions.hide();
        executeNodeMethod(NodeActions.forNode(node), value);
    });

    function displaySuggestions(value) {
        const menu = App.menuSuggestions;
        menu.clear();

        const nodeActions = NodeActions.forNode(node);
        getNodeMethodSuggestions(value, node).forEach( (suggestion)=>{
            menu.addSuggestion(
                suggestion,
                nodeActions.label(suggestion),
                ()=>App.menuContext.runAction(suggestion, nodeActions),
                (id, pinState) => {
                    const funcName = (pinState ? 'pinSuggestion' : 'unpinSuggestion');
                    App.menuContext[funcName](id);
                },
                App.pinnedItems.isItemPinned(suggestion)
            );
        });

        menu.placeBeside(App.menuContext.menu);
    }
    requestAnimationFrame(() => {
        const items = [...this.menu.children];
        const actionItems = items.filter(li => !li.classList.contains('input-item'));
        if (actionItems.length === 0) displaySuggestions('');
    });
}

Menu.Context.prototype.unpinSuggestion = function(id){
    const action = this.itemById(id);
    if (action) this.menu.removeChild(action);
    App.pinnedItems.removeItem(id);
}

Menu.Context.prototype.itemById = function(id){
    return Elem.findChild(this.menu, Elem.hasDatasetIdThis, id)
}
