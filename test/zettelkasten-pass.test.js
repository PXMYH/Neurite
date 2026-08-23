// Pins the three failure modes that made the Zettelkasten sync flags a bug.
//
// A pass over a Zettelkasten pane's text runs as a CodeMirror 'change' handler,
// so a caller that wants a non-default pass cannot hand it arguments -- it used
// to set a module-level flag and then write into the editor. That produced:
//
//   1. a mode set on a global, so writing to one pane armed every pane's
//      processor;
//   2. a mode cleared by the pass rather than by the caller, so a write that
//      fires two change events got the mode on the first pass only (the paste
//      handler in handledrop.js writes twice);
//   3. a flag with no writer at all -- bypassZettelkasten was declared, read and
//      cleared, and nothing ever set it, so its guard could never fire.
//
// Each test below asserts both what it found and what it did not: a scan that
// silently matches nothing reports the same "clean" as a clean tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel)=>readFileSync(join(ROOT, rel), 'utf8');

const ZETTELKASTEN = 'js/zettelkasten/zettelkasten.js';

function scriptsUnder(dir, out = []){
    for (const entry of readdirSync(join(ROOT, dir), {withFileTypes: true})) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) scriptsUnder(rel, out);
        else if (entry.name.endsWith('.js')) out.push(rel);
    }
    return out;
}

// The old flag names survive in the comment that explains why they are gone, so
// a scan for them has to read code only.
const withoutComments = (src)=>src.replace(/\/\/.*$/gm, '');

// ZettelkastenProcessor is a plain class declaration -- its instance fields only
// run on construction -- so the class body alone evaluates in a sandbox. Slicing
// it out avoids the rest of the file, which does call into the app at load. The
// slice starts at NodeWrap because the processor news one up, and that pulls in
// the real TextArea.ofNode that sits between the two classes.
function loadProcessor(extra = {}){
    const src = read(ZETTELKASTEN);
    const start = src.indexOf('class ZettelkastenProcessor {');
    assert.notEqual(start, -1, 'ZettelkastenProcessor should be a class declaration');
    const end = src.indexOf('\n}\n', start);
    assert.notEqual(end, -1, 'the class body should close at column 0');
    const wrapStart = src.indexOf('class NodeWrap {');
    assert.notEqual(wrapStart, -1, 'NodeWrap should be a class declaration above it');

    const sandbox = {
        // Everything the class touches on the paths these tests exercise.
        NodePlacementStrategy: class { constructor(objects, options){ this.nodeObjects = objects; this.options = options } },
        ZettelkastenParser: {regexpNodeTitle: /^##\s*(.+)$/},
        Tag: {node: '##', ref: '[['},
        LLM_TAG: 'AI:',
        Node: {byTitle: ()=>null},
        Logger: {debug(){}, info(){}, warn(){}, err(){}},
        TextArea: {},
        ...extra
    };
    vm.runInNewContext(
        src.slice(wrapStart, end + 2) + '\n;globalThis.exported = ZettelkastenProcessor;',
        sandbox, {filename: 'ZettelkastenProcessor.js'}
    );
    return sandbox.exported;
}

// A processor over an editor that holds one blank line, recording the mode each
// pass sees.
function makeProcessor(Processor){
    const seen = [];
    const noteInput = {
        on(){},
        getValue(){ seen.push(this.owner.mode); return '' }
    };
    const processor = new Processor(noteInput, {getNodeSectionRange: ()=>({startLineNo: 0, endLineNo: 0})});
    noteInput.owner = processor;
    return {processor, seen};
}

test('the three module-level sync flags are gone from every script', ()=>{
    const files = scriptsUnder('js');
    const flags = /\b(processAll|restoreZettelkastenEvent|bypassZettelkasten)\b/;

    const hits = files.filter(rel => flags.test(withoutComments(read(rel))));

    // Both numbers: 82 scripts are loaded by PageLoad, so a scan finding nothing
    // in a handful of files has not looked at the tree.
    assert.ok(files.length >= 80, `expected to scan the whole tree, saw ${files.length} scripts`);
    assert.deepEqual(hits, [], 'a pass mode must be an argument, not a module-level flag');
});

test('every pass mode a caller names exists in the table', ()=>{
    const Processor = loadProcessor();
    const modes = Object.keys(Processor.Pass);

    const named = [];
    for (const rel of scriptsUnder('js')) {
        for (const m of read(rel).matchAll(/ZettelkastenProcessor\.Pass\.(\w+)/g)) {
            named.push({rel, mode: m[1]});
        }
    }

    assert.ok(modes.length >= 3, `expected a table of modes, saw ${modes.length}`);
    assert.ok(named.length >= 5, `expected callers to name modes, found ${named.length}`);
    assert.ok(new Set(named.map(n => n.rel)).size >= 3, 'expected callers in several scripts');
    assert.deepEqual(
        named.filter(n => !modes.includes(n.mode)),
        [], 'a caller named a mode the table does not define'
    );
});

test('no mode in the table is unreachable', ()=>{
    // bypassZettelkasten was read and cleared but never written, so the branch it
    // guarded was dead. A mode nothing asks for is the same defect.
    const Processor = loadProcessor();
    const modes = Object.keys(Processor.Pass);
    const source = scriptsUnder('js').map(read).join('\n');

    assert.ok(modes.length >= 3, `expected a table of modes, saw ${modes.length}`);
    assert.deepEqual(
        modes.filter(mode => !source.includes(`Pass.${mode}`)),
        [], 'every mode must have a caller, or its branches are dead'
    );
});

test('a pass leaves the mode it ran in untouched, so two writes both get it', ()=>{
    const Processor = loadProcessor();
    const {Pass} = Processor;
    const {processor, seen} = makeProcessor(Processor);

    assert.equal(processor.mode, Pass.edit, 'a processor starts in edit mode');

    // What the paste handler does: one bracketed write that fires two changes.
    processor.writeAs(Pass.rewrite, ()=>{
        processor.processInput();
        processor.processInput();
    });

    assert.deepEqual(seen, [Pass.rewrite, Pass.rewrite],
        'the mode was cleared between passes, so the second write lost it');
    assert.equal(processor.mode, Pass.edit, 'the mode must not outlive the write');
});

test('writeAs restores the mode when the write throws', ()=>{
    const Processor = loadProcessor();
    const {Pass} = Processor;
    const {processor} = makeProcessor(Processor);

    assert.throws(
        ()=>processor.writeAs(Pass.restore, ()=>{ throw new Error('write failed') }),
        /write failed/
    );

    // Left in restore mode, the next keystroke would bind titles to existing
    // nodes instead of spawning them.
    assert.equal(processor.mode, Pass.edit, 'a failed write must not leave the mode set');
});

// A pass walks the pane's lines top-down, so a ref can name a section the walk
// has not reached yet. Resolving that ref against the nodes made so far found
// nothing and made no edge, silently: a node holding several refs kept only the
// edges pointing back up the text. Reloading a pane is one such pass, so the
// graph a person saved came back with most of its edges missing.
//
// The harness below is the smallest fake graph a whole pass can run over.

// connectDistance puts the new edge on both of its nodes, and Graph.deleteEdge
// takes it off both -- the processor leans on both halves, so the fakes keep that
// contract.
function makeFakeGraph(){
    const nodes = new Map();

    function makeNode(title){
        const node = {
            uuid: title,
            title,
            isTextNode: true,
            removed: false,
            edges: [],
            getTitle: ()=>node.title,
            remove(){ node.removed = true },
            forEachConnectedNode(cb, ct){
                for (const edge of node.edges.slice()) {
                    const other = edge.pts.find((pt)=>(pt !== node));
                    if (other) cb.call(ct, other);
                }
            },
            textarea: {value: ''},
            view: {titleInput: {value: title}, flashAsNew(){}},
            // handleReferenceLine writes the node's body through this chain.
            content: {children: [{children: [null, {children: [{value: ''}]}]}]}
        };
        nodes.set(title, node);
        return node;
    }

    function connectDistance(a, b){
        const edge = {
            pts: [a, b],
            remove(){
                for (const pt of edge.pts) pt.edges = pt.edges.filter((e)=>(e !== edge));
            }
        };
        a.edges.push(edge);
        b.edges.push(edge);
        return edge;
    }

    return {nodes, makeNode, connectDistance};
}

// The pass and the fake graph over one pane of text. setText replaces the text
// the next pass reads, as an edit in the pane would.
function makeGraph(text){
    const {nodes, makeNode, connectDistance} = makeFakeGraph();

    const lines = ()=>text.split('\n');
    const titleOfLine = (line)=>(line.startsWith('## ') ? line.slice(3).trim() : null);
    // The real parser matches a title case-insensitively and ends a section at
    // the line before the next title.
    const getNodeSectionRange = (title)=>{
        const all = lines();
        const start = all.findIndex((l)=>(titleOfLine(l)?.toLowerCase() === title.toLowerCase()));
        if (start === -1) return {startLineNo: 0, endLineNo: 0};

        let end = start + 1;
        while (end < all.length && !titleOfLine(all[end])) end += 1;
        return {startLineNo: start, endLineNo: end - 1};
    };

    const parser = {getNodeSectionRange, updateNodeTitleToLineMap(){}};
    const noteInput = {on(){}, getValue: ()=>text, refresh(){}};

    const Processor = loadProcessor({
        nodefromWindow: false,
        followMouseFromWindow: false,
        App: {processedNodes: {update(){}, map: {}}},
        On: {input(){}},
        Node: {byTitle: (title)=>nodes.get(title) || null},
        connectDistance,
        sortedBrackets: ['[['],
        bracketsMap: {'[[': ']]'},
        Promise: {delay: ()=>({then(){}})},
        NodePlacementStrategy: class {
            constructor(objects, options){ this.nodeObjects = objects; this.options = options }
            calculatePositionAndScale(title){ return makeNode(title) }
        },
        // One pane, so every wrap the pass knows about is this processor's.
        getAllInternalZetNodeWraps: ()=>processor.wrapPerTitle,
        getZetNodeCMInstance: (title)=>(nodes.has(title) ? {cm: noteInput, parser, zettelkastenProcessor: processor} : null)
    });
    const processor = new Processor(noteInput, parser);

    const edgesOf = (title)=>{
        const node = nodes.get(title);
        assert.ok(node, `expected a node titled ${title}`);
        // Spread first: the pass rebuilds node.edges inside the vm context, and an
        // array from another realm is not deepStrictEqual to a plain one.
        return [...node.edges]
            .map((edge)=>(edge.pts.find((pt)=>(pt !== node))?.getTitle() ?? '?'))
            .sort();
    };
    const snapshot = ()=>Object.keys(processor.wrapPerTitle).sort()
        .map((title)=>`${title} -> ${edgesOf(title).join(', ')}`);

    return {
        processor,
        Pass: Processor.Pass,
        setText(next){ text = next },
        titles: ()=>Object.keys(processor.wrapPerTitle),
        edgesOf,
        snapshot
    };
}

// The pane text from the report: two nodes each naming a third whose section is
// written below both of them.
const FORWARD_REF_PANE = [
    '## Test 1',
    '[[Test 2]] [[test node 1]]',
    '## Test 2',
    '[[Test 1]] [[test node 1]]',
    '## test node 1',
    '## test Node 2'
].join('\n');

test('a ref naming a section further down the pane still makes an edge', ()=>{
    const graph = makeGraph(FORWARD_REF_PANE);

    graph.processor.processAs(graph.Pass.rewrite);

    assert.deepEqual(graph.titles(), ['Test 1', 'Test 2', 'test node 1', 'test Node 2'],
        'the pass should make one node per section, or the fixture never parsed');
    // Test 1 and Test 2 each hold two refs. Only [[Test 2]] on line 4 points back
    // up the text; the other three point forward, and used to be dropped.
    assert.deepEqual(graph.edgesOf('Test 1'), ['Test 2', 'test node 1']);
    assert.deepEqual(graph.edgesOf('Test 2'), ['Test 1', 'test node 1']);
    assert.deepEqual(graph.edgesOf('test node 1'), ['Test 1', 'Test 2']);
    assert.deepEqual(graph.edgesOf('test Node 2'), [], 'a section nothing refs gets no edge');
});

test('a second pass over unchanged text changes no edge', ()=>{
    const graph = makeGraph(FORWARD_REF_PANE);

    graph.processor.processAs(graph.Pass.rewrite);
    const first = graph.snapshot();
    graph.processor.processAs(graph.Pass.rewrite);

    assert.ok(first.some((line)=>line.includes('->')), 'expected a snapshot to compare');
    // The bug's signature: the second pass found the nodes the first had made and
    // added the edges it had missed, so the graph depended on how many times the
    // same text had been parsed.
    assert.deepEqual(graph.snapshot(), first, 'a pass over unchanged text must be a no-op');
});

test('deleting a ref removes the edge it made', ()=>{
    const graph = makeGraph(FORWARD_REF_PANE);
    graph.processor.processAs(graph.Pass.rewrite);
    assert.deepEqual(graph.edgesOf('test node 1'), ['Test 1', 'Test 2'], 'edges to remove');

    // Both refs to test node 1 deleted; the refs between Test 1 and Test 2 stay.
    graph.setText(['## Test 1', '[[Test 2]]', '## Test 2', '[[Test 1]]', '## test node 1', '## test Node 2'].join('\n'));
    graph.processor.processAs(graph.Pass.rewrite);

    assert.deepEqual(graph.edgesOf('test node 1'), [], 'a deleted ref must take its edge with it');
    assert.deepEqual(graph.edgesOf('Test 1'), ['Test 2'], 'the remaining ref keeps its edge');
});

test('a ref naming no section at all is dropped, not retried forever', ()=>{
    const graph = makeGraph(['## Test 1', '[[Nowhere]] [[Test 2]]', '## Test 2'].join('\n'));

    graph.processor.processAs(graph.Pass.rewrite);

    assert.deepEqual(graph.edgesOf('Test 1'), ['Test 2'], 'the resolvable ref still connects');
    assert.equal(graph.titles().includes('Nowhere'), false, 'a dangling ref must not make a node');
    assert.equal(graph.processor.deferredRefs, null, 'the retry queue must be drained, not left armed');
});
