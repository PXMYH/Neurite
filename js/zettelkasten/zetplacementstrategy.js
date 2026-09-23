class NodePlacementStrategy {
    // How many placements one lap of the spiral spreads over the viewport. Chosen
    // so neighbouring slots sit further apart than a default card is wide.
    static SPREAD_SLOTS = 12;

    // The smallest a note placed along a path may be, as a fraction of the root's
    // scale. The decay is geometric, so without a floor the twentieth note on a Radial
    // path is 0.8^19 of the first -- about a hundredth, which is body text a quarter of
    // a pixel tall. See calculateNewPosition.
    //
    // 0.55, measured rather than picked: a title is 15px, so this is the fraction that
    // puts the deepest note's title at 8px on screen at the default view. 0.35 was tried
    // first and gave 5.25px, which is visible and not readable.
    static minScale = 0.55;

    #spreadIndex = 0;

    constructor(pathObject, nodeObjects = {}) {
        this.nodeObjects = nodeObjects;
        this.path = pathObject.path || [];
        this.zetPlacementOverride = pathObject.zetPlacementOverride || false;
        this.currentPathIndex = 0;
    }

    updatePath(pathObject) {
        // Assuming pathObject has the structure { zetPath: { path: [...] }, zetPlacementOverride: boolean }
        this.path = pathObject.zetPath.path || [];
        this.zetPlacementOverride = pathObject.zetPlacementOverride;
    }

    calculatePositionAndScale(currentNodeTitle) {
        Logger.debug("Calculating position and scale...");
        Logger.debug("Current path index:", this.currentPathIndex);
        Logger.debug("Path length:", this.path.length);
        Logger.debug("override?", this.zetPlacementOverride);

        if (this.zetPlacementOverride) { // Use the directly passed flag
            Logger.debug("Placement override active, spreading a node over the viewport");
            return this.createSpreadNode(currentNodeTitle);
        }

        const nodeKeys = Object.keys(this.nodeObjects);

        if (nodeKeys.length === 0) {
            Logger.debug("No nodes in nodeObjects, starting from -1,0.");
            // Scale 1, not 0.05.
            //
            // This is the first note of a graph typed into the notes pane, and every
            // note after it inherits from it through calculateNewPosition below -- so
            // 0.05 was the seed of a graph nobody could read. Measured on twenty notes
            // typed into the pane: `node.scale` ran 0.05 down to 0.01638, cards were
            // 16.3px wide falling to 5.3px, and the body text rendered between 0.75 and
            // 0.25 of a pixel. Fit made it worse rather than better, because fitting
            // twenty specks means zooming out. At no zoom level were two notes legible
            // at once.
            //
            // The same note made by double-clicking the canvas gets scale 1 and 15px
            // text. One object, two creation paths, a 20-60x difference -- and the pane
            // is the path the app is built around.
            return createTextNodeWithPosAndScale(currentNodeTitle, '', 1, -.5, 0);
        }

        if (this.currentPathIndex >= this.path.length) {
            Logger.debug("Current path index exceeds path length, resetting to 0");
            this.currentPathIndex = 0;
        }

        const currentPathPoint = this.path[this.currentPathIndex];
        Logger.debug("Current path point:", currentPathPoint);

        if (!currentPathPoint) {
            Logger.debug("Current path point is undefined, spreading a node over the viewport");
            this.currentPathIndex = (this.currentPathIndex + 1) % this.path.length;
            return this.createSpreadNode(currentNodeTitle);
        }

        if (currentPathPoint.useCreateTextNode) {
            Logger.debug("Current path point indicates spreading a node over the viewport");
            this.currentPathIndex = (this.currentPathIndex + 1) % this.path.length;
            return this.createSpreadNode(currentNodeTitle);
        }

        const startNode = this.getStartNode(currentPathPoint);
        Logger.debug("Start node:", startNode);

        if (!startNode) {
            Logger.debug("Start node not found, moving to the next path point");
            this.currentPathIndex = (this.currentPathIndex + 1) % this.path.length;
            return this.calculatePositionAndScale(currentNodeTitle);
        }

        const { newX, newY, newScale } = this.calculateNewPosition(startNode, currentPathPoint);
        Logger.debug("Calculated position:", { x: newX, y: newY });
        Logger.debug("Calculated scale:", newScale);

        this.currentPathIndex = (this.currentPathIndex + 1) % this.path.length;

        return createTextNodeWithPosAndScale(currentNodeTitle, '', newScale, newX, newY);
    }

    // Was two uniform random draws over the viewport. Uniform draws clump: two
    // notes created in a row could land a few pixels apart, and the second card
    // then sat on top of the first with nothing to say either was there. Walking
    // a golden-angle spiral instead spreads consecutive placements apart by
    // construction and covers the viewport evenly, without needing to know how
    // big a card is in plane units.
    //
    // Only the radius wraps at SPREAD_SLOTS; the angle keeps advancing off the
    // raw counter. A lap is therefore rotated against the one before it, so
    // placement 13 interleaves with the first twelve instead of landing on top
    // of placement 1. Past a lap or two the viewport is genuinely crowded and
    // no placement rule can keep cards apart — that is a zoom level problem.
    createSpreadNode(currentNodeTitle) {
        const n = this.#spreadIndex++;
        const angle = n * 2.399963229728653;    // golden angle, in radians
        // sqrt keeps the points area-uniform rather than bunched at the centre.
        const slot = n % NodePlacementStrategy.SPREAD_SLOTS;
        const radius = 0.9 * Math.sqrt((slot + 0.5) / NodePlacementStrategy.SPREAD_SLOTS);
        return TextNode.create(currentNodeTitle, '', radius * Math.cos(angle), radius * Math.sin(angle))
    }

    getStartNode(currentPathPoint) {
        const nodeKeys = Object.keys(this.nodeObjects);
        let startNodeIndex = nodeKeys.length - 1;

        if (currentPathPoint.startNodeIndex !== undefined) {
            startNodeIndex = currentPathPoint.startFromBeginning
                ? currentPathPoint.startNodeIndex
                : nodeKeys.length - 1 - currentPathPoint.startNodeIndex;
        }

        Logger.debug("Start node index:", startNodeIndex);

        if (startNodeIndex >= 0 && startNodeIndex < nodeKeys.length) {
            const startNode = this.nodeObjects[nodeKeys[startNodeIndex]];
            Logger.debug("Selected start node:", startNode);
            return startNode;
        } else {
            const lastNode = this.nodeObjects[nodeKeys[nodeKeys.length - 1]];
            Logger.debug("Start node index out of range, using the last node:", lastNode);
            return lastNode;
        }
    }

    calculateNewPosition(startNode, currentPathPoint) {
        const newX = startNode.pos.x + currentPathPoint.x * startNode.scale;
        const newY = startNode.pos.y + currentPathPoint.y * startNode.scale;

        // Clamped, because this multiplies rather than sets: each note is the previous
        // one's scale times the path's, so a path scale under 1 decays geometrically and
        // the twentieth note is a speck. `ZetPath` supplies 0.8 for Radial, which is
        // 0.8^k -- 0.01 by the twentieth. The decay is the "notes get smaller as they get
        // further from the root" idea, and it is a reasonable idea down to the point where
        // a note stops being readable, which is where it stops.
        //
        // Notes past that depth share a size instead of continuing to shrink, so a graph
        // has a gradient rather than a vanishing point.
        const newScale = Math.max(startNode.scale * currentPathPoint.scale,
                                  NodePlacementStrategy.minScale);
        return { newX, newY, newScale };
    }

    getPreviewPoints(startX, startY, startScale) {
        const previewPoints = [];
        let currentX = startX;
        let currentY = startY;
        let currentScale = startScale;

        let currentPathIndex = this.currentPathIndex;
        for (let i = 0; i < this.path.length; i++) {
            const currentPathPoint = this.path[currentPathIndex];
            if (currentPathPoint.useCreateTextNode) {
                previewPoints.push({ x: currentX, y: currentY }); // Placeholder for random node
            } else {
                const newX = currentX + currentPathPoint.x * currentScale;
                const newY = currentY + currentPathPoint.y * currentScale;
                const newScale = currentScale * currentPathPoint.scale;
                previewPoints.push({ x: newX, y: newY });
                currentX = newX;
                currentY = newY;
                currentScale = newScale;
            }
            currentPathIndex = (currentPathIndex + 1) % this.path.length;
        }
        return previewPoints;
    }
}

function drawPlacementPreview(event) {
    const placementPreview = Elem.byId('placementPreview');
    placementPreview.innerHTML = ''; // Clear previous preview points

    const startX = event.clientX;
    const startY = event.clientY;
    const startScale = 0.1; // Adjust the starting scale as needed

    const points = window.zettelkastenProcessor.placementStrategy.getPreviewPoints(startX, startY, startScale);
    points.forEach(point => {
        const circle = Svg.new.circle();
        circle.setAttribute('cx', point.x);
        circle.setAttribute('cy', point.y);
        circle.setAttribute('r', '5'); // radius
        circle.setAttribute('fill', 'red');
        placementPreview.appendChild(circle);
    });
}

// On.mousemove(document, drawPlacementPreview);
