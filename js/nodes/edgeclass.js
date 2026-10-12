// The Edge the two share, or undefined. `find(node2.edges.includes, node2.edges)` passed each
// Edge's index on as `includes`' fromIndex, so an Edge further along node1's list than node2's
// was not found: on the AI bundle, 63 of 144 Edge ends. The Connect list then showed linked
// notes as not linked, and Link said "Not linked" of an Edge it had just made.
function findExistingEdge(node1, node2) {
    return node1.edges.find( (edge)=>node2.edges.includes(edge) );
}

class Edge {
    constructor(pts, length = 0.6, strength = 0.1, style){
        this.pts = pts;
        this.length = length;
        this.currentLength = this.length;
        this.strength = strength;
        this.style = style || {
            stroke: "red",
            "stroke-width": "0.01",
            fill: "red"
        };

        const edgeKey = this.edgeKey = pts.map(String.uuidOf).sort().join('-');
        this.directionality = Graph.edgeDirectionalities[edgeKey]
                           || {start: null, end: null};
        this.view = new EdgeView(this, edgeKey, style);

        Logger.debug("Creating edge with pts:", pts);
        Logger.debug("Directionality after assignment:", this.directionality);
    }
    static directionalityFromData = (direction)=>({
        start: Node.byUuid(direction.start),
        end: Node.byUuid(direction.end)
    })
    static dataForEdge(edge){ return edge.dataObj() }
    dataObj() {
        return {
            l: this.length,
            s: this.strength,
            g: this.style,
            p: this.pts.map(String.uuidOf),
            directionality: { // Simplified data using UUIDs
                start: this.directionality.start?.uuid ?? null,
                end: this.directionality.end?.uuid ?? null
            },
            edgeKey: this.edgeKey
        }
    }

    // Removed the same way whatever the two Nodes are (#51): every Ref that writes the Edge
    // goes first -- a text Node's Refs to the other end -- and then the Edge. Only a pair of
    // text Nodes had its Refs removed, so an Edge from a note to an AI Node written in the
    // Pane came back at the next pass: measured, gone after the chip's x, back after a save.
    // A Node with no Title has no Ref naming it to remove.
    removeInstance() {
        const [a, b] = this.pts;
        const [ta, tb] = [a.getTitle(), b.getTitle()];
        if (ta && tb) {
            if (a.isTextNode) removeEdgeFromZettelkasten(ta, tb);
            if (b.isTextNode) removeEdgeFromZettelkasten(tb, ta);
        }
        this.remove();
    }

    scaleLength(amount) {
        const avg = this.center();
        this.length *= amount;
        const pts = this.pts;
        pts.forEach(n => {
            n.pos = n.pos.minus(avg).scale(amount).plus(avg);
        });
        if (pts[0]) pts[0].updateEdgeData();
    }
    static scaleLengthByThisAmount(edge){
        return edge.scaleLength(this.valueOf())
    }

    // The direction the next turn gives: toward one end, toward the other, then neither.
    nextDirection() {
        const [p0, p1] = this.pts;
        const start = this.directionality.start;
        if (start === p0) return {start: p1, end: p0};
        if (start === p1) return {start: null, end: null};
        return {start: p0, end: p1};
    }
    // The note the next turn would take a Ref out of, or null when it only adds one. Between
    // two notes the arrow is written as their Refs, so turning it one way removes the Ref
    // that points the other -- out of the note's own sentence, if that is where it is.
    turnTakesRefFrom() {
        const [p0, p1] = this.pts;
        if (!p0.isTextNode || !p1.isTextNode) return null;

        const {start, end} = this.nextDirection();
        if (!start) return null;
        const processor = getZetNodeCMInstance(start)?.zettelkastenProcessor;
        return (processor?.sectionNames(start, end.getTitle()) ? start : null);
    }

    // `directionality.start` is the Node the arrow points at: `EdgeView.draw` puts the
    // arrowhead's tip on `start`'s card, not `end`'s. Between two notes a direction is written as a Ref in `end`'s
    // section naming `start` -- the note that names the other points at it -- and the
    // parser reads the direction back from the Refs on every pass (`handleRefTags`).
    toggleDirection() {
        const pts = this.pts;
        const direction = this.directionality;
        Object.assign(direction, this.nextDirection());

        // Update all instances of CodeMirror that include these nodes
        if (pts[0].isTextNode && pts[1].isTextNode) {
            const startTitle = pts[0].getTitle();
            const endTitle = pts[1].getTitle();
            const { startNodeInfo, endNodeInfo } = getEdgeInfo(startTitle, endTitle);
            // Handle edge additions and removals based on new direction
            if (direction.start === pts[0]) {
                if (endNodeInfo) {
                    addEdgeToZettelkasten(endTitle, startTitle, endNodeInfo.cm);
                }
                if (startNodeInfo) {
                    removeEdgeFromZettelkasten(startTitle, endTitle, startNodeInfo.cm);
                }
            } else if (direction.start === pts[1]) {
                if (startNodeInfo) {
                    addEdgeToZettelkasten(startTitle, endTitle, startNodeInfo.cm);
                }
                if (endNodeInfo) {
                    removeEdgeFromZettelkasten(endTitle, startTitle, endNodeInfo.cm);
                }
            } else {
                if (startNodeInfo) {
                    addEdgeToZettelkasten(startTitle, endTitle, startNodeInfo.cm);
                }
                if (endNodeInfo) {
                    addEdgeToZettelkasten(endTitle, startTitle, endNodeInfo.cm);
                }
            }
        }

        Graph.edgeDirectionalities[this.edgeKey] = direction;
    }
    getDirectionRelativeTo(node) {
        if (this.directionality.end === node) return 'outgoing';
        if (this.directionality.start === node) return 'incoming';
        return 'none';
    }
    center() {
        const cb = (t, n)=>t.plus(n.pos) ;
        return this.pts.reduce(cb, new vec2(0, 0)).unscale(this.pts.length);
    }

    remove(){ Graph.deleteEdge(this) }
    scaleEdge(amount) {
        this.length *= amount;
    }
    step(dt) {
        dt = (isNaN(dt) ? 0 : Math.min(dt, 1));  // Clamp dt to a maximum of 1

        const avg = this.center();
        for (let n of this.pts) {
            if (n.anchorForce !== 0) continue; // Only apply force if the anchor force is zero

            const d = n.pos.minus(avg);
            const dMag = d.mag();

            // Update the current length of the edge
            this.currentLength = dMag;

            // Apply force to either shorten or lengthen the edge to the desired length
            if (dMag === this.length) continue;

            const dampingFactor = 0.4;
            const forceAdjustment = (1 - this.length / (dMag + 1e-300)) * dampingFactor;
            const f = d.scale(forceAdjustment);
            n.force = n.force.plus(f.scale(-this.strength));
        }
        this.view.draw();
    }
    stress(){
        const avg = this.center();
        const cb = (t, n)=>(t + n.pos.minus(avg).mag() - this.length) ;
        return this.pts.reduce(cb, 0) / (this.length + 1);
    }
}



class EdgeView {
    funcPopulate = 'populateForEdge';
    mouseIsOver = false;
    // A thread between two cards (#84), as Obsidian's Canvas, tldraw and React Flow draw one: it
    // leaves the side of one card that faces the other, and meets the facing side of the other,
    // square to each, on a curve; it is the same 1.5 screen px at every zoom, 2.5 under the
    // pointer; and it runs in a gradient from the colour of one note to the other's. It was a
    // ribbon from centre to centre, so it met each card wherever the line happened to cross its
    // edge, often at a corner, with its arrowhead half way along it and its width following the
    // zoom and the Edge's stress.
    static restPx = 1.5;
    static hoverPx = 2.5;
    // The arrowhead, at the card it points at: its tip on the card's edge. In screen px.
    static arrowLength = 9;
    static arrowHalf = 4;
    constructor(model, id, style){
        this.model = model;
        this.id = id;
        this.style = style;
        this.gradient = this.makeGradient();
        this.svgArrow = this.makePath('edge-arrow');
        this.svgLink = this.makeLink();
        this.svgHalo = this.makeHalo();
    }

    attachEventListeners(elem){
        On.wheel(elem, this.onWheel);
        On.mouseover(elem, this.toggleMouseOver.bind(this, true));
        On.mouseout(elem, this.toggleMouseOver.bind(this, false));
        On.dblclick(elem, this.onDblClick);
    }
    draw(){
        const [a, b] = this.model.pts;
        if (!a || !b) return;

        // From the Node the arrow leaves to the one it points at (`start`), and from the first to
        // the second where it points at neither.
        const direction = this.model.directionality;
        const hasDirection = Boolean(direction.start && direction.end);
        const from = (hasDirection ? direction.end : a);
        const to = (hasDirection ? direction.start : b);
        const curve = EdgeView.curveBetween(from, to);
        if (!curve) {
            for (const path of [this.svgLink, this.svgHalo, this.svgArrow]) path.style.display = 'none';
            return;
        }

        const px = (this.mouseIsOver ? EdgeView.hoverPx : EdgeView.restPx);
        this.svgLink.setAttribute('d', curve.d);
        this.svgLink.setAttribute('stroke-width', px * EdgeView.svgPerPx());
        this.svgLink.style.display = '';
        this.svgHalo.setAttribute('d', curve.d);
        this.svgHalo.style.display = '';
        this.paint(from, to, curve.ends);

        if (!hasDirection) {
            this.svgArrow.style.display = 'none';
            return;
        }
        // Its base back along the curve's last tangent, which leaves the card's side square. At
        // most a quarter of the card's smaller half on screen, and never under half its own size:
        // a card zoomed out to a few px carried an arrowhead nearly as big as itself.
        const half = to.screenBox().half;
        const fit = Math.min(1, Math.max(0.5, Math.min(half.x, half.y) / 4 / EdgeView.arrowLength));
        const size = fit * (this.mouseIsOver ? 1.25 : 1);
        const tip = curve.points[3];
        const base = tip.plus(curve.out1.scale(EdgeView.arrowLength * size));
        const side = new vec2(-curve.out1.y, curve.out1.x).scale(EdgeView.arrowHalf * size);
        const [l, t, r] = [base.plus(side), tip, base.minus(side)].map(EdgeView.toSvg);
        this.svgArrow.setAttribute('d', 'M ' + l.x + ' ' + l.y + ' L ' + t.x + ' ' + t.y
                                      + ' L ' + r.x + ' ' + r.y + ' Z');
        this.svgArrow.style.display = '';
    }
    // The curve between two cards on screen, in client px: from the middle of the side of the
    // first that faces the second to the middle of the side of the second that faces the first --
    // across, where the gap between them is wider than it is tall, and up or down where it is not
    // -- with each end's control point straight out of its side. React Flow's bezier: half the
    // distance between the two sides out from each, or, where the sides have passed each other,
    // a bend that grows with the square root of how far (`getBezierPath`, curvature 0.25).
    static sideCurve(A, B){
        if (!A || !B) return null;

        const d = B.centre.minus(A.centre);
        const across = (Math.abs(d.x) - (A.half.x + B.half.x) >= Math.abs(d.y) - (A.half.y + B.half.y));
        const sign = Math.sign(across ? d.x : d.y) || 1;
        const out0 = (across ? new vec2(sign, 0) : new vec2(0, sign));
        const out1 = out0.scale(-1);
        const p0 = A.centre.plus(across ? new vec2(sign * A.half.x, 0) : new vec2(0, sign * A.half.y));
        const p1 = B.centre.plus(across ? new vec2(-sign * B.half.x, 0) : new vec2(0, -sign * B.half.y));
        const gap = (across ? (p1.x - p0.x) : (p1.y - p0.y)) * sign;
        const bend = (gap >= 0 ? 0.5 * gap : 0.25 * 25 * Math.sqrt(-gap));
        if ([p0.x, p0.y, p1.x, p1.y, bend].some( (n)=>!Number.isFinite(n) )) return null;

        return {points: [p0, p0.plus(out0.scale(bend)), p1.plus(out1.scale(bend)), p1], out1};
    }
    // The curve from one Node's card to another's in the SVG's units, as a path, or null before
    // both have been drawn. A Proposed Edge is drawn on it too (`ZetProposals.draw`), as the Edge
    // it would be.
    static curveBetween(from, to){
        const curve = EdgeView.sideCurve(from.screenBox?.(), to.screenBox?.());
        if (!curve) return null;

        const [p0, c0, c1, p1] = curve.points.map(EdgeView.toSvg);
        const d = 'M ' + p0.x + ' ' + p0.y + ' C ' + c0.x + ' ' + c0.y + ', '
                + c1.x + ' ' + c1.y + ', ' + p1.x + ' ' + p1.y;
        return {...curve, d, ends: [p0, p1]};
    }
    // A point on screen in the SVG's own units, and how many of them make one screen px. The
    // scale and offset are the frame's (`NodeSimulation.updateNodes`): reading the SVG's box again
    // here, after the cards were moved, would lay the page out a second time every frame.
    static toSvg(p){ return Graph.xyToZ(p.x, p.y, false).toSvg() }
    static svgPerPx(){ return 2 * Graph.zoom.mag() * Svg.zoom / Svg.scale }

    // One gradient per Edge, from the colour of the Node it leaves to the colour of the one it
    // reaches (`Node.colourOf`), laid from one end of the curve to the other in the SVG's units,
    // so it moves with the cards. Every Edge is in the colours of its own two notes, so no two
    // Edges between different notes look alike. Written only when they change.
    static paints = null;
    makeGradient(){
        EdgeView.paints ||= svg.insertBefore(Svg.new.defs(), svg.firstChild);
        const gradient = Svg.new.linearGradient();
        gradient.id = 'edge-paint-' + this.id;
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        for (const offset of ['0', '1']) {
            const stop = Svg.new.stop();
            stop.setAttribute('offset', offset);
            gradient.append(stop);
        }
        EdgeView.paints.append(gradient);
        return gradient;
    }
    paint(from, to, [p0, p1]){
        const g = this.gradient;
        const ends = p0.x + ' ' + p0.y + ' ' + p1.x + ' ' + p1.y;
        if (ends !== this.ends) {
            this.ends = ends;
            g.setAttribute('x1', p0.x);
            g.setAttribute('y1', p0.y);
            g.setAttribute('x2', p1.x);
            g.setAttribute('y2', p1.y);
        }
        const colours = Node.colourOf(from) + ' ' + Node.colourOf(to);
        if (colours !== this.colours) {
            this.colours = colours;
            const [ca, cb] = colours.split(' ');
            g.firstChild.setAttribute('stop-color', ca);
            g.lastChild.setAttribute('stop-color', cb);
            // Stroked, at a width set in the SVG's units each frame (`draw`), never a
            // `non-scaling-stroke`: WebKit paints that one's gradient in its last colour.
            this.svgLink.setAttribute('stroke', 'url(#' + g.id + ')');
            this.svgLink.setAttribute('fill', 'none');
            // The arrowhead in the colour of the Node it points at.
            this.svgArrow.style.setProperty('--edge-tip', cb);
        }
    }
    toggleMouseOver(status){
        this.mouseIsOver = status;
    }

    makeLink(){
        const path = Svg.new.path();
        for (const [key, value] of Object.entries(this.style)) {
            path.setAttribute(key, value)
        }
        path.classList.add('edge-link');
        path.dataset.viewType = 'edgeViews';
        path.dataset.viewId = this.id;
        this.attachEventListeners(path);
        return path;
    }
    makePath(className){
        const path = Svg.new.path();
        path.classList.add(className);
        path.style.display = 'none';
        path.dataset.viewType = 'edgeViews';
        path.dataset.viewId = this.id;
        this.attachEventListeners(path);
        return path;
    }
    // What the pointer aims at (#51): the Edge's line, stroked 30 screen px wide and invisible,
    // above the paths that draw it (`.edge-halo`). The drawn line was the only target, and it is
    // as thin as it looks.
    makeHalo(){
        const path = this.makePath('edge-halo');
        path.style.display = '';
        return path;
    }

    // A plain click does nothing to an Edge. It turned the arrow, and between two notes a turn
    // rewrites their Refs, so a click inside the invisible halo -- on what looks like empty
    // Plane -- edited two notes' sentences, and a double-click there edited them twice and made
    // a note on top. The arrow turns from the Edge's menu, which asks before a turn takes a Ref
    // out of a note (`Menu.Context.populateForEdge`).
    //
    // A double-click on an Edge is the Edge's: it deletes it in the connect mode, and never
    // reaches the Plane behind to make a note there.
    onDblClick = (e)=>{
        e.stopPropagation();
        if (App.interface.nodeMode.isOnFor(e)) this.model.removeInstance();
    }
    onWheel = (e)=>{
        if (!App.interface.nodeMode.isOnFor(e)) return;

        // Same convention as the fractal's zoom and a card's, so an edge lengthens on a
        // scroll up rather than shortening. `wheelDelta` is the legacy property and its
        // sign is the opposite of `deltaY`'s, which is what had all three disagreeing.
        const amount = Math.exp(-e.deltaY * settings.zoomSpeed * settings.zoomSpeedMultiplier);

        // Determine if this edge should be scaled based on both nodes being selected
        const selectedNodes = App.selectedNodes;
        if (selectedNodes.uuids.size > 0 && this.model.pts.every(selectedNodes.hasNode, selectedNodes)) {
            selectedNodes.getUniqueEdges()
            .forEach(Edge.scaleLengthByThisAmount, amount)
        } else {
            this.model.scaleLength(amount);
        }

        e.stopPropagation();
    }
}
