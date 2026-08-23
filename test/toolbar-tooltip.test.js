// The tool pill is icon-only, so nothing in it says what a tool is except its
// tooltip -- and the tooltip is three files agreeing with each other: an attribute
// in the markup, a script that reads that attribute, and a class in the stylesheet
// that makes the box it creates visible. Break any one of the three and the pill
// still renders, still works, and stops naming its tools. There is nothing to see
// in a screenshot and nothing to catch in a typecheck.
//
// So these read the source as text, the way settings-tab.test.js does, and check
// the joints between the three files rather than any one of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const dropdownHtml = read('resources/html/tabs/dropdown.html');
const mainJs = read('js/main.js');
const dropdownJs = read('js/interface/dropdown/dropdown.js');
const tooltipJs = read('js/interface/dropdown/customui/hovertooltip.js');
const css = read('resources/styles/styles.css');

// The pill only: the tabs inside the menu are labelled buttons and keep their own
// `title`, which is not what any of this is about.
function toolPill(){
    const start = dropdownHtml.indexOf('<div class="tool-bar"');
    const end = dropdownHtml.indexOf('class="menu-button"');
    assert.ok(start !== -1 && end > start, 'the tool pill was not found in dropdown.html');
    return dropdownHtml.slice(start, end);
}

// Each control as {tag, attrs, inner}. The controls hold an `<svg>` and nothing
// else, so the first matching close tag is the right one.
function controls(){
    const pill = toolPill();
    const out = [];
    for (const match of pill.matchAll(/<(div|button)\b([^>]*)>/g)) {
        const [tag, attrs] = [match[1], match[2]];
        if (!/node-add-item|tool-bar-action/.test(attrs)) continue;
        const from = match.index + match[0].length;
        const inner = pill.slice(from, pill.indexOf('</' + tag + '>', from));
        out.push({tag, attrs, inner});
    }
    assert.equal(out.length, 5, 'expected the four creators and Search: ' + out.length);
    return out;
}

test('every tool in the pill is named on hover and to a screen reader', ()=>{
    for (const {attrs, inner} of controls()) {
        const name = attrs.match(/aria-label="([^"]+)"/);
        const tip = attrs.match(/data-tooltip="([^"]+)"/);

        // The label text used to be the accessible name. It is gone, and an `<svg>`
        // marked `aria-hidden` leaves nothing behind it.
        assert.ok(name, 'a tool has no aria-label: ' + attrs.trim());
        assert.ok(tip, 'a tool has no data-tooltip, so hovering it says nothing: ' + attrs.trim());

        // The tooltip is the sighted half of the accessible name, so it leads with
        // the same words. Drift here means the two describe different controls.
        assert.ok(tip[1].startsWith(name[1]),
            `the tooltip does not lead with the aria-label: ${tip[1]} vs ${name[1]}`);

        // Both would show: the custom box at once, the browser's a second later,
        // stacked on top of it.
        assert.doesNotMatch(attrs, /\stitle="/, 'a tool still carries a title: ' + attrs.trim());

        // A label left in one tool is worse than five: the pill goes ragged and the
        // odd one out reads as the only control that does something different.
        const text = inner.replace(/<[^>]*>/g, '').trim();
        assert.equal(text, '', 'a tool still renders label text: ' + JSON.stringify(text));
    }
});

test('the digit shortcuts match the digits the tooltips promise', ()=>{
    // dropdown.js maps 1-4 to icon classes and the tooltips spell those digits out.
    // Reorder the pill and the promise is what breaks, silently.
    const block = dropdownJs.slice(dropdownJs.indexOf('const toolShortcuts = {'),
                                   dropdownJs.indexOf('}', dropdownJs.indexOf('const toolShortcuts = {')));
    const bound = [...block.matchAll(/'(\d)'\s*:\s*'([\w-]+)'/g)].map( (m)=> [m[1], m[2]] );
    assert.equal(bound.length, 4, 'toolShortcuts parse is stale: ' + bound.length);

    for (const [digit, iconClass] of bound) {
        const tool = controls().find( (c)=> c.attrs.includes(iconClass) );
        assert.ok(tool, `no tool in the pill has the class ${iconClass} that ${digit} presses`);
        assert.match(tool.attrs, new RegExp(`data-tooltip="[^"]*\\(${digit}\\)`),
            `the ${iconClass} tooltip does not name the digit ${digit} that presses it`);
    }
});

test('the tooltip script is loaded, and the classes it writes are the styled ones', ()=>{
    // A file missing from PageLoad.scripts never runs and says nothing about it
    // (ADR-0001). Here that costs every name in the chrome.
    assert.match(mainJs, /'js\/interface\/dropdown\/customui\/hovertooltip\.js'/,
        'hovertooltip.js is not in PageLoad.scripts, so no control in the chrome is named');

    // The box is created in JS and made visible in CSS. Rename either half and the
    // tooltip is built, positioned, filled -- and `display: none`.
    const created = tooltipJs.match(/Html\.make\.div\('([\w-]+)'\)/);
    const shown = tooltipJs.match(/classList\.add\('([\w-]+)'\)/);
    assert.ok(created && shown, 'hovertooltip.js no longer creates or shows a div by class name');

    assert.ok(css.includes('.' + created[1] + ' {'),
        `styles.css has no rule for .${created[1]}, the class the tooltip is created with`);
    assert.ok(css.includes('.' + shown[1] + ' {'),
        `styles.css has no rule for .${shown[1]}, the class that makes the tooltip visible`);
});

test('no control in the chrome depends on the tooltip for its accessible name', ()=>{
    // `title` fed the accessible name; `data-tooltip` does not feed anything. Every
    // control that swapped one for the other therefore needs a name of its own, or
    // it disappears from Chrome's AX tree -- which is how the menu button was caught.
    const chrome = dropdownHtml.slice(0, dropdownHtml.indexOf('class="dropdown-content"'));
    let checked = 0;

    for (const match of chrome.matchAll(/<(div|button)\b([^>]*\bdata-tooltip=[^>]*)>/g)) {
        const [tag, attrs] = [match[1], match[2]];
        const from = match.index + match[0].length;
        const inner = chrome.slice(from, chrome.indexOf('</' + tag + '>', from));

        // Either it carries the name, or it wraps a control that a <label> names.
        assert.ok(/aria-label="/.test(attrs) || /<label\b/.test(inner),
            'a control has a tooltip and no accessible name: ' + attrs.trim());
        checked++;
    }
    assert.ok(checked >= 7, 'the data-tooltip parse is stale: ' + checked);
});

test('the chrome asks for its tooltip by attribute, not per element', ()=>{
    // The whole point of the delegated listener is that markup fetched after boot --
    // every tab's HTML is -- opts in with the attribute alone. A selector that named
    // the pill's classes instead would quietly limit it to the pill.
    assert.match(tooltipJs, /static selector = '\[data-tooltip\]'/,
        'hovertooltip.js no longer keys off data-tooltip');
    assert.match(tooltipJs, /On\.mouseover\(document/,
        'hovertooltip.js no longer delegates from document, so late markup is uncovered');
});
