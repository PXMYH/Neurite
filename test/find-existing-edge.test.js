// `findExistingEdge(a, b)`: the Edge two Nodes share. It passed `Array.prototype.includes`
// to `find` as the callback, so each Edge's index in a's list became `includes`' fromIndex in
// b's, and an Edge further along a's list than b's was not found -- 63 of the AI bundle's 144
// Edge ends (rv9). The Connect list showed linked notes as unlinked, and Link reported
// "Not linked" of an Edge it had just made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../js/nodes/edgeclass.js', import.meta.url), 'utf8');
const start = source.indexOf('function findExistingEdge(');
assert.notEqual(start, -1, 'findExistingEdge should be declared as a function');
const sandbox = createContext({});
runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2) + '\n;globalThis.exported = findExistingEdge;', sandbox);
const findExistingEdge = sandbox.exported;

test('the shared Edge is found wherever it sits in either list', ()=>{
    const shared = {name: 'shared'};
    const a = {edges: [{}, {}, shared]};
    const b = {edges: [shared]};
    assert.equal(findExistingEdge(a, b), shared);
    assert.equal(findExistingEdge(b, a), shared);
});

test('two Nodes with no Edge in common have none', ()=>{
    assert.equal(findExistingEdge({edges: [{}, {}]}, {edges: [{}]}), undefined);
});
