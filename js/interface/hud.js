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
            <!-- Only while the view is turned, which a twist of a pinch does (#55), and pointing
                 the way the Plane's up is. Home puts the view upright as well, but back at the
                 start, and a reader straightening a tilt lost their place (rv15). Over the
                 overview, not beside Home: shown and hidden in that row, it moved Home from under
                 the finger reaching for it (rv16). -->
            <button type="button" class="hud-upright" data-act="upright" hidden
                    aria-label="Turn the view upright"
                    data-tooltip="Upright: turn the view back, and stay where you are">
                <svg aria-hidden="true"><use href="#upright-icon"></use></svg>
            </button>
            <div class="hud-row">
                <span class="hud-scale" title="Magnification, relative to the whole set">&times;1</span>
                <span class="hud-count">0 notes</span>
            </div>
            <!-- Where new notes go, once there is more than one place they could go (#64):
                 the Note tool writes into the Archive the Notes panel shows. A door to
                 that panel, so the answer and the way to change it are one click apart. -->
            <button type="button" class="hud-archive" hidden
                    data-tooltip="New notes are written into this Archive. Open the Notes panel to choose another.">
                <span class="hud-archive-text">
                    <span class="hud-archive-caption">New notes go to</span>
                    <span class="hud-archive-name"></span>
                </span>
                <svg class="hud-archive-chevron" aria-hidden="true"><use href="#caret-right-icon"></use></svg>
            </button>
            <div class="hud-row hud-actions">
                <button type="button" class="hud-btn" data-act="fit"
                        data-tooltip="Fit the selection on screen, or every note when nothing is selected (0)">Fit</button>
                <button type="button" class="hud-btn" data-act="tidy"
                        data-tooltip="Push overlapping notes apart, without rearranging the map (T)">Tidy</button>
                <button type="button" class="hud-btn" data-act="home"
                        data-tooltip="Back to the start: pan 0, zoom 1, upright (Home)">Home</button>
            </div>`;
        root.appendChild(panel);

        this.panel = panel;
        this.canvas = panel.querySelector('.hud-map');
        this.ctx = this.canvas.getContext('2d');
        this.elemScale = panel.querySelector('.hud-scale');
        this.elemCount = panel.querySelector('.hud-count');
        this.elemArchive = panel.querySelector('.hud-archive');
        this.elemArchiveName = panel.querySelector('.hud-archive-name');
        On.click(this.elemArchive, Hud.openNotes);

        On.click(panel.querySelector('[data-act="fit"]'), ()=>Hud.fitAll());
        On.click(panel.querySelector('[data-act="tidy"]'), ()=>Hud.tidy());
        On.click(panel.querySelector('[data-act="home"]'), ()=>Hud.home());
        this.elemUpright = panel.querySelector('[data-act="upright"]');
        On.click(this.elemUpright, ()=>Hud.upright());
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
        // Said to the hand it is read with (rv15): an iPad has no double-click, no keys and no
        // wheel to offer, and a first screen that asked for all three told it nothing.
        hint.innerHTML = `
            <p class="canvas-hint-lead">
                <span class="for-pointer">Double-click anywhere to write a note</span>
                <span class="for-touch">Tap <svg class="inline-icon" aria-label="New note" role="img"><use xlink:href="#note-icon-symbol"></use></svg>, then where the note goes</span>
            </p>
            <!-- What the app actually does, checked against the handlers rather than
                 written from memory. This said "Shift + drag a note onto another to link
                 them", which is not a gesture Neurite has: a Shift + press on the first
                 note arms a link and a click on another finishes it (Node.onMouseDown,
                 Node.stopFollowingMouse) -- dragging one card onto another moves it and
                 makes no edge at all. An instruction on an empty canvas is the one piece of text a
                 reader has no way to check, so it has to be the true one.

                 Typing the link is the better thing to teach anyway: it is the same act
                 as writing the note, it survives being wrong, and it is what makes this a
                 Zettelkasten rather than a diagram. -->
            <p class="canvas-hint-keys">
                <span>Write <kbd>[[</kbd>another note's title<kbd>]]</kbd> in a note to link them</span>
                <span class="for-pointer"><kbd>0</kbd> fit &middot; <kbd>T</kbd> tidy &middot; <kbd>Home</kbd> reset &middot; scroll to zoom</span>
                <span class="for-touch">One finger moves the view, and two zoom it</span>
                <span class="for-touch">The rest is in Menu &rsaquo; Help</span>
            </p>`;
        root.appendChild(hint);
        this.hint = hint;
    }

    // The plane rectangle every note occupies, including the space its card takes
    // up -- a bounding box of centre points alone would cut the outermost cards in
    // half in the overview and misreport what "fit" has to cover.
    // Every Node, or those `only` keeps.
    static contentBounds(only){
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let count = 0;
        for (const node of Object.values(Graph.nodes)) {
            if (node.removed || (only && !only(node))) continue;
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
        // A selection says it is there. Nothing did, and the arrows, f and d, a group drag and
        // the menu's Delete all act on every Node in it.
        const selected = App.selectedNodes.uuids.size;
        Hud.elemCount.textContent = selected ? `${selected} of ${frame.count} selected`
                                  : (frame.count === 1 ? '1 note' : frame.count + ' notes');
        Hud.elemCount.title = selected ? 'Esc, or a click on bare canvas, clears the selection' : '';

        if (Hud.hint) Hud.hint.classList.toggle('is-hidden', frame.count > 0);
        // A turn of the view takes the Plane's up the other way on screen.
        const turn = Math.atan2(Graph.zoom.y, Graph.zoom.x), turned = Math.abs(turn) > 1e-3;
        if (Hud.elemUpright.hidden === turned) Hud.elemUpright.hidden = !turned;
        if (turned) Hud.elemUpright.style.setProperty('--turn', -turn + 'rad');
        Hud.updateArchive();
        Hud.updateUnderMenu();
    }
    // Under an open menu that reaches it, the overview and the empty canvas's hint are
    // hidden: the menu is drawn over both. At 1600 x 1000 the Fractal panel ended 29px short
    // of the overview's foot and left Fit, Tidy and Home showing under the panel as if they
    // were part of it, and the hint read "title ]] in a note to link them" beside a panel.
    static updateUnderMenu(){
        // Measured only while the menu is open: this runs eight times a second.
        const menu = dropdownContent.classList.contains('open') && dropdownContent.getBoundingClientRect();
        for (const elem of [Hud.panel, Hud.hint]) {
            if (!elem) continue;

            const box = menu && elem.getBoundingClientRect();
            elem.classList.toggle('is-under-menu', Boolean(menu) && menu.bottom > box.top
                && menu.top < box.bottom && menu.left < box.right && menu.right > box.left);
        }
    }

    static updateArchive(){
        const panes = window.zetPaneList ?? [];
        const active = App.zetPanes?.activePane();
        const name = (active ? App.zetPanes.getPaneName(active.paneId) : '');
        Hud.elemArchive.hidden = (panes.length < 2 || !name);
        if (Hud.elemArchiveName.textContent === name) return;

        Hud.elemArchiveName.textContent = name;
        // The whole name, where a long one is cut short on the line.
        Hud.elemArchive.setAttribute('aria-label', 'New notes go to ' + name + '. Open the Notes panel');
        Hud.elemArchive.dataset.tooltip = `New notes are written into “${name}”. Open the Notes panel to choose another.`;
    }
    // The menu opened, then the Notes panel in it, as its row does.
    static openNotes(){
        if (!dropdownContent.classList.contains('open')) menuButton.click();
        document.querySelector(".menu-row.tablink[onclick*=\"'tab1'\"]")?.click();
    }

    // Thirteen decades of zoom will not fit in a fixed number of digits, so the
    // readout changes form rather than truncating: exact-ish while a reader is in
    // the range they can reason about, and an exponent once they are not.
    static formatMag(mag){
        if (mag < 0.01) return mag.toExponential(1);
        // One decimal from here to five figures, with no change of form at 1. It used
        // to switch to two decimals below 1, so crossing the most-used zoom in the app
        // reflowed the readout -- x0.97, x1.00, x1.0, x2.1. tabular-nums fixes the width
        // of a digit, not how many of them there are.
        if (mag < 1e5) return mag.toFixed(1);
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

        // The viewport. Its tint goes down first so notes sit on top of it, and its
        // outline goes on last so the notes cannot bury the one mark that says where the
        // reader is -- at a zoom where the view is smaller than the cluster, drawing the
        // outline first meant cards painted straight over it.
        const v = Hud.viewBounds();
        const vx = toMapX(v.minX), vy = toMapY(v.minY);
        // Floored at 6px. Zoomed in far enough, the view is a fraction of a pixel of the
        // overview and `Math.round` took it to 0 -- measured at x14, the rectangle was
        // not drawn at all, so the deeper a reader went the less the overview told them.
        const vw = Math.max((v.maxX - v.minX) * scale, 6);
        const vh = Math.max((v.maxY - v.minY) * scale, 6);
        ctx.fillStyle = 'rgba(115, 150, 212, 0.16)';
        ctx.fillRect(vx, vy, vw, vh);

        // One mark per note. Cards are drawn as rectangles where they are big
        // enough to be a shape, and as a dot when they are not -- a graph zoomed
        // far out would otherwise be a row of sub-pixel slivers.
        for (const node of Object.values(Graph.nodes)) {
            if (node.removed) continue;
            const half = Graph.planeHalfExtent(node) || {hw: 0, hh: 0};
            const bw = half.hw * 2 * scale, bh = half.hh * 2 * scale;
            const selected = App.selectedNodes.hasNode(node);
            // Each in its Node's own colour, as its card is; a selected one white, which no Node is.
            ctx.fillStyle = selected ? '#ffffff' : Node.colourOf(node);
            if (bw >= 3 && bh >= 3) {
                ctx.fillRect(toMapX(node.pos.x - half.hw), toMapY(node.pos.y - half.hh), bw, bh);
            } else {
                ctx.beginPath();
                ctx.arc(toMapX(node.pos.x), toMapY(node.pos.y), 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Last, so it is never painted over.
        ctx.strokeStyle = 'rgba(160, 190, 240, 0.95)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(vw), Math.round(vh));
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
        // Not into the Upright arrow over its corner: a scrub crossing it stopped there (rv17).
        On.mouseleave(canvas, (e)=>{ if (!e.relatedTarget?.closest?.('.hud-upright')) dragging = false });

        // A finger or a pen scrubs it too: a touch sends no mousemove while it moves, and a
        // drag across the overview went nowhere (rv15). Held to it while down, so a scrub that
        // runs off its edge keeps going.
        let finger = null;
        On.pointerdown(canvas, (e)=>{
            if (e.pointerType === 'mouse') return;

            finger = e.pointerId;
            try { canvas.setPointerCapture(e.pointerId) } catch (err) { Logger.debug("No capture:", err) }
            goTo(e);
        });
        On.pointermove(canvas, (e)=>{ if (e.pointerId === finger) goTo(e) });
        On.pointerup(canvas, (e)=>{ if (e.pointerId === finger) finger = null });
        On.pointercancel(canvas, (e)=>{ if (e.pointerId === finger) finger = null });
    }

    // Put every note on screen.
    // The selection when there is one, which is zoom-to-selection without a key of its own
    // (#40); every note when there is not.
    static fitAll(){
        const selection = App.selectedNodes;
        return Hud.fit(selection.uuids.size ? selection.hasNode.bind(selection) : null);
    }
    // The Nodes `only` keeps on screen, or every Node.
    static fit(only){ return Hud.fitBox(Hud.contentBounds(only)) }
    // A rectangle of the Plane on screen, clear of the chrome.
    static fitBox(box){
        if (!box) return Hud.home();
        // The chrome as it is now, not as the last tick drew it: the import closes the menu and
        // fits in one task, and this panel, hidden under the menu until the next tick, was left
        // out of the room it takes -- the view came out 9% tighter than a Fit a moment later.
        if (Hud.panel) {
            Hud.updateArchive();
            Hud.updateUnderMenu();
        }

        Autopilot.stop();
        Graph.pan_set(new vec2((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2));

        // |zoom| is the half-width of the view, and the viewport is square in plane
        // terms, so the half-span of the larger axis is what has to fit.
        //
        // The margin is what the chrome takes, not a round number. Fit used to leave 10%
        // and still put cards under the tool island at the top and this panel at the
        // bottom left -- a card can be inside the viewport and behind something opaque,
        // which to a reader is the same as not fitting. So the fraction of the viewport
        // the chrome actually covers is measured and the view is opened up by it.
        const half = Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2;
        Hud.setZoomMag(Math.max(half * Hud.chromeMargin(), 1e-12));
        // Centred after the zoom, which its pixels are converted at. Before it, the offset
        // was taken at the zoom Fit started from: from far out onto one small card (a note
        // of a Region, #73) it moved the view 50 of its own widths off the card.
        Hud.centreOnUsableRect();
    }

    // The view moved just enough to show a card whole in the space the chrome leaves, the card
    // left where it is: a note made at a Region's edge ran past the window's, and was typed
    // into there out of sight (rv11). A card larger than the space keeps its top left in it.
    //
    // The card's box is worked out from where it is on the Plane now, not read off the page:
    // the page shows where it was last drawn, before the separation moved it and before the
    // pan this makes, so asked again in the same task it moved the view as far again.
    static reveal(node){
        const half = node && Graph.planeHalfExtent(node);
        if (!half) return;

        const perPx = 2 * Graph.zoom.mag() / Svg.windowScale();
        const c = Hud.toScreen(node.pos);
        return Hud.revealBox({left: c.x - half.hw / perPx, right: c.x + half.hw / perPx,
                              top: c.y - half.hh / perPx, bottom: c.y + half.hh / perPx});
    }
    // The caret of a card being typed into, kept above an on-screen keyboard (rv15, rv16): when
    // the keys come up, as it is typed, and when it moves to another card while they are up. It
    // was the typed field's box once, as the keys came up, and eight lines on the caret was under
    // them. Once a frame at most, and from where the card is on the Plane now, as `reveal` works:
    // taken from where it was last drawn, two moves before a frame moved the view twice as far.
    static #caretFrame = 0;
    static keepCaretInSight(){
        if (Hud.#caretFrame) return;

        Hud.#caretFrame = requestAnimationFrame( ()=>{
            Hud.#caretFrame = 0;
            const typing = document.activeElement;
            const node = Graph.nodes[typing?.closest?.('#nodes [data-view-id]')?.dataset.viewId];
            const half = node && Graph.planeHalfExtent(node);
            if (!half) return;

            const card = node.content.getBoundingClientRect(), caret = Hud.caretBoxOf(typing);
            const perPx = 2 * Graph.zoom.mag() / Svg.windowScale(), c = Hud.toScreen(node.pos);
            const left = c.x - half.hw / perPx - card.left, top = c.y - half.hh / perPx - card.top;
            Hud.revealBox({left: caret.left + left, right: caret.right + left,
                           top: caret.top + top, bottom: caret.bottom + top}, Hud.visibleRect());
        });
    }
    // Where a text field's caret is on the screen, a line tall and as wide as the caret: a hidden
    // copy of the text up to it, laid out as the field lays it out, gives its place, and the
    // field's drawn scale takes that to the screen. As wide as the field, a caret on the right of a
    // card wider than the window went off its edge (rv17). Any other element is its own box.
    static caretBoxOf(el){
        const box = el.getBoundingClientRect();
        if (el.tagName !== 'TEXTAREA' || typeof el.selectionEnd !== 'number') return box;

        const style = getComputedStyle(el), copy = Html.new.div(), mark = Html.new.span();
        for (const name of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
                            'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
                            'textTransform', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap']) copy.style[name] = style[name];
        // As wide as the field's text runs: its box less a scrollbar, which a copy without one
        // would have wrapped the lines past, putting the caret on the wrong one (rv17).
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        Object.assign(copy.style, {position: 'absolute', visibility: 'hidden', top: '0', left: '0',
                                   boxSizing: 'content-box', border: '0', width: (el.clientWidth - padX) + 'px'});
        copy.textContent = el.value.slice(0, el.selectionEnd);
        mark.textContent = '\u200b';
        copy.append(mark);
        document.body.append(copy);
        const top = mark.offsetTop - el.scrollTop, height = mark.offsetHeight;
        const left = mark.offsetLeft - el.scrollLeft;
        copy.remove();

        const scale = (box.height / el.offsetHeight) || 1;
        const lineTop = box.top + (el.clientTop + Math.min(Math.max(top, 0), el.clientHeight)) * scale;
        const caretLeft = box.left + (el.clientLeft + Math.min(Math.max(left, 0), el.clientWidth)) * scale;
        return {left: caretLeft, right: caretLeft + 2 * scale, top: lineTop, bottom: lineTop + height * scale};
    }
    // The view moved just enough to bring a box of the screen into `rect`.
    static revealBox(box, rect = Hud.usableRect()){
        if (!rect) return;

        const margin = 8;
        const shift = (lo, hi, from, to)=>((hi - lo > to - from - 2 * margin || lo < from + margin)
            ? (from + margin - lo) : (hi > to - margin ? (to - margin - hi) : 0));
        const dx = shift(box.left, box.right, rect.left, rect.right);
        const dy = shift(box.top, box.bottom, rect.top, rect.bottom);
        if (!dx && !dy) return false;

        // The Graph moves the way the card has to, so the pan goes the other -- turned as the
        // view is: taken as plain x and y, at 180 degrees the pan went the wrong way and threw
        // the card 1500 px off screen (rv12).
        const move = Graph.xyToZ(dx, dy).minus(Graph.xyToZ(0, 0));
        Graph.pan_set(Graph.pan.minus(move));
        return true;
    }
    // A point of the Plane on the page, as `Node.draw` places a card.
    static toScreen(z){
        const uv = fromZtoUV(z);
        const box = svg.getBoundingClientRect();
        const w = Math.min(box.width, box.height);
        const off = (box.width < box.height ? box.right : box.bottom);
        return {x: uv.x * w - (off - box.right) / 2, y: uv.y * w - (off - box.bottom) / 2};
    }

    // Offset the pan so the graph is centred in the space the chrome leaves, rather than in
    // the viewport.
    //
    // Opening the view up by the chrome's share is only half of fitting: the chrome is not
    // symmetric -- a tool island at the top centre, a menu button top left, an overview
    // bottom left -- so a graph centred in the viewport still sits partly under the top
    // island while empty space goes unused at the bottom. Called after the zoom is set,
    // because the conversion from screen pixels to plane units depends on it.
    static centreOnUsableRect(){
        const vw = window.innerWidth, vh = window.innerHeight;
        const rect = Hud.usableRect();
        if (!rect) return;

        // The usable rect's centre, in screen pixels, against the viewport's.
        const dxPx = (rect.left + rect.right) / 2 - vw / 2;
        const dyPx = (rect.top + rect.bottom) / 2 - vh / 2;
        if (!dxPx && !dyPx) return;

        // Screen pixels to plane units at the current zoom. The graph has to move the
        // opposite way from the space, so the pan moves with it.
        const perPx = 2 * Graph.zoom.mag() / Svg.windowScale();
        Graph.pan_set(new vec2(Graph.pan.x - dxPx * perPx, Graph.pan.y - dyPx * perPx));
    }

    // The part of the viewport no island is sitting on, in screen pixels.
    static usableRect(){
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!vw || !vh) return null;
        const {top, bottom, left, right} = Hud.chromeInsets();
        return {top, left, right: vw - right, bottom: vh - bottom};
    }
    // And less what an on-screen keyboard covers, which covers the window without resizing it.
    static visibleRect(){
        const rect = Hud.usableRect(), seen = window.visualViewport;
        if (!rect || !seen) return rect;
        return {...rect, top: Math.max(rect.top, seen.offsetTop), bottom: Math.min(rect.bottom, seen.offsetTop + seen.height)};
    }

    // How much bigger the view has to be for the chrome not to cover the edges of it.
    // Measured from the islands themselves rather than assumed, so moving one or adding
    // another keeps Fit honest.
    static chromeMargin(){
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!vw || !vh) return 1.1;

        const {top, bottom, left, right} = Hud.chromeInsets();
        const usableH = Math.max(vh - top - bottom, vh * 0.3);
        const usableW = Math.max(vw - left - right, vw * 0.3);

        // max, not min. Both axes have to be satisfied, so the binding one is whichever
        // needs the *most* room -- taking the minimum reserved enough for the easier axis
        // and left cards behind the chrome on the other. It passed before only because the
        // over-charging this replaced inflated both ratios past the point where the
        // difference showed.
        return Math.max(vh / usableH, vw / usableW) * 1.06;
    }

    // How many screen pixels each edge of the viewport is covered by chrome.
    static chromeInsets(){
        const vw = window.innerWidth, vh = window.innerHeight;
        let top = 0, bottom = 0, left = 0, right = 0;
        // A panel beside the Graph -- the menu's while it is open, a dialog docked at the right
        // (#72) -- costs its own side, and only while it leaves the Graph room beside it: an
        // Archive picked in the Notes panel was framed half under the panel it was picked from
        // (#73), and on a narrow window, where the menu is most of the width, charging it to the
        // top as well as the side left Fit a corner of the screen (rv9).
        for (const el of document.querySelectorAll('.dropdown-content.open, .modal.side-modal .modal-content')) {
            const b = el.getBoundingClientRect();
            if (!b.width || !b.height) continue;

            if (b.left + b.width / 2 < vw / 2) {
                if (vw - b.right >= 0.25 * vw) left = Math.max(left, b.right);
            } else if (b.left >= 0.25 * vw) {
                right = Math.max(right, vw - b.left);
            }
        }
        for (const el of document.querySelectorAll('.tool-bar, .menu-button, .hud-panel')) {
            const b = el.getBoundingClientRect();
            // Hidden under the open menu, it covers nothing the menu does not (`updateUnderMenu`).
            if (!b.width || !b.height || el.classList.contains('is-under-menu')) continue;

            // An island only costs an edge the space it actually spans. This used to add
            // every island to both a horizontal and a vertical band, so the 194x196 HUD in
            // the bottom-left corner was charged as a full-width bottom band AND a
            // full-height left band -- margin 1.7418, and at 1024x700 the graph was given
            // 36.5% of the width with 650px unused. A corner island blocks a corner.
            const spansWidth = b.width / vw;
            const spansHeight = b.height / vh;
            if (spansWidth >= 0.5) {
                if (b.top < vh / 2) top = Math.max(top, b.bottom);
                else bottom = Math.max(bottom, vh - b.top);
            }
            if (spansHeight >= 0.5) {
                if (b.left < vw / 2) left = Math.max(left, b.right);
                else right = Math.max(right, vw - b.left);
            }
            // Neither: a corner or edge island. Charge it to whichever edge it is nearer,
            // which is the one a card would actually be hidden behind.
            if (spansWidth < 0.5 && spansHeight < 0.5) {
                const fromTop = b.top, fromBottom = vh - b.bottom;
                const fromLeft = b.left, fromRight = vw - b.right;
                const nearest = Math.min(fromTop, fromBottom, fromLeft, fromRight);
                if (nearest === fromTop) top = Math.max(top, b.bottom);
                else if (nearest === fromBottom) bottom = Math.max(bottom, vh - b.top);
                else if (nearest === fromLeft) left = Math.max(left, b.right);
                else right = Math.max(right, vw - b.left);
            }
        }
        return {top, bottom, left, right};
    }

    // The view the app opens with: pan 0, zoom 1, and upright. A pinch can turn the view, and a
    // turned view is otherwise put right only by turning it back by hand.
    static home(){
        Autopilot.stop();
        Graph.pan_set(new vec2(0, 0));
        Graph.zoom_set(new vec2(1, 0));
    }
    // The same view, upright: turned about the middle of the screen, which is the pan. The
    // button goes with the turn, so a keyboard's focus goes on to Home rather than to the page.
    static upright(){
        Autopilot.stop();
        Graph.zoom_set(new vec2(Graph.zoom.mag(), 0));
        if (document.activeElement === Hud.elemUpright) Hud.panel.querySelector('[data-act="home"]').focus();
        Hud.update();
    }

    // Push overlapping notes apart, and nothing else.
    //
    // Deliberately not a layout: it does not re-arrange the map, choose a shape, or
    // move anything that was not on top of something. A reader's arrangement is theirs;
    // the only thing being corrected is cards sitting on each other, which is the one
    // state where a note cannot be read at all. Both halves of a pair move equally here
    // because no card is the newcomer.
    static tidy(){
        // Passes, not pairs -- each pass resolves every overlap it finds and then looks
        // again, so one pass can move many cards. The log once said "Tidy resolved 384
        // overlaps" for nine, which is a number a reader would have had to be wrong about
        // on purpose. Run a frame at a time until clear, so a big pile neither freezes
        // the page nor stops half-done while the log says "settled".
        return Graph.relaxInBackground({bias: 0.5}, {sliceMs: 16, totalMs: 5000})
            .then( ({passes, clear})=>{
                if (clear) Logger.info('Tidy settled the graph in', passes, 'passes');
                else Logger.warn('Tidy stopped after', passes, 'passes with overlaps left');
                return {passes, clear};
            });
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
    // Guarded on where the caret is, as the selection's keys are (movenodes.js).
    static bindKeys(){
        On.keydown(window, (e)=>{
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (Hud.isTyping()) return;

            switch (e.key) {
                case '0':    Hud.fitAll(); break;
                case 't': case 'T': Hud.tidy(); break;
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

// The page scrolls only while a card's text needs it. A caret typed past the window's edge
// scrolls it into sight, as ever -- held at the top, the text went on out of sight (rv12) -- and
// once the typing is done the page goes back, with the tool bar and the menu button it took off
// screen, which only Home had brought back (rv10, rv11).
//
// Back whenever the focus moves on, unless what it moved to is past the edge itself: asked only
// whether anything was typed into, a card in plain sight -- or a menu row -- kept the page
// scrolled for the card before it (rv13). And the pointer is kept in step: it is held in page
// coordinates, and a double-click after the page went back made its note a scroll's height
// below the pointer (rv13).
On.blur(document, ()=>{
    requestAnimationFrame( ()=>{
        const sx = window.scrollX, sy = window.scrollY;
        if (!sx && !sy) return;

        const at = document.activeElement;
        const box = (at && at !== document.body) ? at.getBoundingClientRect() : null;
        const needs = box && (box.bottom + sy > window.innerHeight || box.right + sx > window.innerWidth);
        if (needs) return;

        window.scrollTo(0, 0);
        Graph.mousePos_setXY(Graph.mousePos.x - sx, Graph.mousePos.y - sy);
    });
}, true);

// The height an on-screen keyboard leaves (#56). The keyboard covers the page rather than
// resizing it, so neither `vh` nor `dvh` moves, and a Pane as tall as the window kept its last
// lines -- and the caret typing them -- under the keys. `visualViewport` is the part on screen:
// the menu, the Pane and the dialogs are clamped to it (`--visible-height`), and the Pane's
// CodeMirror, which measures its box only when told to, is told, with the caret kept in sight.
// The caret of a card typed into is kept above the keys by moving the view (`keepCaretInSight`).
if (window.visualViewport) {
    // Only when a keyboard comes up is the caret brought back into sight: on every resize it
    // threw away where the Pane had been scrolled to (rv15). A keyboard shrinks the visible
    // height and leaves the window's alone; a window made smaller shrinks both.
    let visibleHeight = visualViewport.height, windowHeight = window.innerHeight, keysUp = false;
    const keepVisibleHeight = ()=>{
        const keyboardCameUp = visualViewport.height < visibleHeight && window.innerHeight === windowHeight;
        visibleHeight = visualViewport.height;
        windowHeight = window.innerHeight;
        // Up, when it covers more than the shortcut bar a hardware keyboard leaves on an iPad.
        keysUp = visibleHeight < windowHeight - 120;
        document.documentElement.style.setProperty('--visible-height', visibleHeight + 'px');
        // A keyboard that leaves little of the window -- an iPad's leaves some 470px in
        // landscape -- is short of room for the Archive controls above the Pane as well, and
        // under them the Pane was four to nine lines tall (rv15). They give way to it while it
        // is typed into (styles.css).
        document.documentElement.classList.toggle('short-of-room', visibleHeight < windowHeight - 120 && visibleHeight < 640);

        if (keyboardCameUp) Hud.keepCaretInSight();

        const cm = window.currentActiveZettelkastenMirror;
        if (!cm) return;
        cm.refresh();
        if (keyboardCameUp && cm.hasFocus()) cm.scrollIntoView(null, 24);
    };
    On.resize(visualViewport, keepVisibleHeight);
    keepVisibleHeight();
    const followCaret = (e)=>{ if (keysUp && e.target.closest?.('#nodes')) Hud.keepCaretInSight() };
    On.input(document, followCaret, true);
    On.focus(document, followCaret, true);
}

// Safari applies `:active` only under a listener for touches, and with its grey tap box gone a
// press on a control showed nothing at all (rv16). Passive, and it does nothing.
On.touchstart(document, ()=>{});
