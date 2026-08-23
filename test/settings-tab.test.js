// The menu's markup is split across one file per tab, the tab list is a third
// file, and the JS that binds a control finds it by id with no idea which file it
// came from. So moving a control between tabs -- which is what the Settings tab
// is -- can lose it in three silent ways: the tab is declared but never loaded,
// so it is blank; a control is loaded twice, so `Elem.byId` binds the copy the
// reader is not looking at; or a control is bound at startup and is in no file at
// all, so `On.click(null, ...)` throws before the rest of `init` runs.
//
// None of that shows up in a typecheck and none of it has a runtime guard. Read
// as text, the way provider-wiring.test.js does, because nothing under js/
// exports and the question here is about the code's shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

// A `PageLoad.scripts` entry is spelled `.js` even when the file on disk is `.ts`
// -- the dev server answers the request by stripping the types, so the array never
// learns which is which (ADR-0002). Resolve it the way the server does.
function readScript(p){
    try { return read(p) }
    catch { return read(p.replace(/\.js$/, '.ts')) }
}

// The HTML that is in the page once loading finishes: `index.html`, then
// `PageLoad.resources`, then `PageLoad.tabs`. Taken from main.js rather than
// listed here, so a file added to the app is covered without touching this.
function loadedHtml(){
    const src = read('js/main.js');

    const resBlock = src.slice(src.indexOf('static resources = ['),
                               src.indexOf(']', src.indexOf('static resources = [')));
    const resources = [...resBlock.matchAll(/'([^']+)'/g)].map( (m)=> 'resources/' + m[1] + '.html' );
    assert.ok(resources.length >= 4, 'PageLoad.resources parse is stale: ' + resources.length);

    const tabBlock = src.slice(src.indexOf('static tabs = {'),
                               src.indexOf('}', src.indexOf('static tabs = {')));
    const tabs = [...tabBlock.matchAll(/'([\w-]+)'\s*:\s*'([^']+)'/g)]
        .map( (m)=> 'resources/html/tabs/' + m[2] );
    assert.ok(tabs.length >= 5, 'PageLoad.tabs parse is stale: ' + tabs.length);

    // SVG partials hold no controls and no ids the menu binds.
    const files = ['index.html', ...resources.filter( (p)=> !p.includes('/svg/') ), ...tabs];
    return Object.fromEntries(files.map( (p)=> [p, read(p)] ));
}

// Every `id="..."` in the page, as {id: [file, ...]}, so a duplicate is visible
// rather than collapsed.
function idsByName(html){
    const out = {};
    for (const file in html) {
        for (const match of html[file].matchAll(/\sid="([^"]+)"/g)) {
            (out[match[1]] ??= []).push(file);
        }
    }
    return out;
}

const html = loadedHtml();
const ids = idsByName(html);

test('every tab the menu opens is loaded and has somewhere to load into', ()=>{
    // Three lists have to agree and nothing checks them: the tab row's
    // `openTab('tabN')` calls, the empty `#tabN` containers under it, and the
    // `PageLoad.tabs` map naming the file for each. Miss the container and the
    // fetch has no target; miss the map entry and the tab opens blank.
    const dropdown = html['resources/html/tabs/dropdown.html'];
    const opened = [...dropdown.matchAll(/openTab\('([\w-]+)'/g)].map( (m)=> m[1] );
    const containers = [...dropdown.matchAll(/id="([\w-]+)" class="tabcontent"/g)].map( (m)=> m[1] );

    const src = read('js/main.js');
    const tabBlock = src.slice(src.indexOf('static tabs = {'),
                               src.indexOf('}', src.indexOf('static tabs = {')));
    const loaded = [...tabBlock.matchAll(/'([\w-]+)'\s*:/g)].map( (m)=> m[1] );

    assert.ok(opened.length >= 5, 'no tab links found in dropdown.html: ' + opened.length);
    assert.deepEqual(opened.filter( (id)=> !containers.includes(id) ), [],
        'a tab link opens an id with no .tabcontent container');
    assert.deepEqual(opened.filter( (id)=> !loaded.includes(id) ), [],
        'a tab link opens a tab PageLoad.tabs never fetches content for');
    assert.deepEqual(containers.filter( (id)=> !loaded.includes(id) ), [],
        'a .tabcontent container is never filled');

    assert.ok(opened.includes('tab5'), 'the Settings tab is not in the tab row');
});

test('every placement slider ZetPath reads is in the page exactly once', ()=>{
    // `ZetPath.updateOptions` reads these by id out of `Modal.inputValues`, and
    // `ZetPath.init` writes each one's default straight into the DOM by id. Two
    // copies means the default lands on whichever comes first and the reader
    // drags the other; no copy means `init` throws on null.
    const src = read('js/zettelkasten/zetpath.js');
    const sliderIds = [...src.matchAll(/newOption\("([^"]+)"/g)].map( (m)=> m[1] );
    assert.ok(sliderIds.length >= 12,
        'ZetPath.options parse is stale, found ' + sliderIds.length + ' sliders');

    const missing = sliderIds.filter( (id)=> !ids[id] );
    const duplicated = sliderIds.filter( (id)=> ids[id]?.length > 1 );
    assert.deepEqual(missing, [], 'placement sliders in no loaded HTML file');
    assert.deepEqual(duplicated, [], 'placement sliders present twice');

    // And they are all in one place, not scattered back across two tabs.
    const files = new Set(sliderIds.map( (id)=> ids[id][0] ));
    assert.deepEqual([...files], ['resources/html/tabs/settingstab.html']);
});

test('the placement controls are wired now that no modal clones them', ()=>{
    // `Modal.open` used to be what bound them: it copies a template's markup into
    // the shared modal body and wires the copy. Nothing does that for markup that
    // sits in the page, so `ZetPath.init` has to wire it, and it has to write to
    // the same store `updateOptions` reads -- the `noteModal` one, whose
    // `storeInputValue` is also what re-places the nodes on a change.
    const src = read('js/zettelkasten/zetpath.js');
    assert.match(src, /Modal\.wireControls\(\s*Elem\.byId\('zetPlacementSettings'\)\s*,\s*Modals\.noteModal\s*\)/);
    assert.ok(ids.zetPlacementSettings, 'nothing in the page carries that id');

    const modal = read('js/interface/dropdown/customui/custommodal.js');
    assert.match(modal, /Modal\.wireControls = function/, 'the helper it calls is gone');
    assert.match(modal, /Modal\.wireControls\(modalBody, modal\)/,
        'Modal.open no longer wires through the same helper, so the two can drift');
    assert.match(modal, /if \(contentId === 'noteModal'\) ZetPath\.updateOptions\(\)/,
        'a change to a placement control no longer re-places the nodes');
});

test('the Zettelkasten tag inputs are in the page once and bound without a modal', ()=>{
    // `Tag.init` reads these two out of `Modal.inputValues` by id, and `#onTagInput`
    // decides which of the two it is from `data-key`, so both the id and the
    // attribute are load-bearing. Two copies and the wrong one gets bound; no copy
    // and the null-guard in `initializeInputs` returns without a word, leaving a
    // typed Node Tag that works until the page reloads.
    const settings = html['resources/html/tabs/settingstab.html'];
    for (const [id, key] of [['node-tag', 'node'], ['ref-tag', 'ref']]) {
        assert.deepEqual(ids[id], ['resources/html/tabs/settingstab.html'],
            id + ' is not in the Settings tab exactly once');
        assert.match(settings, new RegExp(`id="${id}" data-key="${key}"`),
            id + ' lost its data-key, so the handler cannot tell the two tags apart');
    }

    const globals = read('js/globals.js');
    assert.match(globals, /Modal\.wireControls\(\s*Elem\.byId\('zetTagSettings'\)\s*,\s*Modals\.noteModal\s*\)/);
    assert.match(globals, /Tag\.initializeInputs\(\);/,
        'no modal opens these now, so init has to be what calls this');
    assert.ok(ids.zetTagSettings, 'nothing in the page carries that id');

    // `#noteModal` is deleted. `Modals.noteModal` survives only as the store id, so
    // a call to open it would find no element and log an error instead.
    for (const file of ['js/interface/dropdown/tabs/notestab.js', 'js/globals.js']) {
        assert.doesNotMatch(read(file), /Modal\.open\('noteModal'\)/,
            file + ' opens a modal whose markup no longer exists');
    }
});

test('the Archive controls are gone from the register as well as the page', ()=>{
    // The dropdown was a second register of Panes -- its option list was the set of
    // them and its value was the active one. Removing the markup while leaving those
    // reads in place is the silent failure: `container.querySelector` gives null, and
    // the throw lands in `new ZetPanes`, before `App.init` runs at all.
    const src = read('js/interface/dropdown/tabs/notestab.js');
    for (const gone of ['paneDropdown', 'zet-add-pane-button', 'zet-delete-pane-button',
                        'zet-settings-button', 'removeSelectedPane']) {
        assert.doesNotMatch(src, new RegExp(gone),
            'ZetPanes still reaches for ' + gone + ', which is not in the page');
    }
    for (const id of ['zetPaneDropdown']) {
        assert.equal(ids[id], undefined, id + ' is back in the page');
    }

    // What the removal must not break: three callers outside this file drive Panes
    // directly, and a saved graph with several Archives depends on all three. Anchored
    // to the class body's indent, because a bare `switchPane(` also matches the
    // `this.switchPane(...)` calls inside the file -- which survive a rename of the
    // definition and would report a method that is no longer there.
    for (const method of ['addPane', 'restorePane', 'switchPane']) {
        assert.match(src, new RegExp('^    ' + method + '\\(', 'm'),
            method + ' is no longer defined here, but is called from outside this file');
    }
    assert.ok(ids.notesSearchButton, 'the search button went with them');
});

test('every control bound at startup by a literal id is in the page', ()=>{
    // `On.click(Elem.byId('x'), ...)` says the element is already there. The
    // Settings tab moved three of these between files; this is the check that a
    // move like that took, and it covers the ones nobody has moved yet too.
    const src = read('js/main.js');
    const scriptBlock = src.slice(src.indexOf('static scripts = ['),
                                 src.indexOf('];', src.indexOf('static scripts = [')));
    const files = [...scriptBlock.matchAll(/'([^':]+\.js)(?::MODULE)?'/g)].map( (m)=> m[1] );
    assert.ok(files.length >= 70, 'PageLoad.scripts parse is stale: ' + files.length);

    const bound = new Set();
    for (const file of files) {
        for (const m of readScript(file).matchAll(/On\.\w+\(\s*Elem\.byId\('([^']+)'\)/g)) {
            bound.add(m[1]);
        }
    }
    assert.ok(bound.size >= 5, 'no id-literal bindings found: ' + bound.size);
    for (const id of ['controls-button', 'resetSettings', 'clearLocalStorage']) {
        assert.ok(bound.has(id), id + ' is no longer bound at startup; this test is stale');
    }

    assert.deepEqual([...bound].filter( (id)=> !ids[id] ), []);
});
