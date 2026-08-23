// Rules a `.js` -> `.ts` conversion has to obey in this repo, each one written because a
// violation was *executed* and shown to survive every other check we have.
//
// The thing that makes this repo unusual: `js/x.js` is served by two different tools that
// are not the same compiler. In dev, Vite hands the request to esbuild. For `dist/`,
// `postbuild` runs `tsc -p tsconfig.build.json`. Neither type-checks. Where esbuild and
// tsc disagree about emit, dev and release become two different programs from one commit,
// and every browser-based check we have looks only at dev.
//
// So the cheap sound move is prevention, not detection: forbid the constructs where the
// two are known to disagree. A construct that cannot appear cannot diverge, and that costs
// no build, no server, and no browser.
//
// Every scan asserts what it found before it asserts what it did not, because a regexp
// that stops matching reports the same "0 violations" as a clean tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path)=> readFileSync(new URL(path, root), 'utf8');

function walk(pred){
    return readdirSync(new URL('js/', root), {recursive: true})
        .map(String).filter(pred).map( (name)=> 'js/' + name );
}
const tsFiles = ()=> walk( (n)=> n.endsWith('.ts') && !n.endsWith('.d.ts') );
const allCode = ()=> walk( (n)=> /\.(js|ts)$/.test(n) && !n.endsWith('.d.ts') );

// Comments and string bodies are not code. Scanning them is how a text detector ends up
// firing on a comment that merely says the word `interface`, which is a real thing that
// happened to an earlier version of this gate.
function stripNonCode(src){
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
        .replace(/`(?:\\.|\$\{[^}]*\}|[^\\`])*`/g, '``')
        .replace(/'(?:\\.|[^\\'\n])*'/g, "''")
        .replace(/"(?:\\.|[^\\"\n])*"/g, '""');
}

// Each entry: why dev and release disagree, so the next person can judge an exception.
const DIVERGENT = [
    {
        name: 'enum / const enum',
        // Measured: esbuild emits a real runtime object; tsc inlines the members and emits
        // no binding at all. `typeof NodeKind` is 'object' in dev and 'undefined' in dist,
        // so the release throws ReferenceError and dev is permanently green.
        re: /^[^\S\n]*(?:export[^\S\n]+)?(?:declare[^\S\n]+)?(?:const[^\S\n]+)?enum[^\S\n]+[A-Za-z_$]/m
    },
    {
        name: 'parameter property (private/public/protected/readonly in a constructor)',
        // Measured: at target ES2022 `useDefineForClassFields` is on, so tsc emits a field
        // declaration that [[Define]]s an own property and shadows an inherited accessor;
        // esbuild emits none and the setter runs. Same source, different arithmetic --
        // {val: 5} under tsc against {val: 50} under esbuild. This repo has accessor-backed
        // state (`App.get nodeMode()`, `NodeMode.val`), so the collision is live.
        re: /constructor[^\S\n]*\(([^)]*)\)/,
        test: (src)=> [...src.matchAll(/constructor[^\S\n]*\(([\s\S]*?)\)/g)]
            .some( (m)=> /\b(private|public|protected|readonly)\b/.test(m[1]) )
    },
    {
        name: 'decorator',
        // Emit depends on experimentalDecorators / the TC39 stage, and the two tools do not
        // implement the same one.
        re: /^[^\S\n]*@[A-Za-z_$][\w$]*/m
    },
    {
        name: 'namespace / module block',
        // A namespace is a runtime object under one tool and can be elided under the other.
        // Legitimate in a `.d.ts`, which emits nothing; never in a load-path file.
        re: /^[^\S\n]*(?:export[^\S\n]+)?(?:declare[^\S\n]+)?(?:namespace|module)[^\S\n]+[A-Za-z_$][\w$]*[^\S\n]*\{/m
    }
];

test('no construct where the dev server and the release build disagree', ()=>{
    const files = tsFiles();
    assert.ok(files.length >= 1,
        'found no .ts files under js/ -- this scan is not reaching the tree, so its silence means nothing');

    const violations = [];
    for (const file of files) {
        const src = stripNonCode(read(file));
        for (const rule of DIVERGENT) {
            const hit = rule.test ? rule.test(src) : rule.re.test(src);
            if (hit) violations.push(`${file}: ${rule.name}`);
        }
    }
    assert.deepEqual(violations, [],
        'These constructs emit differently under esbuild (dev) and tsc (dist/), so the '
      + 'served app and the released app stop being the same program. No browser check we '
      + 'have would notice: they all drive the dev server.'
    );
});

test('no definite-assignment assertion on a class field', ()=>{
    const files = tsFiles();
    assert.ok(files.length >= 1, 'found no .ts files under js/');

    // `title!: string` is the reflex fix for TS2564, and it is wrong here. Both tools emit
    // a bare `title;` field, which under [[Define]] semantics resets the property to
    // undefined *after* the base constructor already set it. Measured: the base class's
    // values come back undefined under both toolchains, so even a dev-vs-dist diff is
    // blind to it. `js/nodes/nodeclass.js` seeds ~40 properties this way.
    const violations = [];
    for (const file of files) {
        const src = stripNonCode(read(file));
        // Anchored to line start OR to `{`/`;`/`}`, not to line start alone: a one-line
        // class body (`class N { title!: string }`) is a real thing to write and an
        // earlier version of this pattern missed it, which the fault-proof caught.
        // Known false positive, accepted: a ternary whose `?` branch ends a line, leaving
        // `a! : b` at the start of the next one. It has never occurred here, and it reads
        // clearly enough in the failure message to fix by reformatting.
        const re = /(?:^|[{};])[^\S\n]*(?:(?:readonly|static|public|private|protected|declare|abstract|override|let|var)[^\S\n]+)*([A-Za-z_$][\w$]*)![^\S\n]*:/gm;
        for (const m of src.matchAll(re)) violations.push(`${file}: ${m[1]}!:`);
    }
    assert.deepEqual(violations, [],
        'Declare the field without `!` and let the type include what the base constructor '
      + 'actually assigns, or use `declare` so no field is emitted at all.'
    );
});

test('no .js file sits beside a .ts file of the same name', ()=>{
    const files = allCode();
    assert.ok(files.length >= 70, `only walked ${files.length} files under js/`);

    // Measured: with both present the dev server answers `js/x.js` with the `.js` and
    // silently ignores the `.ts`; then `postbuild` copies `js/` and tsc *overwrites*
    // `dist/js/x.js` from the `.ts`. One commit, two programs, and every gate agrees.
    const set = new Set(files);
    const both = files.filter( (f)=> f.endsWith('.ts') && set.has(f.replace(/\.ts$/, '.js')) );
    assert.deepEqual(both, [],
        'Delete the old .js. While both exist, dev runs one file and the release runs the '
      + 'other, and the developer sees only the one that was not shipped.'
    );
});

// Globals this app reads off `window` but never assigns: the DOM's own members, plus what
// the Electron preload and the Playwright harness inject. Listed so that a name which
// *stops* being assigned cannot hide among them.
const EXTERNALLY_PROVIDED = new Set([
    'addEventListener', 'clipboardData', 'getComputedStyle', 'getSelection',
    'innerHeight', 'innerWidth', 'location', 'open', 'requestAnimationFrame',
    'showOpenFilePicker', 'showSaveFilePicker',
    'electronAPI',              // Electron preload
    'js', 'zettelkastenProcessor'
]);

test('every window global that is read is also assigned somewhere', ()=>{
    const files = allCode();
    assert.ok(files.length >= 70, `only walked ${files.length} files under js/`);

    // The failure this catches: converting a file that opens with `window.Foo = {...}`
    // produces TS2339 ("Property 'Foo' does not exist on type 'Window & typeof
    // globalThis'"), and the cheap fix is `const Foo = {...}`. That silences the checker,
    // keeps the file working, and breaks every *other* file that reads `window.Foo`.
    // A boot probe cannot see it, because a top-level `const` in a classic script is
    // reachable by bare identifier -- and because the readers are usually inside a
    // listener that only fires on an OAuth popup or a drag.
    const written = new Map();
    const readIn = new Map();
    for (const file of files) {
        const src = stripNonCode(read(file));
        for (const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)[^\S\n]*=(?!=)/g)) {
            if (!written.has(m[1])) written.set(m[1], []);
            written.get(m[1]).push(file);
        }
        for (const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)/g)) {
            if (!readIn.has(m[1])) readIn.set(m[1], new Set());
            readIn.get(m[1]).add(file);
        }
    }
    assert.ok(written.size >= 10,
        `only found ${written.size} window assignments -- this scan is not reaching the code`);

    const orphaned = [...readIn.keys()]
        .filter( (name)=> !written.has(name) && !EXTERNALLY_PROVIDED.has(name) )
        .map( (name)=> `window.${name} read in ${[...readIn.get(name)].join(', ')}` );
    assert.deepEqual(orphaned, [],
        'Nothing assigns these. Either a `window.X =` was turned into a `const X =` during '
      + 'a conversion -- in which case put it back on window, or update every reader -- or '
      + 'the name comes from outside this tree and belongs in EXTERNALLY_PROVIDED.'
    );

    // Keep the allowlist honest: a name that is now assigned must come off the list, or the
    // list slowly grows into a place where a real regression can hide.
    const stale = [...EXTERNALLY_PROVIDED].filter( (name)=> written.has(name) ).sort();
    assert.deepEqual(stale, [],
        'These are in EXTERNALLY_PROVIDED but the tree assigns them now. Remove them from '
      + 'the list so the check covers them.'
    );
});
