// A save is only a save if it loads back. The bundle format is written in one
// class and read in another, with byte offsets carried between them in a JSON
// header, so nothing in either class alone can tell you the two still agree --
// and a mismatch is silent: the graph appears with its images blank.
//
// So this drives the real pair. Content goes in through `GraphsKeeper` the way
// autosave puts it there, out through `GraphExporter` the way both the disk
// mirror and the Save to… download build a file, and back in through
// `GraphImporter` the way Open… and a dropped file read one.
//
// savenet.js exports nothing, so this follows the node:vm route CLAUDE.md
// describes, as test/savenet-disk-mirror.test.js does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const PATH = 'js/interface/dropdown/savenet.js';
const src = readFileSync(new URL(PATH, root), 'utf8');

// Keyed the way `Stored` keys its localforage tables, and shared across every
// instance in a run, so what the keeper writes the exporter can read.
function makeStoredClass(tables){
    return class Stored {
        constructor(surname, name){
            this.key = (name ? surname + '/' + name : surname);
            tables[this.key] ??= new Map();
            this.table = { iterate: ()=> Promise.resolve() };
        }
        load(key){ return Promise.resolve(tables[this.key].get(String(key)) ?? null) }
        save(key, val){
            tables[this.key].set(String(key), val);
            return Promise.resolve(val);
        }
        delete(key){
            tables[this.key].delete(String(key));
            return Promise.resolve();
        }
    };
}

function load({matchMedia} = {}){
    const tables = {};
    const clicked = [];
    const deferred = [];
    const revoked = [];
    const sandbox = createContext({
        Blob,
        crypto,
        View: {},
        window: {}, // no showSaveFilePicker: the browsers this had nothing for
        Stored: makeStoredClass(tables),
        Logger: { info(){}, debug(){}, warn(){}, err(){} },
        Html: { new: { a: ()=>({ click(){ clicked.push(this) } }) } },
        URL: { createObjectURL: (blob)=>'blob:' + blob.size,
               revokeObjectURL: (url)=>revoked.push(url) },
        // Captured rather than run: the point to pin is that the revoke is
        // deferred at all, and a real timer here would hold the test runner open
        // for as long as the delay.
        setTimeout: (cb, msecs)=>deferred.push([cb, msecs]),
        ...(matchMedia ? {matchMedia} : {})
    });
    const names = ['DiskMirror', 'GraphsKeeper', 'GraphExporter', 'GraphImporter'];
    runInContext(src + '\n;globalThis.exported = {' + names.join(', ') + '};',
        sandbox, { filename: PATH });

    return { ...sandbox.exported, View: sandbox.View, clicked, deferred, revoked, tables };
}

const metaFor = (title)=>({
    graphId: '1.graph', title, revisions: 0, size: 0,
    added: 'then', lastUpdated: 'then'
});
const nodeHtml = (blobId)=>
    `<div data-node_json="{&quot;blob&quot;:&quot;${blobId}&quot;}"></div>`;

test('a graph with no assets survives export and import', async ()=>{
    const { GraphsKeeper, GraphExporter, GraphImporter } = load();
    const keeper = new GraphsKeeper();
    const meta = metaFor("Graph 1");
    const data = '<div>a node</div>';

    await keeper.saveMetaAndData(meta, data);
    const file = await (new GraphExporter(meta, keeper)).export();

    const importer = new GraphImporter();
    await importer.import(file);

    assert.equal(importer.data, data);
    assert.equal(importer.finalData, data, 'and needs no blob rewriting');
});

test('assets come back byte-for-byte, at the offsets the header claims', async ()=>{
    // Two blobs of unequal size: the second is the only real test of the offset
    // arithmetic, since the first is always at zero. CJK in both the markup and a
    // payload proves byte counts are used where byte counts are meant -- a string
    // length would put the second blob 8 bytes early.
    const { GraphsKeeper, GraphExporter, GraphImporter } = load();
    const keeper = new GraphsKeeper();
    const meta = metaFor("Graph 1");

    const blobs = {
        '1.blob': new Blob(['PNG-ish bytes'], {type: 'image/png'}),
        '2.blob': new Blob(['分形笔记 payload'], {type: 'video/mp4'})
    };
    const dictMeta = {};
    for (const blobId in blobs) {
        dictMeta[blobId] = {size: blobs[blobId].size, type: blobs[blobId].type,
                            title: blobId};
        await keeper.saveBlobData(blobId, blobs[blobId]);
    }
    await keeper.saveBlobMeta(meta.graphId, dictMeta);

    const data = nodeHtml('1.blob') + '<p>标题</p>' + nodeHtml('2.blob');
    await keeper.saveMetaAndData(meta, data);

    const file = await (new GraphExporter(meta, keeper)).export();
    const importer = new GraphImporter();
    await importer.import(file);
    assert.equal(importer.data, data, 'the markup survives the NUL scan');

    const handed = [];
    importer.saveNodeItsBlob = (node)=>handed.push(node.blob);

    for (const blobId in blobs) {
        const got = importer.blobForNode({blob: blobId});
        assert.equal(got.type, dictMeta[blobId].type, blobId + ' keeps its type');
        assert.equal(await got.text(), await blobs[blobId].text(),
            blobId + ' comes back byte-for-byte');
    }
    assert.deepEqual(handed, ['1.blob', '2.blob'], 'each node is handed its blob');
});

test('negative control: a header offset one byte out must fail this harness', async ()=>{
    // Proof the assertion above can fail. Everything else here reads offsets that
    // the exporter itself wrote, so a harness that could not see a wrong one
    // would pass whatever the exporter did.
    const { GraphImporter } = load();
    const header = {
        data: '',
        blobMeta: {'1.blob': {size: 4, type: 'image/png'},
                   '2.blob': {size: 4, type: 'image/png'}},
        offsets: {'1.blob': 0, '2.blob': 5} // 4 is correct
    };
    const file = new Blob([JSON.stringify(header), '\x00', 'AAAA', 'BBBB']);

    const importer = new GraphImporter();
    await importer.import(file);
    importer.saveNodeItsBlob = ()=>{};

    assert.notEqual(await importer.blobForNode({blob: '2.blob'}).text(), 'BBBB');
});

test('with no file picker, saving downloads the bundle instead', async ()=>{
    // The case that used to hide the button: Safari, Firefox, everything on iOS,
    // and any page not on a secure origin. The store there is the only copy of a
    // graph and it is evictable, so this route has to exist.
    const { DiskMirror, GraphsKeeper, GraphExporter,
            clicked, deferred, revoked } = load();
    assert.equal(DiskMirror.isSupported, false, 'no picker in this sandbox');

    const keeper = new GraphsKeeper();
    const meta = metaFor("Graph 1");
    await keeper.saveMetaAndData(meta, '<div>a node</div>');
    assert.equal(keeper.disk.isActive, false, 'and nothing is mirrored');

    const file = await (new GraphExporter(meta, keeper)).export();
    assert.equal(DiskMirror.download('Graph 1.neurite', file), 'Graph 1.neurite');

    assert.equal(clicked.length, 1, 'one anchor, clicked once');
    assert.equal(clicked[0].download, 'Graph 1.neurite');
    assert.equal(clicked[0].href, 'blob:' + file.size);

    // Safari reads the object URL after the click returns, so revoking in the
    // same task cancels the download it was meant to serve.
    assert.equal(revoked.length, 0, 'the URL outlives the click');
    assert.equal(deferred.length, 1, 'and is revoked on a timer instead');
    assert.ok(deferred[0][1] > 0, 'a real delay, not a zero-timeout');
    deferred[0][0]();
    assert.deepEqual(revoked, ['blob:' + file.size], 'which frees the blob');
});

test('the helpers this file calls by bare name exist', ()=>{
    // `displayErrorMessage(...)` sat in the load-failure handler and was defined
    // nowhere in the app, so the handler threw a ReferenceError instead of
    // reporting the failure it caught. An error path is the one place a name like
    // that never surfaces on its own: it runs only when something else has already
    // gone wrong, and it swallows that something along with itself.
    const called = new Set(
        [...src.matchAll(/(?:^|[^.\w$])([a-z][A-Za-z\d]*)\(/g)].map( (match)=> match[1] )
    );
    const app = readdirSync(new URL('js/', root), {recursive: true})
        .filter( (name)=> name.endsWith('.js') )
        .map( (name)=> readFileSync(new URL('js/' + name, root), 'utf8') )
        .join('\n');

    // Anything the file declares for itself, plus the language and the browser.
    const isLocal = (name)=> new RegExp(
        `(?:function|const|let|var|class)\\s+${name}\\b|\\b${name}\\s*[:=]|\\b${name}\\s*\\(.*\\)\\s*{`
    ).test(src);
    // A parameter is as much a local binding as a `const` is, and reading only declarations
    // missed them: `new Promise( (decided)=>{ ... decided() ... } )` reported `decided` as a
    // name defined nowhere in the app. The check above cannot be widened to cover this
    // without matching every call site, so it is asked separately.
    const isParam = (name)=> new RegExp(
        `\\((?:[^()]*,)?\\s*${name}\\s*(?:,[^()]*)?\\)\\s*(?:=>|\\{)`
    ).test(src);
    // Names the page supplies and node does not. Listed rather than assumed, so
    // adding one is a decision someone makes on purpose.
    const PAGE_GLOBALS = new Set(['alert']);
    const isGlobal = (name)=> name in globalThis || PAGE_GLOBALS.has(name);
    const missing = [...called].filter( (name)=>
        !isLocal(name) && !isParam(name) && !isGlobal(name)
        && !new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b|\\b${name}\\s*[:=]\\s*(?:function|\\()`).test(app)
    );
    assert.deepEqual(missing, []);
});

test('the download name keeps titles in any script and drops path characters', ()=>{
    // `#fileNameForName` is private and its class reads the DOM as it is built, so the
    // whole method body is lifted out of the source and run. It is worth pinning twice
    // over now: the ASCII-only `\w` that suggests itself here turns a Chinese title into
    // underscores, and with no list of graphs in the interface the file name is the only
    // thing that tells two graphs apart. It also sanitises what a reader types into the
    // save prompt, which can hold a slash exactly as a title could.
    const body = src.match(/#fileNameForName\(name\)\{([\s\S]*?)\n {4}\}/)?.[1];
    assert.ok(body, '#fileNameForName was not found in ' + PATH);
    const nameFor = new Function('name', body);

    assert.equal(nameFor('Graph 1'), 'Graph 1.neurite');
    assert.equal(nameFor('分形笔记'), '分形笔记.neurite', 'CJK survives');
    assert.equal(nameFor('a/b:c\\d'), 'a_b_c_d.neurite', 'path characters do not');
    // Typing the extension in the prompt must not double it.
    assert.equal(nameFor('Field notes.neurite'), 'Field notes.neurite',
        'a name that already ends in .neurite gains a second one');
    assert.equal(nameFor('  '), '', 'a blank name answers nothing');
    assert.equal(nameFor(''), '');
    // ...and the caller is what turns that nothing into a file name.
    assert.match(src, /return this\.#fileNameForName\(meta\.title\) \|\| 'Graph\.neurite'/,
        'a graph with a blank title no longer falls back to a name');
});

// The file's version and its `meta` block (#61), which is how a file opened on another device
// knows which Graph it is a copy of and how far along (#60).
test('a file says its format version and which Graph it is a copy of', async ()=>{
    const { GraphsKeeper, GraphExporter, GraphImporter } = load();
    const keeper = new GraphsKeeper();
    const meta = metaFor("Graph 1");
    await keeper.saveMetaAndData(meta, '<div>a node</div>');
    assert.match(meta.uuid, /^[0-9a-f]{32}$/, 'a Graph saved without a lineage id is not given one');
    assert.equal(typeof meta.updatedAt, 'number', 'nothing orders two saves of the Graph');

    const importer = new GraphImporter();
    await importer.import(await (new GraphExporter(meta, keeper)).export());
    assert.equal(importer.version, 1);
    assert.equal(JSON.stringify(importer.meta),
        JSON.stringify({uuid: meta.uuid, revisions: 1, updatedAt: meta.updatedAt, device: 'another device'}),
        'the meta block is not what the Graph on screen says');
    assert.equal(importer.data, '<div>a node</div>');
});

test('a file with no version is version 0, and still opens', async ()=>{
    const { GraphImporter } = load();
    const header = JSON.stringify({data: '<div>older</div>', blobMeta: null, offsets: {}});
    const importer = new GraphImporter();
    await importer.import(new Blob([header, '\x00']));
    assert.equal(importer.version, 0);
    assert.equal(importer.meta, null);
    assert.equal(importer.data, '<div>older</div>');
});

test('an old text save, with no header, is left for the text path instead of throwing', async ()=>{
    // The NUL scan stepped past the end of a file that had none and threw a RangeError, so
    // Open… on an old save did nothing at all.
    const { GraphImporter } = load();
    for (const text of ['<div data-node_json="{}">a note</div>', '42', '']) {
        const importer = new GraphImporter();
        await importer.import(new Blob([text]));
        assert.equal(importer.data, '', JSON.stringify(text) + ' was taken for a bundle');
    }
});

test('a file from a newer version is refused, and an older copy of the open Graph is asked about', ()=>{
    // `#afterImport` needs the page to run, so its two checks are read from the source.
    const after = src.match(/async #afterImport\(importer, file\)\{[\s\S]*?\n {4}\}/)?.[0];
    assert.ok(after, '#afterImport is gone or no longer an async method at that indent');
    assert.match(after, /importer\.version > GraphExporter\.version/, 'a newer format is opened in part');
    assert.match(after, /#confirmIfOlderThanOpen\(importer\.meta\)/, 'an older copy opens without a word');
    const older = src.match(/#confirmIfOlderThanOpen\(theirs\)\{[\s\S]*?\n {4}\}/)?.[0];
    assert.ok(older, '#confirmIfOlderThanOpen is gone');
    assert.match(older, /theirs\.uuid === open\?\.uuid/, 'the check no longer asks whether it is the same Graph');
    assert.match(older, /\(theirs\.updatedAt \?\? 0\) < \(open\.updatedAt \?\? 0\)/);
});

test('the Save row says a file\'s age in words', ()=>{
    const { View } = load();
    const now = 1_000_000_000_000;
    assert.equal(View.Graphs.ago(now - 10_000, now), 'just now');
    assert.equal(View.Graphs.ago(now - 5 * 60_000, now), '5 min ago');
    assert.equal(View.Graphs.ago(now - 3 * 3_600_000, now), '3 h ago');
    assert.match(View.Graphs.ago(now - 3 * 86_400_000, now), /^on /);
});

test('installed means not a browser tab, and nothing is assumed without the question', ()=>{
    const asked = (matches)=> load({matchMedia: (q)=>({matches: (q === '(display-mode: browser)' ? matches : false)})});
    assert.equal(asked(false).View.Graphs.isInstalled, true, 'an app window is not taken for installed');
    assert.equal(asked(true).View.Graphs.isInstalled, false, 'a browser tab is taken for installed');
    assert.equal(load().View.Graphs.isInstalled, false, 'no matchMedia at all reads as installed');
});
