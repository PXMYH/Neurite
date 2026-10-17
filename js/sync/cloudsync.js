// Cloud sync (docs/cloud-sync.md): every Graph worked on, kept as a `.neurite` file in Neurite's
// folder in Google Drive, so another device can open it from Settings → Sync.
//
// The Graph's home stays this browser's IndexedDB, as Notion's stays its local database; Drive is
// the copy that follows. A push follows a save that changed the Graph's content: ten seconds after
// the last such save, at least once a minute while they keep coming, and at once when the window
// goes to the background or the app quits. Content is the saved markup less how it is viewed --
// each card's place on the screen, the camera, the look (`CloudSync.signatureOf`) -- so a pan
// sends nothing, while an AI note's answer does. Only the tab that holds the autosave lock pushes.
// A push that fails is tried again later, and on every check: the store holds what has not gone up.
//
// Before every push the Drive file's checksum is read. If it is not the one this device last wrote
// or read, another device changed the file, and it is not written over: this device's version goes
// up beside it as a conflict copy, and the Graph is bound to that copy from then on. Nothing is
// merged. The check and the write are two requests, so after a write the file's revisions are read:
// one that landed between them is kept as a conflict copy too. Each file carries the content
// signature of what it holds (`neuriteSignature`), so a change elsewhere to how it is viewed is no
// conflict. A newer copy is offered, never loaded on its own. A file removed from Drive is not made
// again until it is asked for.
class CloudSync {
    static QUIET_MS = 10000;
    static MAX_WAIT_MS = 60000;
    static CHECK_MS = 5 * 60 * 1000;
    static RETRY_MS = [30000, 2 * 60 * 1000, 10 * 60 * 1000];
    // How long quitting waits for a push: the app gives the whole save ten seconds.
    static ON_CLOSE_MS = 5000;

    #state = new Stored('sync', 'drive');
    #files = new Stored('sync', 'drive-files');
    // Each record's binding, by graphId, in memory as well: {uuid, fileId, md5, name, title, pushedAt,
    // pushedRevision, pushedSignature, conflictOf, damaged, recovered, removed, pendingOp, verify}.
    // `title` is the record's title when it was bound: the file keeps its name in Drive until the
    // Graph is renamed here -- a Graph opened from Drive is often given "(2)" to keep it apart from
    // one of its name. `pendingOp` is the operation id of a push that has not finished, `verify` an
    // update whose check for a write under it has not finished.
    #bound = new Map();
    // What each record last wrote: {signature, revision}.
    #written = new Map();
    #pending = new Map();       // graphId -> {meta, since, timer}
    #failures = new Map();      // graphId -> how many pushes in a row failed
    #retries = new Map();       // graphId -> the timer of its next try, one at a time
    #pushing = Promise.resolve();
    #checking = new Map();      // graphId -> the check under way for it
    #folders = null;            // Neurite's folders, the oldest first, once looked for
    #pushNextWrite = false;
    // The lineage id of the file an open is importing: its save is what Drive holds, not a change.
    #opening = null;
    #opened = Promise.resolve();
    // Moved on by Disconnect and by another account: a push or a check that began before it ends
    // without writing anything.
    #generation = 0;
    #disconnecting = false;

    auth = null;
    drive = null;
    status = {phase: 'starting', account: null, lastPushAt: null, error: null, newer: null, conflict: null, removed: null};
    onStatus = Function.nop;

    get views(){ return App.viewGraphs }
    get isConnected(){ return ['idle', 'pushing', 'offline', 'error'].includes(this.status.phase) }

    // The content of a save, as a signature: the markup less what changes with the view -- each card's
    // place on the screen (its outer `style`), a card's first-frame class, and the hidden blocks that
    // hold the camera and the look. Measured: a pan or a zoom changed those and nothing else. Less the
    // heights a title box and an editor are given to fit their text, and where a card's status icons
    // sit: set as each is laid out, so a save before that and one after differ (measured on the
    // iPad, where a reopened card's title box was saved as `height: 24px` and as nothing). Less,
    // too, what a browser numbers for itself: an image's `blob:` address, made afresh on each load
    // (the loader drops it), and its blob's id in the store, given anew by an import. And one setting
    // written two ways: a new AI note saves its sliders as defaults (`d`), the same note reopened --
    // here, or on another device -- as values (`v`). Measured across Chromium and WebKit, those were
    // the only changes a Graph opened from its file saved back with. A form this does not know costs
    // one push of the same content.
    static signatureOf(data){
        const content = String(data ?? '')
            .replace(/ style="position: absolute; transform: scale\([^"]*"/g, '')
            .replace(/( class="[^"]*?) just-created(?=[ "])/g, '$1')
            .replace(/(<(?:textarea|div) class="(?:title-input|editor-wrapper|status-icons-container)"[^>]*?) style="[^"]*"/g, '$1')
            .replace(/<div id="(?:mandelbrot-coords-params|saved-input-values|saved-views|fractal-type|saved-universe)"[^>]*>[^<]*<\/div>/g, '')
            .replace(/ src="blob:[^"]*"/g, ' src=""')
            .replace(/&quot;blob&quot;:&quot;[^&]*&quot;/g, '&quot;blob&quot;:&quot;&quot;')
            .replace(/(&quot;f&quot;:&quot;sliderId&quot;,&quot;a&quot;:\{&quot;p&quot;:&quot;[^&]*&quot;,&quot;)d(&quot;)/g, '$1v$2');
        let hash = 0x811c9dc5; // FNV-1a
        for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 0x01000193) >>> 0;
        return hash.toString(16) + ':' + content.length;
    }

    async init(){
        this.auth = DriveAuth.make();
        this.drive = new GoogleDrive({token: (options)=>this.auth.token(options)});
        const views = this.views;
        views.keeper.afterWrite = (meta, data)=>this.afterWrite(meta, data);
        views.onSavedNow = ()=>Promise.race([this.flush(), new Promise( (r)=>setTimeout(r, CloudSync.ON_CLOSE_MS) )]);
        On.visibilitychange(document, ()=>{
            if (document.visibilityState === 'hidden') this.flush();
            else this.check();
        });
        On.focus(window, ()=>this.check());

        this.status.account = await this.#state.load('account');
        await this.#files.table.iterate( (bound, graphId)=>{ this.#bound.set(graphId, bound) } );
        await this.refresh();
        await views.whenRestored;
        // What the Graph back on screen last wrote, as the store holds it: a save that never went up
        // before the app closed goes up now, and the save note does not call it synced.
        const meta = views.selectedMeta;
        if (meta?.graphId && !views.restoreFailed && !this.#written.has(meta.graphId)) {
            const data = await views.keeper.dataForMeta(meta).catch( ()=>null );
            if (data && !this.#written.has(meta.graphId)) {
                this.#written.set(meta.graphId, {signature: CloudSync.signatureOf(data), revision: meta.revisions});
            }
        }
        this.check();
        setInterval(()=>this.check(), CloudSync.CHECK_MS);
    }

    #set(change){
        Object.assign(this.status, change);
        try { this.onStatus(this.status) } catch (err) { Logger.warn("Sync status:", err) }
    }
    // What the sign-in says now: not set up in this build, not connected, connected but in need
    // of a click (a browser's hour is up), or connected. A Disconnect since it asked has the last word.
    async refresh(){
        if (this.#disconnecting) return;
        const generation = this.#generation;
        let s = null;
        try { s = await this.auth.status() } catch (err) { s = {configured: true, connected: false} }
        const wanted = s.connected ? true : await this.#state.load('wanted');
        if (generation !== this.#generation || this.#disconnecting) return;
        if (!s.configured) return this.#set({phase: 'not-configured'});
        if (s.connected) return this.#set({phase: this.isConnected ? this.status.phase : 'idle'});
        this.#set({phase: (wanted && s.needsClick) ? 'needs-click' : 'disconnected'});
    }

    async connect(){
        const answer = await this.auth.connect();
        if (!answer?.connected) {
            await this.refresh();
            this.#set({error: CloudSync.wordsForSignIn(answer?.error)});
            return answer;
        }
        await this.#state.save('wanted', true);
        this.#set({phase: 'idle', error: null});
        try {
            const email = (await this.drive.about())?.emailAddress ?? '';
            // Another account's files are not this one's: what was bound to them is forgotten.
            const before = await this.#state.load('account');
            if (before && email && before !== email) await this.#forgetBindings();
            this.status.account = email || null;
            await this.#state.save('account', email);
        } catch (err) { Logger.warn("Could not read the Google account:", err) }
        this.#set({});
        this.check();
        // The Graph on screen goes up now, saved afresh: the store's copy may be a tick behind the
        // screen, and what goes up is what the store holds.
        this.#pushNextWrite = true;
        this.views.keeper.forgetLastWritten();
        this.views.saveNow();
        return answer;
    }
    // Disconnected at once, before Google is told: no save from here on starts a push.
    async disconnect(){
        this.#generation += 1;
        for (const p of this.#pending.values()) clearTimeout(p.timer);
        this.#pending.clear();
        for (const timer of this.#retries.values()) clearTimeout(timer);
        this.#retries.clear();
        this.#failures.clear();
        this.#pushNextWrite = false;
        const after = {phase: 'disconnected', newer: null, conflict: null, removed: null, error: null};
        this.#disconnecting = true;
        this.#set(after);
        try {
            await this.auth.disconnect();
            await this.#state.delete('wanted');
        } finally {
            this.#disconnecting = false;
            this.#set(after);
        }
    }
    async #forgetBindings(){
        this.#generation += 1;
        this.#bound.clear();
        this.#folders = null;
        await this.#files.table.clear();
    }
    static wordsForSignIn(error){
        return {
            'not-configured': "Google Drive is not set up in this build.",
            'click-again': "Google's sign-in is ready. Click Connect again.",
            'popup_closed': null, 'access_denied': null, 'superseded': null,
            'timeout': "Google's sign-in took too long. Try again.",
            'no-keychain': "This Mac's Keychain could not keep the sign-in.",
            'no-refresh-token': "Google did not let Neurite stay connected. Try again.",
        }[error] ?? (error ? "Neurite was not connected to Google Drive. Try again." : null);
    }

    // Told by the store after every write of a record (savenet.js, `GraphsKeeper.afterWrite`), with
    // the markup it wrote. Only the Graph on screen is scheduled: the store also writes every other
    // record that shares its title.
    afterWrite(meta, data){
        if (!meta?.graphId) return;
        const signature = CloudSync.signatureOf(data);
        this.#written.set(meta.graphId, {signature, revision: meta.revisions});
        if (!this.isConnected || meta.graphId !== this.views.selectedMeta?.graphId) return;
        let bound = this.#bound.get(meta.graphId);
        // The save an open from Drive makes is what Drive holds; `open` binds it.
        if (this.#opening && meta.uuid === this.#opening && !bound?.fileId) return;
        if (bound?.removed) return;
        // Saved while some of its cards could not be reopened: smaller than the copy in Drive, so it
        // goes up beside it rather than over it -- once: the saves after that go to that copy.
        if (bound?.fileId && !bound.damaged && !bound.conflictDamaged && this.views.restoreSkipped > 0) {
            bound = {...bound, damaged: true};
            this.#bind(meta.graphId, bound);
        }
        const now = this.#pushNextWrite || document.visibilityState === 'hidden';
        this.#pushNextWrite = false;
        const renamed = Boolean(bound?.fileId) && bound.title !== meta.title;
        if (!now && !renamed && bound?.fileId && !bound.damaged && bound.pushedSignature === signature) return;
        this.#schedule(meta, {now});
    }
    // One pending push per Graph. Another Graph's goes first, now: a switch to another Graph -- Open,
    // Clear -- would otherwise take the last edits of the one before with it.
    #schedule(meta, {now = false} = {}){
        if (!meta || !this.isConnected) return;
        for (const graphId of [...this.#pending.keys()]) if (graphId !== meta.graphId) this.#fire(graphId);
        const p = this.#pending.get(meta.graphId) ?? {meta, since: Date.now(), timer: null};
        p.meta = meta;
        clearTimeout(p.timer);
        const wait = now ? 0 : Math.min(CloudSync.QUIET_MS, Math.max(0, p.since + CloudSync.MAX_WAIT_MS - Date.now()));
        p.timer = setTimeout(()=>this.#fire(meta.graphId), wait);
        this.#pending.set(meta.graphId, p);
    }
    #fire(graphId){
        const p = this.#pending.get(graphId);
        if (!p) return this.#pushing;
        this.#pending.delete(graphId);
        clearTimeout(p.timer);
        this.#pushing = this.#pushing.then( ()=>this.push(p.meta) ).catch(Function.nop);
        return this.#pushing;
    }
    // Now, rather than after the quiet: the window is going, or the app is closing (`saveNow`).
    flush(){
        for (const graphId of [...this.#pending.keys()]) this.#fire(graphId);
        return this.#pushing;
    }
    // A push that failed is tried again later: half a minute, two minutes, then every ten -- one
    // timer a Graph, however many pushes failed while it was offline.
    #retryLater(meta){
        const n = this.#failures.get(meta.graphId) ?? 0;
        this.#failures.set(meta.graphId, n + 1);
        const generation = this.#generation;
        clearTimeout(this.#retries.get(meta.graphId));
        this.#retries.set(meta.graphId, setTimeout( ()=>{
            this.#retries.delete(meta.graphId);
            if (generation === this.#generation && this.isConnected && !this.#pending.has(meta.graphId)) this.#schedule(meta, {now: true});
        }, CloudSync.RETRY_MS[Math.min(n, CloudSync.RETRY_MS.length - 1)]));
    }

    // Whether a push may run: connected, in the tab that holds the autosave lock, and not of the
    // Graph on screen when it did not come back at all -- the store's copy of it may be what broke.
    // While a Mac app update is on probation, nothing goes up; it waits, and goes later.
    #mayPush(meta){
        const views = this.views;
        if (!(meta?.uuid && meta.graphId) || !this.isConnected || !views.isWriter) return false;
        if (views.restoreFailed && meta.graphId === views.selectedMeta?.graphId) return false;
        if (window.neuriteDesktop?.update?.onProbation?.()) {
            this.#retryLater(meta);
            return false;
        }
        return true;
    }

    async push(meta){
        if (!this.#mayPush(meta)) return false;
        const generation = this.#generation;
        const live = ()=>generation === this.#generation;
        const graphId = meta.graphId;
        // What goes up is the revision the store holds now, whatever saves land while it goes.
        const revision = meta.revisions;
        let bound = this.#bound.get(graphId) ?? null;
        if (bound?.removed) return false;
        const sent = ()=>Boolean(bound?.fileId) && !bound.verify && !bound.damaged
                         && bound.pushedRevision === revision && bound.title === meta.title;
        if (sent()) return false;

        this.#set({phase: 'pushing', error: null});
        try {
            // An update whose check for a write under it did not finish is checked first.
            if (bound?.verify) {
                await this.#verify(meta, bound, generation, {again: true});
                if (!live()) return false;
                bound = this.#bound.get(graphId) ?? null;
                if (sent()) {
                    this.#failures.delete(graphId);
                    return this.#done(meta, generation, true);
                }
            }
            const {blob, data} = await this.views.exportBundle(meta);
            if (!live()) return false;
            // A Graph with no note in it goes nowhere: a new device's empty canvas made a file of its
            // own, and an empty copy -- a restore gone wrong -- would go up over the one with the notes.
            if (!String(data ?? '').includes('data-node_json')) return this.#done(meta, generation, false);
            const signature = CloudSync.signatureOf(data);
            const renamed = !bound?.name || bound.title !== meta.title;
            const name = renamed ? (View.Graphs.fileNameFor(meta.title) || 'Graph.neurite') : bound.name;

            // Nothing new in it: a rename alone goes as one, and nothing else changes in Drive.
            if (bound?.fileId && !bound.damaged && !bound.pendingOp && bound.pushedSignature === signature) {
                if (renamed) {
                    const f = await this.drive.rename(bound.fileId, name);
                    if (!live()) return false;
                    await this.#bind(graphId, {...bound, name: f.name, title: meta.title, pushedRevision: revision});
                } else {
                    await this.#bind(graphId, {...bound, pushedRevision: revision});
                }
                this.#failures.delete(graphId);
                return this.#done(meta, generation, true);
            }

            const folders = await this.#folderIds();
            if (!live()) return false;
            // A push before this one whose answer never came may have written: its operation id finds
            // what it made -- the Graph's file, a new one, a conflict copy -- which is where it went.
            let before = bound;
            if (before?.pendingOp) {
                const [landed] = await this.drive.findByOp(before.pendingOp);
                if (!live()) return false;
                if (landed) before = {...before, fileId: landed.id, md5: landed.md5Checksum, name: landed.name,
                                      conflictOf: landed.appProperties?.neuriteConflictOf ?? null};
            }
            const op = CloudSync.#newOp();
            const props = {neuriteUuid: meta.uuid, neuriteRevisions: String(revision ?? 0), neuriteDevice: View.Graphs.deviceKind(),
                           neuriteUpdatedAt: String(meta.updatedAt ?? Date.now()), neuriteSignature: signature, neuriteOp: op};
            // Its operation id is kept before it goes, so that an answer that never comes back is
            // found by it (above).
            await this.#bind(graphId, {...(before ?? {}), uuid: meta.uuid, pendingOp: op});
            if (!live()) return false;

            let file = null, base = null, conflict = null;
            if (before?.fileId) {
                const remote = await this.drive.get(before.fileId).catch( (err)=>(err.reason === 'notFound' ? null : Promise.reject(err)) );
                if (!live()) return false;
                if (!remote || remote.trashed) return this.#removed(meta, before);
                const same = !before.damaged && ((remote.md5Checksum === before.md5) || CloudSync.#viewedOnly(remote, before));
                if (same) {
                    base = remote.md5Checksum;
                    file = await this.drive.upload({fileId: remote.id, name, appProperties: props, blob});
                } else {
                    file = await this.#conflictUpload(meta, folders[0], blob, {...props, neuriteConflictOf: remote.id}, View.Graphs.deviceKind());
                    conflict = {damaged: Boolean(before.damaged)};
                }
            } else {
                const found = await this.drive.findByUuid(folders, meta.uuid);
                if (!live()) return false;
                // The Graph came here in a file before this device connected: a file with the same
                // content is the one to go on in, not one to copy beside.
                const same = found.find( (f)=>f.appProperties?.neuriteSignature === signature );
                if (same) file = same;
                else if (found.length) {
                    file = await this.#conflictUpload(meta, folders[0], blob, {...props, neuriteConflictOf: found[0].id}, View.Graphs.deviceKind());
                    conflict = {damaged: false};
                }
                else file = await this.drive.upload({folderId: folders[0], name, appProperties: props, blob});
            }
            if (!live()) return false;
            const next = {uuid: meta.uuid, fileId: file.id, md5: file.md5Checksum, name: file.name, title: meta.title,
                          pushedAt: Date.now(), pushedRevision: revision, pushedSignature: signature,
                          conflictOf: file.appProperties?.neuriteConflictOf ?? null, conflictDamaged: conflict?.damaged ?? false,
                          damaged: false, recovered: null, removed: false, pendingOp: null,
                          // An update is checked once it lands: another device's write may be under it.
                          verify: base ? {base, head: file.headRevisionId, md5: file.md5Checksum, copyOp: CloudSync.#newOp()} : null};
            await this.#bind(graphId, next);
            if (next.verify) await this.#verify(meta, next, generation, {again: false});
            if (!live()) return false;
            this.#failures.delete(graphId);
            this.#set({lastPushAt: Date.now()});
            return this.#done(meta, generation, true);
        } catch (err) {
            if (!live()) return false;
            Logger.warn("Could not sync to Google Drive:", err);
            const lost = (err?.reason === 'unauthorized');
            if (lost) await this.refresh();
            if (!live()) return false;
            this.#set({phase: lost ? this.status.phase : (err?.reason === 'network' ? 'offline' : 'error'),
                       error: lost ? "Google Drive needs to be connected again." : String(err?.message ?? err)});
            if (!lost) this.#retryLater(meta);
            return false;
        }
    }
    static #newOp(){ return Math.random().toString(36).slice(2) + Date.now().toString(36) }
    // The push is over: what the Graph on screen says now comes from its binding.
    #done(meta, generation, pushed){
        if (generation !== this.#generation) return pushed;
        if (this.status.phase === 'pushing') this.#set({phase: 'idle'});
        if (meta.graphId === this.views.selectedMeta?.graphId) {
            const bound = this.#bound.get(meta.graphId);
            this.#set({...(pushed ? {newer: null} : {}), ...CloudSync.#noticesOf(bound)});
        }
        this.views.refreshSaveNote?.();
        return pushed;
    }
    #bind(graphId, bound){
        this.#bound.set(graphId, bound);
        return this.#files.save(graphId, bound);
    }
    // What a binding has to say in Settings → Sync: a file removed from Drive, a copy made beside
    // another device's, another device's write kept as a copy.
    static #noticesOf(bound){
        if (!bound) return {conflict: null, removed: null};
        if (bound.removed) return {conflict: null, removed: {name: bound.name}};
        if (bound.recovered) return {removed: null, conflict: {name: bound.recovered.name, otherId: bound.recovered.id, recovered: true}};
        if (bound.conflictOf) return {removed: null, conflict: {name: bound.name, otherId: bound.conflictOf, damaged: Boolean(bound.conflictDamaged)}};
        return {conflict: null, removed: null};
    }

    // After an update lands, the file's revisions are read: the check before it and the write are two
    // requests, and a revision between the one it built on and its own is another device's write,
    // kept as a conflict copy. The check is recorded (`verify`) before it runs, so one that did not
    // finish runs again before the next push; a copy made by one whose answer never came back is
    // found by its operation id.
    async #verify(meta, bound, generation, {again}){
        const live = ()=>generation === this.#generation;
        const {fileId, verify} = bound;
        let copy = again ? ((await this.drive.findByOp(verify.copyOp))[0] ?? null) : null;
        if (!live()) return;
        if (!copy) {
            const revisions = await this.drive.revisions(fileId);
            if (!live()) return;
            const at = revisions.findIndex( (r)=>r.id === verify.head );
            const between = (at > 0) ? revisions[at - 1] : null;
            if (between?.md5Checksum && between.md5Checksum !== verify.base && between.md5Checksum !== verify.md5) {
                const theirs = await this.drive.downloadRevision(fileId, between.id);
                if (!live()) return;
                copy = await this.#conflictUpload(meta, (await this.#folderIds())[0], theirs,
                    {neuriteUuid: meta.uuid, neuriteConflictOf: fileId, neuriteOp: verify.copyOp}, 'another device');
                if (!live()) return;
                // Safe in its copy now: the mark that let it be read comes off (Drive allows 200).
                await this.drive.keepRevision(fileId, between.id, false)
                    .catch( (err)=>Logger.warn("Could not unmark a revision kept to be read:", err) );
                if (!live()) return;
            }
        }
        const now = this.#bound.get(meta.graphId);
        if (now?.verify !== verify) return;
        await this.#bind(meta.graphId, {...now, verify: null, recovered: copy ? {id: copy.id, name: copy.name} : (now.recovered ?? null)});
    }
    // This device's version, beside the other's: the other file is left as it is.
    #conflictUpload(meta, folder, blob, appProperties, device){
        const base = (View.Graphs.fileNameFor(meta.title) || 'Graph.neurite').replace(/\.neurite$/i, '');
        const when = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
        return this.drive.upload({folderId: folder, name: `${base} (conflict, ${device}, ${when}).neurite`, blob, appProperties});
    }
    // Moved to the bin or deleted in Drive: someone's choice, so it is not undone. The Graph stops
    // syncing until it is asked to again.
    async #removed(meta, bound){
        await this.#bind(meta.graphId, {...bound, removed: true, pendingOp: null});
        if (meta.graphId === this.views.selectedMeta?.graphId) this.#set({removed: {name: bound.name}});
        if (this.status.phase === 'pushing') this.#set({phase: 'idle'});
        return false;
    }
    // Asked again, from Sync: the next push makes a new file.
    async syncAgain(){
        const meta = this.views.selectedMeta;
        if (!meta) return;
        await this.#bind(meta.graphId, {uuid: meta.uuid, removed: false});
        this.#set({removed: null});
        this.#pushNextWrite = true;
        this.views.keeper.forgetLastWritten();
        await this.views.saveNow();
    }
    // Whether a file changed elsewhere holds the content this device last wrote or read.
    static #viewedOnly(remote, bound){
        const theirs = remote.appProperties?.neuriteSignature;
        return Boolean(theirs) && theirs === bound.pushedSignature;
    }
    static #newerOf(remote){
        return {fileId: remote.id, name: remote.name, device: remote.appProperties?.neuriteDevice ?? null, modifiedTime: remote.modifiedTime};
    }

    // Neurite's folders, looked for once a session -- and together, however many ask at once: a
    // push and the list asked at the same moment just after connecting, and each made a folder.
    #folderIds(){
        this.#folders ??= this.drive.folderId().then( async (oldest)=>{
            const all = await this.drive.folders();
            return all.length ? all : [oldest];
        }).catch( (err)=>{ this.#folders = null; throw err } );
        return this.#folders;
    }

    // Whether Drive holds a newer copy of the Graph on screen than this device last wrote or read; and
    // whatever has not gone up -- a push that failed, a rename -- goes now. One check a Graph at a time.
    check(){
        const meta = this.views.selectedMeta;
        if (!this.isConnected) return Promise.resolve(null);
        const key = meta?.graphId ?? null;
        if (!this.#checking.has(key)) {
            this.#checking.set(key, this.#check(meta).finally( ()=>this.#checking.delete(key) ));
        }
        return this.#checking.get(key);
    }
    async #check(meta){
        const generation = this.#generation;
        const bound = meta && this.#bound.get(meta.graphId);
        if (!bound?.fileId || bound.removed) {
            this.#set({newer: null, ...CloudSync.#noticesOf(bound)});
            if (meta && !bound?.removed) this.#catchUp(meta, bound);
            return null;
        }
        // Only for the Graph and the binding it began with: another may be on screen now, or a push
        // may have bound this one afresh.
        const current = ()=>generation === this.#generation && this.views.selectedMeta?.graphId === meta.graphId
                            && this.#bound.get(meta.graphId) === bound;
        try {
            const remote = await this.drive.get(bound.fileId).catch( (err)=>(err.reason === 'notFound' ? null : Promise.reject(err)) );
            if (!current()) return null;
            if (!remote || remote.trashed) return this.#removed(meta, bound);
            // Viewed differently elsewhere, with the same content: the file's checksum is this
            // device's to build on from now.
            let base = bound;
            if (remote.md5Checksum !== bound.md5 && CloudSync.#viewedOnly(remote, bound)) {
                base = {...bound, md5: remote.md5Checksum};
                await this.#bind(meta.graphId, base);
                if (generation !== this.#generation) return null;
            }
            const newer = (remote.md5Checksum !== base.md5 && !base.pendingOp) ? CloudSync.#newerOf(remote) : null;
            this.#set({newer, ...CloudSync.#noticesOf(base), phase: this.status.phase === 'offline' ? 'idle' : this.status.phase});
            if (!newer) this.#catchUp(meta, base);
            return newer;
        } catch (err) {
            if (generation !== this.#generation) return null;
            if (err?.reason === 'unauthorized') await this.refresh();
            else if (err?.reason === 'network' && this.isConnected) this.#set({phase: 'offline'});
            return null;
        }
    }
    // A Graph whose last save, or title, is not in Drive yet goes now; so does one whose last push did
    // not finish.
    #catchUp(meta, bound){
        const written = this.#written.get(meta.graphId);
        const behind = written && (!bound?.fileId || written.signature !== bound.pushedSignature);
        const unfinished = bound?.fileId && (bound.title !== meta.title || bound.pendingOp || bound.verify || bound.damaged);
        if ((behind || unfinished) && !this.#pending.has(meta.graphId)) this.#schedule(meta, {now: true});
    }

    // The Graphs in Neurite's folders, the latest first, for Settings → Sync.
    async listFiles(){
        return this.drive.list(await this.#folderIds());
    }
    // Opened as Open… opens a file, and bound to the Drive file it came from. The Graph on screen
    // goes first -- saved, and pushed -- so none of it is left behind in a record nothing reaches; one
    // that could not go up is asked about. The save the opening makes pushes nothing when it holds
    // what Drive holds; an open that did not happen -- refused, cancelled, failed -- binds nothing.
    // One open at a time: each binds the record its own import made.
    open(fileId){
        const run = this.#opened.then( ()=>this.#open(fileId) );
        this.#opened = run.catch(Function.nop);
        return run;
    }
    async #open(fileId){
        const outgoing = this.views.selectedMeta;
        await this.views.saveNow();
        await this.flush();
        if (outgoing && this.#written.get(outgoing.graphId) && !this.syncedAt(outgoing) && !this.#bound.get(outgoing.graphId)?.removed
            && String(await this.views.keeper.dataForMeta(outgoing) ?? '').includes('data-node_json')) {
            const go = await window.confirm(`The latest changes to “${outgoing.title}” could not go up to Google Drive. `
                + "Open the other graph anyway? Those changes stay in this browser.", {title: "Open from Google Drive?", ok: "Open"});
            if (!go) return null;
        }

        const generation = this.#generation;
        const meta = await this.drive.get(fileId);
        const blob = await this.drive.download(fileId);
        const uuid = meta.appProperties?.neuriteUuid ?? null;
        this.#opening = uuid;
        let opened = null;
        try { opened = await this.views.importFile(new File([blob], meta.name, {type: GoogleDrive.FILE_TYPE})) }
        finally { this.#opening = null }
        if (!opened?.graphId || opened.graphId === outgoing?.graphId) return null;

        if (uuid && opened.uuid === uuid && generation === this.#generation) {
            // Bound to what Drive holds; if the save the opening made differs from it -- a card that
            // settled elsewhere here -- that goes up as a change.
            const theirs = meta.appProperties?.neuriteSignature ?? null;
            const written = this.#written.get(opened.graphId);
            const same = Boolean(theirs) && written?.signature === theirs;
            await this.#bind(opened.graphId, {uuid, fileId: meta.id, md5: meta.md5Checksum, name: meta.name, title: opened.title,
                                              pushedAt: Date.parse(meta.modifiedTime) || Date.now(),
                                              pushedRevision: same ? written.revision : null, pushedSignature: theirs,
                                              conflictOf: meta.appProperties?.neuriteConflictOf ?? null, conflictDamaged: false,
                                              damaged: false, recovered: null, removed: false, pendingOp: null, verify: null});
            if (written && !same && this.views.selectedMeta?.graphId === opened.graphId) this.#schedule(opened);
        }
        this.#set({newer: null, ...CloudSync.#noticesOf(this.#bound.get(opened.graphId))});
        this.views.refreshSaveNote?.();
        this.check();
        return opened;
    }

    // For the save note: when the Graph on screen went to Drive as it is now, or null -- not while a
    // push is waiting for it or has not finished, after one failed, or before a rename has gone.
    syncedAt(meta){
        const bound = meta?.graphId && this.#bound.get(meta.graphId);
        const written = meta?.graphId && this.#written.get(meta.graphId);
        if (!bound?.pushedAt || bound.removed || bound.pendingOp || bound.damaged || bound.title !== meta.title
            || this.#pending.has(meta.graphId) || this.#failures.has(meta.graphId)) return null;
        return (!written || written.signature === bound.pushedSignature) ? bound.pushedAt : null;
    }
}
