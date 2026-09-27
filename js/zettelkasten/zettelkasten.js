let nodefromWindow = false;
let followMouseFromWindow = false;

function nodeRE(name = undefined, tag_prefix = undefined) {
    if (tag_prefix === undefined) {
        tag_prefix = Tag.node;
    }
    if (name === undefined) {
        return new RegExp("(\\n|^)" + RegExp.escape(tag_prefix));
    }
    return new RegExp("(\\n|^)" + RegExp.escape(tag_prefix) + "[\t ]*" + RegExp.escape(name) + "[\t ]*(\n|$)");
}

function replaceInBrackets(s, from, to) {
    const open = Tag.ref;
    const close = getClosingBracket(open);

    let index = s.indexOf(open);
    while (index !== -1) {
        const closeIndex = s.indexOf(close, index);
        if (closeIndex !== -1) {
            const insideBrackets = s.substring(index + open.length, closeIndex);
            if (insideBrackets.trim() === from.trim()) {
                s = s.substring(0, index + open.length) + to + s.substring(closeIndex);
            }
        }
        index = s.indexOf(open, index + 1);
    }
    return s;
}

function renameNode(from, to) {
    //(\n|^)(((#node:)[\t ]*from[\t ]*)|((#ref:)([^,\n]+,)*[\t ]*from[\t ]*(,[^,\n]+)*))(?=(\n|$))
    //$1$4$6$7 to$8$9
    const fe = RegExp.escape(from);
    const nodeRE = '(' + RegExp.escape(Tag.node) + ")[\\t ]*" + fe + "[\\t ]*";
    const refRE = '(' + RegExp.escape(Tag.ref) + ")([^,\\n]+,)*[\\t ]*" + fe + "[\\t ]*(,[^,\\n]+)*";
    const tag = "((" + nodeRE + ")|(" + refRE + "))";
    const re = new RegExp("(\n|^)" + tag + "(?=(\n|$))", "g");
    const replacer = (match, p1, p2, p3, p4, p5, p6, p7, p8, p9, offset, string, groups) => {
        return p1 + (p4 ? p4 + ' ' : '') + (p6 ? p6 + ' ' : '') + (p7 || '') + to + (p8 || '');
    }
    return (s) => replaceInBrackets(s.replace(re, replacer), from, to);
}

class NodeWrap {
    edges = new Map();
    live = true;
    plainText = '';
    ref = '';
    constructor(node, title, lineNum = null){
        this.lineNum = lineNum;
        this.node = node;
        this.title = title;
    }
}
TextArea.ofNode = function(node){
    return (node.isLLM ? node.promptTextArea : node.textarea)
}

class ZettelkastenProcessor {
    // How long after the last parse to separate the graph. Long enough that typing a
    // note does not trigger one per keystroke, short enough that a reader who pastes a
    // page of notes sees them settle rather than wondering whether it finished.
    static relaxDelayMs = 400;

    // What a pass over the editor's text should do. `full` reparses every node's
    // body instead of only the node whose line changed; `restoring` binds a title
    // to the node that already carries it instead of spawning a new one.
    //
    // These were module-level globals -- processAll, restoreZettelkastenEvent and
    // bypassZettelkasten -- that a caller set before writing into CodeMirror, for
    // processInput to read and clear. The write is what triggers the pass, so the
    // globals were how a caller passed arguments through the change event. Naming
    // the four combinations that callers actually ask for, and bracketing the
    // write with writeAs, means a mode is stated at the call and cannot outlive
    // it. bypassZettelkasten had no writer at all and is gone.
    static Pass = {
        edit:    {full: false, restoring: false},   // a human typing
        rewrite: {full: true,  restoring: false},   // code replaced the text
        restore: {full: true,  restoring: true},    // a saved pane is reloading
        spawn:   {full: false, restoring: true}     // one node's tag was appended
    };

    mode = ZettelkastenProcessor.Pass.edit;
    noteInputLines = [];
    placementStrategy = new NodePlacementStrategy([], {});
    prevNoteInputLines = [];
    wrapPerLine = {};
    wrapPerTitle = {};
    // Node sections whose refs named a title the pass had not reached yet, keyed
    // by section title, to retry once the pass has seen every title. See
    // deferRefTags. Null only while the retry itself runs.
    deferredRefs = null;
    constructor(codeMirrorInstance, parser){
        this.noteInput = codeMirrorInstance;
        this.parser = parser;

        this.noteInput.on('change', this.processInput);
    }

    // Write into the editor and let the pass the write triggers run in `mode`.
    // Brackets the whole write, so the mode cannot leak: setting a global and
    // returning left it set for whatever ran next, and a write that fires two
    // change events got the mode on the first pass only, because the first pass
    // cleared it. neuralapi.js was the one caller that reset its flag by hand;
    // this does that for every caller, and also when the write throws.
    writeAs(mode, write){
        const prev = this.mode;
        this.mode = mode;
        try { write() } finally { this.mode = prev }
    }
    // Run a pass in `mode` without writing -- the caller put the text in already.
    processAs(mode){ this.writeAs(mode, this.processInput) }

    static updateForThisPath(processor){
        const strategy = processor.placementStrategy;
        if (strategy) strategy.updatePath(this.valueOf());
    }

    spawnNodeFromZettelkasten(currentNodeTitle){
        App.processedNodes.update();
        this.placementStrategy.nodeObjects = App.processedNodes.map;
        return this.placementStrategy.calculatePositionAndScale(currentNodeTitle);
    }

    // The titles of the notes an edit touched: the one its first changed line sits in,
    // and every one whose title line it wrote.
    //
    // It was the first one only. An edit that writes several sections at once -- a
    // paste, a `setValue` -- left the rest with an empty card and no Edges until the
    // next full pass: measured, `## One` and `## Two` with `[[One]]` written in one edit
    // gave Two an empty body and no Edge. And the first changed line came from
    // `findIndex(...) || fallback`, so a change on line 0 counted as none.
    findChangedTitles(lines){
        const prev = this.prevNoteInputLines;
        // The changed span: what lies between the lines the edit left alone at either end.
        let start = 0;
        while (start < lines.length && lines[start] === prev[start]) start++;
        let end = lines.length;
        for (let p = prev.length; end > start && p > start && lines[end - 1] === prev[p - 1]; p--) end--;

        const titles = new Set();
        const titleOf = (line)=>(line.startsWith(Tag.node) ? line.substr(Tag.node.length).trim() : null) ;
        for (let i = Math.min(start, lines.length - 1); i >= 0; i--) {
            // A change inside an AI section is no note's; handleLlmPromptLine has it.
            if (lines[i].startsWith(LLM_TAG)) break;

            const title = titleOf(lines[i]);
            if (title === null) continue;

            titles.add(title);
            break;
        }
        for (let i = start; i < end; i++) {
            const title = titleOf(lines[i]);
            if (title !== null) titles.add(title);
        }
        return titles;
    }

    forEachNodeWrap(cb, ct){
        const wrapPerTitle = this.wrapPerTitle;
        for (const title in wrapPerTitle) cb.call(ct, wrapPerTitle[title]);
    }
    initializeNodeWrap(wrap){
        if (wrap.node.removed) return delete this.wrapPerTitle[wrap.title];

        wrap.plainText = '';
        wrap.ref = '';
        wrap.live = false;
    }

    processInput = ()=>{
        const mode = this.mode;

        this.forEachNodeWrap(this.initializeNodeWrap, this);
        this.noteInputLines = this.noteInput.getValue().split('\n');
        let currentNodeTitle = '';
        this.deferredRefs = new Map();

        this.noteInputLines.forEach((line, index) => {
            currentNodeTitle = this.processLine(line, index, currentNodeTitle)
        });

        if (!mode.full) this.processChangedNodes(this.noteInputLines);

        this.drainDeferredRefs();

        this.deleteInactiveNodesFromDict(this.wrapPerTitle);
        this.deleteInactiveNodesFromDict(this.wrapPerLine);

        this.prevNoteInputLines = this.noteInputLines;
        this.noteInputLines = [];

        this.scheduleRelax();
    }

    // Separate the whole graph once a pass has stopped arriving.
    //
    // Per-arrival separation cannot win against the placement here. A pane parse puts
    // cards in three x-columns -- measured at x = -0.595, -0.5 and +0.595 -- while a card
    // is 0.696 plane units wide, so neighbouring columns overlap by nearly a full card and
    // only the y-gaps keep them apart. Twelve notes typed into the pane arrived with 9 of
    // 66 pairs overlapping, the worst by 41% of a card, which is the first thing a reader
    // sees of their own graph.
    //
    // Deliberately without `keepInView`. That clamp is right for one note a reader just
    // made -- it has to be visible -- and wrong for a whole graph: twelve cards cannot
    // both fit the viewport and stay clear of each other, so the clamp wins and the pile
    // survives. A map is allowed to be larger than the screen. That is what Fit, the
    // overview and the scale readout are for.
    //
    // Debounced, because a parse runs on every CodeMirror change: typing a note fires this
    // once per keystroke, and separating the graph on each one would fight the caret.
    scheduleRelax(){
        clearTimeout(this.relaxTimer);
        this.relaxTimer = setTimeout(()=>{ Graph.relaxInBackground() }, ZettelkastenProcessor.relaxDelayMs);
    }

    processLine(line, index, currentNodeTitle){
        if (line.startsWith(Tag.node)) {
            return this.handleNode(line, index, currentNodeTitle)
        }
        delete this.wrapPerLine[index];

        if (line.startsWith(LLM_TAG)) {
            return this.handleLLM(line, index, currentNodeTitle)
        }

        if (this.wrapPerTitle[currentNodeTitle]?.node.isLLM) {
            return this.handleLlmPromptLine(line, currentNodeTitle)
        }

        // A full pass updates every node's body, restoring or not.
        if (this.mode.full) {
            // Call without the start and end lines
            this.handlePlainTextAndReferences(line, currentNodeTitle)
        }

        return currentNodeTitle;
    }

    handlePlainTextAndReferences(line, currentNodeTitle, startLine = null, endLine = null, partial){
        //this.removeStaleReferences(currentNodeTitle, this.wrapPerTitle);

        if (line.includes(Tag.ref)) {
            // If startLine and endLine are null, handleReferenceLine will use its default behavior
            this.handleReferenceLine(line, currentNodeTitle, this.noteInputLines, true, startLine, endLine);
        } else {
            const wrap = this.wrapPerTitle[currentNodeTitle];
            if (wrap) this.handleLineWithoutTags(wrap, line, partial);
        }
    }

    processChangedNodes(lines){
        for (const title of this.findChangedTitles(lines)) {
            if (this.wrapPerTitle[title]) this.processChangedNode(lines, title);
        }
    }

    processChangedNode(lines, changedNodeTitle){
        const changedNode = this.wrapPerTitle[changedNodeTitle].node;
        const range = this.parser.getNodeSectionRange(changedNodeTitle);
        const { startLineNo, endLineNo } = range;

        let nodeContainsReferences = false;
        let nodeReferencesCleared = false;
        for (let i = startLineNo + 1; i <= endLineNo && i < lines.length; i++) {
            // Process each line and update the nodeContainsReferences flag
            this.handlePlainTextAndReferences(lines[i], changedNodeTitle, startLineNo, endLineNo, true);
            if (lines[i].includes(Tag.ref)) {
                nodeContainsReferences = true;
                nodeReferencesCleared = false;
            }
        }
        if (lines.length && startLineNo < endLineNo) {
            const textArea = TextArea.ofNode(changedNode);
            const text = this.wrapPerTitle[changedNodeTitle].plainText;
            TextArea.update.call(textArea, text);
        }

        // Clear references if no references are found and they haven't been cleared already
        if (!nodeContainsReferences && !nodeReferencesCleared) {
            this.handleRefTags([], changedNodeTitle);
            nodeReferencesCleared = true;
            Logger.debug("References cleared for node:", changedNodeTitle);
        }
    }

    handleNode(line, i, currentNodeTitle){
        const wrapPerLine = this.wrapPerLine;
        const wrapPerTitle = this.wrapPerTitle;
        currentNodeTitle = line.substr(Tag.node.length).trim();

        if (this.mode.restoring) {
            const savedNode = Node.byTitle(currentNodeTitle);
            if (savedNode) {
                const wrap = this.makeZetWrap(savedNode, currentNodeTitle);
                wrapPerLine[i] = wrapPerTitle[currentNodeTitle] = wrap;
                return currentNodeTitle;
            }

            Logger.info("No existing node found for title:", currentNodeTitle);
        }

        const wrap = wrapPerTitle[currentNodeTitle];
        if (!wrap || wrap.node.removed) {
            if (wrapPerLine[i] && !wrapPerLine[i].node.removed) {
                const wrap = wrapPerTitle[currentNodeTitle] = wrapPerLine[i];
                const title = wrap.title;
                if (wrapPerTitle[title] === wrap) delete wrapPerTitle[title];
                wrap.title = currentNodeTitle;
                wrap.live = true;
                wrap.node.view.titleInput.value = currentNodeTitle;
            } else {
                const node = (nodefromWindow) ? TextNode.create(currentNodeTitle)
                           : this.spawnNodeFromZettelkasten(currentNodeTitle);
                if (nodefromWindow) {
                    nodefromWindow = false;
                    if (followMouseFromWindow) {
                        node.followingMouse = 1;
                        followMouseFromWindow = false;
                    }
                }
                // The notes pane already reveals the new heading through
                // ui.scrollToTitle; this is the map's half of that. Not while
                // restoring, or opening a saved graph would ping every card in
                // it.
                if (!this.mode.restoring) node.view.flashAsNew();

                const wrap = this.makeZetWrap(node, currentNodeTitle);
                wrapPerLine[i] = wrap;
                wrapPerTitle[currentNodeTitle] = wrap;
            }
        } else {
            wrap.plainText = '';
            if (this.mode.full) wrap.node.textarea.value = wrap.plainText;
            const lineNum = wrap.lineNum;
            if (wrapPerLine[lineNum] === wrap) delete wrapPerLine[lineNum];
            wrap.live = true;
            wrap.lineNum = i;
            wrapPerLine[i] = wrap;
        }
        return currentNodeTitle;
    }

    makeZetWrap(node, title){
        const wrap = new NodeWrap(node, title);
        this.initZetWrap(wrap);
        return wrap;
    }

    initZetWrap(wrap){
        const node = wrap.node;
        On.input(node.view.titleInput, this.onTitleInput.bind(this, wrap));
        On.input(TextArea.ofNode(node), this.onNodeBodyInput.bind(this, wrap));
    }

    //Syncs node titles and Zettelkasten
    onTitleInput(wrap, e){
        const titleInput = e.currentTarget;
        if (e.target !== titleInput) return;

        let newName = titleInput.value.trim().replace(',', '');
        // If a count was previously added, attempt to remove it
        if (wrap.countAdded) {
            const updatedTitle = newName.replace(/\(\d+\)$/, '').trim();
            if (updatedTitle !== newName) {
                newName = updatedTitle;
                titleInput.value = newName;
                wrap.countAdded = false;
            }
        }
        const name = wrap.title;
        if (newName === name) return;

        const wrapPerTitle = this.wrapPerTitle;
        delete wrapPerTitle[name];
        const countAdded = wrap.countAdded = Boolean(wrapPerTitle[newName]);
        if (countAdded) {
            titleInput.value = newName = this.getUniqueNodeName(newName);
        }
        wrapPerTitle[newName] = wrap;
        wrap.title = newName;
        // Set cursor position to before the count if a count was added
        if (countAdded) {
            const cursorPosition = newName.indexOf('(');
            titleInput.setSelectionRange(cursorPosition, cursorPosition);
        }

        // Collect the relevant CodeMirror instances to update
        // Keyed by CodeMirror instance, so the same pane is only updated once.
        // The processor rides along from the same lookup that found the editor --
        // the rewrite mode belongs to the pane being written to, and used to be a
        // global that armed every other pane's processor as well.
        const instancesToUpdate = new Map();

        // Get the CodeMirror instance for the current node
        const currentNodeInstance = getZetNodeCMInstance(name);
        if (currentNodeInstance?.cm) {
            instancesToUpdate.set(currentNodeInstance.cm, currentNodeInstance.zettelkastenProcessor);
        }

        // Process the nodes connected by edges
        for (const edge of wrap.node.edges) {
            // Find the connected node that is not the current node
            const connectedNode = edge.pts.find(pt => pt !== wrap.node);

            if (connectedNode?.isTextNode) {
                const connectedInstance = getZetNodeCMInstance(connectedNode.getTitle());
                if (connectedInstance?.cm) {
                    instancesToUpdate.set(connectedInstance.cm, connectedInstance.zettelkastenProcessor);
                }
            }
        }

        // Update the collected CodeMirror instances
        const renameNodeInInstance = renameNode(name, newName);
        for (const [cm, processor] of instancesToUpdate) {
            const write = ()=>{
                cm.setValue(renameNodeInInstance(cm.getValue()));
                cm.refresh();
            };
            if (processor) processor.writeAs(ZettelkastenProcessor.Pass.rewrite, write);
            else write();
        }

        App.zetPanes.switchPane(currentNodeInstance.paneId);
        currentNodeInstance.ui.scrollToTitle(wrap.title);
    }

    //Syncs node text and Zettelkasten
    onNodeBodyInput(wrap, e){
        const textArea = e.currentTarget;
        if (e.target !== textArea) return;

        const body = textArea.value;
        const { startLineNo, endLineNo } = this.parser.getNodeSectionRange(wrap.title);
        const lines = this.noteInput.getValue().split('\n');

        const titleLine = lines[startLineNo] + '\n';
        const updatedContent = titleLine + body;

        // Replace the node's content using replaceRange
        const from = { ch: 0, line: startLineNo };
        const ch = (lines[endLineNo] || '').length;
        const to = { ch, line: Math.max(startLineNo, endLineNo) };

        this.noteInput.operation(() => {
            this.noteInput.replaceRange(updatedContent, from, to);
            this.parser.updateNodeTitleToLineMap();

            // Handle references
            const bodyLines = body.split('\n');
            bodyLines.forEach( (line, index)=>{
                if (!line.startsWith(Tag.ref)) return;

                const lineIndex = startLineNo + 1 + index;
                this.handleReferenceLine(line, wrap.title, bodyLines, false, lineIndex, lineIndex);
            });
        });
    }

    forEachReferenceInRange(startLine, endLine, lines, cb, ct){
        for (let i = startLine; i <= endLine; i++) {
            const res = this.forEachReferenceInLine(lines[i], cb, ct);
            if (res) return res;
        }
    }

    // Modified handleReferenceLine to use optional given range or generate one if not provided
    handleReferenceLine(line, currentNodeTitle, lines, shouldAppend = true,
                        startLineIndex = null, endLineIndex = null){
        const wrap = this.wrapPerTitle[currentNodeTitle];
        if (!wrap) return;

        // Check if the startLineIndex and endLineIndex are provided and within the bounds of the lines array
        if (startLineIndex === null || endLineIndex === null || startLineIndex < 0 || endLineIndex >= lines.length) {
            const range = this.parser.getNodeSectionRange(currentNodeTitle);
            startLineIndex = range.startLineNo + 1; // +1 to skip the title
            endLineIndex = range.endLineNo;
        }
        const allReferences = [];
        this.forEachReferenceInRange(startLineIndex, endLineIndex, lines, function(ref) {
            allReferences.push(ref);
        });
        this.handleRefTags(allReferences, currentNodeTitle);

        // Build plain text for node after tags
        if (shouldAppend) {
            const linesToAdd = [wrap.plainText, line].filter(Boolean);
            wrap.plainText = linesToAdd.join('\n');

            // By accessor, not by child index: the card's children are not fixed --
            // the link strip added one, which silently made this walk land on a chip
            // and write a node's body onto a span.
            //
            // And through TextArea.update rather than a bare `.value =`, which is the
            // difference between the model having the text and the reader seeing it.
            // A card's visible body is a highlighted overlay kept in step by the
            // change event that update dispatches; assigning `.value` fills the
            // textarea underneath and dispatches nothing, so the overlay stayed empty.
            //
            // Measured: a note created with the body "Finding the trace. [[Encoding]]"
            // came up showing its "Write here." placeholder while
            // `node.textarea.value` held the text. Nothing was lost, which made it
            // worse rather than better -- the note filled itself in a pass or two
            // later, after the reader had already concluded it had not saved and typed
            // it again. Every line of prose that carries a link took this path, which
            // in a knowledge graph is most of them.
            TextArea.update.call(TextArea.ofNode(wrap.node), wrap.plainText);
        }
    }

    forEachReferenceInLine(line, cb, ct){
        const refTag = Tag.ref;
        if (!line || !line.includes(refTag)) return;

        if (sortedBrackets.includes(refTag)) {
            return this.forEachBracketedReferenceInLine(refTag, line, cb, ct)
        }

        for (const ref of line.substr(refTag.length).split(',')) {
            const res = cb.call(ct, ref.trim());
            if (res) return res;
        }
    }

    handleRefTags(references, currentNodeTitle){
        const wrap = this.wrapPerTitle[currentNodeTitle];
        if (!wrap?.node) return;

        const thisNode = wrap.node;

        // Get all nodes from all CodeMirror instances
        const wrapPerTitle = getAllInternalZetNodeWraps();

        // Initialize set with UUIDs from current node references
        const uuidOfRef = (ref)=>Node.byTitle(ref)?.uuid ;
        const allReferenceUUIDs = new Set(references.map(uuidOfRef).filter(uuid => uuid));

        // Check if connected nodes contain a reference to the current node in any CodeMirror instance
        thisNode.forEachConnectedNode( (node)=>{
            if (this.sectionNames(node, currentNodeTitle)) allReferenceUUIDs.add(node.uuid);
        });

        // Process edges
        function hasUuidThis(pt){ return pt.uuid === this.valueOf() }
        function hasUuidNotThis(pt){ return pt.uuid !== this.valueOf() }
        const currentEdges = new Map(thisNode.edges.map(edge => {
            const otherNode = edge.pts.find(hasUuidNotThis, thisNode.uuid);
            return otherNode ? [otherNode.uuid, edge] : [null, edge];
        }));

        // Remove edges not found in reference UUIDs and ensure both nodes are text nodes
        currentEdges.forEach((edge, uuid) => {
            if (allReferenceUUIDs.has(uuid)) return;

            const otherNode = edge.pts.find(hasUuidThis, uuid);
            if (!thisNode.isTextNode || !otherNode?.isTextNode) return;

            // Kept unless the other Node's section is in a Pane and does not name this one.
            if (this.sectionNames(otherNode, currentNodeTitle) !== false) return;

            edge.remove();
            currentEdges.delete(uuid);
        });

        thisNode.edges = Array.from(currentEdges.values());

        // Add new edges for references. connectDistance pushes the edge onto both
        // of its nodes, so thisNode.edges grows from the call itself -- pushing it
        // again here listed every new edge on this node twice.
        let unresolved = false;
        const named = new Set();
        references.forEach(reference => {
            const target = wrapPerTitle[reference]?.node;
            if (!target?.uuid) {
                unresolved = true;
                return;
            }
            named.add(target.uuid);
            if (currentEdges.has(target.uuid)) return;

            currentEdges.set(target.uuid, connectDistance(thisNode, target));
        });

        // Which way each Edge to another note points (#51). `[[X]]` written in a note means
        // this note points at X, so the arrow points at the Node a Ref names, and between
        // two text Nodes the Refs decide the direction as they decide the Edge: named one
        // way, it points that way; named both ways, it points neither. Derived on every
        // pass, not set once: the parser used to record `start` as the note holding the
        // Ref, and `start` is where the arrowhead is drawn (see `Edge.toggleDirection`), so
        // every Ref drew its arrow pointing back at its own note -- and a direction set
        // that way stayed wrong for good. A click cycles the direction by rewriting the
        // Refs, so a reader's choice is what the Refs say, and this reads it back.
        //
        // An Edge to any other Node keeps what the reader set with a click. An AI Node
        // reads as context the Edges its arrows leave by, so a Ref drawn as an arrow into it
        // would have taken the note out of what it reads.
        if (thisNode.isTextNode) currentEdges.forEach( (edge, uuid)=>{
            const other = edge?.pts?.find(hasUuidThis, uuid);
            const direction = edge?.directionality;
            if (!other?.isTextNode || !direction) return;

            const outward = named.has(uuid);
            const inward = (this.sectionNames(other, currentNodeTitle) === true);
            if (!outward && !inward) return;

            const one = (outward !== inward);
            direction.start = !one ? null : outward ? other : thisNode;
            direction.end = !one ? null : outward ? thisNode : other;
        });
        if (unresolved) this.deferRefTags(references, currentNodeTitle);
    }

    // Whether `node`'s section, in whichever Pane holds it, has a Ref to `title`; null
    // when no Pane holds a section for it, which is not the same as not naming it.
    sectionNames(node, title){
        const nodeTitle = node.getTitle();
        const info = getZetNodeCMInstance(nodeTitle);
        if (!info) return null;

        const { startLineNo, endLineNo } = info.parser.getNodeSectionRange(nodeTitle);
        const lines = info.cm.getValue().split('\n');
        const isTitle = (ref)=>(ref === title) ;
        return Boolean(this.forEachReferenceInRange(startLineNo + 1, endLineNo, lines, isTitle));
    }

    // A ref can name a node whose section appears further down the text. The pass
    // walks lines top-down and resolves a ref against the nodes it has made so
    // far, so a ref pointing forward found nothing and made no edge -- silently,
    // and for every ref in the section but the ones pointing backwards. Queue the
    // section instead and retry it after the walk.
    //
    // The whole reference set is queued, not just the part that did not resolve:
    // handleRefTags also removes the edges absent from the set it is given, so a
    // retry carrying a subset would delete the edges the walk had just made.
    deferRefTags(references, title){
        this.deferredRefs?.set(title, references);
    }
    // Retry each queued section now that every title in the pass exists. The queue
    // is null for the duration, so a ref that still resolves to nothing names a
    // node that is genuinely absent, and is dropped rather than queued again.
    drainDeferredRefs(){
        const deferred = this.deferredRefs;
        this.deferredRefs = null;
        deferred?.forEach(this.handleRefTags, this);
    }

    forEachBracketedReferenceInLine(openingBracket, line, cb, ct){
        const closingBracket = bracketsMap[openingBracket];
        if (!line.includes(closingBracket)) return;

        const buffer = [];
        let insideBrackets = false;
        for (let i = 0; i < line.length; i++) {
            if (!insideBrackets) {
                if (line.startsWith(openingBracket, i)) {
                    insideBrackets = true;
                    buffer.length = 0;
                    i += openingBracket.length - 1;  // Skip the bracket characters
                }
            } else if (line.startsWith(closingBracket, i)) {
                insideBrackets = false;
                if (buffer.length > 0) {
                    const res = cb.call(ct, buffer.join('').trim());
                    if (res) return res;
                }
                i += closingBracket.length - 1;  // Skip the bracket characters
            } else {
                buffer.push(line[i]);
            }
        }
    }

    handleLineWithoutTags(wrap, line, partial){
        wrap.plainText += (wrap.plainText ? '\n' : '') + line;
        if (partial) return;

        const textArea = TextArea.ofNode(wrap.node);

        // getDebouncedTextareaUpdate(textArea)(wrap.plainText);
        Promise.delay(20).then(TextArea.update.bind(textArea, wrap.plainText));
    }

    deleteInactiveNodesFromDict(dict){
        const dels = [];
        for (const k in dict) {
            if (dict[k].live) continue;

            dict[k].node.remove();
            dels.push(k);
        }
        for (const k of dels) delete dict[k];
    }

    handleLlmPromptLine(line, currentNodeTitle){
        if (line.startsWith(Tag.node) || line.startsWith(Tag.ref)) return '';

        const wrap = this.wrapPerTitle[currentNodeTitle];
        const textArea = TextArea.ofNode(wrap.node);
        textArea.value += (textArea.value ? '\n' : '') + line.trim();
        return currentNodeTitle;
    }

    handleLLM(line, i, currentNodeTitle){
        const wrapPerLine = this.wrapPerLine;
        const wrapPerTitle = this.wrapPerTitle;
        // LLM_TAG, not a literal: the tag was "LLM:" once and the length stayed
        // behind, so `AI:Title` written without a space lost its first character.
        const nodeTitle = line.substr(LLM_TAG.length).trim() || "Untitled";
        currentNodeTitle = nodeTitle;

        let wrap = wrapPerTitle[nodeTitle];

        // Restoring binds to the AI Node the saved markup already rebuilt, as
        // `handleNode` does for text Nodes. With no such branch this made a second AI
        // Node on every reload, and its Edges with it -- measured, one AI Node and one
        // Edge became two of each after one reload and three after two (#49). Only an
        // AI Node will do: a text Node may carry the same Title.
        if (this.mode.restoring && (!wrap || wrap.node.removed)) {
            const saved = Graph.filterNodes( (node)=>node.isLLM && !node.removed
                && node.getTitle()?.toLowerCase() === nodeTitle.toLowerCase() )[0];
            if (saved) {
                wrap = new NodeWrap(saved, nodeTitle, i);
                wrapPerLine[i] = wrapPerTitle[nodeTitle] = wrap;
                this.initLlmWrap(wrap);
            }
        }

        if (!wrap || wrap.node.removed) {
            if (wrapPerLine[i] && !wrapPerLine[i].node.removed) {
                wrap = wrapPerTitle[nodeTitle] = wrapPerLine[i];
                delete wrapPerTitle[wrap.title];
                wrap.title = nodeTitle;
                wrap.live = true;
                wrap.node.view.titleInput.value = nodeTitle;
            } else {
                const sx = (Math.random() - 0.5) * 1.8;
                const sy = (Math.random() - 0.5) * 1.8;
                const node = createLlmNode(nodeTitle, sx, sy);
                wrap = new NodeWrap(node, nodeTitle, i);
                wrapPerLine[i] = wrapPerTitle[nodeTitle] = wrap;
                this.initLlmWrap(wrap);
            }
        } else {
            wrap.live = true;
            wrap.lineNum = i;
            // delete wrapPerLine[wrap.lineNum]; // compare to handleNode
            wrapPerLine[i] = wrap;
        }
        currentNodeTitle = nodeTitle;
        TextArea.ofNode(wrap.node).value = '';
        return currentNodeTitle;
    }

    initLlmWrap(wrap){
        On.input(wrap.node.view.titleInput, (e)=>{
            const oldName = wrap.title;
            let newName = e.target.value.trim().replace(',', '');
            if (newName === oldName) return;

            const wrapPerTitle = this.wrapPerTitle;
            delete wrapPerTitle[oldName];

            if (wrapPerTitle[newName]) {
                newName = e.target.value = this.getUniqueNodeTitle(newName);
            }

            wrapPerTitle[newName] = wrap;
            wrap.title = newName;

            const noteInput = this.noteInput;
            const f = renameNode(oldName, newName);
            noteInput.setValue(f(noteInput.getValue()));
            noteInput.refresh();
        });
    }

    getUniqueNodeTitle(baseTitle, removeExistingCount = false){
        let newName = baseTitle.trim().replace(',', '');

        if (removeExistingCount) {
            newName = newName.replace(/\(\d+\)$/, '').trim();
        }

        return (!this.wrapPerTitle[newName]) ? newName
             : this.getUniqueNodeName(newName);
    }

    getUniqueNodeName(name){
        const arr = [name, '(', 2, ')'];
        const wrapPerTitle = this.wrapPerTitle;
        while (wrapPerTitle[arr.join('')]) arr[2] += 1;
        return arr.join('');
    }
}
