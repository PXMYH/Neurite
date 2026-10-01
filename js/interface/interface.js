const Autopilot = {
    panToI: new vec2(0, 0),
    panToI_prev: null,
    referenceFrame: null,
    referenceScalePrev: 1,
    speed: 0,
    targetPan: new vec2(0, 0),
    targetZoom: new vec2(4, 0),
    threshold: 0.000001,

    isMoving(){ return this.speed !== 0 },
    reset(){
        Autopilot.speed = 0;
        return Autopilot.setNode();
    },
    setNode(node = null){
        this.referenceFrame = node;
        return this;
    },
    skip(){
        Graph.zoom_set(this.targetZoom)
            .pan_set(!this.referenceFrame ? this.targetPan
                    : this.referenceFrame.pos.plus(this.targetPan));
        return this;
    },
    start(speed = settings.autopilotSpeed){
        this.speed = speed;
        return this;
    },
    stop(){
        this.speed = 0;
        return this;
    },
    targetZoom_scaleBy(scale){
        this.targetZoom = this.targetZoom.scale(scale);
        return this;
    },
    vectorsCloseEnough(vec1, vec2){
        return vec1.minus(vec2).mag() < this.threshold
    },
    zoomToFitFrame(frame, margin = 1){
        const bb = frame.content.getBoundingClientRect();
        const svgbb = svg.getBoundingClientRect();
        const aspect = svgbb.width / svgbb.height;
        const scale = bb.height * aspect > bb.width ? svgbb.height / (margin * bb.height) : svgbb.width / (margin * bb.width);
        const gz = (1 / scale) ** (-1 / settings.zoomContentExp);
        return this.zoomToFrameByGz(frame, gz);
    },
    zoomToFrame(frame, s = 1){
        const gz = Graph.zoom.mag2() * ((frame.scale * s) ** (-1 / settings.zoomContentExp));
        return this.zoomToFrameByGz(frame, gz);
    },
    zoomToFrameByGz(frame, gz){
        this.panToI = new vec2(0, 0);
        this.referenceFrame = frame;
        this.targetPan = new vec2(0, 0); //frame.pos;
        this.targetZoom = Graph.zoom.unscale(gz ** 0.5);
        return this;
    }
}

var gen = iter();

function frame() {
    gen.next();
    Promise.delay(100).then(frame);
}

const panInput = Elem.byId('pan');
const zoomInput = Elem.byId('zoom');

const coords = Elem.byId('coordinates');

On.input(panInput, (e)=>{
    App.interface.coordsLive = false;
    const r = /([+-]?(([0-9]*\.[0-9]*)|([0-9]+))([eE][+-]?[0-9]+)?)\s*,?\s*([+-]?i?(([0-9]*\.[0-9]*)|([0-9]+))([eE][+-]?[0-9]+)?)/;
    const m = panInput.value.match(r);
    if (m === null) return;

    Graph.pan_set(new vec2(parseFloat(m[0]), parseFloat(m[6].replace(/[iI]/, ''))));
});
On.input(zoomInput, (e)=>{
    App.interface.coordsLive = false;
    const r = /([+-]?(([0-9]*\.[0-9]*)|([0-9]+))([eE][+-]?[0-9]+)?)/;
    const m = zoomInput.value.match(r);
    if (m === null) return;

    const z = parseFloat(m);
    if (z !== 0) Graph.zoom_scaleBy(z / Graph.zoom.mag());
});
['paste', 'mousemove', 'mousedown', 'dblclick', 'click'].forEach( (eName)=>{
    On[eName](panInput, Event.stopPropagation);
    On[eName](zoomInput, Event.stopPropagation);
});

function performZoom(amount, dest) {
    const inverseAmount = 1 / amount;
    Graph.zoom_scaleBy(inverseAmount)
        .pan_set(dest.scale(1 - inverseAmount).plus(Graph.pan.scale(inverseAmount)));
}

// Constants
const DRAG_THRESHOLD = 1; // pixels

class Interface {
    // A click is a press and a release this close together (px); farther is a drag.
    static clickSlop = 4;
    altHeld = false;
    controlDragOccurred = false;
    coordsLive = true;
    isMousePanning = false;
    isMouseZooming = false;
    isRotating = false;
    mousePanButton = settings.panClick;
    mouseZoomButton = settings.zoomClick;
    mouseZoomStartY = 0;
    nodeMode = new NodeMode(this.autoToggleAllOverlays.bind(this));
    overlays = [];
    rotateStartPos = new vec2(0, 0);
    rotatePrevPos = new vec2(0, 0);
    init(){
        On.keydown(document, this.onAltKeyDown);
        On.keyup(document, this.onAltKeyUp);
        On.message(window, this.onMessage);

        On.mousemove(svg, this.onMouseMove);
        On.mousedown(svg, this.onMouseDown);
        On.mouseup(window, this.onMouseUp);
        On.contextmenu(document, this.onContextMenu);
        On.wheel(svg, this.onWheel);
    }

    autoToggleAllOverlays(){
        const condition = (this.altHeld || this.nodeMode.val === 1);
        for (const overlay of this.overlays) {
            overlay.style.display = (condition ? 'block' : 'none');
        }
    }
    onAltKeyDown = (e)=>{
        if (e.altKey) {
            this.altHeld = true;
            this.autoToggleAllOverlays();
            e.preventDefault(); // e.g. focusing on the iframe
        }
    }
    onAltKeyUp = (e)=>{
        if (!e.altKey) {
            this.altHeld = false;
            this.autoToggleAllOverlays();
        }
    }
    // A message that says nothing about the mode leaves it alone. `data.nodeMode ?? 0`
    // turned the mode off on every message the window got -- from any page embedded in
    // a Link Node -- while the tool stayed lit (#50).
    onMessage = (e)=>{
        const data = e.data;
        if (data?.altHeld !== undefined) {
            this.altHeld = data.altHeld;
            this.autoToggleAllOverlays();
        }
        if (data?.nodeMode !== undefined) this.nodeMode.switch(data.nodeMode ? 1 : 0);
    }

    onMouseMove = (e)=>{
        if (isDraggingDragBox) return;

        Graph.mousePos_setXY(e.pageX, e.pageY);

        if (this.isRotating) {
            const currentPos = new vec2(e.pageX, e.pageY);
            const deltaPos = currentPos.minus(this.rotatePrevPos);

            const angleDelta = (deltaPos.x - deltaPos.y) * settings.dragRotateSpeed;
            // Adjust zoom and pan to reflect rotation around the pivot point
            const zc = Graph.vecToZ(this.rotateStartPos).minus(Graph.pan);
            const deltaRotation = Graph.applyRotationDelta(angleDelta);
            Graph.zoom_cmultWith(deltaRotation)
                 .pan_incBy(zc.cmult(new vec2(1, 0).minus(deltaRotation)));

            this.rotatePrevPos = currentPos;

            if (deltaPos.mag() > DRAG_THRESHOLD) this.controlDragOccurred = true;

            e.preventDefault();
        } else if (this.isMouseZooming) {
            const dragDistance = e.clientY - this.mouseZoomStartY;
            const amount = Math.exp(-dragDistance * settings.dragZoomSpeed * settings.zoomSpeedMultiplier);
            const dest = Graph.vecToZ();
            performZoom(amount, dest);
            this.mouseZoomStartY = e.clientY;
            regenAmount += Math.abs(dragDistance);

            if (Math.abs(dragDistance) > DRAG_THRESHOLD) this.controlDragOccurred = true;

            e.preventDefault();
        } else if (this.isMousePanning) {
            Autopilot.stop();
            this.coordsLive = true;
            const delta = Graph.mousePos.minus(Graph.mouseDownPos);
            Graph.pan_decBy(toDZ(delta));
            regenAmount += delta.mag() * 0.25;
            Graph.mouseDownPos_setXY();

            if (delta.mag() > DRAG_THRESHOLD) this.controlDragOccurred = true;
        }
    }

    onMouseDown = (e)=>{
        Graph.mouseDownPos_setXY(e.pageX, e.pageY);
        this.controlDragOccurred = false;

        Node.prev = null;

        document.activeElement.blur();

        // Handle zooming and rotating
        if (
            settings.zoomClick !== "scroll" &&
            e.button === this.mouseZoomButton &&
            e.getModifierState(settings.rotateModifier)
        ) {
            this.isRotating = true;
            this.rotateStartPos = new vec2(e.pageX, e.pageY);
            this.rotatePrevPos = this.rotateStartPos;
            e.preventDefault();
        } else if (e.button === this.mouseZoomButton) {
            this.isMouseZooming = true;
            this.mouseZoomStartY = e.clientY;
            e.preventDefault();
        }

        // Handle panning
        if (e.button === this.mousePanButton) {
            Autopilot.stop();
            Graph.mouseDownPos_setXY();
            this.isMousePanning = true;
            // Where a press on bare Plane began. Not a press on an Edge, which is inside the
            // same svg: a click there left the Edge alone and cleared the selection.
            this.panFrom = e.target.closest?.('[data-view-type="edgeViews"]') ? null
                         : {x: e.clientX, y: e.clientY};
            e.preventDefault();
        }

        // Handle context menu button press
        if (e.button === parseInt(settings.contextKey)) {
            this.controlDragOccurred = false;

            if (controls.contextMenuButton.value === 2) { // Assuming 2 is right-click
                e.preventDefault(); // suppress browser context menu
            }
        }
    }

    onMouseUp = (e)=>{
        if (e.button === this.mouseZoomButton) {
            if (this.isMouseZooming || this.isRotating) {
                this.isMouseZooming = false;
                this.isRotating = false;
                e.preventDefault();
            }
        }
        if (e.button === this.mousePanButton && this.isMousePanning) {
            this.isMousePanning = false;
            // A press and a release in one place on bare canvas -- a click, not a pan --
            // clears the selection, as the Help panel said it did. `Mod` and a drag is the
            // box, which clears its own.
            const from = this.panFrom;
            const still = from && Math.hypot(e.clientX - from.x, e.clientY - from.y) <= Interface.clickSlop;
            if (still && !Mod.isHeld(e)) App.selectedNodes.clear();
        }

        // Handle context menu opening
        if (e.button === parseInt(settings.contextKey)) {
            if (!this.controlDragOccurred) App.menuContext.open(e.pageX, e.pageY, e.target);
            // Do not reset 'controlDragOccurred' here; let 'contextmenu' handler manage it
            e.preventDefault();
        }

        if (Graph.movingNode !== undefined) Graph.movingNode.stopFollowingMouse(e);
        Mouse.isDragging = false;
    }

    onContextMenu = (e)=>{
        // Function to check if the default context menu should be used
        function shouldUseDefaultContextMenu(target) {
            return target.closest('.dropdown, .CodeMirror, #customContextMenu, #suggestions-container, .modal-content, .tooltip') ||
                target.tagName === 'IFRAME' ||
                target.tagName === 'IMG' ||
                target.tagName === 'VIDEO';
        }

        if (this.controlDragOccurred) { // prevent both native and custom context menus
            e.preventDefault();
            this.controlDragOccurred = false;
            return;
        }

        // Allow browser context menu if not dragging

        if (controls.contextMenuButton.value !== 2) { // not right-click
            return; // allow browser context menu
        }

        // If the default context menu should be used, do nothing
        if (e.ctrlKey || shouldUseDefaultContextMenu(e.target)) {
            App.menuContext.hide();
            return; // allow browser context menu
        }

        e.preventDefault(); // // suppress browser context menu
    }

    onWheel = (e)=>{
        // Only perform rotation via Alt + scroll wheel when zoomClick is "scroll"
        if (settings.zoomClick === "scroll" && !this.nodeMode.isOnFor(e) && e.getModifierState(settings.rotateModifier)) {
            Autopilot.stop();
            this.coordsLive = true;

            const angle = e.deltaY * settings.rotateModifierSpeed;
            const zc = Graph.vecToZ().minus(Graph.pan);
            const deltaRotation = Graph.applyRotationDelta(angle);

            Graph.zoom_cmultWith(deltaRotation)
                 .pan_incBy(zc.cmult(new vec2(1, 0).minus(deltaRotation)));
            e.stopPropagation();
            return;
        }

        if (settings.zoomClick === "scroll") {
            // Zooming via scroll wheel
            Autopilot.stop();
            Coordinate.deselect();
            App.menuContext.hide();
            this.coordsLive = true;
            const dest = Graph.vecToZ();
            regenAmount += Math.abs(e.deltaY);
            // `performZoom` inverts its argument, so amount > 1 zooms in. deltaY is
            // negative when the wheel is scrolled up, so the exponent has to be
            // negated for up to mean in. The drag-zoom path above already does this.
            const amount = Math.exp(-e.deltaY * settings.zoomSpeed * settings.zoomSpeedMultiplier);
            performZoom(amount, dest);
            e.stopPropagation();
        } else if (settings.panClick === "scroll") {
            // Panning via scroll wheel
            Autopilot.stop();
            this.coordsLive = true;
            let dest = Graph.vecToZ();
            const dp = toDZ(new vec2(e.deltaX, e.deltaY).scale(settings.panSpeed));
            regenAmount += Math.hypot(e.deltaX, e.deltaY);
            Graph.pan_incBy(dp);
            e.stopPropagation();
        }
    }
}



// Touch on the map (#55), through Pointer Events: one finger pans it, two pinch it. The map is
// the Fractal and the cards on it. Taken from the Fractal alone, a pinch with a finger on a card
// slid the map instead -- zoomed in to read, 62-85% of pinches had one there -- and a finger on a
// card could not pan it at all (rv15). So a finger anywhere on the map counts, except on a card's
// handles while it is the only one down: the header and the circle move the card, and the grip
// resizes it. A second finger makes a pinch of every finger on the map, provided the one on the
// header has not yet gone past `Node.dragThreshold` and so begun to move the card. A card whose
// text has more than fits scrolls it under one finger, as it does under the wheel.
//
// Every finger that moves the map is captured to the Fractal. Left to the browser, a pointer is
// captured to whatever it landed on -- often one of the Fractal's lines, which the renderer takes
// away as it redraws -- and a capture lost with its element sent the finger's lift somewhere
// else. The finger stayed down here, so the next one-finger drag was read as a pinch with a
// finger that had gone, and flung the view (rv14). The touch events that carried the pan before
// had the same hole: a touch whose target is removed ends where nothing hears it.
//
// A point of the screen in the Plane's units before the zoom and pan: `xyToZ` without them.
function screenUnits(x, y){ return Graph.xyToZ(x, y).minus(Graph.pan).cdiv(Graph.zoom) }
// The zoom and pan that keep the points of the Plane under `a0` and `b0` (at `zoom0`, `pan0`)
// under `a1` and `b1`: the zoom is the ratio of the spans, turn and all, and the pan keeps the
// midpoint's point where it was. Null for two fingers on one spot.
function pinchView(zoom0, pan0, a0, b0, a1, b1){
    const span1 = a1.minus(b1);
    if (!(span1.mag() > 0) || !(a0.minus(b0).mag() > 0)) return null;

    const zoom = zoom0.cmult(a0.minus(b0)).cdiv(span1);
    const m0 = a0.plus(b0).scale(0.5), m1 = a1.plus(b1).scale(0.5);
    const pan = m0.cmult(zoom0).plus(pan0).minus(m1.cmult(zoom));
    return {zoom, pan};
}
// `a1` and `b1` turned about their midpoint by `angle`: a pinch whose turn is taken out.
function turnedAboutMidpoint(a1, b1, angle){
    const m = a1.plus(b1).scale(0.5), unit = new vec2(Math.cos(angle), Math.sin(angle));
    return [m.plus(a1.minus(m).cmult(unit)), m.plus(b1.minus(m).cmult(unit))];
}
const TouchOnPlane = {
    // The map's fingers, in the order they came down: where each is and came down, in screen
    // pixels, and whether it has begun to move anything.
    points: new Map(),
    // Fingers on a card's header or circle: the card's, unless a second finger makes a pinch.
    pending: new Map(),
    pinch: null,
    // The fling a card's text is scrolling by, if any, and that text.
    flung: null,
    flinging: null,
    // A pinch turns the view only once the fingers have turned this far (radians, about 11
    // degrees): no two fingers spread without turning a little, and a map that turned with
    // every zoom ended up at an angle nobody chose.
    turnAfter: 0.2,

    // Measured again whenever a finger comes or goes, so two fingers are always taken from
    // where both of them are now, and the view never jumps.
    restartPinch(turning = false){
        const points = [...this.points.values()];
        this.pinch = (points.length !== 2) ? null : {
            a: screenUnits(points[0].x, points[0].y),
            b: screenUnits(points[1].x, points[1].y),
            zoom: Graph.zoom, pan: Graph.pan, turning
        };
    },
    // What a finger landing on `el` is for, or null off the map. A card's controls with a drag
    // of their own -- a slider, a field -- keep a finger that is alone on them, as its header and
    // its grip do. A video's own controls take its fingers before the page sees them, as a page
    // embedded in a card does.
    placeOf(el){
        if (!el?.closest) return null;
        if (el.closest('#svg_bg')) return 'fractal';
        if (!el.closest('#nodes')) return null;
        if (el.closest('.resize-handle')) return 'grip';
        if (el.closest('.header-container, .collapsed-circle')) return 'handle';
        return el.closest('input, select, video, audio') ? 'control' : 'body';
    },
    // A finger or a pen; a mouse has handlers of its own. The touch events this replaced were
    // sent for an Apple Pencil too.
    onDown(e){
        if (e.pointerType === 'mouse') return;
        // A finger that lands on text still scrolling from a fling stops it, and is no tap: the
        // caret it put in the note opened an iPad's keyboard (rv16). Only on that text: a tap
        // anywhere else while it ran was eaten as well (rv17).
        const stops = Boolean(this.flung) && Boolean(this.flinging?.contains(e.target));
        if (stops) this.flung = null;
        // The first finger of a gesture: one still held here is a finger whose lift never
        // arrived, and read with it the next drag was a pinch that flung the view (rv14).
        if (e.isPrimary) this.forget(e.pointerType);

        const place = this.placeOf(e.target);
        const joins = (this.points.size + this.pending.size > 0);
        if (!place || (place === 'grip' && !joins)) return;

        const at = {x: e.clientX, y: e.clientY, t: e.timeStamp, type: e.pointerType};
        const finger = {...at, from: at, el: e.target, moving: (place === 'fractal'), stops};
        // A control's finger joins a pinch as a header's does: on one, a pinch slid the map (rv16).
        if ((place === 'handle' || place === 'control') && !joins) return void this.pending.set(e.pointerId, finger);

        for (const [id, p] of this.pending) this.points.set(id, p);
        this.pending.clear();
        this.points.set(e.pointerId, finger);
        if (this.points.size > 1) {
            this.points.forEach( (p, id)=>{ p.moving = true; p.scroller = null; this.hold(id) } );
        } else if (place === 'fractal') {
            this.hold(e.pointerId);
        }
        this.restartPinch();
        if (place === 'fractal' || joins) Autopilot.stop();
    },
    onMove(e){
        const held = this.pending.get(e.pointerId);
        if (held) {
            Object.assign(held, {x: e.clientX, y: e.clientY, t: e.timeStamp});
            // Past the threshold a finger on a handle is moving its card, and stays out of a pinch.
            if (Math.hypot(held.x - held.from.x, held.y - held.from.y) > Node.dragThreshold) this.pending.delete(e.pointerId);
        }

        const was = this.points.get(e.pointerId);
        if (!was) return;

        const now = {...was, x: e.clientX, y: e.clientY, t: e.timeStamp};
        now.travelled ||= Math.hypot(now.x - now.from.x, now.y - now.from.y) > Node.dragThreshold;
        this.points.set(e.pointerId, now);
        let from = was;
        if (!now.moving) {
            // A finger on a card moves nothing short of the threshold: that is a tap, for the caret
            // or a button. Past it, it moves from where it came down, so the point it pressed stays
            // under it -- the text it is on, if that can scroll the way it goes, or else the map.
            if (!now.travelled) return;

            now.moving = true;
            const dx = now.x - now.from.x, dy = now.y - now.from.y;
            now.axis = (Math.abs(dx) > Math.abs(dy) ? 'x' : 'y');
            now.scroller = Node.scrollerFor(now.el, (now.axis === 'x' ? -dx : -dy), now.axis);
            if (now.scroller) {
                now.scale = this.drawnScaleOf(now.scroller, now.axis);
                now.at = now.scroller[now.axis === 'x' ? 'scrollLeft' : 'scrollTop'];
            }
            this.hold(e.pointerId);
            Autopilot.stop();
            from = now.from;
        }
        App.interface.coordsLive = true;
        if (this.points.size === 1) return (now.scroller ? this.scroll(now, from) : this.pan(from, now));
        if (this.pinch) this.pinchTo([...this.points.values()]);
    },
    // In the text's own pixels, which the card is drawn at a scale of: taken in the screen's,
    // the text ran ahead of the finger zoomed in -- three times as far at 4x -- and behind it
    // zoomed out (rv16). Down or across, whichever way the drag set out (`Node.scrollerFor`).
    //
    // Kept in a number of its own and written whole: WebKit drops the fraction of a `scrollTop`
    // it is given, so added a move at a time, a slow finger moved the text not at all (rv17).
    scroll(now, was){
        const across = (now.axis === 'x');
        const d = (across ? was.x - now.x : was.y - now.y) / now.scale;
        now.at = Math.min(Math.max(now.at + d, 0), this.reachOf(now.scroller, now.axis));
        now.scroller[across ? 'scrollLeft' : 'scrollTop'] = now.at;
        // Pixels a millisecond, smoothed, for the fling when it lets go.
        const v = d / Math.max(now.t - was.t, 1);
        now.v = (was.v === undefined ? v : 0.6 * v + 0.4 * was.v);
    },
    // How far a box can scroll, one axis.
    reachOf(el, axis){
        return Math.max(0, (axis === 'x') ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight);
    },
    // Screen pixels to the box's own, one axis: the card's transform scales one to the other.
    drawnScaleOf(el, axis){
        const box = el.getBoundingClientRect();
        return (axis === 'x' ? box.width / el.offsetWidth : box.height / el.offsetHeight) || 1;
    },
    // Let go while moving, the text goes on and slows to a stop, as a scroll of the browser's own
    // does. A finger coming down on it stops it. It stops by itself at the text's end, and once it
    // moves less than half a pixel of the screen a frame -- past that it ran on unseen, and a tap
    // a moment after the text stood still was taken for one that stopped it (rv17).
    fling(el, v, axis, scale){
        const offset = (axis === 'x' ? 'scrollLeft' : 'scrollTop'), reach = this.reachOf(el, axis);
        let last = performance.now(), at = el[offset];
        const step = (t)=>{
            if (this.flung !== step) return;

            at = Math.min(Math.max(at + v * (t - last), 0), reach);
            el[offset] = at;
            v *= Math.pow(0.95, (t - last) / 16);
            last = t;
            const going = (Math.abs(v) * 16 * scale >= 0.5) && at > 0 && at < reach;
            if (going) requestAnimationFrame(step);
            else this.flung = this.flinging = null;
        };
        this.flung = step;
        this.flinging = el;
        requestAnimationFrame(step);
    },
    pan(was, now){
        const delta = new vec2(was.x - now.x, was.y - now.y);
        regenAmount += delta.mag() * 0.25;
        Graph.pan_incBy(toDZ(delta));
    },
    pinchTo(points){
        const pinch = this.pinch;
        let [a, b] = points.map( (p)=>screenUnits(p.x, p.y) );
        // Two fingers that came down on one point have no span to scale from: it zeroed the
        // zoom for good (rv14). The pinch starts once they part.
        if (!(pinch.a.minus(pinch.b).mag() > 0)) return this.restartPinch(pinch.turning);
        if (!pinch.turning) {
            const turn = Math.atan2(...(({x, y})=>[y, x])(a.minus(b).cdiv(pinch.a.minus(pinch.b))));
            // Past the dead zone the pinch starts over from here, turning, so the view picks
            // the turn up from the fingers as they are rather than snapping by the zone's width.
            if (Math.abs(turn) >= this.turnAfter) return this.restartPinch(true);
            [a, b] = turnedAboutMidpoint(a, b, -turn);
        }
        const view = pinchView(pinch.zoom, pinch.pan, pinch.a, pinch.b, a, b);
        if (!view) return;

        // As much of the Fractal redrawn as the zoom changed this move, as the wheel does.
        regenAmount += Math.abs(Math.log(view.zoom.mag() / Graph.zoom.mag())) * settings.maxLines;
        Graph.zoom_set(view.zoom);
        Graph.pan_set(view.pan);
    },
    onEnd(e){
        this.pending.delete(e.pointerId);
        const was = this.points.get(e.pointerId);
        if (!was) return;

        this.points.delete(e.pointerId);
        // Past the threshold it was no tap, whatever the browser's own slop for one makes of the
        // lift: a short pan on a card put the caret in its text, and with the Note tool on, one
        // on the Fractal made a note.
        const lifted = (e.type === 'pointerup');
        if ((was.travelled || was.stops) && lifted) Node.swallowTheTap();
        if (lifted && was.scroller && e.timeStamp - was.t < 100 && Math.abs(was.v) > 0.2) this.fling(was.scroller, was.v, was.axis, was.scale);
        this.restartPinch();
    },
    forget(type){
        for (const map of [this.points, this.pending]) map.forEach( (p, id)=>{ if (p.type === type) map.delete(id) } );
    },
    // A pen that the browser sends on as a mouse as well -- Chromium does, while it moves; Safari
    // sends a Pencil's taps only, as a finger's -- is the mouse's. The mouse's own handlers pan
    // the Fractal and move a card, and this moved the map beside them.
    onCompatMouse(){
        this.points.forEach( (p, id)=>{ if (p.type === 'pen' && !p.travelled) this.points.delete(id) } );
        this.restartPinch();
    },
    hold(id){
        try { svg.setPointerCapture(id) } catch (err) { Logger.debug("No capture:", err) }
    }
};
// Taken as they come down, before a card's own handlers see them.
On.pointerdown(document, TouchOnPlane.onDown.bind(TouchOnPlane), true);
On.pointermove(document, TouchOnPlane.onMove.bind(TouchOnPlane), true);
On.pointerup(document, TouchOnPlane.onEnd.bind(TouchOnPlane), true);
On.pointercancel(document, TouchOnPlane.onEnd.bind(TouchOnPlane), true);
On.mousedown(document, TouchOnPlane.onCompatMouse.bind(TouchOnPlane), true);

// Every finger on the page, wherever it landed. Captured, so that no card's handler can hide one.
const FingersDown = new Set();
On.pointerdown(document, (e)=>{ if (e.pointerType === 'touch') FingersDown.add(e.pointerId) }, true);
On.pointerup(document, (e)=>{ FingersDown.delete(e.pointerId) }, true);
On.pointercancel(document, (e)=>{ FingersDown.delete(e.pointerId) }, true);

// Safari's own pinch events. An iPad sends them with its fingers -- on the Fractal, where the
// touches above own the pinch, or anywhere else -- so while a finger is down they only keep the
// page from zooming. A Mac's trackpad sends them with no finger down at all, and there they zoom
// the Fractal about the pointer, as the wheel does: keeping only the page from zooming left a
// pinch on a Mac doing nothing. The turn is not taken from a trackpad.
const TrackpadPinch = {
    start: null,
    onStart(e){
        e.preventDefault();
        this.start = (FingersDown.size ? null : {zoom: Graph.zoom, pan: Graph.pan, at: Graph.vecToZ()});
    },
    onChange(e){
        e.preventDefault();
        const start = this.start;
        if (!start || FingersDown.size || !(e.scale > 0)) return;

        // Fingers apart is closer, a smaller |zoom|; the point under the pointer stays put.
        const zoom = start.zoom.unscale(e.scale);
        regenAmount += Math.abs(Math.log(zoom.mag() / Graph.zoom.mag())) * settings.maxLines;
        Graph.zoom_set(zoom);
        Graph.pan_set(start.at.plus(start.pan.minus(start.at).unscale(e.scale)));
        App.interface.coordsLive = true;
    },
    onEnd(e){
        e.preventDefault();
        this.start = null;
    }
};
On.gesturestart(window, TrackpadPinch.onStart.bind(TrackpadPinch));
On.gesturechange(window, TrackpadPinch.onChange.bind(TrackpadPinch));
On.gestureend(window, TrackpadPinch.onEnd.bind(TrackpadPinch));
