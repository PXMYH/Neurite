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

    addEdge(edge){
        this.addEdgeView(edge.view);
        this.edges[edge.edgeKey] = edge;
    }
    addEdgeView(edgeView){
        this.edgeViews[edgeView.id] = edgeView;
        this.htmlEdges.append(edgeView.svgArrow, edgeView.svgBorder, edgeView.svgLink);
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
        const box = node.view?.div?.getBoundingClientRect();
        if (!box || !box.width) return null;

        // Two plane units span min(viewportW, viewportH) screen px at |zoom| = 1,
        // and `pos` is compared at whatever the live zoom is, so the conversion
        // has to carry it.
        const perPx = 2 * this.zoom.mag() / Svg.windowScale();
        return {hw: box.width * perPx / 2, hh: box.height * perPx / 2};
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
    // `passes` is high because each pass resolves exactly one pair -- the deepest -- and
    // separating one pair inside a cluster creates new overlaps, so a pile of ten needs
    // far more passes than it has pairs. Measured: 120 passes took a ten-card pile from
    // 0.01 to 0.68 of clear, and stopped short. It is cheap to raise: the card extents
    // are measured once up front, so a pass is arithmetic over cached numbers with no
    // layout read in it.
    relaxOverlaps({passes = 4000, bias = 0.5, favour = null} = {}){
        const nodes = Object.values(this.nodes).filter( (n)=>!n.removed );
        if (nodes.length < 2) return 0;

        const extents = new Map();
        for (const node of nodes) {
            const half = this.planeHalfExtent(node);
            if (half) extents.set(node, half);
        }

        const margin = 0.06, epsilon = 1e-6;
        let moves = 0;
        for (let pass = 0; pass < passes; pass++) {
            let worst = null;
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    const ea = extents.get(a), eb = extents.get(b);
                    if (!ea || !eb) continue;

                    const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y;
                    const overX = (ea.hw + eb.hw) * (1 + margin) - Math.abs(dx);
                    const overY = (ea.hh + eb.hh) * (1 + margin) - Math.abs(dy);
                    if (overX <= 0 || overY <= 0) continue;

                    const depth = Math.min(overX, overY);
                    if (!worst || depth > worst.depth) worst = {a, b, dx, dy, overX, overY, depth};
                }
            }
            if (!worst) return moves;

            const {a, b, dx, dy, overX, overY} = worst;
            // The card that has to move most is the one the caller named, if any.
            const aShare = (favour === a) ? bias : (favour === b) ? 1 - bias : 0.5;
            const along = (overX < overY) ? 'x' : 'y';
            const push = (along === 'x' ? overX : overY) + epsilon;
            const sign = Math.sign((along === 'x' ? dx : dy) || 1);

            const shift = (node, amount)=>{
                node.pos = (along === 'x')
                    ? new vec2(node.pos.x + amount, node.pos.y)
                    : new vec2(node.pos.x, node.pos.y + amount);
                // An anchored card is held to `anchor` by a spring every frame, so moving
                // `pos` without moving the anchor snaps it straight back.
                if (node.anchorForce) node.anchor = node.pos;
            };
            shift(a, sign * push * aShare);
            shift(b, -sign * push * (1 - aShare));
            moves += 1;
        }
        return moves;
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

        const lo = margin, hi = 1 - margin;
        const clamp = (v, h)=> Math.min(Math.max(v, lo + h), Math.max(hi - h, lo + h));
        const targetU = clamp(uv.x, halfUvX);
        const targetV = clamp(uv.y, halfUvY);
        if (targetU === uv.x && targetV === uv.y) return;

        // uv -> z is the inverse of fromZtoUV: ((uv - 0.5) * 2) * zoom + pan.
        const t = new vec2((targetU - 0.5) * 2, (targetV - 0.5) * 2);
        node.pos = t.cmult(this.zoom).cadd(this.pan);
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

    get nextUuid(){
        const nodes = this.nodes;
        while (nodes[this.#nextUuid]) {
            this.#nextUuid += 1;
        }
        return this.#nextUuid;
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
        this.forEach(node => {
            node.scale *= scaleFactor;

            // Adjust position to maintain relative spacing only if the node is not anchored
            if (node.anchorForce !== 1) {
                const directionToCentroid = node.pos.minus(centralPoint);
                node.pos = centralPoint.plus(directionToCentroid.scale(scaleFactor));
            }

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
    if (pts.includes(undefined)) Logger.warn("missing keys", edgeData, nodes);

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
