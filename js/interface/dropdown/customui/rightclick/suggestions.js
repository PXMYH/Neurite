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
    // Beside the menu it belongs to, on the screen, and never over the pointer or the menu.
    // It was anchored to the pointer -- above and to its left, with its last row under it,
    // so the click that dismissed the menu ran that row -- and near the left edge its labels
    // began at x -215. So: below the menu, else above it and the pointer, else to the side
    // away from the pointer, else the other side; the first that fits and covers neither.
    // A side is measured from the menu or the pointer, whichever is further out: the menu
    // opens 5px from the pointer, so a list measured from the menu alone ended over it.
    // Where none fits whole, the first that covers neither once pulled onto the screen, and
    // failing that, the first that at least leaves the pointer clear -- the click that
    // dismisses the menu lands there, and runs the row under it.
    placeBeside(menu, pointer) {
        const style = this.container.style;
        style.transform = '';
        style.display = 'block';

        const m = menu.getBoundingClientRect();
        const w = this.container.offsetWidth, h = this.container.offsetHeight;
        const gap = 4, edge = 8, W = innerWidth, H = innerHeight;
        const clampX = (x)=>Math.max(edge, Math.min(x, W - w - edge));
        const clampY = (y)=>Math.max(edge, Math.min(y, H - h - edge));
        const leftOfMenu = (pointer.x >= m.right);   // the menu flipped to the pointer's left
        const side = (left)=>({y: clampY(m.top), x: (left ? Math.min(m.left, pointer.x) - gap - w
                                                         : Math.max(m.right, pointer.x + 1) + gap)});
        const candidates = [
            {x: clampX(m.left), y: m.bottom + gap},
            {x: clampX(m.left), y: Math.min(m.top, pointer.y) - gap - h},
            side(leftOfMenu),
            side(!leftOfMenu)
        ];
        const fits = (c)=>(c.x >= edge && c.x + w <= W - edge && c.y >= edge && c.y + h <= H - edge);
        const covers = (c, r)=>(c.x < r.right && c.x + w > r.left && c.y < r.bottom && c.y + h > r.top);
        const dot = {left: pointer.x, right: pointer.x + 1, top: pointer.y, bottom: pointer.y + 1};
        const clear = (c)=>!covers(c, m) && !covers(c, dot);
        const onScreen = candidates.map( (c)=>({x: clampX(c.x), y: clampY(c.y)}) );
        const at = candidates.find( (c)=>fits(c) && clear(c) )
                ?? onScreen.find(clear)
                ?? onScreen.find( (c)=>!covers(c, dot) )
                ?? onScreen[2];
        style.left = at.x + 'px';
        style.top = at.y + 'px';
    }
    clear() {
        this.container.innerHTML = '';
    }
    addSuggestion(id, text, onSelect, onPin, isPinned){
        const item = new MenuItem.Suggestion(id, text, onSelect, onPin, isPinned);
        item.init();
        this.container.appendChild(item.divItem);
    }
    repositionIfDisplayed(menu, pointer){
        if (this.container.style.display === 'block') this.placeBeside(menu, pointer)
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

        menu.placeBeside(App.menuContext.menu, {x: pageX, y: pageY});
    }
    // A frame later -- and only while the menu is still open on the Node it was opened for.
    // An Escape or a click elsewhere inside that frame closed the menu, and the list opened
    // anyway, on its own, over whatever was under it, until the next right-click.
    requestAnimationFrame(() => {
        if (this.menu.style.display !== 'block' || this.targetModel !== node) return;

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
