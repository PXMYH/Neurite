// A provider is chosen from the `inference-select` dropdown, whose option values
// are provider ids typed into HTML. `Ai.determineModel` then does
// `Providers[providerId]` and immediately reads a field off the result, so the
// dropdown and the registry have to agree or the call throws on undefined.
//
// Nothing enforces that agreement at runtime, and the two live in different file
// types, so this checks it here. Same reading-source-as-text approach as
// provider-ids.test.js, for the same reason: nothing under js/ exports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

// The `Providers` object, as {id: {field: value}}. Each provider's value sits on
// one line, which is what makes a line-oriented parse honest here.
function providers(){
    const src = read('js/ai/ai-utility/aihelpers.js');
    const start = src.indexOf('const Providers = {');
    assert.notEqual(start, -1, "no `const Providers = {` in aihelpers.js — this test's parse is stale, not the code");
    const end = src.indexOf('\n}', start);
    assert.notEqual(end, -1, "no closing brace for the Providers object — this test's parse is stale");

    const out = {};
    for (const line of src.slice(start, end).split('\n')) {
        const match = line.match(/^\s+([A-Za-z]\w*)\s*:\s*\{(.*)\}/);
        if (!match) continue;
        out[match[1]] = Object.fromEntries(
            [...match[2].matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map( (m)=> [m[1], m[2]] )
        );
    }
    return out;
}

// The provider ids a user can actually pick, straight out of the dropdown markup.
function selectableProviderIds(){
    const html = read('resources/html/tabs/aitab.html');
    const open = html.indexOf('id="inference-select"');
    assert.notEqual(open, -1, "no inference-select in aitab.html — this test's parse is stale");
    const block = html.slice(open, html.indexOf('</select>', open));
    return [...block.matchAll(/<option\s+value="([^"]+)"/g)].map( (m)=> m[1] );
}

// Every id="..." across the shipped markup, so a registry field naming an element
// can be checked against what actually exists.
function markupIds(){
    const walk = (d)=> readdirSync(new URL(d + '/', root), {withFileTypes:true})
        .flatMap( (e)=> e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)] );
    const files = ['index.html', ...walk('resources')].filter( (f)=> /\.(html|svg)$/.test(f) );

    const ids = new Set();
    for (const f of files) {
        for (const m of read(f).matchAll(/\bid=["']([^"']+)["']/g)) ids.add(m[1]);
    }
    assert.ok(ids.size > 0, 'parsed no element ids at all');
    return ids;
}

test('every provider the dropdown offers is registered', ()=>{
    const registered = providers();
    const selectable = selectableProviderIds();

    // Both halves have to have parsed, or an empty result would read as a pass.
    assert.ok(Object.keys(registered).length > 0, 'parsed no provider ids at all');
    assert.ok(selectable.length > 0, 'parsed no dropdown options at all');

    const unregistered = selectable.filter( (id)=> !(id in registered) );
    assert.deepEqual(unregistered, [],
        'These ids are selectable in inference-select but absent from Providers, so '
      + '`Providers[providerId]` is undefined and determineModel throws while reading '
      + 'a field off it. Registered: ' + Object.keys(registered).join(', ')
    );
});

test('a selectable provider carries both of the fields determineModel reads', ()=>{
    const registered = providers();

    // determineModel picks domSelectId for the global dropdown and nodeSelectId for
    // a per-node one. Which of the two it needs depends on the caller, so a provider
    // offered in the dropdown needs both or it breaks in one context only — the
    // kind of gap that reaches a user before it reaches a developer.
    const incomplete = selectableProviderIds()
        .filter( (id)=> registered[id] )
        .flatMap( (id)=> ['domSelectId', 'nodeSelectId']
            .filter( (field)=> !registered[id][field] )
            .map( (field)=> `${id} is missing ${field}` ) );

    assert.deepEqual(incomplete, []);
});

// setModelSelectorsVisibility shows one model dropdown by matching
// `[id^="wrapper-" + chosenProviderId.toLowerCase()]`. That is a *prefix* match
// against a live document, so it returns the first wrapper whose id merely starts
// with the string, not the one that equals it. Two provider ids where one
// lowercases to a prefix of the other would therefore show the wrong dropdown,
// silently and only for the shorter of the two.
//
// No pair collides today. This exists so that adding, say, `open` beside `OpenAi`
// fails here instead of in a user's face.
test('no lowercased provider id is a prefix of another', ()=>{
    const lowered = Object.keys(providers()).map( (id)=> id.toLowerCase() );
    assert.ok(lowered.length > 0, 'parsed no provider ids at all');

    const collisions = lowered.flatMap( (a)=> lowered
        .filter( (b)=> b !== a && b.startsWith(a) )
        .map( (b)=> `"${a}" is a prefix of "${b}"` ) );

    assert.deepEqual(collisions, [],
        'The wrapper lookup in setModelSelectorsVisibility is a prefix match, so the '
      + 'shorter id would select the longer id\'s dropdown.'
    );
});

test('every element a provider names exists in the markup', ()=>{
    const ids = markupIds();

    // nodeSelectId is deliberately not checked: it is a property name on the node
    // object, not an element id, and the elements it stands for are built per node
    // at runtime.
    const missing = Object.entries(providers())
        .flatMap( ([id, fields])=> ['domSelectId', 'inputId']
            .filter( (field)=> fields[field] && !ids.has(fields[field]) )
            .map( (field)=> `${id}.${field} = "${fields[field]}"` ) );

    assert.deepEqual(missing, [],
        'Elem.byId returns null for these, so the branch that reads one throws or '
      + 'silently does nothing.'
    );
});
