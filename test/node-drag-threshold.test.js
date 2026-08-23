// Shift plus a click on one Node, then a click on a second, makes an Edge between
// them: `Node.onMouseDown` parks the first Node in `Node.prev` and connects on the
// next press. That gesture was unusable because a press also starts moving the Node,
// and the code told the two apart with a zero-pixel test -- every Node listened for
// mousemove on the whole document and dropped `Node.prev` on the first pixel of
// travel. A real click always travels a pixel or two, so the pending Edge was thrown
// away before the second click arrived, silently.
//
// The rule now lives in one place: a press becomes a drag once the pointer has
// travelled `Node.dragThreshold`, and only then is the pending Edge discarded. These
// tests drive the real method out of the real file, because the bug was not in the
// arithmetic -- it was in which event the decision hung off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (path)=>readFileSync(new URL('../' + path, import.meta.url), 'utf8');

// A Node cannot be imported, and constructing one reaches for a handful of globals.
// The list is kept literal: it is the honest inventory of what a Node touches on the
// way into existence. `bound` records every listener the constructor asks for, which
// is what lets a test assert about the listeners themselves.
function loadNode(){
    const bound = {on: [], off: []};
    const elem = {
        dataset: {}, style: {}, children: [],
        classList: {add(){}, remove(){}, toggle(){}, contains: ()=>false},
        querySelectorAll: ()=>[], querySelector: ()=>null,
        appendChild(){}, setAttribute(){}, getBoundingClientRect: ()=>({left: 0, top: 0, width: 0, height: 0})
    };
    const record = (log)=>new Proxy({}, {
        get: (_, event)=>(target, cb)=>log.push({event, target, cb})
    });
    class vec2Stub {
        constructor(x = 0, y = 0){ this.x = x; this.y = y }
        minus(){ return new vec2Stub }
        plus(){ return new vec2Stub }
        scale(){ return new vec2Stub }
        mag(){ return 0 }
    }
    const sandbox = createContext({
        vec2: vec2Stub,
        Html: {new: {div: ()=>elem}},
        Graph: {nextUuid: 0, vecToZ: ()=>new vec2Stub, xyToZ: ()=>new vec2Stub},
        NodeSensor: class { constructor(){} },
        OverlayHelper: {added: [], add(name){ this.added.push(name) }, remove(){}},
        Logger: {info(){}, debug(){}, warn(){}, err(){}},
        settings: {flowDirectionRandomRange: 0},
        document: elem,
        window: {},
        clearTextSelections(){},
        connectNodes(){}
    });
    sandbox.On = record(bound.on);
    sandbox.Off = record(bound.off);

    runInContext(read('js/nodes/nodeclass.js') + '\n;globalThis.exported = Node;',
                 sandbox, {filename: 'js/nodes/nodeclass.js'});
    return {Node: sandbox.exported, bound, sandbox};
}

// Presses a Node, then reports whether the pending Edge is still alive after the
// pointer has travelled `distance` pixels.
function pressAndTravel(Node, node, distance){
    Node.prev = node;
    node._initialMousePos = {x: 100, y: 100};
    node._hasAddedGrabbing = false;
    node._maybeAddGrabbing({clientX: 100 + distance, clientY: 100});
    return Node.prev;
}

test('a press under the drag threshold keeps the pending Edge', ()=>{
    const {Node, sandbox} = loadNode();
    const node = new Node;

    assert.strictEqual(typeof Node.dragThreshold, 'number',
        'Node.dragThreshold is the one place the click/drag rule lives');
    assert.ok(Node.dragThreshold >= 5,
        `a threshold of ${Node.dragThreshold}px is inside the drift of an ordinary click`);

    // The case that made the gesture unusable: a click that drifts a little.
    assert.strictEqual(pressAndTravel(Node, node, 3), node,
        'a 3px drift discarded the pending Edge, so the second click had nothing to connect to');
    assert.deepStrictEqual(sandbox.OverlayHelper.added, [],
        'a click that has not become a drag must not show the grabbing cursor');
});

test('the threshold is the boundary, and a real drag discards the pending Edge', ()=>{
    const {Node, sandbox} = loadNode();
    const node = new Node;
    const t = Node.dragThreshold;

    assert.strictEqual(pressAndTravel(Node, node, t), node,
        `travel of exactly ${t}px is still a click`);
    assert.strictEqual(pressAndTravel(Node, node, t + 1), null,
        `travel past ${t}px is a drag, which moves the Node instead of starting an Edge`);
    assert.deepStrictEqual(sandbox.OverlayHelper.added, ['grabbing'],
        'the drag shows the grabbing cursor exactly once');
});

test('the decision fires once per press, not on every pointer move', ()=>{
    const {Node, bound} = loadNode();
    const node = new Node;

    Node.prev = node;
    node._initialMousePos = {x: 100, y: 100};
    node._hasAddedGrabbing = false;
    for (let d = 40; d <= 200; d += 40) node._maybeAddGrabbing({clientX: 100 + d, clientY: 100});

    // Once it has decided, the handler unbinds itself. A second decision per press
    // would re-clear `Node.prev` after a later press had legitimately set it.
    const unbound = bound.off.filter((b)=>b.event === 'mousemove');
    assert.strictEqual(unbound.length, 1,
        `the drag handler unbound itself ${unbound.length} times for one press`);
});

test('a Node binds no mousemove listener on the document', ()=>{
    const {Node, bound} = loadNode();
    new Node;

    // This is the shape of the original bug: one document-wide mousemove listener
    // per Node, each one able to cancel a pending Edge. They were never unbound
    // either, so every Node ever opened left one behind.
    const onDocument = bound.on.filter((b)=>b.event === 'mousemove');
    assert.deepStrictEqual(onDocument, [],
        'a Node listens for mousemove document-wide again -- that is what cancelled the Edge');

    // Guards the scan: if the constructor stops binding anything, the check above
    // would pass for the wrong reason.
    assert.ok(bound.on.length >= 4,
        `expected a Node to bind its own listeners, recorded ${bound.on.length}`);
    assert.ok(bound.on.every((b)=>b.event !== 'mousemove'));
});

test('one threshold serves both gestures that tell a click from a drag', ()=>{
    // Ctrl plus a short click toggles selection, and it carried its own copy of the
    // number. Two copies are how the Edge gesture came to use zero while this one
    // used ten.
    const src = read('js/nodes/createnodes/window.js');
    assert.match(src, /Node\.dragThreshold/,
        'the selection gesture must read the shared threshold');
    assert.doesNotMatch(src, /dragThreshold\s*=\s*\d/,
        'the selection gesture has its own copy of the threshold again');
});
