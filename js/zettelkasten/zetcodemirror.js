function getAllInternalZetNodeWraps() {
    const wrapPerTitle = {};
    window.zetPaneList.forEach(pane => {
        Object.assign(wrapPerTitle, pane.processor.wrapPerTitle);
    });
    return wrapPerTitle;
}

// Every Pane's Title lines, for the highlighters. Not the register of which Titles are
// taken: that is the Panes' own (`paneHoldingTitle`).
const nodeTitles = new Set();

// The Pane whose section a Title is, in any case and across every Pane (#64). A Title
// names one Node in the whole Graph (CONTEXT.md, **Title**), so a second section with it,
// in another Archive or further down the same one, makes no Node: the pass marks it as
// taken. `except` leaves out the Pane asking, which checks its own pass itself.
function paneHoldingTitle(title, except = null){
    const key = title.toLowerCase();
    return window.zetPaneList.find( (pane)=>(pane.processor !== except && pane.processor.holdsTitle(key)) ) ?? null;
}
// A Title no Pane holds: the base, or the base with the lowest free count after it. It
// asked `nodeTitles`, which matched case exactly and forgot a Title one Pane dropped while
// another still held it. `exceptWrap` is a Node being renamed, which does not block itself;
// `given` holds lower-case Titles handed out in the same batch and not yet written.
function getUniqueNodeTitle(baseTitle, exceptWrap = null, given = null){
    const held = (title)=>(given?.has(title.toLowerCase())
        || window.zetPaneList.some( (pane)=>pane.processor.holdsTitle(title.toLowerCase(), exceptWrap) ));
    if (!held(baseTitle)) return baseTitle;

    let count = 2;
    while (held(`${baseTitle} (${count})`)) count += 1;
    return `${baseTitle} (${count})`;
}

RegExp.forNodeTitle = function(tag){
    return new RegExp(`^${RegExp.escape(tag)}\\s*(.*)$`);
}

class ZettelkastenParser {
    static regexpNodeTitle = RegExp.forNodeTitle("##");
    constructor(codeMirrorInstance) {
        this.cm = codeMirrorInstance;
        this.nodeTitleToLineMap = new Map();
        this.internalParserInstanceTitles = new Set();
        this.initializeParser();
    }

    initializeParser() {
        this.cm.on('change', () => {
            this.updateNodeTitleToLineMap();
            this.identifyNodeTitles();
            this.removeEmptyPrompts();
        });
    }

    removeEmptyPrompts() {
        const promptStart = PROMPT_IDENTIFIER;
        const promptEnd = PROMPT_END;

        const emptyPromptRegex = new RegExp(
            promptStart + "\\s*" + promptEnd, "g"
        );

        const text = this.cm.getValue();
        const newText = text.replace(emptyPromptRegex, "");

        if (newText !== text) {
            this.cm.setValue(newText);
        }
    }

    identifyNodeTitles() {
        const newTitles = new Set();
        this.cm.eachLine((line) => {
            const match = line.text.match(ZettelkastenParser.regexpNodeTitle);
            if (!match) return;

            const title = match[1].trim();
            newTitles.add(title.endsWith(',') ? title.slice(0, -1) : title);
        });

        this.updateGlobalTitles(newTitles);
    }

    // The union of every Pane's Title lines. It was kept by difference, one Pane at a time,
    // so a Title one Pane dropped left the set while another Pane still wrote it, and its
    // highlight went out in both.
    updateGlobalTitles(newTitles) {
        this.internalParserInstanceTitles = newTitles;

        nodeTitles.clear();
        for (const parser of new Set([this, ...window.zetPaneList.map( (pane)=>pane.parser )])) {
            parser.internalParserInstanceTitles.forEach(nodeTitles.add, nodeTitles);
        }
    }

    // A Title's first line, as the pass reads the Pane: a later line with the same Title is
    // taken, and makes no Node (#64). The last one used to win here, while the pass bound
    // the Node to the first, so an edit on the card went into the other section.
    updateNodeTitleToLineMap() {
        this.nodeTitleToLineMap.clear();

        this.cm.eachLine((line) => {
            if (!line.text.startsWith(Tag.node)) return;

            const title = line.text.split(Tag.node)[1].trim();
            if (!this.nodeTitleToLineMap.has(title)) this.nodeTitleToLineMap.set(title, line.lineNo());
        });
    }

    // From a Title's first line to the line before the next Title line of either kind --
    // `##` or `AI:`, a taken one included -- which is how the pass reads the Pane. The end
    // came from the other Titles in the map, so an AI section below a note ran on as its
    // body (one keystroke put `AI: Helper` and its prompt on the note's card), and a taken
    // Title, which the map holds once, would have too.
    getNodeSectionRange(title) {
        const lineCount = this.cm.lineCount();
        const nodeLineNo = this.getNodeTitleLine(title);

        let nextNodeLineNo = lineCount;
        if (nodeLineNo !== undefined) {
            for (let i = nodeLineNo + 1; i < lineCount; i++) {
                const text = this.cm.getLine(i);
                if (!text.startsWith(Tag.node) && !text.startsWith(LLM_TAG)) continue;

                nextNodeLineNo = i;
                break;
            }
        }
        return {startLineNo: nodeLineNo, endLineNo: nextNodeLineNo - 1};
    }

    retrieveNodeSectionText(title) {
        const { startLineNo, endLineNo } = this.getNodeSectionRange(title);
        const lines = [];
        for (let i = startLineNo; i <= endLineNo; i++) {
            lines.push(this.cm.getLine(i));
        }
        return lines.join('\n');
    }

    // The line of the section that is the Node, where the pass put it (`heldLines`): a taken
    // copy of its Title above it is the first line with the Title, and is not the note (#64).
    getNodeTitleLine(title) {
        const lowerCaseTitle = title.toLowerCase();
        const held = this.heldLines?.get(lowerCaseTitle);
        const heldText = (held === undefined) ? null : this.cm.getLine(held);
        if (heldText?.startsWith(Tag.node) && heldText.substr(Tag.node.length).trim().toLowerCase() === lowerCaseTitle) return held;

        const sorted = Array.from(this.nodeTitleToLineMap).sort((a, b) => a[1] - b[1]);
        for (const [mapTitle, mapLineNo] of sorted) {
            if (mapTitle.toLowerCase() === lowerCaseTitle) return mapLineNo
        }
    }
    // A section starts at a Tag.node line OR an LLM_TAG line and runs until the next
    // one of either -- that is how processLine reads the pane, so it is what a delete
    // has to cut. Both halves used to know only about Tag.node: an AI section could
    // not be found at all (the title map holds Tag.node lines only, so an AI note's
    // text outlived its node), and the scan for the end of a section ran straight
    // through the next AI section and took it along.
    //
    // Returns whether this pane held the section, so a caller can stop looking.
    //
    // The kind of Node picks the kind of line: a text Node's section starts at its Title
    // line, the one the pass bound it to (`getNodeTitleLine`), an AI Node's at its `AI:`
    // line. Looked up by Title alone, deleting an AI Node took a `## ` note with the same
    // Title -- a taken copy -- with it, and left the `AI:` line to make the AI Node again.
    deleteNodeByTitle(title, isAi = false) {
        let startLineNo = (isAi ? undefined : this.getNodeTitleLine(title));
        if (startLineNo === undefined && isAi) {
            this.cm.eachLine( (line)=>{
                if (startLineNo !== undefined || !line.text.startsWith(LLM_TAG)) return;
                if (line.text.slice(LLM_TAG.length).trim() === title) startLineNo = line.lineNo();
            });
        }
        if (startLineNo === undefined) return false;

        let endLineNo = startLineNo;
        for (let i = startLineNo + 1; i < this.cm.lineCount(); i++) {
            const lineText = this.cm.getLine(i);
            if (lineText.startsWith(Tag.node) || lineText.startsWith(LLM_TAG)) {
                endLineNo = i - 1;
                break;
            }
            endLineNo = i;
        }

        this.cm.replaceRange('', { line: startLineNo, ch: 0 }, { line: endLineNo + 1, ch: 0 });

        if (this.cm.getValue().trim() === '') {
            this.cm.setValue('');
        }
        this.cm.refresh();
        return true;
    }
    updateMode() {
        this.cm.setOption("mode", { name: "custom", node: Tag.node, ref: Tag.ref });
        this.cm.refresh();
    }
    addEdge(fromTitle, toTitle, cm) {
        if (!fromTitle || !toTitle) {
            Logger.err("One or both titles are empty or undefined.");
            return;
        }

        const appendOrCreateTag = (range, tagLineStart, newTag, tagPrefix = '', useCSV = false) => {
            function getTrailingWhitespace(range){
                let count = 0;
                for (let i = range.endLineNo; i >= range.startLineNo; i--) {
                    if (cm.getLine(i).trim() !== '') break;

                    count += 1;
                }
                return count;
            }

            function insertTagInWhitespace(endLine, count, tag){
                if (count === 0) {
                    const isEndOfDoc = (endLine === cm.lineCount() - 1);
                    const str = (isEndOfDoc ? `\n\n${tag}\n` : `\n${tag}\n\n`);
                    cm.replaceRange(str, { line: endLine + 1, ch: 0 });
                } else if (count === 1) {
                    cm.replaceRange('\n' + tag + '\n', { line: endLine, ch: 0 });
                } else if (count === 2) {
                    cm.replaceRange(tag + '\n', { line: endLine, ch: 0 });
                } else {
                    cm.replaceRange(tag, { line: endLine - 1, ch: 0 });
                }
            }

            const whitespaceCount = getTrailingWhitespace(range);

            if (tagLineStart !== null) {
                const oldLine = cm.getLine(tagLineStart);
                if (!oldLine.includes(newTag)) {
                    const separator = useCSV ? ', ' : ' ';
                    cm.replaceRange(`${oldLine}${separator}${newTag}`, { line: tagLineStart, ch: 0 }, { line: tagLineStart, ch: oldLine.length });
                }
            } else {
                insertTagInWhitespace(range.endLineNo, whitespaceCount, `${tagPrefix}${newTag}`);
            }
        };

        const fromRange = this.getNodeSectionRange(fromTitle);
        const refTag = tagValues.refTag;
        const closingBracket = bracketsMap[refTag];

        // Once is enough. The check below looks only at the first line that starts with the
        // tag, so a note that named the other in a sentence -- "See [[B]]." -- got a second
        // `[[B]]` on a line of its own every time the Edge's direction was changed (#51).
        const names = (line)=>(closingBracket
            ? line.includes(refTag + toTitle + closingBracket)
            : line.startsWith(refTag)
              && line.slice(refTag.length).split(',').some( (title)=>(title.trim() === toTitle) ));
        for (let i = fromRange.startLineNo + 1; i <= fromRange.endLineNo; i++) {
            if (names(cm.getLine(i))) return;
        }

        let tagLineStart = null;
        for (let i = fromRange.startLineNo; i <= fromRange.endLineNo; i++) {
            if (!cm.getLine(i).startsWith(refTag)) continue;

            tagLineStart = i;
            break;
        }

        if (closingBracket) {
            appendOrCreateTag(fromRange, tagLineStart, refTag + toTitle + closingBracket);
        } else {
            appendOrCreateTag(fromRange, tagLineStart, toTitle, refTag + ' ', true);
        }
    }

    // Unlinking removes the link, not the words. A ref sitting on a line of its own
    // is a "see also" entry, so the whole entry goes; a ref inside a sentence is a
    // mention, so only its markup goes. Deleting an inline ref's text left a hole in
    // the prose -- "and  is the one it leans on" -- and the words are what lets the
    // same mention be promoted back into a link afterwards.
    removeEdge(fromTitle, toTitle, cm) {
        if (!fromTitle || !toTitle) {
            Logger.err("One or both titles are empty or undefined.");
            return;
        }

        const nodeLine = this.getNodeTitleLine(fromTitle);
        if (nodeLine === undefined) return;

        const closingBracket = bracketsMap[Tag.ref];
        const refTag = tagValues.refTag;
        const escTag = escapeRegExp(refTag);
        // Without a closing bracket the tag itself closes the ref.
        const escClose = escapeRegExp(closingBracket || refTag);
        const escTitle = escapeRegExp(toTitle);

        // The section ends at the next Title line, an `AI:` line included, as
        // `getNodeSectionRange` says: a Ref in the AI Node's prompt below is not this note's.
        for (let j = nodeLine + 1; j < cm.lineCount(); j++) {
            const line = cm.getLine(j);
            if (line.startsWith(Tag.node) || line.startsWith(LLM_TAG)) break;
            if (!line.includes(refTag)) continue;

            const isList = ZettelkastenParser.#isRefList(line, refTag, escTag, escClose, closingBracket);
            // The bare-title arm is for a comma-separated ref line (`ref: A, B`),
            // where a title stands alone as a member. On a line of prose it would
            // also match every other mention of the same words, so it is only used
            // on the lines it was written for.
            const ref = `${escTag}\\s*${escTitle}\\s*${escClose}`;
            const regExp = new RegExp(isList ? `(${ref})|(,?\\s*${escTitle}\\s*,?)` : `(${ref})`, 'g');

            let next = line.replace(regExp, (match, p1, p2) => {
                if (p1) return (isList ? '' : toTitle);
                return (p2.startsWith(',') ? ',' : '');
            });

            if (isList) {
                next = next.trim().replace(/,\s*$/, '').trim();
                // Dropping the last member leaves markup with nothing inside it.
                next = (closingBracket
                    ? next.replace(new RegExp(`${escTag}\\s*${escClose}`, 'g'), '')
                    : next.replace(new RegExp(`^${escTag}\\s*$`), ''));
            }

            cm.replaceRange(next, { line: j, ch: 0 }, { line: j, ch: line.length });
        }

        cm.refresh();
    }

    // A line holding nothing but refs and the separators between them is a list of
    // links; anything else is a sentence that contains one. With no closing bracket
    // a ref has no end of its own, so the tag can only own a whole line -- which is
    // the only shape `addEdge` writes it in.
    static #isRefList(line, refTag, escTag, escClose, closingBracket) {
        if (!closingBracket) return line.trim().startsWith(refTag);

        const withoutRefs = line.replace(new RegExp(`${escTag}.*?${escClose}`, 'g'), '');
        return withoutRefs.replace(/[\s,]/g, '') === '';
    }

    // A note's trailing link-only lines, split off from its prose, so that
    // `body + refs` is the text again.
    //
    // A line that is nothing but refs is a list of edges written as text. The card
    // shows that list as chips under the title already, so painting it a second
    // time as `[[Title]]` is the same fact twice -- once in a notation the reader
    // never asked for. Only the card's editable copy drops it: the refs stay in
    // this note's text, which is the one place an edge between two text notes is
    // stored, and `handleRefTags` deletes any edge whose ref it cannot find there.
    //
    // Trailing, not anywhere. The visible copy is then a prefix of the real text,
    // so one caret offset means the same position in both and the sync between
    // them carries it across untouched. It is also the only place `addEdge` writes
    // a ref of its own.
    static splitTrailingRefs(text) {
        const refTag = tagValues.refTag;
        const closingBracket = bracketsMap[refTag];
        const escTag = escapeRegExp(refTag);
        const escClose = escapeRegExp(closingBracket || refTag);

        const lines = text.split('\n');
        let cut = lines.length;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            // Blank lines carry over a ref line above them -- the text's own final
            // newline makes one -- but a run of blanks under prose is the note's
            // spacing, and nothing is cut until a ref line is actually reached.
            if (line.trim() === '') continue;
            if (!line.includes(refTag)) break;
            if (!ZettelkastenParser.#isRefList(line, refTag, escTag, escClose, closingBracket)) break;
            cut = i;
        }
        if (cut === lines.length) return {body: text, refs: ''};

        const body = lines.slice(0, cut).join('\n');
        // Sliced, not re-joined: `refs` then holds the newline that separated it
        // from the prose, and the two halves are the original text exactly.
        return {body, refs: text.slice(body.length)};
    }
}

function updateAllZetMirrorModes() {
    const panes = window.zetPaneList || [];
    panes.forEach(pane => {
        const parser = pane.parser;
        if (typeof parser?.updateMode === 'function') parser.updateMode();
    });
}

function updateAllZettelkastenProcessors() {
    const panes = window.zetPaneList || [];
    panes.forEach(pane => {
        const processor = pane.processor;
        if (typeof processor?.processInput === 'function') processor.processInput();
    });
}

// A `generateCmPlaceholder` built the editor's ghost text here -- "To create
// notes... / ## Title Header / Plain Text / [[Reference]]" -- and an
// `updateAllCodeMirrorPlaceholders` re-ran it through a `parser.updatePlaceholder`
// whenever the tag inputs changed, so the sample always used the current tags.
// All three are gone. The syntax it taught is in the Help panel now, where it can say
// what a Title and a Reference *do* instead of only how they are spelled, and the
// editor opens empty.
//
// `updateAllZetMirrorModes` above is the one that still has to run on a tag change:
// the tags are compiled into the CodeMirror mode, so the highlighting is wrong until
// it does. Only the sample text was cosmetic.

CodeMirror.defineMode("custom", function (config, parserConfig) {
    const Prompt = `${PROMPT_IDENTIFIER}`;
    const PromptEnd = `${PROMPT_END}`;
    var node = parserConfig.node || '';
    var ref = parserConfig.ref || '';

    const htmlMixedMode = CodeMirror.getMode(config, "htmlmixed");
    const cssMode = CodeMirror.getMode(config, "css");
    const jsMode = CodeMirror.getMode(config, "javascript");
    const pythonMode = CodeMirror.getMode(config, "python");

    return {
        startState: function () {
            return {
                inBlock: null,
                subState: null,
                inPrompt: false
            };
        },
        token: function (stream, state) {
            if (stream.sol()) {
                let match = stream.match(/```(html|css|(js|javascript)|python)/, false);
                if (match && match[1]) {
                    state.inBlock = match[1] === "javascript" ? "js" : match[1];
                    state.subState = CodeMirror.startState({ 'html': htmlMixedMode, 'css': cssMode, 'js': jsMode, 'python': pythonMode }[state.inBlock]);
                    stream.skipToEnd();
                    return "string";
                }

                match = stream.match(/```/, false);
                if (match) {
                    state.inBlock = null;
                    state.subState = null;
                    stream.skipToEnd();
                    return "string";
                }
            }

            if (state.inBlock) {
                const map = { 'html': htmlMixedMode, 'css': cssMode, 'js': jsMode, 'python': pythonMode };
                return (map[state.inBlock]).token(stream, state.subState);
            }

            if (stream.match(Prompt, true)) {
                state.inPrompt = true;
                return "hidden-delimiter";
            }

            if (stream.match(PromptEnd, true)) {
                state.inPrompt = false;
                return "hidden-delimiter";
            }

            if (state.inPrompt) {
                stream.next();
                return "prompt-block";
            }

            if (stream.match(node, true)) return "node";

            if (bracketsMap[ref]) {
                if (stream.match(ref, true)) return "ref";
                const closingBracket = bracketsMap[ref];
                if (stream.match(closingBracket, true)) return "ref";
            } else if (stream.match(ref, true)) {
                return "ref";
            }

            stream.next();
            return null;
        },
    };
});



function getActiveZetCMInstanceInfo() {
    const activeCodeMirror = window.currentActiveZettelkastenMirror;
    if (activeCodeMirror) {
        for (const pane of window.zetPaneList) {
            if (pane.cm !== activeCodeMirror) continue;

            return {
                ui: pane.ui,
                parser: pane.parser,
                cm: activeCodeMirror,
                textarea: activeCodeMirror.getTextArea(),
                paneId: pane.paneId,
                zettelkastenProcessor: pane.processor
            };
        }
    }
    return null;
}

// The Pane that holds the Title first: another Pane can carry a heading with it that is
// marked as taken, and the first Pane with the heading in its map was the answer -- a
// rename on the Graph then rewrote the taken copy's Pane instead (#64).
function getZetNodeCMInstance(nodeOrTitle) {
    let title = typeof nodeOrTitle === 'string' ? nodeOrTitle : nodeOrTitle.getTitle();
    const holder = paneHoldingTitle(title);
    const panes = (holder ? [holder] : window.zetPaneList);
    for (const pane of panes) {
        const lineNumber = pane.parser.nodeTitleToLineMap.get(title) ?? (holder && pane.parser.getNodeTitleLine(title));
        if (lineNumber === undefined || lineNumber === null) continue;

        return {
            ui: pane.ui,
            parser: pane.parser,
            cm: pane.cm,
            lineNumber,
            paneId: pane.paneId,
            zettelkastenProcessor: pane.processor
        };
    }
    return null;
}

// Deleting a node takes the pane section it was built from with it. The pane is the
// source of truth: text left behind is still a note in the reader's notes, and the
// next full pass can raise the node from it. Every delete path used to carry its own
// half of this -- the card button removed the node and cleaned up only if it was a
// text node, one action class cleaned up the text and left the node to the sync, and
// every other node type cleaned up nothing at all.
//
// getZetNodeCMInstance cannot be used to find the pane: it looks the title up in the
// Tag.node title map, so it answers null for an AI note. deleteNodeByTitle reports
// whether the section was in that pane, which is what picks the pane here.
//
// The Pane holding the Title goes first, before `node.remove()` lets it go: a Pane before
// it can carry the same heading as a taken copy, whose section is not this Node's (#64).
function deleteNodeAndItsZetText(node){
    const title = node.getTitle?.();
    const holder = title && paneHoldingTitle(title);
    node.remove();
    if (!title) return;

    for (const pane of (holder ? [holder, ...window.zetPaneList] : window.zetPaneList)) {
        if (pane.parser.deleteNodeByTitle(title, Boolean(node.isLLM))) return;
    }
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Flag to control recursion
let isEdgeBeingAdded = false;

function getNodeInfo(title, linkedTitle){
    if (title && linkedTitle) return getZetNodeCMInstance(title);

    Logger.err("One or both titles are empty or undefined.");
}
function addEdgeToZettelkasten(title, linkedTitle) {
    const nodeInfo = getNodeInfo(title, linkedTitle);
    if (nodeInfo) nodeInfo.parser.addEdge(title, linkedTitle, nodeInfo.cm);
}
function removeEdgeFromZettelkasten(title, linkedTitle) {
    const nodeInfo = getNodeInfo(title, linkedTitle);
    if (nodeInfo) nodeInfo.parser.removeEdge(title, linkedTitle, nodeInfo.cm);
}

function getEdgeInfo(startTitle, endTitle) {
    return {
        startNodeInfo: getZetNodeCMInstance(startTitle),
        endNodeInfo: getZetNodeCMInstance(endTitle)
    }
}




class ZettelkastenUI {
    constructor(codeMirrorInstance, textarea, parser) {
        this.cm = codeMirrorInstance;
        this.parser = parser;
        this.initializeUI();

        this.textarea = textarea;

        const style = this.cm.display.wrapper.style;
        style.backgroundColor = '#222226';
        style.width = 'auto';
        style.height = '100%';
        style.borderStyle = 'inset';
        style.borderColor = '#8882';
        style.fontSize = '16px';
        style.wordWrap = 'break-word';
        this.cm.getWrapperElement().style.resize = "vertical";

        this.ignoreTextAreaChanges = false;
        this.userScrolledUp = false;
    }

    initializeUI() {
        this.cm.on('mousedown', (cm, e) => {
            const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
            const token = cm.getTokenAt(pos);

            if (token.type && token.type.includes("node")) {
                const title = cm.getLine(pos.line).split(Tag.node)[1].trim();
                if (title) Node.byTitle(title).view.toggleCollapse(e);
                return;
            }

            const isWithin = this.isWithinMarkedText(cm, pos, 'node-title');

            if (isWithin) {
                const lineMarkers = cm.findMarksAt(pos);
                const titles = lineMarkers.filter(marker => marker.className === 'node-title')
                    .map(marker => cm.getRange(marker.find().from, marker.find().to));

                if (titles.length > 0) {
                    const longestTitle = titles.reduce((a, b) => a.length > b.length ? a : b);
                    const markerForLongestTitle = lineMarkers.find(marker => {
                        const rangeText = cm.getRange(marker.find().from, marker.find().to);
                        return rangeText === longestTitle;
                    });

                    if (markerForLongestTitle) {
                        const from = markerForLongestTitle.find().from;
                        const to = markerForLongestTitle.find().to;

                        if (pos.ch === from.ch || pos.ch === to.ch) {
                            if (longestTitle.length === 1) {
                                handleTitleClick(longestTitle);
                            } else {
                                cm.setCursor(pos);
                            }
                        } else {
                            e.preventDefault();
                            handleTitleClick(longestTitle);
                        }
                    }
                }
            } else {
                const leftPos = CodeMirror.Pos(pos.line, pos.ch - 1);
                const rightPos = CodeMirror.Pos(pos.line, pos.ch + 1);
                const isLeftAdjacent = this.isWithinMarkedText(cm, leftPos, 'node-title');
                const isRightAdjacent = this.isWithinMarkedText(cm, rightPos, 'node-title');
                if (isLeftAdjacent || isRightAdjacent) cm.setCursor(pos);

                if (cm.getLine(pos.line).startsWith(Tag.node)) cm.setCursor(pos);
            }
        });

        this.cm.on('cursorActivity', (cm) => {
            const cursorPos = cm.getCursor();
            const cursorLineNo = cursorPos.line;

            let currentNodeSectionTitle;
            for (const [title, lineNo] of Array.from(this.parser.nodeTitleToLineMap).sort((a, b) => a[1] - b[1])) {
                if (lineNo > cursorLineNo) break;

                currentNodeSectionTitle = title;
            }

            if (currentNodeSectionTitle) {
                const { startLineNo, endLineNo } = this.parser.getNodeSectionRange(currentNodeSectionTitle);
                if (cursorLineNo >= startLineNo && cursorLineNo <= endLineNo) {
                    highlightNodeSection(this.cm, this.parser, currentNodeSectionTitle);
                    return;
                }
            }

            cm.getAllMarks().forEach(mark => {
                if (mark.className === 'current-node-section') mark.clear();
            });
        });

        this.cm.on('change', (instance, changeObj) => {
            this.ignoreTextAreaChanges = true;
            this.textarea.value = instance.getValue();

            const event = new Event('input', {
                bubbles: true,
                cancelable: true,
            });
            this.textarea.dispatchEvent(event);

            this.ignoreTextAreaChanges = false;
            this.parser.identifyNodeTitles();
            this.highlightNodeTitles();
        });

        this.cm.on('scroll', () => {
            const scrollInfo = this.cm.getScrollInfo();
            const atBottom = scrollInfo.height - scrollInfo.top - scrollInfo.clientHeight < 1;
            this.userScrolledUp = !atBottom;
        });
    }

    isWithinMarkedText(cm, pos, className) {
        const lineMarkers = cm.findMarksAt(pos);
        for (let i = 0; i < lineMarkers.length; i++) {
            if (lineMarkers[i].className === className) return true
        }
        return false;
    }

    highlightNodeTitles() {
        this.cm.getAllMarks().forEach(mark => mark.clear());

        this.cm.eachLine((line) => {
            nodeTitles.forEach((title) => {
                if (title.length < 1) return;

                const escapedTitle = RegExp.escape(title);
                const regex = new RegExp(escapedTitle, "ig");
                let match;

                while ((match = regex.exec(line.text))) {
                    const idx = match.index;
                    if (idx !== -1) {
                        const token = this.cm.getTokenAt(CodeMirror.Pos(line.lineNo(), idx));

                        // Skip highlighting if the token belongs to a prompt block
                        if (token && token.type === "prompt-block") {
                            continue;
                        }

                        this.cm.markText(
                            CodeMirror.Pos(line.lineNo(), idx),
                            CodeMirror.Pos(line.lineNo(), idx + title.length),
                            {
                                className: 'node-title',
                                handleMouseEvents: true
                            }
                        );
                    }
                }
            });
        });
    }

    scrollToLine(cm, lineNumber) {
        const validLineNumber = Math.min(lineNumber, cm.lastLine());
        cm.scrollIntoView({ line: validLineNumber, ch: 0 }, 30);
    }

    scrollToTitle(title, lineOffset = 0, chPosition = 0) {
        const cm = this.cm;
        if (!title || !cm) return;

        const lowerCaseTitle = title.toLowerCase();
        let nodeLineNo;
        for (const [mapTitle, mapLineNo] of this.parser.nodeTitleToLineMap) {
            if (mapTitle.toLowerCase() !== lowerCaseTitle) continue;

            nodeLineNo = mapLineNo;
            break;
        }

        if (nodeLineNo === undefined) return;

        nodeLineNo += lineOffset;

        const coords = cm.charCoords({ line: nodeLineNo, ch: chPosition }, "local");

        cm.scrollTo(null, coords.top);

        highlightNodeSection(cm, this.parser, title);

        return Node.byTitle(title);
    }
}

function highlightNodeSection(cm, parser, title) {
    cm.getAllMarks().forEach(mark => {
        if (mark.className === 'current-node-section') mark.clear();
    });

    const { startLineNo, endLineNo } = parser.getNodeSectionRange(title);

    if (startLineNo === undefined) return;

    cm.markText(
        CodeMirror.Pos(startLineNo, 0),
        CodeMirror.Pos(endLineNo, cm.getLine(endLineNo).length),
        { className: 'current-node-section' }
    );
}

function handleTitleClick(title) {
    if (!title) return;

    // Scroll to the title
    //const node = scrollToTitle(title, cm);
    const node = Node.byTitle(title);
    if (!node) return;

    if (node.hasBoundingRectangle()) {
        Autopilot.zoomToFitFrame(node).targetZoom_scaleBy(2).start()
    } else {
        // Use alternative zoom method (allows best of both options, i.e. zoomto with exact height calculations when available, and when not currently in the viewport, a set value.)
        Autopilot.zoomToFrame(node, .5).start()
    }
}
