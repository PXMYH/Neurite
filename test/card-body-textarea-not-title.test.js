// Pins that `TextNode.init` finds a card's *body* textarea and never its title.
//
// A card holds three textareas. In markup order they are the title, the body
// (`.node-textarea`, which `node.textarea` must be), and the `.editable-div` the reader
// types into. `querySelector('textarea')` returns the first of those three -- the title.
//
// That was harmless only while the title was an `<input>`. `NodeView.upgradeTitleInputElement`
// made it a `<textarea>` so a long title could wrap, and from that commit on `node.textarea`
// *was* the title element. Everything downstream reads `node.textarea` as the body:
// `TextArea.ofNode` hands it to the Zettelkasten sync, `handlePlainTextAndReferences` appends
// each body line to it, and the saved graph is written from it. So body text was appended to
// the title bar, the real body textarea stayed empty, and the card was then blanked from that
// empty copy on the next pass. One root cause behind three separate reports: a title that
// keeps only the last character typed, body text that turns into a `##` heading, and a second
// note whose first keystroke wipes the first note.
//
// The fake below serves selectors the way a real DOM does -- `'textarea'` yields the title,
// because the title comes first -- so this test fails against the tag selector rather than
// quietly agreeing with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const NODE_SRC = readFileSync(join(ROOT, 'js/nodes/nodetypes/textnodes/textnode.js'), 'utf8');
const ZET_SRC = readFileSync(join(ROOT, 'js/zettelkasten/zettelkasten.js'), 'utf8');

function slice(src, what, start){
    const from = src.indexOf(start);
    assert.notEqual(from, -1, what + ' should be declared as `' + start + '`');
    const to = src.indexOf('\n}\n', from);
    assert.notEqual(to, -1, what + ' should close at column 0');
    return src.slice(from, to + 2);
}

// Markup order matters and is the whole point, so the fake keeps it: a selector that
// matches more than one element yields the earliest, exactly as `querySelector` does.
function makeNode(){
    const title = {name: 'title', value: '', classList: ['title-input']};
    const body = {name: 'body', value: '', classList: ['custom-scrollbar', 'node-textarea']};
    const card = {name: 'card', value: '', placeholder: '', classList: ['editable-div']};
    const inOrder = [title, body, card];

    const matches = (el, sel)=>(
        sel === 'textarea' ? true : el.classList.includes(sel.replace(/^\./, ''))
    );
    const parts = {
        '.syntax-display-div': {},
        '#html-iframe': {},
        '#python-frame': {},
        '#text-syntax-wrapper': {}
    };
    return {
        title, body, card,
        content: {
            querySelector(sel){
                if (sel in parts) return parts[sel];
                return inOrder.find((el)=>matches(el, sel)) ?? null;
            }
        }
    };
}

function load(){
    const sandbox = {
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

test('node.textarea is the body, not the title that shares its tag', ()=>{
    const TextNode = load();
    const node = makeNode();

    TextNode.init(node);

    assert.equal(node.textarea, node.body,
        'init should bind the body textarea, not the title');
    assert.notEqual(node.textarea, node.title,
        'the title comes first in the markup, so a tag selector would return it');
});

test('the fake would hand back the title for a tag selector', ()=>{
    // Without this the test above can pass for the wrong reason: a fake that never offers
    // the title cannot catch a selector that asks for it. This is the negative control.
    const node = makeNode();

    assert.equal(node.content.querySelector('textarea'), node.title,
        'markup order puts the title first, which is what makes the tag selector wrong');
    assert.equal(node.content.querySelector('.node-textarea'), node.body);
});

test('the builder and init agree on the class that names the body', ()=>{
    // The producer and the consumer are in the same file but not the same function, and
    // renaming the class in one place alone restores the bug in full silence.
    const create = slice(NODE_SRC, 'TextNode.create', '    static create(');
    const init = slice(NODE_SRC, 'TextNode.init', '    static init(');

    assert.match(create, /Html\.make\.textarea\([^)]*node-textarea/,
        'create should build the body textarea with the node-textarea class');
    assert.match(init, /querySelector\('\.node-textarea'\)/,
        'init should find the body by that class');
    assert.doesNotMatch(init.replace(/\/\/[^\n]*/g, ''), /querySelector\('textarea'\)/,
        'a bare tag selector returns the title, which is also a textarea');
});

test('the Zettelkasten sync really does read node.textarea as the body', ()=>{
    // Why the binding above matters. If this stops being true, the blast radius of getting
    // `node.textarea` wrong changes and this test is no longer guarding what it claims to.
    assert.match(ZET_SRC, /TextArea\.ofNode\s*=\s*function\s*\(node\)\s*\{\s*return\s*\(node\.isLLM\s*\?\s*node\.promptTextArea\s*:\s*node\.textarea\)/,
        'TextArea.ofNode should hand a text node its own textarea');
});
