// A notes Pane owns four objects built around one editor: a parser, a UI, a
// processor, and the editor itself. It used to be four `window.*` arrays
// correlated by position, and `removePane` filtered only the first of them, so a
// deleted Pane's other three stayed registered for the rest of the session.
//
// The behaviour is only reachable through CodeMirror and a live document, so
// these tests pin the *structure* that made the bug possible instead: one list,
// one push, one splice, and a Pane named by its own id rather than by where it
// sits. Behaviour is verified in a browser; see the PR for issue #16.
//
// Every scan asserts two numbers -- what it found and what it did not -- because
// a scan that silently matches nothing reports the same "0 problems" as a clean
// tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path)=> readFileSync(new URL(path, root), 'utf8');

const NOTESTAB = 'js/interface/dropdown/tabs/notestab.js';
const SAVENET = 'js/interface/dropdown/savenet.js';

// The four globals the Pane registry used to be.
const RETIRED = ['codeMirrorInstances', 'zettelkastenParsers', 'zettelkastenUIs', 'zettelkastenProcessors'];

function jsFiles(){
    return readdirSync(new URL('js/', root), {recursive: true})
        .filter( (name)=> String(name).endsWith('.js') )
        .map( (name)=> 'js/' + String(name) );
}

test('the Pane registry is one list, not four parallel arrays', ()=>{
    const files = jsFiles();
    assert.ok(files.length > 50, `only found ${files.length} js files -- this scan is not reaching the tree`);

    // Number one: the replacement is really there, so a zero below means clean
    // rather than unparsed.
    const usingList = files.filter( (path)=> read(path).includes('zetPaneList') );
    assert.ok(usingList.length >= 4,
        `only ${usingList.length} files mention zetPaneList; the registry is read from more than that`);

    // Number two: none of the four it replaced survives.
    const survivors = [];
    for (const path of files) {
        const src = read(path);
        for (const name of RETIRED) {
            if (src.includes(name)) survivors.push(`${path}: ${name}`);
        }
    }
    assert.deepEqual(survivors, [],
        'A Pane split across parallel arrays can be half-removed. That is the bug: '
      + 'removal filtered the editor array and left the parser, UI and processor '
      + 'registered, so a deleted Pane was still parsed on every save.'
    );
});

test('a Pane is added and retired in one act', ()=>{
    const src = read(NOTESTAB);

    // One push and one splice. Four pushes and one filter is how the halves drifted.
    const pushes = src.match(/zetPaneList\.push\(/g) || [];
    const splices = src.match(/zetPaneList\.splice\(/g) || [];
    assert.equal(pushes.length, 1, 'a Pane should join the registry in exactly one place');
    assert.equal(splices.length, 1, 'a Pane should leave the registry in exactly one place');

    // Reassignment is how the old code dropped a single field: it rebuilt one array
    // with `filter` and left the others alone. Mutating one list cannot do that.
    const reassignments = (src.match(/window\.zetPaneList\s*=/g) || []).length;
    assert.equal(reassignments, 1,
        'the only assignment to window.zetPaneList should be its declaration; '
      + 'rebuilding it with filter is what let one field be pruned without the rest');

    // Everything a Pane is made of goes in together, so the splice takes it all out.
    const pushed = src.slice(src.indexOf('zetPaneList.push('));
    const literal = pushed.slice(pushed.indexOf('{'), pushed.indexOf('}') + 1);
    for (const field of ['paneId', 'cm', 'parser', 'ui', 'processor']) {
        assert.ok(literal.includes(field), `a Pane entry should carry ${field}: ${literal}`);
    }
});

test('the save path names a Pane by its id, not by its position', ()=>{
    const src = read(SAVENET);

    // `'zet-pane-' + (index + 1)` names the right Pane only until one is deleted.
    // The id counter never reuses a number, so after a deletion the sequence has a
    // gap: the lookup misses, and every Pane after the deleted one was saved with
    // an empty name.
    assert.ok(src.includes('getPaneName(pane.paneId)'),
        'the save path should ask the Pane for its own id');
    assert.equal(src.match(/getPaneName\(\s*'zet-pane-'/g), null,
        'rebuilding a pane id from a loop index loses the name of every Pane after a deleted one');
});
