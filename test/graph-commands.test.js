// The commands that keep, fork and drop a graph, and the list of the graphs this browser
// holds. All of it is in the menu itself now -- there is no Saves panel and no row named
// Saves -- and each piece below is easy to half-undo.
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

const MENU = 'resources/html/tabs/dropdown.html';
const CSS = 'resources/styles/styles.css';
const SAVENET = 'js/interface/dropdown/savenet.js';

const menu = noHtmlComments(read(MENU));
const css = noBlockComments(read(CSS));
const savenet = noLineComments(read(SAVENET));

test('the selected save is marked without changing its size', ()=>{
    // It was `transform: scale(1.05)`, and a row as wide as its container cannot grow 2.5%
    // at each end without one end leaving. Both ends were measured doing it: centred, the
    // title input was cut on the left ("Graph 3" rendered as "raph 3"); anchored left, the
    // X button sat 13px past the right edge of a 262px menu list.
    //
    // Pinned because the symptom is silent -- nothing throws, and the row still reads as
    // selected. Read from the rule itself, so a transform on some other selector neither
    // satisfies nor breaks this.
    const i = css.indexOf('.selected-save {');
    assert.notEqual(i, -1, '.selected-save has no rule; this test reads nothing');
    const rule = css.slice(i, css.indexOf('}', i));
    assert.doesNotMatch(rule, /transform:/,
        'the selected row transforms again, so it renders wider than the list that holds '
        + 'it and clips whichever end the origin points away from');
    // Still visibly the selected one: colour and an inset bar, both of which cost no width.
    assert.match(rule, /background-color:/, 'the selected row has no marking at all');
    assert.match(rule, /box-shadow:\s*inset/,
        'the accent bar is gone; an inset shadow is what marks the row without taking '
        + 'space from it');
});

test('deleting a save asks first, and names the save it is asking about', ()=>{
    // The one irreversible control in the panel. It used to drop the graph, its blobs and
    // its meta on a single click, while Clear -- which deletes nothing -- asked Yes or No.
    // Anchored on the handler's own definition: `#handleConfirmDelete` holds the deletion
    // now, and a `window.confirm` anywhere else in the file would satisfy a whole-file
    // search while this button still deleted on the first click.
    const clicked = savenet.match(/#onBtnDeleteClicked = \(e\)=>\{[\s\S]*?\n {8}\}/);
    assert.ok(clicked, '#onBtnDeleteClicked is gone or no longer a field at that indent');
    assert.match(clicked[0], /window\.confirm\(msg\)\.then\(this\.#handleConfirmDelete\)/,
        'X deletes a save without asking again');
    // The title, because a list of saves is a list of near-identical rows and "are you
    // sure" does not answer "which one".
    assert.match(clicked[0], /this\.meta\.title/,
        'the question no longer names the graph it is about');

    const handler = savenet.match(/#handleConfirmDelete = \(confirmed\)=>\{[\s\S]*?\n {8}\}/);
    assert.ok(handler, '#handleConfirmDelete is gone or no longer a field at that indent');
    assert.match(handler[0], /if \(!confirmed\) return/,
        'the save is deleted whatever the reader answers');
    assert.match(handler[0], /deleteForMeta\(meta\)/,
        'the confirmed branch no longer deletes anything');
});

test('Save graph answers the click', ()=>{
    // It read as a button that did nothing. It always worked -- the fork was in the list
    // within the same tick -- but the menu does not close around a command, the list was
    // two clicks away in a panel, and the row said the same word before and after. So the
    // click had no answer anywhere on screen.
    const clicked = savenet.match(/#onBtnSaveGraphClicked = \(e\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(clicked, '#onBtnSaveGraphClicked is gone or no longer a field at that indent');
    assert.match(clicked[0], /\.then\(this\.#reportGraphSaved\)/,
        'the click is silent again');

    // Into the label span, never the button: writing to the button replaces the icon with
    // the words. Same reason `Recorder.setRecordLabel` and `#updateDiskFileButton` do it.
    const report = savenet.match(/#reportGraphSaved = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(report, '#reportGraphSaved is gone or no longer a field at that indent');
    assert.match(report[0], /querySelector\('\.menu-row-label'\)/,
        'the word is written somewhere other than the label span');

    // And it has to put back exactly what the markup carries, or one click renames the row
    // for the rest of the session -- the bug the Store View button already had.
    const label = menu.match(/id="save-graph-button"[\s\S]*?<span class="menu-row-label">([^<]+)</);
    assert.ok(label, 'the Save graph row is gone or has no label span');
    const restore = savenet.match(/#restoreSaveGraphLabel = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(restore, '#restoreSaveGraphLabel is gone or no longer a field at that indent');
    assert.ok(restore[0].includes('"' + label[1] + '"'),
        'the row is restored to a different word than the markup carries: markup says "'
        + label[1] + '"');
});

test('an imported graph cannot take a title the list already holds', ()=>{
    // A `.neurite` file names itself after the graph it came from, so opening one twice --
    // or opening a file this browser exported at all -- lands a second save under a title
    // already in the list. Two identical rows is the visible half. The half that loses work
    // is `CoreSaver.save`: it overwrites *every* save whose title matches, so one autosave
    // tick later both rows hold the same graph.
    const after = savenet.match(/#afterImport\(importer, file\)\{[\s\S]*?\n {4}\}/);
    assert.ok(after, '#afterImport is gone or no longer a method at that indent');
    assert.match(after[0], /this\.#freeTitle\(/,
        'an imported file takes its title straight from the file name again');

    const free = savenet.match(/#freeTitle\(title\)\{[\s\S]*?\n {4}\}/);
    assert.ok(free, '#freeTitle is gone or no longer a method at that indent');
    assert.match(free[0], /this\.#graphs\.some\(Object\.hasTitleThis, base\)/,
        'the guard no longer asks the list whether the title is taken');
    assert.match(free[0], /while \(/,
        'the guard tries one alternative and gives up, so a third import collides again');

    // `CoreSaver.save` is the reason any of this matters; if it ever stops overwriting by
    // title, this whole test is describing a hazard that no longer exists.
    assert.match(savenet, /\.filter\(Object\.hasTitleThis, this\.title\)\.length/,
        'saves are no longer matched by title, so re-read whether #freeTitle is needed');
});

test('nothing narrates autosave', ()=>{
    // The negative control for this whole test: if stripping ever stops working, the
    // comment that explains the removal satisfies every assertion below.
    assert.doesNotMatch(menu, /<!--/, 'comments survived the strip; the checks below are blind');

    assert.doesNotMatch(menu, /autosave-status/, 'the status span is back in the menu');
    assert.doesNotMatch(menu, /Autosaving/, 'the menu says Autosaving again');
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

test('Save graph forks the graph rather than saving over it', ()=>{
    assert.match(menu, /id="save-graph-button"/, 'Save graph is not a row of the menu');
    // Before it, the only way to keep a graph as it is and carry on was Save to… then
    // Open… -- a round trip through the disk to copy something that never left the
    // browser. `saveWithTitle` on a *new* title is what makes it a copy: on an existing
    // title `CoreSaver.save` overwrites every save of that name instead.
    const handler = savenet.match(/#onBtnSaveGraphClicked = \(e\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(handler, '#onBtnSaveGraphClicked is gone or no longer a field at that indent');
    assert.match(handler[0], /this\.#autosave\(\)/,
        'the graph is not banked first, so the save left behind is up to eight seconds '
        + 'older than the copy carried on in, and the two are a fork of nothing the '
        + 'reader saw');
    assert.match(handler[0], /this\.#selectedGraph/,
        'nothing checks whether a save exists yet. With none selected `#autosave` opens '
        + 'one of its own, so forking after it leaves two identical entries per click');

    const fork = savenet.match(/#forkGraph = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(fork, '#forkGraph is gone or no longer a field at that indent');
    assert.match(fork[0], /saveWithTitle\(this\.#titleForNewGraph\(\)\)/,
        'the fork no longer takes a fresh title, so it overwrites the save it came from');

    // The title has to be one no save holds, and `#maxGraphId` only climbing is the whole
    // reason it is. A timestamp or a counter of its own would collide after a delete.
    const title = savenet.match(/#titleForNewGraph\(\)\{[^\n]*\}/);
    assert.ok(title, '#titleForNewGraph is gone or no longer a one-line method');
    assert.match(title[0], /this\.#maxGraphId \+ 1/, 'the new title is no longer taken from #maxGraphId');
    assert.doesNotMatch(savenet, /#maxGraphId -= |#maxGraphId = 0;(?!\n)/,
        '#maxGraphId is reset or decremented somewhere, so a new title can name a save '
        + 'that already exists and the fork silently overwrites it');
});

test('Clear is a command row that asks through the modal', ()=>{
    const clearRows = menu.match(/id="clear-button"/g) || [];
    assert.equal(clearRows.length, 1, 'Clear is not a row of the menu exactly once');

    // The Yes/No pair and the label rewrite are what the modal replaced. Left behind,
    // they are three dead elements and a handler writing to a button that has an icon in
    // it -- `btn.text` is an `<a>` property and silently does nothing on a `<button>`.
    for (const id of ['clear-sure', 'clear-sure-button', 'clear-unsure-button']) {
        assert.doesNotMatch(menu, new RegExp('id="' + id + '"'),
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
