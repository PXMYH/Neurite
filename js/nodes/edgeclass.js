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

    // `directionality.start` is the Node the arrow points at: `EdgeView.makeSvgArrow`
    // reflects the arrowhead through its centre (`rotatePoint`), so its tip is drawn at
    // `start`, not `end`. Between two notes a direction is written as a Ref in `end`'s
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
    maxWidth = 0.05;
    mouseIsOver = false;
    // How much of the width the ribbon used to be drawn at. It was too thick: about 5 CSS px
    // at x0.4, where the Graph is a map of notes and the Edges should be the threads between
    // them, as the hairlines between the stars are in the universe under it. The arrowhead keeps
    // its own size (`makeSvgArrow` is given the full width): a third of it was a speck.
    static slim = 0.32;
    constructor(model, id, style){
        this.model = model;
        this.id = id;
        this.style = style;
        this.gradient = this.makeGradient();
        this.svgArrow = this.makePath('edge-arrow');
        this.svgBorder = this.makePath('edge-border');
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
        const mouseIsOver = this.mouseIsOver;
        // In the colours of the two Nodes it joins, whatever colour it was saved with: the style
        // an Edge carries in a Saved Graph is the one blue every Edge had. The hover colour is the
        // stylesheet's (`.edge-link-hover`), with the arrow's.
        this.paint();

        const stressValue = Math.max(this.model.stress(), 0.01);
        let wscale = this.style['stroke-width'] / (0.5 + stressValue) * (mouseIsOver ? 2 : 1.6);
        wscale = Math.min(wscale, this.maxWidth);

        const direction = this.model.directionality;
        const hasDirection = (direction.start && direction.end);

        const funcMakePath = (hasDirection ? 'makeStraightPath' : 'makeCurvedPath');
        const path = this[funcMakePath](this.model.pts, wscale * EdgeView.slim);
        if (!path) return;
        this.svgLink.setAttribute('d', path);
        this.svgHalo.setAttribute('d', this.centreLine);

        if (!hasDirection) {
            this.svgArrow.style.display = 'none';
            this.svgBorder.style.display = 'none';
            return;
        }

        const svgArrow = this.makeSvgArrow(
            direction.start.pos,
            direction.end.pos,
            direction.start.scale,
            direction.end.scale,
            wscale
        );
        this.svgArrow.setAttribute('d', svgArrow.arrowPath);
        this.svgArrow.style.display = '';

        const borderPath = this.makeBorderPath(svgArrow);
        this.svgBorder.setAttribute('d', borderPath);
        this.svgBorder.style.display = '';
    }
    // One gradient per Edge, from the colour of the Node at one end to the other's
    // (`Node.colourOf`), laid along the line between them in the Plane's own units, so it
    // moves with the Nodes. The colours are written only when they change.
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
    paint(){
        const [a, b] = this.model.pts;
        if (!a || !b) return;

        const from = a.pos.toSvg(), to = b.pos.toSvg();
        const g = this.gradient;
        g.setAttribute('x1', from.x);
        g.setAttribute('y1', from.y);
        g.setAttribute('x2', to.x);
        g.setAttribute('y2', to.y);
        const colours = Node.colourOf(a) + ' ' + Node.colourOf(b);
        if (colours !== this.colours) {
            this.colours = colours;
            const [ca, cb] = colours.split(' ');
            g.firstChild.setAttribute('stop-color', ca);
            g.lastChild.setAttribute('stop-color', cb);
            const url = 'url(#' + g.id + ')';
            this.svgLink.setAttribute('fill', url);
            this.svgLink.setAttribute('stroke', url);
        }
        // The arrowhead in the colour of the Node it points at.
        const end = this.model.directionality.end;
        const tip = end ? Node.colourOf(end) : '';
        if (tip !== this.tip) {
            this.tip = tip;
            this.svgArrow.style.setProperty('--edge-tip', tip);
            this.svgBorder.style.setProperty('--edge-tip', tip);
        }
    }
    toggleMouseOver(status){
        this.mouseIsOver = status;
        this.svgLink.classList.toggle('edge-link-hover', status);
        this.svgArrow.classList.toggle('edge-arrow-hover', status);
        this.svgBorder.classList.toggle('edge-border-hover', status);
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
    // What the pointer aims at (#51): the Edge's centre line, stroked 30 screen px wide
    // and invisible, above the three paths that draw it (`.edge-halo`). The drawn ribbon
    // was the only target, and it is as thin as it looks -- measured, 9 px either side of
    // its middle at x1 and 2 px at x0.25, where it all but could not be hit.
    makeHalo(){
        const path = this.makePath('edge-halo');
        path.style.display = '';
        return path;
    }
    makeStraightPath(pts, wscale){
        const path = ["M "];
        const c = this.model.center();

        // Constructing the straight edge path
        for (const n of pts) {
            if (n.pos.isInvalid()) return '';

            const rotated = n.pos.minus(c).rot90();
            if (rotated.x !== 0 || rotated.y !== 0) {
                const left = rotated.normed(n.scale * wscale);
                if (left.isInvalid()) return '';

                path.push(n.pos.minus(left).toSvg(),
                          " L ",
                          left.plus(n.pos).toSvg(), " ");
            }
        }

        // Closing the straight edge path
        const argMinus = pts[0].pos.minus(c).rot90().normed(pts[0].scale * wscale);
        const firstPoint = pts[0].pos.minus(argMinus);
        if (firstPoint.isInvalid()) return '';

        path.push(" ", firstPoint.toSvg(), "z");
        this.centreLine = "M " + pts[0].pos.toSvg() + " L " + pts[1].pos.toSvg();
        return path.join('');
    }
    makeCurvedPath(pts, wscale){
        if (pts.length < 2) return '';

        const startPoint = pts[0].pos;
        const endPoint = pts[1].pos;
        const startScale = pts[0].scale || 1;
        const endScale = pts[1].scale || 1;

        const horizontal = (startPoint.x - endPoint.x) / 1.1;
        const vertical = (startPoint.y - endPoint.y);
        const distance = Math.sqrt(horizontal * horizontal + vertical * vertical);

        // Calculate the perpendicular vector with adjusted scale based on node scales
        const startPerp = new vec2(vertical, -horizontal).normed(startScale * wscale);
        const endPerp = new vec2(vertical, -horizontal).normed(endScale * wscale);

        // Calculate the points for the curved path
        const startLeft = startPoint.minus(startPerp);
        if (startLeft.isInvalid()) return '';

        const startRight = startPoint.plus(startPerp);
        if (startRight.isInvalid()) return '';

        const endLeft = endPoint.minus(endPerp);
        if (endLeft.isInvalid()) return '';

        const endRight = endPoint.plus(endPerp);
        if (endRight.isInvalid()) return '';

        const curve = Math.min(1, Math.abs(vertical)) / 2;
        const vecLeft = new vec2(0, (vertical > 0 ? 1 : -1) * curve * distance);
        const vecRight = new vec2(0, (vertical > 0 ? -1 : 1) * curve * distance);
        const vecBase = new vec2(horizontal, 0);

        // Adjust the control points based on the distance
        const controlPointLeft1 = startLeft.minus(vecBase).minus(vecLeft);
        if (controlPointLeft1.isInvalid()) return '';

        const controlPointLeft2 = endLeft.plus(vecBase).plus(vecLeft);
        if (controlPointLeft2.isInvalid()) return '';

        const controlPointRight1 = startRight.minus(vecBase).plus(vecRight);
        if (controlPointRight1.isInvalid()) return '';

        const controlPointRight2 = endRight.plus(vecBase).minus(vecRight);
        if (controlPointRight2.isInvalid()) return '';

        // The same curve at no width, which its two sides agree on: `vecRight` is
        // `-vecLeft`, so both sides' control points meet here.
        this.centreLine = "M " + startPoint.toSvg()
            + " C " + startPoint.minus(vecBase).minus(vecLeft).toSvg()
            + ", " + endPoint.plus(vecBase).plus(vecLeft).toSvg()
            + ", " + endPoint.toSvg();

        return "M "
            + startLeft.toSvg()
            + " C "
            + controlPointLeft1.toSvg() + ", "
            + controlPointLeft2.toSvg() + ", "
            + endLeft.toSvg()
            + " L "
            + endRight.toSvg()
            + " C "
            + controlPointRight2.toSvg() + ", "
            + controlPointRight1.toSvg() + ", "
            + startRight.toSvg()
            + " Z";
    }
    makeSvgArrow(startPoint, endPoint, startScale, endScale, wscale){
        const perspectiveFactor = 0.5; // Range [0, 1]
        const adjustedStartScale = 1 + (startScale - 1) * perspectiveFactor;
        const adjustedEndScale = 1 + (endScale - 1) * perspectiveFactor;
        const totalAdjustedScale = adjustedStartScale + adjustedEndScale;
        const startWeight = adjustedEndScale / totalAdjustedScale;
        const endWeight = adjustedStartScale / totalAdjustedScale;
        const midPoint = startPoint.scale(startWeight).plus(endPoint.scale(endWeight));

        // 0.4, set by measurement rather than by reasoning about the chain above.
        //
        // The arrowhead was 1.5 and measured 38.3px against a 325px card -- 11.8% of the
        // card's width. That was tolerable while nothing was drawing one and dominant once
        // every reference did. An intermediate 0.85 barely moved the ratio, because
        // `wscale` also carries the edge's stress and the two changes partly cancelled:
        // reasoning about the product of five factors was the wrong approach, and reading
        // the rendered box was the right one.
        //
        // 0.4 puts it near 5% of a card: unmistakably an arrowhead, and no longer the
        // largest mark between two notes.
        const arrowScaleFactor = 0.4;
        const arrowLength = ((startScale + endScale) / 2 * wscale * 5) * arrowScaleFactor;
        const arrowWidth = ((startScale + endScale) / 2 * wscale * 3) * arrowScaleFactor;
        const direction = endPoint.minus(startPoint);
        const directionNormed = direction.normed(arrowLength);
        const perp = new vec2(-directionNormed.y, directionNormed.x).normed(arrowWidth);

        let arrowBase1 = midPoint.minus(perp);
        let arrowBase2 = midPoint.plus(perp);
        let arrowTip = midPoint.plus(directionNormed);

        const arrowFlipFactor = 0.85;
        const arrowBaseCenterX = (arrowBase1.x + arrowBase2.x) / 2;
        const arrowBaseCenterY = (arrowBase1.y + arrowBase2.y) / 2;
        const arrowCenterX = arrowBaseCenterX * arrowFlipFactor + arrowTip.x * (1 - arrowFlipFactor);
        const arrowCenterY = arrowBaseCenterY * arrowFlipFactor + arrowTip.y * (1 - arrowFlipFactor);
        const arrowCenter = new vec2(arrowCenterX, arrowCenterY);

        arrowBase1 = this.rotatePoint(arrowBase1, arrowCenter);
        arrowBase2 = this.rotatePoint(arrowBase2, arrowCenter);
        arrowTip = this.rotatePoint(arrowTip, arrowCenter);

        const arrowPath = "M " + arrowBase1.toSvg()
                        + " L " + arrowTip.toSvg()
                        + " L " + arrowBase2.toSvg() + " Z";
        return { arrowPath, arrowBase1, arrowBase2, arrowTip };
    }
    makeBorderPath(svgArrow){
        const { arrowBase1, arrowBase2, arrowTip } = svgArrow;

        const arrowMidX = (arrowBase1.x + arrowBase2.x + arrowTip.x) / 3;
        const arrowMidY = (arrowBase1.y + arrowBase2.y + arrowTip.y) / 3;
        const arrowMidPoint = new vec2(arrowMidX, arrowMidY);

        const offsetScale = 1.4;
        const borderBase1 = arrowMidPoint.plus(arrowBase1.minus(arrowMidPoint).scale(offsetScale));
        const borderBase2 = arrowMidPoint.plus(arrowBase2.minus(arrowMidPoint).scale(offsetScale));
        const borderTip = arrowMidPoint.plus(arrowTip.minus(arrowMidPoint).scale(offsetScale));

        return "M " + borderBase1.toSvg()
            + " L " + borderTip.toSvg()
            + " L " + borderBase2.toSvg() + " Z";
    }

    rotatePoint(point, center){
        return new vec2(2 * center.x - point.x, 2 * center.y - point.y);
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
