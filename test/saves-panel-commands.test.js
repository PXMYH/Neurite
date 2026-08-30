// Two things left the Saves panel together, and each is easy to half-undo.
//
// "Autosaving" was a status for a state that has no other value: `#startAutosave` runs
// from `init` and nothing stops it. A label that can only ever read one way is not a
// status, so it went -- and the risk now is the opposite one, that someone adds the
// switch the label implied and the writing of a graph becomes optional.
//
// Clear became a row of the menu beside Save to…. In the panel it asked its question with
// a Yes/No pair and a label that rewrote itself; a row cannot grow a second row without
// moving every row below it, so the question is `window.confirm` now. Both halves are
// pinned: the markup is gone, and the confirm actually gates the wipe.
//
// Read as text, like help-tab.test.js: nothing under js/ exports. Comments are stripped
// first -- this file's own subject words appear in the comments of the files it reads, so
// an unstripped search would find the explanation of a removal and call it the removal
// undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const noHtmlComments = (s)=> s.replace(/<!--[\s\S]*?-->/g, '');
const noBlockComments = (s)=> s.replace(/\/\*[\s\S]*?\*\//g, '');
const noLineComments = (s)=> s.replace(/^\s*\/\/.*$/gm, '');

const SAVES = 'resources/html/tabs/networkstab.html';
const MENU = 'resources/html/tabs/dropdown.html';
const CSS = 'resources/styles/styles.css';
const SAVENET = 'js/interface/dropdown/savenet.js';

const saves = noHtmlComments(read(SAVES));
const menu = noHtmlComments(read(MENU));
const css = noBlockComments(read(CSS));
const savenet = noLineComments(read(SAVENET));

test('the Saves panel no longer narrates autosave', ()=>{
    // The negative control for this whole test: if stripping ever stops working, the
    // comment that explains the removal satisfies every assertion below.
    assert.doesNotMatch(saves, /<!--/, 'comments survived the strip; the checks below are blind');

    assert.doesNotMatch(saves, /autosave-status/, 'the status span is back in the panel');
    assert.doesNotMatch(saves, /Autosaving/, 'the panel says Autosaving again');
    assert.doesNotMatch(css, /^\.autosave-status/m, 'the status still has a rule of its own');
    // The dot was `content: "\25CF"` on `::before`, and it was the part that read as a
    // live indicator while being a constant.
    assert.doesNotMatch(css, /25CF/, 'the indicator dot is still drawn somewhere');
});

test('autosave has no switch', ()=>{
    // The panel stopped saying it saves. That is only honest while it always does.
    const start = savenet.match(/#startAutosave = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(start, '#startAutosave is gone or no longer a field at that indent');
    assert.match(start[0], /setInterval\(this\.#autosave, 8000\)/,
        'the timer that writes the graph is gone');
    assert.match(start[0], /On\.visibilitychange\(document, this\.#onVisibilityChanged\)/,
        'the save on tab-hide is gone, and it is the one that catches a closing tab');

    // Called from the load chain, unconditionally, exactly once. An `if` in front of this
    // is how autosave would quietly become opt-in.
    const calls = savenet.match(/#startAutosave\b/g) || [];
    assert.equal(calls.length, 2, 'expected one definition and one call site: ' + calls.length);
    assert.match(savenet, /\.then\(this\.#startAutosave\)/,
        '#startAutosave is no longer reached by the load chain');

    // A setting named for it would be the switch arriving by the back door.
    assert.doesNotMatch(savenet, /settings\.\w*[aA]utosave/,
        'autosave now reads a setting, so it can be turned off');
});

test('Clear is a command row that asks through the modal', ()=>{
    assert.doesNotMatch(saves, /clear-button/, 'Clear is back inside the panel');
    assert.match(menu, /id="clear-button"/, 'Clear is not a row of the menu');

    // The Yes/No pair and the label rewrite are what the modal replaced. Left behind,
    // they are three dead elements and a handler writing to a button that has an icon in
    // it -- `btn.text` is an `<a>` property and silently does nothing on a `<button>`.
    for (const id of ['clear-sure', 'clear-sure-button', 'clear-unsure-button']) {
        assert.doesNotMatch(saves + menu, new RegExp('id="' + id + '"'),
            id + ' is still in the markup');
        assert.doesNotMatch(savenet, new RegExp("byId\\('" + id + "'\\)"),
            id + ' is still bound in savenet.js');
    }
    assert.doesNotMatch(savenet, /#btnClear\.text/,
        'the label rewrite is back, and a menu row keeps its words in a child span');

    // The gate itself: the wipe runs only on a true answer. Anchored on the handler's own
    // definition, because `#startNewGraph` is also reached from the import path.
    const handler = savenet.match(/#handleConfirmClear = \(confirmed\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(handler, '#handleConfirmClear is gone or no longer a field at that indent');
    assert.match(handler[0], /if \(!confirmed\) return/,
        'Clear wipes the screen whatever the reader answers');
    assert.match(handler[0], /#autosave\(\)\.then\(this\.#startNewGraph\)/,
        'Clear no longer banks the graph before clearing it');
    assert.match(savenet, /window\.confirm\(msg\)\.then\(this\.#handleConfirmClear\)/,
        'nothing asks the question that #handleConfirmClear answers');
});
