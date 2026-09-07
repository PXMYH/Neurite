// Pins the two keyboard shortcuts that collapse and expand a card, and the state guard
// on each one.
//
// The guards are not defensive decoration, they prevent two real failures:
//   - `NodeView.expand` reads `dataset.originalSizes` through `JSON.parse`. On a card that
//     has never been collapsed that value is `undefined`, and `JSON.parse(undefined)` throws.
//   - `NodeView.collapse` *writes* `originalSizes` from the computed style. Running it on a
//     card that is already collapsed records the 60px circle as the original size, so the
//     next expand restores a 60px card and the real size is gone permanently.
// A no-op is therefore the correct answer for a card already in the requested state, and
// the two tests that assert the no-op are the ones worth having.
//
// Only the block this feature added is sliced in, so the rest of the file's DOM
// dependencies stay out of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'js/nodes/nodeinteraction/togglenodestate.js'), 'utf8');

// Anchored on the definition, not on a mention, so a rename fails loudly here rather than
// silently slicing nothing.
function sliceShortcutBlock(){
    const from = SRC.indexOf('NodeView.prototype.collapseIfExpanded = function(){');
    assert.notEqual(from, -1, 'collapseIfExpanded should be defined in togglenodestate.js');
    const to = SRC.indexOf('//Drag Box Selection', from);
    assert.notEqual(to, -1, 'the drag-box section should follow the shortcut block');
    const block = SRC.slice(from, to);
    assert.match(block, /On\.keydown\(window/, 'the slice should include the key handler');
    return block;
}

// `selected` and `pointerView` are filled in after loading, because a fake view has to
// inherit from the `NodeView` the sandbox creates.
function load(){
    let onKeyDown = null;
    const selected = [];
    const box = {pointerView: null};

    const NodeView = function(){};
    const sandbox = {
        NodeView,
        On: {mousemove(){}, keydown(_target, cb){ onKeyDown = cb }},
        controls: {controlKey: {value: 'Control'}, shiftKey: {value: 'Shift'}},
        App: {selectedNodes: {
            forEachView(cb, ct){ selected.forEach((v)=>cb.call(ct, v)) }
        }},
        Graph: {forEachNode(cb){ if (box.pointerView) cb({view: box.pointerView}) }},
        document: {
            elementFromPoint: ()=>(box.pointerView ? {closest: ()=>box.pointerView.div} : null)
        },
        window: {}
    };
    vm.createContext(sandbox);
    vm.runInContext(sliceShortcutBlock() + '\n;globalThis.exported = {NodeView}', sandbox,
                    {filename: 'togglenodestate-shortcuts.js'});

    // A real view is a `NodeView` instance, so the fake inherits from the same prototype
    // the shortcut methods land on. Built as a plain object it lacks them and the handler
    // dies with "view[method] is not a function" -- a fault in the fake, not the feature.
    const makeView = (collapsed)=>{
        const view = Object.create(sandbox.exported.NodeView.prototype);
        view.calls = [];
        view.div = {classList: {contains: (c)=>(c === 'collapsed' && collapsed)}};
        view.model = {content: {}};
        view.collapse = function(){ this.calls.push('collapse'); collapsed = true };
        view.expand = function(){ this.calls.push('expand'); collapsed = false };
        return view;
    };

    return {
        NodeView: sandbox.exported.NodeView,
        makeView,
        select: (...views)=>selected.push(...views),
        hover: (view)=>{ box.pointerView = view },
        fireKey: (e)=>{ onKeyDown(e); return e }
    };
}

const chord = (key, {ctrl = true, shift = true} = {})=>{
    const held = new Set();
    if (ctrl) held.add('Control');
    if (shift) held.add('Shift');
    return {
        key,
        getModifierState: (m)=>held.has(m),
        prevented: false,
        preventDefault(){ this.prevented = true },
        stopPropagation(){}
    };
};

test('collapse runs on an expanded card and is a no-op on a collapsed one', ()=>{
    const {NodeView, makeView} = load();

    const expanded = makeView(false);
    assert.equal(expanded.collapseIfExpanded(), true);
    assert.deepEqual(expanded.calls, ['collapse']);

    // The load-bearing one: a second collapse would overwrite originalSizes with 60px.
    const already = makeView(true);
    assert.equal(already.collapseIfExpanded(), false);
    assert.deepEqual(already.calls, [], 'collapse must not run twice on the same card');

    assert.equal(typeof NodeView.prototype.collapseIfExpanded, 'function',
        'the guard should live on the prototype, which is where a real view finds it');
});

test('expand runs on a collapsed card and is a no-op on an expanded one', ()=>{
    const {makeView} = load();

    const collapsed = makeView(true);
    assert.equal(collapsed.expandIfCollapsed(), true);
    assert.deepEqual(collapsed.calls, ['expand']);

    // Without this guard `JSON.parse(undefined)` throws inside `expand`.
    const already = makeView(false);
    assert.equal(already.expandIfCollapsed(), false);
    assert.deepEqual(already.calls, [], 'expand must not run on a card that is not collapsed');
});

test('Ctrl+Shift+M collapses and Ctrl+Shift+F expands the card under the pointer', ()=>{
    const {makeView, hover, fireKey} = load();
    const hovered = makeView(false);
    hover(hovered);

    const m = fireKey(chord('M'));
    assert.deepEqual(hovered.calls, ['collapse']);
    assert.equal(m.prevented, true, 'the chord is claimed so the browser does not act on it');

    fireKey(chord('F'));
    assert.deepEqual(hovered.calls, ['collapse', 'expand']);
});

test('the shifted and unshifted spellings of the key both work', ()=>{
    const {makeView, hover, fireKey} = load();
    const hovered = makeView(false);
    hover(hovered);

    fireKey(chord('m'));   // some layouts report the unshifted letter for a Control chord
    assert.deepEqual(hovered.calls, ['collapse']);
});

test('a selection is the target and beats whatever the pointer is over', ()=>{
    const {makeView, select, hover, fireKey} = load();
    const a = makeView(false), b = makeView(false), hovered = makeView(false);
    select(a, b);
    hover(hovered);

    fireKey(chord('M'));

    assert.deepEqual(a.calls, ['collapse']);
    assert.deepEqual(b.calls, ['collapse'], 'every selected card collapses, not just one');
    assert.deepEqual(hovered.calls, [], 'the hovered card is ignored while a selection exists');
});

test('other chords and bare modifiers are left alone', ()=>{
    const {makeView, hover, fireKey} = load();
    const hovered = makeView(false);
    hover(hovered);

    const noShift = fireKey(chord('M', {shift: false}));
    assert.deepEqual(hovered.calls, [], 'Ctrl+M alone is not the shortcut');
    assert.equal(noShift.prevented, false, 'a chord we do not own must reach the browser');

    const otherLetter = fireKey(chord('K'));
    assert.deepEqual(hovered.calls, []);
    assert.equal(otherLetter.prevented, false);
});

test('with nothing selected and nothing under the pointer, nothing happens', ()=>{
    const {fireKey} = load();
    assert.doesNotThrow(()=>fireKey(chord('M')));
    assert.doesNotThrow(()=>fireKey(chord('F')));
});
