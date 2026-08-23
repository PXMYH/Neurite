// Fetch every entry in `PageLoad.scripts` and prove the browser could actually parse it.
//
// This is the gate a TypeScript conversion needs and `npm test` cannot give. `js/x.js` is
// served from `x.ts` by Vite's dev server, and emitted from `x.ts` by `tsc` for `dist/` --
// two different tools, neither of which type-checks. If either one fails to strip types,
// the file arrives as TypeScript, the browser throws a SyntaxError, `script.onerror`
// rejects, and `PageLoad.mainLoad` stops. Every file after it in the array never runs, so
// the symptom is a blank canvas somewhere unrelated to the file that broke.
//
// The check is a real parse, not a grep for type syntax. A grep both false-positives on
// ordinary JavaScript (`` `${key}: ${value}` ``) and misses most real TypeScript
// (`satisfies`, `x!`, generic call syntax), so it would be a gate that fails when things
// are fine and passes when they are not. `node --check` is the parser itself: `.cjs` for a
// classic script and `.mjs` for a `:MODULE` entry, which is the same distinction
// `loadScript` makes when it sets `script.type`.
//
//   node scripts/verify-served.mjs                 # against the dev server on :8999
//   node scripts/verify-served.mjs --base http://localhost:8998
//   node scripts/verify-served.mjs --dist          # against the built copy on disk
//
// Note for whoever runs this: the dev server binds `localhost`, which on macOS can resolve
// to `::1` only. `http://127.0.0.1:8999` then fails to connect while `http://localhost:8999`
// answers 200, so the default below is deliberately the name and not the literal address.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const useDist = args.includes('--dist');
const base = (args[args.indexOf('--base') + 1] || 'http://localhost:8999').replace(/\/$/, '');

const root = new URL('../', import.meta.url);
const src = readFileSync(new URL('js/main.js', root), 'utf8');

// Unique per run; see the note in `get` about Vite's transform cache.
const RUN = process.pid + '-' + Date.now();

const start = src.indexOf('static scripts = [');
if (start === -1) fail('no `static scripts = [` in js/main.js -- the array literal moved');
const arr = src.slice(start).slice(0, src.slice(start).indexOf('];') + 1);
const entries = [...arr.matchAll(/'([^']+)'/g)].map( (m)=> ({
    path: m[1].replace(/:MODULE$/, ''),
    isModule: m[1].endsWith(':MODULE')
}));
// Guard the parse before trusting a clean result: a regexp that stops matching would
// otherwise report every file as fine.
if (entries.length < 70) fail(`only parsed ${entries.length} entries out of PageLoad.scripts`);

function fail(msg){ console.error('verify-served: ' + msg); process.exit(1) }

const tmp = mkdtempSync(join(tmpdir(), 'neurite-verify-'));
const problems = [];

async function get(path){
    if (useDist) {
        const file = new URL('dist/' + path, root);
        if (!existsSync(file)) return {status: 404, type: '', body: ''};
        return {status: 200, type: 'text/javascript', body: readFileSync(file, 'utf8')};
    }
    // A unique query per run, because Vite keys its transform cache by module id and will
    // happily serve the *previous* transform of a path whose source has just been renamed.
    // Measured: immediately after `git mv x.ts x.zzz` this script passed, and the identical
    // run a few seconds later failed on the same entry. A gate that passes on cached output
    // is worse than no gate during a migration, which is exactly when every path is being
    // renamed. The query makes Vite resolve from disk every time.
    const res = await fetch(base + '/' + path + '?verify=' + RUN);
    return {
        status: res.status,
        type: res.headers.get('content-type') || '',
        body: await res.text()
    };
}

async function check({path, isModule}, index){
    let res;
    try { res = await get(path) }
    catch (err) { problems.push([path, 'unreachable: ' + err.message]); return }

    if (res.status !== 200) return void problems.push([path, 'HTTP ' + res.status]);
    // A dev server that cannot resolve a path often answers with index.html and a 200,
    // which is how a missing file turns into "Unexpected token '<'" in the browser.
    if (!/javascript|ecmascript/i.test(res.type)) return void problems.push([path, 'content-type ' + res.type]);
    if (res.body.trim().length === 0) return void problems.push([path, 'empty body']);

    // `.cjs` and `.mjs` rather than `.js`, because package.json says `"type": "module"`
    // and a bare `.js` would be parsed as ESM -- which would reject every classic script
    // that says nothing at all, and accept the `import` a classic script must not have.
    const file = join(tmp, index + (isModule ? '.mjs' : '.cjs'));
    writeFileSync(file, res.body);
    try {
        execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'});
    } catch (err) {
        const first = String(err.stderr || '').split('\n').filter(Boolean).slice(0, 4).join(' | ');
        problems.push([path, 'does not parse as ' + (isModule ? 'a module' : 'a script') + ': ' + first]);
    }
}

// Eight at a time: enough to keep this under a couple of seconds, few enough that the dev
// server is not the thing being tested.
const queue = entries.map( (e, i)=> [e, i] );
await Promise.all(Array.from({length: 8}, async ()=>{
    for (let next = queue.shift(); next; next = queue.shift()) await check(...next);
}));

rmSync(tmp, {recursive: true, force: true});

const where = useDist ? 'dist/' : base;
if (problems.length) {
    console.error(`\nverify-served: ${problems.length} of ${entries.length} entries broken at ${where}\n`);
    for (const [path, why] of problems) console.error('  ' + path + '\n      ' + why);
    console.error('');
    process.exit(1);
}
console.log(`verify-served: all ${entries.length} entries parse as JavaScript at ${where}`);
