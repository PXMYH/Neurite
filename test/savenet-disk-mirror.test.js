// Autosave is now the only way a graph is written, and the file on disk is the
// only copy of it the browser cannot evict. So the two failures worth pinning are
// silent ones: a mirror that stops writing, and a stored file handle that is not
// picked back up after a restart. Neither shows an error in the page.
//
// savenet.js exports nothing, so this follows the node:vm route CLAUDE.md
// describes: run the file against stubs for the globals it touches while loading,
// and append a line in the same script scope to reach the top-level classes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const PATH = 'js/interface/dropdown/savenet.js';
const src = readFileSync(new URL('../' + PATH, import.meta.url), 'utf8');

// Every Stored instance in a run shares this, keyed the way `Stored` keys its
// localforage tables, so the graph data written by one handle is readable by the
// next -- which is the whole point of the reload test below.
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

// Stands in for a FileSystemFileHandle. `permission` is what the browser would
// answer after a restart: 'granted' when the user allowed the file for every
// visit, 'prompt' when the grant lapsed and only a click can renew it.
function makeFileHandle({permission = 'granted', failWrites = false} = {}){
    const writes = [];
    return {
        writes,
        queryPermission: ()=> Promise.resolve(permission),
        createWritable(){
            if (failWrites) return Promise.reject(new Error("disk is read-only"));
            return Promise.resolve({
                write(blob){ writes.push(blob); return Promise.resolve() },
                close(){ return Promise.resolve() }
            });
        }
    };
}

function load({showSaveFilePicker} = {}){
    const tables = {};
    const errors = [];
    const sandbox = createContext({
        Blob,
        View: {},
        window: (showSaveFilePicker ? {showSaveFilePicker} : {}),
        Stored: makeStoredClass(tables),
        Logger: { info(){}, debug(){}, warn(){}, err: (...a)=>errors.push(a) }
    });
    const names = ['DiskMirror', 'GraphsKeeper', 'GraphExporter'];
    runInContext(src + '\n;globalThis.exported = {' + names.join(', ') + '};',
        sandbox, { filename: PATH });

    return { ...sandbox.exported, tables, errors };
}

const metaFor = (title)=>({
    graphId: '1.graph', title, revisions: 0, size: 0,
    added: 'then', lastUpdated: 'then'
});

test('a save still lands in storage when no disk file is picked', async ()=>{
    const { GraphsKeeper, tables } = load();
    const keeper = new GraphsKeeper();
    const meta = metaFor("Graph 1");

    await keeper.saveMetaAndData(meta, '<div>a node</div>');

    assert.equal(tables['graphs/graph-data'].get('1.graph'), '<div>a node</div>');
    assert.equal(meta.revisions, 1, 'the revision counter still moves');
    assert.equal(keeper.disk.isActive, false);
});

test('once a file is picked, every save is mirrored to it whole', async ()=>{
    const handle = makeFileHandle();
    const { GraphsKeeper } = load({showSaveFilePicker: ()=>Promise.resolve(handle)});
    const keeper = new GraphsKeeper();

    assert.equal(await keeper.disk.pick(), true);
    assert.equal(keeper.disk.isActive, true);

    await keeper.saveMetaAndData(metaFor("Graph 1"), '<div>a node</div>');

    assert.equal(handle.writes.length, 1, 'one write per save');
    const text = await handle.writes[0].text();
    // The exporter's bundle, not the bare markup: this is the format the
    // drop-to-import path reads, so the file can be loaded back.
    assert.ok(text.startsWith('{'), 'the bundle leads with its JSON header');
    assert.ok(text.includes('a node'), 'and carries the graph data');

    await keeper.saveMetaAndData(metaFor("Graph 1"), '<div>edited</div>');
    assert.equal(handle.writes.length, 2, 'and again on the next save');
    assert.ok((await handle.writes[1].text()).includes('edited'));
});

test('the picker opens on the name the graph already has', async ()=>{
    // The picker is where the folder and the name are chosen, so the name it opens with
    // is the one most readers keep. Both paths of Save to… have to agree on it: the
    // download fallback writes `#fileNameForMeta`, and a hardcoded `suggestedName` here
    // meant the browser that lets you choose was the one that offered no title.
    const options = [];
    const handle = makeFileHandle();
    const { GraphsKeeper } = load({
        showSaveFilePicker: (opts)=>{ options.push(opts); return Promise.resolve(handle) }
    });
    const keeper = new GraphsKeeper();

    assert.equal(await keeper.disk.pick('Field notes.neurite'), true);
    assert.equal(options[0].suggestedName, 'Field notes.neurite',
        'the name passed in is not what the picker opens with');

    // The default is what a graph with no save yet gets, and it still has to name the
    // format: an extensionless suggestion is a file no drop-to-import will accept.
    await keeper.disk.pick();
    assert.match(options[1].suggestedName, /\.neurite$/,
        'the fallback name no longer carries the extension');

    // And the button has to be the thing that passes it. The two assertions above are
    // satisfied by a `pick` nobody calls with a name -- which is exactly the state this
    // replaces -- so the caller is read from the source: `View.Graphs` needs the whole
    // page to construct, and this is the same text route the rest of test/ takes.
    // Comments stripped, because the ones just added name both methods.
    const code = src.replace(/^[ \t]*\/\/[^\n]*$/gm, '');
    const clicked = code.match(/#onBtnDiskFileClicked = \(e\)=>\{[\s\S]*?\n {4}\}/);
    assert.ok(clicked, '#onBtnDiskFileClicked is gone or no longer a field at that indent');
    assert.match(clicked[0], /\.pick\(this\.#suggestedFileName\(\)\)/,
        'Save to… opens the picker with no name again, so every graph is offered the '
        + 'same default however it is titled');

    const suggested = code.match(/#suggestedFileName\(\)\{[\s\S]*?\n {4}\}/);
    assert.ok(suggested, '#suggestedFileName is gone or no longer a method at that indent');
    assert.match(suggested[0], /#fileNameForMeta\(meta\)/,
        'the picker name is no longer the one the download writes, so the two halves of '
        + 'Save to… disagree about what the file is called');
    assert.match(suggested[0], /neurite-graph\.neurite/,
        'a graph with nothing selected now has no name to offer at all');
});

test('the picked file is remembered, and reclaimed only while permission holds', async ()=>{
    for (const permission of ['granted', 'prompt']) {
        const handle = makeFileHandle({permission});
        const { DiskMirror, GraphsKeeper, tables } = load({
            showSaveFilePicker: ()=>Promise.resolve(handle)
        });

        const Stored = makeStoredClass(tables);
        const keeper = new GraphsKeeper();
        assert.equal(await keeper.disk.useState(new Stored('state', 'GraphsView')), false,
            'nothing to reclaim on a first visit');

        await keeper.disk.pick();
        assert.equal(tables['state/GraphsView'].get('disk-file-handle'), handle,
            'the handle is stored for the next visit');

        // What a page load does: a fresh mirror over the same stored state.
        const next = new DiskMirror();
        const isAdopted = await next.useState(new Stored('state', 'GraphsView'));

        assert.equal(isAdopted, permission === 'granted');
        assert.equal(next.isActive, permission === 'granted',
            `permission '${permission}' should ${permission === 'granted' ? '' : 'not '}reconnect the file`);
    }
});

test('a write that fails drops the file instead of retrying every autosave', async ()=>{
    const handle = makeFileHandle({failWrites: true});
    const { GraphsKeeper, errors } = load({showSaveFilePicker: ()=>Promise.resolve(handle)});
    const keeper = new GraphsKeeper();
    await keeper.disk.pick();

    await keeper.saveMetaAndData(metaFor("Graph 1"), '<div>a node</div>');

    assert.equal(keeper.disk.isActive, false, 'the handle is let go');
    assert.equal(errors.length, 1, 'and the failure is reported once');

    await keeper.saveMetaAndData(metaFor("Graph 1"), '<div>again</div>');
    assert.equal(errors.length, 1, 'not once per save from then on');
});

test('an idle tab writes nothing: the same graph is not saved twice', async ()=>{
    const handle = makeFileHandle();
    const { GraphsKeeper } = load({showSaveFilePicker: ()=>Promise.resolve(handle)});
    const keeper = new GraphsKeeper();
    await keeper.disk.pick();
    const meta = metaFor("Graph 1");

    await keeper.saveMetaAndData(meta, '<div>a node</div>');
    await keeper.saveMetaAndData(meta, '<div>a node</div>'); // the next autosave tick

    assert.equal(meta.revisions, 1, 'an unchanged graph does not spend a revision');
    assert.equal(handle.writes.length, 1, 'nor rewrite the file on disk');

    await keeper.saveMetaAndData(meta, '<div>moved</div>');
    assert.equal(meta.revisions, 2, 'a real edit still saves');
    assert.equal(handle.writes.length, 2);

    // Picking a file mid-session goes through this: the graph on screen is
    // already stored, so without it the new file would stay empty.
    keeper.forgetLastWritten();
    await keeper.saveMetaAndData(meta, '<div>moved</div>');
    assert.equal(handle.writes.length, 3, 'a newly picked file is filled at once');
});

test('the mirror stays off in a browser with no file picker', ()=>{
    const { DiskMirror } = load(); // no window.showSaveFilePicker: Safari, and all of iOS
    assert.equal(DiskMirror.isSupported, false);
});
