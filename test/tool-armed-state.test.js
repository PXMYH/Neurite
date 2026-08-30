// The tool pill's lit state and its shortcut digits, which are three files agreeing
// with each other: the digit printed in the markup, the key bound in dropdown.js, and
// the CSS that paints the lit pill. Two of those three can drift without anything
// failing -- a badge reading `2` over a tool whose key is `3` is still a badge, and a
// lit-pill rule whose selector no longer matches is still a rule.
//
// The behaviour underneath was never added: pressing a tool has always left a Node
// following the mouse until a click puts it down. What was added is the signal, so what
// is worth pinning is the signal agreeing with the thing it reports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const html = read('resources/html/tabs/dropdown.html');
const dropdownJs = read('js/interface/dropdown/dropdown.js');
const dropJs = read('js/interface/handledrop.js');
const css = read('resources/styles/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

// The pill only. The rows inside the menu are a different control with a different job.
function toolPill(){
    const start = html.indexOf('<div class="tool-bar"');
    const end = html.indexOf('class="menu-button"');
    assert.ok(start !== -1 && end > start, 'the tool pill was not found in dropdown.html');
    return html.slice(start, end);
}

test('every badge digit is the key that tool actually answers to', ()=>{
    // What dropdown.js binds. This is the source of truth -- the badge is a label for it.
    const table = dropdownJs.match(/const toolShortcuts = \{([^}]*)\}/);
    assert.ok(table, 'the toolShortcuts table is gone or was renamed, so the digits '
                     + 'printed on the tools are no longer checkable against anything');
    const bound = new Map();
    for (const m of table[1].matchAll(/'(\d)':\s*'([a-z-]+)'/g)) bound.set(m[2], m[1]);
    assert.ok(bound.size >= 4, 'fewer than four tool keys are bound: ' + bound.size);

    // What the markup prints. Each tool's div, then the badge inside it.
    const pill = toolPill();
    const printed = new Map();
    for (const m of pill.matchAll(/class="panel-icon ([a-z-]+) node-add-item"[\s\S]*?(?=<div class="panel-icon|$)/g)) {
        const badge = m[0].match(/<span class="tool-key"[^>]*>(\d)<\/span>/);
        if (badge) printed.set(m[1], badge[1]);
    }

    assert.deepEqual([...printed.entries()].sort(), [...bound.entries()].sort(),
        'a tool is showing a digit that is not the key it answers to, or a tool with a '
        + 'bound key is showing none. The badge is a label for dropdown.js\'s '
        + 'toolShortcuts table and has to say what that table says');
});

test('the badge is decoration for a screen reader, and never a click target', ()=>{
    const pill = toolPill();
    const badges = [...pill.matchAll(/<span class="tool-key"([^>]*)>/g)].map(m=> m[1]);
    assert.equal(badges.length, 4, 'expected four badges, found ' + badges.length);
    for (const attrs of badges) {
        // The tooltip and the aria-label already carry the name and the key. A second
        // reading of the digit is noise in the accessibility tree, not help.
        assert.match(attrs, /aria-hidden="true"/,
            'a badge is exposed to a screen reader, which already hears the key from the '
            + 'tool\'s own tooltip');
    }
    // A click on the corner of a tool has to reach the tool.
    const rule = css.match(/\.tool-bar \.tool-key \{([^}]*)\}/);
    assert.ok(rule, 'the .tool-key rule is gone');
    assert.match(rule[1], /pointer-events:\s*none/,
        'the badge can take a click, so pressing the corner of a tool does nothing');
});

test('search carries no digit, because no key is bound to it', ()=>{
    // A badge on a tool with no shortcut would be a label for nothing. Search is the
    // only control in the pill that has none.
    const pill = toolPill();
    const search = pill.slice(pill.indexOf('tool-bar-action'));
    assert.doesNotMatch(search, /tool-key/,
        'the search button grew a shortcut badge. If a key was bound to it, add it to '
        + 'toolShortcuts in dropdown.js so the digit means something');
});

test('the lit pill is its own colour, not the selection accent', ()=>{
    const lit = css.match(/\.tool-bar \.node-add-item\[aria-pressed="true"\] \{([^}]*)\}/);
    assert.ok(lit, 'nothing paints the armed tool any more, so the pill went back to '
                   + 'looking idle while the Node it made is still following the mouse');
    assert.match(lit[1], /background-color:\s*var\(--ui-chrome-active\)/,
        'the armed tool no longer reads --ui-chrome-active');
    // An armed tool is a mode; a selected card is a selection. Sharing the accent
    // between them makes the two states unreadable against each other.
    assert.doesNotMatch(lit[1], /--ui-accent/,
        'the armed tool uses the selection accent, which is the colour selection and '
        + 'focus already own');

    // On the lit pill the digit goes to full contrast rather than staying grey against
    // a surface that just got lighter.
    assert.match(css, /\[aria-pressed="true"\] \.tool-key \{[^}]*var\(--ui-chrome-on-active\)/,
        'the digit stays dim on the lit pill, where its background is no longer dim');
});

test('the light is released a tick late, on purpose', ()=>{
    const arm = dropJs.match(/const ToolArm = \{[\s\S]*?\n\};/);
    assert.ok(arm, 'ToolArm is gone or no longer a single object literal');

    // Truthful rather than remembered: the light follows what the graph is doing.
    assert.match(arm[0], /followingMouse/,
        'the release no longer looks at whether a Node is in flight, so it is guessing');

    // The deferral is the whole mechanism. A Node lands on a document mouseup, and the
    // same mouseup confirms the modal that three of the four tools open before their
    // Node exists. Checked during that mouseup the two are indistinguishable, and the
    // light would go out before those three had produced anything.
    assert.match(arm[0], /setTimeout\(ToolArm\.releaseIfNothingInFlight, 0\)/,
        'the release runs during the mouseup rather than after it, which puts the light '
        + 'out on the click that confirms the link, file-tree or AI modal -- before the '
        + 'Node that click creates has entered flight');

    // Both ways in have to light the same tool, or dragging a tool out leaves the pill dark.
    assert.match(dropJs, /On\.click\(iconDiv[\s\S]{0,400}?ToolArm\.engage\(iconDiv\)/,
        'the click path no longer lights the tool');
    assert.match(dropJs, /On\.dragstart\(iconDiv[\s\S]{0,900}?ToolArm\.engage\(iconDiv\)/,
        'the drag path no longer lights the tool, so dragging one out leaves the pill dark');
});

test('the drag payload still reads the icon name from the class list', ()=>{
    // The lit state is an attribute rather than a class for a reason: `classList[1]` is
    // what the drag payload uses to say which tool was dragged, so a class added for
    // styling would be read as the tool's name and the drop would create the wrong Node.
    assert.match(dropJs, /iconName: iconDiv\.classList\[1\]/,
        'the drag payload no longer reads classList[1]');
    const pill = toolPill();
    for (const m of pill.matchAll(/class="(panel-icon [^"]*node-add-item[^"]*)"/g)) {
        const classes = m[1].trim().split(/\s+/);
        assert.equal(classes[0], 'panel-icon',
            'a class was inserted before `panel-icon`, which shifts every index');
        assert.match(classes[1], /-icon$/,
            'position 1 in the class list is `' + classes[1] + '`, not the icon name. '
            + 'The drag payload reads that index, so the drop would build the wrong Node');
    }
});
