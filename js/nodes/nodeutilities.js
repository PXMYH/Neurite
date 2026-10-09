class Graph {
    draggedNode = null;
    edges = {};
    edgeDirectionalities = {};
    edgeViews = {};
    funcPopulate = 'populateForBackground';
    htmlEdges = Elem.byId('edges');
    htmlNodes = Elem.byId('nodes');
    lastPos = {x: 0, y: 0};
    model = svg;
    mouseDownPos = new vec2(0, 0);
    mousePos = new vec2(0, 0);
    movingNode;
    #nextUuid = 0;
    nodes = {};
    nodeViews = {};
    own = {self: this};
    pan = new vec2(0, 0);
    rotation = new vec2(1, 0);
    zoom = new vec2(1, 0); // bigger is farther out

    // The default card box in CSS pixels, used only to estimate the footprint of a card
    // whose rendered box cannot be read. Measured on a text note at scale 1: 344 x 160.
    static nominalCardW = 344;
    static nominalCardH = 160;

    addEdge(edge){
        this.addEdgeView(edge.view);
        this.edges[edge.edgeKey] = edge;
    }
    addEdgeView(edgeView){
        this.edgeViews[edgeView.id] = edgeView;
        this.htmlEdges.append(edgeView.svgArrow, edgeView.svgBorder, edgeView.svgLink, edgeView.svgHalo);
    }
    addNode(node){
        let id = this.nodes.length;
        let div = node.content;
        /*div.setAttribute("onclick","(e)=>nodes["+id+"].onclick(e)");
        div.setAttribute("onmousedown","(e)=>nodes["+id+"].onmousedown(e)");
        div.setAttribute("onmouseup","(e)=>nodes["+id+"].onmouseup(e)");
        div.setAttribute("onmousemove","(e)=>nodes["+id+"].onmousemove(e)");*/
        if (node.view) this.nodeViews[node.view.id] = node.view;
        this.nodes[node.uuid] = node;
        this.lastPos = node.pos;
    }
    appendNode(node){ this.htmlNodes.append(node.content) }

    // A card's footprint in plane units. Measured from the rendered box rather
    // than from `node.scale`, because the width a card ends up with comes from its
    // content (`.editor-wrapper` is 284px, `.node-textarea` 259px) and not from
    // any single number the placement code could consult.
    // An instance method, not a static: the global `Graph` is an instance
    // (`Graph = new Graph()`, main.js:309), so a static here would be reachable
    // only through the shadowed class name.
    planeHalfExtent(node){
        // Two plane units span min(viewportW, viewportH) screen px at |zoom| = 1,
        // and `pos` is compared at whatever the live zoom is, so the conversion
        // has to carry it.
        const perPx = 2 * this.zoom.mag() / Svg.windowScale();

        const box = node.view?.div?.getBoundingClientRect();
        if (box && box.width) return {hw: box.width * perPx / 2, hh: box.height * perPx / 2};

        // An estimate rather than null, so nothing silently drops a card it cannot measure.
        //
        // This returned null for an unmeasurable card, and every caller skips a null:
        // `Hud.contentBounds` left it out of the bounding box Fit covers, and
        // `relaxOverlaps` left it out of the separation -- while the HUD's own count still
        // included it. So a card with a zero-width box was a note the reader was told they
        // had, that Fit would not bring into view and Tidy would not move. A review saw
        // exactly that: 3 of 12 cards at a 0x0 box, still in `Graph.nodes`, still
        // `display: flex`, after a session of repeated resizes. It could not be reproduced,
        // and a defence that costs four lines does not need a reproduction to be worth
        // having.
        //
        // The estimate mirrors what Node.draw would put on screen -- the same
        // intrinsicScale, scale and zoom terms (nodeclass.js:129) -- against the default
        // card box, so a card off by its own content's width is wrong by a little instead of
        // absent entirely.
        const drawScale = (node.intrinsicScale ?? 1) * (node.scale ?? 1)
                        * (this.zoom.mag2() ** -settings.zoomContentExp);
        if (!Number.isFinite(drawScale) || drawScale <= 0) return null;

        return {hw: Graph.nominalCardW * drawScale * perPx / 2,
                hh: Graph.nominalCardH * drawScale * perPx / 2};
    }

    // Push a freshly placed card off any card it landed on.
    //
    // Placement is a path walk (ZetPath, four styles, twelve sliders) whose step
    // length is independent of how big a card actually renders, so the two can
    // disagree -- measured, four notes created in a row sat 0.745 card-widths
    // apart, and the node physics does not separate them: the same overlap was
    // still there after seven seconds.
    //
    // This resolves it after the fact instead of adding a second opinion about
    // where a note belongs, so it holds for every placement style and stays true
    // if card sizes change again. Separation is along the axis of least
    // penetration, which is what keeps a row of notes a row instead of scattering
    // it. Bounded, so a dense graph cannot spin here.
    separateOnArrival(node, maxPasses = 24){
        const me = this.planeHalfExtent(node);
        if (!me) return;

        const margin = 0.08;  // a visible gutter, in fractions of a card
        const epsilon = 1e-6; // so a resolved pair is strictly clear, not touching

        for (let pass = 0; pass < maxPasses; pass++) {
            // The single deepest overlap, not every overlap in turn.
            //
            // Pushing clear of each neighbour in sequence ping-pongs: clearing A
            // moves the card into B, clearing B moves it back into A, and with an
            // even pass count it lands exactly where it started -- measured, two
            // notes came out of 24 passes at the same coordinates to four decimals
            // and read as "separation did nothing". Resolving one pair per pass and
            // re-measuring means every pass strictly reduces the worst overlap.
            let worst = null;
            for (const other of Object.values(this.nodes)) {
                if (other === node || other.removed) continue;
                const it = this.planeHalfExtent(other);
                if (!it) continue;

                const dx = node.pos.x - other.pos.x;
                const dy = node.pos.y - other.pos.y;
                const needX = (me.hw + it.hw) * (1 + margin);
                const needY = (me.hh + it.hh) * (1 + margin);
                const overX = needX - Math.abs(dx);
                const overY = needY - Math.abs(dy);
                if (overX <= 0 || overY <= 0) continue;  // clear on one axis already

                // Depth is the smaller of the two, because that is the distance
                // that actually has to be travelled to separate the pair.
                const depth = Math.min(overX, overY);
                if (!worst || depth > worst.depth) worst = {dx, dy, overX, overY, depth, needX};
            }
            if (!worst) return;

            const {dx, dy, overX, overY, needX} = worst;
            if (dx === 0 && dy === 0) {
                // Exactly coincident: no direction to push along, so pick one.
                node.pos = new vec2(node.pos.x + needX, node.pos.y);
            } else if (overX < overY) {
                node.pos = new vec2(node.pos.x + Math.sign(dx || 1) * (overX + epsilon), node.pos.y);
            } else {
                node.pos = new vec2(node.pos.x, node.pos.y + Math.sign(dy || 1) * (overY + epsilon));
            }
        }
    }

    // Relax overlaps across the whole graph, not just for one arriving card.
    //
    // separateOnArrival moves the new card and nothing else, which cannot resolve a
    // pile: three cards on one spot leave the newcomer no free direction, so it settles
    // on top of one of them. Measured with eleven notes -- several more than half
    // occluded, and because a card surface is 75% alpha, the text of the card behind
    // reads through the card in front. That is the app's default view once a reader has
    // a real graph in it, and it was its worst defect.
    //
    // `favour` names a card that should absorb most of each correction it is part of --
    // the arriving note -- and `bias` is how much. Every pair is still examined either
    // way: restricting the comparison to pairs involving the newcomer left the overlaps
    // the placement had already created between existing notes untouched, which measured
    // 0.75 of clear on a ten-note graph however many passes ran. A new note arriving is
    // the moment to fix the pile it is arriving into.
    // Every overlapping pair is resolved on each pass, and the pass repeats until one
    // finds nothing. This resolved only the single deepest pair per pass, with a cap of
    // 4000 passes, and the arithmetic did not survive a real graph: 100 notes arriving
    // at once never came clear inside the cap, every call cost ~285ms, and settling each
    // arrival made six of them -- the page froze for 89 seconds. Resolving the whole
    // sweep each pass is the ordinary way to relax contacts. It is not quick for a real
    // pile -- a review measured 1,428 passes to clear 100 notes piled on arrival, and
    // 6,105 for 200 -- but each pass is arithmetic over cached extents, so it is a
    // matter of time rather than of never.
    //
    // `favour` is a card, or a Set of cards, that absorbs `bias` of each correction it
    // is part of. `budgetMs` bounds what one call may take whatever the graph's size, so
    // no call freezes the page; `relaxInBackground` is what carries on when one call's
    // budget was not enough. Returns the passes run and whether the Graph came clear.
    relaxOverlaps({passes = 20000, bias = 0.5, favour = null, budgetMs = 40} = {}){
        const nodes = Object.values(this.nodes).filter( (n)=>!n.removed );
        if (nodes.length < 2) return {passes: 0, clear: true};

        const extents = new Map();
        for (const node of nodes) {
            const half = this.planeHalfExtent(node);
            if (half) extents.set(node, half);
        }
        const favoured = (favour instanceof Set) ? favour : new Set(favour ? [favour] : []);
        // A Region's cards are a laid-out block (#73), and hold still: a card that overlaps one
        // moves by the whole of the correction. One double-click on the Plane beside the
        // bundle's Regions moved 28 of their cards and pushed 8 out of their Regions.
        // Not a note arriving among them, which is the one that moves.
        const fixed = new Set(nodes.filter( (node)=>(ZetRegions.holds(node) && !favoured.has(node)) ));

        const margin = 0.06;
        const deadline = performance.now() + budgetMs;
        let moving = 0;
        for (let pass = 0; pass < passes; pass++) {
            let moved = false;
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    const ea = extents.get(a), eb = extents.get(b);
                    if (!ea || !eb) continue;

                    const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y;
                    const overX = (ea.hw + eb.hw) * (1 + margin) - Math.abs(dx);
                    const overY = (ea.hh + eb.hh) * (1 + margin) - Math.abs(dy);
                    if (overX <= 0 || overY <= 0) continue;

                    const aFixed = fixed.has(a), bFixed = fixed.has(b);
                    if (aFixed && bFixed) continue;

                    // The card that has to move most is the one the caller named, if any.
                    const aFav = favoured.has(a), bFav = favoured.has(b);
                    const aShare = aFixed ? 0 : bFixed ? 1
                        : (aFav === bFav) ? 0.5 : aFav ? bias : 1 - bias;
                    // Along the axis of least penetration, which is the shortest way out
                    // and what keeps a row of notes a row.
                    const along = (overX < overY) ? 'x' : 'y';
                    // A resolved pair ends strictly clear rather than touching. In units
                    // of the cards, not of the Plane: an absolute 1e-6 is 145 card-widths
                    // at zoom 1e-8, and flung the pair out of sight (measured, 2 of 5).
                    const clearance = 1e-6 * (along === 'x' ? ea.hw + eb.hw : ea.hh + eb.hh);
                    const push = (along === 'x' ? overX : overY) + clearance;
                    const sign = Math.sign((along === 'x' ? dx : dy) || 1);
                    this.#shiftAlong(a, along, sign * push * aShare);
                    this.#shiftAlong(b, along, -sign * push * (1 - aShare));
                    moved = true;
                }
            }
            if (!moved) return {passes: moving, clear: true};
            moving += 1;
            if (performance.now() > deadline) break;
        }
        return {passes: moving, clear: false};
    }
    #shiftAlong(node, along, amount){
        node.pos = (along === 'x')
            ? new vec2(node.pos.x + amount, node.pos.y)
            : new vec2(node.pos.x, node.pos.y + amount);
        // A pinned card's anchor goes with it, so the pin names where the card now is.
        if (node.anchorForce) node.anchor = node.pos;
    }

    // Keep relaxing, a frame's worth of work at a time, until the Graph is clear or
    // `totalMs` of work has gone in. One call is bounded so the page never freezes, and
    // this is what finishes the job when a bound was not enough: a 200-note burst left
    // 24-28 overlapping pairs after its settle passes, with nothing coming back for them.
    relaxInBackground(options = {}, {sliceMs = 12, totalMs = 3000} = {}){
        let passes = 0, spent = 0;
        return new Promise( (resolve)=>{
            const slice = ()=>{
                const started = performance.now();
                const result = this.relaxOverlaps({...options, budgetMs: sliceMs});
                passes += result.passes;
                spent += performance.now() - started;
                if (result.clear || spent >= totalMs) return resolve({passes, clear: result.clear});
                requestAnimationFrame(slice);
            };
            slice();
        });
    }

    // Whether these cards could all sit on screen at once without landing on each
    // other: their area, gutters included, against half the view's. Half, because a
    // separation packs nowhere near perfectly. A batch that fits is pulled into view
    // card by card; one that does not is moved into view as a block.
    fitInView(nodes){
        const perPx = 2 * this.zoom.mag() / Svg.windowScale();
        const viewArea = (window.innerWidth * perPx) * (window.innerHeight * perPx);
        let area = 0;
        for (const node of nodes) {
            const half = this.planeHalfExtent(node);
            if (half) area += (2 * half.hw * 1.06) * (2 * half.hh * 1.06);
        }
        return area <= viewArea / 2;
    }

    // Bring a set of cards to the middle of the view together, drawing their spread in
    // until it fits: their arrangement keeps its shape, only its place and size change,
    // and the separation that follows opens it back out as far as the cards need.
    // Moving the block was not enough on its own: a pasted batch of 20 arrived as a ring
    // 7,500px across, so centring it left every card at least partly off screen.
    gatherIntoView(nodes){
        const live = nodes.filter( (node)=>!node.removed );
        if (live.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of live) {
            minX = Math.min(minX, node.pos.x); maxX = Math.max(maxX, node.pos.x);
            minY = Math.min(minY, node.pos.y); maxY = Math.max(maxY, node.pos.y);
        }
        const centre = new vec2((minX + maxX) / 2, (minY + maxY) / 2);
        // The short side of the view spans 2|zoom| Plane units. 0.7 of it still fits
        // when the view is rotated by any angle (a square needs 1/sqrt 2).
        const room = 0.7 * 2 * this.zoom.mag();
        const spread = Math.max(maxX - minX, maxY - minY);
        const shrink = (spread > room) ? room / spread : 1;
        // The view's middle is `pan`: fromZtoUV(pan) is (0.5, 0.5).
        for (const node of live) {
            node.pos = this.pan.plus(node.pos.minus(centre).scale(shrink));
            if (node.anchorForce) node.anchor = node.pos;
        }
    }

    // Pull a card back on screen if it arrived, or got pushed, off the edge.
    //
    // A note you just made has to be a note you can see. Two things put one out of
    // sight: an Ai node's spawn point is a random draw over a range wider than the
    // viewport (`(random - 0.5) * 1.8` per axis, zettelkasten.js:630), and the
    // separation above can push a card past the edge while resolving an overlap --
    // measured at UV -0.3, which is off the left side.
    //
    // This used to be hidden rather than absent: an unanchored card drifted along
    // the fractal gradient, so one created off screen wandered into view on its
    // own within a second or two. Cards are pinned on arrival now, so the
    // placement has to be right rather than eventually right.
    //
    // Visible beats non-overlapping when the two disagree: an overlap is something
    // a reader can see and drag apart, and a card outside the viewport is not.
    keepInView(node, margin = 0.04){
        const half = this.planeHalfExtent(node);
        if (!half) return;

        // Work in UV, where the viewport is 0..1 on both axes regardless of zoom,
        // then convert the correction back through the same transform the renderer
        // uses rather than a second copy of the algebra.
        const uv = fromZtoUV(node.pos);
        const perUvX = 2 * this.zoom.mag();  // plane units per full UV span
        const halfUvX = half.hw / perUvX;
        const halfUvY = half.hh / perUvX;

        // The window in UV. 0..1 is the square the window's short side spans, centred as
        // `Node.draw` places it, and the long side reaches past it: clamped to the square, a
        // card in full view near the long side's ends was pulled up to 300 px toward the
        // middle -- a note put down there, by a click or a tap, did not stay where it was put
        // (rv16).
        const box = svg.getBoundingClientRect();
        const short = Math.min(box.width, box.height);
        const reach = (side)=> (short > 0 ? side / (2 * short) : 0.5);
        const clampIn = (v, h, reachOfSide)=>{
            const lo = 0.5 - reachOfSide + margin, hi = 0.5 + reachOfSide - margin;
            return Math.min(Math.max(v, lo + h), Math.max(hi - h, lo + h));
        };
        let targetU = clampIn(uv.x, halfUvX, reach(box.width));
        let targetV = clampIn(uv.y, halfUvY, reach(box.height));

        // And off the chrome. Held only to the window, a card arriving off screen came to rest in
        // its corner, under the menu button or half under the overview, where the square had kept
        // it clear by chance (rv17). Each island it overlaps it leaves the shorter way that keeps
        // it in the window.
        const toPx = (u, v)=> ({x: box.left + (u - 0.5) * short + box.width / 2, y: box.top + (v - 0.5) * short + box.height / 2});
        const hw = halfUvX * short, hh = halfUvY * short;
        for (const island of document.querySelectorAll('.tool-bar, .menu-button, .hud-panel')) {
            const b = island.getBoundingClientRect();
            if (!b.width || !b.height || island.classList.contains('is-under-menu')) continue;

            const c = toPx(targetU, targetV);
            if (c.x + hw <= b.left || c.x - hw >= b.right || c.y + hh <= b.top || c.y - hh >= b.bottom) continue;
            const moves = [
                {dx: b.left - (c.x + hw), dy: 0}, {dx: b.right - (c.x - hw), dy: 0},
                {dx: 0, dy: b.top - (c.y + hh)}, {dx: 0, dy: b.bottom - (c.y - hh)},
            ].filter( ({dx, dy})=> c.x - hw + dx >= box.left && c.x + hw + dx <= box.right
                                && c.y - hh + dy >= box.top && c.y + hh + dy <= box.bottom );
            if (!moves.length) continue;
            const {dx, dy} = moves.reduce( (best, m)=> (Math.hypot(m.dx, m.dy) < Math.hypot(best.dx, best.dy) ? m : best) );
            targetU += dx / short;
            targetV += dy / short;
        }
        if (targetU === uv.x && targetV === uv.y) return;

        // uv -> z is the inverse of fromZtoUV: ((uv - 0.5) * 2) * zoom + pan.
        const t = new vec2((targetU - 0.5) * 2, (targetV - 0.5) * 2);
        node.pos = t.cmult(this.zoom).cadd(this.pan);
        // A pinned card's anchor goes with it, so the pin names where the card now is.
        if (node.anchorForce) node.anchor = node.pos;
    }

    clear(){
        App.selectedNodes.clear();
        this.forEachEdge(this.deleteEdge, this);
        this.edgeDirectionalities = {};
        this.forEachNode(this.deleteNode, this);
    }
    deleteEdge(edge){
        this.edgeDirectionalities[edge.edgeKey] = edge.directionality;

        // Remove this edge from both connected nodes' edges arrays
        edge.pts.forEach(Node.removeThisEdge, edge);

        this.deleteEdgeView(edge.view);
        delete this.edges[edge.edgeKey];
    }
    deleteEdgeView(edgeView){
        edgeView.svgArrow.remove();
        edgeView.svgBorder.remove();
        edgeView.svgLink.remove();
        edgeView.svgHalo.remove();
        edgeView.gradient.remove();
        delete this.edgeViews[edgeView.id];
    }
    deleteNode(target){
        const dels = [];
        this.forEachNode( (node)=>{
            for (const edge of node.edges) {
                if (edge.pts.includes(target)) dels.push(edge);
            }
        });
        for (const edge of dels) edge.remove();

        // Remove target node from the edges array of any nodes it was connected to
        this.forEachNode(Node.filterEdgesToThis, target);

        const uuid = target.uuid;
        App.selectedNodes.uuids.delete(uuid);
        delete this.nodeViews[uuid];
        delete this.nodes[uuid];

        target.removed = true;
        target.content.remove();
    }

    filterNodes(cb, ct){
        const arr = [];
        const nodes = this.nodes;
        for (const uuid in nodes) {
            const node = nodes[uuid];
            if (cb.call(ct, node)) arr.push(node);
        }
        return arr;
    }
    findEdge(cb, ct){
        const edges = this.edges;
        for (const edgeKey in edges) {
            const edge = edges[edgeKey];
            if (cb.call(ct, edge)) return edge;
        }
    }
    forEachEdge(cb, ct){ Object.forEach(this.edges, cb, ct) }
    forEachEdgeView(cb, ct){ Object.forEach(this.edgeViews, cb, ct) }
    forEachNode(cb, ct){ Object.forEach(this.nodes, cb, ct) }
    forEachNodeView(cb, ct){ Object.forEach(this.nodeViews, cb, ct) }

    mouseDownPos_setXY(x, y){
        this.mouseDownPos.x = x ?? this.mousePos.x;
        this.mouseDownPos.y = y ?? this.mousePos.y;
    }
    mousePos_setXY(x, y){
        this.mousePos.x = x;
        this.mousePos.y = y;
    }

    // Once each in a session. The newest Node's uuid was handed out again once it was deleted,
    // and whatever was keyed by it -- a dismissed Proposed Edge -- passed to the next note (rv11).
    get nextUuid(){
        const nodes = this.nodes;
        while (nodes[this.#nextUuid]) {
            this.#nextUuid += 1;
        }
        return this.#nextUuid++;
    }

    pan_decBy(vec){
        this.pan = this.pan.minus(vec);
        return this;
    }
    pan_incBy(vec){
        this.pan = this.pan.plus(vec);
        return this;
    }
    pan_set(vecNew){
        this.pan = vecNew;
        return this;
    }

    setEdgeDirectionalityFromData(edgeData){
        this.edgeDirectionalities[edgeData.edgeKey] ||=
            Edge.directionalityFromData(edgeData.directionality)
    }
    updateRotationByAngle(angle){
//        const delta = new vec2(Math.cos(angle), Math.sin(angle));
//        this.rotation = this.rotation.cmult(delta);
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        const rotation = this.rotation;
        this.rotation = new vec2(
            rotation.x * x - rotation.y * y,
            rotation.y * x + rotation.x * y
        )
        return this;
    }
    applyRotationDelta(angle) {
        const delta = new vec2(Math.cos(angle), Math.sin(angle));

        // Renormalised, because the caller multiplies `zoom` by this and `zoom`
        // carries the zoom level in its magnitude. cos^2 + sin^2 is 1 only to
        // rounding, so every rotation frame nudged the magnitude by about an ulp --
        // meaning holding Alt and turning the canvas slowly changed how far in it
        // was zoomed, drifting in whichever direction the rounding went.
        const mag = delta.mag();
        const unit = (mag > 0) ? delta.unscale(mag) : new vec2(1, 0);

        this.rotation = this.rotation.cmult(unit);
        return unit;
    }
    vecToZ(c = this.mousePos){
//        Svg.updateScaleAndOffset();
//        return c.minus(Svg.offset).unscale(Svg.scale)
//            .minus(new vec2(.5, .5)).scale(2)
//            .cmult(this.zoom).cadd(this.pan);
        return this.xyToZ(c.x, c.y)
    }
    viewForElem(target){
        const viewType = target.dataset.viewType;
        if (viewType) return this[viewType][target.dataset.viewId];

        const elem = target.closest('[data-view-type]');
        if (elem) return this[elem.dataset.viewType][elem.dataset.viewId];
    }
    xyToZ(x, y){
        Svg.updateScaleAndOffset();
        return new vec2(
            ((x - Svg.offset.x) / Svg.scale - .5) * 2,
            ((y - Svg.offset.y) / Svg.scale - .5) * 2
        ).cmult(this.zoom).cadd(this.pan);
    }

    zoom_cmultWith(o){
        this.zoom = this.zoom.cmult(o);
        return this;
    }
    zoom_rotBy(angle){
        this.zoom = this.zoom.rot(angle);
        return this;
    }
    zoom_set(vecNew){
        this.zoom = vecNew;
        return this;
    }
    zoom_scaleBy(scale){
        this.zoom = this.zoom.scale(scale);
        return this;
    }
}
svg.dataset.viewType = 'own';
svg.dataset.viewId = 'self';



class SelectedNodes {
    uuids = new Set();

    forEach(cb, ct){
        this.uuids.forEach( (uuid)=>{
            const node = Node.byUuid(uuid);
            if (node) cb.call(ct, node);
        })
    }
    forEachView(cb, ct){
        this.uuids.forEach( (id)=>{
            const nodeView = NodeView.byId(id);
            if (nodeView) cb.call(ct, nodeView);
        })
    }
    hasNode(node){ return this.uuids.has(node.uuid) }
    reduce(cb, init){
        return this.uuids.values().reduce( (acc, uuid)=>{
            const node = Node.byUuid(uuid);
            return (node ? cb(acc, node) : acc);
        }, init)
    }

    toggleNode(node){
        node.view.toggleSelected();
        const isSelected = this.uuids.has(node.uuid);
        this.uuids[isSelected ? 'delete' : 'add'](node.uuid);
        Logger.debug(isSelected ? 'deselected' : 'selected');
    }
    static toggleNode(node){ App.selectedNodes.toggleNode(node) }

    restoreNodeById(id){
        const nodeView = NodeView.byId(id);
        if (!nodeView) return;

        nodeView.toggleSelected(true);
        this.uuids.add(id);
    }

    clear(){
        this.forEachView(NodeView.toggleSelectedToThis, false);
        this.uuids.clear();
    }

    getCentroid(){
        if (this.uuids.size === 0) return null;

        const cb = (sumPos, node)=>sumPos.plus(node.pos) ;
        return this.reduce(cb, new vec2(0, 0)).scale(1 / this.uuids.size);
    }

    getUniqueEdges(){
        return this.reduce( (set, node)=>{
            node.edges.forEach( (edge)=>{
                if (edge.pts.every(this.hasNode, this)) set.add(edge)
            });
            return set;
        }, new Set())
    }

    scale(scaleFactor, centralPoint){
        // Spacing scales with size, pinned Nodes and their pins too (f and d): they kept
        // their places while growing, so a group scaled up ran into itself.
        this.forEach(node => {
            node.scale *= scaleFactor;

            const directionToCentroid = node.pos.minus(centralPoint);
            node.pos = centralPoint.plus(directionToCentroid.scale(scaleFactor));
            if (node.anchorForce) node.anchor = node.pos;

            updateNodeEdgesLength(node);
        });

        // If needed, scale the user screen (global zoom)
        //Graph.zoom_scaleBy(scaleFactor)
        //    .pan_set(centralPoint.scale(1 - scaleFactor).plus(Graph.pan.scale(scaleFactor)));
    }
}



function updateNodeEdgesLength(node) {
    node.edges.forEach(edge => {
        const currentLength = edge.currentLength;
        if (currentLength) edge.length = currentLength;
    })
}

function edgeFromJSON(edgeData) {
    const nodes = Graph.nodes;
    const pts = edgeData.p.map((k) => nodes[k]);
    // An Edge to a Node that did not come back is dropped, not built. Building it threw
    // (`String.uuidOf(undefined)`) into the loader's per-Node guard, so the Node that
    // *did* come back skipped its other Edges and its `TextNode.init`. Measured: a save
    // of A -> B and A -> C with C's card cut out came back with A's and B's bodies
    // empty and no C at all -- one unreadable card cost the graph its text (#49).
    if (pts.includes(undefined)) return Logger.warn("Dropped an Edge to a missing Node:", edgeData.edgeKey);

    // Check if edge already exists
    const edgeKey = edgeData.edgeKey;
    if (Graph.findEdge( (edge)=>(edge.edgeKey === edgeKey) )) return;

    const edge = new Edge(pts, edgeData.l, edgeData.s, edgeData.g);
    pts.forEach(Node.addEdgeThis, edge);
    Graph.addEdge(edge);
    return edge;
}

Node.byTitle = function(title){
    const lCaseTitle = title.toLowerCase();
    const matchingNodes = Graph.filterNodes(
        (node)=>(node.getTitle()?.toLowerCase() === lCaseTitle)
    );

    Logger.debug(`Found ${matchingNodes.length} matching nodes for title ${title}.`);
    Logger.debug("Matching nodes:", matchingNodes);

    return (matchingNodes.length > 0 ? matchingNodes[0] : null);
}
Node.getTextareaContent = function(node){
    if (!node?.content) {
        Logger.warn("Node or node.content is not available");
        return null;
    }

    if (!node.isTextNode) {
        Logger.debug("Node is not a text node. Skipping getText.");
        return null;
    }

    const editableTextarea = node.contentEditableDiv;
    if (!editableTextarea) {
        Logger.warn("editableTextarea not found.");
        return null;
    }

    return editableTextarea.value;
}
function testNodeText(title) {
    Graph.forEachNode( (node)=>{
        const textarea = node.content.querySelector('textarea');
        Logger.info("From nodes array");
        if (textarea) {
            Logger.info("Node UUID:", node.uuid, "- Textarea value from DOM:", textarea.value)
        } else {
            Logger.info("Node UUID:", node.uuid, "- No textarea found in DOM")
        }
    });

    const node = Node.byTitle(title);
    if (!node) {
        Logger.warn("Node with title", title, "not found");
        return null;
    }

    const text = Node.getTextareaContent(node);
    Logger.info("Node with title:", title, "has text:", text);
    return text;
}
