// The DirectAccess server takes a path out of a query string and hands it to `fs`.
// Before confinement, `/read-file?path=/etc/passwd` was a valid request from any
// page that could reach the gateway. What is being pinned here is not "`..` is
// rejected" -- it is the three ways a confinement check is normally wrong:
//
//   - a string-prefix test, which lets `<root>-evil` through as if it were inside
//     `<root>`;
//   - a lexical test, which lets a symlink inside the root walk out of it;
//   - a POSIX-only separator rule, which reads `..\..` as one filename on Linux
//     (correct) and as traversal on Windows (also correct) -- so a guard built on
//     the wrong separator is a hole on the other platform.
//
// The server is CommonJS under localhost_servers/ and the test suite is ESM, so it
// comes in through `createRequire`. `file-access.js` deliberately does not import
// express -- nothing installs it for this repo's `npm test` -- so the handlers are
// driven directly with a recording response.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const { createPathGuard, createFileAccess, resolveRoot } =
    require('../localhost_servers/direct-access/file-access.js');

// One tree for the whole file: a root with a file and a subdirectory, an escaping
// symlink inside it, a well-behaved symlink inside it, and two things next door
// that must stay unreachable -- including a sibling whose name starts with the
// root's name.
function makeTree(){
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'neurite-da-')));
    const root = path.join(base, 'root');
    mkdirSync(path.join(root, 'inner'), {recursive: true});
    writeFileSync(path.join(root, 'inner', 'note.txt'), 'in-root text');
    writeFileSync(path.join(root, 'binary.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const outside = path.join(base, 'outside');
    mkdirSync(outside, {recursive: true});
    writeFileSync(path.join(outside, 'secret.txt'), 'not yours');

    // Sibling directory whose path is a string prefix of nothing, but whose name
    // makes the root's path a string prefix of it.
    const sibling = path.join(base, 'root-evil');
    mkdirSync(sibling, {recursive: true});
    writeFileSync(path.join(sibling, 'secret.txt'), 'also not yours');

    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
    symlinkSync(outside, path.join(root, 'escape-dir'));
    symlinkSync(path.join(root, 'inner'), path.join(root, 'inner-link'));
    // Points at nothing yet. Its target could be created outside the root a moment
    // after any check that let it through.
    symlinkSync(path.join(outside, 'later.txt'), path.join(root, 'dangling.txt'));

    return {base, root, outside, sibling, cleanup(){ rmSync(base, {recursive: true, force: true}) }};
}

const tree = makeTree();
test.after(tree.cleanup);

const guard = createPathGuard({root: tree.root});

const allowed = (requestPath)=>{
    const result = guard.resolve(requestPath);
    assert.equal(result.ok, true, `expected ${JSON.stringify(requestPath)} to be allowed: ${result.reason}`);
    return result.path;
};
const refused = (requestPath, code = 'denied')=>{
    const result = guard.resolve(requestPath);
    assert.equal(result.ok, false, `expected ${JSON.stringify(requestPath)} to be refused`);
    assert.equal(result.code, code, `${JSON.stringify(requestPath)}: ${result.reason}`);
    return result;
};

test('the root is what an empty request resolves to', ()=>{
    assert.equal(guard.root, tree.root);
    for (const empty of [undefined, null, '', '/', '.']) {
        assert.equal(allowed(empty), tree.root);
    }
});

test('a path is read as a location under the root, absolute or not', ()=>{
    // The file tree builds every path by descending from '/', so both spellings
    // have to name the same file, and neither may reach the real filesystem root.
    const note = path.join(tree.root, 'inner', 'note.txt');
    assert.equal(allowed('/inner/note.txt'), note);
    assert.equal(allowed('inner/note.txt'), note);
    assert.equal(allowed('./inner/../inner/note.txt'), note);
    assert.equal(allowed('//inner///note.txt'), note);
    assert.equal(allowed('/inner/.'), path.join(tree.root, 'inner'));
});

test('parent traversal is refused however it is spelled', ()=>{
    // Express percent-decodes the query before the handler sees it, so `%2e%2e%2f`
    // arrives as `../` and is the same case as the plain spelling. `%252e` decodes
    // to the literal text `%2e`, which is a filename, not a traversal -- so it is
    // allowed, and lands under the root.
    for (const attempt of ['..', '../', '/..', '../outside/secret.txt',
                           '/../outside/secret.txt', 'inner/../../outside/secret.txt',
                           '/inner/../../root-evil/secret.txt',
                           '../../../../../../etc/passwd']) {
        refused(attempt);
    }
    assert.equal(allowed('%2e%2e/x'), path.join(tree.root, '%2e%2e', 'x'));
});

test('a sibling directory that shares the root\'s name prefix is outside it', ()=>{
    // `resolved.startsWith(root)` is true for both of these and both are outside.
    refused('/../root-evil');
    refused('/../root-evil/secret.txt');
    // And the reverse: the check is not so strict that the root itself fails.
    assert.equal(allowed('/'), tree.root);
});

test('a symlink is judged by where it points, not by where it sits', ()=>{
    // Lexically both of these are inside the root. Neither is.
    refused('/escape.txt');
    refused('/escape-dir');
    refused('/escape-dir/secret.txt');
    // The in-root symlink still resolves, to its target's canonical path.
    assert.equal(allowed('/inner-link'), path.join(tree.root, 'inner'));
    assert.equal(allowed('/inner-link/note.txt'), path.join(tree.root, 'inner', 'note.txt'));
});

test('a `..` after a symlink collapses inside the root, not through it', ()=>{
    // `path.resolve` folds `..` away before any symlink is read, so this does not
    // mean to the guard what it would mean to the kernel: opening
    // `<root>/escape-dir/../secret.txt` there would land on `<outside>/../secret.txt`.
    // The guard's answer is the folded path, and the folded path is also the one
    // that gets opened -- so the divergence can only name a different in-root file,
    // never a read outside the root.
    assert.equal(allowed('/escape-dir/../secret.txt'), path.join(tree.root, 'secret.txt'));
    assert.equal(allowed('/escape.txt/../binary.png'), path.join(tree.root, 'binary.png'));
    // And it cannot be used to climb: the fold happens first, then the count.
    refused('/escape-dir/../../outside/secret.txt');
});

test('a path that does not exist is still placed by its deepest real ancestor', ()=>{
    // The missing tail cannot be a symlink, so it can be re-attached: a request for
    // something not there yet is refused for being missing (404 later), not for
    // being outside. The same walk-up is what stops a missing segment from being
    // treated as unresolvable and quietly allowed.
    assert.equal(allowed('/inner/absent.txt'), path.join(tree.root, 'inner', 'absent.txt'));
    assert.equal(allowed('/absent-dir/absent.txt'), path.join(tree.root, 'absent-dir', 'absent.txt'));
    refused('/absent-dir/../../outside/absent.txt');
});

test('a dangling symlink is not treated as a missing name', ()=>{
    // The walk-up above is what makes this case dangerous: `dangling.txt` has no
    // real path, so re-attaching it as a missing name would place it inside the
    // root, while `stat` and `open` would follow it out of the root the moment its
    // target exists. It has to be unresolvable, not missing.
    const result = refused('/dangling.txt');
    assert.match(result.reason, /dangling|ENOENT_LINK/);
    refused('/dangling.txt/deeper.txt');
    // Which is not the same as a name that really is missing.
    assert.equal(allowed('/absent.txt'), path.join(tree.root, 'absent.txt'));
});

test('a NUL byte is refused as malformed rather than reaching fs', ()=>{
    refused('/inner/note.txt\0.png', 'invalid');
    refused({}, 'invalid');
});

test('a root that cannot be resolved is a startup error, not a wider root', ()=>{
    assert.throws(()=> createPathGuard({root: path.join(tree.base, 'no-such-root')}),
        /not a readable directory/);
    assert.throws(()=> createPathGuard({root: ''}), /needs a root directory/);
    // A file as the root would otherwise refuse every request for a reason that
    // names the request rather than the configuration.
    assert.throws(()=> createPathGuard({root: path.join(tree.root, 'binary.png')}),
        /not a directory/);
    assert.equal(resolveRoot({DIRECTACCESS_ROOT: '  /tmp/x  '}), '/tmp/x');
    assert.notEqual(resolveRoot({}), undefined, 'no root at all would make the guard unbuildable');
});

// Separator rules are per-platform and only one of them is the live one, so both
// are checked against an injected `path` implementation. `realpath` is stubbed to
// the identity: these cases are about which characters divide segments.
test('separator handling follows the platform, on both platforms', ()=>{
    const win = createPathGuard({root: 'C:\\Neurite\\root', path: path.win32, realpath: (p)=> p});
    assert.equal(win.root, 'C:\\Neurite\\root');
    assert.equal(win.resolve('/inner/note.txt').path, 'C:\\Neurite\\root\\inner\\note.txt');
    assert.equal(win.resolve('inner\\note.txt').path, 'C:\\Neurite\\root\\inner\\note.txt');
    // On Windows a backslash divides segments, so this is traversal...
    assert.equal(win.resolve('..\\..\\Windows\\win.ini').ok, false);
    assert.equal(win.resolve('inner\\..\\..\\secret.txt').ok, false);
    // ...as is a drive letter, which must not be allowed to name its own root.
    assert.equal(win.resolve('C:\\Windows\\win.ini').path, 'C:\\Neurite\\root\\Windows\\win.ini');
    assert.equal(win.resolve('D:\\secret.txt').path, 'C:\\Neurite\\root\\secret.txt');
    // Windows compares paths case-insensitively; the guard must not refuse on case.
    assert.equal(createPathGuard({root: 'C:\\Neurite\\Root', path: path.win32, realpath: (p)=> p})
        .resolve('/inner').ok, true);

    const posix = createPathGuard({root: '/srv/root', path: path.posix, realpath: (p)=> p});
    // ...while on POSIX a backslash is a legal filename character, so the same
    // string is one strange filename inside the root, not an escape.
    assert.equal(posix.resolve('..\\..\\etc\\passwd').path, '/srv/root/..\\..\\etc\\passwd');
    assert.equal(posix.resolve('../../etc/passwd').ok, false);
    assert.equal(posix.resolve('/root-evil').path, '/srv/root/root-evil');
});

test('an unresolvable path fails closed', ()=>{
    // If `realpath` cannot say where a path points -- EACCES on an ancestor, a
    // symlink loop -- there is no proof it is inside the root, so it is refused
    // rather than read.
    const loop = createPathGuard({
        root: '/srv/root',
        path: path.posix,
        realpath: (p)=>{
            if (p === '/srv/root') return p;
            const err = new Error('ELOOP'); err.code = 'ELOOP'; throw err;
        }
    });
    const result = loop.resolve('/inner');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'denied');
    assert.match(result.reason, /ELOOP/);
});

// A response that records what the handler did. It is a real Writable so
// `readStream.pipe(res)` works.
function recordingResponse(){
    const chunks = [];
    const res = new Writable({
        write(chunk, _enc, cb){ chunks.push(chunk); cb() }
    });
    res.statusCode = 200;
    res.headers = {};
    res.headersSent = false;
    res.body = undefined;
    res.status = (code)=>{ res.statusCode = code; return res };
    res.json = (payload)=>{ res.body = payload; res.headersSent = true; return res };
    res.setHeader = (key, value)=>{ res.headers[key.toLowerCase()] = value };
    res.text = ()=> chunks.map(String).join('');
    res.finished = new Promise((resolve)=> res.on('finish', resolve));
    return res;
}

const access = createFileAccess({root: tree.root, log(){}});

test('an in-root file still reads, with its mime type', async ()=>{
    const res = recordingResponse();
    await access.readFile({query: {path: '/inner/note.txt'}}, res);
    await res.finished;
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/plain');
    assert.equal(res.text(), 'in-root text');

    const binary = recordingResponse();
    await access.readFile({query: {path: '/binary.png'}}, binary);
    await binary.finished;
    assert.equal(binary.headers['content-type'], 'image/png');
    assert.equal(binary.text().length, 4);
});

test('an in-root directory still lists, and the root lists without a path', async ()=>{
    const res = recordingResponse();
    await access.navigate({query: {path: '/inner'}}, res);
    assert.deepEqual(res.body, [{name: 'note.txt', type: 'file'}]);

    const rootRes = recordingResponse();
    await access.navigate({query: {}}, rootRes);
    const names = rootRes.body.map( (item)=> item.name ).sort();
    assert.deepEqual(names,
        ['binary.png', 'dangling.txt', 'escape-dir', 'escape.txt', 'inner', 'inner-link']);
});

test('a refused request says nothing about the filesystem', async ()=>{
    const attempts = ['/../outside/secret.txt', '/escape.txt', '/escape-dir',
                      '/dangling.txt', '/../root-evil/secret.txt'];
    for (const attempt of attempts) {
        for (const handler of [access.navigate, access.readFile]) {
            const res = recordingResponse();
            await handler({query: {path: attempt}}, res);
            assert.equal(res.statusCode, 403, attempt);
            assert.deepEqual(res.body, {error: 'Access denied'}, attempt);
        }
    }

    // A missing in-root path is a different answer, and just as quiet: no absolute
    // path, no errno, no `err.message` from fs.
    const missing = recordingResponse();
    await access.readFile({query: {path: '/inner/absent.txt'}}, missing);
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.body, {error: 'File not found or is not a file'});

    const missingDir = recordingResponse();
    await access.navigate({query: {path: '/absent-dir'}}, missingDir);
    assert.equal(missingDir.statusCode, 400);
    assert.deepEqual(missingDir.body, {error: 'Invalid directory path'});

    // Nothing in any refusal names a real path or an errno.
    const said = JSON.stringify([missing.body, missingDir.body]);
    assert.doesNotMatch(said, /ENOENT|EACCES/);
    assert.ok(!said.includes(tree.base), 'the response leaks a filesystem path');
});

test('a directory asked for as a file, and a file asked for as a directory', async ()=>{
    const asFile = recordingResponse();
    await access.readFile({query: {path: '/inner'}}, asFile);
    assert.equal(asFile.statusCode, 404);

    const asDir = recordingResponse();
    await access.navigate({query: {path: '/inner/note.txt'}}, asDir);
    assert.equal(asDir.statusCode, 400);
    assert.deepEqual(asDir.body, {error: 'Invalid directory path'});
});

test('read-file with no path still asks for one', async ()=>{
    const res = recordingResponse();
    await access.readFile({query: {}}, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {error: 'File path is required'});
});

test('the express file wires both endpoints to the confined handlers', ()=>{
    // The guard is only a guard if every route goes through it. Read as text: the
    // server file cannot be imported here without express installed.
    const src = require('node:fs').readFileSync(
        new URL('../localhost_servers/direct-access/direct-access.js', import.meta.url), 'utf8');
    const routes = [...src.matchAll(/app\.get\('([^']+)',\s*fileAccess\.(\w+)\)/g)]
        .map( (m)=> m[1] + ' -> ' + m[2] );
    assert.deepEqual(routes, ['/navigate -> navigate', '/read-file -> readFile']);
    assert.doesNotMatch(src, /path\.resolve\(/,
        'the server resolves a path of its own again, outside the guard');
    assert.equal([...src.matchAll(/app\.get\(/g)].length, routes.length,
        'a route was added that the guard does not cover');
});
