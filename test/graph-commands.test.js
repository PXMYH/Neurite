// The commands that put a graph on disk, bring one back, and start an empty one. There is
// no list of graphs in this interface at all: a graph's durable form is a `.neurite` file,
// so Save to… and Open… are the whole of keeping and restoring one, and what is left in
// the browser is a working copy that only autosave and a refresh ever touch.
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

test('Save to… asks what to call the file when the browser will not', ()=>{
    // A picker asks for the name itself. A download does not: it drops the file wherever the
    // browser puts downloads, under whatever name the page chose -- and the page chose
    // "Graph 4". That was survivable while a list let a graph be renamed before saving;
    // with the file the only copy there is, the name is the only thing telling two graphs
    // apart. Brave is the case that matters here: measured, it exposes no
    // `showSaveFilePicker` at all, so this is the path it always takes.
    const download = savenet.match(/#downloadCopy\(\)\{[\s\S]*?\n {4}\}/);
    assert.ok(download, '#downloadCopy is gone or no longer a method at that indent');
    assert.match(download[0], /this\.#askNameThenDownload/,
        'the download path no longer asks for a name');

    const ask = savenet.match(/#askNameThenDownload = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(ask, '#askNameThenDownload is gone or no longer a field at that indent');
    assert.match(ask[0], /window\.prompt\("Save this graph as:", this\.#suggestedSaveName\(meta\)\)/,
        'the prompt no longer offers a name, so keeping one is not one keypress');

    // What it offers for a graph nobody has named: `Graph.neurite`. The number in
    // `Graph 4` is `#maxGraphId`'s, kept to tell records apart inside the browser -- it
    // says nothing about the graph, and an import had already grown it into `Graph 2 (2)`,
    // which the sanitiser then served as `Graph 2 _2_.neurite`. Measured in a browser: a
    // freshly cleared graph offers `Graph.neurite`, and a graph saved as "Field notes"
    // offers `Field notes.neurite` back.
    const suggest = savenet.match(/#suggestedSaveName\(meta\)\{[\s\S]*?\n {4}\}/);
    assert.ok(suggest, '#suggestedSaveName is gone or no longer a method at that indent');
    assert.match(suggest[0], /'Graph\.neurite'/, 'the default name is not Graph.neurite');
    assert.match(suggest[0], /isAutoTitle\(meta\.title\)/,
        'nothing separates a title this file invented from one the reader typed');
    assert.match(suggest[0], /this\.#fileNameForMeta\(meta\)/,
        'a name the reader typed is no longer offered back, so saving twice starts over');

    // The generated forms it has to recognise, run rather than read: every title this file
    // makes without asking. Miss one and the reader is offered machinery as a file name;
    // match too much and a graph they called "Graph 7 notes" loses its name on the second
    // save.
    const auto = savenet.match(/static isAutoTitle\(title\)\{([\s\S]*?)\n {4}\}/);
    assert.ok(auto, 'isAutoTitle is gone or no longer a static at that indent');
    const isAuto = new Function('title', auto[1]);
    for (const generated of ['Graph 1', 'Graph 42', 'Graph 2 (2)', '', '   ']) {
        assert.equal(isAuto(generated), true, JSON.stringify(generated) + ' is a title this file invented');
    }
    for (const chosen of ['Field notes', 'Graph theory', 'Graph 7 notes', '分形笔记', 'graph']) {
        assert.equal(isAuto(chosen), false, JSON.stringify(chosen) + ' is a name the reader typed');
    }

    const then = savenet.match(/#downloadAs = \(name\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(then, '#downloadAs is gone or no longer a field at that indent');
    assert.match(then[0], /if \(name === null\) return/,
        'cancelling the prompt still writes a file');

    // The answer sticks, or the next save offers `Graph.neurite` again and the reader
    // renames the same graph every time.
    const write = savenet.match(/#writeFile = \(name\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(write, '#writeFile is gone or no longer a field at that indent');
    assert.match(write[0], /meta\.title = /, 'the name typed is not kept as the graph title');
    assert.match(write[0], /saveMeta\(meta\)/, 'the kept title is never written to the store');
});

test('a file is never written without the nodes that are on screen', ()=>{
    // The bug this exists for shipped a real file: 6,529 bytes of settings, saved views and
    // an empty Pane, with `data-node_json` appearing zero times in it, while two notes sat
    // on the canvas. Every part of that failure is quiet -- the download runs, the file has
    // a plausible size, and it opens without error into an empty graph.
    //
    // Two changes, and the order matters. First the bank cannot be skipped:
    // `saveMetaAndData` returns early when the data equals the last write, which is right
    // for an 8-second timer and wrong for the one copy that leaves the browser.
    const download = savenet.match(/#downloadCopy\(\)\{[\s\S]*?\n {4}\}/);
    assert.ok(download, '#downloadCopy is gone or no longer a method at that indent');
    assert.match(download[0], /this\.#stored\.forgetLastWritten\(\)/,
        'the save before a download can be skipped as unchanged again');
    const iForget = download[0].indexOf('forgetLastWritten');
    const iSave = download[0].indexOf('#autosave()');
    assert.ok(iForget < iSave, 'the skip is cleared after the save, which is no clearing');

    // Then the bytes are checked against the screen before they reach a file.
    const guard = savenet.match(/#downloadIfDataHoldsTheNodes = \(name, data\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(guard, '#downloadIfDataHoldsTheNodes is gone or no longer a field at that indent');
    assert.match(guard[0], /includes\('data-node_json'\)/,
        'nothing checks that the data being written holds any node');
    assert.match(guard[0], /alert\(/,
        'a refused save is silent, which is the failure this replaces');
    assert.doesNotMatch(guard[0], /#writeFile\(name\)[\s\S]*#writeFile\(name\)/,
        'the file is written on both branches');

    // The comparison is against the live graph, so an empty canvas still saves.
    const decide = savenet.match(/#downloadAs = \(name\)=>\{[\s\S]*?\n {4}\}/)[0];
    assert.match(decide, /Object\.keys\(Graph\.nodes\)\.length > 0/,
        'the guard no longer asks the graph what is on screen');
});

test('autosave cannot decline to save', ()=>{
    // It had a second exit for a window `#updateGraphs` opened: that function blanked the
    // selected record's title while it rebuilt the list of saves, and `#autosave` treated a
    // blank title as "a save is in progress" and returned without writing. There is no list
    // to rebuild now, and the exit was silent in the worst way -- a title left blank meant
    // every tick for the rest of the session wrote nothing, with nothing on screen to say
    // the graph had stopped being saved.
    const auto = savenet.match(/#autosave = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(auto, '#autosave is gone or no longer a field at that indent');
    assert.doesNotMatch(auto[0], /if \(!selected\.title\) return/,
        'autosave can silently do nothing again');
    assert.match(auto[0], /saveWithTitle\(selected\.title \|\| this\.#titleForNewGraph\(\)\)/,
        'a record with no title no longer gets one, so the save has nothing to key on');

    const update = savenet.match(/#updateGraphs = \(\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(update, '#updateGraphs is gone or no longer a field at that indent');
    assert.doesNotMatch(update[0], /\.title = ''/,
        'the rebuild blanks the selected title again, which is what made a save skippable');
});

test('a dropped .neurite file is a graph, not a node full of JSON', ()=>{
    // Dropping one used to mean dropping it on the list, which was unmarked and is now
    // gone. The canvas takes it -- but the canvas builds Nodes by MIME type, and a bundle
    // has none: `file.type` is empty for a custom extension, so it would have gone to the
    // text handler and shown the reader the JSON header of their own graph.
    const drop = read('js/interface/handledrop.js');
    assert.match(drop, /static isGraphFile\(file\)\{[\s\S]*?\.neurite\$\/i\.test\(file\.name\)/,
        'nothing recognises a graph file by name any more');

    // Ahead of `handleOSFileDrop`, which is what would make a Node of it.
    const iRoute = drop.indexOf('App.viewGraphs.importFile(graphFile)');
    const iNodes = drop.indexOf('this.handleOSFileDrop(ev)');
    assert.ok(iRoute > 0, 'a dropped graph file no longer reaches the importer');
    assert.ok(iRoute < iNodes,
        'the node builders get the file first, so a dropped graph becomes a text node');

    // And the importer's door is public, because the caller is in another file -- savenet.js
    // is a module, so nothing in it is reachable except through `App.viewGraphs`.
    assert.match(savenet, /\n    importFile\(file\)\{/,
        'importFile is gone or private again, so handledrop.js cannot reach it');
    assert.match(savenet, /importFile\(file\)\{[\s\S]*?this\.#autosave\(\)\.then/,
        'the drop no longer banks the graph on screen before replacing it');
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
