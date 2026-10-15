// Scroll up means zoom in, everywhere.
//
// Three things zoom on a wheel: the fractal, a card while Shift is held (`nodeModeKey` is
// Shift), and an edge. The fractal read `deltaY`; the other two read `e.wheelDelta`, which
// is the legacy property and carries the *opposite* sign -- +120 for a scroll up where
// `deltaY` is -120. So the same gesture zoomed into the plane and shrank the card on it.
//
// Pinned as an identity rather than as three separate sign checks: the three expressions
// have to stay the same expression, because the way this broke was one of them being
// written differently from the others and no one noticing which way it pointed.
//
// Two of them read the wheel through `Node.wheelTurn` now, the two a modifier gates: a card's
// resize and an Edge's length. macOS turns Shift and a mouse wheel into a scroll across, with
// `deltaY` 0, so they take `deltaX` where `deltaY` is 0. The canvas keeps `deltaY` alone, or a
// trackpad's swipe across would zoom it. The same sign either way: `deltaY` comes first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const files = {
    'js/interface/interface.js': read('js/interface/interface.js'),
    'js/nodes/nodeclass.js': read('js/nodes/nodeclass.js'),
    'js/nodes/edgeclass.js': read('js/nodes/edgeclass.js'),
};

// The comments beside these lines name the property that used to be read, so a scan for it
// has to read the code and not the prose -- otherwise the explanation of the bug is enough
// to report the bug.
const code = {};
for (const [path, src] of Object.entries(files)) {
    code[path] = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('nothing reads the legacy wheelDelta any more', ()=>{
    // Its sign is the reverse of `deltaY`'s, and it is non-standard. A synthetic
    // WheelEvent does not even reproduce it -- `wheelDelta` came back with `deltaY`'s own
    // sign in a constructed event -- so a test driving the wheel cannot see this bug and
    // only reading the source can.
    for (const [path, src] of Object.entries(code)) {
        assert.doesNotMatch(src, /wheelDelta/,
            path + ' reads e.wheelDelta again, whose sign is the opposite of deltaY\'s, so '
            + 'a scroll up there means the reverse of what it means everywhere else');
    }
});

test('all three zooms are the same expression', ()=>{
    // The canvas's, which a card zooms too when the wheel is not resizing it. It lives in one
    // function, `wheelZoomAmount` (interface.js), which takes a trackpad's pinch at its own
    // scale as well, and both wheel handlers call it -- so neither can drift from the other.
    const wanted = 'Math.exp(-e.deltaY * settings.zoomSpeed * settings.zoomSpeedMultiplier)';
    assert.ok(code['js/interface/interface.js'].includes(wanted),
        '`wheelZoomAmount` no longer zooms the canvas the way the canvas does. It must read: ' + wanted);
    for (const path of ['js/interface/interface.js', 'js/nodes/nodeclass.js']) {
        assert.match(code[path], /performZoom\(wheelZoomAmount\(e\),/,
            path + ' zooms the canvas on the wheel without `wheelZoomAmount`, so its wheel or a '
            + 'pinch over it can come to mean something else than over the rest of the canvas');
    }
    // Read with its comments, so a copy that comes back cannot hide behind a stripped line.
    assert.ok(!files['js/nodes/nodeclass.js'].includes(wanted),
        'js/nodes/nodeclass.js computes the canvas zoom itself again; call `wheelZoomAmount`');
    // A card's resize and an Edge's length, which a modifier gates.
    const gated = 'Math.exp(-Node.wheelTurn(e) * settings.zoomSpeed * settings.zoomSpeedMultiplier)';
    for (const path of ['js/nodes/nodeclass.js', 'js/nodes/edgeclass.js']) {
        assert.ok(code[path].includes(gated),
            path + ' no longer resizes the way the other modifier gesture does. It must read: ' + gated);
    }
    // And `Node.wheelTurn` is `deltaY` first, so all three read the same sign.
    assert.match(code['js/nodes/nodeclass.js'], /static wheelTurn\(e\)\{ return e\.deltaY \|\| e\.deltaX \}/,
        '`Node.wheelTurn` no longer reads deltaY first, or no longer falls back to deltaX');
});

test('the negation is on deltaY, which is what makes up mean in', ()=>{
    // `deltaY` is negative when the wheel goes up. Negating it makes the exponent
    // positive, so `amount > 1` -- which grows a card, lengthens an edge, and (because
    // `performZoom` inverts its argument) moves the plane closer.
    for (const [path, src] of Object.entries(code)) {
        assert.doesNotMatch(src, /Math\.exp\(e\.deltaY \*/,
            path + ' dropped the negation, so scrolling up now zooms out');
    }
    // And the comment that says why, in the two that were wrong: this is the third time a
    // sign convention in this file has had to be re-derived from scratch.
    assert.match(files['js/nodes/nodeclass.js'], /negative when the wheel goes up/,
        'the reason the exponent is negated is no longer written down beside it');
});
