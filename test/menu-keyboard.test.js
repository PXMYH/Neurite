// The menu's keyboard route in, and out. Before this it had none: measured in the
// browser, Tab from the top of the document made six stops -- the four pill tools,
// `#nodeSearchButton`, `#ai-features-enabled` -- and wrapped. Behind the hamburger sat
// nine rows, five panels, every API key field, Open, Save to…, Screenshot, Record and
// the function console, and none of it was reachable, because `.menu-button` was a
// `<div>`: `tabIndex: -1`, `focus()` a no-op, AX role `generic` with the name "Menu".
// A named nothing, with no state and no way in. Escape did nothing at either level.
//
// Read as text, like the other tests here: nothing under `js/` exports. Every number
// quoted below was measured in a real browser at `localhost:9141` against this tree,
// not derived from the code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const dropdownHtml = read('resources/html/tabs/dropdown.html');
const dropdownJs = read('js/interface/dropdown/dropdown.js');
const css = read('resources/styles/styles.css');

// Code only, and whole-line comments only -- never `//` to end of line, which is
// fail-*open*: a `//` inside a string literal is code, and everything after it on that
// line would go invisible to every `doesNotMatch` and every count below. The blanket
// refusal two lines on is what makes the strip safe by construction rather than by luck.
const jsCode = dropdownJs.replace(/^[ \t]*\/\/[^\n]*$/gm, '');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const htmlCode = dropdownHtml.replace(/<!--[\s\S]*?-->/g, '');

test('the hamburger is a real button, and says whether the menu is open', ()=>{
    assert.doesNotMatch(htmlCode, /<div[^>]*class="menu-button"/,
        'the menu button is a div again, so the whole menu has no keyboard route: '
        + 'measured, a div reads tabIndex -1, focus() on it is a no-op, and its AX role '
        + 'is `generic`');

    const iButton = htmlCode.indexOf('class="menu-button"');
    assert.notEqual(iButton, -1, 'the menu button is gone; this test reads nothing');
    // Back to the start of its own tag, so the assertions below cannot be satisfied by
    // some other element's attributes further up the file.
    const tag = htmlCode.slice(htmlCode.lastIndexOf('<', iButton), htmlCode.indexOf('>', iButton));
    assert.match(tag, /^<button\b/,
        'the menu button is not a <button>, so Enter and Space do not open the menu and '
        + 'the global `button:focus-visible` ring does not apply to it');
    assert.match(tag, /type="button"/,
        'a <button> with no type is type="submit"; the nine rows carry it for the same '
        + 'reason');
    assert.match(tag, /aria-expanded="false"/,
        'the menu button does not start out saying it is closed, so a screen reader is '
        + 'told the menu exists and never told whether it is open');
    assert.match(tag, /aria-label="Menu"/,
        '`data-tooltip` is invisible to a screen reader, so without this the button has '
        + 'no name at all');

    // Both halves of the state, written where the class is written and nowhere else.
    // `setAttribute` reading a boolean is deliberate: `aria-expanded` is a string
    // attribute, and passing the same `isOpen` that set the class is what keeps the two
    // from drifting.
    assert.match(jsCode, /const isOpen = dropdownContent\.classList\.toggle\("open"\);/,
        'the open state is no longer a value, so `inert` and `aria-expanded` are each '
        + 'free to disagree with the class');
    assert.match(jsCode, /menuButton\.setAttribute\('aria-expanded', isOpen\)/,
        '`aria-expanded` is not written from the same boolean as the class');
    assert.equal((jsCode.match(/aria-expanded/g) || []).length, 1,
        'a second writer of `aria-expanded` exists in dropdown.js. Two writers is how '
        + 'the attribute ends up disagreeing with the class it describes');

    // A phrasing-content child, because `<button>` takes phrasing content and the three
    // bars are `position: absolute` so the box is identical either way.
    assert.doesNotMatch(htmlCode, /<div class="menu-icon"/,
        'the menu icon is a div inside a <button> again, which is not phrasing content');
});

test('the button renders the same box the div did', ()=>{
    const i = cssCode.indexOf('.menu-button {');
    assert.notEqual(i, -1, '.menu-button has no rule; this test reads nothing');
    const rule = cssCode.slice(i, cssCode.indexOf('}', i));

    // A `<button>` resolves the UA stylesheet's `box-sizing: border-box` and
    // `padding: 1px 6px` where a div resolves neither. Measured with both declarations
    // present: 42x42 at (16,16) with the icon centred at (37,37), which is the div's box
    // exactly. Without them the button renders 40x40 and the icon centre moves to (36,36).
    assert.match(rule, /box-sizing:\s*content-box/,
        'the menu button renders 40x40 instead of the 42x42 the div did, because a '
        + '<button> resolves the UA `box-sizing: border-box`');
    assert.match(rule, /padding:\s*0/,
        'the UA `padding: 1px 6px` is back, which moves the icon off centre');

    // There is no global box-sizing reset in this file to inherit instead -- all of them
    // name their own rule -- so the declaration above cannot be dropped as redundant.
    assert.doesNotMatch(cssCode, /(^|\}|,)\s*\*[^{}]*\{[^{}]*box-sizing/,
        'a universal box-sizing reset was added, which changes what the rule above is '
        + 'compensating for. Re-measure the rendered box before editing this');

    // The ring comes from the global block at the end of the file rather than from a rule
    // of its own, which only works while the element is a real button.
    // Anchored at the start of a line, because `button:focus-visible` is a substring of
    // `.expand-button:focus-visible` two lines below it in that block: deleting the bare
    // selector left this green until the anchor was added, which is the one hole a
    // mutation run found in this file.
    assert.match(cssCode, /^button:focus-visible/m,
        'the global button focus ring no longer names bare `button`, so the menu button '
        + 'takes focus with nothing on screen to say so');
});

test('the closing menu stops taking clicks and focus before it finishes sliding', ()=>{
    // `visibility` is transitioned, and a transition to `hidden` holds `visible` for the
    // whole run. Measured on the way out with `inert` defeated and everything else
    // unchanged: a real mouse click at (200, 30) landed on `SPAN.menu-row-label` at 60ms
    // and on `BUTTON.menu-row tablink` at 150ms, and one Tab at 30ms landed on
    // `#open-file-button`. One of those probe clicks activated `Save to…` and the browser
    // really did download `Graph 1.neurite`. With the line below in place the same click
    // lands on `svg#svg_bg` at 0, 60, 150 and 250ms while `visibility` still reads
    // `visible`, and the Tab lands on the first pill tool.
    // Anchored on the panel's own rule, not on the file: a `transition` naming
    // `visibility` anywhere else is not the one that holds this window open.
    const iPanel = cssCode.indexOf('.dropdown-content {');
    assert.notEqual(iPanel, -1, '.dropdown-content has no rule; this test reads nothing');
    assert.match(cssCode.slice(iPanel, cssCode.indexOf('}', iPanel)),
        /transition:[^;]*\bvisibility\b/,
        '`visibility` is no longer transitioned on the menu panel, so the window the '
        + 'assertion below exists to close may have closed itself. Re-measure a click '
        + 'into the closing panel, then delete this test or keep it for the focus half');
    assert.match(jsCode, /dropdownContent\.inert = !isOpen;/,
        'the closing menu is hit-testable and focusable for the whole 0.3s slide, so a '
        + 'click aimed at what was behind it is swallowed by a menu the reader dismissed '
        + '-- or activates the row it lands on, and `Record` is one of them');

    // Set at load, not in the markup, because an `inert` attribute would need removing on
    // every open anyway. `inert` is not a layout property: measured with it set at load,
    // the function console's CodeMirror still comes up 302x320 with `textHeight 18` and
    // `charWidth 8`, and still takes focus and typed text with the menu open. `display:
    // none` is what would break that, which is why the panel is hidden by transform.
    assert.match(jsCode, /^dropdownContent\.inert = true;$/m,
        'the menu is not inert at load, so every row is in the focus order and every '
        + 'control in the panel is clickable before the menu has ever been opened');
    assert.equal((jsCode.match(/\.inert\b/g) || []).length, 2,
        'a third writer of `inert` exists in dropdown.js. The load-time line and the '
        + 'handler are the pair; a third is how the two get out of step');
});

test('Escape leaves by the same two steps it came in', ()=>{
    const iHandler = jsCode.indexOf("if (e.key !== 'Escape'");
    assert.notEqual(iHandler, -1,
        'nothing handles Escape, so a reader who opened the menu by keyboard cannot '
        + 'close it by keyboard: measured, the only exits were the Back button and a '
        + 'second click on the hamburger');
    const iEnd = jsCode.indexOf('\n});\n', iHandler);
    assert.ok(iEnd > iHandler, 'the Escape handler has no close at column 0');
    const body = jsCode.slice(iHandler, iEnd);
    assert.doesNotMatch(body, /\/\//,
        'a `//` sits on a line of code in the Escape handler, so everything after it on '
        + 'that line is invisible to the ordering check below; move it to its own line');

    // Guarded on the menu being open, or Escape anywhere in the app runs this.
    assert.match(body, /!dropdownContent\.classList\.contains\('open'\)\) return/,
        'Escape is handled with the menu closed, so it is taken from whatever else in '
        + 'the app wants it');

    // The panel branch first. Measured on the fix: Escape from the Fractal panel goes to
    // the list with focus on the `activeTab` row, and Escape again closes the menu with
    // focus back on the hamburger -- `aria-expanded="false"`, `inert` true. Reversed,
    // one press would close the menu from two levels down and the panel view would be
    // the state the menu reopens into.
    const iDetail = body.indexOf('detail-open');
    const iClose = body.indexOf('menuButton.click()');
    assert.notEqual(iDetail, -1, 'the panel view has no Escape branch');
    assert.notEqual(iClose, -1, 'Escape does not close the menu');
    assert.ok(iDetail < iClose,
        'Escape closes the whole menu from inside a panel, skipping the list: the two '
        + 'steps out have to mirror the two steps in');

    // Through the one handler that owns the class, `inert` and `aria-expanded`, rather
    // than a second copy of the toggle that could fall out of step with it.
    assert.doesNotMatch(body, /classList\.(toggle|remove|add)\('?"?open/,
        'the Escape path writes the `open` class itself instead of clicking the button, '
        + 'so it can leave `inert` and `aria-expanded` behind');
    assert.match(body, /menuButton\.focus\(\)/,
        'closing by Escape drops focus to <body>, which puts the hamburger seven Tabs '
        + 'away at the top of the document');
});

test('every menu row is a button that says what it does', ()=>{
    const rows = htmlCode.match(/<button[^>]*class="[^"]*menu-row[^"]*"[^>]*>/g) || [];
    assert.equal(rows.length, 9,
        'the menu no longer holds nine rows as <button> open tags; every count below '
        + 'reads this list');

    for (const row of rows) {
        assert.match(row, /type="button"/,
            'a menu row has no type, so it is a submit button: harmless only while '
            + '`closest(\'form\')` is null for all nine, and `aitab.html` does contain a '
            + '<form>. Row: ' + row.slice(0, 60));
    }

    // The chevron that tells a reader these five descend a level is `aria-hidden`, as an
    // icon carrying nothing the label does not should be -- so without this the five
    // panel rows are indistinguishable from the four commands above the separator.
    const popups = rows.filter( (r)=> r.includes('aria-haspopup') );
    const tablinks = rows.filter( (r)=> r.includes('tablink') );
    assert.equal(tablinks.length, 5, 'the five panel rows are no longer five');
    assert.deepEqual(popups, tablinks,
        'the rows that open a panel and the rows that say they open a panel are not the '
        + 'same five. Not `role="menu"`: that takes arrow-key navigation and a '
        + 'focus-management contract this list does not implement');
});
