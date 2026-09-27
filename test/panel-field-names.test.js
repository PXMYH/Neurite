// Every field in the menu's panels has a name a screen reader can say.
//
// Twelve number boxes in the Fractal panel had none -- each sits beside a slider whose
// `<label for>` names the slider, not the box -- and Views' pan and zoom were labelled
// by a bare `<span>`. That mattered less while a keyboard could not reach half the
// panels; #32 made them reachable, so each is announced as "spin button, 50" and
// nothing more. Read as text, like the other tab tests: the question is what the markup
// says, and the name a browser computes comes from exactly these attributes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const TABS = ['aitab', 'fractaltab', 'viewstab', 'settingstab', 'notestab']
    .map( (name)=>'resources/html/tabs/' + name + '.html' );

const attr = (tag, name)=>(tag.match(new RegExp('\\s' + name + '="([^"]*)"'))?.[1] ?? null);

// The fields of one file, comments out, with whether each has a name, in the order the
// accessible-name computation looks: aria-labelledby, aria-label, a label, then the
// placeholder and the title a browser falls back on.
function fields(html){
    const text = html.replace(/<!--[\s\S]*?-->/g, '');
    const labelled = new Set([...text.matchAll(/<label\s[^>]*for="([^"]+)"/g)].map( (m)=>m[1] ));
    // A field inside a `<label>` element is named by it too.
    const wrapped = new Set();
    for (const m of text.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
        for (const inner of m[1].matchAll(/<(?:input|select|textarea)\b[^>]*\sid="([^"]+)"/g)) wrapped.add(inner[1]);
    }
    return [...text.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map( ([tag, kind])=>{
        const id = attr(tag, 'id');
        const hidden = attr(tag, 'type') === 'hidden' || /display:\s*none/.test(attr(tag, 'style') ?? '');
        const named = Boolean(attr(tag, 'aria-labelledby') || attr(tag, 'aria-label') || labelled.has(id)
            || wrapped.has(id) || attr(tag, 'placeholder') || attr(tag, 'title'));
        return {kind, id, hidden, named};
    });
}

test('every field in the panels has a name', ()=>{
    const found = TABS.flatMap( (file)=>fields(read(file)).map( (f)=>({...f, file}) ) );
    // The walk found the fields it is about, or it is checking nothing.
    assert.ok(found.length > 40, 'the tab markup parsed to ' + found.length + ' fields');
    for (const id of ['length_value', 'zoom_speed_value', 'inner_opacity_value', 'pan', 'zoom']) {
        assert.ok(found.some( (f)=>f.id === id ), id + ' was not found');
    }

    const unnamed = found.filter( (f)=>!f.hidden && !f.named ).map( (f)=>`${f.file}: ${f.kind}#${f.id}` );
    assert.deepEqual(unnamed, []);
});

test('a number box is named after the slider it stands beside', ()=>{
    const html = read('resources/html/tabs/fractaltab.html');
    for (const [box, slider] of [['length_value', 'length'], ['maxLinesValue', 'maxLinesSlider'],
                                 ['draw_speed_value', 'renderDelaySlider'], ['c_value', 'cSlider']]) {
        const label = html.match(new RegExp('<label for="' + slider + '">([^<:]+):?</label>'))?.[1];
        const tag = html.match(new RegExp('<input id="' + box + '"[^>]*>'))?.[0];
        assert.ok(label && tag, box + ' or the label of ' + slider + ' is gone');
        assert.equal(attr(tag, 'aria-label'), label, box + ' is not named for ' + slider);
    }
});
