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
    // Both title elements, because a restored card is an `<input>` until it is upgraded.
    assert.match(css, /\.title-input\.title-input-stowed[^{]*\{[^}]*display:\s*none/,
        'nothing hides the title element while collapsed, so the title is drawn twice -- '
        + 'once clipped by the input and once wrapped by the div');

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

test('the open card\'s title is a textarea, so it wraps too', ()=>{
    // The same root cause as the collapsed title, one layer out: an `<input>` cannot wrap
    // at any width, so a title longer than the header scrolled out of it -- 271px of text
    // inside 198px, with the end unreachable. A textarea is interchangeable for
    // everything this title does (`.value`, `.select()`, `selectionStart`, paste) and is
    // the only one of the two that wraps.
    const fn = windowJs.match(/static makeTitleInput\(value\)\{[\s\S]*?\n {4}\}/);
    assert.ok(fn, 'makeTitleInput is gone or no longer a static at that indent');
    assert.match(fn[0], /Html\.make\.textarea\('title-input'\)/,
        'the open card\'s title went back to an element that cannot wrap');

    // A textarea's value IS its text content, and a Saved Graph is `innerHTML` -- which
    // serialises content and not properties. Setting `.value` alone wrote the title
    // nowhere the save could see it, and the next autosave emptied every title on the
    // canvas. Measured, while it was wrong.
    assert.match(fn[0], /el\.textContent = value/,
        'the title is set as a property rather than as text, so it is absent from the '
        + 'markup a Saved Graph is made of and every title empties on the next save');

    assert.match(windowJs, /On\.change\(titleInput, \(\)=>\{ titleInput\.textContent = titleInput\.value \}\)/,
        'an edited title is no longer written back to the text content, so a rename is '
        + 'lost the next time the graph is serialised');
});

test('a title that is not laid out yet is not pinned shut', ()=>{
    // The fix reintroducing the bug it fixes. A card is built before it is placed, so on
    // the first pass `scrollHeight` is 0 -- and writing `height: 0px` from it made the box
    // measure nothing and clip its text, which is exactly the failure this change is
    // about. Measured: a fresh card's title reported truncated with a clientHeight of 0.
    const fn = windowJs.match(/fitTitleHeight = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(fn, 'fitTitleHeight is gone or no longer a field at that indent');

    assert.match(fn[0], /if \(wanted < 1\)/,
        'a zero measurement is written straight to the height again, which pins a fresh '
        + 'card\'s title shut and clips it');
    assert.match(fn[0], /requestAnimationFrame\(this\.fitTitleHeight\)/,
        'nothing retries after the element has been laid out, so a title measured too '
        + 'early stays at its default height however long the text is');
    // `auto` first, because scrollHeight never reports less than the height already set.
    assert.match(fn[0], /el\.style\.height = 'auto'/,
        'the height is measured without being released first, so a title can grow but '
        + 'never shrink back');
});

test('an older card is upgraded rather than left truncating forever', ()=>{
    // Same trap as the collapsed title: a Saved Graph is the markup, so every card saved
    // before the title became a textarea comes back as an `<input>`.
    assert.match(windowJs, /bindDOMRefs\(\)\s*\{[\s\S]*?this\.titleInput = this\.upgradeTitleInputElement\(\)/,
        'nothing upgrades a restored `<input>` title, so older cards keep the truncation');

    const fn = windowJs.match(/upgradeTitleInputElement\(\)\{[\s\S]*?\n {4}\}/);
    assert.ok(fn, 'upgradeTitleInputElement is gone');
    assert.match(fn[0], /old\.tagName !== 'INPUT'/,
        'the upgrade no longer checks what it is replacing, so it runs on every bind');
    assert.match(fn[0], /old\.value \?\? old\.getAttribute\('value'\)/,
        'the title is not carried across, which empties the name of every older card');
    // `replaceWith` keeps the element's position, and the extras replay finds the title
    // by child index.
    assert.match(fn[0], /old\.replaceWith\(el\)/,
        'the old element is not replaced in place, so its index changes and the saved '
        + 'value replay lands on the wrong element');
});

test('a title still commits on Enter rather than growing a blank line', ()=>{
    // An input could not insert a newline; a textarea can, and a title has no use for
    // one -- the header would grow an empty second line and the Zettelkasten tag that
    // mirrors this title would gain a break in the middle of a name.
    assert.match(windowJs, /if \(e\.key !== 'Enter' \|\| e\.shiftKey\) return;[\s\S]{0,120}?titleInput\.blur\(\)/,
        'Enter in a title now inserts a newline instead of finishing the edit');

    const css2 = read('resources/styles/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    // The textarea-only rule, not the one it shares with the input: anchored on its own
    // indent, or the shared rule above matches first and none of these live in it.
    const body = css2.match(/\n {4}textarea\.title-input \{([^}]*)\}/);
    assert.ok(body, 'the textarea title has no rule of its own, so the properties a '
                    + 'textarea needs and an input did not are unset');
    assert.match(body[1], /resize:\s*none/,
        'the title grew a resize handle, which is meaningless on a card title and sits '
        + 'where the card is dragged from');
    assert.match(body[1], /overflow:\s*hidden/,
        'the title can scroll again, which is the failure this replaced -- the height is '
        + 'kept equal to the content instead');
    assert.match(body[1], /box-sizing:\s*border-box/,
        'the textarea is content-box, which takes the copy button\'s 30px off the usable '
        + 'width instead of out of it');
});

test('both title elements are styled, for as long as both can exist', ()=>{
    // A restored card is an `<input>` until `upgradeTitleInputElement` reaches it, and it
    // has to look identical in the meantime.
    const css2 = read('resources/styles/styles.css');
    assert.match(css2, /input\[type="text"i\]\.title-input,\s*\n\s*textarea\.title-input \{/,
        'the shared title rule no longer matches both elements, so a card looks different '
        + 'depending on when it was saved');
    assert.match(css2, /input\[type="text"i\]\.title-input\.title-input-stowed,\s*\n\s*textarea\.title-input\.title-input-stowed/,
        'only one of the two title elements is stowed while collapsed, so the other draws '
        + 'the title a second time underneath the wrapped one');
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
