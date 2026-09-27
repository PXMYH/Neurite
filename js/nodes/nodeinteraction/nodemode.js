Node.stopFollowingMouse = function(node){ node.followingMouse = 0 }

class NodeMode {
    // The Connect tool is the mode on screen (#50): Shift lights it, and a click on it
    // keeps the mode on without the key (`locked`) until Escape or a second click.
    tool = Elem.byId('connectTool');
    locked = false;
    key = settings.nodeModeKey;
    trigger = settings.nodeModeTrigger;
    val = 0;
    constructor(autoToggleAllOverlays){
        this.autoToggleAllOverlays = autoToggleAllOverlays;
        On.keydown(window, this.onKeyDown);
        On.keyup(window, this.onKeyUp);
        // Capture, so this reads the modal and the menu before their own Escape
        // handlers close them.
        On.keydown(window, this.onEscape, true);
        On.click(this.tool, this.onToolClick);
        // A Shift released in another window never sends its keyup here, and the mode stayed
        // on -- lit, and taking a double-click on an Edge as a delete. The blur says so, and
        // where no blur came, the next press does: it reports the key up.
        On.blur(window, this.onBlur);
        On.mousedown(window, this.onPress, true);
    }

    switch(newState){
        this.val = newState;
        this.tool.setAttribute('aria-pressed', String(Boolean(newState)));
        document.body.classList.toggle('connect-mode', Boolean(newState));
    }
    // Turning the tool off drops a link it armed: it stayed dashed, the band still followed
    // the pointer, and the next click on any Node finished it.
    setLocked(locked){
        this.locked = locked;
        this.switch(locked ? 1 : 0);
        this.autoToggleAllOverlays();
        if (!locked) Node.prev = null;
    }
    onToolClick = ()=>{ this.setLocked(!this.locked) }
    // Whether a press is the mode's although the mode is off: the key is down, and its
    // keydown went to a text field and was ignored (`onKeyDown`). A press in that same
    // field is still text -- Shift + click extends a selection there.
    isHeldFor(e){ return e.getModifierState(this.key) && e.target !== document.activeElement }
    // What every gesture the mode gates asks: the mode is on, or its key is down for this one.
    isOnFor(e){ return Boolean(this.val) || this.isHeldFor(e) }

    skipCapsLockState(e){
        if (this.key !== "CapsLock") return true;

        this.switch(e.getModifierState("CapsLock") ? 1 : 0); // on : off
    }
    onKeyDown = (e)=>{
        if (e.key !== this.key) return;
        // Shift is also how a capital letter is typed. Taken as the mode, every
        // capital typed into a note froze the Graph and flashed the tool.
        if (Hud.isTyping()) return;
        if (!this.skipCapsLockState(e)) return;

        if (this.trigger === "down") {
            this.switch(1);
            this.autoToggleAllOverlays();
        } else if (this.trigger === "toggle") {
            this.switch(1 - this.val); // Toggle between 0 and 1
        }
    }
    // Escape, one layer at a time, from the inside out. An open modal or the menu takes it
    // first; so does an open select list, and the right-click menu, which it closes. Then
    // the text of a card: the first Escape leaves it, as it leaves the Notes panel. Past all
    // of them it drops an armed link, which otherwise waited for any later click on a Node
    // with no time limit, turns the connect mode off, and clears the selection.
    onEscape = (e)=>{
        if (e.key !== 'Escape') return;

        Graph.forEachNode(Node.stopFollowingMouse);
        if (Modal.current || dropdownContent.classList.contains('open')) return;
        if (document.querySelector('.options-replacer.show')) return;
        if (App.menuContext.menu.style.display === 'block') return App.menuContext.hide();
        const field = document.activeElement;
        if (field?.closest?.('.window') && Hud.isTyping()) return field.blur();

        this.setLocked(false);
        App.selectedNodes.clear();
    }
    onBlur = ()=>{
        if (this.locked || !this.val) return;

        this.switch(0);
        this.autoToggleAllOverlays();
    }
    onPress = (e)=>{
        if (this.trigger !== "down" || e.getModifierState(this.key)) return;
        this.onBlur();
    }
    onKeyUp = (e)=>{
        if (!this.skipCapsLockState(e)) return;
        if (e.key !== this.key || this.trigger !== "down") return;
        if (this.locked) return;

        // Do not clear the previous node
        // Node.prev = null;

        this.switch(0);
        this.autoToggleAllOverlays();
        e.stopPropagation();
    }
}
