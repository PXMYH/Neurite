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

// The Title line that is the Node's -- the first with the Title, in its own Pane -- and every
// Ref to it. `heading` is false for another Pane, where a Title line with the name is a taken
// copy (#64): renaming every one of them rewrote lines the reader had not touched.
//
// `lineTag` is the Title line's tag: `AI:` for an AI Node, whose rename on its card never reached
// its line, so the next pass named the Node back and built it again at every keystroke.
function renameNode(from, to, heading = true, lineTag = Tag.node) {
    //(\n|^)(((#node:)[\t ]*from[\t ]*)|((#ref:)([^,\n]+,)*[\t ]*from[\t ]*(,[^,\n]+)*))(?=(\n|$))
    //$1$4$6$7 to$8$9
    const fe = RegExp.escape(from);
    const nodeRE = '(' + RegExp.escape(lineTag) + ")[\\t ]*" + fe + "[\\t ]*";
    const refRE = '(' + RegExp.escape(Tag.ref) + ")([^,\\n]+,)*[\\t ]*" + fe + "[\\t ]*(,[^,\\n]+)*";
    const tag = "((" + nodeRE + ")|(" + refRE + "))";
    const re = new RegExp("(\n|^)" + tag + "(?=(\n|$))", "g");
    return (s) => {
        let headings = (heading ? 1 : 0);
        const replacer = (match, p1, p2, p3, p4, p5, p6, p7, p8) => {
            if (p4 && headings-- <= 0) return match;
            return p1 + (p4 ? p4 + ' ' : '') + (p6 ? p6 + ' ' : '') + (p7 || '') + to + (p8 || '');
        };
        return replaceInBrackets(s.replace(re, replacer), from, to);
    };
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
        const {start, end} = this.changedSpan(lines);

        const titles = new Set();
        const titleOf = (line)=>(line.startsWith(Tag.node) ? line.substr(Tag.node.length).trim() : null) ;
        // The note the first changed line is in -- and when that line is a Title line, the
        // note above it as well, which the new Title line just cut short. It stopped at the
        // new Title: typing "##" under a note left the "#" of the first keystroke on its
        // card for good.
        for (let i = Math.min(start, lines.length - 1); i >= 0; i--) {
            // A change inside an AI section is no note's; handleLlmPromptLine has it.
            if (lines[i].startsWith(LLM_TAG)) break;

            const title = titleOf(lines[i]);
            if (title === null) continue;

            titles.add(title);
            if (i < start) break;
        }
        for (let i = start; i < end; i++) {
            const title = titleOf(lines[i]);
            if (title !== null) titles.add(title);
        }
        return titles;
    }

    // What an edit changed: the lines between the ones it left alone at either end, as
    // [start, end) in the new text and [start, prevEnd) in the old.
    changedSpan(lines){
        const prev = this.prevNoteInputLines;
        let start = 0;
        while (start < lines.length && start < prev.length && lines[start] === prev[start]) start++;
        let end = lines.length, prevEnd = prev.length;
        while (end > start && prevEnd > start && lines[end - 1] === prev[prevEnd - 1]) { end--; prevEnd--; }
        return {start, end, prevEnd};
    }

    // Where each of this Pane's Titles is held before the walk decides anything (#64). A
    // Node keeps its Title line: where the edit left the line alone, the line is where it
    // was, give or take the lines the edit added or took above it; where the reader is
    // typing on the line itself, the Node keeps both its Title and the one it had when the
    // typing began (`typedFrom`). Any other line with one of those Titles is taken while it
    // lasts. By reading order alone, a copy typed above a note took the note over, and
    // "## Alpha" backspaced to "## Alph" and typed back lost the note to a copy.
    reserveHeld(lines){
        const {start, end, prevEnd} = this.changedSpan(lines);
        const delta = end - prevEnd;
        this.typing = {start, end};
        this.reserved = new Map();
        const titleAt = (i)=>{
            const line = lines[i];
            if (line?.startsWith(Tag.node)) return line.substr(Tag.node.length).trim();
            if (line?.startsWith(LLM_TAG)) return line.substr(LLM_TAG.length).trim() || "Untitled";
            return null;
        };
        this.forEachNodeWrap( (wrap)=>{
            const old = wrap.lineNum;
            if (wrap.node.removed || typeof old !== 'number') return;

            let line = (old < start) ? old : (old >= prevEnd) ? old + delta : (old < end ? old : null);
            const title = (line === null ? null : titleAt(line));
            const typed = (title !== null && line >= start && line < end);
            if (!typed) delete wrap.typedFrom;
            if (title === null || (!typed && title.toLowerCase() !== wrap.title.toLowerCase())) return;

            // An edit can be read two ways when what it added begins with a line the text
            // already had: a copy of "## Alpha" pasted above the note reads, line by line,
            // as the note's body replaced. The section whose body is the Node's is its own.
            const body = (TextArea.ofNode(wrap.node)?.value ?? '').trim();
            if (!typed && this.sectionBody(line) !== body) {
                const own = lines.findIndex( (text, i)=>(i !== line
                    && titleAt(i)?.toLowerCase() === wrap.title.toLowerCase() && this.sectionBody(i) === body) );
                if (own !== -1) line = own;
            }

            this.reserved.set(wrap.title.toLowerCase(), line);
            if (wrap.typedFrom) this.reserved.set(wrap.typedFrom.toLowerCase(), line);
        });
    }
    // The line is under the reader's edit, not moved there by lines added or taken above.
    isTyped(lineNo){ return Boolean(this.typing && lineNo >= this.typing.start && lineNo < this.typing.end) }

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

    // What the section under a taken Title line is attributed to: nothing (see `takes`).
    static takenTitle = Symbol('a taken Title');
    // The kind of Node a Title line is: `##` a text Node's, `AI:` an AI Node's. Here and not
    // on `Node`: this file loads before `class Node` is declared.
    static isText = (node)=>Boolean(node.isTextNode);
    static isAi = (node)=>Boolean(node.isLLM);
    // A Title line renamed as it is typed keeps the Title it had when the typing began, until
    // the typing leaves the line or comes back to that Title (`reserveHeld`).
    static typedFrom(wrap, from, typing){
        if (!typing) return delete wrap.typedFrom;

        wrap.typedFrom ??= from;
        if (wrap.typedFrom.toLowerCase() === wrap.title.toLowerCase()) delete wrap.typedFrom;
    }

    // The Titles this Pane holds, in lower case, and whether it holds one: a section of it is
    // one of this Pane's Nodes. `exceptWrap` is a Node being renamed, which does not count.
    // A Title a Node is being typed away from still counts as its own (`reserveHeld`).
    heldTitles(){
        const held = new Set();
        this.forEachNodeWrap( (wrap)=>{
            held.add(wrap.title.toLowerCase());
            if (wrap.typedFrom) held.add(wrap.typedFrom.toLowerCase());
        });
        return held;
    }
    holdsTitle(key, exceptWrap = null){
        for (const title in this.wrapPerTitle) {
            const wrap = this.wrapPerTitle[title];
            if (wrap === exceptWrap || wrap.node.removed) continue;
            if (title.toLowerCase() === key || wrap.typedFrom?.toLowerCase() === key) return true;
        }
        return false;
    }

    processInput = ()=>{
        const mode = this.mode;
        const heldBefore = this.heldTitles();

        this.forEachNodeWrap(this.initializeNodeWrap, this);
        this.noteInputLines = this.noteInput.getValue().split('\n');
        let currentNodeTitle = '';
        this.deferredRefs = new Map();
        this.claimed = new Set();
        this.taken = [];
        this.renames = [];
        this.bodies = new Set();
        this.refsHandled = new Set();
        this.reserveHeld(this.noteInputLines);

        this.noteInputLines.forEach((line, index) => {
            currentNodeTitle = this.processLine(line, index, currentNodeTitle)
        });

        // Where each of this Pane's Nodes is, for the lookups by Title that run between passes
        // (`ZettelkastenParser.getNodeTitleLine`): a taken copy above a note is not the note.
        const held = new Map();
        this.forEachNodeWrap( (wrap)=>{ if (typeof wrap.lineNum === 'number') held.set(wrap.title.toLowerCase(), wrap.lineNum) } );
        this.parser.heldLines = held;

        if (!mode.full) this.processChangedNodes(this.noteInputLines);

        this.drainDeferredRefs();
        this.refsHandled = null;
        this.writeBodies();

        this.deleteInactiveNodesFromDict(this.wrapPerTitle);
        this.deleteInactiveNodesFromDict(this.wrapPerLine);

        this.prevNoteInputLines = this.noteInputLines;
        this.noteInputLines = [];

        this.markTaken();
        this.scheduleRelax();

        const heldAfter = this.heldTitles();
        const freed = [...heldBefore].filter( (key)=>!heldAfter.has(key) );
        if (freed.length) ZettelkastenProcessor.retake(freed, this);
    }

    // Whether a Title line is taken: an earlier line in this pass, or another Pane, holds its
    // Title, in any case (#64). A taken line makes no Node and its section is no Node's -- it
    // stays text, marked -- until the Title is free (`retake`).
    //
    // While a reader types on the line, the Node already on it waits there under its last
    // free Title: typing "## Alpha 2" goes through "## Alpha", and the Node was deleted on
    // the way and made again somewhere else. An edit anywhere else, or a full pass (every
    // save runs one), lets it go, so a Title left taken leaves no card behind.
    //
    // A Saved Graph from before this can hold one Title twice, with a Node for each. On load
    // the later line is renamed, so its Node keeps its place (`applyRenames`), and the
    // rename is reported rather than made silently.
    takes(title, lineNo, prefix, isType){
        const key = title.toLowerCase();
        const kept = this.reserved?.get(key);
        // Saved as taken, its holder in a Pane not restored yet (`ZetPanes.restorePane`).
        const savedTaken = Boolean(this.mode.restoring && this.takenOnSave?.has(key));
        const holder = ((kept !== undefined && kept !== lineNo) || this.claimed.has(key)) ? this
                     : (paneHoldingTitle(title, this)?.processor ?? (savedTaken ? null : undefined));
        if (holder === undefined) {
            this.claimed.add(key);
            return false;
        }

        const saved = this.mode.restoring && !savedTaken && this.unboundNode(title, lineNo, isType);
        if (saved) this.renames.push({lineNo, prefix, title, node: saved});
        else this.taken.push({title, lineNo, holder});

        const waiting = this.wrapPerLine[lineNo];
        if (!this.mode.full && this.isTyped(lineNo) && waiting && !waiting.node.removed) waiting.live = true;
        return true;
    }

    // A Node with this Title that no Pane's section holds yet, for a restoring pass to bind:
    // of two that share the Title, the one whose body is this section's. `Node.byTitle` gave
    // the first match, held or not, so two Panes with one Title bound the same Node.
    unboundNode(title, lineNo, isType){
        const key = title.toLowerCase();
        const held = new Set();
        const hold = (wrap)=>held.add(wrap.node) ;
        for (const pane of window.zetPaneList) pane.processor.forEachNodeWrap(hold);
        this.forEachNodeWrap(hold);

        const found = Graph.filterNodes( (node)=>(isType(node) && !node.removed && !held.has(node)
                                                  && node.getTitle()?.toLowerCase() === key) );
        if (found.length < 2) return found[0] ?? null;

        const body = this.sectionBody(lineNo);
        return found.find( (node)=>(TextArea.ofNode(node)?.value?.trim() === body) ) ?? found[0];
    }
    sectionBody(lineNo){
        const lines = this.noteInputLines;
        let end = lineNo + 1;
        while (end < lines.length && !lines[end].startsWith(Tag.node) && !lines[end].startsWith(LLM_TAG)) end += 1;
        return lines.slice(lineNo + 1, end).join('\n').trim();
    }

    // Each body the pass rebuilt, written once, now, when the walk is done. A full pass
    // cleared every body at its Title line and wrote it back a line at a time, each 20ms
    // later -- one card overlay rebuilt per line of text, and a save, which runs a full
    // pass and then reads the cards at once, stored every body empty.
    writeBodies(){
        for (const wrap of this.bodies) {
            if (!wrap.node.removed) TextArea.update.call(TextArea.ofNode(wrap.node), wrap.plainText);
        }
        this.bodies = null;
    }

    // Each taken Title line gets a class the Pane styles, and the Notes panel is told, so it
    // can say which Archive holds the Title. Line classes, not marks: every change clears
    // the marks (`highlightNodeTitles`).
    markTaken(){
        const cm = this.noteInput;
        if (!cm.addLineClass) return;

        for (const handle of this.takenHandles ?? []) cm.removeLineClass(handle, 'wrap', 'zet-title-taken');
        this.takenHandles = this.taken.map( (t)=>cm.addLineClass(t.lineNo, 'wrap', 'zet-title-taken') );
        App.zetPanes?.onTaken?.(this);
    }

    // A Title a pass let go -- its section deleted, or renamed -- is free, and a Pane that
    // marked a line with it as taken makes the Node now, not at its next edit or save.
    static retake(freed, from){
        const keys = new Set(freed.map( (title)=>String(title).toLowerCase() ));
        for (const pane of window.zetPaneList) {
            const processor = pane.processor;
            if (processor === from || !processor.taken?.some( (t)=>keys.has(t.title.toLowerCase()) )) continue;

            processor.processAs(ZettelkastenProcessor.Pass.rewrite);
        }
    }

    // After a restoring pass: the lines `takes` found holding a Title a saved Node elsewhere
    // already has, renamed to the lowest free "Title (n)" with the Node, in one more
    // restoring pass. Returns what it renamed, for the notice.
    applyRenames(){
        const renames = this.renames ?? [];
        if (!renames.length) return [];

        const given = new Set();
        const done = renames.map( ({lineNo, prefix, title, node})=>{
            const to = getUniqueNodeTitle(title, null, given);
            given.add(to.toLowerCase());
            node.view.titleInput.value = to;
            return {lineNo, prefix, from: title, to};
        });
        // The Refs in this Pane follow the rename: they meant this Pane's note, and left as
        // they were they drew their Edges to the other Archive's instead.
        let lines = this.noteInput.getValue().split('\n');
        for (const {lineNo, prefix, from, to} of done) {
            lines = renameNode(from, to, false)(lines.join('\n')).split('\n');
            lines[lineNo] = prefix + ' ' + to;
        }
        const text = lines.join('\n');
        this.writeAs(ZettelkastenProcessor.Pass.restore, ()=>this.noteInput.setValue(text));
        return done;
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

    // A Node's own section: from its Title line -- the one the pass bound it to -- to the next
    // Title line. By its Title alone the first section with it was found, which is a taken
    // copy when one sits above the note (#64), and the note took the copy's body and Refs.
    sectionOf(wrap, lines){
        const startLineNo = wrap.lineNum;
        if (typeof startLineNo !== 'number' || lines[startLineNo] === undefined) {
            return this.parser.getNodeSectionRange(wrap.title);
        }
        let endLineNo = startLineNo;
        while (endLineNo + 1 < lines.length && !lines[endLineNo + 1].startsWith(Tag.node)
               && !lines[endLineNo + 1].startsWith(LLM_TAG)) endLineNo += 1;
        return {startLineNo, endLineNo};
    }

    processChangedNode(lines, changedNodeTitle){
        const { startLineNo, endLineNo } = this.sectionOf(this.wrapPerTitle[changedNodeTitle], lines);

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
        if (lines.length && startLineNo < endLineNo) this.bodies.add(this.wrapPerTitle[changedNodeTitle]);

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
        if (this.takes(currentNodeTitle, i, Tag.node, ZettelkastenProcessor.isText)) return ZettelkastenProcessor.takenTitle;

        if (this.mode.restoring) {
            const savedNode = this.unboundNode(currentNodeTitle, i, ZettelkastenProcessor.isText);
            if (savedNode) {
                const wrap = this.makeZetWrap(savedNode, currentNodeTitle);
                wrap.lineNum = i;
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
                wrap.lineNum = i;
                wrap.node.view.titleInput.value = currentNodeTitle;
                ZettelkastenProcessor.typedFrom(wrap, title, this.isTyped(i) && !this.mode.full);
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
                wrap.lineNum = i;
                wrapPerLine[i] = wrap;
                wrapPerTitle[currentNodeTitle] = wrap;
            }
        } else {
            wrap.plainText = '';
            if (this.mode.full) this.bodies.add(wrap);
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

        let typed = titleInput.value;
        // If a count was previously added, attempt to remove it -- the " (2)" it added, and no
        // more: a space the reader typed before it is theirs.
        if (wrap.countAdded) {
            const stripped = typed.replace(/ \(\d+\)$/, '');
            if (stripped !== typed) {
                typed = titleInput.value = stripped;
                wrap.countAdded = false;
            }
        }
        let newName = typed.trim().replace(',', '');
        const name = wrap.title;
        if (newName === name) return;

        const wrapPerTitle = this.wrapPerTitle;
        // Taken in any Pane, in any case (#64); it asked this Pane only, and exactly.
        const unique = getUniqueNodeTitle(newName, wrap);
        // A space typed after a Title that is taken is the next word on its way: the count
        // went in at once, and the space with it -- "rust ownership" became "rustownership"
        // when another Archive had a "Rust".
        if (unique !== newName && /\s$/.test(typed)) return;

        delete wrapPerTitle[name];
        const countAdded = wrap.countAdded = (unique !== newName);
        if (countAdded) {
            titleInput.value = newName = unique;
        }
        wrapPerTitle[newName] = wrap;
        wrap.title = newName;
        // The caret goes where the Title ends, before " (2)", so typing goes on with the word.
        if (countAdded) {
            const cursorPosition = newName.lastIndexOf(' (');
            titleInput.setSelectionRange(cursorPosition, cursorPosition);
        }

        // Collect the relevant CodeMirror instances to update
        // Keyed by CodeMirror instance, so the same pane is only updated once.
        // The processor rides along from the same lookup that found the editor --
        // the rewrite mode belongs to the pane being written to, and used to be a
        // global that armed every other pane's processor as well.
        const instancesToUpdate = new Map();

        // This Node's own Pane is this processor's. Looked up by the old Title it was found
        // after that Title had been let go, so another Pane with a taken line of it came first.
        const currentNodeInstance = window.zetPaneList.find( (pane)=>(pane.processor === this) );
        if (currentNodeInstance) instancesToUpdate.set(currentNodeInstance.cm, this);

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
        const renameHere = renameNode(name, newName), renameRefs = renameNode(name, newName, false);
        for (const [cm, processor] of instancesToUpdate) {
            const renameNodeInInstance = (processor === this ? renameHere : renameRefs);
            const write = ()=>{
                cm.setValue(renameNodeInInstance(cm.getValue()));
                cm.refresh();
            };
            if (processor) processor.writeAs(ZettelkastenProcessor.Pass.rewrite, write);
            else write();
        }

        ZettelkastenProcessor.retake([name], null);
        if (!currentNodeInstance) return;

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
            const range = this.sectionOf(wrap, lines);
            startLineIndex = range.startLineNo + 1; // +1 to skip the title
            endLineIndex = range.endLineNo;
        }
        // The Refs of the whole section, reconciled once a pass for each note: every Ref
        // line of a note did it again, with the same result -- 40 reconciliations for one
        // keystroke in a note with 40 Ref lines. A Ref to a note further down is retried
        // after the walk (`drainDeferredRefs`), whichever line found it.
        if (!this.refsHandled?.has(wrap)) {
            this.refsHandled?.add(wrap);
            const allReferences = [];
            this.forEachReferenceInRange(startLineIndex, endLineIndex, lines, function(ref) {
                allReferences.push(ref);
            });
            this.handleRefTags(allReferences, currentNodeTitle);
        }

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
            // in a knowledge graph is most of them. Inside a pass it is written once, at
            // the end (`writeBodies`).
            if (this.bodies) this.bodies.add(wrap);
            else TextArea.update.call(TextArea.ofNode(wrap.node), wrap.plainText);
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

        // Initialize set with UUIDs from current node references. A Ref to the note's own
        // Title is no Edge: an Edge joins two Nodes, and one from a note to itself -- two
        // notes of the AI bundle name themselves -- made the next pass throw below, on an
        // Edge with no other end, at every keystroke in that Pane.
        const uuidOfRef = (ref)=>Node.byTitle(ref)?.uuid ;
        const allReferenceUUIDs = new Set(references.map(uuidOfRef).filter(uuid => uuid && uuid !== thisNode.uuid));

        // Whether each connected note names this one, asked once per note for the whole pass
        // and read against one copy of each Pane's lines. The three loops below asked again
        // each, and each ask split the whole Pane: measured, one keystroke in a note with 40
        // links made 3200 asks for 40 answers, and took 26 ms where it had taken 16.
        const answers = new Map();
        const linesOf = new Map();
        const names = (node)=>{
            if (!answers.has(node.uuid)) answers.set(node.uuid, this.sectionNames(node, currentNodeTitle, linesOf));
            return answers.get(node.uuid);
        };

        // Check if connected nodes contain a reference to the current node in any CodeMirror instance
        thisNode.forEachConnectedNode( (node)=>{
            if (names(node)) allReferenceUUIDs.add(node.uuid);
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
            // No other end: an Edge from this note to itself, which a Saved Graph from before
            // can hold. It goes; anything else without one is left alone.
            if (uuid === null) {
                if (edge.pts.every( (pt)=>(pt === thisNode) )) edge.remove();
                currentEdges.delete(uuid);
                return;
            }
            if (allReferenceUUIDs.has(uuid)) return;

            const otherNode = edge.pts.find(hasUuidThis, uuid);
            if (!thisNode.isTextNode || !otherNode?.isTextNode) return;

            // Kept unless the other Node's section is in a Pane and does not name this one.
            if (names(otherNode) !== false) return;

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
            if (target === thisNode) return;

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
            const inward = (names(other) === true);
            if (!outward && !inward) return;

            const one = (outward !== inward);
            direction.start = !one ? null : outward ? other : thisNode;
            direction.end = !one ? null : outward ? thisNode : other;
        });
        if (unresolved) this.deferRefTags(references, currentNodeTitle);
    }

    // Whether `node`'s section, in whichever Pane holds it, has a Ref to `title`; null
    // when no Pane holds a section for it, which is not the same as not naming it.
    // `linesOf` keeps each Pane's lines for a caller that asks many times in one pass.
    sectionNames(node, title, linesOf){
        const nodeTitle = node.getTitle();
        const info = getZetNodeCMInstance(nodeTitle);
        if (!info) return null;

        const { startLineNo, endLineNo } = info.parser.getNodeSectionRange(nodeTitle);
        let lines = linesOf?.get(info.cm);
        if (!lines) {
            lines = info.cm.getValue().split('\n');
            linesOf?.set(info.cm, lines);
        }
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
        if (!partial) this.bodies?.add(wrap);
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
        // One namespace for both kinds (#64): a Ref resolves an AI Node's Title too.
        if (this.takes(nodeTitle, i, LLM_TAG, ZettelkastenProcessor.isAi)) return ZettelkastenProcessor.takenTitle;

        let wrap = wrapPerTitle[nodeTitle];

        // Restoring binds to the AI Node the saved markup already rebuilt, as
        // `handleNode` does for text Nodes. With no such branch this made a second AI
        // Node on every reload, and its Edges with it -- measured, one AI Node and one
        // Edge became two of each after one reload and three after two (#49). Only an
        // AI Node will do: a text Node may carry the same Title.
        if (this.mode.restoring && (!wrap || wrap.node.removed)) {
            const saved = this.unboundNode(nodeTitle, i, ZettelkastenProcessor.isAi);
            if (saved) {
                wrap = new NodeWrap(saved, nodeTitle, i);
                wrapPerLine[i] = wrapPerTitle[nodeTitle] = wrap;
                this.initLlmWrap(wrap);
            }
        }

        if (!wrap || wrap.node.removed) {
            if (wrapPerLine[i] && !wrapPerLine[i].node.removed) {
                wrap = wrapPerTitle[nodeTitle] = wrapPerLine[i];
                const title = wrap.title;
                if (wrapPerTitle[title] === wrap) delete wrapPerTitle[title];
                wrap.title = nodeTitle;
                wrap.live = true;
                wrap.lineNum = i;
                wrap.node.view.titleInput.value = nodeTitle;
                ZettelkastenProcessor.typedFrom(wrap, title, this.isTyped(i) && !this.mode.full);
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

            // Held by any Pane, in any case (#64), as for a note.
            const unique = getUniqueNodeTitle(newName, wrap);
            if (unique !== newName) newName = e.target.value = unique;

            wrapPerTitle[newName] = wrap;
            wrap.title = newName;

            const noteInput = this.noteInput;
            const f = renameNode(oldName, newName, true, LLM_TAG);
            this.writeAs(ZettelkastenProcessor.Pass.rewrite, ()=>noteInput.setValue(f(noteInput.getValue())));
            noteInput.refresh();
        });
    }
}
