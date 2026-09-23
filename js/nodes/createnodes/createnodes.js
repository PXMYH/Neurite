On.dblclick(document, (e) => {
    e.stopPropagation();

    // The canvas, including the fractal drawn on it.
    //
    // This tested `e.target.id === 'svg_bg'` exactly, and the fractal's hairs are
    // `<path>` children of that same svg -- so a double-click that happened to land on
    // one hit the path, failed the test, and did nothing. Measured on an empty graph with
    // a 20px grid over 1075 points: 63 of them, 5.9%, had a path on top, with no feedback
    // to say why the gesture had failed. Raising the line count from 128 to 384 made it
    // more likely, so the fix and the cause arrived together.
    //
    // Anything inside the svg counts now, which is every layer the canvas draws --
    // fractal hairs, the mouse path, edges. A card is not inside it (`#nodes` is a
    // sibling of `#svg_bg`), and the chrome stops these events before they arrive
    // (dropdown.js:296), so widening this does not take a gesture from anything else.
    if (!svg.contains(e.target)) return;

    if (e.getModifierState(controls.altKey.value)) {
        // Alt + double click => Create LLM node
        // The guard is inside the branch rather than in its condition so that Alt
        // still owns the gesture with AI features off: it does nothing, instead of
        // falling through and quietly making a text note.
        e.preventDefault();
        if (AiFeatures.enabled) createLlmNode('', undefined, undefined, e.clientX, e.clientY).draw();
    } else if (e.getModifierState(controls.controlKey.value)) {
        // Control + double click => Create Link node
        e.preventDefault();
        const node = returnLinkNodes();
        node.followingMouse = 0;
    } else if (App.nodeMode && !Node.prev) {
        // Shift + double click => Create regular node
        createNodeFromWindow();
    } else if (!Node.prev) {
        // Double click on the canvas => a note, ready to type in.
        //
        // This gesture was free: the only other dblclick on a card is the anchor
        // toggle, and the three modified forms above own Alt, Control and Shift. It
        // was also the single biggest piece of friction in the app -- making a note,
        // the thing a reader does more than anything else, required knowing that
        // Shift had to be held first, and nothing on screen said so.
        //
        // Shift + double click still does exactly what it did. This is the unmodified
        // case that used to do nothing at all.
        e.preventDefault();
        NodeView.focusBodyOf(createNodeFromWindow());
    }
});

function getDefaultTitle(){
    return String.titleFromDate(new Date())
}

String.titleFromDate = function(date){
    const zeroPadded = String.zeroPadded;

    const YY = String(date.getFullYear()).slice(-2); // Extracting last two digits of the year
    const MM = zeroPadded(date.getMonth() + 1, 2); // Months are zero-based
    const DD = zeroPadded(date.getDate(), 2);
    const HH = zeroPadded(date.getHours(), 2);
    const mm = zeroPadded(date.getMinutes(), 2);
    const SS = zeroPadded(date.getSeconds(), 2);
    const sss = zeroPadded(date.getMilliseconds(), 3);
    //const amPm = hour >= 12 ? 'PM' : 'AM';

    return `${YY}-${MM}-${DD} ~ ${HH}:${mm}:${SS}.${sss}`;
}
String.zeroPadded = function(num, len){
    return String(num).padStart(len, '0')
}

// Function to handle node creation from a window (double-click behavior)
function createNodeFromWindow(title = null, content = null, followMouse = false) {
    nodefromWindow = true;
    if (followMouse) followMouseFromWindow = true;
    return addNodeTagToZettelkasten(title || getDefaultTitle(), content);
}

function addNodeTagToZettelkasten(title, content = null) {
    const curMirror = window.currentActiveZettelkastenMirror;

    const curValue = curMirror.getValue();
    const newVal = [curValue];
    if (!curValue.endsWith('\n')) newVal.push('\n');
    newVal.push('\n', Tag.node, ' ', title);
    if (content) newVal.push('\n', content);
    curMirror.setValue(newVal.join(''));
    curMirror.refresh();

    // Find the UI associated with the current active Zettelkasten mirror
    const pane = window.zetPaneList.find(pane => pane.cm === curMirror);
    if (!pane) return;
    const ui = pane.ui;

    const node = ui.scrollToTitle(title);
    node.contentEditableDiv.value = content;
    node.contentEditableDiv.dispatchEvent(new Event('input'));
    return node;
}


function createTextNodeWithPosAndScale(title, text, scale, x, y) {
    // Create the node without scale and position
    const node = TextNode.create(title || getDefaultTitle(), text);

    if (scale !== undefined) node.scale = scale;
    if (x !== undefined && y !== undefined) {
        node.pos.x = x;
        node.pos.y = y;
    }

    return node;
}

function spawnZettelkastenNode(spawningNode, offsetDistance = 0.6, theta = null, title = null, text = null) {
    const scaleFactor = 0.8; // Factor to scale the new node relative to the original

    if (theta === null) theta = thetaForPos(spawningNode.pos, Graph.lastPos);

    // Calculate new position based on angle and distance
    const newPositionX = spawningNode.pos.x + offsetDistance * Math.cos(theta) * spawningNode.scale;
    const newPositionY = spawningNode.pos.y + offsetDistance * Math.sin(theta) * spawningNode.scale;
    const newScale = spawningNode.scale * scaleFactor;

    // Create a new node at the calculated position and scale
    const newNode = createTextNodeWithPosAndScale(title, text, newScale, newPositionX, newPositionY);
    newNode.draw();

    // The node exists already, so the pass must bind the new title to it instead
    // of spawning a second one -- but the other nodes are untouched, so this is
    // not a full reparse.
    const processor = getActiveZetCMInstanceInfo()?.zettelkastenProcessor;
    const append = ()=>addNodeTagToZettelkasten(newNode.getTitle(), text);
    if (processor) processor.writeAs(ZettelkastenProcessor.Pass.spawn, append);
    else append();

    return newNode;
}

Math.PHI = 5 ** .5 * .5 + .5;
function thetaForNodes(n1, n2){
    const lastEdge = n1.edges[n1.edges.length - 1];
    if (lastEdge) n2 = lastEdge.getPointBarUuid(n1.uuid);
    return thetaForPos(n1.pos, n2.pos);
}
function thetaForPos(pos1, pos2){
    const x = pos2.x - pos1.x;
    const y = pos2.y - pos1.y;
    if (x === 0 && y === 0) return 2 * Math.PI * Math.random();

    const baseTheta = Math.atan2(y, x);
    return (baseTheta + 2 * Math.PI / Math.PHI) % (2 * Math.PI);
}

function spawnMemoryNode(root, title, message) {
    const parent = Node.parentAvailableFromRoot(root);
    const theta = thetaForNodes(parent, root);
    const node = spawnZettelkastenNode(parent, 1.5, theta, title, message);
    connectNodes(parent, node);
    return { node, parent };
}

// Testing for spawnMemoryNode

async function spawnHierarchy(count, delay){
    const root = createLlmNode('Root');
    const allNodes = new Map();
    allNodes.set(root.uuid, root);
    for (let i = 0; i < count; i++) {
        const { node, parent } = spawnMemoryNode(root);
        allNodes.set(node.uuid, node);

        Logger.info("Created", `N${i + 1}`, "under", parent.getTitle());
        await Promise.delay(delay);
    }
    return { root, allNodes };
}

function validateTestResult(res){
    const connectedNodes = new Map();

    function traverse(node){
        if (connectedNodes.has(node.uuid)) return;

        connectedNodes.set(node.uuid, node);
        node.forEachConnectedNode(traverse);
    }
    traverse(res.root);

    const errors = [];
    if (connectedNodes.size !== res.allNodes.size) {
        const msg = "Connectivity check failed: Not every node is connected to the root.";
        Logger.err(msg);
        errors.push(msg);
    } else {
        Logger.info("Connectivity test passed.");
    }
    const activeInstance = getActiveZetCMInstanceInfo();
    if (activeInstance && activeInstance.parser) {
        if (activeInstance.parser.nodeTitleToLineMap.size !== connectedNodes.size - 1) { // for root being LLM
            const msg = "Parser validation failed: The number of parser nodes does not match the number of connected nodes.";
            Logger.err(msg);
            errors.push(msg);
        } else {
            Logger.info("Parser test passed.");
        }
    } else {
        Logger.warn("No active ZettelkastenParser found for validation.");
    }

    function print(node, depth = 0, visited = new Set()){
        if (visited.has(node.uuid)) return;

        visited.add(node.uuid);
        const kids = [];
        node.forEachConnectedNode(kids.push, kids);
        console.log(`${'  '.repeat(depth)}${node.getTitle()} (${kids.length})`);
        kids.forEach( (kid)=>{ print(kid, depth + 1, visited) } );
    }
    print(res.root);

    if (errors.length > 0) {
        throw new Error("Hierarchy tests failed:\n" + errors.join("\n"));
    }

    Logger.info("All tests passed successfully.");
}

async function testHierarchy(count = 30, delay = 1000){
    spawnHierarchy(count, delay).then(validateTestResult)
}
