// Pins that an empty card's hint comes from the code and not from the save file.
//
// A saved graph is the raw HTML of `#nodes` (`savenet.js`: `Elem.byId('nodes').innerHTML`),
// so every attribute a node carried at save time comes back with it -- `placeholder`
// included. That makes the builder the wrong place to set the hint: a node saved under one
// wording restores with that wording forever, however the source reads afterwards.
//
// `TextNode.init` is the one function both paths run through -- `TextNode.create` calls it,
// and so does `savenet.js` when it rehydrates (`if (node.isTextNode) TextNode.init(node)`).
// Setting the hint there is what makes a restored node agree with a new one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const NODE_SRC = readFileSync(join(ROOT, 'js/nodes/nodetypes/textnodes/textnode.js'), 'utf8');
const SYNC_SRC = readFileSync(join(ROOT, 'js/nodes/nodetypes/textnodes/contenteditable.js'), 'utf8');
const SAVE_SRC = readFileSync(join(ROOT, 'js/interface/dropdown/savenet.js'), 'utf8');

// A named declaration, lifted out of the file it ships in.
function slice(src, what, start){
    const from = src.indexOf(start);
    assert.notEqual(from, -1, what + ' should be declared as `' + start + '`');
    const to = src.indexOf('\n}\n', from);
    assert.notEqual(to, -1, what + ' should close at column 0');
    return src.slice(from, to + 2);
}

// `TextNode.init` reaches its pieces through `node.content.querySelector`, which is how a
// restored node's own saved elements reach it. So the fake serves elements by selector.
function makeNode(placeholder){
    const editable = {placeholder, addEventListener(){}, value: ''};
    const parts = {
        '.editable-div': editable,
        '.syntax-display-div': {},
        // The body is found by class, not by tag: a card's title is also a textarea and
        // comes first in the markup. See `card-body-textarea-not-title.test.js`.
        '.node-textarea': {value: ''},
        '#html-iframe': {},
        '#python-frame': {},
        '#text-syntax-wrapper': {}
    };
    return {
        content: {querySelector: (sel)=>parts[sel] ?? null},
        editable
    };
}

function load(){
    const sandbox = {
        // `init`'s only collaborator. The wiring itself is covered by its own test.
        addEventsToUserInputTextarea(){},
        Html: {make: {textarea: ()=>({}), div: ()=>({}), iframe: ()=>({})}},
        On: {mousedown(){}},
        Logger: {debug(){}, info(){}, warn(){}, err(){}}
    };
    vm.createContext(sandbox);
    vm.runInContext([
        slice(NODE_SRC, 'TextNode', 'class TextNode {'),
        'globalThis.exported = {TextNode}'
    ].join('\n;\n'), sandbox, {filename: 'textnode.js'});
    return sandbox.exported.TextNode;
}

test('a restored node takes the hint from the code, not from its saved attribute', ()=>{
    const TextNode = load();
    // What a graph saved before the wording changed hands back.
    const node = makeNode('Write here. [[Title]] links to another node.');

    TextNode.init(node);

    assert.equal(node.editable.placeholder, TextNode.PLACEHOLDER);
    assert.equal(node.contentEditableDiv, node.editable,
        'init should bind the card it just wrote to');
});

test('a node with no saved attribute is given the hint too', ()=>{
    const TextNode = load();
    const node = makeNode(undefined);

    TextNode.init(node);

    assert.equal(node.editable.placeholder, TextNode.PLACEHOLDER);
});

test('the hint invites writing and does not teach the reference tag', ()=>{
    const {PLACEHOLDER} = load();

    assert.match(PLACEHOLDER, /write/i, 'the hint should say the box is typeable');
    assert.doesNotMatch(PLACEHOLDER, /\[\[|\]\]/, 'the hint should not spell out a ref tag');
    assert.doesNotMatch(PLACEHOLDER, /link/i, 'the link strip is what offers linking');
});

test('the textarea builder sets no placeholder of its own', ()=>{
    // Setting it there would look like it works and would silently skip every restored
    // node, because `savenet.js` never calls the builder.
    const builder = slice(SYNC_SRC, 'createSyntaxTextarea', 'function createSyntaxTextarea(');

    assert.match(builder, /editable-div/,
        'the slice should be the builder, not some other function');
    assert.doesNotMatch(builder.replace(/\/\/[^\n]*/g, ''), /\.placeholder\s*=/,
        'the placeholder belongs in TextNode.init, which restore also runs');
});

test('restore really does route through TextNode.init', ()=>{
    // The whole reason the assignment sits in `init`. If this call goes away, a restored
    // node stops being given the hint at all and the tests above stop meaning anything.
    assert.match(SAVE_SRC, /node\.isTextNode\)\s*TextNode\.init\(node\)/,
        'savenet.js should call TextNode.init for a restored text node');
});
