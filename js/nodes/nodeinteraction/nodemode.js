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
    }

    switch(newState){
        this.val = newState;
        this.tool.setAttribute('aria-pressed', String(Boolean(newState)));
    }
    setLocked(locked){
        this.locked = locked;
        this.switch(locked ? 1 : 0);
        this.autoToggleAllOverlays();
    }
    onToolClick = ()=>{ this.setLocked(!this.locked) }
    // Whether a press is the mode's although the mode is off: the key is down, and its
    // keydown went to a text field and was ignored (`onKeyDown`). A press in that same
    // field is still text -- Shift + click extends a selection there.
    isHeldFor(e){ return e.getModifierState(this.key) && e.target !== document.activeElement }

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
    // Escape is the outermost layer: an open modal or menu takes it first. Past them it
    // drops an armed link, which otherwise waited for any later click on a Node with no
    // time limit, and turns off a Connect tool that was clicked on.
    onEscape = (e)=>{
        if (e.key !== 'Escape') return;

        Graph.forEachNode(Node.stopFollowingMouse);
        if (Modal.current || dropdownContent.classList.contains('open')) return;

        Node.prev = null;
        if (this.locked) this.setLocked(false);
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
