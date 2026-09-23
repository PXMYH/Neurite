// Where you are on an endless canvas.
//
// Pan is unbounded and zoom runs for about thirteen decades, which is the point of
// the thing -- and until now there was nothing on screen that said so. No scale
// readout, no overview, no way back. An infinite canvas without orientation is not
// a feature, it is a way to lose your notes: measured, a note created off the edge
// of the viewport was simply gone as far as the reader could tell.
//
// So: what scale am I at, where is everything else, and take me back.

class Hud {
    // The panel lives inside `.dropdown`, which is the one container whose children
    // have `mousedown`, `wheel` and `dblclick` stop-propagated for them
    // (dropdown.js:296). A floating control anywhere else pans and zooms the canvas
    // when a reader tries to use it.
    static minimapW = 176;
    static minimapH = 116;

    // Redraw is throttled to its own interval rather than riding the simulation's
    // requestAnimationFrame: the frame loop already spends its budget on nodes,
    // edges and the fractal, and an overview that updates eight times a second
    // reads as live while costing a fraction of one that updates sixty.
    static intervalMs = 125;

    static init(){
        const root = document.querySelector('.dropdown');
        if (!root) return Logger.err('Hud: no .dropdown to mount in');

        const panel = Html.make.div('hud-panel');
        panel.innerHTML = `
            <canvas class="hud-map" width="${Hud.minimapW}" height="${Hud.minimapH}"
                    aria-label="Overview of every note, and the part of it you are looking at"></canvas>
            <div class="hud-row">
                <span class="hud-scale" title="Magnification, relative to the whole set">&times;1</span>
                <span class="hud-count">0 notes</span>
            </div>
            <div class="hud-row hud-actions">
                <button type="button" class="hud-btn" data-act="fit"
                        data-tooltip="Fit every note on screen (0)">Fit</button>
                <button type="button" class="hud-btn" data-act="home"
                        data-tooltip="Back to the start: pan 0, zoom 1 (Home)">Home</button>
            </div>`;
        root.appendChild(panel);

        this.panel = panel;
        this.canvas = panel.querySelector('.hud-map');
        this.ctx = this.canvas.getContext('2d');
        this.elemScale = panel.querySelector('.hud-scale');
        this.elemCount = panel.querySelector('.hud-count');

        On.click(panel.querySelector('[data-act="fit"]'), ()=>Hud.fitAll());
        On.click(panel.querySelector('[data-act="home"]'), ()=>Hud.home());
        this.bindMapDragging();
        this.bindKeys();
        this.buildEmptyHint(root);

        setInterval(Hud.update, Hud.intervalMs);
        Hud.update();
    }

    // What to do on an empty canvas.
    //
    // A first load is a black field with a fractal in it and no instruction anywhere:
    // the gesture that makes a note is a double-click, which leaves no trace until
    // someone tries it, and the three modified forms and the tool row are not
    // discoverable from looking. So the canvas says so, once, and stops saying it the
    // moment there is a note -- a hint that outstays its welcome is furniture.
    //
    // `pointer-events: none` throughout, because the thing it is telling you to do is
    // double-click the space it occupies.
    static buildEmptyHint(root){
        const hint = Html.make.div('canvas-hint');
        hint.innerHTML = `
            <p class="canvas-hint-lead">Double-click anywhere to write a note</p>
            <p class="canvas-hint-keys">
                <span><kbd>Shift</kbd> + drag a note onto another to link them</span>
                <span><kbd>0</kbd> fit &middot; <kbd>Home</kbd> reset &middot; scroll to zoom</span>
            </p>`;
        root.appendChild(hint);
        this.hint = hint;
    }

    // The plane rectangle every note occupies, including the space its card takes
    // up -- a bounding box of centre points alone would cut the outermost cards in
    // half in the overview and misreport what "fit" has to cover.
    static contentBounds(){
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let count = 0;
        for (const node of Object.values(Graph.nodes)) {
            if (node.removed) continue;
            const half = Graph.planeHalfExtent(node) || {hw: 0, hh: 0};
            minX = Math.min(minX, node.pos.x - half.hw);
            maxX = Math.max(maxX, node.pos.x + half.hw);
            minY = Math.min(minY, node.pos.y - half.hh);
            maxY = Math.max(maxY, node.pos.y + half.hh);
            count += 1;
        }
        if (!count) return null;
        return {minX, minY, maxX, maxY, count};
    }

    // The plane rectangle currently on screen. |zoom| is the half-width of the view
    // in plane units, so the viewport spans pan +/- |zoom| on both axes.
    static viewBounds(){
        const r = Graph.zoom.mag();
        return {minX: Graph.pan.x - r, minY: Graph.pan.y - r,
                maxX: Graph.pan.x + r, maxY: Graph.pan.y + r};
    }

    // Everything the overview draws has to fit both the notes and the viewport,
    // otherwise panning away from the graph makes the viewport marker slide off the
    // edge of the minimap and the reader loses the one thing that was orienting
    // them.
    static mapFrame(){
        const content = Hud.contentBounds();
        const view = Hud.viewBounds();
        const box = content
            ? {minX: Math.min(content.minX, view.minX), minY: Math.min(content.minY, view.minY),
               maxX: Math.max(content.maxX, view.maxX), maxY: Math.max(content.maxY, view.maxY)}
            : {...view};

        // A square frame, so the overview does not stretch the graph's proportions.
        const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
        const half = Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2 * 1.12 || 1;
        return {cx, cy, half, count: content?.count ?? 0};
    }

    static update = ()=>{
        if (!Hud.ctx) return;
        const frame = Hud.mapFrame();
        Hud.drawMap(frame);

        // Magnification is the reciprocal of |zoom|, since |zoom| is the half-width
        // of the view: smaller view, bigger number.
        const mag = 1 / Math.max(Graph.zoom.mag(), Number.MIN_VALUE);
        Hud.elemScale.innerHTML = '&times;' + Hud.formatMag(mag);
        Hud.elemCount.textContent = frame.count === 1 ? '1 note' : frame.count + ' notes';

        if (Hud.hint) Hud.hint.classList.toggle('is-hidden', frame.count > 0);
    }

    // Thirteen decades of zoom will not fit in a fixed number of digits, so the
    // readout changes form rather than truncating: exact-ish while a reader is in
    // the range they can reason about, and an exponent once they are not.
    static formatMag(mag){
        if (mag < 0.01) return mag.toExponential(1);
        if (mag < 10) return mag.toFixed(mag < 1 ? 2 : 1);
        if (mag < 1e5) return Math.round(mag).toLocaleString();
        const exp = Math.floor(Math.log10(mag));
        return (mag / 10 ** exp).toFixed(1) + 'e' + exp;
    }

    static drawMap(frame){
        const {ctx, canvas} = Hud;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const scale = Math.min(w, h) / (frame.half * 2);
        const toMapX = (x)=> (x - frame.cx) * scale + w / 2;
        const toMapY = (y)=> (y - frame.cy) * scale + h / 2;

        // The viewport, drawn first so notes sit on top of it.
        const v = Hud.viewBounds();
        const vx = toMapX(v.minX), vy = toMapY(v.minY);
        const vw = (v.maxX - v.minX) * scale, vh = (v.maxY - v.minY) * scale;
        ctx.fillStyle = 'rgba(115, 150, 212, 0.16)';
        ctx.fillRect(vx, vy, vw, vh);
        ctx.strokeStyle = 'rgba(115, 150, 212, 0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(vw), Math.round(vh));

        // One mark per note. Cards are drawn as rectangles where they are big
        // enough to be a shape, and as a dot when they are not -- a graph zoomed
        // far out would otherwise be a row of sub-pixel slivers.
        for (const node of Object.values(Graph.nodes)) {
            if (node.removed) continue;
            const half = Graph.planeHalfExtent(node) || {hw: 0, hh: 0};
            const bw = half.hw * 2 * scale, bh = half.hh * 2 * scale;
            const selected = App.selectedNodes.hasNode(node);
            ctx.fillStyle = selected ? '#7396d4' : 'rgba(212, 148, 84, 0.9)';
            if (bw >= 3 && bh >= 3) {
                ctx.fillRect(toMapX(node.pos.x - half.hw), toMapY(node.pos.y - half.hh), bw, bh);
            } else {
                ctx.beginPath();
                ctx.arc(toMapX(node.pos.x), toMapY(node.pos.y), 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Click or drag anywhere on the overview to go there. Dragging rather than only
    // clicking because an overview you can scrub is how a reader finds a cluster
    // they cannot name.
    static bindMapDragging(){
        const canvas = Hud.canvas;
        let dragging = false;

        const goTo = (e)=>{
            const rect = canvas.getBoundingClientRect();
            const frame = Hud.mapFrame();
            const scale = Math.min(canvas.width, canvas.height) / (frame.half * 2);
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            Autopilot.stop();
            Graph.pan_set(new vec2(
                (x - canvas.width / 2) / scale + frame.cx,
                (y - canvas.height / 2) / scale + frame.cy));
        };

        On.mousedown(canvas, (e)=>{ dragging = true; goTo(e); e.preventDefault() });
        On.mousemove(canvas, (e)=>{ if (dragging) goTo(e) });
        On.mouseup(window, ()=>{ dragging = false });
        On.mouseleave(canvas, ()=>{ dragging = false });
    }

    // Put every note on screen.
    static fitAll(){
        const box = Hud.contentBounds();
        if (!box) return Hud.home();

        Autopilot.stop();
        Graph.pan_set(new vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2));

        // |zoom| is the half-width of the view, and the viewport is square in plane
        // terms, so the half-span of the larger axis is what has to fit. The 1.1
        // leaves a margin so the outermost cards are not flush with the edge.
        const half = Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2;
        Hud.setZoomMag(Math.max(half * 1.1, 1e-12));
    }

    static home(){
        Autopilot.stop();
        Graph.pan_set(new vec2(0, 0));
        Hud.setZoomMag(1);
    }

    // Rescale without touching rotation. `zoom` is one complex number carrying both,
    // so assigning a real value would silently straighten a rotated view.
    static setZoomMag(mag){
        const current = Graph.zoom.mag();
        if (!(current > 0) || !Number.isFinite(mag)) return;
        Graph.zoom_scaleBy(mag / current);
    }

    static zoomBy(factor){
        Autopilot.stop();
        Hud.setZoomMag(Graph.zoom.mag() / factor);
    }

    // Keys chosen from what is actually free: 1-4 are the creator tools, Shift is
    // node mode, Alt is the overlay reveal, the arrows and f/d move the selection,
    // and Ctrl with +/-/= is suppressed to block the browser's own zoom.
    //
    // Guarded on where the caret is, which the existing global handlers are not: f,
    // d and the arrows are read straight out of keyState every frame with no focus
    // check, so typing "f" in any field still scales the selected notes. Not
    // changing that here, but not repeating it either.
    static bindKeys(){
        On.keydown(window, (e)=>{
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (Hud.isTyping()) return;

            switch (e.key) {
                case '0':    Hud.fitAll(); break;
                case 'Home': Hud.home(); break;
                case '+': case '=': Hud.zoomBy(1.6); break;
                case '-': case '_': Hud.zoomBy(1 / 1.6); break;
                default: return;
            }
            e.preventDefault();
        });
    }

    static isTyping(){
        const el = document.activeElement;
        if (!el || el === document.body) return false;
        if (el.isContentEditable) return true;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
        // A CodeMirror pane focuses a hidden textarea, which the check above
        // catches, but the menu also swallows these keys for its own navigation.
        return !!el.closest?.('.dropdown-content, .modal-content, .CodeMirror');
    }
}
