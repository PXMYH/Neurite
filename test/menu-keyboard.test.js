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

test('the three bars of the icon line up', ()=>{
    // The outer two are pseudo-elements of the middle one. With `left: auto` an absolutely
    // positioned box falls back to its static position, and the static position here is
    // measured inside a `<button>`, whose UA stylesheet sets `text-align: center` -- which
    // resolved to `left: 10px` on both, half a bar's width. Measured in the browser: the
    // middle bar at x=27..47 and the other two at x=37..57, running to the edge of a 42px
    // button. It arrived with the change from `<div>` to `<button>`, the same change that
    // took the box from 42x42 to 40x40; that half was noticed and this half was not.
    const i = cssCode.indexOf('.menu-icon::before,');
    assert.notEqual(i, -1, 'the two bars no longer share a rule; this test reads nothing');
    const rule = cssCode.slice(i, cssCode.indexOf('}', i));
    assert.match(rule, /left:\s*0/,
        'the outer bars are back on their static position, which a <button> centres: they '
        + 'sit half a bar right of the middle one');

    // The X state rotates them about that same origin, so it is only symmetrical while the
    // two agree on where they start.
    assert.match(cssCode, /\.menu-button\.open \.menu-icon::before \{\s*transform: translateY\(6px\) rotate\(45deg\)/,
        'the open state no longer folds the top bar into the X');
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

    // And guarded on a modal, which the menu does not close for: a panel launching
    // Custom Endpoint or Vector Database leaves the menu open underneath it. Measured
    // without this line: with the AI panel open and a modal on top, Escape left the
    // modal on screen and took the menu back to the list behind it. `window.alert` and
    // `window.confirm` bind no Escape at all, so at that point the key had no visible
    // effect on the layer the reader was looking at and a silent one on the layer
    // below. Before the `detail-open` branch, or the guard is unreachable from a panel,
    // which is the only place a modal is launched from.
    // Anchored on `if (`, not on `Modal.current) return`, because the inverted guard
    // `if (!Modal.current) return` contains that as a substring: it passed this
    // assertion as an `indexOf` while making Escape work only when a modal is open,
    // which is the exact opposite of the line's purpose. A mutation run found it, and
    // it is the second time the same substring lie has landed in this file.
    const iModal = body.search(/if \(Modal\.current\) return/);
    assert.notEqual(iModal, -1,
        'Escape reaches the menu through an open modal, so it steps a menu the reader '
        + 'cannot see past a dialog that ignores the same key');
    assert.ok(iModal < body.indexOf('detail-open'),
        'the modal guard sits after the panel branch, so Escape from a panel with a '
        + 'modal over it still closes the panel');

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

    // ...but only when the reader loses nothing by it. Measured with the refocus
    // unconditional: caret at offset 3 in a note's `.title-input`, a real 198x20 field,
    // and Escape moved focus to the hamburger -- text kept, caret lost, and the reader
    // has to click back into the node. Anchored on `if (`, so the condition cannot be
    // inverted or dropped and still read as present.
    assert.match(body, /if \(noFocusToLose\) menuButton\.focus\(\)/,
        'Escape pulls focus to the hamburger unconditionally, so it takes the caret out '
        + 'of whatever the reader was typing in');

    // The whole condition, compared as one string rather than matched as a prefix.
    // `assert.match` on the opening clauses cannot tell this expression from the same
    // expression widened by `|| true`, and that mutation makes the refocus unconditional
    // -- byte-for-byte the caret theft above. Measured: it passed all 121 tests. This is
    // the third time a substring match has lied in this file, after `Modal.current` and
    // `button:focus-visible`, so the shape here is an equality that runs to the `;`.
    //
    // Every clause is load-bearing and each names a measured state:
    // `!active` and `documentElement` -- no element holds focus, so none is lost.
    // `document.body` -- a click on the canvas or on the panel's own chrome parks focus
    // there; treating it as a caret leaves a keyboard reader seven Tabs from the
    // hamburger, or eight from inside the panel.
    // `contains(active)` -- focus in the menu is about to be made inert.
    const iDecl = body.indexOf('const noFocusToLose =');
    assert.notEqual(iDecl, -1,
        'the refocus is no longer decided by a `noFocusToLose` declaration, so the '
        + 'assertion below reads nothing');
    const decl = body.slice(iDecl, body.indexOf(';', iDecl) + 1).replace(/\s+/g, ' ');
    assert.equal(decl,
        'const noFocusToLose = !active || active === document.body '
        + '|| active === document.documentElement || dropdownContent.contains(active);',
        'the focus condition is not the four clauses it was measured as. A dropped clause '
        + 'and an added one both land here: `|| true` makes the refocus unconditional, '
        + 'and dropping `document.body` strands a reader who clicked the canvas');

    // Read before the click, or the answer is always `false`: by then the panel is inert
    // and the browser has already moved focus out of it.
    assert.match(body, /const active = document\.activeElement;/,
        '`active` is not read from `document.activeElement`, so the condition above may '
        + 'be asking about something else entirely');
    assert.ok(iDecl < iClose,
        'the focus test is read after `menuButton.click()`, where the panel is already '
        + 'inert and focus has already left it, so it answers false every time and the '
        + 'refocus never happens at all');
});

test('every menu row is a button that says what it does', ()=>{
    const rows = htmlCode.match(/<button[^>]*class="[^"]*menu-row[^"]*"[^>]*>/g) || [];
    assert.equal(rows.length, 11,
        'the menu no longer holds eleven rows as <button> open tags; every count below '
        + 'reads this list');

    for (const row of rows) {
        assert.match(row, /type="button"/,
            'a menu row has no type, so it is a submit button: harmless only while '
            + '`closest(\'form\')` is null for all eleven, and `aitab.html` does contain a '
            + '<form>. Row: ' + row.slice(0, 60));
    }

    const tablinks = rows.filter( (r)=> r.includes('tablink') );
    assert.equal(tablinks.length, 5, 'the five panel rows are no longer five');

    // This asserted the opposite for one commit. `aria-haspopup="true"` is defined by
    // ARIA as equivalent to `menu`, and Chrome's AX tree read back `hasPopup: "menu"` on
    // these rows, which promises a menu widget with arrow-key navigation and delivers a
    // panel with a Back button. `aria-expanded` is no substitute, because opening a panel
    // hides the list the row is in, so the state would never be observable. The five
    // being undistinguished from the four commands is a gap; announcing a widget that
    // does not exist is a false statement.
    assert.doesNotMatch(htmlCode, /aria-haspopup/,
        'a menu row claims to open a popup menu. It opens a panel, and the AX tree '
        + 'normalises the claim to `hasPopup: "menu"`, so a screen reader is told to '
        + 'expect arrow keys that do nothing here');

    // What distinguishes the five instead: a word in the name rather than a state
    // attribute. Measured in the AX tree -- `name: "Ai panel"` against `name:
    // "Screenshot"`, `haspopup: null`, `expanded: null`, and the panel heading still
    // reads "Ai".
    const panelSpans = htmlCode.match(/<span class="visually-hidden"> panel<\/span>/g) || [];
    assert.equal(panelSpans.length, 5,
        'the five panel rows no longer carry the word that tells a reader they descend a '
        + 'level. The chevron that says so on screen is `aria-hidden`, so without this '
        + 'they are indistinguishable from the six commands above the separator');

    // A sibling of the label, never a child: `MainMenu.showDetail` reads the panel
    // heading out of `label.textContent`, so nesting the span retitles the heading to
    // "Ai panel" as well. Anchored on the closing tag of the label so the check is about
    // nesting rather than about order.
    assert.doesNotMatch(htmlCode, /<span class="menu-row-label">[^<]*<span/,
        'the visually-hidden word is inside `.menu-row-label`, so `MainMenu.showDetail` '
        + 'picks it up through `label.textContent` and the panel heading now reads '
        + '"Ai panel" instead of "Ai"');
});

test('a digit is not a tool shortcut while the reader is inside the menu', ()=>{
    const iShortcuts = jsCode.indexOf('const toolShortcuts = {');
    assert.notEqual(iShortcuts, -1,
        'the digit shortcuts are gone; this test reads nothing');

    // `focused` is what the guard asks about, so it has to be what holds focus.
    assert.match(jsCode.slice(iShortcuts), /const focused = document\.activeElement;/,
        '`focused` is not read from `document.activeElement`, so the guard below may be '
        + 'asking about something else entirely');

    // The whole guard as one string, not a prefix. The menu is the third case and the
    // other two do not reach it: the rows are `<button>`s, so a reader on one is neither
    // in a field nor in an editor. Measured without the `contains` clause -- focus on
    // `#tablink-ai`, menu open, `1` pressed: a fifth node window appeared behind the
    // panel, focus stayed on the row, and nothing on screen said a node had been made.
    // An equality rather than a `match` for the reason the Escape condition above is one:
    // a prefix cannot tell three clauses from two, and this file has been bitten by that
    // three times.
    const iGuard = jsCode.indexOf('if (focused && (focused.isContentEditable', iShortcuts);
    assert.notEqual(iGuard, -1,
        'the digit shortcuts no longer guard on what holds focus, so a digit typed '
        + 'anywhere fires a tool');
    const guard = jsCode.slice(iGuard, jsCode.indexOf('return;', iGuard) + 7).replace(/\s+/g, ' ');
    assert.equal(guard,
        'if (focused && (focused.isContentEditable '
        + "|| ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName) "
        + '|| dropdownContent.contains(focused))) return;',
        'the digit-shortcut guard is not the three clauses it was measured as. Dropping '
        + '`contains` puts a node behind the open menu with nothing on screen to say so; '
        + 'dropping either of the others fires a tool while the reader is typing');

    // Before the click, or the guard is decoration.
    assert.ok(iGuard < jsCode.indexOf('tool.click()', iShortcuts),
        'the focus guard sits after `tool.click()`, so the tool has already fired by the '
        + 'time the guard decides it should not have');
});
