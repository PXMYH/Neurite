// Pins that a card's body shows prose and not the edges written into it.
//
// A text node keeps its body twice. `node.textarea` is the whole of it and is what
// the notes pane, the saved graph and `handleRefTags` read; `.editable-div` is the
// copy on the card, and the highlight overlay is rebuilt from that copy. So the
// card can show less than the note holds -- and a line that is nothing but
// `[[Title]]` is exactly that: the card already lists its links as chips under the
// title, so the markup is the same fact twice.
//
// What must not break is the other direction. The card never held those lines, so
// typing in it must not read as deleting them, or the next Zettelkasten pass drops
// the edges they stood for. The round trip is asserted first, before anything else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PARSER_SRC = readFileSync(join(ROOT, 'js/zettelkasten/zetcodemirror.js'), 'utf8');
const SYNC_SRC = readFileSync(join(ROOT, 'js/nodes/nodetypes/textnodes/contenteditable.js'), 'utf8');

// A named declaration, lifted out of the file it ships in.
function slice(src, what, start){
    const from = src.indexOf(start);
    assert.notEqual(from, -1, what + ' should be declared as `' + start + '`');
    const to = src.indexOf('\n}\n', from);
    assert.notEqual(to, -1, what + ' should close at column 0');
    return src.slice(from, to + 2);
}

// Enough of a textarea to be synced: a value, a selection, and a note of every
// event dispatched on it -- the sync uses one to tell the other side it moved.
// It also delivers those events to whatever `On.*` registered, because the guard
// against dropped keystrokes lives in a listener and not in the sync itself.
function makeArea(value = ''){
    const listeners = {};
    const area = {
        value,
        selectionStart: 0,
        selectionEnd: 0,
        events: [],
        scrollTop: 0,
        scrollLeft: 0,
        setSelectionRange(start, end){
            area.selectionStart = start;
            area.selectionEnd = end;
        },
        addEventListener(type, cb){ (listeners[type] ||= []).push(cb) },
        dispatchEvent(e){
            area.events.push(e.type);
            for (const cb of listeners[e.type] || []) cb(e);
            return true;
        },
        fire(type){ return area.dispatchEvent({type, target: area}) }
    };
    return area;
}

// `Tag.ref` is user-settable, and whether it has a closing bracket decides how a
// ref is written: `[[Title]]` on its own, or one comma-separated list per note.
function load(refTag = '[['){
    const doc = {activeElement: null, addEventListener(){}};
    const sandbox = {
        Tag: {node: '##', ref: refTag},
        tagValues: {get refTag(){ return sandbox.Tag.ref }},
        bracketsMap: {'[[': ']]', '((': '))', '{{': '}}'},
        PROMPT_IDENTIFIER: '​',
        PROMPT_END: '‎',
        Event: class { constructor(type){ this.type = type } },
        Logger: {debug(){}, info(){}, warn(){}, err(){}},
        // The wiring's collaborators, no more of each than it touches.
        document: doc,
        controls: {altKey: {value: 'Alt'}},
        debounce: (fn)=>fn,
        ZetSyntaxDisplay: {
            syncAndHighlight(displayDiv, area){ displayDiv.painted = area.value }
        },
        On: ['blur', 'change', 'focus', 'input', 'keydown', 'keyup', 'mousedown',
             'paste', 'scroll', 'visibilitychange'].reduce((on, name)=>{
            on[name] = (target, cb, options)=>target.addEventListener(name, cb, options);
            return on;
        }, {})
    };
    vm.runInNewContext([
        // Node 22 has no `RegExp.escape`, which a static field in the class calls.
        "if (!RegExp.escape) RegExp.escape = (s)=>s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
        // Declared beside the two functions, outside either slice.
        'var isEditableDivProgrammaticChange = false',
        'var isHiddenTextareaProgrammaticChange = false',
        slice(PARSER_SRC, 'RegExp.forNodeTitle', 'RegExp.forNodeTitle = function('),
        slice(PARSER_SRC, 'escapeRegExp', 'function escapeRegExp('),
        slice(PARSER_SRC, 'ZettelkastenParser', 'class ZettelkastenParser {'),
        slice(SYNC_SRC, 'syncInputTextareaWithHiddenTextarea',
              'function syncInputTextareaWithHiddenTextarea('),
        slice(SYNC_SRC, 'syncHiddenTextareaWithInputTextarea',
              'function syncHiddenTextareaWithInputTextarea('),
        slice(SYNC_SRC, 'addEventsToUserInputTextarea',
              'function addEventsToUserInputTextarea('),
        'globalThis.exported = {ZettelkastenParser, addEventsToUserInputTextarea,'
        + ' syncInputTextareaWithHiddenTextarea, syncHiddenTextareaWithInputTextarea}'
    ].join('\n;\n'), sandbox, {filename: 'cardBodySync.js'});
    return {...sandbox.exported, document: doc};
}

// A card wired to its note the way `TextNode.init` wires them, with the focus the
// browser would have. Returns the pair plus the overlay the highlight is painted on.
function wire(noteText, {focused = false} = {}){
    const {addEventsToUserInputTextarea: wireUp, document: doc} = load();
    const note = makeArea(noteText);
    const card = makeArea('');
    const displayDiv = makeArea('');

    wireUp(card, note, {}, displayDiv);
    if (focused) doc.activeElement = card;
    return {note, card, displayDiv, doc};
}

const {ZettelkastenParser: Parser} = load();
const split = (text)=>Parser.splitTrailingRefs(text);

// Every shape the split has to get right, and what the card should show of each.
const SHAPES = [
    ['only a link', '[[Fractal geometry]]\n', ''],
    ['a link under prose', 'A note is worth its links.\n[[Fractal geometry]]\n',
        'A note is worth its links.'],
    ['two links on one line', 'Prose.\n[[Fractal geometry]] [[Mandelbrot set]]\n', 'Prose.'],
    ['a link line per link', 'Prose.\n[[Fractal geometry]]\n[[Mandelbrot set]]\n', 'Prose.'],
    // The words are the sentence, so the sentence stays whole. Nothing is cut, so
    // the text's own final newline is not cut either.
    ['a mention inside a sentence', 'It leans on [[Fractal geometry]] mostly.\n',
        'It leans on [[Fractal geometry]] mostly.\n'],
    ['a link line above prose', '[[Fractal geometry]]\nProse under it.\n',
        '[[Fractal geometry]]\nProse under it.\n'],
    ['no links at all', 'Just prose.\n\n\n', 'Just prose.\n\n\n'],
    ['nothing', '', ''],
    ['blank lines under a link', 'Prose.\n[[Fractal geometry]]\n\n\n', 'Prose.']
];

test('the halves are the note again, whatever the shape', ()=>{
    // Nothing below matters if this fails: the refs are put back from this half,
    // so a byte lost here is a byte lost from the note.
    for (const [what, text] of SHAPES) {
        const {body, refs} = split(text);
        assert.equal(body + refs, text, what + ' must split without losing a byte');
    }
});

test('the card shows the prose and not the link lines', ()=>{
    for (const [what, text, shown] of SHAPES) {
        assert.equal(split(text).body, shown, what);
    }
});

test('a comma-separated ref line is dropped too', ()=>{
    // With a ref tag that has no closing bracket, every link of a note shares one
    // line, and that line is still nothing but links.
    const {ZettelkastenParser: P} = load('ref:');
    const text = 'A note is worth its links.\nref: Fractal geometry, Mandelbrot set\n';

    const {body, refs} = P.splitTrailingRefs(text);

    assert.equal(body, 'A note is worth its links.');
    assert.equal(body + refs, text);
});

test('the card is handed the prose only', ()=>{
    const {syncInputTextareaWithHiddenTextarea: toCard} = load();
    const note = makeArea('A note is worth its links.\n[[Fractal geometry]]\n');
    const card = makeArea('');

    toCard(card, note);

    assert.equal(card.value, 'A note is worth its links.');
    assert.deepEqual(card.events, ['input'], 'the overlay is rebuilt from that event');
});

test('typing in the card keeps the links it never showed', ()=>{
    const {syncHiddenTextareaWithInputTextarea: toNote} = load();
    const note = makeArea('A note is worth its links.\n[[Fractal geometry]]\n');
    const card = makeArea('A note is worth its links, and its words.');

    toNote(note, card);

    assert.equal(note.value,
        'A note is worth its links, and its words.\n[[Fractal geometry]]\n');
});

test('prose typed into a card that had none gets a line of its own', ()=>{
    // The whole note was one link line, so there was no newline above it to reuse.
    const {syncHiddenTextareaWithInputTextarea: toNote} = load();
    const note = makeArea('[[Fractal geometry]]\n');
    const card = makeArea('Now it says something.');

    toNote(note, card);

    assert.equal(note.value, 'Now it says something.\n[[Fractal geometry]]\n',
        'the prose and the link must not run together on one line');
});

test('a card with no prose is not a note with no links', ()=>{
    // The empty card is what the reader sees of a note that is only an edge, so
    // syncing it back must not read as clearing the note.
    const {syncHiddenTextareaWithInputTextarea: toNote} = load();
    const note = makeArea('[[Fractal geometry]]\n');
    const card = makeArea('');

    toNote(note, card);

    assert.equal(note.value, '[[Fractal geometry]]\n');
});

test('clearing the prose under a link leaves the link', ()=>{
    const {syncHiddenTextareaWithInputTextarea: toNote} = load();
    const note = makeArea('A note is worth its links.\n[[Fractal geometry]]\n');
    const card = makeArea('');

    toNote(note, card);

    assert.equal(note.value, '[[Fractal geometry]]\n');
});

test('a mention inside a sentence is left in the card to be read', ()=>{
    // It is prose, and it is what `ZetPromote` wrote; hiding it would hide words
    // the reader typed.
    const {syncInputTextareaWithHiddenTextarea: toCard} = load();
    const note = makeArea('It leans on [[Fractal geometry]] mostly.\n');
    const card = makeArea('');

    toCard(card, note);

    assert.equal(card.value, 'It leans on [[Fractal geometry]] mostly.\n');
});

test('the caret does not move when the card is refilled', ()=>{
    // The card's copy is a prefix of the note, so one offset means one position in
    // both -- which is the whole reason only trailing lines are cut.
    const {syncInputTextareaWithHiddenTextarea: toCard} = load();
    const note = makeArea('A note is worth its links.\n[[Fractal geometry]]\n');
    const card = makeArea('A note is worth its link.');
    card.setSelectionRange(24, 24);

    toCard(card, note);

    assert.equal(card.value.slice(0, 24), 'A note is worth its link');
    assert.equal(card.selectionStart, 24);
    assert.equal(card.selectionEnd, 24);
});

// The note's own text, one keystroke behind the card: what a Zettelkasten pass
// hands back through `TextArea.update`, which dispatches `change` on the note.
const STALE = 'A note is worth its links. Ye\n[[Fractal geometry]]\n';

test('the echo does not overwrite the card being typed into', ()=>{
    // The card writes the note, the note rewrites the pane, a pass rewrites the note,
    // and that arrives back here as `change`. Applying it while the reader is still
    // typing dropped whatever they typed in between -- one character, silently.
    const {note, card} = wire('A note is worth its links.\n[[Fractal geometry]]\n',
                              {focused: true});

    card.value = 'A note is worth its links. Yes';
    card.fire('input');
    assert.equal(note.value, 'A note is worth its links. Yes\n[[Fractal geometry]]\n',
        'the keystroke should have reached the note first');

    note.value = STALE;
    note.fire('change');

    assert.equal(card.value, 'A note is worth its links. Yes',
        'the stale echo must not take the last character back off the card');
});

test('an unfocused card still takes the note\'s changes', ()=>{
    // The other half of the guard. Silencing the echo altogether would pass the test
    // above and leave a card that never follows its note.
    const {note, card, displayDiv} = wire('Old.\n[[Fractal geometry]]\n');

    note.value = 'Written from somewhere else.\n[[Fractal geometry]]\n';
    note.fire('change');

    assert.equal(card.value, 'Written from somewhere else.');
    assert.equal(displayDiv.painted, 'Written from somewhere else.',
        'the overlay is what the reader actually sees');
});

test('blur catches the card up on what it missed', ()=>{
    // Focus held the echo off, so a note that moved on -- an AI streaming into it --
    // left the card behind. Losing focus is when there is no keystroke left to lose.
    const {note, card, displayDiv, doc} = wire('Old.\n[[Fractal geometry]]\n',
                                               {focused: true});

    note.value = 'Streamed in while focused.\n[[Fractal geometry]]\n';
    note.fire('change');
    assert.equal(card.value, 'Old.', 'the echo is held off while the card has focus');

    doc.activeElement = null;
    card.fire('blur');

    assert.equal(card.value, 'Streamed in while focused.');
    assert.equal(displayDiv.painted, 'Streamed in while focused.');
});

test('a full round trip keeps every link and then settles', ()=>{
    // Two hazards, one test. A ref lost on the way back deletes an edge on the next
    // Zettelkasten pass; a newline added on the way back is added again every sync,
    // and the note grows a blank line at a time. The formula is deliberately not
    // restated here -- copying it would assert only that it equals itself.
    const {
        syncInputTextareaWithHiddenTextarea: toCard,
        syncHiddenTextareaWithInputTextarea: toNote
    } = load();

    for (const [what, text] of SHAPES) {
        const note = makeArea(text);
        const card = makeArea('');
        toCard(card, note);
        toNote(note, card);
        const first = note.value;

        assert.equal(split(first).refs.trim(), split(text).refs.trim(),
            what + ' must come back through the card with every link intact');

        toCard(card, note);
        toNote(note, card);
        assert.equal(note.value, first, what + ' must not drift on a second pass');
    }
});
