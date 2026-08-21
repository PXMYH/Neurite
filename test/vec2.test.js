// vec2 is the coordinate system: every node position, and the graph's own pan and
// zoom, is one of these. So a regression in the complex arithmetic moves
// everything at once, which makes it worth pinning.
//
// It cannot be imported. js/mandelbrot/mandelbrot.js is a plain script whose first
// line is `document.body.style.overflow = 'hidden'`, so loading it needs a DOM
// before it needs anything else. Running it in a sandbox with a stub for the few
// globals it reaches for while loading is the cheap way through, and it is the
// pattern any later test of a global-scope file can copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// `names` has to be given explicitly. A top-level `class` or `let` in a script is
// a lexical binding, not a property of the global object, so loading the file is
// not enough to reach vec2 — a line appended to the same script scope is. Only
// `var` and function declarations would have shown up on their own.
function loadGlobalScript(path, names){
    const src = readFileSync(new URL('../' + path, import.meta.url), 'utf8');

    // One object standing in for every element the script asks for. It answers
    // any lookup with itself, so a chain of them resolves without a real DOM.
    const elem = {
        style: {},
        getElementById: ()=> elem,
        setAttribute(){},
        appendChild(){},
        addEventListener(){}
    };
    // The globals the script writes to or reads while loading. The list is short
    // and worth keeping literal: it is the honest inventory of what this file
    // needs before it can even be parsed into existence.
    const sandbox = createContext({
        document: { body: { style: {} }, getElementById: ()=> elem, createElement: ()=> elem },
        Elem: { byId: ()=> elem },
        Svg: {},
        Logger: { info(){}, debug(){}, warn(){}, err(){} },
        On: new Proxy({}, { get: ()=> ()=>{} }),
        settings: {}
    });
    const epilogue = '\n;globalThis.exported = {' + names.join(', ') + '};';
    runInContext(src + epilogue, sandbox, { filename: path });
    return sandbox.exported;
}

const { vec2 } = loadGlobalScript('js/mandelbrot/mandelbrot.js', ['vec2']);

const close = (actual, x, y, msg)=>{
    assert.ok(Math.abs(actual.x - x) < 1e-12 && Math.abs(actual.y - y) < 1e-12,
        `${msg}: expected about (${x}, ${y}), got (${actual.x}, ${actual.y})`);
};

test('cmult multiplies as complex numbers, times multiplies component-wise', ()=>{
    const i = new vec2(0, 1);

    // The whole reason the two exist. i squared is -1 as a complex number, and
    // (0,1) as a pair of components. The name vec2 hides which one you get.
    close(i.cmult(i), -1, 0, 'i * i');
    close(i.times(i), 0, 1, 'i times i component-wise');

    close(new vec2(3, 2).cmult(new vec2(1, 7)), 3 - 14, 21 + 2, '(3+2i)(1+7i)');
});

test('crecip and cdiv invert cmult', ()=>{
    close(new vec2(2, 0).crecip(), 0.5, 0, '1 / 2');
    close(new vec2(0, 1).crecip(), 0, -1, '1 / i');

    const z = new vec2(3, -4);
    close(z.cdiv(z), 1, 0, 'z / z');
    close(z.cmult(z.crecip()), 1, 0, 'z * (1/z)');
});

test('rot turns by an angle, rot90 by a quarter turn', ()=>{
    close(new vec2(1, 0).rot(Math.PI / 2), 0, 1, 'rotate (1,0) a quarter turn');
    close(new vec2(1, 0).rot(Math.PI), -1, 0, 'rotate (1,0) a half turn');

    // rot90 goes the other way round from rot(+pi/2), which is easy to get wrong
    // when reading it and matters for edge geometry.
    close(new vec2(1, 0).rot90(), 0, -1, 'rot90 of (1,0)');
    close(new vec2(1, 0).unrot90(), 0, 1, 'unrot90 of (1,0)');
    close(new vec2(1, 0).rot90().unrot90(), 1, 0, 'rot90 then unrot90');
});

test('magnitude, and the squared form that skips the square root', ()=>{
    const z = new vec2(3, 4);
    assert.equal(z.mag(), 5);
    assert.equal(z.mag2(), 25);
    assert.equal(z.mag2(), z.dot(z));
    close(z.normed(), 0.6, 0.8, 'unit vector');
    assert.equal(new vec2(0, 0).mag(), 0);
});

test('the constructor also copies another vec2', ()=>{
    const copy = new vec2(new vec2(7, -2));
    close(copy, 7, -2, 'copied');
    assert.ok(copy instanceof vec2);
});
