// The places -- `// Seahorse Valley West` and the rest -- are a panel of their own now.
// They were the lower two thirds of the Saves panel, which put two unrelated jobs behind
// one row: what the browser is holding on to, and where the reader is looking.
//
// Three ways to get this half-right, and one of them is silent:
//
// - Leave a copy of a control behind. Every id below is bound once, by `Elem.byId` at the
//   top level of a script, so a second element with the same id is the one nothing is
//   wired to -- and the wired one may be in a panel nobody opens.
// - Move the markup and not the loader. A tab with no `PageLoad.tabs` entry is an empty
//   div, and the scripts that bind its ids then find nothing: `Store Coordinates` would
//   be a button that does not react, with no error anywhere.
// - Keep the three containers. `distributeCoordinates` sliced the list across them by
//   percentage, so the places read out of order with dead bands between them.
//
// Read as text, like the other tests here: nothing under js/ exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const TABS = 'resources/html/tabs/';
const VIEWS = TABS + 'viewstab.html';
const SAVES = TABS + 'networkstab.html';
const MENU = TABS + 'dropdown.html';

const views = read(VIEWS);
const saves = read(SAVES);
const menu = read(MENU);
const main = read('js/main.js');
// Comments stripped: the explanation of what was removed names it, so an unstripped
// search finds the note about the deletion and calls the deletion undone. Whole-line
// comments only, never `//` to end of line -- a `//` inside a string is code, and hiding
// the rest of that line would make the `doesNotMatch` and the count below fail open.
const coords = read('js/interface/dropdown/customui/displaysavedcoords.js')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
const css = read('resources/styles/styles.css');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

// Every panel file, so "moved" can mean "is here and nowhere else" rather than "is here".
const tabFiles = readdirSync(new URL(TABS, root)).filter( (f)=> f.endsWith('.html') );

test('every control of a saved view is in the Views panel and nowhere else', ()=>{
    assert.ok(tabFiles.includes('viewstab.html'), 'the Views panel file is gone');
    assert.ok(tabFiles.length >= 8, 'only ' + tabFiles.length + ' tab files; this scan is stale');

    for (const id of ['savedCoordinatesContainer', 'saveCoordinatesBtn',
                      'deleteCoordinatesBtn', 'pan', 'zoom']) {
        const holders = tabFiles.filter( (f)=> new RegExp('\\sid="' + id + '"').test(read(TABS + f)) );
        assert.deepEqual(holders, ['viewstab.html'],
            id + ' is not in the Views panel exactly once');
    }

    // The pair of boxes is the numeric form of a place, and both are inputs: `interface.js`
    // parses what is typed and moves the view. A readout would be a `<span>`, and the day
    // this becomes one the panel silently loses the only way to reach an unnamed point.
    for (const id of ['pan', 'zoom']) {
        assert.match(views, new RegExp('<input id="' + id + '" type="text"'),
            id + ' is no longer an input, so a coordinate can be read but not typed');
    }
});

test('the Views panel is reachable, and the loader fills it', ()=>{
    assert.match(main, /'tab7': 'viewstab\.html'/,
        'nothing loads viewstab.html, so the panel opens empty and every id in it is null '
        + 'when displaysavedcoords.js binds');
    assert.match(menu, /<div id="tab7" class="tabcontent">/, 'the panel has no container to load into');
    assert.match(menu, /onclick="openTab\('tab7', this\)"/, 'no menu row opens the Views panel');

    // Order, not merely presence. `displaysavedcoords.js` calls `Elem.byId` at the top
    // level of the file, so the tab markup has to exist before any script runs; scripts
    // loading first would leave Store and Delete bound to nothing at all.
    const iTabs = main.indexOf('await this.loadTabs(PageLoad.tabs)');
    const iScripts = main.indexOf('for (const src of PageLoad.scripts)');
    assert.ok(iTabs > 0 && iScripts > iTabs,
        'scripts now load before the tab markup, so every top-level `Elem.byId` in a tab '
        + 'panel reads null');
    assert.match(coords, /On\.click\(Elem\.byId\('saveCoordinatesBtn'\), saveCurrentView\)/,
        'Store Coordinates is no longer bound');
});

test('the places are one wrapping row, not three sliced ones', ()=>{
    assert.doesNotMatch(coords, /distributeCoordinates/,
        'the percentage split is back, so the places read out of order');
    const calls = coords.match(/appendViewsToContainer\(/g) || [];
    assert.equal(calls.length, 2, 'expected one definition and one call: ' + calls.length);

    for (const id of ['savedCoordinatesContainerTop', 'savedCoordinatesContainerBottom']) {
        assert.doesNotMatch(coords + cssCode + views + saves, new RegExp(id),
            id + ' is back in the markup, the stylesheet or the script');
    }

    // No fixed height on what is left. The three it replaces were 90px, 140px and 60px
    // tall whatever they held, which is where the empty bands came from.
    const i = cssCode.indexOf('#savedCoordinatesContainer {');
    assert.notEqual(i, -1, 'the container has no rule; this test reads nothing');
    assert.doesNotMatch(cssCode.slice(i, cssCode.indexOf('}', i)), /height:/,
        'the container is a fixed height again, so it holds dead space when it has few '
        + 'places and clips when it has many');
});

test('the Saves panel says what it is now that it holds only a list', ()=>{
    // Its rows are built by `savenet.js`, so with the coordinates gone the file itself has
    // no words in it. An empty bordered box reads as a panel that failed to load rather
    // than as a reader who has saved nothing yet -- and `notes-tab-removed.test.js` reads
    // this heading as the panel's visible text when it checks that the menu row describes
    // the panel it opens.
    assert.match(saves, /class="button-label settings-heading">Saved Graphs</,
        'the Saves panel has no heading, so it is a wordless box');
    assert.match(saves, /id="saved-networks-container"/, 'the list is gone from the Saves panel');
    assert.doesNotMatch(saves.replace(/<!--[\s\S]*?-->/g, ''), /Coordinates/,
        'a coordinate control is back in the Saves panel');
});
