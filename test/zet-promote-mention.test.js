// Pins promote-a-mention: the chip that turns a plainly-written note title into a
// reference without anyone typing the ref tag.
//
// The whole operation is a character-offset splice into a textarea, driven from a
// span in a *different* element -- the highlight overlay, which is rebuilt from
// that textarea on every keystroke. A span carries no offset of its own, so the
// offset is measured with a Range and then read back. If that read-back is ever
// skipped, a drifted measurement splices brackets into the middle of a sentence
// instead of failing, which is why the drift case below is a test and not a
// comment.
//
// ZetPromote is a plain class declaration that touches the app only from inside
// its methods, so the class body alone evaluates in a sandbox with a fake card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel)=>readFileSync(join(ROOT, rel), 'utf8');

const ZETSYNTAX = 'js/zettelkasten/zetsyntax.js';

// The smallest fake of the two-layer card editor this walks: a hidden-in-plain-
// sight textarea holding the text, an overlay of spans above it, and a card title.
//
// `rangeLength` is what the fake Range reports for the distance from the overlay's
// start to the span's start -- the real one measures the overlay's text. Passing a
// wrong value is how the drift test lies to the code under test.
function makeCard({text, title, ownTitle = 'Some other note', rangeLength}){
    const events = [];
    const clicks = new Map();

    const style = {};
    const btn = {
        classList: {contains: (c)=>(c === 'zet-promote')},
        style,
        textContent: '',
        title: '',
        offsetWidth: 30,
        offsetHeight: 17,
        isConnected: false,
        parentElement: null,
        remove(){ btn.isConnected = false; btn.parentElement = null }
    };

    const textarea = {
        className: 'editable-div',
        value: text,
        dispatchEvent(e){ events.push({type: e.type, value: textarea.value}) }
    };
    const titleInput = {className: 'title-input', value: ownTitle};
    const windowDiv = {querySelector: (sel)=>(sel === '.title-input' ? titleInput : null)};
    const overlay = {scrollTop: 0, scrollLeft: 0};
    const wrapper = {
        clientWidth: 284,
        querySelector: (sel)=>(sel === '.editable-div' ? textarea : null),
        closest: (sel)=>(sel === '.window' ? windowDiv : null),
        contains: (el)=>(el === textarea || el === overlay),
        appendChild(el){ el.isConnected = true; el.parentElement = wrapper }
    };
    const span = {
        classList: {contains: (c)=>(c === 'node-title-sd')},
        textContent: title,
        isConnected: true,
        offsetTop: 28, offsetHeight: 18, offsetLeft: 40, offsetWidth: 96,
        closest: (sel)=>({'.editor-wrapper': wrapper, '.syntax-display-div': overlay}[sel] ?? null)
    };

    const measured = (rangeLength !== undefined ? rangeLength : text.indexOf(title));
    assert.notEqual(measured, -1, 'the fixture text should contain the title');

    const warnings = [];
    const sandbox = {
        document: {createRange: ()=>({setStart(){}, setEnd(){}, toString: ()=>'x'.repeat(measured)})},
        bracketsMap: {'[[': ']]'},
        tagValues: {refTag: '[['},
        Logger: {debug(){}, info(){}, warn(...a){ warnings.push(a.join(' ')) }, err(){}},
        Html: {make: {button: ()=>btn}},
        On: {click(target, cb){ clicks.set(target, cb) }, mousedown(){}},
        // The DOM constructor, with the app's static helper hung off it as
        // globals.js does. `new Event('input')` is what a keystroke fires.
        Event: Object.assign(class { constructor(type){ this.type = type } },
                             {stopPropagation(){}})
    };

    return {sandbox, span, btn, overlay, textarea, events, warnings, clicks};
}

// The class body, lifted out of the file it ships in.
function loadPromote(sandbox){
    const src = read(ZETSYNTAX);
    const start = src.indexOf('class ZetPromote {');
    assert.notEqual(start, -1, 'ZetPromote should be a class declaration');
    const end = src.indexOf('\n}\n', start);
    assert.notEqual(end, -1, 'the class body should close at column 0');

    vm.runInNewContext(
        src.slice(start, end + 2) + '\n;globalThis.exported = ZetPromote;',
        sandbox, {filename: 'ZetPromote.js'}
    );
    return sandbox.exported;
}

// Hover the mention, then click the chip -- the two real entry points.
function hoverAndClick(card){
    const ZetPromote = loadPromote(card.sandbox);
    ZetPromote.onMouseOver({target: card.span});
    const shown = card.btn.isConnected;
    const onClick = card.clicks.get(card.btn);
    if (onClick) onClick();
    return {ZetPromote, shown};
}

test('promoting a bare mid-sentence mention wraps the words already written', ()=>{
    const card = makeCard({
        text: 'A note is worth its links, and Fractal geometry is the one it leans on.',
        title: 'Fractal geometry'
    });

    const {shown} = hoverAndClick(card);

    assert.equal(shown, true, 'hovering a mention should offer the chip');
    assert.equal(card.btn.textContent, '[[ ]]', "the chip's label is the markup it inserts");
    assert.equal(
        card.textarea.value,
        'A note is worth its links, and [[Fractal geometry]] is the one it leans on.',
        'the tag must wrap the existing words in place, not append a line'
    );
    // The card's own input handler is the only path to the sync engine, so without
    // this event the text changes and no edge is ever drawn.
    assert.deepEqual(card.events.map((e)=>e.type), ['input']);
    assert.equal(card.events[0].value, card.textarea.value, 'the event must carry the new text');
    assert.deepEqual(card.warnings, [], 'a clean promotion warns about nothing');
});

test('a mention already inside the tag is not promoted again', ()=>{
    // `applyNodeTitleHighlighting` runs before the brackets are spanned, so it wraps
    // a title that is already a reference. Promoting that gives [[[[Title]]]].
    const text = 'Points at [[Fractal geometry]] and nowhere else.';
    const card = makeCard({text, title: 'Fractal geometry'});

    const {shown} = hoverAndClick(card);

    assert.equal(shown, false, 'no chip on a mention that is already a reference');
    assert.equal(card.textarea.value, text, 'the text must be untouched');
    assert.deepEqual(card.events, [], 'nothing to sync, so nothing to dispatch');
});

test('a measurement that does not read back is refused, not written', ()=>{
    // The negative control for the read-back assertion: the offset is off by six,
    // which without the check would splice the tag into the middle of a word.
    const text = 'A note is worth its links, and Fractal geometry is the one it leans on.';
    const card = makeCard({
        text, title: 'Fractal geometry',
        rangeLength: text.indexOf('Fractal geometry') + 6
    });

    const {shown} = hoverAndClick(card);

    assert.equal(shown, false, 'an offset that cannot be trusted offers no chip');
    assert.equal(card.textarea.value, text, 'a drifted offset must not corrupt the note');
    assert.deepEqual(card.events, [], 'nothing dispatched');
    assert.equal(card.warnings.length, 1, 'the refusal must be loud, not silent');
    assert.match(card.warnings[0], /Fractal geometry/);
});

test("a note mentioning its own title offers nothing", ()=>{
    const text = 'Fractal geometry is what this note is about.';
    const card = makeCard({text, title: 'Fractal geometry', ownTitle: 'Fractal geometry'});

    const {shown} = hoverAndClick(card);

    assert.equal(shown, false, 'an edge from a node to itself is not a link');
    assert.equal(card.textarea.value, text);
});

test('a ref tag with no closing bracket offers nothing', ()=>{
    // A bare tag like `Ref:` claims the rest of its line, so wrapping a phrase
    // mid-sentence with it would swallow the sentence around the mention.
    const text = 'A note is worth its links, and Fractal geometry is the one it leans on.';
    const card = makeCard({text, title: 'Fractal geometry'});
    card.sandbox.tagValues.refTag = 'Ref:';

    const {shown} = hoverAndClick(card);

    assert.equal(shown, false, 'no chip for a tag that cannot wrap a phrase');
    assert.equal(card.textarea.value, text);
    assert.deepEqual(card.warnings, [], 'declining early is not a failure to report');
});

// The chip floats over prose, so where it lands is the difference between an
// affordance and a thing that hides the sentence it belongs to.
const PLACEMENT_TEXT = 'A note is worth its links, and Fractal geometry is the one it leans on.';

test('the chip sits above its mention, not beside it', ()=>{
    const card = makeCard({text: PLACEMENT_TEXT, title: 'Fractal geometry'});

    loadPromote(card.sandbox).onMouseOver({target: card.span});

    // offsetTop 28, chip 17 tall: clear of the note's top edge, so above.
    assert.equal(card.btn.style.top, '11px');
    assert.equal(card.btn.style.left, '40px', "aligned with the mention's own left edge");
});

test('a mention on the first line gets its chip below instead', ()=>{
    const card = makeCard({text: PLACEMENT_TEXT, title: 'Fractal geometry'});
    card.span.offsetTop = 0;

    loadPromote(card.sandbox).onMouseOver({target: card.span});

    // No room above, so below the line rather than clipped off the top.
    assert.equal(card.btn.style.top, '18px');
});

test('the chip is pulled back inside a note body it would overflow', ()=>{
    const card = makeCard({text: PLACEMENT_TEXT, title: 'Fractal geometry'});
    card.span.offsetLeft = 270; // 284px body, 30px chip

    loadPromote(card.sandbox).onMouseOver({target: card.span});

    assert.equal(card.btn.style.left, '254px', 'clamped to clientWidth minus the chip');
});

test('the chip survives the pointer crossing the note text to reach it', ()=>{
    // It is not adjacent to the mention any more, so a strict "left the span"
    // rule would take it away before it could be clicked.
    const card = makeCard({text: PLACEMENT_TEXT, title: 'Fractal geometry'});
    const ZetPromote = loadPromote(card.sandbox);
    ZetPromote.onMouseOver({target: card.span});
    assert.equal(card.btn.isConnected, true, 'expected a chip to keep');

    ZetPromote.onMouseOut({target: card.span, relatedTarget: card.overlay});
    assert.equal(card.btn.isConnected, true, 'moving over the same note keeps it');

    ZetPromote.onMouseOut({target: card.span, relatedTarget: null});
    assert.equal(card.btn.isConnected, false, 'leaving the page takes it away');
});
