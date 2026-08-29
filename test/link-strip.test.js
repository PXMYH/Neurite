// Pins the card's link strip: the row of chips that shows what a note connects to
// and lets that be changed without typing ref markup.
//
// Two properties matter more than the markup. First, the strip is a view and not a
// store: cutting a link must go through the edge, which rewrites the prose, and
// must never edit `node.edges` here -- a copy of the links kept on the card would
// be overwritten by the next Zettelkasten pass. Second, it repaints from a
// per-frame poll, so "nothing changed" has to cost nothing and "renamed elsewhere"
// has to be noticed.
//
// LinkStrip is a plain class whose statics touch the app only when called, so the
// class body alone evaluates in a sandbox with a fake card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel)=>readFileSync(join(ROOT, rel), 'utf8');

const LINKSTRIP = 'js/nodes/createnodes/linkstrip.js';

// The smallest element the code under test can be driven through: children in
// order, a settable `textContent` that clears them the way the DOM's does, a
// `nextSibling` so the insertion point can be asserted, and the one selector form
// the code actually asks for.
function makeElem(tag, className){
    const el = {
        tag,
        className: className ?? '',
        children: [],
        style: {},
        attrs: {},
        title: '',
        parent: null,
        text: '',
        setAttribute(k, v){ el.attrs[k] = v },
        append(...kids){
            for (const kid of kids) { kid.parent = el; el.children.push(kid) }
        },
        appendChild(kid){ el.append(kid); return kid },
        insertBefore(kid, ref){
            const i = (ref ? el.children.indexOf(ref) : -1);
            kid.parent = el;
            if (i < 0) el.children.push(kid);
            else el.children.splice(i, 0, kid);
            return kid;
        },
        querySelector(sel){
            const m = /^:scope > \.([\w-]+)$/.exec(sel);
            assert.ok(m, 'the fake only knows a direct-child class selector, got ' + sel);
            return el.children.find((c)=>(c.className === m[1])) ?? null;
        },
        get nextSibling(){
            const sibs = el.parent?.children;
            if (!sibs) return null;
            return sibs[sibs.indexOf(el) + 1] ?? null;
        },
        get textContent(){ return el.text },
        set textContent(v){ el.text = v; el.children.length = 0 }
    };
    return el;
}

const classesOf = (elem)=>elem.children.map((c)=>c.className);
const labelsOf = (strip)=>strip.children
    .filter((c)=>(c.className === 'link-chip'))
    .map((chip)=>chip.children[0].textContent);

// A windowified card, plus a node on the far end of each link. `edges` is what the
// strip reads; each edge records whether the app was asked to remove it.
function makeCard({title = 'This note', links = []} = {}){
    const div = makeElem('div', 'window');
    const header = makeElem('div', 'header-container');
    const body = makeElem('div', 'editor-wrapper');
    div.append(header, body);

    const forEachConnectedNode = function(cb, ct){
        for (const edge of this.edges) {
            const other = edge.pts.find((pt)=>(pt !== this));
            if (other) cb.call(ct, other);
        }
    };

    const node = {uuid: 'u-self', edges: [], forEachConnectedNode};
    const view = {model: node, div, headerContainer: header, titleInput: {value: title}};
    node.view = view;

    const removed = [];
    const others = links.map((linkTitle, i)=>{
        const other = {
            uuid: 'u-' + i,
            edges: [],
            view: {titleInput: {value: linkTitle}},
            forEachConnectedNode
        };
        const edge = {
            pts: [node, other],
            removeInstance(){ removed.push(linkTitle) }
        };
        node.edges.push(edge);
        other.edges.push(edge);
        return other;
    });

    const zoomed = [];
    const connectOpened = [];
    const warnings = [];
    const sandbox = {
        Html: {
            make: {
                div: (cls)=>makeElem('div', cls),
                span: (cls)=>makeElem('span', cls),
                button: (cls, text)=>{
                    const btn = makeElem('button', cls);
                    if (text !== undefined) btn.textContent = text;
                    return btn;
                }
            }
        },
        // Records the callback so a test can fire the real handler, and records
        // that a control was guarded against starting a card drag.
        On: {
            click(target, cb){ target.onClick = cb },
            mousedown(target, cb){ target.onMouseDown = cb }
        },
        Event: {stopPropagation(){}},
        Animation: {zoomToNodeTitle: (n)=>{ zoomed.push(n) }},
        Modal: {Connect: class { constructor(n){ connectOpened.push(n) } }},
        findExistingEdge: (a, b)=>(a.edges.find((e)=>e.pts.includes(b)) ?? null),
        Logger: {debug(){}, info(){}, warn(...a){ warnings.push(a.join(' ')) }, err(){}}
    };

    return {sandbox, view, node, others, div, header, body, removed, zoomed, connectOpened, warnings};
}

// The class body, lifted out of the file it ships in.
function loadStrip(sandbox){
    const src = read(LINKSTRIP);
    const start = src.indexOf('class LinkStrip {');
    assert.notEqual(start, -1, 'LinkStrip should be a class declaration');
    const end = src.indexOf('\n}\n', start);
    assert.notEqual(end, -1, 'the class body should close at column 0');

    vm.runInNewContext(
        src.slice(start, end + 2) + '\n;globalThis.exported = LinkStrip;',
        sandbox, {filename: 'LinkStrip.js'}
    );
    return sandbox.exported;
}

// One frame of the poll, and the strip it painted.
function paint(card){
    const LinkStrip = loadStrip(card.sandbox);
    LinkStrip.refresh(card.view);
    return {LinkStrip, strip: card.div.querySelector(':scope > .link-strip')};
}

test('a card shows one chip per note it links to', ()=>{
    const card = makeCard({links: ['Fractal geometry', 'Zettelkasten']});

    const {strip} = paint(card);

    assert.deepEqual(labelsOf(strip), ['Fractal geometry', 'Zettelkasten']);
    // Chips first, then the control that adds one: the row reads as content
    // followed by an affordance, not the other way round.
    assert.deepEqual(classesOf(strip), ['link-chip', 'link-chip', 'link-add']);
});

test('the strip sits between the header and the note body', ()=>{
    const card = makeCard({links: ['Fractal geometry']});

    const {strip} = paint(card);

    // A card's links belong to its title. Below the body they would be off the
    // bottom of a note long enough to scroll.
    assert.deepEqual(classesOf(card.div), ['header-container', 'link-strip', 'editor-wrapper']);
    assert.equal(card.header.nextSibling, strip);
});

test('a frame that changed nothing repaints nothing', ()=>{
    // The poll runs on every card on every frame, so an unchanged row must not
    // rebuild its DOM -- and rebuilding would also drop focus from the chip a
    // keyboard user is on.
    const card = makeCard({links: ['Fractal geometry']});
    const {LinkStrip, strip} = paint(card);
    const chipBefore = strip.children[0];

    LinkStrip.refresh(card.view);
    LinkStrip.refresh(card.view);

    assert.equal(card.div.querySelector(':scope > .link-strip'), strip, 'one strip, not three');
    assert.equal(strip.children[0], chipBefore, 'the chip was rebuilt with nothing to change');
});

test('a note renamed elsewhere relabels the chip pointing at it', ()=>{
    const card = makeCard({links: ['Fractal geometry']});
    const {LinkStrip} = paint(card);

    card.others[0].view.titleInput.value = 'Fractals';
    LinkStrip.refresh(card.view);

    const strip = card.div.querySelector(':scope > .link-strip');
    assert.deepEqual(labelsOf(strip), ['Fractals'],
        'the signature must cover titles, or a rename leaves a stale chip');
});

test('cutting a link goes through the edge and leaves node.edges alone', ()=>{
    // The prose is the store. Splicing the array here would put the card out of
    // step with the text, and the next pass would put the edge straight back.
    const card = makeCard({links: ['Fractal geometry']});
    const {strip} = paint(card);
    const cut = strip.children[0].children[1];

    assert.equal(cut.className, 'link-chip-cut');
    cut.onClick();

    assert.deepEqual(card.removed, ['Fractal geometry'], 'the edge must be asked to remove itself');
    assert.equal(card.node.edges.length, 1, 'the strip must not edit the edge list it renders');
    assert.deepEqual(card.warnings, [], 'a link that exists is cut without complaint');
});

test('cutting a link whose edge is already gone warns instead of throwing', ()=>{
    // The chips outlive their edges by up to a frame, so the click handler can
    // fire against an edge a Zettelkasten pass has already dropped.
    const card = makeCard({links: ['Fractal geometry']});
    const {strip} = paint(card);
    const cut = strip.children[0].children[1];

    card.node.edges.length = 0;
    cut.onClick();

    assert.deepEqual(card.removed, [], 'nothing to remove');
    assert.equal(card.warnings.length, 1, 'a missing edge must be reported, not swallowed');
    assert.match(card.warnings[0], /u-self/);
});

test('the add control opens the connect picker for this card', ()=>{
    const card = makeCard({links: ['Fractal geometry']});
    const {strip} = paint(card);
    const add = strip.children[strip.children.length - 1];

    assert.equal(add.className, 'link-add');
    add.onClick();

    assert.deepEqual(card.connectOpened, [card.node], 'the picker must be about this note');
});

test('the add control invites on an empty row and shrinks beside chips', ()=>{
    const empty = makeCard();
    const linked = makeCard({links: ['Fractal geometry']});

    const {strip: emptyStrip} = paint(empty);
    const {strip: linkedStrip} = paint(linked);

    // With nothing beside it, a bare glyph says nothing about what it adds.
    assert.deepEqual(classesOf(emptyStrip), ['link-add'], 'the row exists before any link does');
    assert.equal(emptyStrip.children[0].textContent, '+ link');
    assert.equal(linkedStrip.children[1].textContent, '+');
});

test('a chip goes to the note it names', ()=>{
    const card = makeCard({links: ['Fractal geometry', 'Zettelkasten']});
    const {strip} = paint(card);
    const label = strip.children[1].children[0];

    assert.equal(label.className, 'link-chip-label');
    label.onClick();

    assert.deepEqual(card.zoomed, [card.others[1]], 'the second chip must go to the second note');
});

test('a strip that came back with a saved graph is refilled, not duplicated', ()=>{
    // A card's DOM is what gets saved, so the row re-hydrates with chips in it --
    // and listeners do not serialize, so those chips are dead until replaced.
    const card = makeCard({links: ['Fractal geometry']});
    const stale = makeElem('div', 'link-strip');
    stale.append(makeElem('span', 'link-chip'));
    card.div.insertBefore(stale, card.body);

    const {strip} = paint(card);

    assert.equal(strip, stale, 'the saved strip is the one to fill');
    assert.equal(card.div.children.filter((c)=>c.className === 'link-strip').length, 1);
    assert.deepEqual(labelsOf(strip), ['Fractal geometry'], 'and its chips are live ones');
});

test('every control in the row refuses to drag the card', ()=>{
    // The note body is a drag handle, so a press on a chip would otherwise fling
    // the card across the canvas instead of activating the control.
    const card = makeCard({links: ['Fractal geometry']});
    const {strip} = paint(card);

    for (const child of strip.children) {
        assert.equal(typeof child.onMouseDown, 'function', child.className + ' must stop mousedown');
    }
});

test('a node with no card of its own is skipped', ()=>{
    // Not every node in the graph is windowified, and the poll calls this for all
    // of them.
    const card = makeCard({links: ['Fractal geometry']});
    const LinkStrip = loadStrip(card.sandbox);

    LinkStrip.refresh(undefined);
    LinkStrip.refresh({model: null, div: card.div});
    LinkStrip.refresh({model: card.node});

    assert.equal(card.div.querySelector(':scope > .link-strip'), null, 'nothing should have painted');
});
