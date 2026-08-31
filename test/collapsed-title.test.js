// The title a collapsed card shows. It is a `<div>` and not the `<input>` that shows the
// title while the card is open, and that is the whole fix rather than a stylistic choice:
// an `<input type="text">` is a single-line control, so no value of `white-space` can make
// it wrap, and its intrinsic width comes from a character count rather than from its text.
// `width: fit-content` on it resolved to 302px around 405px of title, so the last third of
// "Agent = Model + Harness + Evals" was simply gone, with nothing on screen to say so.
//
// Two of these guard the fix. The rest guard the trap underneath it: a Saved Graph is the
// markup itself, so an element that only the builder creates does not exist on any card
// saved before it was written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const windowJs = read('js/nodes/createnodes/window.js');
const toggleJs = read('js/nodes/nodeinteraction/togglenodestate.js');
const css = read('resources/styles/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector){
    const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                          + '\\s*\\{([^{}]*)\\}');
    const m = css.match(re);
    assert.ok(m, 'the rule for `' + selector + '` was not found -- it was renamed or '
                 + 'reformatted, and every assertion about it is now vacuous');
    return m[2];
}

test('the collapsed title is built where both the create and restore paths run', ()=>{
    // The trap this exists to avoid. `windowify` runs for a new card only; `bindDOMRefs`
    // runs for both, which is why the element is created there. Built in the builder
    // alone, collapsing a card restored from an older graph would find nothing to write
    // the title into and show an empty circle.
    assert.match(windowJs, /bindDOMRefs\(\)\s*\{[\s\S]*?this\.collapsedTitle = this\.ensureCollapsedTitle\(\)/,
        'bindDOMRefs no longer reaches for the collapsed title, so a card restored from a '
        + 'graph saved before this existed has no element to collapse into');

    const fn = windowJs.match(/ensureCollapsedTitle\(\)\{[\s\S]*?\n {4}\}/);
    assert.ok(fn, 'ensureCollapsedTitle is gone or no longer a method at that indent');

    // Idempotent, because bindDOMRefs runs more than once over a card's life.
    assert.match(fn[0], /querySelector\('\.collapsed-title'\)/,
        'ensureCollapsedTitle does not look for an existing element, so every rebind adds '
        + 'another one');
    assert.match(fn[0], /aria-hidden', 'true'/,
        'the collapsed title is exposed to a screen reader, which already has the title '
        + 'from the input beside it');
});

test('the collapsed title is not an input, which is the point', ()=>{
    const fn = windowJs.match(/ensureCollapsedTitle\(\)\{[\s\S]*?\n {4}\}/)[0];
    assert.match(fn, /Html\.make\.div\('collapsed-title'\)/,
        'the collapsed title is no longer a div. An <input> cannot wrap at any width and '
        + 'sizes from a character count, which is the bug this replaced');
    assert.doesNotMatch(fn, /make\.input|<input/,
        'an input crept back into the collapsed title');
});

test('the collapsed title wraps, and keeps every word', ()=>{
    const body = rule('.collapsed-title.collapsed-title-visible');

    // The two properties an input could not honour.
    assert.match(body, /white-space:\s*pre-wrap/,
        'the collapsed title no longer wraps, so a long one is back to one long line');
    assert.match(body, /overflow-wrap:\s*break-word/,
        'a single unbroken word longer than the cap will overflow instead of breaking');

    // A cap it wraps against, and content sizing under it so a short title is not padded
    // out to the full width.
    assert.match(body, /max-width:\s*\d+ch/,
        'the width cap is gone or is no longer in `ch`, so it no longer holds its shape '
        + 'against the font size above it');
    assert.match(body, /width:\s*max-content/,
        'the collapsed title is no longer content-sized, so a two-word title is padded '
        + 'out to the cap');

    // Nothing may clip. This is the failure the whole change is about, so it must not be
    // reintroduced by a stray overflow rule.
    assert.doesNotMatch(body, /overflow:\s*hidden|text-overflow/,
        'the collapsed title clips again');
});

test('the input stands aside rather than being removed', ()=>{
    // It keeps the value, its listeners and its place in the tab order; it hands over
    // only the drawing of the text. 21 places read `titleInput.value`.
    assert.match(css, /input\[type="text"i\]\.title-input\.title-input-stowed \{[^}]*display:\s*none/,
        'nothing hides the input while collapsed, so the title is drawn twice -- once '
        + 'clipped by the input and once wrapped by the div');

    assert.match(toggleJs, /showCollapsedTitle = function\(\)\{[\s\S]*?el\.textContent = this\.titleInput\.value/,
        'the collapsed title is no longer written from the input, so the two can disagree '
        + 'when the Zettelkasten text renames a card while it is collapsed');

    // Written at the moment of collapsing rather than kept in step by a listener: the
    // input is the one source of truth and a card collapses a handful of times.
    assert.match(toggleJs, /centerTitleInput = function\(\)\{[\s\S]*?this\.showCollapsedTitle\(\)/,
        'collapsing no longer shows the collapsed title');
    assert.match(toggleJs, /resetTitleInput = function\(\)\{[\s\S]*?this\.hideCollapsedTitle\(\)/,
        'expanding no longer hides it, so it stays over the reopened card');
});

test('the copy button is not drawn on a collapsed circle', ()=>{
    // It lives inside the title wrapper rather than beside it, so `hideButHeaderAndTitle`
    // never hid it -- and the wrapper carries `pointer-events: none` while collapsed, so
    // it could not be pressed even while drawn. The input reserved 30px of padding for
    // it; the wrapping title does not, so left drawn it sits on top of the last word.
    assert.match(css, /\.window\.collapsed \.copy-button \{[^}]*display:\s*none/,
        'the copy button is drawn on a collapsed card again, where it cannot be clicked '
        + 'and now overlaps the title instead of following it');
});
