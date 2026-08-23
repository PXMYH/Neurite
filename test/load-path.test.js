// `PageLoad.scripts` is the whole dependency graph of this app, written by hand, and a
// file that is not in it simply never runs. ADR-0001 keeps it that way on purpose, and
// ADR-0002 adds a second way for it to go wrong: a file under `js/` may now be
// TypeScript, and its entry in the array keeps the `.js` spelling. So a conversion has
// two new ways to break the load path silently --
//
//   - rename the file and rewrite the entry to `.ts`. Vite's dev server serves it (it
//     resolves either spelling), `npm test` is green, and the `dist/` copy 404s,
//     because `postbuild` sweeps `dist/js/**/*.ts` out after tsc emits the `.js`.
//   - rename the file and forget the entry exists. Nothing complains anywhere: the
//     array still names `x.js`, no `x.js` is on disk, and the dev server answers from
//     `x.ts` anyway. It breaks only in `dist/`, and only if the sweep order changes.
//
// Neither is a type error and neither is reachable from a unit test of behaviour, so
// this reads the array as text and compares it with the disk. It cannot catch a wrong
// *order* -- nothing can, which is ADR-0001's point -- but it catches every way the
// array and the tree can disagree about *which* files exist.
//
// Every scan asserts what it found before it asserts what it did not, because a regexp
// that stops matching reports the same "0 problems" as a clean tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path)=> readFileSync(new URL(path, root), 'utf8');
const onDisk = (path)=> existsSync(new URL(path, root));

// `js/main.js` is the one file not in the array: `index.html` loads it directly, and it
// is the file that owns the array.
const ENTRY_POINT = 'js/main.js';

// Low-water marks. They are not the current count -- a test that has to be edited every
// time a file is added is a test that gets edited without being read. They are high
// enough that a broken parse or a broken walk fails instead of quietly matching nothing.
const LEAST_ENTRIES = 70;
const LEAST_FILES = 70;

function scriptEntries(){
    const src = read(ENTRY_POINT);
    const start = src.indexOf('static scripts = [');
    assert.notEqual(start, -1, `no 'static scripts = [' in ${ENTRY_POINT}; this scan is not reaching the array`);

    const block = src.slice(start);
    const arr = block.slice(0, block.indexOf('];') + 1);
    // The `:MODULE` suffix is load-time metadata, not part of the path (`js/main.js`
    // strips it in `loadScript`), so it comes off before anything is compared.
    return [...arr.matchAll(/'([^']+)'/g)].map( (m)=> ({
        entry: m[1],
        path: m[1].replace(/:MODULE$/, '')
    }));
}

function filesUnderJs(){
    return readdirSync(new URL('js/', root), {recursive: true})
        .map(String)
        // A `.d.ts` declares types and emits nothing, so it is not a load-path file and
        // must never appear in the array. Excluded here and asserted separately below.
        .filter( (name)=> (name.endsWith('.js') || name.endsWith('.ts')) && !name.endsWith('.d.ts') )
        .map( (name)=> 'js/' + name );
}

function declarationFiles(){
    return readdirSync(new URL('js/', root), {recursive: true})
        .map(String)
        .filter( (name)=> name.endsWith('.d.ts') )
        .map( (name)=> 'js/' + name );
}

test('every entry in PageLoad.scripts has a file on disk', ()=>{
    const entries = scriptEntries();
    assert.ok(entries.length >= LEAST_ENTRIES,
        `only parsed ${entries.length} entries out of PageLoad.scripts -- the array literal moved or the regexp stopped matching`);

    // An entry keeps its `.js` spelling after a conversion, so either extension counts.
    const orphans = entries
        .filter( ({path})=> !onDisk(path) && !onDisk(path.replace(/\.js$/, '.ts')) )
        .map( ({entry})=> entry );

    assert.deepEqual(orphans, [],
        'These entries name no file, as either .js or .ts. A missing file is not a load '
      + 'error the browser reports usefully: the script tag 404s, `onerror` rejects, and '
      + 'the loader stops -- every file after it in the array never runs.'
    );
});

test('no entry is spelled .ts', ()=>{
    const entries = scriptEntries();
    assert.ok(entries.length >= LEAST_ENTRIES, `only parsed ${entries.length} entries`);

    const wrong = entries.filter( ({path})=> path.endsWith('.ts') ).map( ({entry})=> entry );
    assert.deepEqual(wrong, [],
        'ADR-0002: a converted file keeps its `.js` spelling in the array at the same '
      + 'position -- the extension on disk is an implementation detail of that one file. '
      + 'A `.ts` entry works in the dev server and 404s in `dist/`, because `postbuild` '
      + 'emits `.js` next to it and then sweeps `dist/js/**/*.ts` away.'
    );
});

test('a .d.ts is never in the load path', ()=>{
    // `filesUnderJs` skips `.d.ts` on purpose, and an exclusion with no assertion behind
    // it is an invitation to "fix" the filter. A declaration file emits no JavaScript, so
    // loading it would 404 in `dist/` and serve an empty body in dev.
    const entries = scriptEntries();
    assert.ok(entries.length >= LEAST_ENTRIES, `only parsed ${entries.length} entries`);

    const listed = declarationFiles().filter( (f)=> entries.some( ({path})=> path === f ) );
    assert.deepEqual(listed, [], 'A .d.ts declares types and emits nothing; it must not be loaded as a script.');

    const both = filesUnderJs().filter( (f)=> f.endsWith('.d.ts') );
    assert.deepEqual(both, [], 'filesUnderJs must not report declaration files as load-path files.');
});

test('every file under js/ is loaded exactly once', ()=>{
    const files = filesUnderJs();
    assert.ok(files.length >= LEAST_FILES,
        `only walked ${files.length} files under js/ -- this scan is not reaching the tree`);

    const entries = scriptEntries();
    // Compare on the `.js` spelling, which is what the array always uses.
    const loaded = entries.map( ({path})=> path );
    const asEntry = (file)=> file.replace(/\.ts$/, '.js');

    const unloaded = files.filter( (file)=> file !== ENTRY_POINT && !loaded.includes(asEntry(file)) );
    assert.deepEqual(unloaded, [],
        'A file under js/ that is not in PageLoad.scripts never runs, and nothing reports '
      + 'it: no import fails, no bundler warns, and the symbols it defines are simply '
      + 'absent at the point some other file reaches for them.'
    );

    const seen = new Set();
    const twice = loaded.filter( (path)=> seen.size === seen.add(path).size );
    assert.deepEqual(twice, [],
        'A file listed twice is executed twice. In one shared global scope that re-runs '
      + 'every top-level call in it -- 26 of these files have one -- and rebinds every '
      + 'class other files already captured.'
    );

    // The entry point is deliberately absent from the array, so pin that rather than
    // leaving it as an unexplained exemption above.
    assert.ok(files.includes(ENTRY_POINT), `${ENTRY_POINT} is missing from js/`);
    assert.ok(!loaded.includes(ENTRY_POINT),
        `${ENTRY_POINT} is loaded by index.html and owns the array; listing it in the array loads it twice`);
    assert.ok(read('index.html').includes(ENTRY_POINT),
        `index.html should load ${ENTRY_POINT}; it is the only script it loads`);
});
