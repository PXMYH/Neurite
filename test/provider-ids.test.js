// Nothing in js/ exports anything, so nothing here can be imported. This test
// reads the source as text, which is enough for the question it asks: does every
// `case` label in the provider routing switch name a provider that exists?
//
// It is worth stating why that question is the interesting one. A provider id is
// a bare string, matched by hand in two separate switches. If the two spell a
// provider differently, nothing complains — one branch simply becomes
// unreachable and execution falls through to `default:`, which is OpenAI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path)=> readFileSync(new URL(path, root), 'utf8');

// The top-level keys of `const Providers = {...}`. Each provider's value is
// written on one line, so a key is the first `word:` on a line and the nested DOM
// ids never are.
function registeredProviderIds(){
    const src = read('js/ai/ai-utility/aihelpers.js');
    const start = src.indexOf('const Providers = {');
    assert.notEqual(start, -1, "no `const Providers = {` in aihelpers.js — this test's parse is stale, not the code");
    const end = src.indexOf('\n}', start);
    assert.notEqual(end, -1, "no closing brace for the Providers object — this test's parse is stale");

    const block = src.slice(start, end);
    return new Set([...block.matchAll(/^\s+([A-Za-z]\w*)\s*:/gm)].map((m)=> m[1]));
}

// Every `case 'x':` in the file that routes a provider to a URL. It holds the
// only two switches on `providerId` in the app, so there is nothing else in here
// to confuse with them.
function providerCaseLabels(){
    return read('js/ai/ai-utility/handleapikeys.js')
        .split('\n')
        .flatMap( (line, i)=>{
            const match = line.match(/^\s*case\s+'([^']+)'\s*:/);
            return match ? [{ id: match[1], line: i + 1 }] : [];
        });
}

test('every provider case label names a registered provider', ()=>{
    const registered = registeredProviderIds();
    const labels = providerCaseLabels();

    // A detector that finds nothing looks identical to a detector that cannot
    // find anything. Prove both ends parsed before trusting the comparison.
    assert.ok(registered.size > 0, 'parsed no provider ids at all');
    assert.ok(labels.length > 0, 'parsed no case labels at all');

    const dead = labels.filter( ({ id })=> !registered.has(id) );
    assert.deepEqual(dead, [],
        'These case labels can never match, so the branch is dead and the call '
      + 'falls through to `default:` — the OpenAI endpoint. Registered providers: '
      + [...registered].join(', ')
    );
});
