class Node {
    // The note a pending link starts from, behind an accessor so the card can show it.
    //
    // A Shift + press on a note arms a link, and the next click on another note finishes
    // it -- with no time limit. Arm one, forget, click a note a minute later, and an edge
    // appears that was never asked for, in an app with no undo. The state was real and
    // invisible; now the card it started from is marked while it lasts (and Escape drops
    // it).
    //
    // An accessor rather than a call at each assignment site, because the marker has to
    // survive every one of them, including a press on the Plane clearing it
    // (`Interface.onMouseDown`) and a delete clearing it because the armed card went
    // (`window.js`).
    static #prev = null;

    static get prev(){ return Node.#prev }
    static set prev(node){
        Node.#prev?.view?.div?.classList.remove('link-pending');
        Node.#prev = node;
        node?.view?.div?.classList.add('link-pending');
    }

    // The scale last written as `--card-scale` for the selection ring (`draw`). Private, so
    // `toJSON` does not save it.
    #ringScale = null;
    // The armed Node a press on this one would link it to, if the press ends as a click.
    #linkOnClick = null;

    // How far the pointer travels before a press counts as a drag rather than a click.
    // A press under this distance keeps the pending Edge alive, so Shift plus a click
    // can still start one; past it the press is moving the Node instead.
    static dragThreshold = 10;

    // A card's box on screen, for `draw` (`NodeSimulation.updateNodes` reads every one first).
    static boxOf(node){ return node.content.getBoundingClientRect() }

    anchor = new vec2(0, 0);
    anchorForce = 0;
    createdAt = new Date().toISOString();
    edges = [];
    init = Function.nop;
    mouseAnchor = new vec2(0, 0);
    save_extras = [];
    view = null;

    constructor(thing, createEdges = true){
        if (thing) {
            this.content = thing;
            const dataset = thing.dataset;

            const nodeData = JSON.parse(dataset.node_json)
            const vecProps = ['anchor', 'mouseAnchor', 'vel', 'pos', 'force'];
            for (const k in nodeData) {
                const val = nodeData[k];
                this[k] = (vecProps.includes(k) ? new vec2(val) : val);
            }

            if (dataset.node_extras) {
                const extraData = JSON.parse(dataset.node_extras);
                for (const e of extraData) Node.Extensions[e.f](this, e.a);
            }

            if (dataset.edges !== undefined && createEdges) {
                const edgesData = JSON.parse(dataset.edges);
                this.init = ()=>{
                    for (const edgeData of edgesData) {
                        edgeFromJSON(edgeData)
                    }
                };
            }
        } else {
            this.content = Html.new.div();
            this.uuid = String(Graph.nextUuid);
            this.pos = Graph.vecToZ();

            this.vel = new vec2(0, 0);
            this.force = new vec2(0, 0);
            this.frictionConstant = 0.2;
            this.intervalID = null;
            this.followingMouse = 0;

            this.randomNodeFlowRange = (Math.random() - 0.5) * settings.flowDirectionRandomRange;
            this.removed = false;
            this.sensor = new NodeSensor(this, 3);
        }

        this.addListeners();
    }
    addListeners() {
        const div = this.content;
        On.click(div, this.onClick);
        On.dblclick(div, this.onDblClick);
        On.mousedown(div, this.onMouseDown);
        On.mouseup(document, this.onMouseUp);
        // Not passive: this handler takes the wheel over a card and zooms the canvas
        // with it, which means cancelling the page's own response to it.
        On.wheel(div, this.onWheel, {passive: false});
    }
    toJSON() {
        return JSON.stringify({...this}, (k, v) => {
            if (k === "content" || k === "edges" || k === "save_extras" || k === "viewer" ||
                k === "aiResponseEditor" || k === "aiNodeMessageLoop" || k === "sensor" || k === "responseHandler" ||
                k === "view" || k === "agent" || k === "typeNode") {
                return undefined;
            }
            return v;
        });
    }
    updateNodeData() {
        // The Title as it is now, in the markup a Saved Graph keeps. A textarea's text is its
        // default value, written once when the card was built, and a rename changes `.value`
        // only. So a note typed into the Pane -- made at "##" under a timestamp and named as
        // the Title was typed -- came back from a reload under the timestamp: the pass found
        // no Node with its Title, made a second one, and left the first as an empty card.
        const title = this.view?.titleInput;
        if (title && title.textContent !== title.value) title.textContent = title.value;

        const saveExtras = [];
        for (const extra of this.save_extras) {
            saveExtras.push(typeof extra === "function" ? extra(this) : extra);
        }
        this.content.dataset.node_extras = JSON.stringify(saveExtras);
        this.content.dataset.node_json = this.toJSON();
    }
    push_extra_cb(f) {
        this.save_extras.push(f);
        return this;
    }
    push_extra(func_name, args = undefined) {
        this.save_extras.push({
            f: func_name,
            a: args
        });
    }

    updateSensor() {
        this.sensor.callUpdate();
        Logger.debug(this.sensor.nearbyNodes);
        Logger.debug("extended radius", this.sensor.nodesWithinExtendedRadius);
    }

    hasBoundingRectangle(){
        const bb = this.content.getBoundingClientRect();
        return bb && bb.width > 0 && bb.height > 0;
    }

    // `box` is the card's own box, when the caller measured it before this frame wrote anything
    // (`NodeSimulation.updateNodes`); it was measured at the scale the card was last drawn at.
    // Without it the box is read here, after the transform below, at this frame's scale -- or,
    // given `later`, by the caller, which reads every such box at once after all its writes and
    // hands each to `place`.
    draw(box = null, svgbb = svg.getBoundingClientRect(), later = null) {
        const e = this.content;
        const s = this.intrinsicScale * this.scale * (Graph.zoom.mag2() ** -settings.zoomContentExp);
        // A box read before the card was ever drawn -- no transform yet, still in the flow -- or
        // while it was hidden, is not the box it is drawn with, and one frame of a new card, or
        // of one the view has just jumped onto, was drawn up to a card's width off its place
        // (rv15). Those few are read again, after the writes.
        const drawnAt = parseFloat(e.style.transform.slice('scale('.length));
        if (box && (!(drawnAt > 0) || e.style.display === 'none' || !(box.width > 0))) box = null;
        this.#measuredAt = box ? drawnAt : s;

        e.style.position = 'absolute';
        e.style.transform = 'scale(' + s + ',' + s + ')';
        // The selection ring divides by this to stay 2 screen px at any zoom (foundation.css).
        // Written only for a selected Node, and only when it changes: it is inherited, so a
        // write restyles the whole card.
        if (this.#ringScale !== s && this.view?.div?.classList.contains('selected')) {
            e.style.setProperty('--card-scale', s);
            this.#ringScale = s;
        }
        let p = fromZtoUV(this.pos);
        const cond = p.minus(new vec2(0.5, 0.5)).mag2() > 16;
        e.style.display = (cond ? 'none' : 'initial');

        const w = Math.min(svgbb.width, svgbb.height);
        const off = svgbb.width < svgbb.height ? svgbb.right : svgbb.bottom;
        p.x = w * p.x - (off - svgbb.right) / 2;
        p.y = w * p.y - (off - svgbb.bottom) / 2;
        this.#centre = p;

        if (!box && later) return void later.push(this);
        this.place(box ?? e.getBoundingClientRect());
    }
    // The card put with its centre where `draw` worked it out, by its box as it is drawn.
    #centre = null;
    #measuredAt = 1;
    place(bb){
        const p = this.#centre.minus(new vec2(bb.width, bb.height).scale(0.5 / this.#measuredAt));
        this.content.style.left = p.x + 'px';
        this.content.style.top = p.y + 'px';

        //e.style['margin-top'] = "-"+(e.offsetHeight/2)+'px';//"-50%";
        //e.style['margin-left'] = "-"+(e.offsetWidth/2)+'px';//"-50%";
        //e.style['vertical-align']= 'middle';
        //e.style['text-align']= 'center';
    }

    step(dt, box, svgbb, later) {
        dt = this.clampDt(dt);
        this.updatePosition(dt);
        this.applyMandelbrotForce();
        this.applyAnchorForce();
        this.handleMouseInteraction(dt);
        this.draw(box, svgbb, later);
        // Returns immediately unless this card's links changed since the last
        // frame. See linkstrip.js for why the row is polled and not pushed to.
        LinkStrip.refresh(this.view);
    }

    clampDt(dt) {
        return (isNaN(dt) ? 0 : Math.min(dt, 1))
    }

    updatePosition(dt) {
        if (!this.followingMouse && this.anchorForce == 0) {
            this.pos = this.pos.plus(this.vel.scale(dt / 2));
            this.vel = this.vel.plus(this.force.scale(dt));
            this.pos = this.pos.plus(this.vel.scale(dt / 2));
            this.force = this.vel.scale(-Math.min(this.vel.mag() + this.frictionConstant + this.anchorForce, 1 / (dt + 1e-300)));
        } else {
            this.vel = new vec2(0, 0);
            this.force = new vec2(0, 0);
        }
    }

    applyMandelbrotForce() {
        if (this.anchorForce !== 0) return;

        const g = Fractal.grad(settings.iterations, this.pos);

        if (settings.useFlowDirection && g.mag2() > 0) {
            const randomRotation = this.randomNodeFlowRange;
            const flowDirection = g.rot(settings.flowDirectionRotation + randomRotation).normed();
            const forceMagnitude = g.mag();

            this.force = this.force.plus(flowDirection.scale(forceMagnitude).unscale((g.mag2() + 1e-10) * 300));
        }

        if (!settings.useFlowDirection && g.mag2() > 0) {
            this.force = this.force.plus(g.unscale((g.mag2() + 1e-10) * 300))
        }
    }

    applyAnchorForce() {
        this.force = this.force.plus(this.anchor.minus(this.pos).scale(this.anchorForce))
    }

    handleMouseInteraction(dt) {
        if (!this.followingMouse) return;

        const p = Graph.vecToZ().minus(this.mouseAnchor);
        const delta = p.minus(this.pos);
        const velocity = delta.unscale(App.nodeMode ? 1 : dt);

        this.vel = velocity;
        this.pos = p;
        this.anchor = this.pos;

        if (App.nodeMode === 1) updateNodeEdgesLength(this);

        if (!App.selectedNodes.uuids.has(this.uuid)) return;

        // The rest of the selection comes along. A pinned Node was left where it was, and
        // every note arrives pinned, so a group drag moved only the Node under the pointer;
        // it moves by the same step now, its pin with it.
        App.selectedNodes.forEach(node => {
            if (node.uuid === this.uuid) return;

            if (node.anchorForce) {
                node.pos = node.pos.plus(delta);
                node.anchor = node.pos;
            } else {
                node.vel = velocity;
            }
            if (App.nodeMode === 1) updateNodeEdgesLength(node);
        });
    }

    moveNode(angle, forceMagnitude = 0.01) {
        const adjustedForce = forceMagnitude * this.scale; // Scale the force
        const forceDirection = new vec2(Math.cos(angle) * adjustedForce, Math.sin(angle) * adjustedForce);

        // Apply the force to the node
        this.force = this.force.plus(forceDirection);
        return forceDirection; // optional
    }

    moveTo(x, y, baseTolerance = 1, onComplete = ()=>{} ) {
        const targetComplexCoords = new vec2(x, y);
        const tolerance = baseTolerance * this.scale;

        const update = () => {
            const distanceVector = targetComplexCoords.minus(this.pos);
            const distance = distanceVector.mag();
            if (distance < tolerance) {
                clearInterval(this.intervalID);
                clearTimeout(this.timeoutID);
                this.intervalID = null;
                onComplete();
            } else {
                const forceMagnitude = Math.min(0.002 * this.scale, distance);
                const forceDirection = distanceVector.normed().scale(forceMagnitude);
                this.force = this.force.plus(forceDirection);
            }
        };

        if (this.intervalID !== null) clearInterval(this.intervalID);
        if (this.timeoutID !== null) clearTimeout(this.timeoutID);

        this.intervalID = setInterval(update, 20); // Start the movement updates

        // Set a fixed timeout to stop the movement after 4 seconds
        this.timeoutID = setTimeout(() => {
            clearInterval(this.intervalID);
            this.intervalID = null;
            Logger.debug("Movement stopped after 4 seconds.");
            onComplete(); // even if the target hasn't been reached
        }, 4000); // 4 secs
    }

    // What the Node says, and not what its card says about other Nodes. The link strip names
    // each Node this one is linked to, and its "+ link" is on every card: measured, a search
    // for "link" matched every Node, and "gam" each Node linked to Gamma. One text node at a
    // time rather than each element's `textContent`, which is the only way to leave a
    // subtree out.
    searchStrings() {
        function* search(e) {
            if (e.classList.contains('link-strip')) return;
            if (e.value) yield e.value;
            for (const c of e.childNodes) {
                if (c.nodeType === document.TEXT_NODE) yield c.data;
                else if (c.nodeType === document.ELEMENT_NODE) yield* search(c);
            }
        }
        return search(this.content);
    }
    onClick = (e)=>{

    }
    toggleWindowAnchored(anchored) {
        const windowDiv = this.view.div;
        if (windowDiv.classList.contains('collapsed')) return;

        windowDiv.classList.toggle('window-anchored', anchored);
    }
    onDblClick = (e) => {
    }
    onMouseDown = (e) => {
        this.mouseAnchor = Graph.xyToZ(e.clientX, e.clientY).minus(this.pos);
        this.followingMouse = 1;
        Graph.draggedNode = this;
        Graph.movingNode = this;

        // A press arms a link from this Node, and a click on another finishes it -- a click,
        // not a press: a drag that began on the second Node finished the link and moved the
        // Node as well. Shift itself counts as well as the mode, since a Shift pressed while
        // the caret was in a text field never turned the mode on (`NodeMode.isOnFor`).
        // A primary press only: a right-click armed and finished links too, and wrote Refs.
        const primary = Mod.isPrimary(e);
        const armed = (primary ? Node.prev : null);
        this.#linkOnClick = armed;
        if (primary && !armed && App.interface.nodeMode.isOnFor(e)) Node.prev = this;

        // A gesture on the card keeps the caret out of its text, or the title took the next
        // keys -- measured, typing "X" in the connect mode renamed a note.
        if (primary && (armed || Node.prev === this || Mod.isHeld(e))) e.preventDefault();

        clearTextSelections();

        this._initialMousePos = { x: e.clientX, y: e.clientY };
        this._hasAddedGrabbing = false;

        On.mousemove(window, this._maybeAddGrabbing);
        On.mouseup(window, this.stopFollowingMouse);

        e.stopPropagation();
    }
    _maybeAddGrabbing = (e) => {
        if (this._hasAddedGrabbing) return;

        const dx = e.clientX - this._initialMousePos.x;
        const dy = e.clientY - this._initialMousePos.y;
        const threshold = Node.dragThreshold;

        if (dx * dx + dy * dy > threshold * threshold) {
            this._hasAddedGrabbing = true;
            // The press is a drag, so it moves this Node. Discard any Edge it had started.
            Node.prev = null;
            OverlayHelper.add('grabbing');
            Off.mousemove(window, this._maybeAddGrabbing); // Remove listener after adding
        }
    }
    stopFollowingMouse = (e) => {
        // Down where the pointer is now, not where the last frame drew it. A tap sends its
        // mousemove and its mouseup in one go, with no frame between them, so a note made by a
        // tap on the Note tool followed the finger nowhere and landed under the tool bar
        // instead of where the next tap put it down (#56).
        if (this.followingMouse) {
            this.pos = Graph.vecToZ().minus(this.mouseAnchor);
            this.anchor = this.pos;
        }
        this.followingMouse = 0;
        Graph.movingNode = undefined;

        // The release that makes a press a click finishes an armed link; a drag dropped it
        // already (`_maybeAddGrabbing`). A click on the armed Node itself only disarms it.
        // And only if the link is still armed: an Escape during the press dropped it.
        const armed = this.#linkOnClick;
        this.#linkOnClick = null;
        if (armed && armed === Node.prev && !this._hasAddedGrabbing) {
            if (armed !== this) connectNodes(this, armed);
            Node.prev = null;
        }

        Off.mousemove(window, this._maybeAddGrabbing);
        Off.mouseup(window, this.stopFollowingMouse);
        OverlayHelper.remove(); // Clean up just in case
    }
    // A finger or a pen on the header moves the card (#57), through Pointer Events: a touch
    // sends no mousemove, and the browser took the drag as a pan and cancelled it. The mouse
    // keeps `onMouseDown`, because moving it here would route around the `mousedown` guards
    // that keep a press on a card's text from dragging the card. A tap is not taken here
    // either: the browser sends it on as mouse events and a click once the finger lifts
    // (measured in WebKit and Chromium), so it lands where a click always did -- the header's
    // buttons, the Title's caret, the Link tool (#58). A press moves the card once it travels
    // past `dragThreshold`, so a tap's wobble moves nothing, and the point pressed stays under
    // the finger. Page coordinates for both ends, as `Graph.mousePos` is kept in them: the
    // page may be scrolled while the keyboard is up.
    //
    // Bound on the card, for its header -- and for the circle a collapsed card is, which is
    // outside the header and moved by a mouse and not by a finger (rv15).
    onHeaderPointerDown = (e)=>{
        if (e.pointerType === 'mouse' || !e.isPrimary) return;
        if (!e.target.closest?.('.header-container, .collapsed-circle')) return;
        if (e.target.closest('[role="button"]')) return;

        const id = e.pointerId, from = {x: e.pageX, y: e.pageY};
        let dragging = false;
        // A pen the browser sends on as a mouse too -- Chromium does, while it moves -- is moved by
        // `onMouseDown`, as a mouse is. Taken here as well, its drag swallowed the mouseup that
        // ends that one (`swallowTheTap`), and the page was left under the grabbing overlay.
        let mouseToo = false;
        const onMouse = ()=>{ mouseToo = true };
        const move = (e)=>{
            if (e.pointerId !== id) return;
            // A second finger made this one part of a pinch (interface.js), which the card sits out.
            if (!dragging && (mouseToo || TouchOnPlane.points.has(id))) return end(e);
            if (!dragging) {
                if (Math.hypot(e.pageX - from.x, e.pageY - from.y) <= Node.dragThreshold) return;

                dragging = true;
                // As a mouse press becomes a drag (`_maybeAddGrabbing`): it moves this Node,
                // and an Edge a press had started is discarded.
                Node.prev = null;
                Autopilot.stop();
                this.mouseAnchor = Graph.xyToZ(from.x, from.y).minus(this.pos);
                this.followingMouse = 1;
                Graph.draggedNode = this;
                Graph.movingNode = this;
            }
            Graph.mousePos_setXY(e.pageX, e.pageY);
        };
        const end = (e)=>{
            if (e.pointerId !== id) return;

            Off.pointermove(window, move);
            Off.pointerup(window, end);
            Off.pointercancel(window, end);
            Off.mousedown(window, onMouse, true);
            if (!dragging) return;

            this.followingMouse = 0;
            Graph.draggedNode = undefined;
            Graph.movingNode = undefined;
            Node.swallowTheTap();
        };
        On.pointermove(window, move);
        On.pointerup(window, end);
        On.pointercancel(window, end);
        On.mousedown(window, onMouse, true);
    }
    // A finger that moved a card past `dragThreshold` and lifted inside the browser's own slop
    // for a tap (about 15 px in Chromium) still has the tap sent on as mousedown, mouseup and
    // click -- which put the caret in the Title, and with the Connect tool on armed the card for
    // an Edge no one asked for (rv14). The finger's `touchend`, which comes straight after the
    // `pointerup` this is called from, is cancelled, and a browser sends no tap for a cancelled
    // one. The mouse events are taken out as well for the moment they would arrive in: a window
    // of 400 ms did it alone, and took out a tap made straight after the drag too (rv15).
    static #tapSwallowedUntil = 0;
    static #swallowing = false;
    // Bound on first use, at the end of the first drag and so before its tap arrives, which
    // keeps this file free of anything that runs as it loads.
    static swallowTheTap(){
        Node.#tapSwallowedUntil = performance.now() + 100;
        if (Node.#swallowing) return;

        Node.#swallowing = true;
        for (const type of ['mousedown', 'mouseup', 'click']) On[type](window, Node.onCompatMouse, true);
        On.touchend(window, Node.onLiftOfTheDrag, true);
    }
    static onLiftOfTheDrag(e){
        if (performance.now() > Node.#tapSwallowedUntil) return;

        if (e.cancelable) e.preventDefault();
    }
    static onCompatMouse(e){
        if (performance.now() > Node.#tapSwallowedUntil) return;

        e.preventDefault();
        e.stopImmediatePropagation();
    }

    disableEmbedPointerEvents(){this.setEmbedPointerEvents('none')};
    enableEmbedPointerEvents(){ this.setEmbedPointerEvents('auto')};
    setEmbedPointerEvents(value) {
        this.content.querySelectorAll('iframe, webview').forEach(embed => {
            embed.style.pointerEvents = value;
        });
    }

    onMouseUp = (e)=>{
        if (this === Graph.draggedNode) {
            this.followingMouse = 0;
            Graph.draggedNode = undefined;
        }
    }
    onWheel = (e)=>{
        // Without Shift, the wheel is the canvas's gesture, not the card's.
        //
        // This returned and nothing else happened: the canvas's own wheel listener is
        // bound to `#svg_bg` (interface.js:124) and a card is not inside it, so the
        // primary navigation gesture in the app silently did nothing whenever the
        // pointer was over a note. Measured: ten wheel notches over a card left
        // `Graph.zoom.mag()` at 0.301194, unchanged. And cards are drawn at full scale
        // now, so they cover far more of the viewport than they did -- the fraction of
        // the screen where zooming failed went up with the thing that made them legible.
        //
        // A note whose body has more text than fits still scrolls, because that is what
        // the wheel means inside a scrollable box; the canvas only takes the gesture when
        // there is nothing to scroll.
        if (!App.interface.nodeMode.isOnFor(e)) {
            if (Node.wheelScrollsContent(e)) return;
            Autopilot.stop();
            const amount = Math.exp(-e.deltaY * settings.zoomSpeed * settings.zoomSpeedMultiplier);
            performZoom(amount, Graph.vecToZ());
            regenAmount += Math.abs(e.deltaY);
            e.preventDefault();
            return;
        }

        // The same expression the fractal's own zoom uses (interface.js), and for the same
        // reason: `deltaY` is negative when the wheel goes up, so the exponent is negated
        // for up to mean in. This read `e.wheelDelta`, which is the legacy property and
        // carries the *opposite* sign -- +120 for a scroll up where `deltaY` is -120 -- so
        // Shift plus a scroll up shrank a card while the same gesture on the canvas zoomed
        // into the fractal. One card and one plane, two directions.
        const amount = Math.exp(-e.deltaY * settings.zoomSpeed * settings.zoomSpeedMultiplier);

        if (Autopilot.isMoving() && this.uuid === Autopilot.referenceFrame.uuid) {
            Autopilot.targetZoom_scaleBy(1 / amount);
        } else {
            // Scale selected nodes or individual node
            // A selection scales about the pointer, pinned Nodes with their pins: they were
            // left in place while growing, so a scaled group ran into itself.
            const targetWindow = e.target.closest('.window');
            if (targetWindow && targetWindow.classList.contains('selected')) {
                App.selectedNodes.forEach((node) => {
                    node.scale *= amount;
                    node.pos = node.pos.lerpto(Graph.vecToZ(), 1 - amount);
                    if (node.anchorForce) node.anchor = node.pos;

                    updateNodeEdgesLength(node);
                });
            } else {
                this.scale *= amount;

                // Only update position if not anchored
                if (this.anchorForce !== 1) {
                    this.pos = this.pos.lerpto(Graph.vecToZ(), 1 - amount);
                }
            }
        }
        e.stopPropagation();
    }
    disableEmbedPointerEvents(){this.setEmbedPointerEvents('none')};
    enableEmbedPointerEvents(){ this.setEmbedPointerEvents('auto')};
    setEmbedPointerEvents(value) {
        this.content.querySelectorAll('iframe, webview').forEach(embed => {
            embed.style.pointerEvents = value;
        });
    }

    getText(){
        return (this.textarea || this.contentEditableDiv)?.value || ''
    }
    getTitle(){ return this.view.titleInput.value }

    getEdgeDirectionalities() {
        return this.edges.map( (edge)=>({
            edge,
            directionality: edge.getDirectionRelativeTo(this)
        }) );
    }

    addEdge(edge) {
        this.edges.push(edge);
        this.updateEdgeData();
    }
    static addEdgeThis(node){ node.addEdge(this) }

    updateEdgeData() {
        const es = JSON.stringify(this.edges.map(Edge.dataForEdge));
        Logger.debug("Saving edge data:", es);
        this.content.dataset.edges = es;
    }

    removeEdgeByIndex(index){
        this.edges[index].remove();
        this.edges.splice(index, 1);
    }
    removeEdgeByTitle(targetTitle) {
        const edges = this.node.edges;
        let removed = false;

        for (let i = edges.length - 1; i >= 0; i--) {
            if (edges[i].pts.some(pt => pt.getTitle() === targetTitle)) {
                Logger.debug(`Disconnecting edge to node: ${targetTitle}`);
                edges[i].remove(); // Directly remove the edge
                removed = true;
            }
        }

        if (!removed) {
            Logger.warn(`No edge found connecting to node: ${targetTitle}`);
        }
    }
    removeConnectedNodes(nodes) {
        const nodeUUIDs = new Set(nodes.map(node => String.uuidOf(node)));

        for (let i = this.edges.length - 1; i >= 0; i--) {
            const edge = this.edges[i];
            if (edge.pts.some(pt => nodeUUIDs.has(pt.uuid))) {
                edge.remove();
            }
        }
    }

    remove(){ Graph.deleteNode(this) }

    static byUuid(uuid){ return Graph.nodes[uuid] }
    static filterEdgesToThis(node){
        node.edges = node.edges.filter( (edge)=>!edge.pts.includes(this) )
    }
    // Every flag a node creator writes, and the type name it answers to. This was
    // an if-chain that knew three of the five, so an image node and a file-tree
    // node both reported 'base' -- while getData in connect.js derived the type a
    // second time from the same flags and answered 'image' for that same node. The
    // model reads both, so it was told two different types for one node.
    //
    // A creator sets exactly one flag and toJSON round-trips it, so the order here
    // is not load-bearing. Media and Wolfram nodes set no flag at all; they are
    // the 'base' default.
    static typeByFlag = {
        isTextNode: 'text',
        isLLM: 'llm',
        isLink: 'link',
        isImageNode: 'image',
        isFileTree: 'fileTree'
    };
    static getType(node){
        for (const flag in Node.typeByFlag) {
            if (node[flag]) return Node.typeByFlag[flag];
        }
        return 'base';
    }
    // Whether this wheel event belongs to something scrollable under the pointer, in
    // the direction it is going. A body with more text than fits keeps the wheel; one
    // already at its end hands it to the canvas, so a short note does not trap the
    // gesture at all and a long one stops trapping it once it is read to the bottom.
    static wheelScrollsContent(e){ return Boolean(Node.scrollerFor(e.target, e.deltaY)) }
    // The box at or above `el` that can scroll the way `deltaY` goes (down when positive), or
    // null. A finger on a card asks it too (interface.js).
    static scrollerFor(el, deltaY){
        for (; el && el !== document.body; el = el.parentElement) {
            const canScroll = el.scrollHeight - el.clientHeight > 1;
            if (!canScroll) continue;
            const style = getComputedStyle(el);
            if (!/auto|scroll/.test(style.overflowY)) continue;

            const atTop = el.scrollTop <= 0;
            const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
            if (deltaY < 0 && !atTop) return el;
            if (deltaY > 0 && !atBottom) return el;
        }
        return null;
    }

    static remove(node){ node.remove() }
    static removeThisEdge(node){
        const index = node.edges.indexOf(this);
        if (index < 0) return;

        node.edges.splice(index, 1);
        node.updateEdgeData();
    }
}

Node.Extensions = {
    "window": (node, a)=>{
        const odiv = node.content;
        odiv.dataset.viewType = 'nodeViews';
        odiv.dataset.viewId = node.uuid;

        const view = node.view = new NodeView(node);
        view.buttons = odiv.querySelector('.button-container');
        view.headerContainer = odiv.querySelector('.header-container');
        view.innerContent = odiv.querySelector('.content');
        view.resizeHandle = odiv.querySelector('.resize-handle');
        view.titleInput = odiv.querySelector('.title-input');
        view.div = odiv.querySelector('.window');

        // A card with no `.window` in its saved markup cannot be windowified: everything
        // `rewindowify` goes on to do reads this div, starting with
        // `initCollapsed`, which asked for `this.div.classList` and threw. That throw
        // travelled all the way out of `new Node` and aborted the whole load, so one
        // malformed card cost every card after it rather than costing itself. Say so and
        // leave this one flat instead.
        if (!view.div) {
            return Logger.warn("Card", node.uuid, "was saved without its window markup; "
                             + "leaving it unwindowified rather than failing the load");
        }

        view.rewindowify();
    },
    // A saved field, found by what it is where the saves name it by child indices: [0,0,1]
    // is a card's Title, [0,1,0] a note's body. The card's markup moved under both -- the
    // Title became a textarea in a wrapper, the link strip went in above the body -- so the
    // paths led to the wrapper and to the "+ link" button. A restored card then took its
    // Title from its markup, written when it was built: a note typed into the Pane, or
    // renamed on its card, came back under an old Title, and the pass made it a second
    // Node. The saves had the right Title all along.
    "textarea": (node, o) => {
        const path = JSON.stringify(o.p);
        let e = (path === '[0,0,1]') ? node.content.querySelector('.title-input')
              : (path === '[0,1,0]') ? node.content.querySelector('.node-textarea')
              : null;
        if (!e) {
            e = node.content;
            for (const w of o.p) {
                e = e?.children[w];
            }
        }
        if (!e) return;

        const p = o.p;
        // A save from while the path was wrong can hold nothing for the Title.
        if (o.v !== undefined && o.v !== null) e.value = o.v;

        node.push_extra_cb( (n)=>({
            f: "textarea",
            a: { p, v: e.value }
        }) );
    },
    "textareaId": (node, o) => {
        const textarea = node.content.querySelector('#' + o.p);
        if (textarea) textarea.value = o.v;

        node.push_extra_cb( (n)=>({
            f: "textareaId",
            a: {
                p: textarea.id,
                v: textarea.value
            }
        }) );
    },
    "checkboxId": (node, o) => {
        // Query for checkboxes based on a specific ID and update their state
        const checkbox = node.content.querySelector(`input[type="checkbox"][id='${o.p}']`);
        if (!checkbox) return;

        checkbox.checked = o.v;
        node.push_extra_cb( (n)=>({
            f: "checkboxId",
            a: {
                p: o.p,  // Pass the ID of the checkbox
                v: checkbox.checked  // Save the current state
            }
        }) );
    },
    "sliderId": (node, o) => {
        // Query for sliders based on a specific ID and update their value
        const slider = node.content.querySelector(`input[type="range"][id='${o.p}']`);
        if (!slider) return;

        slider.value = o.v ?? o.d;  // Set the slider's value based on the value provided or the default value
        node.push_extra_cb( (n)=>({
            f: "sliderId",
            a: {
                p: o.p,  // Pass the ID of the slider
                v: slider.value  // Save the current value
            }
        }) );
    },
}
