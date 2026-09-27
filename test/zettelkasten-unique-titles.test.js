// A Title names one Node across every Pane (#64). Pins what a second section with a Title
// already held does -- in another Archive, or further down the same one -- and what a
// Saved Graph that already holds such a pair becomes when it is opened.
//
// Before: two Archives that both wrote `## Alpha` made two Nodes titled Alpha, a Ref to
// Alpha resolved to whichever Pane came last, and opening such a graph bound both Panes to
// the same Node. In one Pane the later `## Alpha` took the Node over and the earlier
// section fell off its card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel)=>readFileSync(join(ROOT, rel), 'utf8');

function slice(src, start, what){
    const from = src.indexOf(start);
    assert.notEqual(from, -1, `${what} should be declared as \`${start}\``);
    const to = src.indexOf('\n}\n', from);
    assert.notEqual(to, -1, `${what} should close at column 0`);
    return src.slice(from, to + 2);
}

// A CodeMirror double that holds text, fires its change handlers on a write, and replaces
// whole lines -- all the processor and `applyRenames` ask of it.
function makeEditor(){
    const handlers = [];
    const cm = {
        text: '',
        on(type, handler){ if (type === 'change') handlers.push(handler) },
        getValue: ()=>cm.text,
        setValue(text){ cm.text = text; handlers.forEach((h)=>h()) },
        getLine: (i)=>cm.text.split('\n')[i],
        operation(fn){ fn() },
        replaceRange(line, from){
            const lines = cm.text.split('\n');
            lines[from.line] = line;
            cm.setValue(lines.join('\n'));
        },
        refresh(){}
    };
    return cm;
}

// The parser's section rule: from a Title's first line, in any case, to the next Title line.
function makeParser(cm){
    const isTitle = (line)=>(line.startsWith('## ') || line.startsWith('AI:'));
    return {
        updateNodeTitleToLineMap(){},
        getNodeSectionRange(title){
            const lines = cm.text.split('\n');
            const start = lines.findIndex((l)=>(l.startsWith('## ') && l.slice(3).trim().toLowerCase() === title.toLowerCase()));
            if (start === -1) return {startLineNo: undefined, endLineNo: lines.length - 1};
            let end = start + 1;
            while (end < lines.length && !isTitle(lines[end])) end += 1;
            return {startLineNo: start, endLineNo: end - 1};
        }
    };
}

// Several Panes over one fake Graph, with the real processor, `paneHoldingTitle` and
// `getUniqueNodeTitle`.
function makeWorld(){
    let serial = 0;
    const nodes = [];
    const makeNode = (title, kind = 'text')=>{
        const node = {
            uuid: String(serial++),
            isTextNode: kind === 'text',
            isLLM: kind === 'ai',
            removed: false,
            edges: [],
            view: {titleInput: {value: title}, flashAsNew(){}},
            getTitle(){ return node.view.titleInput.value },
            remove(){ node.removed = true },
            forEachConnectedNode(){},
            textarea: {value: ''},
            promptTextArea: {value: ''}
        };
        nodes.push(node);
        return node;
    };
    const window = {zetPaneList: []};
    const src = read('js/zettelkasten/zettelkasten.js');
    const sandbox = {
        window,
        nodefromWindow: false,
        followMouseFromWindow: false,
        App: {processedNodes: {update(){}, map: {}}},
        On: {input(){}},
        Tag: {node: '##', ref: '[['},
        LLM_TAG: 'AI:',
        ZettelkastenParser: {regexpNodeTitle: /^##\s*(.+)$/},
        Node: {byTitle: (title)=>nodes.find((n)=>!n.removed && n.getTitle().toLowerCase() === title.toLowerCase()) ?? null},
        Graph: {edgeDirectionalities: {}, filterNodes: (cb)=>nodes.filter(cb), relaxInBackground(){}},
        connectDistance: ()=>({pts: [], directionality: {}, remove(){}}),
        createLlmNode: (title)=>makeNode(title, 'ai'),
        sortedBrackets: ['[['],
        bracketsMap: {'[[': ']]'},
        getClosingBracket: ()=>']]',
        Promise: {delay: ()=>({then(cb){ cb() }})},
        setTimeout: ()=>0,
        clearTimeout(){},
        Logger: {debug(){}, info(){}, warn(){}, err(){}},
        TextArea: {update(text){ this.value = text }},
        NodePlacementStrategy: class {
            calculatePositionAndScale(title){ return makeNode(title) }
        },
        getAllInternalZetNodeWraps(){
            return Object.assign({}, ...window.zetPaneList.map((p)=>p.processor.wrapPerTitle));
        },
        getZetNodeCMInstance(title){
            const pane = sandbox.paneHoldingTitle(title);
            return pane && {cm: pane.cm, parser: pane.parser, zettelkastenProcessor: pane.processor, paneId: pane.paneId};
        }
    };
    const zcm = read('js/zettelkasten/zetcodemirror.js');
    vm.runInNewContext([
        // Node 22 has no `RegExp.escape`, which `renameNode` calls.
        "if (!RegExp.escape) RegExp.escape = (s)=>s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
        slice(src, 'function replaceInBrackets(', 'replaceInBrackets'),
        slice(src, 'function renameNode(', 'renameNode'),
        slice(zcm, 'function paneHoldingTitle(', 'paneHoldingTitle'),
        slice(zcm, 'function getUniqueNodeTitle(', 'getUniqueNodeTitle'),
        src.slice(src.indexOf('class NodeWrap {'), src.indexOf('\n}\n', src.indexOf('class ZettelkastenProcessor {')) + 2),
        'globalThis.Processor = ZettelkastenProcessor; globalThis.paneHoldingTitle = paneHoldingTitle;',
        'globalThis.getUniqueNodeTitle = getUniqueNodeTitle;'
    ].join('\n;\n'), sandbox, {filename: 'unique-titles.js'});

    const Pass = sandbox.Processor.Pass;
    const addPane = (name)=>{
        const cm = makeEditor();
        const parser = makeParser(cm);
        const processor = new sandbox.Processor(cm, parser);
        const pane = {paneId: name, name, cm, parser, processor};
        window.zetPaneList.push(pane);
        return pane;
    };
    const live = ()=>nodes.filter((n)=>!n.removed);
    const titled = (title)=>live().filter((n)=>n.getTitle() === title);
    return {sandbox, Pass, addPane, makeNode, nodes, live, titled};
}

test('a Title another Archive holds makes no second Node, and the first keeps its body', ()=>{
    const world = makeWorld();
    const one = world.addPane('Archive 1');
    one.cm.setValue('## Alpha\nbody one\n');
    const two = world.addPane('Archive 2');
    two.cm.setValue('## Alpha\nbody two\n');

    assert.equal(world.titled('Alpha').length, 1, 'two Archives made two Nodes titled Alpha');
    assert.equal(world.titled('Alpha')[0].textarea.value, 'body one\n');
    assert.deepEqual([...two.processor.taken].map((t)=>[t.title, t.lineNo, t.holder === one.processor]), [['Alpha', 0, true]],
        'the taken line is recorded, with the Pane that holds it');

    // A keystroke in the taken section changes nobody's card.
    two.cm.setValue('## Alpha\nbody two, edited\n');
    assert.equal(world.titled('Alpha')[0].textarea.value, 'body one\n');
});

test('in any case', ()=>{
    const world = makeWorld();
    world.addPane('Archive 1').cm.setValue('## Alpha\na\n');
    const two = world.addPane('Archive 2');
    two.cm.setValue('## ALPHA\nb\n');

    assert.equal(world.live().length, 1);
    assert.equal(two.processor.taken.length, 1);
});

test('once the Title is let go, the Archive that marked it makes the Node', ()=>{
    const world = makeWorld();
    const one = world.addPane('Archive 1');
    one.cm.setValue('## Alpha\nbody one\n');
    const two = world.addPane('Archive 2');
    two.cm.setValue('## Alpha\nbody two\n');

    // Deleted: free at once.
    one.cm.setValue('');
    const alpha = world.titled('Alpha');
    assert.equal(alpha.length, 1, 'the freed Title made no Node in the Archive that had marked it');
    assert.equal(alpha[0].textarea.value, 'body two\n');
    assert.deepEqual([...two.processor.taken], []);
});

test('a Title typed over is let go when the typing moves off its line', ()=>{
    const world = makeWorld();
    const one = world.addPane('Archive 1');
    one.cm.setValue('## Alpha\nbody one\n');
    const two = world.addPane('Archive 2');
    two.cm.setValue('## Alpha\nbody two\n');

    one.cm.setValue('## Something else\nbody one\n');
    assert.equal(world.titled('Alpha').length, 0, 'the Title went while its line was still being typed');
    one.cm.setValue('## Something else\nbody one, and more\n');
    assert.equal(world.titled('Alpha').length, 1);
    assert.equal(world.titled('Alpha')[0].textarea.value, 'body two\n');
});

// Backspace on a note's Title line and type it back: the same Node throughout, and a copy of
// the Title elsewhere -- in another Archive, or in the same one above or below -- stays taken.
// The copy took the Title at the backspace, and the note, typed back, was the one taken.
for (const [where, setup] of [
    ['in another Archive', (world)=>{
        const one = world.addPane('Archive 1');
        one.cm.setValue('## Alpha\nthe note\n');
        world.addPane('Archive 2').cm.setValue('## Alpha\nthe copy\n');
        return {pane: one, text: (t)=>`## ${t}\nthe note\n`};
    }],
    ['below it', (world)=>{
        const one = world.addPane('Archive 1');
        one.cm.setValue('## Alpha\nthe note\n\n## Alpha\nthe copy\n');
        return {pane: one, text: (t)=>`## ${t}\nthe note\n\n## Alpha\nthe copy\n`};
    }],
    ['above it', (world)=>{
        const one = world.addPane('Archive 1');
        one.cm.setValue('## Alpha\nthe note\n');
        one.cm.setValue('## Alpha\nthe copy\n\n## Alpha\nthe note\n');
        return {pane: one, text: (t)=>`## Alpha\nthe copy\n\n## ${t}\nthe note\n`};
    }],
]) {
    test(`a note's Title backspaced and typed back keeps its Node, with a copy ${where}`, ()=>{
        const world = makeWorld();
        const {pane, text} = setup(world);
        const [note] = world.titled('Alpha');
        assert.equal(world.titled('Alpha').length, 1);
        assert.equal(note.textarea.value.trim(), 'the note', 'the copy took the note over');

        pane.cm.setValue(text('Alph'));
        pane.cm.setValue(text('Alpha'));
        pane.cm.setValue(text('Alpha') + 'and a new line\n');   // the typing moves on

        assert.equal(note.removed, false, 'the note was deleted');
        assert.deepEqual(world.titled('Alpha'), [note], 'the copy has the Title now');
        assert.equal(note.textarea.value.trim().split('\n')[0], 'the note');
    });
}

// Deleting the note right above a taken Title line moved the taken line up to where the note's
// Title line had been, and the note's Node stayed, waiting for it; typing on the line renamed it.
test("a deleted note's Node is let go, not handed to the taken line that moves up", ()=>{
    const world = makeWorld();
    const pane = world.addPane('Archive 1');
    pane.cm.setValue('## Alpha\na\n\n## Beta\nb\n\n## Alpha\ncopy\n');
    const [beta] = world.titled('Beta');

    pane.cm.setValue('## Alpha\na\n\n## Alpha\ncopy\n');
    assert.equal(beta.removed, true, "Beta's Node outlived its section");
    pane.cm.setValue('## Alpha\na\n\n## Alpha 2\ncopy\n');
    assert.equal(beta.getTitle(), 'Beta', "Beta's Node was renamed for another note");
});

test('in one Archive the first section with a Title owns it, and the later one is marked', ()=>{
    const world = makeWorld();
    const pane = world.addPane('Archive 1');
    pane.cm.setValue('## Alpha\nfirst\n\n## Beta\nb\n\n## Alpha\nsecond\n');
    pane.processor.processAs(world.Pass.rewrite);

    assert.equal(world.titled('Alpha').length, 1);
    // It was the later section's: the earlier fell off its card.
    assert.equal(world.titled('Alpha')[0].textarea.value.trim(), 'first');
    assert.deepEqual([...pane.processor.taken].map((t)=>[t.title, t.lineNo]), [['Alpha', 6]]);
});

test('typing a Title through one that is taken keeps the Node being written', ()=>{
    const world = makeWorld();
    const pane = world.addPane('Archive 1');
    const text = '## Alpha\nthe first\n\n';
    pane.cm.setValue(text + '## Alph');
    const writing = world.titled('Alph')[0];
    assert.ok(writing, 'a Node for the Title being typed');

    pane.cm.setValue(text + '## Alpha');
    assert.equal(writing.removed, false, 'passing through a taken Title deleted the Node being written');
    pane.cm.setValue(text + '## Alpha 2');
    assert.equal(writing.removed, false);
    assert.equal(writing.getTitle(), 'Alpha 2', 'and it is the same Node, not one made again elsewhere');
    assert.equal(world.titled('Alpha').length, 1);
});

test('a full pass lets go of a Node whose Title line is left taken', ()=>{
    const world = makeWorld();
    const pane = world.addPane('Archive 1');
    pane.cm.setValue('## Alpha\na\n\n## Alph');
    const writing = world.titled('Alph')[0];
    pane.cm.setValue('## Alpha\na\n\n## Alpha');

    pane.processor.processAs(world.Pass.rewrite);
    assert.equal(writing.removed, true, 'a save would have kept a Node no Title line names');
});

test('a Saved Graph with one Title in two Archives opens with the later renamed, each Node kept', ()=>{
    const world = makeWorld();
    // What the old code saved: a Node for each section, both titled Alpha -- Archive 2's
    // first in the Graph's order, to show the binding goes by body and not by position.
    const second = world.makeNode('Alpha');
    second.textarea.value = 'body two';
    const first = world.makeNode('Alpha');
    first.textarea.value = 'body one';

    const restore = (pane, text)=>{
        pane.processor.writeAs(world.Pass.restore, ()=>pane.cm.setValue(text));
        return pane.processor.applyRenames();
    };
    const one = world.addPane('Archive 1');
    assert.deepEqual([...restore(one, '## Alpha\nbody one\n')], []);
    const two = world.addPane('Archive 2');
    const gamma = world.makeNode('Gamma');
    const renamed = restore(two, '## Alpha\nbody two\n## Gamma\nsee [[Alpha]]\n');

    assert.deepEqual([...renamed].map((r)=>[r.from, r.to]), [['Alpha', 'Alpha (2)']]);
    // Its Refs there with it: they meant this Archive's Alpha, and left alone drew their
    // Edges to the other's.
    assert.equal(two.cm.getValue(), '## Alpha (2)\nbody two\n## Gamma\nsee [[Alpha (2)]]\n',
        'the later line, and the Refs in its Archive, are renamed in the text');
    assert.equal(first.getTitle(), 'Alpha');
    assert.equal(second.getTitle(), 'Alpha (2)', 'and the second Node with it, so it keeps its place');
    assert.equal(world.live().length, 3, 'no Node was made or lost');
    assert.equal(gamma.removed, false);
    assert.equal(one.processor.wrapPerTitle['Alpha'].node, first);
    assert.equal(two.processor.wrapPerTitle['Alpha (2)'].node, second);
});

test('a new Title is made unique across every Archive, in any case', ()=>{
    const world = makeWorld();
    world.addPane('Archive 1').cm.setValue('## Alpha\na\n\n## Alpha (2)\nb\n');
    world.addPane('Archive 2').cm.setValue('## alpha (3)\nc\n');

    assert.equal(world.sandbox.getUniqueNodeTitle('ALPHA'), 'ALPHA (4)');
    assert.equal(world.sandbox.getUniqueNodeTitle('Beta'), 'Beta');
});

test('an AI Node shares the namespace', ()=>{
    const world = makeWorld();
    world.addPane('Archive 1').cm.setValue('## Helper\nnote\n');
    const two = world.addPane('Archive 2');
    two.cm.setValue('AI: Helper\nprompt\n');

    assert.equal(world.live().length, 1, 'an AI line with a note\'s Title made a second Node');
    assert.equal(two.processor.taken.length, 1);
});

// When a line becomes a Title line, the note above it loses the lines below: its card has to
// follow. The first keystroke of "##" put "#" on the card above, and it stayed there.
test('a new Title line takes its lines off the card above it', ()=>{
    const world = makeWorld();
    const pane = world.addPane('Archive 1');
    pane.cm.setValue('## Alpha\nthe first\n\n');
    pane.cm.setValue('## Alpha\nthe first\n\n#');
    pane.cm.setValue('## Alpha\nthe first\n\n## A');

    assert.equal(world.titled('Alpha')[0].textarea.value, 'the first\n');
});

// A rename on the Graph rewrites the Title line that is the Node's -- the first, in its own
// Pane -- and every Ref to it. It rewrote every Title line with the name, so a taken copy
// further down, or in a linked note's Archive, was renamed along with it.
test('a rename rewrites the Node\'s own Title line and the Refs, not a taken copy', ()=>{
    const src = read('js/zettelkasten/zettelkasten.js');
    const sandbox = {Tag: {node: '##', ref: '[['}, getClosingBracket: ()=>']]'};
    vm.runInNewContext([
        "RegExp.escape = (s)=>s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
        slice(src, 'function replaceInBrackets(', 'replaceInBrackets'),
        slice(src, 'function renameNode(', 'renameNode'),
        'globalThis.renameNode = renameNode'
    ].join('\n;\n'), sandbox, {filename: 'rename.js'});

    const pane = '## Alpha\na\n\n## Beta\nsee [[Alpha]]\n\n## Alpha\ntaken copy\n';
    assert.equal(sandbox.renameNode('Alpha', 'Alpha one')(pane),
        '## Alpha one\na\n\n## Beta\nsee [[Alpha one]]\n\n## Alpha\ntaken copy\n');
    assert.equal(sandbox.renameNode('Alpha', 'Alpha one', false)('## Alpha\ncopy [[Alpha]]\n'),
        '## Alpha\ncopy [[Alpha one]]\n', 'in another Pane only the Refs change');
});

test('an edit on another line lets go of a Node left on a taken Title line', ()=>{
    const world = makeWorld();
    const pane = world.addPane('Archive 1');
    pane.cm.setValue('## Alpha\na\n\n## Alph');
    const writing = world.titled('Alph')[0];
    pane.cm.setValue('## Alpha\na\n\n## Alpha');
    assert.equal(writing.removed, false, 'the line is still being typed');

    pane.cm.setValue('## Alpha\na\n\n## Alpha\nand now its body');
    assert.equal(writing.removed, true, 'a card for a Title no line names was left on the Graph');
});
