NodeView.prototype.toggleCollapse = function(e){
    if (e) e.stopPropagation();
    if (!this.model.content) return;

    const isCollapsed = this.div.classList.contains('collapsed');
    this[isCollapsed ? 'expand' : 'collapse']();

    // Check if the alt key is being held
    if (e && e.getModifierState(controls.altKey.value)) {
        this.model.getAllConnectedNodes().forEach(Node.toggleCollapse);
    }
}
Node.toggleCollapse = function(node){ node.view.toggleCollapse() }

// The title's last line ends three quarters of the way down the circle, and a longer title grows
// up from there. Held about the middle (`translate(-50%, -65%)`), a third line reached the expand
// button under the circle's rim, and a fourth went over it.
NodeView.prototype.centerTitleInput = function(){
    const style = this.titleInputWrapper.style;
    style.position = 'absolute';
    style.top = '75%';
    style.left = '50%';
    style.transform = 'translate(-50%, -100%)';
    style.pointerEvents = 'none'; // Disable interactions during collapse
    style.zIndex = '5'; // Just in case

    // The input steps aside while collapsed and `.collapsed-title` takes its place. It
    // used to stay and carry the title itself with `width: fit-content`, which an
    // `<input>` does not honour -- an input sizes from a character count, so a long
    // title was clipped at whatever that came to and the rest was simply gone. A div
    // both wraps and measures its own text.
    this.showCollapsedTitle();
}
NodeView.prototype.resetTitleInput = function(){
    const wrapperStyle = this.titleInputWrapper.style;
    wrapperStyle.position = '';
    wrapperStyle.top = '';
    wrapperStyle.left = '';
    wrapperStyle.transform = '';
    wrapperStyle.pointerEvents = '';
    wrapperStyle.zIndex = '';

    this.hideCollapsedTitle();
}

// Written from the input when it is shown, and kept in step with it by `syncCollapsedTitle`. The
// input is the one source of truth for the title, and the Notes text renames a card through it
// while the card is collapsed (zettelkasten.js writes it in four places, a link node and the
// prompt library in more), so a copy taken only at the collapse showed the old title.
NodeView.prototype.showCollapsedTitle = function(){
    const el = this.collapsedTitle || this.ensureCollapsedTitle();
    if (!el) return;

    el.textContent = this.titleInput.value;
    el.classList.add('collapsed-title-visible');
    this.titleInput.classList.add('title-input-stowed');
}
NodeView.prototype.hideCollapsedTitle = function(){
    const el = this.collapsedTitle;
    if (el) el.classList.remove('collapsed-title-visible');

    this.titleInput.classList.remove('title-input-stowed');
    // Shown again, so it has a height to fit now (`fitTitleHeight` leaves a stowed one alone).
    this.fitTitleHeight?.();
}
// Polled with the frame, as the link strip is (`Node.step`): it returns at once unless the title
// changed while the card was a circle.
NodeView.prototype.syncCollapsedTitle = function(){
    const el = this.collapsedTitle;
    if (!el || !this.titleInput || !this.div.classList.contains('collapsed')) return;

    const title = this.titleInput.value;
    if (el.textContent !== title) el.textContent = title;
}

NodeView.prototype.hideButHeaderAndTitle = function(child){
    if (child !== this.headerContainer && child !== this.titleInput && child !== this.titleInputWrapper) {
        child.style.display = 'none';
    }
};
NodeView.prototype.collapse = function () {
    const div = this.div;

    const compStyle = getComputedStyle(div);
    this.model.content.dataset.originalSizes = JSON.stringify({
        width: compStyle.width,
        height: compStyle.height,
        minWidth: compStyle.minWidth,
        minHeight: compStyle.minHeight,
        maxWidth: compStyle.maxWidth,
        maxHeight: compStyle.maxHeight
    });

    Elem.forEachChild(div, this.hideButHeaderAndTitle, this);
    Elem.forEachChild(this.headerContainer, this.hideButHeaderAndTitle, this);

    const style = div.style;
    style.display = 'inline-block';
    style.minWidth = '60px';
    style.minHeight = '60px';
    style.width = '60px';
    style.height = '60px';
    style.maxWidth = '60px';
    style.maxHeight = '60px';
    style.borderRadius = '50%';
    style.boxShadow = 'none';
    style.backdropFilter = 'none';
    div.classList.add('collapsed');

    this.initCollapsed();

    if (div.classList.contains('window-anchored')) {
        div.classList.remove('window-anchored');
        this.circleCollapsed.classList.add('collapsed-anchor');
    }
}
NodeView.prototype.makeCircleCollapsed = function(){
    const circle = Html.make.div('collapsed-circle');
    circle.style.borderRadius = '50%';
    // Its shadow is its own (foundation.css), in the Node's colour. Copied from the card's
    // computed style it was the card's glow caught mid-transition, written inline -- so it
    // outranked the disc's rule, and a Saved Graph kept it.
    return circle;
}
NodeView.prototype.onCircleDoubleClicked = function(e){
    if (App.interface.nodeMode.isOnFor(e)) this.toggleCollapse(e)
    else e.currentTarget.classList.toggle('collapsed-anchor')
}
NodeView.prototype.initCollapsed = function(){
    if (!this.div.classList.contains('collapsed')) return;

    // Here, the one path a collapse and a restore both take: a Saved Graph is the markup, and a
    // card collapsed before would keep the title where the old placement put it.
    this.centerTitleInput();

    if (!this.btnExpand) {
        this.btnExpand = this.getBtnExpand();
        On.mousedown(this.btnExpand, this.onExpandPress.bind(this));
        On.click(this.btnExpand, this.onExpandClick.bind(this));
        On.keydown(this.btnExpand, NodeView.keyActivates(this.toggleCollapse.bind(this)));

        const circle = this.circleCollapsed = this.getCircleCollapsed();
        On.dblclick(circle, this.onCircleDoubleClicked.bind(this));
        On.dragstart(circle, Event.preventDefault);
    }
    this.btnExpand.style.display = '';
    this.circleCollapsed.style.display = '';
}
// A click on the expand button opens the note only when it is a plain click. A press that
// links -- the connect mode, or a link armed and waiting for this note -- or selects (Mod) is the
// note's, as it is anywhere else on the circle, and so is a drag: the button took the click that
// finished a link and opened the note as well, and a circle dragged by it opened where it was
// let go. Read at the press, when an armed link is still armed: its release finishes the link
// (`Node.stopFollowingMouse`), before the click. And kept for that click only, which the browser
// sends straight after the release: a click with no press before it -- assistive technology sends
// one -- is a plain click, even after a drag that ended off the button and so made no click.
// One handler per card, so a press whose release never came -- let go in another window -- adds
// no second listener (the same function is added once), and the window's blur ends it as well.
NodeView.prototype.onExpandPress = function(e){
    this.expandPress = {gesture: App.interface.nodeMode.isOnFor(e) || Mod.isHeld(e) || Boolean(Node.prev)};
    this.endExpandPress ||= ()=>{ setTimeout( ()=>{ this.expandPress = null }, 0 ) };
    On.mouseup(window, this.endExpandPress, {once: true, capture: true});
    On.blur(window, this.endExpandPress, {once: true});
}
NodeView.prototype.onExpandClick = function(e){
    const press = this.expandPress;
    this.expandPress = null;
    if (press?.gesture || (press && this.model._hasAddedGrabbing) || App.interface.nodeMode.isOnFor(e)) return;
    this.toggleCollapse(e);
}
NodeView.prototype.makeBtnExpand = function(){
    const btn = Svg.new.svg();
    btn.setAttribute('class', 'expand-button');
    // Collapsing hides the header and the collapse button with it, so this is
    // the only way back out. It has to be reachable by the same means that got
    // the card collapsed, or Enter on the collapse button is a one-way trip.
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'expand');
    btn.style.zIndex = 'inherit';

    const useElem = Svg.new.use();
    useElem.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#expand-icon");
    btn.appendChild(useElem);
    return btn;
}
NodeView.prototype.getBtnExpand = function(){
    const existing = this.div.querySelector('.expand-button');
    if (existing) return existing;

    const made = this.makeBtnExpand();
    this.div.appendChild(made);
    return made;
}
NodeView.prototype.getCircleCollapsed = function(){
    const existing = this.div.querySelector('.collapsed-circle');
    if (existing) return existing;

    const made = this.makeCircleCollapsed();
    this.div.appendChild(made);
    return made;
}

NodeView.prototype.expand = function () {
    const div = this.div;
    const style = div.style;
    const originalSize = JSON.parse(this.model.content.dataset.originalSizes);
    style.width = originalSize.width;
    style.height = originalSize.height;
    style.minWidth = originalSize.minWidth;
    style.minHeight = originalSize.minHeight;
    style.maxWidth = originalSize.maxWidth;
    style.maxHeight = originalSize.maxHeight;

    style.display = '';
    style.borderRadius = '';
    style.backgroundColor = '';
    style.borderColor = '';
    style.boxShadow = '';
    style.backdropFilter = '';
    div.classList.remove('collapsed');

    const show = (child) => { child.style.display = '' };
    Elem.forEachChild(div, show);
    Elem.forEachChild(this.headerContainer, show);

    this.resetTitleInput();

    const circle = this.circleCollapsed;
    if (!circle) return;

    if (circle.classList.contains('collapsed-anchor')) {
        div.classList.add('window-anchored');
        circle.classList.remove('collapsed-anchor');
    }
    Elem.hide(this.circleCollapsed);
    Elem.hide(this.btnExpand);
}


// Collapse and expand from the keyboard: Ctrl+Shift+M shrinks a card to its circle,
// Ctrl+Shift+F opens it again. Two keys rather than one toggle, because the point of a
// shortcut here is tidying a whole selection at once and a toggle would flip a mixed
// selection into a different mix rather than settling it.
//
// Each direction is guarded on the state it expects, and neither guard is decoration:
//   - `expand` reads `dataset.originalSizes` through `JSON.parse`, which is `undefined`
//     on a card that has never been collapsed, and `JSON.parse(undefined)` throws.
//   - `collapse` *writes* `originalSizes` from the computed style. Run it on a card that
//     is already collapsed and it records the 60px circle as the original, so the next
//     expand restores a 60px card and the real size is gone for good.
// So a no-op is the correct response to a card already in the asked-for state.
NodeView.prototype.collapseIfExpanded = function(){
    if (this.div.classList.contains('collapsed')) return false;
    if (!this.model.content) return false;

    this.collapse();
    return true;
}
NodeView.prototype.expandIfCollapsed = function(){
    if (!this.div.classList.contains('collapsed')) return false;
    if (!this.model.content) return false;

    this.expand();
    return true;
}

// The pointer is tracked here rather than read off `Graph.mousePos`, which holds plane
// coordinates -- `elementFromPoint` wants screen ones, and converting back to ask the DOM
// a question the DOM already answered is the long way round.
NodeView.lastPointer = {x: 0, y: 0};
On.mousemove(window, (e)=>{
    NodeView.lastPointer.x = e.clientX;
    NodeView.lastPointer.y = e.clientY;
});

// A selection is the explicit target and wins. With nothing selected the card under the
// pointer is what the reader means -- reaching for a shortcut after a drag-box selection
// is one workflow, and hovering one card is the other.
NodeView.viewsForShortcut = function(){
    const selected = [];
    App.selectedNodes.forEachView(Array.prototype.push, selected);
    if (selected.length) return selected;

    const p = NodeView.lastPointer;
    const div = document.elementFromPoint(p.x, p.y)?.closest('.window');
    if (!div) return [];

    let hit = null;
    Graph.forEachNode((node)=>{ if (node.view?.div === div) hit = node.view });
    return hit ? [hit] : [];
}

NodeView.runShortcut = function(method){
    const views = NodeView.viewsForShortcut();
    let changed = 0;
    for (const view of views) { if (view[method]()) changed += 1 }
    return changed;
}

On.keydown(window, (e)=>{
    if (!e.getModifierState(controls.controlKey.value)) return;
    if (!e.getModifierState(controls.shiftKey.value)) return;
    // Not through Settings, which is over the Nodes it would fold (#82).
    if (SettingsModal.isOpen()) return;

    // `e.key` carries the shifted spelling, and on some layouts a Control chord reports
    // the unshifted one, so both cases are accepted rather than guessing which arrives.
    const key = e.key.toLowerCase();
    const method = (key === 'm') ? 'collapseIfExpanded'
                 : (key === 'f') ? 'expandIfCollapsed'
                 : null;
    if (!method) return;

    // Claimed before the count is known: the chord is ours either way, and letting it
    // through on a no-op would hand Ctrl+Shift+F to the browser's own find bar.
    e.preventDefault();
    e.stopPropagation();
    NodeView.runShortcut(method);
});


//Drag Box Selection

/*
On.contextmenu(document, (e)=>{
    if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        // Additional logic for when right-click is combined with Ctrl key
        // ...
    }
});
*/
let dragBox = null;
let startX, startY;

On.mousedown(document, (e)=>{
    if (e.button === 0 && Mod.isHeld(e)) {
        e.preventDefault();
        e.stopPropagation();
        isDraggingDragBox = true;
        startX = e.pageX;
        startY = e.pageY;

        dragBox = Html.make.div('drag-box');
        dragBox.style.left = startX + 'px';
        dragBox.style.top = startY + 'px';
        document.body.appendChild(dragBox);
    }
});

On.mousemove(document, (e)=>{
    if (isDraggingDragBox) {
        e.preventDefault();
        e.stopPropagation();

        const currentX = e.pageX;
        const currentY = e.pageY;

        const style = dragBox.style;
        style.width = Math.abs(currentX - startX) + 'px';
        style.height = Math.abs(currentY - startY) + 'px';
        style.left = Math.min(startX, currentX) + 'px';
        style.top = Math.min(startY, currentY) + 'px';
    }
});

On.mouseup(document, (e)=>{
    if (isDraggingDragBox) {
        isDraggingDragBox = false;

        let isAnyNodeSelected = false;

        // Finalize the drag box bounds
        const style = dragBox.style;
        const left = parseInt(style.left, 10);
        const top = parseInt(style.top, 10);
        dragBoxBounds = {
            left, top,
            right: left + parseInt(style.width, 10),
            bottom: top + parseInt(style.height, 10)
        };

        // Check for intersection with node windows and select them
        Graph.forEachNode( (node)=>{
            const rect = node.view.div.getBoundingClientRect();
            const isNodeSelected = (rect.left < dragBoxBounds.right && rect.right > dragBoxBounds.left &&
                                    rect.top < dragBoxBounds.bottom && rect.bottom > dragBoxBounds.top);
            if (!isNodeSelected) return;

            App.selectedNodes.toggleNode(node);
            isAnyNodeSelected = true;
        });

        if (!isAnyNodeSelected) App.selectedNodes.clear();

        dragBox.remove();
        dragBox = null;
        dragBoxBounds = null;
    }
});
