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
    const wanted = 'Math.exp(-e.deltaY * settings.zoomSpeed * settings.zoomSpeedMultiplier)';
    for (const [path, src] of Object.entries(code)) {
        assert.ok(src.includes(wanted),
            path + ' no longer computes its zoom the same way as the other two. All three '
            + 'must read: ' + wanted);
    }
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
