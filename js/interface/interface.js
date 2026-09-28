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



//Touchpad controls (WIP)
let touches = new Map();
On.touchstart(svg, (e)=>{
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches.item(i);
        touches.set(touch.identifier, {
            prev: touch,
            now: touch
        });
    }
}, false);
On.touchcancel(svg, (e)=>{
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches.item(i);
        touches.delete(touch.identifier);
    }
}, false);
On.touchend(svg, (e)=>{
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches.item(i);
        touches.delete(touch.identifier);
    }
}, false);
On.touchmove(svg, (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches.item(i);
        touches.set(touch.identifier, {
            prev: touches.get(touch.identifier)?.now,
            now: touch
        });
    }

    switch (touches.size) {
        case 1: {
            Autopilot.stop();
            App.interface.coordsLive = true;
            const t = [...touches.values()][0];
            const prev = new vec2(t.prev.clientX, t.prev.clientY);
            const now = new vec2(t.now.clientX, t.now.clientY);
            Graph.pan_incBy(toDZ(prev.minus(now)));
            e.stopPropagation();
            break;
        }

        default:
            break;
    }
}, false);

// One pinch (#55), from the two touches on the Fractal as Pointer Events, and absolute from where
// they came down: the view that keeps both points of the Plane under both fingers, from the view
// the pinch started with. There were two, and both ran on an iPad. The touch path read its pivot
// in the wrong units, which flung it, and grew |zoom| as the fingers spread, which is zooming
// out; Safari's `gesturechange` pivoted on `pageX`/`pageY`, which WebKit leaves at 0.
//
// A point of the screen in the Plane's units before the zoom and pan: `xyToZ` without them.
function screenUnits(x, y){ return Graph.xyToZ(x, y).minus(Graph.pan).cdiv(Graph.zoom) }
// The zoom and pan that keep the points of the Plane under `a0` and `b0` (at `zoom0`, `pan0`)
// under `a1` and `b1`: the zoom is the ratio of the spans, turn and all, and the pan keeps the
// midpoint's point where it was. Null for two fingers on one spot.
function pinchView(zoom0, pan0, a0, b0, a1, b1){
    const span1 = a1.minus(b1);
    if (!(span1.mag() > 0)) return null;

    const zoom = zoom0.cmult(a0.minus(b0)).cdiv(span1);
    const m0 = a0.plus(b0).scale(0.5), m1 = a1.plus(b1).scale(0.5);
    const pan = m0.cmult(zoom0).plus(pan0).minus(m1.cmult(zoom));
    return {zoom, pan};
}
const pinch = {pointers: new Map(), start: null};
On.pointerdown(svg, (e)=>{
    if (e.pointerType !== 'touch') return;

    pinch.pointers.set(e.pointerId, screenUnits(e.clientX, e.clientY));
    if (pinch.pointers.size !== 2) return;

    const [a, b] = [...pinch.pointers.values()];
    pinch.start = {a, b, zoom: Graph.zoom, pan: Graph.pan};
    Autopilot.stop();
});
On.pointermove(svg, (e)=>{
    if (e.pointerType !== 'touch' || !pinch.pointers.has(e.pointerId)) return;

    pinch.pointers.set(e.pointerId, screenUnits(e.clientX, e.clientY));
    const start = pinch.start;
    if (!start || pinch.pointers.size !== 2) return;

    const [a, b] = [...pinch.pointers.values()];
    const view = pinchView(start.zoom, start.pan, start.a, start.b, a, b);
    if (!view) return;

    // As much of the Fractal redrawn as the zoom changed this move, as the wheel does.
    regenAmount += Math.abs(Math.log(view.zoom.mag() / Graph.zoom.mag())) * settings.maxLines;
    Graph.zoom_set(view.zoom);
    Graph.pan_set(view.pan);
    App.interface.coordsLive = true;
});
const pinchEnds = (e)=>{
    pinch.pointers.delete(e.pointerId);
    if (pinch.pointers.size < 2) pinch.start = null;
};
On.pointerup(svg, pinchEnds);
On.pointercancel(svg, pinchEnds);

// Safari's own pinch events are only kept from zooming the page.
On.gesturestart(window, Event.preventDefault);
On.gesturechange(window, Event.preventDefault);
On.gestureend(window, Event.preventDefault);
