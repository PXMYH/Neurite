// How the universe under the Fractal (js/mandelbrot/universe.ts) chooses its canvas resolution,
// and how it follows a pan deep in a zoom. Both read only numbers, so they run in a node:vm
// context with the file transpiled once (see test/zetsplit.test.js) and no WebGL at all: with no
// `#universe` element, `Universe.init` returns at its first line.
//
// The resolution: slow frames step it down, fast ones take it back up to the device's -- or to
// the most it was found fast at, which it tries to better again after a wait that doubles with
// each try that fails. Its first ceiling only ever went down, so a stall of the page's own (a big
// paste, the physics settling) cost a step for as long as the page was open; measured, two
// seconds of 30 ms frames left a 2x screen at 1.75 for good.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const path = 'js/mandelbrot/universe.ts';

function loadUniverse({dpr = 2} = {}){
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022}, fileName: path}).outputText;
    const clock = {now: 0};
    const sandbox = createContext({
        Elem: {byId: ()=>null},
        On: {}, Logger: {warn(){}},
        settings: {framesDelay: 0},
        devicePixelRatio: dpr,
        performance: {now: ()=>clock.now},
        innerWidth: 1600, innerHeight: 1000,
    });
    runInContext(js + '\n;globalThis.Universe = Universe;', sandbox);
    const U = sandbox.Universe;
    assert.equal(typeof U?.measure, 'function', 'universe.ts has no Universe.measure; this test reads nothing');
    // One measured window is 45 frames; `ms` is each frame's length, and the clock moves with it.
    const windows = (n, ms)=>{ for (let i = 0; i < n * 45; i++) { clock.now += ms; U.measure(ms); } };
    return {U, windows, clock, sandbox};
}

test('it takes the device resolution after two seconds of fast frames', ()=>{
    const {U, windows} = loadUniverse();
    assert.equal(U.quality, 1, 'it does not start at one canvas pixel to a CSS pixel');
    windows(4, 16);
    assert.equal(U.quality, 2);
});

test('a stall steps it down, and it comes back once frames are fast again', ()=>{
    const {U, windows} = loadUniverse();
    windows(4, 16);
    windows(2, 30);                      // the page busy for about three seconds
    assert.ok(U.quality < 2, 'slow frames did not step the resolution down');
    windows(40, 16);                     // well past the first wait of 20 s
    assert.equal(U.quality, 2, 'the resolution never came back after the stall');
});

test('a resolution slow at every try is tried less and less often, and not left for good', ()=>{
    const {U, windows, clock} = loadUniverse();
    windows(4, 16);
    // Slow whenever it is at 2, fast below: a GPU that cannot keep up at the device's own.
    const end = clock.now + 400000;
    let tries = 0, at = U.quality;
    while (clock.now < end) {
        windows(1, U.quality >= 2 ? 30 : 16);
        if (U.quality >= 2 && at < 2) tries += 1;
        at = U.quality;
    }
    assert.ok(U.backoff >= 80000, `the wait did not grow: ${U.backoff} ms`);
    assert.ok(tries >= 2 && tries <= 6, `${tries} tries in 400 s`);
    assert.ok(U.quality >= 1.5, `it gave up at ${U.quality}`);
});

test('the sky follows a pan deep in a zoom, where the zoom squared is 0', ()=>{
    const {U, sandbox} = loadUniverse();
    // 1e-200 squared underflows to 0; the sky stopped following a pan there.
    sandbox.Graph = {pan: {x: 0, y: 0}, zoom: {x: 1e-200, y: 0}};
    U.follow(false);
    sandbox.Graph.pan = {x: 1e-201, y: 0};
    U.follow(false);
    assert.ok(Number.isFinite(U.panX) && Math.abs(U.panX) > 10, `the sky moved ${U.panX} px`);
});
