// Cloud sync (docs/cloud-sync.md): every Graph worked on, kept as a `.neurite` file in Neurite's
// folder in Google Drive, so another device can open it from Settings → Sync.
//
// The Graph's home stays this browser's IndexedDB, as Notion's stays its local database; Drive is
// the copy that follows. A push follows a save of the Graph on screen: ten seconds after the last
// change to its content -- the Panes' text and each Node's title and place
// (`View.Graphs.contentSignature`) -- and at least once a minute while such changes keep coming;
// two minutes after a save that changed anything else, a pan's or a resize's; and at once when the
// window goes to the background or the app quits. Only the tab that holds the autosave lock pushes.
//
// Before every push the Drive file's checksum is read. If it is not the one this device last wrote
// or read, another device changed the file, and it is not written over: this device's version
// goes up beside it as a conflict copy, and the Graph is bound to that copy from then on. Nothing
// is merged. A newer copy is offered, never loaded on its own: opening a Graph replaces the screen.
// A file removed from Drive is not made again: the Graph stops syncing until it is asked to.
class CloudSync {
    static QUIET_MS = 10000;
    static MAX_WAIT_MS = 60000;
    static VIEW_QUIET_MS = 2 * 60 * 1000;
    static CHECK_MS = 5 * 60 * 1000;
    // How long quitting waits for a push: the app gives the whole save ten seconds.
    static ON_CLOSE_MS = 5000;

    #state = new Stored('sync', 'drive');
    #files = new Stored('sync', 'drive-files');
    // Each record's binding, by graphId, in memory as well: {uuid, fileId, md5, name, title,
    // pushedAt, pushedRevision, pushedSignature, conflictOf, removed, pendingOp}. `title` is the
    // record's title when it was bound: the file keeps its name in Drive until the Graph is renamed
    // here -- a Graph opened from Drive is often given "(2)" to keep it apart from one of its name.
    #bound = new Map();
    #pending = null;            // {meta, signature, content, since, timer}
    #pushing = Promise.resolve();
    #checking = null;
    #folder = null;
    #folderReady = null;
    #pushNextWrite = false;

    auth = null;
    drive = null;
    status = {phase: 'starting', account: null, lastPushAt: null, error: null, newer: null, conflict: null, removed: null};
    onStatus = Function.nop;

    get views(){ return App.viewGraphs }
    get isConnected(){ return ['idle', 'pushing', 'offline', 'error'].includes(this.status.phase) }

    async init(){
        this.auth = DriveAuth.make();
        this.drive = new GoogleDrive({token: (options)=>this.auth.token(options)});
        const views = this.views;
        views.keeper.afterWrite = (meta, signature)=>this.afterWrite(meta, signature);
        views.onSavedNow = ()=>Promise.race([this.flush(), new Promise( (r)=>setTimeout(r, CloudSync.ON_CLOSE_MS) )]);
        On.visibilitychange(document, ()=>{
            if (document.visibilityState === 'hidden') this.flush();
            else this.check();
        });
        On.focus(window, ()=>this.check());

        this.#folder = await this.#state.load('folder');
        this.status.account = await this.#state.load('account');
        await this.#files.table.iterate( (bound, graphId)=>{ this.#bound.set(graphId, bound) } );
        await this.refresh();
        await views.whenRestored;
        this.check();
        setInterval(()=>this.check(), CloudSync.CHECK_MS);
    }

    #set(change){
        Object.assign(this.status, change);
        try { this.onStatus(this.status) } catch (err) { Logger.warn("Sync status:", err) }
    }
    // What the sign-in says now: not set up in this build, not connected, connected but in need
    // of a click (a browser's hour is up), or connected.
    async refresh(){
        let s = null;
        try { s = await this.auth.status() } catch (err) { s = {configured: true, connected: false} }
        if (!s.configured) return this.#set({phase: 'not-configured'});
        if (s.connected) return this.#set({phase: this.isConnected ? this.status.phase : 'idle'});
        const wanted = await this.#state.load('wanted');
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
    async disconnect(){
        clearTimeout(this.#pending?.timer);
        this.#pending = null;
        await this.auth.disconnect();
        await this.#state.delete('wanted');
        this.#set({phase: 'disconnected', newer: null, conflict: null, removed: null, error: null});
    }
    async #forgetBindings(){
        this.#bound.clear();
        this.#folder = null;
        await this.#state.delete('folder');
        await this.#files.table.clear();
    }
    static wordsForSignIn(error){
        return {
            'not-configured': "Google Drive is not set up in this build.",
            'click-again': "Google's sign-in is ready. Click Connect again.",
            'popup_closed': null, 'access_denied': null, 'superseded': null,
            'timeout': "Google's sign-in took too long. Try again.",
            'no-keychain': "This Mac's Keychain could not keep the sign-in.",
        }[error] ?? (error ? "Neurite was not connected to Google Drive. Try again." : null);
    }

    // Told by the store after every write of a record (savenet.js, `GraphsKeeper.afterWrite`), with
    // the content signature of what it wrote.
    afterWrite(meta, signature){
        if (!this.isConnected || meta?.graphId !== this.views.selectedMeta?.graphId) return;
        const bound = this.#bound.get(meta.graphId);
        if (bound?.removed) return;
        const now = this.#pushNextWrite || document.visibilityState === 'hidden';
        this.#pushNextWrite = false;
        this.#schedule(meta, signature, {now, content: !bound || bound.pushedSignature !== signature});
    }
    #schedule(meta, signature, {now = false, content = true} = {}){
        if (!meta || !this.isConnected) return;
        const p = this.#pending ??= {meta, signature, content: false, since: Date.now(), timer: null};
        p.meta = meta;
        p.signature = signature;
        p.content ||= content;
        clearTimeout(p.timer);
        const wait = now ? 0
                   : p.content ? Math.min(CloudSync.QUIET_MS, Math.max(0, p.since + CloudSync.MAX_WAIT_MS - Date.now()))
                   : CloudSync.VIEW_QUIET_MS;
        p.timer = setTimeout(()=>this.#firePending(), wait);
    }
    #firePending(){
        const p = this.#pending;
        this.#pending = null;
        if (p) this.#pushing = this.#pushing.then( ()=>this.push(p.meta, p.signature) ).catch(Function.nop);
        return this.#pushing;
    }
    // Now, rather than after the quiet: the window is going, or the app is closing (`saveNow`).
    flush(){
        if (this.#pending) {
            clearTimeout(this.#pending.timer);
            return this.#firePending();
        }
        return this.#pushing;
    }

    // Whether a push may run at all: the guards autosave has, the lock, and a Graph that came back
    // whole -- one whose cards did not all reopen would go up smaller than the copy in Drive.
    #mayPush(meta){
        const views = this.views;
        return Boolean(meta?.uuid) && this.isConnected && views.isWriter && !views.restoreFailed
            && !(views.restoreSkipped > 0) && !window.neuriteDesktop?.update?.onProbation?.()
            && meta.graphId === views.selectedMeta?.graphId;
    }

    // `signature` is the content signature of the copy the store holds, which is what goes up.
    async push(meta, signature){
        if (!this.#mayPush(meta)) return false;
        let bound = this.#bound.get(meta.graphId) ?? null;
        if (bound?.removed) return false;
        if (bound?.fileId && bound.pushedRevision === meta.revisions) return false;

        // A Graph with no note in it goes nowhere: a new device's empty canvas made a file of its own,
        // and an empty copy -- a restore that went wrong -- would go up over the one that holds the
        // notes. Save to… refuses to write one too.
        const data = await this.views.keeper.dataForMeta(meta);
        if (!String(data ?? '').includes('data-node_json')) return false;

        this.#set({phase: 'pushing', error: null});
        try {
            const folder = await this.#folderId();
            const blob = await this.views.exportBundle(meta);
            const renamed = !bound?.name || bound.title !== meta.title;
            const name = renamed ? (View.Graphs.fileNameFor(meta.title) || 'Graph.neurite') : bound.name;
            const props = {neuriteUuid: meta.uuid, neuriteRevisions: String(meta.revisions ?? 0),
                           neuriteDevice: View.Graphs.deviceKind(), neuriteUpdatedAt: String(meta.updatedAt ?? Date.now())};

            let file = null;
            if (bound?.fileId) {
                const remote = await this.drive.get(bound.fileId).catch( (err)=>(err.reason === 'notFound' ? null : Promise.reject(err)) );
                if (!remote || remote.trashed) return this.#removed(meta, bound);
                file = (remote.md5Checksum === bound.md5)
                    ? await this.drive.upload({fileId: remote.id, name, appProperties: props, blob})
                    : await this.#conflictCopy(meta, folder, remote, blob, props);
            } else {
                const found = await this.drive.findByUuid(folder, meta.uuid);
                // A file this device made, whose answer never came back, is this Graph's.
                const mine = bound?.pendingOp && found.find( (f)=>f.appProperties?.neuriteOp === bound.pendingOp );
                if (mine) {
                    file = await this.drive.upload({fileId: mine.id, name, appProperties: props, blob});
                } else if (found.length) {
                    // In Drive already, with nothing to say this device's copy follows from it.
                    file = await this.#conflictCopy(meta, folder, found[0], blob, props);
                } else {
                    const op = Math.random().toString(36).slice(2) + Date.now().toString(36);
                    await this.#bind(meta.graphId, {...(bound ?? {}), uuid: meta.uuid, pendingOp: op});
                    file = await this.drive.upload({folderId: folder, name, appProperties: {...props, neuriteOp: op}, blob});
                }
            }
            bound = this.#bound.get(meta.graphId) ?? {};
            await this.#bind(meta.graphId, {uuid: meta.uuid, fileId: file.id, md5: file.md5Checksum, name: file.name,
                                            title: meta.title, pushedAt: Date.now(), pushedRevision: meta.revisions,
                                            pushedSignature: signature ?? null,
                                            conflictOf: file.appProperties?.neuriteConflictOf ?? bound.conflictOf ?? null,
                                            removed: false, pendingOp: null});
            this.#set({phase: 'idle', lastPushAt: Date.now()});
            this.views.refreshSaveNote?.();
            return true;
        } catch (err) {
            Logger.warn("Could not sync to Google Drive:", err);
            const lost = (err?.reason === 'unauthorized');
            if (lost) await this.refresh();
            this.#set({phase: lost ? this.status.phase : (err?.reason === 'network' ? 'offline' : 'error'),
                       error: lost ? "Google Drive needs to be connected again." : String(err?.message ?? err)});
            // The next save tries again; nothing is queued that the store does not already hold.
            return false;
        }
    }
    #bind(graphId, bound){
        this.#bound.set(graphId, bound);
        return this.#files.save(graphId, bound);
    }
    // The other device's file is left as it is, and this device's version goes up beside it.
    async #conflictCopy(meta, folder, remote, blob, props){
        const base = (View.Graphs.fileNameFor(meta.title) || 'Graph.neurite').replace(/\.neurite$/i, '');
        const when = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
        const name = `${base} (conflict, ${View.Graphs.deviceKind()}, ${when}).neurite`;
        const file = await this.drive.upload({folderId: folder, name, blob, appProperties: {...props, neuriteConflictOf: remote.id}});
        // The Graph is bound to the copy now, so there is no newer copy of it to offer.
        this.#set({newer: null, conflict: {name: file.name, otherId: remote.id, otherName: remote.name,
                                           otherDevice: remote.appProperties?.neuriteDevice ?? null}});
        return file;
    }
    // Moved to the bin or deleted in Drive: someone's choice, so it is not undone. The Graph stops
    // syncing until it is asked to again.
    async #removed(meta, bound){
        await this.#bind(meta.graphId, {...bound, removed: true});
        this.#set({phase: 'idle', removed: {name: bound.name}});
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

    // Whether Drive holds a newer copy of the Graph on screen than this device last wrote or read.
    check(){
        if (!this.isConnected) return Promise.resolve(null);
        this.#checking ??= this.#check().finally( ()=>{ this.#checking = null } );
        return this.#checking;
    }
    async #check(){
        const meta = this.views.selectedMeta;
        const bound = meta && this.#bound.get(meta.graphId);
        if (!bound?.fileId || bound.removed) {
            return this.#set({newer: null, conflict: null, removed: bound?.removed ? {name: bound.name} : null});
        }
        try {
            const remote = await this.drive.get(bound.fileId).catch( (err)=>(err.reason === 'notFound' ? null : Promise.reject(err)) );
            if (!remote || remote.trashed) return this.#removed(meta, bound);
            const newer = (remote.md5Checksum !== bound.md5)
                ? {fileId: remote.id, name: remote.name, device: remote.appProperties?.neuriteDevice ?? null, modifiedTime: remote.modifiedTime}
                : null;
            // A conflict copy says so for as long as the Graph is bound to it.
            const conflict = bound.conflictOf
                ? (this.status.conflict?.otherId === bound.conflictOf ? this.status.conflict : {name: bound.name, otherId: bound.conflictOf})
                : null;
            this.#set({newer, conflict, removed: null, phase: this.status.phase === 'offline' ? 'idle' : this.status.phase});
            return newer;
        } catch (err) {
            if (err?.reason === 'unauthorized') await this.refresh();
            else if (err?.reason === 'network') this.#set({phase: 'offline'});
            return null;
        }
    }

    // Neurite's folder, looked for once however many ask together: a push and the list, asked at
    // the same moment just after connecting, each made a folder of their own.
    #folderId(){
        this.#folderReady ??= this.drive.folderId(this.#folder)
            .then( async (id)=>{ this.#folder = id; await this.#state.save('folder', id); return id } )
            .finally( ()=>{ this.#folderReady = null } );
        return this.#folderReady;
    }
    // The Graphs in Neurite's folder, the latest first, for Settings → Sync.
    async listFiles(){
        return this.drive.list(await this.#folderId());
    }
    // Opened as Open… opens a file, and bound to the Drive file it came from. The Graph on screen
    // goes first -- saved, and pushed if it has changes -- so none of it is left behind in a record
    // nothing reaches; and the save the opening makes pushes nothing, being what Drive holds.
    async open(fileId){
        this.views.keeper.forgetLastWritten();
        await this.views.saveNow();
        await this.flush();

        const meta = await this.drive.get(fileId);
        const blob = await this.drive.download(fileId);
        await this.views.importFile(new File([blob], meta.name, {type: GoogleDrive.FILE_TYPE}));
        const opened = this.views.selectedMeta;
        if (opened?.uuid && opened.uuid === meta.appProperties?.neuriteUuid) {
            await this.#bind(opened.graphId, {uuid: opened.uuid, fileId: meta.id, md5: meta.md5Checksum, name: meta.name,
                                              title: opened.title,
                                              pushedAt: Date.parse(meta.modifiedTime) || Date.now(), pushedRevision: opened.revisions,
                                              pushedSignature: View.Graphs.contentSignature(),
                                              conflictOf: meta.appProperties?.neuriteConflictOf ?? null, removed: false, pendingOp: null});
        }
        this.#set({newer: null, conflict: null, removed: null});
        this.views.refreshSaveNote?.();
        this.check();
        return opened;
    }

    // For the save note: when the Graph on screen went to Drive as it is now, or null.
    syncedAt(meta){
        const bound = meta?.graphId && this.#bound.get(meta.graphId);
        return (bound?.pushedAt && !bound.removed && bound.pushedSignature === View.Graphs.contentSignature()) ? bound.pushedAt : null;
    }
}
