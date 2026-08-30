Blob.forJson = function(json){
    return new Blob([json], {type: 'application/json'})
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

    get isActive(){ return this.#handle !== null }

    useState(state){
        this.#state = state;
        if (!DiskMirror.isSupported) return Promise.resolve(false);

        return state.load('disk-file-handle').then(this.#adoptStored);
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
    pick(suggestedName = 'neurite-graph.neurite'){ // only from within a user gesture
        return window.showSaveFilePicker({
            suggestedName,
            types: [{
                description: "Neurite graph",
                accept: {'application/octet-stream': ['.neurite', '.txt']}
            }]
        }).then(this.#adoptPicked, this.#onPickFailed)
    }
    #adoptPicked = (handle)=>{
        this.#handle = handle;
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
        return this.#state?.delete('disk-file-handle');
    }

    write(blob){
        const handle = this.#handle;
        if (!handle) return Promise.resolve();

        // Autosave runs on a timer, so a slow disk must not leave two writes
        // holding the same file open. Queue them behind each other instead.
        this.#writing = Promise.resolve(this.#writing)
            .then(this.#writeThrough.bind(this, handle, blob))
            .catch(this.#onWriteFailed);
        return this.#writing;
    }
    #writeThrough(handle, blob){
        return handle.createWritable()
            .then( (stream)=>stream.write(blob).then(stream.close.bind(stream)) )
    }
    #onWriteFailed = (err)=>{
        // Keeping the handle would mean repeating the same failure every eight
        // seconds. Drop it, say so once, and let the button reconnect.
        Logger.err("Failed to mirror the save to disk:", err);
        this.#handle = null;
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
        if (!this.disk.isActive) return;

        // Mirror the same bundle the drop-to-import path reads, so the file on
        // disk is a whole graph -- images and media included -- rather than
        // markup that points at blobs left behind in IndexedDB.
        return (new GraphExporter(meta, this)).export().then(this.#writeToDisk);
    }
    #writeToDisk = (blob)=>this.disk.write(blob);
}

class GraphExporter {
    #out = {
        data: '',
        blobMeta: {},
        offsets: {}
    };
    constructor(meta, stored){
        this.meta = meta;
        this.stored = stored;
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
    #handleBuffer = (buffer)=>{
        this.#buffer = buffer;
        let i = 0;

        const dv = new DataView(buffer);
        const len = dv.byteLength;
        while (i < len && dv.getInt8(i += 1));

        this.#base = i + 1;
        return Blob.forJson(buffer.slice(0, i)).text();
    }
    #handleJson = (json)=>{
        let input = '';
        try {
            input = JSON.parse(json)
        } catch(err) {
            return Promise.resolve()
        }

        this.#blobMeta = input.blobMeta;
        this.data = input.data;
        this.#offsets = input.offsets;
    }
}

View.Graphs = class {
    #btnClear = Elem.byId('clear-button');
    #btnDiskFile = Elem.byId('disk-file-button');
    #btnOpenFile = Elem.byId('open-file-button');
    #btnSaveGraph = Elem.byId('save-graph-button');
    #dropArea = Elem.byId('saved-networks-container');
    // A page cannot open a file dialog on its own either. Dropping a file on the
    // list has always worked, but nothing on screen said so, and a gesture is no
    // use to a keyboard or a phone: this is the same import behind a button.
    #inputOpenFile = Elem.byId('open-file-input');

    #blobs = {};
    #graphs = [];
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

    #updateGraphs = ()=>{
        this.#blobs = {};
        this.#graphs = [];
        if (this.#selectedGraph) this.#selectedGraph.title = ''; // for autosave
        this.#dropArea.innerHTML = '';
        return this.#stored.forEachMetaAndGraphId(this.#appendMeta);
    }
    #appendMeta = (meta, graphId)=>{
        this.#graphs.push(meta);
        const isSelected = (graphId === this.#selectedGraph?.graphId);
        if (isSelected) this.#selectedGraph = meta;
        const viewMeta = new View.Graphs.MetaView(this, meta, isSelected);
        this.#dropArea.appendChild(viewMeta.div);
        viewMeta.updateForBlob();
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
            title
        };
    }

    #metaByGraphId(graphId){
        return this.#graphs.find(this.#hasGraphIdThis, graphId || '')
    }
    #hasGraphIdThis(obj){ return obj.graphId === this.valueOf() }

    static MetaView = class {
        constructor(mom, meta, isSelected){
            this.meta = meta;
            this.mom = mom;
            this.div = this.#makeDiv(meta, isSelected);
        }

        #makeDiv(meta, isSelected){
            const inputTitle = this.#makeTitleInput(meta.title);
            const btnLoad = this.#makeLinkButton("Load");
            const btnDelete = this.#makeLinkButton("X");

            On.change(inputTitle, this.#onTitleInputChanged);
            On.click(btnLoad, this.#onBtnLoadClicked);
            On.click(btnDelete, this.#onBtnDeleteClicked);

            const div = Html.new.div();
            if (isSelected) div.classList.add("selected-save");
            div.append(inputTitle, btnLoad, btnDelete);
            div.title = "added on: " + meta.added + "\n"
                    + "revisions: " + meta.revisions + "\n"
                    + "last: " + meta.lastUpdated + "\n"
                    + "└ size: " + meta.size + " bytes";
            return div;
        }
        #makeLinkButton(text){
            return Html.make.button('linkbuttons', text)
        }
        #makeTitleInput(title){
            const input = Html.new.input();
            input.style.border = 'none';
            input.style.width = '100px';
            input.type = "text";
            input.value = title;
            return input;
        }

        #onTitleInputChanged = (e)=>{
            this.meta.title = e.target.value;
            this.mom.#stored.saveMeta(this.meta);
        }
        #onBtnLoadClicked = (e)=>{
            if (this.meta.size > 0) return this.#proceedWithLoad();

            const msg = "Are you sure you want an empty save?";
            window.confirm(msg).then(this.#handleConfirmEmptySave);
        }
        #handleConfirmEmptySave = (confirmed)=>{
            if (confirmed) this.#proceedWithLoad()
        }
        #proceedWithLoad(){
            // Wait for the autosave to finish reading the screen. It scrapes the
            // live DOM one microtask later, so loading straight away would hand
            // the incoming graph to the outgoing graph's save.
            return this.mom.#autosave().then(this.#loadSelf);
        }
        #loadSelf = ()=>{
            return this.mom.#stored.dataForMeta(this.meta).then(this.#loadData)
        }
        #loadData = (data)=>{
            this.mom.#setSelectedGraph(this.meta)
                .#loadGraph(data)
                .#updateGraphs()
        }

        // The only irreversible control in the panel, and until now the only one that
        // asked nothing: it dropped the graph, its blobs and its meta on one click, while
        // Clear -- which deletes nothing at all -- asked Yes or No first. The graph is
        // named in the question, because a list of saves is a list of near-identical rows
        // and "are you sure" is not an answer to "which one".
        #onBtnDeleteClicked = (e)=>{
            const title = this.meta.title || "this graph";
            const msg = 'Delete "' + title + '"? This is the only copy in the browser, '
                      + 'and it cannot be undone.';
            window.confirm(msg).then(this.#handleConfirmDelete);
        }
        #handleConfirmDelete = (confirmed)=>{
            if (!confirmed) return;

            const meta = this.meta;
            const mom = this.mom;
            const graphIndex = mom.#graphs.findIndex(Object.isThis, meta);
            mom.#graphs.splice(graphIndex, 1);
            const isSelected = (meta === mom.#selectedGraph);
            if (isSelected) mom.#state.delete('latest-selected');
            mom.#stored.deleteForMeta(meta).then(mom.#updateGraphs);
        }

        updateForBlob(){
            this.mom.#stored.blobMetaForGraphId(this.meta.graphId)
                .then(this.#handleBlobMeta)
        }
        #handleBlobMeta = (dictMeta)=>{
            if (!dictMeta) return;

            this.mom.#blobs[this.meta.graphId] = dictMeta;
            let counter = 0
            let size = 0;
            for (const blobId in dictMeta) {
                counter += 1;
                size += dictMeta[blobId].size;
            }
            this.div.title += "\nassets: " + counter + "\n"
                            + "└ size: " + size + " bytes";
        }
    }

    #addDragEvents(){
        const dropArea = this.#dropArea;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach( (eName)=>{
            On[eName](dropArea, (e)=>{
                e.preventDefault();
                e.stopPropagation();
            })
        });

        ['dragenter', 'dragover']
            .forEach( (eName)=>On[eName](dropArea, this.#highlight) );

        ['dragleave', 'drop']
            .forEach( (eName)=>On[eName](dropArea, this.#unhighlight) );

        On.drop(dropArea, this.#onSavedGraphsDrop);
    }
    #highlight(e){ e.currentTarget.classList.add('highlight') }
    #unhighlight(e){ e.currentTarget.classList.remove('highlight') }

    #onSavedGraphsDrop = (e)=>{
        const file = e.dataTransfer.files[0];
        if (!file) return Logger.info("Missing file");

        this.#autosave().then(this.#import.bind(this, file));
    }
    #import(file){
        const importer = new GraphImporter();
        const afterImport = this.#afterImport.bind(this, importer, file);
        importer.import(file).then(afterImport);
    }
    #afterImport(importer, file){
        const name = file.name;
        const index = name.lastIndexOf('.');
        const title = (index > -1 ? name.slice(0, index) : name);

        if (!importer.data) {
            const reader = new FileReader();
            On.load(reader, this.#onFileLoaded.bind(this, title));
            return reader.readAsText(file);
        }

        this.#loadAndSave(importer, title).then(this.#updateGraphs);
    }
    #loadAndSave(importer, title){
        const meta = this.#makeMetaForTitle(title);
        this.#graphs.push(meta);

        const blobSaver = new View.Graphs.BlobSaver(this, meta.graphId);
        importer.saveNodeItsBlob = blobSaver.saveNodeItsBlob.bind(blobSaver);

        this.#setSelectedGraph(meta).#loadGraph(importer.data, importer);
        return this.#stored.saveMetaAndData(meta, importer.finalData);
    }
    async #onFileLoaded(title, e) {
        const content = e.target.result;

        try {
            this.#saver.addSave('dropped', title, content)
                .then(this.#updateGraphs)
        } catch (err) {
            const loadAnyway = await window.confirm(
                "The file is too large to store. Would you like to load it anyway?"
            );
            if (!loadAnyway) return;
            this.#setSelectedGraph(null).#loadGraph(content);
        }
    }

    // Fork: keep the graph as it is now under a new title, and carry on in the
    // copy. Banking first is what makes the two identical at the moment of the
    // click -- without it the entry left behind is up to eight seconds older than
    // the one carried on in, which is not a fork of anything the reader saw.
    //
    // Nothing selected is the one case this must not fork. `#autosave` opens a
    // save of its own rather than dropping the work, so the bank below *is* the
    // new save, and forking after it would leave two identical entries from one
    // click.
    #onBtnSaveGraphClicked = (e)=>{
        const isSaved = Boolean(this.#selectedGraph);
        const prom = this.#autosave();
        if (isSaved) prom.then(this.#forkGraph);
    }
    // `saveWithTitle` selects the new save and rebuilds the list on its own, and
    // the title is the same one autosave uses for a graph that has none: taken
    // from `#maxGraphId`, which only ever climbs, so it cannot name a save that
    // is already in the list.
    #forkGraph = ()=>{
        return this.#saver.saveWithTitle(this.#titleForNewGraph())
    }

    // The question is asked through the app's modal rather than by growing a
    // Yes/No pair beside the row: as a row of the menu this has no room to put
    // one, and every other question this file asks -- an empty save, a file too
    // large to store -- is already a `window.confirm`.
    #onBtnClearClicked = (e)=>{
        const msg = "Start an empty graph? This one is saved first, "
                  + "so you can load it again from the Saves panel.";
        window.confirm(msg).then(this.#handleConfirmClear);
    }
    #handleConfirmClear = (confirmed)=>{
        if (!confirmed) return;

        // Bank what is on screen before wiping it, then leave nothing selected:
        // the next autosave tick opens a fresh save rather than overwriting the
        // one just banked.
        this.#autosave().then(this.#startNewGraph);
    }
    #startNewGraph = ()=>{
        this.#setSelectedGraph(null).#clearGraph();
        App.zetPanes.addPane();
        return this.#updateGraphs();
    }

    #onBtnResetSettingsClicked(e){
        settings.clear();
        settings.init();
        editTab.init();
    }
    #onBtnClearLocalClicked = (e)=>{
        localStorage.clear();
        Stored.drop('Neurite');
        Stored.drop('state');
        this.#stored.drop()
            .then(this.#updateGraphs)
            .then(alert.bind(null, "Local storage has been cleared."));
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

            // Combine both slider values and saved views in one string
            return savedInputValues + savedViewsElement + mandelbrotSaveElement + fractalTypeSaveElement;
        }
        restoreAdditionalSaveObjects(d){
            const savedViewsElement = d.querySelector("#saved-views");
            if (savedViewsElement) {
                let savedViewsContent = decodeURIComponent(savedViewsElement.innerHTML);
                savedViews = JSON.parse(savedViewsContent);
                if (savedViews) {
                    updateSavedViewsCache();
                    displaySavedCoordinates();
                }
                savedViewsElement.remove();
            }

            const sliderValuesElement = d.querySelector("#saved-input-values");
            if (sliderValuesElement) {
                const sliderValuesContent = decodeURIComponent(sliderValuesElement.innerHTML);
                localStorage.setItem('inputValues', sliderValuesContent);
                sliderValuesElement.remove();
            }

            restoreInputValues();

            const mandelbrotSaveElement = d.querySelector("#mandelbrot-coords-params");
            if (mandelbrotSaveElement) {
                const mandelbrotParams = JSON.parse(decodeURIComponent(mandelbrotSaveElement.textContent));
                const pan = mandelbrotParams.pan.split('+i');
                Animation.goToCoords(mandelbrotParams.zoom, pan[0], pan[1]); // Direct function call using parsed params
                mandelbrotSaveElement.remove();
            }

            const fractalTypeSaveElement = d.querySelector("#fractal-type");
            if (fractalTypeSaveElement) {
                const fractalSelectElement = Elem.byId('fractal-select');
                const fractalType = JSON.parse(decodeURIComponent(fractalTypeSaveElement.textContent));
                if (fractalType) {
                    fractalSelectElement.value = fractalType;
                    Select.updateSelectedOption(fractalSelectElement);
                    Fractal.updateJuliaDisplay(fractalType);
                }
                fractalTypeSaveElement.remove();
            }
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
                const paneSaveElement = `<div id="zettelkasten-pane-${index}" data-pane-name="${encodeURIComponent(name)}" style="display:none;">${encodeURIComponent(content)}</div>`;
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

        const newNodes = [];
        for (const child of div.children) {
            const node = new Node(child);
            newNodes.push(node);
            Graph.addNode(node);
        }

        Elem.forEachChild(div, this.#populateDirectionalityMap, this);

        for (const node of newNodes) {
            Graph.appendNode(node);
            node.init();
            this.#reconstructSavedNode(node, importer);
            node.sensor = new NodeSensor(node, 3);
        }

        if (zettelSaveElem) {
            const zettelContent = decodeURIComponent(zettelSaveElem.innerHTML);
            App.zetPanes.restorePane("Zettelkasten Save", zettelContent);
        }

        zettelkastenPaneSaveElements.forEach((elem) => {
            const paneContent = decodeURIComponent(elem.innerHTML);
            const paneName = decodeURIComponent(elem.dataset.paneName);
            App.zetPanes.restorePane(paneName, paneContent);
        });

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

    // Autosave is the only way a graph is written, so it can never decline to
    // run: with nothing selected it opens a save of its own instead of dropping
    // the work. The one case it does skip is a blank title, which #updateGraphs
    // sets while it rebuilds the list -- that is a save in progress, not an
    // unsaved graph.
    #autosave = ()=>{
        const selected = this.#selectedGraph;
        if (!selected) return this.#saver.saveWithTitle(this.#titleForNewGraph());
        if (!selected.title) return Promise.resolve();

        return this.#saver.saveWithTitle(selected.title);
    }
    // #maxGraphId only ever climbs, so this cannot collide with a title already
    // in the list, and it stays readable in the way a timestamp would not.
    #titleForNewGraph(){ return "Graph " + (this.#maxGraphId + 1) }

    #startAutosave = ()=>{
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
        const btn = this.#btnDiskFile;
        if (!btn) return;

        const label = btn.querySelector('.menu-row-label') ?? btn;
        if (!DiskMirror.isSupported) {
            label.textContent = "Save to…";
            btn.title = "Download this graph as a .neurite file. "
                      + "This browser cannot keep writing to a file, so take "
                      + "another copy after more work.";
            return;
        }

        const isActive = this.#stored.disk.isActive;
        label.textContent = (isActive ? "Saving to file" : "Save to…");
        btn.title = (isActive
            ? "Every autosave also writes to the file you picked. Click to pick another."
            : "Also write every autosave to a file on this computer.");
    }
    #onBtnDiskFileClicked = (e)=>{
        if (!DiskMirror.isSupported) return this.#downloadCopy();

        this.#stored.disk.pick(this.#suggestedFileName())
            .then(this.#afterDiskFilePicked);
    }
    // The same name the download fallback writes, so the two paths agree. A graph with
    // nothing selected has no title yet, and `#fileNameForMeta` would answer for a save
    // that does not exist.
    #suggestedFileName(){
        const meta = this.#selectedGraph;
        return (meta ? this.#fileNameForMeta(meta) : 'neurite-graph.neurite');
    }
    // The bundle is built from what is in the store, not from the screen, so the
    // graph has to be banked first or the copy is up to eight seconds stale.
    #downloadCopy(){
        return this.#autosave().then(this.#downloadSelectedGraph)
    }
    #downloadSelectedGraph = ()=>{
        const meta = this.#selectedGraph;
        if (!meta) return Logger.warn("No graph to save yet");

        return (new GraphExporter(meta, this.#stored)).export()
            .then(DiskMirror.download.bind(DiskMirror, this.#fileNameForMeta(meta)))
            .then(this.#afterDownload, this.#onDownloadFailed);
    }
    // A save's title is whatever the user typed in the list, so it reaches here
    // with spaces, slashes and anything else a file name cannot hold. The pass is
    // an allowlist of letters and digits in any script rather than of `\w`, which
    // is ASCII: a graph titled in Chinese would otherwise download as `___`.
    #fileNameForMeta(meta){
        const title = String(meta.title || '').replace(/[^\p{L}\p{N} .\-_]+/gu, '_').trim();
        return (title || 'neurite-graph') + '.neurite';
    }
    #afterDownload = (filename)=>{ Logger.info("Downloaded", filename) }
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

        this.#autosave().then(this.#import.bind(this, file));
    }
    #afterDiskFilePicked = (isPicked)=>{
        this.#updateDiskFileButton();
        if (!isPicked) return;

        // The graph is already in the store, so the next autosave would find
        // nothing changed and skip -- leaving the new file empty. Fill it now.
        this.#stored.forgetLastWritten();
        return this.#autosave();
    }

    init(){
        this.#addDragEvents();

        On.click(this.#btnClear, this.#onBtnClearClicked);
        On.click(this.#btnDiskFile, this.#onBtnDiskFileClicked);
        On.click(this.#btnSaveGraph, this.#onBtnSaveGraphClicked);
        On.click(this.#btnOpenFile, this.#onBtnOpenFileClicked);
        On.change(this.#inputOpenFile, this.#onOpenFileInputChanged);
        On.click(Elem.byId('resetSettings'), this.#onBtnResetSettingsClicked);
        On.click(Elem.byId('clearLocalStorage'), this.#onBtnClearLocalClicked);

        this.#stored.disk.useState(this.#state)
            .then(this.#updateDiskFileButton);

        for (const htmlnode of Graph.htmlNodes.children) {
            const node = new Node(htmlnode);
            Graph.addNode(node);
            node.init();
        }

        const stored = this.#stored;
        return stored.forEachMetaAndGraphId(this.#processMeta)
            .then(stored.forEachBlobMetaAndGraphId
                    .bind(stored, this.#processBlobMeta))
            .then(this.#loadState.bind(this));
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
            .then(this.#startAutosave);
    }

    static FileStateLoader = class {
        constructor(mom){ this.mom = mom }
        load(stateFromURL){ // in the /wiki/pages directory
            return fetch(`/wiki/pages/neurite-wikis/${stateFromURL}.txt`)
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
