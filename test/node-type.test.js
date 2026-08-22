// A node's type is a duck-typed flag set by its creator. `Node.typeByFlag` is the
// one list of those flags, and `Node.getType` is the one reader. This pins the
// three ways that arrangement used to come apart:
//
//   1. a creator writes a flag the table has never heard of (image, file tree),
//   2. `getType` answers a name that no NodeActions class exists for, and throws,
//   3. someone derives the type a second time from the raw flags, in another order.
//
// Every scan below asserts both what it found and what it did not, because a scan
// that silently matches nothing reports the same "0 problems" as a clean tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel)=>readFileSync(join(ROOT, rel), 'utf8');

// Both files are pure definitions -- no top-level calls -- so they load with no
// stubs at all. The trailing assignment is needed because a top-level `class Node`
// is a lexical binding, not a property of the sandbox global.
function loadNodeTypes(){
    const src = read('js/nodes/nodeclass.js')
              + '\n' + read('js/nodes/nodeinteraction/nodeactioninterface.js')
              + '\n;globalThis.exported = {Node, NodeActions};';
    const sandbox = {};
    vm.runInNewContext(src, sandbox, {filename: 'nodeclass+nodeactions.js'});
    return sandbox.exported;
}

function jsFilesUnder(dir){
    const found = [];
    for (const entry of readdirSync(join(ROOT, dir), {withFileTypes: true})) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...jsFilesUnder(rel));
        else if (entry.name.endsWith('.js')) found.push(rel);
    }
    return found;
}

test('every node type flag a creator writes is named in the type table', ()=>{
    const files = jsFilesUnder('js/nodes/nodetypes');
    assert.ok(files.length >= 5, `expected the node type sources, scanned ${files.length}`);

    const written = new Map(); // flag -> where it was written
    for (const file of files) {
        const src = read(file);
        for (const match of src.matchAll(/node\.(is[A-Z]\w*)\s*=\s*true/g)) {
            written.set(match[1], file);
        }
    }
    // Guards the scan itself: if the regex stops matching, this fails rather than
    // reporting a clean tree.
    assert.ok(written.size >= 5,
        `expected at least 5 node type flags, found ${written.size}: ${[...written.keys()]}`);

    const {Node} = loadNodeTypes();
    const missing = [...written].filter(([flag])=>!(flag in Node.typeByFlag));
    assert.deepStrictEqual(missing, [],
        'flags written by a creator but absent from Node.typeByFlag -- getType cannot name these nodes');
});

test('getType answers a distinct name for every flag in the table', ()=>{
    const {Node} = loadNodeTypes();
    const flags = Object.keys(Node.typeByFlag);
    assert.ok(flags.length >= 5, `expected at least 5 entries in the table, found ${flags.length}`);

    const answers = flags.map((flag)=>Node.getType({[flag]: true}));
    assert.strictEqual(new Set(answers).size, flags.length,
        `two flags share a type name: ${answers}`);

    const fellThrough = flags.filter((flag)=>Node.getType({[flag]: true}) === 'base');
    assert.deepStrictEqual(fellThrough, [],
        'these flags fall through to the base default, so getType cannot tell them apart');

    // A node with no flag -- media and Wolfram nodes -- is still base.
    assert.strictEqual(Node.getType({}), 'base');
});

test('every type getType can answer resolves to an actions class', ()=>{
    const {Node, NodeActions} = loadNodeTypes();
    const classes = Object.keys(NodeActions).filter((k)=>k !== 'forNode');
    assert.ok(classes.length >= 4, `expected the actions classes, found ${classes}`);

    // Fewer classes than types is the point: the fallback is what makes naming a
    // new type safe. Without it `new NodeActions['image']` is `new undefined()`.
    const types = [...Object.keys(Node.typeByFlag).map((f)=>[f, Node.getType({[f]: true})]), [null, 'base']];
    const threw = [];
    for (const [flag, type] of types) {
        const node = (flag ? {[flag]: true} : {});
        try {
            assert.ok(NodeActions.forNode(node) instanceof NodeActions.base,
                `actions for '${type}' are not base actions`);
        } catch (err) {
            threw.push(`${type}: ${err.message}`);
        }
    }
    assert.deepStrictEqual(threw, [], 'NodeActions.forNode has no answer for these types');
    assert.ok(types.length > classes.length,
        'there are now as many actions classes as types -- if that is deliberate, this test has nothing left to guard');
});

test('getData names a node type once, by asking getType', ()=>{
    const src = read('js/nodes/nodeinteraction/connect.js');
    const start = src.indexOf('Node.prototype.getData');
    const end = src.indexOf('Node.prototype.getAllConnectedNodesData');
    assert.ok(start > -1 && end > start, 'could not find Node.prototype.getData in connect.js');

    const body = src.slice(start, end);
    assert.match(body, /Node\.getType\(/,
        'getData must ask getType for the type rather than deriving it again');

    // It used to test three flags itself, in a different order than getType, so one
    // node had two type names and the model was shown both.
    const rederived = [...body.matchAll(/this\.(is[A-Z]\w*)/g)].map((m)=>m[1]);
    assert.deepStrictEqual(rederived, [],
        'getData reads raw type flags again -- the two derivations can drift apart');
});
