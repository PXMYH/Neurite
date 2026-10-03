// One pinch on the Fractal (#55): the view that keeps the points of the Plane under both
// fingers under them, computed from where the fingers came down.
//
// There were two pinches, and an iPad ran both. The touch path grew |zoom| as the fingers
// spread -- zooming out -- and read its pivot in the wrong units, which flung the Plane;
// Safari's `gesturechange` pivoted on `pageX`/`pageY`, which WebKit leaves at 0. In a browser
// the old code turned a spread to twice the span into a zoom *out* of 0.95 with the points
// under the fingers thrown off, and let the page itself zoom to 4.8x; the new one zooms in by
// exactly two with both points held.
//
// `pinchView` works in screen units -- `xyToZ` without the pan and zoom -- where a point `s`
// of the screen shows the point `s·zoom + pan` of the Plane. That identity is what these
// tests check, since it is what "the Plane stays under the fingers" means.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (p)=> readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// vec2 the way test/vec2.test.js reaches it: mandelbrot.js against a stub DOM, with the
// lexical `class vec2` exported by a line appended to the same script.
const elem = { style: {}, getElementById: ()=> elem, setAttribute(){}, appendChild(){}, addEventListener(){} };
const sandbox = createContext({
    document: { body: { style: {} }, getElementById: ()=> elem, createElement: ()=> elem },
    Elem: { byId: ()=> elem },
    Svg: {},
    Logger: { info(){}, debug(){}, warn(){}, err(){} },
    On: new Proxy({}, { get: ()=> ()=>{} }),
    settings: {}
});
runInContext(read('js/mandelbrot/mandelbrot.js') + '\n;globalThis.vec2 = vec2;', sandbox);

const source = read('js/interface/interface.js');
const start = source.indexOf('function pinchView(');
assert.notEqual(start, -1, 'pinchView should be declared as a function in interface.js');
runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2) + '\n;globalThis.pinchView = pinchView;', sandbox);
const { vec2, pinchView } = sandbox;

const v = (x, y)=> new vec2(x, y);
const onPlane = (s, view)=> s.cmult(view.zoom).plus(view.pan);
const near = (actual, expected, msg)=>{
    assert.ok(actual.minus(expected).mag() < 1e-12,
        `${msg}: expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`);
};

// A view part way into the Plane, turned, so a sign or an order that only works at zoom 1,
// pan 0 cannot pass.
const view0 = { zoom: v(0.8, -0.3), pan: v(-0.4, 0.25) };
const pinchFrom = (a0, b0, a1, b1)=> pinchView(view0.zoom, view0.pan, a0, b0, a1, b1);

test('fingers spreading to twice their span zoom in by two', ()=>{
    const a0 = v(-0.1, 0.05), b0 = v(0.1, 0.05);
    const a1 = v(-0.2, 0.05), b1 = v(0.2, 0.05);
    const view = pinchFrom(a0, b0, a1, b1);

    // A smaller |zoom| is closer, as on the wheel, where `performZoom` divides it.
    assert.ok(Math.abs(view.zoom.mag() * 2 - view0.zoom.mag()) < 1e-12,
        `|zoom| should halve, from ${view0.zoom.mag()} to ${view0.zoom.mag() / 2}; got ${view.zoom.mag()}`);
    near(onPlane(a1, view), onPlane(a0, view0), 'the point under the first finger');
    near(onPlane(b1, view), onPlane(b0, view0), 'the point under the second finger');
});

test('fingers closing zoom out, and hold their points', ()=>{
    const a0 = v(-0.3, -0.1), b0 = v(0.2, 0.15);
    const a1 = v(-0.1, 0), b1 = v(0.05, 0.05);
    const view = pinchFrom(a0, b0, a1, b1);

    assert.ok(view.zoom.mag() > view0.zoom.mag(), 'closing the fingers should zoom out');
    near(onPlane(a1, view), onPlane(a0, view0), 'the point under the first finger');
    near(onPlane(b1, view), onPlane(b0, view0), 'the point under the second finger');
});

test('fingers turning about their midpoint turn the view and keep its scale', ()=>{
    // A quarter turn: the span (0.2, 0) becomes (0, 0.2).
    const m = v(0.05, -0.02);
    const a0 = m.minus(v(0.1, 0)), b0 = m.plus(v(0.1, 0));
    const a1 = m.minus(v(0, 0.1)), b1 = m.plus(v(0, 0.1));
    const view = pinchFrom(a0, b0, a1, b1);

    assert.ok(Math.abs(view.zoom.mag() - view0.zoom.mag()) < 1e-12, 'a turn alone should not zoom');
    near(view.zoom.cdiv(view0.zoom), v(0, -1), 'the zoom should turn by the opposite quarter');
    near(onPlane(a1, view), onPlane(a0, view0), 'the point under the first finger');
    near(onPlane(b1, view), onPlane(b0, view0), 'the point under the second finger');
});

test('two fingers moving together pan without zooming', ()=>{
    const d = v(0.07, -0.04);
    const a0 = v(-0.1, 0), b0 = v(0.1, 0.1);
    const view = pinchFrom(a0, b0, a0.plus(d), b0.plus(d));

    near(view.zoom, view0.zoom, 'the zoom');
    near(onPlane(a0.plus(d), view), onPlane(a0, view0), 'the point under the fingers');
});

test('a pinch that comes back to where it started leaves the view where it was', ()=>{
    // The view is computed from where the fingers came down, not stepped from the last move,
    // so however far the fingers wander there is nothing to accumulate.
    const a0 = v(-0.12, 0.03), b0 = v(0.09, -0.02);
    near(pinchFrom(a0, b0, a0, b0).zoom, view0.zoom, 'the zoom');
    near(pinchFrom(a0, b0, a0, b0).pan, view0.pan, 'the pan');
});

test('two fingers on one spot give no view instead of an infinite zoom', ()=>{
    assert.equal(pinchFrom(v(-0.1, 0), v(0.1, 0), v(0.02, 0.02), v(0.02, 0.02)), null);
});

test('there is one pinch: Safari\'s gesture events stand aside while a finger is on the Fractal', ()=>{
    // An iPad sends gesture events with every two-finger touch, and a second handler moving the
    // view would fight the first on every frame. A Mac's trackpad sends them with no touch at
    // all, which is the only case they are for.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const trackpad = code.slice(code.indexOf('const TrackpadPinch = {'), code.indexOf('On.gesturestart('));
    // Every finger counts, not only the Fractal's: a pinch over a card sends gesture events too.
    assert.match(code, /On\.pointerdown\(document, \(e\)=>\{ if \(e\.pointerType === 'touch'\) FingersDown\.add\(e\.pointerId\) \}, true\);/);
    assert.ok(trackpad.length > 0, 'TrackpadPinch is gone; this test reads nothing');
    assert.match(trackpad, /onStart\(e\)\{[\s\S]*?\(FingersDown\.size \|\| Modal\.current\?\.asks\) \? null/,
        'a gesture that starts with a finger down, or under a dialog that asks, is taken for a trackpad pinch');
    assert.match(trackpad, /onChange\(e\)\{[\s\S]*?if \(!start \|\| FingersDown\.size/,
        'a gesture that goes on while a finger is down moves the view beside the touch pinch');
    assert.doesNotMatch(code, /On\.touch(start|move|end|cancel)\(svg/,
        'the touch-event path is back beside the Pointer Events one');
});

test('a small turn of the fingers does not turn the view', ()=>{
    // No two fingers spread without turning a little. Taken out below `turnAfter`, the pinch is
    // a pure zoom: the view keeps its angle and the fingers' midpoint keeps its point.
    const start = source.indexOf('function turnedAboutMidpoint(');
    assert.notEqual(start, -1, 'turnedAboutMidpoint is gone');
    runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2)
        + '\n;globalThis.turnedAboutMidpoint = turnedAboutMidpoint;', sandbox);
    const a0 = v(-0.1, 0), b0 = v(0.1, 0);
    // Spread to twice the span and turned 0.1 rad, about the midpoint (0.02, 0.01).
    const m = v(0.02, 0.01), turn = v(Math.cos(0.1), Math.sin(0.1));
    const a1 = m.plus(v(-0.2, 0).cmult(turn)), b1 = m.plus(v(0.2, 0).cmult(turn));
    const [a, b] = sandbox.turnedAboutMidpoint(a1, b1, -0.1);
    const view = pinchFrom(a0, b0, a, b);
    near(view.zoom.cdiv(view0.zoom), v(0.5, 0), 'the view turned, or did not zoom by two');
    near(onPlane(m, view), onPlane(a0.plus(b0).scale(0.5), view0), "the midpoint's point moved");
});

test('the map keeps a pinch from the browser, on the Fractal and on the cards', ()=>{
    // Without it Chromium zoomed the page under the pinch and cancelled the pointers, and a
    // finger on a card hanging past the window's edge slid the whole page (rv15).
    assert.match(read('resources/styles/foundation.css'), /#svg_bg, \.window, \.window \*\s*\{\s*touch-action:\s*none;\s*\}/);
});
