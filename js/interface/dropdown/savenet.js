Blob.forJson = function(json){
    return new Blob([json], {type: 'application/json'})
}

// The kind of device a save was written on, in the words a warning uses (#60): "saved on the
// iPad". iPadOS Safari calls itself a Mac, so a Mac with a touch screen is taken for one.
function deviceKind(){
    const nav = globalThis.navigator;
    const ua = nav?.userAgent ?? '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return 'iPad';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Android/.test(ua)) return 'Android device';
    if (/Windows/.test(ua)) return 'Windows computer';
    if (/Linux/.test(ua)) return 'Linux computer';
    return 'another device';
}

// Which Graph a save is a copy of, across devices (#60). A graphId is this browser's own
// numbering -- the first graph on every device is `1.graph` -- so a file carries this instead.
// `getRandomValues` rather than `randomUUID`, which a LAN address over plain HTTP does not have.
function lineageId(){
    return Array.from(crypto.getRandomValues(new Uint8Array(16)),
                      (b)=> b.toString(16).padStart(2, '0')).join('');
}

// A web page cannot write to disk on its own. The user has to name the file
// once, in a real click, and only then may the page keep writing to it. Chrome
// remembers that grant across restarts, so after the one click every autosave
// lands in that file with no further prompting.
//
// Where there is no picker at all, this stays off and the evictable copy in
// IndexedDB is the only one. That is not just Safari and iOS: Brave ships with
// the File System Access API disabled, so `showSaveFilePicker` is `undefined`
// there too and `Save to…` is a plain download into the browser's own folder.
// Measured, not assumed -- and it is why `isSupported` is checked before the
// button is even shown, rather than failing at the moment of the click.
class DiskMirror {
    static isSupported = (typeof window.showSaveFilePicker === 'function');

    // Where there is no picker there is still a download, and every browser has
    // one. It gives a copy taken now rather than a file that keeps itself
    // current, which is worth saying out loud in the button's title -- but it is
    // the difference between a graph that can leave the browser and one that
    // cannot, so it is never the hidden option.
    static download(filename, blob){
        const url = URL.createObjectURL(blob);
        const a = Html.new.a();
        a.href = url;
        a.download = filename;
        a.click();
        // Revoking in the same task cancels the download in Safari, which reads
        // the object URL after the click returns rather than during it. A second
        // is long enough for that and short enough that a graph carrying video
        // does not sit twice in memory while a timer runs: the browser holds its
        // own reference to the blob once the download has started.
        setTimeout(URL.revokeObjectURL.bind(URL, url), 1000);
        return filename;
    }

    #handle = null;
    #state = null;
    #writing = null;
    // The file's `lastModified` just after this browser last wrote it, kept with the handle
    // (#60). Null for a file just picked, which the reader chose to write over.
    #modified = null;
    // The Graph the file is a copy of, by lineage id (#60), kept with the handle. A file is one
    // Graph's: Clear, or Open… of another, wrote the Graph now on screen over the one the file
    // held, and the lineage in its header changed with nothing to check it.
    #graph = null;
    // Told when mirroring stops, with why: `{reason: 'changed', name}` or `{reason: 'failed'}`.
    onStopped = ()=>{};

    get isActive(){ return this.#handle !== null }
    // Whether a save of the Graph with this lineage id belongs in the file. A file picked
    // before files were bound to a Graph takes the first one saved to it.
    isFor(uuid){
        if (this.#graph === null) this.#bindTo(uuid);
        return this.#graph === uuid;
    }
    #bindTo(uuid){
        this.#graph = uuid ?? null;
        this.#state?.save('disk-file-graph', this.#graph);
    }

    useState(state){
        this.#state = state;
        if (!DiskMirror.isSupported) return Promise.resolve(false);

        return state.load('disk-file-modified')
            .then( (modified)=>{ this.#modified = modified ?? null } )
            .then(state.load.bind(state, 'disk-file-graph'))
            .then( (graph)=>{ this.#graph = graph ?? null } )
            .then(state.load.bind(state, 'disk-file-handle'))
            .then(this.#adoptStored);
    }
    #adoptStored = (handle)=>{
        if (!handle) return false;

        // The handle survives a restart but its permission may not, and
        // re-requesting one needs a user gesture that a page load does not
        // have. So adopt an already-granted handle silently and leave the
        // rest to the button.
        return handle.queryPermission({mode: 'readwrite'})
            .then(this.#adoptIfGranted.bind(this, handle))
            .catch(this.#onStoredHandleUnusable);
    }
    #adoptIfGranted = (handle, permission)=>{
        if (permission !== 'granted') return false;

        this.#handle = handle;
        return true;
    }
    #onStoredHandleUnusable = (err)=>{
        Logger.warn("Stored disk file is unusable:", err);
        this.forget();
        return false;
    }

    // The picker is where the reader chooses the folder and the name, so the name it
    // opens with is the one they are most likely to keep. It used to be
    // 'neurite-graph.neurite' for every graph, while the download fallback beside it
    // named the file after the graph -- so the same command produced a titled file in
    // one browser and an untitled one in the browser that lets you choose.
    pick(suggestedName = 'neurite-graph.neurite', graphUuid = null){ // only from within a user gesture
        return window.showSaveFilePicker({
            suggestedName,
            types: [{
                description: "Neurite graph",
                accept: {'application/octet-stream': ['.neurite', '.txt']}
            }]
        }).then(this.#adoptPicked.bind(this, graphUuid), this.#onPickFailed)
    }
    #adoptPicked = (graphUuid, handle)=>{
        this.#handle = handle;
        this.#modified = null;
        this.#state?.delete('disk-file-modified');
        this.#bindTo(graphUuid);
        this.#state?.save('disk-file-handle', handle)
            .catch(Logger.warn.bind(Logger, "Could not remember the disk file:"));
        return true;
    }
    #onPickFailed = (err)=>{
        if (err?.name !== 'AbortError') Logger.warn("No disk file chosen:", err);
        return false;
    }

    forget(){
        this.#handle = null;
        this.#graph = null;
        this.#state?.delete('disk-file-modified');
        this.#state?.delete('disk-file-graph');
        return this.#state?.delete('disk-file-handle');
    }

    // Settles true once the blob is in the file, false when it was not written.
    write(blob){
        const handle = this.#handle;
        if (!handle) return Promise.resolve(false);

        // Autosave runs on a timer, so a slow disk must not leave two writes
        // holding the same file open. Queue them behind each other instead.
        this.#writing = Promise.resolve(this.#writing)
            .then(this.#writeUnlessChanged.bind(this, handle, blob))
            .catch(this.#onWriteFailed);
        return this.#writing;
    }
    // One writer at a time (#60). A file in iCloud Drive is written from the iPad too, and one
    // changed there since this browser last wrote it is the other device's work: the next
    // autosave wrote over it, every eight seconds, and said nothing. So it is left alone, and
    // the mirror stops until the reader picks a file again.
    #writeUnlessChanged(handle, blob){
        if (handle !== this.#handle) return false;

        return handle.getFile().then( (file)=>{
            if (this.#modified !== null && file.lastModified !== this.#modified) {
                return this.#stop({reason: 'changed', name: file.name});
            }
            return this.#writeThrough(handle, blob)
                .then( ()=>handle.getFile() )
                .then(this.#noteWritten.bind(this, handle));
        });
    }
    #writeThrough(handle, blob){
        return handle.createWritable()
            .then( (stream)=>stream.write(blob).then(stream.close.bind(stream)) )
    }
    // Recorded for the file it was, and only while that file is still the one being written: a
    // file picked during a slow write took the old file's time for its own, and its first
    // autosave then read as another device's change.
    #noteWritten = (handle, file)=>{
        if (handle !== this.#handle) return true;

        this.#modified = file.lastModified;
        this.#state?.save('disk-file-modified', file.lastModified);
        return true;
    }
    #stop(why){
        this.forget();
        this.onStopped(why);
        return false;
    }
    #onWriteFailed = (err)=>{
        // Keeping the handle would mean repeating the same failure every eight
        // seconds. Drop it, say so once, and let the button reconnect.
        Logger.err("Failed to mirror the save to disk:", err);
        this.#handle = null;
        this.onStopped({reason: 'failed'});
        return false;
    }
}

class GraphsKeeper {
    #blobData = new Stored('blobs', 'blob-data');
    #blobMeta = new Stored('graphs', 'blob-meta');
    #data = new Stored('graphs', 'graph-data');
    #meta = new Stored('graphs', 'graph-meta');

    disk = new DiskMirror();

    blobForBlobId(blobId){ return this.#blobData.load(blobId) }
    blobMetaForGraphId(graphId){ return this.#blobMeta.load(graphId) }
    dataForMeta(meta){ return this.#data.load(meta.graphId) }

    deleteBlob(blobId){ return this.#blobData.delete(blobId) }
    deleteBlobMeta(graphId){ return this.#blobMeta.delete(graphId) }
    #deleteBlobs = (dictMeta)=>{
        for (const blobId in dictMeta) this.deleteBlob(blobId)
    }
    deleteForMeta(meta){
        const graphId = meta.graphId;
        this.#blobMeta.load(graphId).then(this.#deleteBlobs);
        this.#blobMeta.delete(graphId);
        this.#data.delete(graphId);
        this.#lastWritten.delete(graphId);
        return this.#meta.delete(graphId);
    }
    drop(){
        this.forgetLastWritten();
        Stored.drop('blobs');
        return Stored.drop('graphs');
    }

    forEachBlobMetaAndGraphId(cb){ return this.#blobMeta.table.iterate(cb) }
    forEachMetaAndGraphId(cb){ return this.#meta.table.iterate(cb) }

    saveBlobData(blobId, blob){ return this.#blobData.save(blobId, blob) }
    saveBlobMeta(graphId, dictMeta){
        return this.#blobMeta.save(graphId, dictMeta)
    }
    // Autosave fires every eight seconds whether or not anything moved. Writing
    // an unchanged graph would spend a revision, a whole IndexedDB write and --
    // once a disk file is bound -- a whole file rewrite, on every tick of an
    // idle tab. So compare against the last write and do nothing when the graph
    // is the same. Only a completed write counts, or a store that rejected the
    // data would look written.
    #lastWritten = new Map();

    forgetLastWritten(){ this.#lastWritten.clear() }

    saveMetaAndData(meta, data){
        if (this.#lastWritten.get(meta.graphId) === data) return Promise.resolve();

        meta.lastUpdated = new Date().toLocaleString();
        // `lastUpdated` is for reading and does not sort; this does (#60).
        meta.updatedAt = Date.now();
        meta.uuid ??= lineageId();
        meta.revisions += 1;
        meta.size = new Blob([data]).size;
        return this.#data.save(meta.graphId, data)
            .then(this.saveMeta.bind(this, meta))
            .then(this.#markWritten.bind(this, meta.graphId, data))
            .then(this.#mirrorToDisk.bind(this, meta));
    }
    #markWritten(graphId, data){ this.#lastWritten.set(graphId, data) }
    saveMeta(meta){ return this.#meta.save(meta.graphId, meta) }

    #mirrorToDisk(meta){
        if (!this.disk.isActive || !this.disk.isFor(meta.uuid)) return;

        // Mirror the same bundle the drop-to-import path reads, so the file on
        // disk is a whole graph -- images and media included -- rather than
        // markup that points at blobs left behind in IndexedDB.
        return (new GraphExporter(meta, this)).export()
            .then(this.#writeToDisk)
            .then( (written)=>written && this.markSavedToFile(meta, 'file') );
    }
    #writeToDisk = (blob)=>this.disk.write(blob);
    // When the Graph last went to a file, which the Save row shows (#11), and how: written to
    // it (`file`), handed to a download, which a page cannot see finish (`download`), or opened
    // from one (`opened`). Two more things from that moment: the save time of the content the
    // file holds, which is the one a file's header carries and so the one to compare a file
    // against (#60); and the revision, which says whether the Graph has changed since.
    markSavedToFile(meta, how, content = meta.updatedAt){
        meta.savedToFileAt = (how === 'opened' ? content : Date.now());
        meta.savedToFileHow = how;
        meta.savedToFileContent = content;
        meta.savedToFileRevision = meta.revisions;
        meta.savedToFileSignature = this.signatureOf?.() ?? null;
        return this.saveMeta(meta);
    }
    // What the Graph holds, apart from where it is viewed from -- the page supplies it
    // (`View.Graphs.contentSignature`), since only the page can read it.
    signatureOf = null;
}

// A `.neurite` file (#61): a JSON header, a NUL, then every image and media file of the Graph
// back to back, each at the offset the header gives it. "Complete" is what this writes: the
// Graph's markup, the Panes' text and every blob it points at.
//
// `v` is the format's version. A file with none is version 0, the same shape without `meta`,
// and still reads. `meta` says which Graph the file is a copy of and how far along -- so a file
// opened on another device can say it is older than what is on screen (#60) -- and where it
// was written.
class GraphExporter {
    static version = 1;
    #out = {
        v: GraphExporter.version,
        meta: null,
        data: '',
        blobMeta: {},
        offsets: {}
    };
    constructor(meta, stored){
        this.meta = meta;
        this.stored = stored;
        this.#out.meta = {
            uuid: meta.uuid ?? null,
            revisions: meta.revisions ?? 0,
            updatedAt: meta.updatedAt ?? null,
            device: deviceKind()
        };
    }
    export(){
        return this.#gatherData()
            .then(this.#gatherBlobMeta)
            .then(this.#gatherBlobs)
            .then(this.#gatherOutput)
    }
    #gatherData = ()=>{
        return this.stored.dataForMeta(this.meta)
    }
    #gatherBlobMeta = (data)=>{
        this.#out.data = data;
        return this.stored.blobMetaForGraphId(this.meta.graphId);
    }
    #gatherBlobs = (dictMeta)=>{
        this.#out.blobMeta = dictMeta;
        const proms = [];
        for (const blobId in dictMeta) {
            proms.push(this.stored.blobForBlobId(blobId))
        }
        return Promise.all(proms);
    }
    #gatherOutput = (arrBlobs)=>{
        let i = 0;
        let o = 0;
        for (const blobId in this.#out.blobMeta) {
            this.#out.offsets[blobId] = o;
            o += arrBlobs[i].size;
            i += 1;
        }
        return new Blob([JSON.stringify(this.#out), '\x00', ...arrBlobs]);
    }
}

class GraphImporter {
    #base = 0;
    #blobMeta = {};
    #buffer = null;
    #offsets = {};

    data = '';
    // The file's format version (#61) and its `meta` block, if it has one.
    version = 0;
    meta = null;
    saveNodeItsBlob = null;
    blobForNode(node){
        const blobId = node.blob;
        const meta = this.#blobMeta[blobId];
        const options = {type: meta.type};
        const o = this.#base + this.#offsets[blobId];
        const buffer = this.#buffer.slice(o, o + meta.size);
        const blob = new Blob([buffer], options);
        this.saveNodeItsBlob(node, blob);
        this.data = this.data.replace(
            "&quot;blob&quot;:&quot;" + blobId + "&quot;",
            "&quot;BLOB&quot;:&quot;" + node.blob + "&quot;"
        );
        return blob;
    }
    get finalData(){
        return this.data.replaceAll(
            "&quot;BLOB&quot;:&quot;", "&quot;blob&quot;:&quot;"
        )
    }

    import(file){
        return file.arrayBuffer()
            .then(this.#handleBuffer)
            .then(this.#handleJson)
    }
    // The header ends at the first NUL. A file with none -- an old `.txt` save, or anything
    // else -- is all header, and reads as text below. The scan used to step past the end of
    // such a file and throw, so Open… did nothing at all.
    #handleBuffer = (buffer)=>{
        this.#buffer = buffer;
        const nul = new Uint8Array(buffer).indexOf(0);
        const end = (nul < 0 ? buffer.byteLength : nul);

        this.#base = end + 1;
        return Blob.forJson(buffer.slice(0, end)).text();
    }
    #handleJson = (json)=>{
        let input = null;
        try {
            input = JSON.parse(json)
        } catch(err) {
            return Promise.resolve()
        }
        // Not a bundle unless it is one: a `.txt` save whose text is a JSON number parsed.
        if (typeof input?.data !== 'string') return;

        this.version = Number(input.v) || 0;
        this.meta = input.meta ?? null;
        this.#blobMeta = input.blobMeta;
        this.data = input.data;
        this.#offsets = input.offsets;
    }
}

View.Graphs = class {
    #btnClear = Elem.byId('clear-button');
    #btnDiskFile = Elem.byId('disk-file-button');
    #btnOpenFile = Elem.byId('open-file-button');
    #saveNote = Elem.byId('save-note');
    // What the note under Save to… has to say, beside the file's age: the restore failed, so
    // nothing is saved; the mirror stopped, and why; whether this origin's storage is kept.
    #restoreFailed = false;
    #diskStopped = null;
    #persisted = null;
    // A page cannot open a file dialog on its own: the input is what Open… clicks.
    #inputOpenFile = Elem.byId('open-file-input');

    #blobs = {};
    #graphs = [];
    // One tab per record. Two tabs of the same origin share one IndexedDB and each runs
    // its own eight-second timer, so both were writing to whichever record
    // `latest-selected` named -- and a tab whose canvas was empty wrote *empty* over the
    // work of the tab that had notes in it. Measured: a graph of two notes stored at
    // 15,985 bytes, replaced by 6,744 bytes of settings with no `data-node_json` in it,
    // which is the shape of the file this was found through.
    //
    // The lock is held for the tab's lifetime rather than per write: a write is not the
    // unit of ownership, the session is. A tab that cannot get it still shows the graph
    // and still saves -- it just saves to a record of its own.
    #isWriter = true;
    // Settles true once the previous session's graph is back on screen, false if it
    // could not be; `init` replaces it.
    #whenRestored = Promise.resolve(false);
    #maxBlobId = 0;
    #maxGraphId = 0;
    #saver = new View.Graphs.Saver(this);
    #selectedGraph = null;
    #state = new Stored('state', 'GraphsView');
    #stored = new GraphsKeeper();

    #setSelectedGraph(meta){
        this.#selectedGraph = meta;
        this.#state.save('latest-selected', meta?.graphId);
        return this;
    }

    // Bookkeeping, with nothing on screen to update. A graph's durable form is a file
    // on disk, so there is no list of graphs in the interface and this reads the store
    // back into memory only: `#graphs` for the title checks, `#selectedGraph` re-pointed
    // at the record the store just wrote, and `#blobs` because `BlobSaver` diffs against
    // it to find the assets a save has stopped referencing.
    #updateGraphs = ()=>{
        const stored = this.#stored;
        this.#blobs = {};
        this.#graphs = [];
        return stored.forEachMetaAndGraphId(this.#appendMeta)
            .then(stored.forEachBlobMetaAndGraphId
                    .bind(stored, this.#processBlobMeta));
    }
    #appendMeta = (meta, graphId)=>{
        this.#graphs.push(meta);
        if (graphId === this.#selectedGraph?.graphId) this.#selectedGraph = meta;
    }

    #makeMetaForBlobOfTitle(blob, title){
        return {
            added: new Date().toLocaleString(),
            blobId: String(this.#maxBlobId += 1) + '.blob',
            size: blob.size,
            title,
            type: blob.type
        }
    }
    #makeMetaForTitle(title){
        const strDate = new Date().toLocaleString();
        return {
            added: strDate,
            graphId: String(this.#maxGraphId += 1) + '.graph',
            lastUpdated: strDate,
            revisions: 0,
            size: 0,
            title,
            updatedAt: Date.now(),
            uuid: lineageId()
        };
    }

    #metaByGraphId(graphId){
        return this.#graphs.find(this.#hasGraphIdThis, graphId || '')
    }
    #hasGraphIdThis(obj){ return obj.graphId === this.valueOf() }

    // `MetaView` was here: a row per graph, with a title input, Load and X. It went with
    // the list it filled. Load's job is Open…'s now, and it reads a file rather than an
    // IndexedDB record; renaming a graph is naming the file the picker or the prompt asks
    // about; and deleting one is deleting a file, which no page needs code for.

    // Dropping a `.neurite` file used to mean dropping it on the list, which was inside a
    // panel, unmarked, and is now gone. The canvas takes it instead -- `handledrop.js`
    // routes a file by that extension here rather than making a text Node out of a bundle
    // -- so this is the one way in from a drag, and Open… is the one way in from a click.
    importFile(file){
        if (!file) return Logger.info("Missing file");

        return this.#bankScreen().then(this.#import.bind(this, file));
    }

    // For a host that is about to close the page and can wait for it: the macOS app
    // (desktop/main.cjs) calls this on quit. The save `visibilitychange` starts as a
    // window closes has as long as the unload lasts, which is enough for a small graph
    // and not for a big one. Measured in Electron: 100 notes quit 300ms after the last
    // one, before any autosave tick, came back as an empty graph 3 runs of 3; with the
    // quit waiting on this, all 101 notes came back 3 of 3.
    //
    // Never before the saved graph is back on screen, so an early call waits for it.
    // Until then the canvas is empty or half-built and `#maxGraphId` is still 0, so a
    // save opens `1.graph` again -- the id of the reader's first graph -- and writes the
    // empty canvas over it. A review measured exactly that: a close in the few
    // milliseconds after `App` exists replaced a 5-note graph with an empty one. Waiting
    // rather than declining, because the restore can finish after notes are already on
    // screen: a burst of them at startup pushed it 700ms past `appReady`, and a quit in
    // that window would otherwise have saved nothing at all.
    saveNow(){ return this.#whenRestored.then( (restored)=>restored && this.#autosave() ) }
    #import(file){
        const importer = new GraphImporter();
        const afterImport = this.#afterImport.bind(this, importer, file);
        return importer.import(file).then(afterImport).catch(this.#onImportFailed);
    }
    #onImportFailed = (err)=>{
        Logger.err("Could not open the file:", err);
        alert("This file could not be opened. The graph on screen is unchanged.");
    }
    async #afterImport(importer, file){
        const name = file.name;
        const index = name.lastIndexOf('.');
        const title = this.#freeTitle(index > -1 ? name.slice(0, index) : name);

        // A newer format may carry what this version would drop on its next save (#61).
        if (importer.version > GraphExporter.version) {
            return alert("This file was saved by a newer version of Neurite, so this one "
                       + "cannot open it without losing part of it. Update Neurite and try again.");
        }
        if (!await this.#confirmIfOlderThanOpen(importer.meta)) return Logger.info("Open cancelled");

        if (!importer.data) {
            const reader = new FileReader();
            On.load(reader, this.#onFileLoaded.bind(this, title));
            return reader.readAsText(file);
        }

        this.#loadAndSave(importer, title).then(this.#updateGraphs);
    }
    // A file names itself after the graph it came from, so opening one twice -- or opening
    // a file exported from this browser at all -- lands a second save under a title the
    // list already holds. Two rows reading "Graph 2" is the visible half. The half that
    // costs work is `CoreSaver.save`, which overwrites *every* save whose title matches:
    // one autosave tick after that, both rows hold the same graph and the older one is
    // gone. So an imported title is made free before it is used.
    // Why a file's text is not an old save, or null if it is one: the markup of a Graph, which
    // begins as HTML and carries a Node, a Pane or the old single-Pane save.
    static notAGraph(text){
        const start = String(text ?? '').trimStart();
        if (start.startsWith('{')) return "This file looks like a Neurite file, but it is damaged or cut short.";
        if (!start.startsWith('<')
            || !/data-node_json|id="zettelkasten-pane-|id="zettelkasten-save"/.test(start)) {
            return "This file is not a Neurite graph.";
        }
        return null;
    }
    #freeTitle(title){
        const base = (title || 'Graph').trim() || 'Graph';
        if (!this.#graphs.some(Object.hasTitleThis, base)) return base;

        let n = 2;
        while (this.#graphs.some(Object.hasTitleThis, base + ' (' + n + ')')) n += 1;
        return base + ' (' + n + ')';
    }

    // One writer at a time (#60): a file is the Graph moving between devices, so opening an
    // older copy of the Graph on screen is most likely the wrong file -- the one from before
    // the other device's work. Asked, not refused: the copy opens as a Graph of its own, and
    // the one on screen is kept either way.
    //
    // Older than the last file this device has of the Graph, not than its last save: every save
    // moves that time, a pan's too, and an import stamps it, so the file saved seconds before a
    // pan -- or one newer than the screen -- was called an older copy (rv15).
    //
    // And a copy of the Graph on screen from before changes that are in no file yet is asked
    // about too: opened, it takes the screen, and those changes stay behind in this browser,
    // where nothing in the interface reaches them.
    #confirmIfOlderThanOpen(theirs){
        const open = this.#selectedGraph;
        if (!theirs?.uuid || theirs.uuid !== open?.uuid) return Promise.resolve(true);

        const isOlder = (theirs.updatedAt ?? 0) < (open.savedToFileContent ?? 0);
        const hasChanges = Boolean(open.savedToFileSignature)
                        && View.Graphs.contentSignature() !== open.savedToFileSignature;
        if (!isOlder && !hasChanges) return Promise.resolve(true);

        // The question comes up over the menu Open… was chosen from, which covered it.
        if (dropdownContent.classList.contains('open')) menuButton.click();
        const when = (t)=> (t ? new Date(t).toLocaleString() : 'at an unknown time');
        const where = (theirs.device && theirs.device !== deviceKind()) ? ` on the ${theirs.device}` : '';
        const why = isOlder
            ? `This file is an older copy of the graph on screen. The file was saved `
              + `${when(theirs.updatedAt)}${where}, and this graph's latest file was saved `
              + `${when(open.savedToFileContent)}.`
            : `The graph on screen has changes that are in no file yet, and this file is a copy `
              + `of it from before them.`;
        return window.confirm(why + ` Open this copy anyway? It opens as a graph of its own, and `
            + `the one on screen stays in this browser.`);
    }
    #loadAndSave(importer, title){
        const meta = this.#makeMetaForTitle(title);
        // The Graph the file is a copy of, and how far along it was (#60), so the next file
        // this device saves still says which Graph it is.
        if (importer.meta?.uuid) meta.uuid = importer.meta.uuid;
        meta.revisions = importer.meta?.revisions ?? 0;
        this.#graphs.push(meta);

        const blobSaver = new View.Graphs.BlobSaver(this, meta.graphId);
        importer.saveNodeItsBlob = blobSaver.saveNodeItsBlob.bind(blobSaver);

        this.#detachMirror();
        this.#setSelectedGraph(meta).#loadGraph(importer.data, importer);
        // What is on screen is the file's content, so it is in a file: the one it came from,
        // saved when its header says (#11).
        return this.#stored.saveMetaAndData(meta, importer.finalData)
            .then( ()=>this.#stored.markSavedToFile(meta, 'opened', importer.meta?.updatedAt ?? Date.now()) )
            .then(this.#resumeAfterRecovery)
            .then(this.#updateSaveNote);
    }
    // The same guard on the older path: a `.txt` or a bundle this importer could not read
    // still arrives with a name, and `addSave` does not check titles either.
    // A file that is not a bundle -- an older save, which was the markup as text -- is stored
    // and put on screen, as a bundle is. It was stored only: with no list of graphs, that was
    // a record no one could reach, so Open… on one did nothing to be seen.
    //
    // And only if it is one. Any other text -- a note, a bundle cut short -- was taken for an
    // old save, the screen was cleared for it, and the empty record became the one a reload
    // reopens (rv15).
    async #onFileLoaded(title, e) {
        const content = e.target.result;
        const problem = View.Graphs.notAGraph(content);
        if (problem) return alert(problem + " Nothing was opened, and the graph on screen is unchanged.");

        try {
            await this.#saver.addSave('dropped', title, content, 'select');
            this.#detachMirror();
            this.#loadGraph(content);
            await this.#updateGraphs();
            this.#resumeAfterRecovery();
            this.#updateSaveNote();
        } catch (err) {
            const loadAnyway = await window.confirm(
                "The file is too large to store. Would you like to load it anyway?"
            );
            if (!loadAnyway) return;
            this.#setSelectedGraph(null).#loadGraph(content);
        }
    }

    // `Save graph` was here, and it forked the graph into a second record inside the
    // browser. That was worth a row while a list showed the records; with the list gone it
    // would make a copy nobody can see, reach or delete -- which is the shape of a button
    // that does nothing. Two graphs kept apart is two files now: Save to… twice, under two
    // names.

    // The question is asked through the app's modal rather than by growing a
    // Yes/No pair beside the row: as a row of the menu this has no room to put
    // one, and every other question this file asks -- an empty save, a file too
    // large to store -- is already a `window.confirm`.
    #onBtnClearClicked = (e)=>{
        // It says what is true now that there is no list: the graph is banked, so a
        // refresh reopens it, but nothing in the interface reaches it after the next one.
        // Save to… is what makes a graph you can come back to.
        const msg = "Start an empty graph? Use Save to… first if you want to keep this "
                  + "one -- a graph you have not saved to disk cannot be reopened once "
                  + "you start another.";
        window.confirm(msg).then(this.#handleConfirmClear);
    }
    #handleConfirmClear = (confirmed)=>{
        if (!confirmed) return;

        // Bank what is on screen before wiping it, then leave nothing selected:
        // the next autosave tick opens a fresh save rather than overwriting the
        // one just banked.
        this.#bankScreen().then(this.#startNewGraph);
    }
    #startNewGraph = ()=>{
        this.#detachMirror();
        this.#setSelectedGraph(null).#clearGraph();
        App.zetPanes.addPane();
        resetSavedViews();
        return this.#updateGraphs()
            .then(this.#resumeAfterRecovery)
            .then(this.#updateSaveNote);
    }
    // A graph of its own for something that comes in whole -- a folder of notes
    // (`ZetImport`): what is on screen is banked first, as Clear banks it.
    startNewGraph(){ return this.#bankScreen().then(this.#startNewGraph) }

    // What is on screen, saved before another Graph takes its place -- unless the last Graph did
    // not reopen, when the screen is not a Graph at all: banked, it wrote the empty canvas over
    // the record that failed, the one a reload retries (rv15).
    #bankScreen(){ return (this.#restoreFailed ? Promise.resolve() : this.#autosave()) }
    // A Graph back on screen after a restore that failed -- opened, or started -- is the reader's
    // work from here, and saved like any other.
    #resumeAfterRecovery = ()=>{
        if (!this.#restoreFailed) return;

        this.#restoreFailed = false;
        this.#startAutosave();
    }
    // A file is one Graph's (DiskMirror.isFor), so another Graph on screen ends the mirror,
    // said on the button rather than by a write that goes nowhere.
    #detachMirror(){
        const disk = this.#stored.disk;
        if (!disk.isActive) return;

        disk.forget();
        this.#diskStopped = null;
        this.#updateDiskFileButton();
    }

    #onBtnResetSettingsClicked(e){
        settings.clear();
        settings.init();
        editTab.init();
    }
    // Settings, keys and view history, as the button says -- and not the Graphs. It dropped
    // the `graphs` and `blobs` stores and the record of which Graph to reopen, under a
    // tooltip saying saved graphs are untouched: one click on a settings button lost every
    // Graph in the browser.
    //
    // Asked first: API keys go with it, and on a GitHub Pages address the storage belongs to
    // every Pages site of the account, whose own settings go too.
    #onBtnClearLocalClicked = async (e)=>{
        const shared = /\.github\.io$/.test(location.hostname)
            ? " This address is shared with the other GitHub Pages sites under "
              + location.hostname + ", and what they keep in it goes too." : "";
        const confirmed = await window.confirm("Settings, API keys and view history go; your graphs are kept." + shared,
            {title: "Clear this browser's local storage for this site?", ok: "Clear", danger: true});
        if (!confirmed) return;

        localStorage.clear();
        Stored.drop('Neurite')
            .then(alert.bind(null, "Settings, API keys and view history are cleared. "
                                 + "Your graphs are kept."));
    }

    static CoreSaver = class {
        #type = '';
        constructor(mom, title, dataMaker){
            this.makeData = dataMaker;
            this.mom = mom;
            this.title = title;
        }

        save(){
            const len = this.mom.#graphs
                        .filter(Object.hasTitleThis, this.title).length;
            return (len < 1) ? this.addSaveAndSelectIt("new") : this.#overwrite();
        }

        #overwrite(){
            return this.mom.#graphs
                .reduce(this.#overwriteGraphByProm, Promise.resolve())
                .then(this.#afterOverwrite)
        }
        #overwriteGraphByProm = (prom, meta)=>{
            if (meta.title !== this.title) return prom;

            Logger.debug("Overwrite graph", meta.graphId);
            return this.#makeAndStoreDataForMeta(meta);
        }
        #afterOverwrite = ()=>{ Logger.info(this.#msgOverwrite, this.title) }
        #msgOverwrite = "Updated all saves of title:";

        #makeAndStoreDataForMeta(meta){
            const stored = this.mom.#stored;
            return this.makeData(meta)
                .then(stored.saveMetaAndData.bind(stored, meta));
        }

        addSaveAndSelectIt(type){ return this.addSave(type, 'select') }
        addSave(type, option){
            this.#type = type;
            const meta = this.mom.#makeMetaForTitle(this.title);
            if (option === 'select') this.mom.#setSelectedGraph(meta);
            return this.#makeAndStoreDataForMeta(meta)
                .then(this.#afterAddSave, this.#onSaveError);
        }
        #afterAddSave = ()=>{
            Logger.info("Added", this.#type, "save:", this.title)
        }
        // Autosave runs on a timer, so this must not ask the user anything -- a
        // prompt here would reappear every eight seconds. The disk file is the
        // way out of a full store, and the button that picks one stays visible.
        #onSaveError = (err)=>{
            Logger.err("Failed to save:", this.title, err)
        }
    }

    static Saver = class {
        constructor(mom){ this.mom = mom }
        addSave(type, title, content, option){
            const dataMaker = ()=>Promise.resolve(content) ;
            return (new View.Graphs.CoreSaver(this.mom, title, dataMaker))
                .addSave(type, option);
        }

        #replaceNewLinesInLLMSaveData(nodeData){
            const div = Html.new.div();
            div.innerHTML = nodeData;
            div.querySelectorAll('[data-node_json]')
                .forEach(this.#handleNodeWithJson, this);
            return div.innerHTML;
        }
        #handleNodeWithJson(node){
            try {
                if (!JSON.parse(node.dataset.node_json).isLLM) return
            } catch (err) {
                Logger.warn("Error parsing node JSON:", err);
                return;
            }
            node.querySelectorAll('pre').forEach(this.#handlePre);
        }
        #handlePre(pre){
            pre.innerHTML = pre.innerHTML.replace(/\n/g, App.NEWLINE_PLACEHOLDER)
        }

        #collectAdditionalSaveObjects(){
            // Collecting slider values
            const inputValues = localStorage.getItem('inputValues') || '{}';
            const savedInputValues = `<div id="saved-input-values" style="display:none;">${encodeURIComponent(inputValues)}</div>`;

            // Collecting saved views
            const savedViewsString = JSON.stringify(savedViews);
            const savedViewsElement = `<div id="saved-views" style="display:none;">${encodeURIComponent(savedViewsString)}</div>`;

            // Get current Mandelbrot coords in a standard format
            const mandelbrotParams = Graph.getCoords();
            const mandelbrotSaveElement = `<div id="mandelbrot-coords-params" style="display:none;">${encodeURIComponent(JSON.stringify(mandelbrotParams))}</div>`;

            // Get the selected fractal type from localStorage
            const selectedFractalType = localStorage.getItem('fractal-select');
            const fractalTypeSaveElement = `<div id="fractal-type" style="display:none;">${encodeURIComponent(JSON.stringify(selectedFractalType))}</div>`;

            // The Proposed Edges the reader dismissed, so they stay dismissed (#72).
            const dismissedEdges = `<div id="dismissed-edges" style="display:none;">${encodeURIComponent(JSON.stringify(ZetProposals.dismissedForSave()))}</div>`;

            // Combine both slider values and saved views in one string
            return savedInputValues + savedViewsElement + mandelbrotSaveElement + fractalTypeSaveElement + dismissedEdges;
        }
        // One damaged part costs itself, not the Graph. A saved-views block that did not decode
        // threw here -- after the screen was cleared and before any card was built -- so a file
        // opened as an empty Graph, and a Graph with one did not reopen at all (rv15). Removed
        // either way, or the card loop would try to build a Node out of it.
        #restorePart(d, selector, restore){
            const elem = d.querySelector(selector);
            if (!elem) return;

            try {
                restore(elem);
            } catch (err) {
                Logger.warn("Could not restore the saved", selector, "- skipping it:", err);
            }
            elem.remove();
        }
        restoreAdditionalSaveObjects(d){
            this.#restorePart(d, "#saved-views", (elem)=>{
                savedViews = JSON.parse(decodeURIComponent(elem.innerHTML));
                if (savedViews) {
                    updateSavedViewsCache();
                    displaySavedCoordinates();
                }
            });

            this.#restorePart(d, "#saved-input-values", (elem)=>{
                localStorage.setItem('inputValues', decodeURIComponent(elem.innerHTML));
            });

            restoreInputValues();

            this.#restorePart(d, "#mandelbrot-coords-params", (elem)=>{
                const mandelbrotParams = JSON.parse(decodeURIComponent(elem.textContent));
                const pan = mandelbrotParams.pan.split('+i');
                Animation.goToCoords(mandelbrotParams.zoom, pan[0], pan[1]); // Direct function call using parsed params
            });

            this.#restorePart(d, "#fractal-type", (elem)=>{
                const fractalSelectElement = Elem.byId('fractal-select');
                const fractalType = JSON.parse(decodeURIComponent(elem.textContent));
                if (fractalType) {
                    fractalSelectElement.value = fractalType;
                    Select.updateSelectedOption(fractalSelectElement);
                    Fractal.updateJuliaDisplay(fractalType);
                }
            });

            this.#restorePart(d, "#dismissed-edges", (elem)=>{
                ZetProposals.restoreDismissed(JSON.parse(decodeURIComponent(elem.textContent)));
            });
        }

        #makeSaveData = (meta)=>{
            //TEMP FIX: To-Do: Ensure processChangedNodes in zettelkasten.js does not cause other node textareas to have their values overwritten.
            window.zetPaneList.forEach(this.#handlePane);

            return Promise.resolve(meta.graphId)
                .then(this.#saveBlobsForGraphId)
                .then(this.#updateTheNodes)
                .then(this.#getSaveData);
        }
        #handlePane(pane){
            // The text is already in the editor; this only reparses it.
            pane.processor.processAs(ZettelkastenProcessor.Pass.rewrite);
        }
        #saveBlobsForGraphId = (graphId)=>{
            return graphId
                && (new View.Graphs.BlobSaver(this.mom, graphId)).save()
        }
        #updateTheNodes = ()=>{ Graph.forEachNode(this.#updateNode) }
        #updateNode(node){
            node.updateEdgeData();
            node.updateNodeData();
        }
        #getSaveData = ()=>{
            // Clone the currently selected UUIDs before clearing
            const selectedNodes = App.selectedNodes;
            const selectedNodesUuids = new Set(selectedNodes.uuids);
            selectedNodes.clear();

            // Save the node data
            let nodeData = Elem.byId('nodes').innerHTML;

            selectedNodesUuids.forEach(selectedNodes.restoreNodeById, selectedNodes);

            nodeData = this.#replaceNewLinesInLLMSaveData(nodeData);

            const zettelkastenPanesSaveElements = [];
            window.zetPaneList.forEach( (pane, index)=>{
                const content = pane.cm.getValue();
                // Ask the Pane for its own id. This was `'zet-pane-' + (index + 1)`,
                // which stops naming the right Pane as soon as one is deleted: the id
                // counter never reuses a number, so the sequence has a gap and every
                // later Pane was saved with an empty name. The element id below stays
                // positional -- it only has to be unique, and the loader reads these
                // in document order.
                const name = App.zetPanes.getPaneName(pane.paneId);
                // The Titles this Pane has taken lines for, held in another Pane (#64). Without
                // them a load gave each Title to whichever Pane it restored first, so a note
                // could open as the taken copy, and its own section as the one marked.
                const taken = [...new Set((pane.processor.taken ?? [])
                    .filter( (t)=>(t.holder !== pane.processor) ).map( (t)=>t.title ))];
                const takenAttr = (taken.length ? ` data-taken="${encodeURIComponent(JSON.stringify(taken))}"` : '');
                // Where its notes are on the Plane, for an Archive a folder was imported into (#73).
                const region = ZetRegions.of(pane.paneId);
                const regionAttr = (region ? ` data-region="${encodeURIComponent(JSON.stringify(region))}"` : '');
                const paneSaveElement = `<div id="zettelkasten-pane-${index}" data-pane-name="${encodeURIComponent(name)}"${takenAttr}${regionAttr} style="display:none;">${encodeURIComponent(content)}</div>`;
                zettelkastenPanesSaveElements.push(paneSaveElement);
            });

            return nodeData + zettelkastenPanesSaveElements.join('') + this.#collectAdditionalSaveObjects();
        }

        saveWithTitle(title){
            const mom = this.mom;
            const meta = mom.#graphs.find(Object.hasTitleThis, title);
            if (meta) mom.#setSelectedGraph(meta);

            return (new View.Graphs.CoreSaver(mom, title, this.#makeSaveData))
                .save()
                .then(mom.#updateGraphs);
        }
    }

    static BlobSaver = class {
        #prevBlobs = {};
        #proms = [];
        #dictMeta = null;
        constructor(mom, graphId){
            this.graphId = graphId;
            this.mom = mom;
        }

        save(){
            this.#prevBlobs = {...this.mom.#blobs[this.graphId]};
            Graph.forEachNode(this.#pushPromSaveBlobForNode, this);
            return Promise.all(this.#proms).then(this.#cleanStored);
        }
        #cleanStored = ()=>{
            const dictMeta = this.#dictMeta;
            if (!dictMeta) return;

            const stored = this.mom.#stored;

            const orphans = this.#prevBlobs;
            for (const blobId in orphans) {
                delete dictMeta[blobId];
                stored.deleteBlob(blobId);
                Logger.info("Deleted blob:", orphans[blobId].title);
            }

            if (Object.keys(dictMeta).length < 1) {
                stored.deleteBlobMeta(this.graphId)
            }
            return stored.saveBlobMeta(this.graphId, dictMeta);
        }
        #pushPromSaveBlobForNode(node){
            if (!node.blob) return;

            if (this.#dictMeta && this.#dictMeta[node.blob]) {
                delete this.#prevBlobs[node.blob];
                return;
            }

            this.#proms.push(this.#saveBlobForNode(node));
        }
        #saveBlobForNode(node){
            return fetch(node.view.innerContent.firstChild.src)
                .then( (res)=>res.blob() )
                .then(this.saveNodeItsBlob.bind(this, node))
                .catch(Logger.err.bind(Logger, "Failed to save blob:"))
        }

        saveNodeItsBlob(node, blob){
            const mom = this.mom;
            const meta = mom.#makeMetaForBlobOfTitle(blob, node.getTitle());

            if (!this.#dictMeta) {
                this.#dictMeta = mom.#blobs[this.graphId] ||= {}
            }
            const blobs = this.#dictMeta;
            const blobId = node.blob = meta.blobId;
            blobs[blobId] = meta;

            const stored = mom.#stored;
            stored.saveBlobMeta(this.graphId, blobs);
            return stored.saveBlobData(blobId, blob);
        }
    }

    #clearGraph(){
        Graph.clear();
        ZetProposals.restoreDismissed([]);

        AiNode.count = 0;
        App.zetPanes.resetAllPanes();
    }

    #loadGraph(text, importer){
        this.#clearGraph();

        const div = Html.new.div();
        div.innerHTML = text.replaceAll(/src=\"blob:[^\"]*\"/g, 'src=""');

        // Check for the previous single-tab save object
        const zettelSaveElem = div.querySelector("#zettelkasten-save");
        if (zettelSaveElem) zettelSaveElem.remove();

        // Check for the new multi-pane save objects
        const zettelkastenPaneSaveElements = div.querySelectorAll("[id^='zettelkasten-pane-']");
        zettelkastenPaneSaveElements.forEach(Elem.remove);

        this.#saver.restoreAdditionalSaveObjects(div);

        // One bad card costs itself, not the graph. Both loops used to run unguarded, so
        // anything that threw for a single card -- markup saved without its `.window`
        // was the case that found this -- came out of the loop and abandoned every card
        // after it. A graph is the reader's work, and losing the rest of it to one
        // unreadable note is the worst available outcome. Counted rather than swallowed:
        // a quieter graph than the one that was saved has to say so.
        const skipped = [];
        const newNodes = [];
        for (const child of div.children) {
            try {
                const node = new Node(child);
                newNodes.push(node);
                Graph.addNode(node);
            } catch (err) {
                skipped.push(child.dataset?.viewId || '(unidentified)');
                Logger.err("Could not rebuild a saved card; skipping it:", err);
            }
        }

        Elem.forEachChild(div, this.#populateDirectionalityMap, this);

        for (const node of newNodes) {
            try {
                Graph.appendNode(node);
                node.init();
                this.#reconstructSavedNode(node, importer);
                node.sensor = new NodeSensor(node, 3);
            } catch (err) {
                skipped.push(node.uuid);
                Logger.err("Could not finish restoring card", node.uuid, "-", err);
            }
        }

        if (skipped.length > 0) {
            Logger.warn(skipped.length, "of", div.children.length,
                        "cards could not be restored:", skipped.join(', '));
        }

        if (zettelSaveElem) {
            const zettelContent = decodeURIComponent(zettelSaveElem.innerHTML);
            App.zetPanes.restorePane("Zettelkasten Save", zettelContent);
        }

        // A Pane whose text does not decode is skipped, and one whose Titles taken or Region do
        // not is restored without them: the rest of the Graph is not lost to it.
        const readOr = (value, fallback)=>{
            try { return (value ? JSON.parse(decodeURIComponent(value)) : fallback) }
            catch (err) { Logger.warn("Could not read part of a saved Pane:", err); return fallback }
        };
        zettelkastenPaneSaveElements.forEach((elem) => {
            let paneContent, paneName;
            try {
                paneContent = decodeURIComponent(elem.innerHTML);
                paneName = decodeURIComponent(elem.dataset.paneName);
            } catch (err) {
                return Logger.err("Could not read a saved Pane; skipping it:", err);
            }
            App.zetPanes.restorePane(paneName, paneContent, readOr(elem.dataset.taken, []), readOr(elem.dataset.region, null));
        });
        App.zetPanes.reportRenames();

        return this;
    }

    #populateDirectionalityMap(nodeElement){
        const edges = nodeElement.dataset.edges;
        if (!edges) return;

        JSON.parse(edges).forEach(Graph.setEdgeDirectionalityFromData, Graph);
    }

    #reconstructSavedNode(node, importer){
        if (node.isTextNode) TextNode.init(node);
        if (node.isLLM) AiNode.init(node, true); // restoreNewLines
        if (node.isLink) (new LinkNode).init(node);
        if (node.isFileTree) FileTreeNode.init(node);
        if (node.blob) {
            const prom = (!importer) ? this.#stored.blobForBlobId(node.blob)
                       : Promise.resolve(importer.blobForNode(node));
            prom.then(this.#applyBlobToNode.bind(this, node));
        }
    }
    #applyBlobToNode(node, blob){
        if (!blob) {
            return Logger.warn("Missing", node.blob, "in local storage.")
        }

        const img = node.view.innerContent.firstChild;
        URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(blob);
    }

    // Autosave is the only way a graph is written, so it can never decline to run: with
    // nothing selected it opens a save of its own instead of dropping the work.
    //
    // It used to have a second exit -- `if (!selected.title) return Promise.resolve()` --
    // for the window in which `#updateGraphs` blanked that title while it rebuilt the list
    // of saves. There is no list to rebuild any more, and that exit was a silent one: a
    // tick landing inside the window wrote nothing, and if the title was ever left blank
    // the graph stopped being saved for the rest of the session with nothing to show it.
    // A save that declines to run is the one thing this must never be, so both the
    // blanking and the exit are gone.
    #autosave = ()=>{
        const selected = this.#selectedGraph;
        const saved = (!selected) ? this.#saver.saveWithTitle(this.#titleForNewGraph())
                    : this.#saver.saveWithTitle(selected.title || this.#titleForNewGraph());
        // The note's "5 min ago" ages with the clock, and every tick is when it is looked at.
        return saved.finally(this.#updateSaveNote);
    }
    // #maxGraphId only ever climbs, so this cannot collide with a title already
    // in the list, and it stays readable in the way a timestamp would not.
    #titleForNewGraph(){ return "Graph " + (this.#maxGraphId + 1) }

    // The graph is on screen either way -- a second tab showing an empty canvas would read
    // as lost work -- but the record it came from belongs to the tab that holds the lock.
    // Dropping the selection is what makes this tab's first tick open its own record
    // instead of writing over that one.
    #forkIfNotWriter = ()=>{
        if (this.#isWriter) return;

        Logger.info("Another tab is saving this graph; this tab will keep its own copy.");
        this.#setSelectedGraph(null);
    }

    #autosaving = false;
    #startAutosave = ()=>{
        if (this.#autosaving) return;

        this.#autosaving = true;
        setInterval(this.#autosave, 8000);
        // Eight seconds is a long time to lose when a tab closes or an iPad
        // switches apps. Neither fires a reliable unload, but both go hidden.
        On.visibilitychange(document, this.#onVisibilityChanged);
    }
    #onVisibilityChanged = (e)=>{
        if (document.visibilityState === 'hidden') this.#autosave();
    }

    // Three states, and the one that used to hide the button is now the one that
    // matters most: a browser with no picker is exactly the browser whose only
    // copy of the graph is an evictable one, so it needs the download the most.
    #updateDiskFileButton = ()=>{
        this.#updateSaveNote();
        const btn = this.#btnDiskFile;
        if (!btn) return;

        const label = btn.querySelector('.menu-row-label') ?? btn;
        if (!DiskMirror.isSupported) {
            label.textContent = "Save to…";
            btn.title = (View.Graphs.isInstalled
                ? "Share this graph as a .neurite file: Save to Files puts it in iCloud Drive "
                  + "or on this device. Take another copy after more work."
                : "Download this graph as a .neurite file. "
                  + "This browser cannot keep writing to a file, so take "
                  + "another copy after more work.");
            return;
        }

        const isActive = this.#stored.disk.isActive;
        label.textContent = (isActive ? "Saving to file" : "Save to…");
        btn.title = (isActive
            ? "Every autosave also writes to the file you picked. Click to pick another."
            : "Also write every autosave to a file on this computer.");
    }
    // The line under Save to…, most urgent first. Nothing being saved at all outranks
    // everything; then a mirror that stopped; then the file's age, with the risk that makes
    // it matter where the browser has said its storage is not kept.
    #updateSaveNote = ()=>{
        const note = this.#saveNote;
        if (!note) return;

        const [text, isWarning] = this.#saveNoteText();
        if (note.textContent !== text) note.textContent = text;
        note.classList.toggle('is-warning', isWarning);
    }
    #saveNoteText(){
        if (this.#restoreFailed) {
            return ["The last graph did not reopen, and it is kept as it was: Save to… saves it "
                  + "to a file as it is, and a reload tries again.", true];
        }
        const stopped = this.#diskStopped;
        if (stopped?.reason === 'changed') {
            return [`${stopped.name} was changed on another device, so it was not written over. `
                  + "Save to… picks a file again.", true];
        }
        if (stopped?.reason === 'failed') {
            return ["The file could not be written. Save to… picks a file again.", true];
        }

        // The browser's own copy is the only one of what is not in a file, so that is when its
        // being cleared is worth a word. A download is only a download: the page cannot see it
        // finish, or be cancelled.
        const meta = this.#selectedGraph;
        const at = meta?.savedToFileAt;
        const mayClear = (this.#persisted === false);
        if (!at) {
            return mayClear ? ["Not saved to a file yet, and this browser may clear its own copy.", true]
                            : ["Not saved to a file yet.", false];
        }
        const how = {download: "Downloaded a copy", opened: "From a file saved"}[meta.savedToFileHow]
                 ?? "Saved to a file";
        const changed = meta.savedToFileSignature
            ? View.Graphs.contentSignature() !== meta.savedToFileSignature
            : (meta.revisions ?? 0) > (meta.savedToFileRevision ?? meta.revisions ?? 0);
        if (!changed) return [how + " " + View.Graphs.ago(at) + ".", false];
        return [how + " " + View.Graphs.ago(at) + ", and changed since."
              + (mayClear ? " This browser may clear its own copy of the changes." : ""), mayClear];
    }
    // What a Graph holds, apart from where it is viewed from: the Panes' text, which carries the
    // notes' words, and each Node's Title and place on the Plane. The saved markup cannot say
    // whether a Graph changed since its file -- every pan rewrites the screen positions it
    // carries -- and neither can a card's text, which its link strip redraws a frame after a
    // load: both called a Graph just opened from a file "changed since" (rv15).
    static contentSignature(){
        const parts = (window.zetPaneList ?? []).map( (pane)=>pane.cm.getValue() );
        const nodes = [];
        Graph.forEachNode( (n)=>nodes.push([n.uuid, n.getTitle?.(), n.pos?.x?.toFixed(6),
                                            n.pos?.y?.toFixed(6)].join('|')) );
        parts.push(...nodes.sort());

        let hash = 0x811c9dc5; // FNV-1a
        for (const part of parts) {
            for (let i = 0; i < part.length; i++) hash = Math.imul(hash ^ part.charCodeAt(i), 0x01000193) >>> 0;
            hash = Math.imul(hash ^ 10, 0x01000193) >>> 0;
        }
        return hash.toString(16) + ':' + parts.length;
    }
    // "just now", "5 min ago", "3 h ago", then the date.
    static ago(t, now = Date.now()){
        const min = Math.floor((now - t) / 60000);
        if (min < 1) return "just now";
        if (min < 60) return min + " min ago";
        if (min < 24 * 60) return Math.floor(min / 60) + " h ago";
        return "on " + new Date(t).toLocaleDateString();
    }
    // Installed to the Home Screen, or run as an app anywhere else. `navigator.standalone` is
    // Safari's alone, and `(display-mode: standalone)` misses the other app modes, so the
    // question asked is whether this is a browser tab.
    static get isInstalled(){
        return globalThis.matchMedia?.('(display-mode: browser)').matches === false
    }
    #onDiskStopped = (why)=>{
        this.#diskStopped = why;
        this.#updateDiskFileButton();
        // Said once and out loud: every save from here on stays in this browser only, and a
        // line in a closed menu is not where a reader is looking.
        if (why.reason === 'changed') {
            alert(`${why.name} was changed on another device since this browser last saved to it, `
                + "so it was not written over. Open it to carry on from that copy, or use "
                + "Save to… to pick a file for the graph on screen.");
        }
    }

    #onBtnDiskFileClicked = (e)=>{
        if (!DiskMirror.isSupported) return this.#downloadCopy();

        this.#stored.disk.pick(this.#suggestedFileName(), this.#selectedGraph?.uuid)
            .then(this.#afterDiskFilePicked);
    }
    // The same name the download fallback writes, so the two paths agree. A graph with
    // nothing selected has no title yet, and `#fileNameForMeta` would answer for a save
    // that does not exist.
    #suggestedFileName(){
        const meta = this.#selectedGraph;
        return (meta ? this.#fileNameForMeta(meta) : 'neurite-graph.neurite');
    }
    // The bundle is built from what is in the store, not from the screen, so the graph has
    // to be banked first or the copy is up to eight seconds stale -- and the bank has to be
    // one that cannot be skipped. `saveMetaAndData` returns early when the data matches the
    // last write, which is right for a timer and wrong here: it is the difference between
    // "nothing changed" and "nothing was written", and a file is the only copy there is.
    //
    // After a restore that failed there is nothing on screen to bank: the file is the Graph that
    // did not reopen, as the store holds it, which is the way to take it somewhere else.
    #downloadCopy(){
        if (this.#restoreFailed) return this.#askNameThenDownload();

        this.#stored.forgetLastWritten();
        return this.#autosave().then(this.#askNameThenDownload)
    }
    // A picker asks for the name itself. A download does not: it drops the file in
    // whichever folder the browser uses, under whatever name the page chose, and the page
    // chose `Graph 4`. That was tolerable while a list let the reader rename a graph before
    // saving it; with the file being the only copy there is, the name is the only thing
    // that tells two graphs apart, so this asks. Prefilled, so keeping it is one keypress.
    #askNameThenDownload = ()=>{
        const meta = this.#selectedGraph;
        if (!meta) return Logger.warn("No graph to save yet");

        return window.prompt("Save this graph as:", this.#suggestedSaveName(meta), 'Save Graph')
            .then(this.#downloadAs)
    }
    // `Graph.neurite`, not `Graph 4.neurite`. That number is `#maxGraphId`'s, and it exists
    // to keep records apart inside the browser -- it tells a reader nothing about the graph
    // and arrives in the prompt as text to delete before typing a real name. Worse after an
    // import, where `#freeTitle` had already made it `Graph 2 (2)` and the sanitiser turned
    // the brackets into `Graph 2 _2_`.
    //
    // A name the reader has typed comes back verbatim, which is the whole reason the title
    // is kept: saving the same graph twice should offer what it is called, not start over.
    #suggestedSaveName(meta){
        return (View.Graphs.isAutoTitle(meta.title)
                ? 'Graph.neurite'
                : this.#fileNameForMeta(meta));
    }
    // Every title this file generates without asking: `#titleForNewGraph`'s `Graph <n>`,
    // the `Graph <n> (<m>)` an import falls back to, and the blank `#updateGraphs` leaves
    // on the selected record while it rebuilds.
    static isAutoTitle(title){
        return /^(?:Graph \d+(?: \(\d+\))?)?$/.test(String(title ?? '').trim())
    }
    #downloadAs = (name)=>{
        if (name === null) return Logger.info("Save cancelled");

        // The check that would have caught this bug instead of shipping it in a file. The
        // bytes come out of the store, the screen is what the reader believes they are
        // saving, and the two disagreeing is silent in every other direction: a 6 KB file
        // full of settings and no notes looks like a save that worked.
        if (Object.keys(Graph.nodes).length > 0) {
            return this.#stored.dataForMeta(this.#selectedGraph)
                .then(this.#downloadIfDataHoldsTheNodes.bind(this, name))
        }
        return this.#writeFile(name);
    }
    #downloadIfDataHoldsTheNodes = (name, data)=>{
        if (String(data || '').includes('data-node_json')) return this.#writeFile(name);

        Logger.err("Refusing to save an empty file: the store holds no nodes for",
                   this.#selectedGraph?.graphId);
        alert("This graph could not be saved: what is on screen has not been recorded "
            + "yet. Nothing was written. Please try again in a moment.");
    }
    #writeFile = (name)=>{
        // The name is also the graph's title from here on, so the next save offers what
        // the reader typed rather than reverting to `Graph 4`.
        const meta = this.#selectedGraph;
        const filename = this.#fileNameForName(name) || this.#fileNameForMeta(meta);
        meta.title = filename.replace(/\.neurite$/i, '');
        this.#stored.saveMeta(meta);

        return (new GraphExporter(meta, this.#stored)).export()
            .then(this.#deliver.bind(this, filename))
            .then(this.#afterDownload, this.#onDownloadFailed);
    }
    // Installed, the file goes through the share sheet, whose Save to Files puts it in iCloud
    // Drive or on the device (#59). A download there leaves the installed app for a browser
    // view it cannot come back from (WebKit bugs 236943, 290847). In a browser tab it stays a
    // download. Settles on the name, or null when the reader closed the sheet.
    #deliver(filename, blob){
        const file = new File([blob], filename, {type: 'application/octet-stream'});
        if (!View.Graphs.isInstalled || !navigator.canShare?.({files: [file]})) {
            return {name: DiskMirror.download(filename, blob), how: 'download'};
        }
        return this.#share(file).catch(this.#onShareRefused.bind(this, file));
    }
    // A share that resolves is one the reader finished: Save to Files, or wherever it went.
    #share(file){ return navigator.share({files: [file]}).then( ()=>({name: file.name, how: 'file'}) ) }
    // The sheet opens only while the click that asked for it is recent, and building a bundle
    // with media in it can outlast that. A second click, on the question, is a fresh one.
    async #onShareRefused(file, err){
        if (err?.name === 'AbortError') return null;
        if (err?.name !== 'NotAllowedError') throw err;

        if (!await window.confirm(`${file.name} is ready. Share it now?`)) return null;
        return this.#share(file).catch( (e)=> (e?.name === 'AbortError' ? null : Promise.reject(e)) );
    }
    // A save's title is whatever the user typed in the list, so it reaches here
    // with spaces, slashes and anything else a file name cannot hold. The pass is
    // an allowlist of letters and digits in any script rather than of `\w`, which
    // is ASCII: a graph titled in Chinese would otherwise download as `___`.
    #fileNameForMeta(meta){
        return this.#fileNameForName(meta.title) || 'Graph.neurite'
    }
    // Shared with the prompt, because a name a reader types is exactly as capable of
    // holding a slash as a title they typed into the old list was.
    #fileNameForName(name){
        const clean = String(name || '')
            .replace(/\.neurite$/i, '')
            .replace(/[^\p{L}\p{N} .\-_]+/gu, '_')
            .trim();
        return (clean ? clean + '.neurite' : '');
    }
    #afterDownload = (delivered)=>{
        if (!delivered) return Logger.info("Save cancelled");

        Logger.info("Saved to a file:", delivered.name, "by", delivered.how);
        const meta = this.#selectedGraph;
        if (meta) this.#stored.markSavedToFile(meta, delivered.how).then(this.#updateSaveNote);
    }
    // Silence is the one thing this cannot do: the user clicked Save because they
    // want the graph outside the browser, and a log line is not where they are
    // looking. `alert` is what the app already uses when it must be sure a message
    // arrives.
    #onDownloadFailed = (err)=>{
        Logger.err("Failed to build the file:", err);
        alert("Could not build the file for this graph.");
    }

    #onBtnOpenFileClicked = (e)=>{ this.#inputOpenFile?.click() }
    #onOpenFileInputChanged = (e)=>{
        const input = e.target;
        const file = input.files[0];
        // Picking the same file twice would not fire `change` a second time, and
        // reopening the file you just opened is a normal thing to want.
        input.value = '';
        if (!file) return;

        this.#bankScreen().then(this.#import.bind(this, file));
    }
    #afterDiskFilePicked = (isPicked)=>{
        this.#updateDiskFileButton();
        if (!isPicked) return;

        // After a restore that failed, the file gets the stored Graph as it is, once: the screen
        // holds nothing to write, and the timer that would write it is off.
        const meta = this.#selectedGraph;
        if (this.#restoreFailed && meta) {
            return (new GraphExporter(meta, this.#stored)).export()
                .then( (blob)=>this.#stored.disk.write(blob) )
                .then( (written)=>written && this.#stored.markSavedToFile(meta, 'file') )
                .then(this.#updateSaveNote);
        }

        // The graph is already in the store, so the next autosave would find
        // nothing changed and skip -- leaving the new file empty. Fill it now.
        this.#stored.forgetLastWritten();
        return this.#autosave();
    }

    // Held, never released. Releasing it would hand the record to a second tab while
    // this one is still writing. `ifAvailable` is what makes the answer immediate: without
    // it the request queues and a second tab waits forever instead of forking.
    #claimWriterLock(){
        const locks = navigator.locks;
        if (!locks?.request) return Promise.resolve();

        return new Promise( (decided)=>{
            locks.request('neurite-autosave', {ifAvailable: true}, (lock)=>{
                this.#isWriter = Boolean(lock);
                decided();
                return (lock ? new Promise(Function.nop) : undefined);
            }).catch(this.#onLockUnavailable.bind(this, decided));
        });
    }
    // A lock that cannot be asked for is not a reason to stop saving: fall back to the
    // old behaviour, which is one writer by assumption rather than by proof.
    #onLockUnavailable = (decided, err)=>{
        Logger.warn("Could not claim the autosave lock:", err);
        decided();
    }

    init(){
        On.click(this.#btnClear, this.#onBtnClearClicked);
        On.click(this.#btnDiskFile, this.#onBtnDiskFileClicked);
        On.click(this.#btnOpenFile, this.#onBtnOpenFileClicked);
        On.change(this.#inputOpenFile, this.#onOpenFileInputChanged);
        On.click(Elem.byId('resetSettings'), this.#onBtnResetSettingsClicked);
        On.click(Elem.byId('clearLocalStorage'), this.#onBtnClearLocalClicked);

        this.#stored.disk.onStopped = this.#onDiskStopped;
        this.#stored.signatureOf = View.Graphs.contentSignature;
        this.#stored.disk.useState(this.#state)
            .then(this.#updateDiskFileButton);
        navigator.storage?.persisted?.()
            .then( (kept)=>{ this.#persisted = kept; this.#updateSaveNote() } )
            .catch(Function.nop);

        for (const htmlnode of Graph.htmlNodes.children) {
            const node = new Node(htmlnode);
            Graph.addNode(node);
            node.init();
        }

        const stored = this.#stored;
        this.#whenRestored = this.#claimWriterLock()
            .then(stored.forEachMetaAndGraphId.bind(stored, this.#processMeta))
            .then(stored.forEachBlobMetaAndGraphId
                    .bind(stored, this.#processBlobMeta))
            .then(this.#loadState.bind(this))
            .then(()=>true, this.#onRestoreFailed);
        return this.#whenRestored;
    }
    // Autosave never starts when the restore fails, on purpose: the record the page
    // selected is still the reader's, and the empty canvas must not be written over it.
    // This used to surface only as an unhandled rejection.
    #onRestoreFailed = (err)=>{
        Logger.err("Could not restore the last graph; autosave is off for this session:", err);
        // And on screen, where it used to be only in the console (#59): the canvas looks
        // like a new graph, and nothing typed into it is being kept.
        this.#restoreFailed = true;
        this.#updateSaveNote();
        return false;
    }
    #processMeta = (meta, graphId)=>{
        if (meta.graphId !== graphId){
            meta.graphId = graphId;
            this.#stored.saveMeta(meta);
        }
        this.#graphs.push(meta);

        const num = parseInt(graphId) || 0;
        if (num > this.#maxGraphId) this.#maxGraphId = num;
    }
    #processBlobMeta = (dictMeta, graphId)=>{
        const meta = this.#metaByGraphId(graphId);
        if (!meta) return Logger.warn("Orphan blobs", dictMeta);

        this.#blobs[graphId] = dictMeta;
        for (const blobId in dictMeta) {
            const num = parseInt(blobId) || 0;
            if (num > this.#maxBlobId) this.#maxBlobId = num;
        }
    }
    #loadState(){
        const urlParams = new URLSearchParams(window.location.search);
        const stateFromURL = urlParams.get('state');

        const classLoader = (stateFromURL) ? View.Graphs.FileStateLoader
                          : View.Graphs.LocalStorageStateLoader;
        // The timer starts only once the previous session is back on screen,
        // or the first tick would open a new save before the old one loads.
        return (new classLoader(this)).load(stateFromURL)
            .then(this.#updateGraphs)
            .then(this.#forkIfNotWriter)
            .then(this.#startAutosave);
    }

    static FileStateLoader = class {
        constructor(mom){ this.mom = mom }
        load(stateFromURL){ // in the /wiki/pages directory
            return fetch(`wiki/pages/neurite-wikis/${stateFromURL}.txt`)
                .then(this.#extractTextFromResponse)
                .then(this.#handleResponseText)
                .catch(this.#onResponseError)
        }

        #extractTextFromResponse = (res)=>{
            if (res.ok) return res.text();

            throw new Error("Network response was not ok " + res.statusText);
        }
        #handleResponseText = (text)=>{
            this.mom.#setSelectedGraph(null).#loadGraph(text)
        }
        #onResponseError = (err)=>{
            Logger.err("Failed to load state from file:", err);
            // `displayErrorMessage` stood here and is defined nowhere in the app, so
            // this handler threw a ReferenceError of its own and buried the failure
            // it was written to report.
            alert("Failed to load the requested graph state.");
        }
    }

    static LocalStorageStateLoader = class {
        constructor(mom){ this.mom = mom }
        load(){
            return this.mom.#state.load('latest-selected')
                .then(this.#handleLatestSelected)
        }

        #handleLatestSelected = (graphId)=>{
            const mom = this.mom;
            const meta = mom.#metaByGraphId(graphId);
            if (!meta) return;

            mom.#setSelectedGraph(meta);
            return mom.#stored.dataForMeta(meta).then(mom.#loadGraph.bind(mom));
        }
    }
}
