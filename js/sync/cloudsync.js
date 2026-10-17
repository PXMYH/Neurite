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
    // pushedRevision, pushedSignature, conflictOf, removed, pendingOp}. `title` is the
    // record's title when it was bound: the file keeps its name in Drive until the Graph is renamed
    // here -- a Graph opened from Drive is often given "(2)" to keep it apart from one of its name.
    #bound = new Map();
    // What each record last wrote: {signature, revision}.
    #written = new Map();
    #pending = new Map();       // graphId -> {meta, since, timer}
    #failures = new Map();      // graphId -> how many pushes in a row failed
    #pushing = Promise.resolve();
    #checking = null;
    #folders = null;            // Neurite's folders, the oldest first, once looked for
    #pushNextWrite = false;
    // A Graph being opened from Drive, bound to its file by the save the opening makes.
    #opening = null;
    // Moved on by Disconnect and by another account: a push or a check that began before it ends
    // without writing anything.
    #generation = 0;

    auth = null;
    drive = null;
    status = {phase: 'starting', account: null, lastPushAt: null, error: null, newer: null, conflict: null, removed: null};
    onStatus = Function.nop;

    get views(){ return App.viewGraphs }
    get isConnected(){ return ['idle', 'pushing', 'offline', 'error'].includes(this.status.phase) }

    // The content of a save, as a signature: the markup less what changes with the view -- each card's
    // place on the screen (its outer `style`), a card's first-frame class, and the hidden blocks that
    // hold the camera and the look. Measured: a pan or a zoom changed those and nothing else. And one
    // setting written two ways: a new AI note saves its sliders as defaults (`d`), the same note
    // reopened -- here, or on another device -- as values (`v`). Measured across Chromium and WebKit,
    // that was the only change a Graph opened from its file saved back with. A form this does not
    // know costs one push of the same content.
    static signatureOf(data){
        const content = String(data ?? '')
            .replace(/ style="position: absolute; transform: scale\([^"]*"/g, '')
            .replace(/ just-created/g, '')
            .replace(/<div id="(?:mandelbrot-coords-params|saved-input-values|saved-views|fractal-type|saved-universe)"[^>]*>[^<]*<\/div>/g, '')
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
        this.#generation += 1;
        for (const p of this.#pending.values()) clearTimeout(p.timer);
        this.#pending.clear();
        this.#failures.clear();
        await this.auth.disconnect();
        await this.#state.delete('wanted');
        this.#set({phase: 'disconnected', newer: null, conflict: null, removed: null, error: null});
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
        // The save that opening from Drive makes is what Drive holds: bound to it, nothing to send.
        const o = this.#opening;
        if (o && meta.uuid === o.uuid && !this.#bound.get(meta.graphId)?.fileId) {
            this.#opening = null;
            this.#bind(meta.graphId, {uuid: meta.uuid, fileId: o.id, md5: o.md5Checksum, name: o.name, title: meta.title,
                                      pushedAt: Date.parse(o.modifiedTime) || Date.now(), pushedRevision: meta.revisions,
                                      pushedSignature: signature, conflictOf: o.appProperties?.neuriteConflictOf ?? null,
                                      removed: false, pendingOp: null});
            return;
        }
        if (!this.isConnected || meta.graphId !== this.views.selectedMeta?.graphId) return;
        const bound = this.#bound.get(meta.graphId);
        if (bound?.removed) return;
        const now = this.#pushNextWrite || document.visibilityState === 'hidden';
        this.#pushNextWrite = false;
        const renamed = Boolean(bound?.fileId) && bound.title !== meta.title;
        if (!now && !renamed && bound?.fileId && bound.pushedSignature === signature) return;
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
    // A push that failed is tried again later: half a minute, two minutes, then every ten.
    #retryLater(meta){
        const n = this.#failures.get(meta.graphId) ?? 0;
        this.#failures.set(meta.graphId, n + 1);
        const generation = this.#generation;
        setTimeout( ()=>{
            if (generation === this.#generation && this.isConnected && !this.#pending.has(meta.graphId)) this.#schedule(meta, {now: true});
        }, CloudSync.RETRY_MS[Math.min(n, CloudSync.RETRY_MS.length - 1)]);
    }

    // Whether a push may run at all: the guards autosave has, the lock, and a Graph that came back
    // whole -- one whose cards did not all reopen would go up smaller than the copy in Drive.
    #mayPush(meta){
        const views = this.views;
        return Boolean(meta?.uuid && meta.graphId) && this.isConnected && views.isWriter && !views.restoreFailed
            && !(views.restoreSkipped > 0) && !window.neuriteDesktop?.update?.onProbation?.();
    }

    async push(meta){
        if (!this.#mayPush(meta)) return false;
        const generation = this.#generation;
        const graphId = meta.graphId;
        // What goes up is the revision the store holds now, whatever saves land while it goes.
        const revision = meta.revisions;
        let bound = this.#bound.get(graphId) ?? null;
        if (bound?.removed) return false;
        if (bound?.fileId && bound.pushedRevision === revision && bound.title === meta.title) return false;

        this.#set({phase: 'pushing', error: null});
        try {
            const {blob, data} = await this.views.exportBundle(meta);
            // A Graph with no note in it goes nowhere: a new device's empty canvas made a file of its
            // own, and an empty copy -- a restore gone wrong -- would go up over the one with the notes.
            if (!String(data ?? '').includes('data-node_json')) return this.#done(generation, false);
            const signature = CloudSync.signatureOf(data);
            const renamed = !bound?.name || bound.title !== meta.title;
            const name = renamed ? (View.Graphs.fileNameFor(meta.title) || 'Graph.neurite') : bound.name;

            // Nothing new in it: a rename alone goes as one, and nothing else changes in Drive.
            if (bound?.fileId && bound.pushedSignature === signature) {
                if (renamed) {
                    const f = await this.drive.rename(bound.fileId, name);
                    if (generation !== this.#generation) return false;
                    await this.#bind(graphId, {...bound, name: f.name, title: meta.title, pushedRevision: revision});
                } else {
                    await this.#bind(graphId, {...bound, pushedRevision: revision});
                }
                return this.#done(generation, true);
            }

            const folders = await this.#folderIds();
            const op = Math.random().toString(36).slice(2) + Date.now().toString(36);
            const props = {neuriteUuid: meta.uuid, neuriteRevisions: String(revision ?? 0), neuriteDevice: View.Graphs.deviceKind(),
                           neuriteUpdatedAt: String(meta.updatedAt ?? Date.now()), neuriteSignature: signature, neuriteOp: op};
            // Its operation id is kept before it goes: an answer that never comes back is recognised by
            // it. A push's own id only, never an older one's, which another device's write does not
            // take off the file when it leaves the property alone.
            const before = bound;
            await this.#bind(graphId, {...(bound ?? {}), uuid: meta.uuid, pendingOp: op});
            if (generation !== this.#generation) return false;

            let file = null;
            if (before?.fileId) {
                const remote = await this.drive.get(before.fileId).catch( (err)=>(err.reason === 'notFound' ? null : Promise.reject(err)) );
                if (generation !== this.#generation) return false;
                if (!remote || remote.trashed) return this.#removed(meta, before);
                // An earlier push of this device's whose answer never came is its base, not another's.
                const ours = Boolean(before.pendingOp) && remote.appProperties?.neuriteOp === before.pendingOp;
                const base = ours ? remote.md5Checksum : before.md5;
                const same = (remote.md5Checksum === base) || CloudSync.#viewedOnly(remote, before);
                file = same ? await this.#update(meta, remote.id, name, props, blob, remote.md5Checksum)
                            : await this.#conflictCopy(meta, folders[0], remote, blob, props);
            } else {
                const found = await this.drive.findByUuid(folders, meta.uuid);
                if (generation !== this.#generation) return false;
                const mine = before?.pendingOp && found.find( (f)=>f.appProperties?.neuriteOp === before.pendingOp );
                if (mine) file = await this.#update(meta, mine.id, name, props, blob, mine.md5Checksum);
                else if (found.length) file = await this.#conflictCopy(meta, folders[0], found[0], blob, props);
                else file = await this.drive.upload({folderId: folders[0], name, appProperties: props, blob});
            }
            if (generation !== this.#generation) return false;
            bound = this.#bound.get(graphId) ?? {};
            await this.#bind(graphId, {uuid: meta.uuid, fileId: file.id, md5: file.md5Checksum, name: file.name,
                                       title: meta.title, pushedAt: Date.now(), pushedRevision: revision, pushedSignature: signature,
                                       conflictOf: file.appProperties?.neuriteConflictOf ?? bound.conflictOf ?? null,
                                       removed: false, pendingOp: null});
            this.#failures.delete(graphId);
            this.#set({lastPushAt: Date.now()});
            return this.#done(generation, true);
        } catch (err) {
            if (generation !== this.#generation) return false;
            Logger.warn("Could not sync to Google Drive:", err);
            const lost = (err?.reason === 'unauthorized');
            if (lost) await this.refresh();
            this.#set({phase: lost ? this.status.phase : (err?.reason === 'network' ? 'offline' : 'error'),
                       error: lost ? "Google Drive needs to be connected again." : String(err?.message ?? err)});
            if (!lost) this.#retryLater(meta);
            return false;
        }
    }
    #done(generation, pushed){
        if (generation === this.#generation && this.status.phase === 'pushing') this.#set({phase: 'idle'});
        this.views.refreshSaveNote?.();
        return pushed;
    }
    #bind(graphId, bound){
        this.#bound.set(graphId, bound);
        return this.#files.save(graphId, bound);
    }
    // New content for a file this device built on. The check before it and the write are two
    // requests, so the file's revisions are read after: one between them that is neither this
    // device's base nor what it wrote is another device's work, and is kept as a conflict copy.
    async #update(meta, fileId, name, props, blob, base){
        const file = await this.drive.upload({fileId, name, appProperties: props, blob});
        try {
            const revisions = await this.drive.revisions(fileId);
            const at = revisions.findIndex( (r)=>r.id === file.headRevisionId );
            const between = revisions[at - 1];
            if (at > 0 && between?.md5Checksum && between.md5Checksum !== base && between.md5Checksum !== file.md5Checksum) {
                const theirs = await this.drive.downloadRevision(fileId, between.id);
                const copy = await this.#conflictUpload(meta, (await this.#folderIds())[0], theirs,
                    {neuriteUuid: meta.uuid, neuriteConflictOf: fileId}, 'another device');
                this.#set({newer: null, conflict: {name: copy.name, otherId: copy.id, otherName: copy.name, otherDevice: null, recovered: true}});
            }
        } catch (err) {
            Logger.warn("Could not read the file's revisions after a push:", err);
        }
        return file;
    }
    // The other device's file is left as it is, and this device's version goes up beside it.
    async #conflictCopy(meta, folder, remote, blob, props){
        const file = await this.#conflictUpload(meta, folder, blob, {...props, neuriteConflictOf: remote.id}, View.Graphs.deviceKind());
        // The Graph is bound to the copy now, so there is no newer copy of it to offer.
        this.#set({newer: null, conflict: {name: file.name, otherId: remote.id, otherName: remote.name,
                                           otherDevice: remote.appProperties?.neuriteDevice ?? null}});
        return file;
    }
    #conflictUpload(meta, folder, blob, appProperties, device){
        const base = (View.Graphs.fileNameFor(meta.title) || 'Graph.neurite').replace(/\.neurite$/i, '');
        const when = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
        return this.drive.upload({folderId: folder, name: `${base} (conflict, ${device}, ${when}).neurite`, blob, appProperties});
    }
    // Moved to the bin or deleted in Drive: someone's choice, so it is not undone. The Graph stops
    // syncing until it is asked to again.
    async #removed(meta, bound){
        await this.#bind(meta.graphId, {...bound, removed: true, pendingOp: null});
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
    // whatever has not gone up -- a push that failed, a rename -- goes now.
    check(){
        if (!this.isConnected) return Promise.resolve(null);
        this.#checking ??= this.#check().finally( ()=>{ this.#checking = null } );
        return this.#checking;
    }
    async #check(){
        const meta = this.views.selectedMeta;
        const generation = this.#generation;
        const bound = meta && this.#bound.get(meta.graphId);
        if (!bound?.fileId || bound.removed) {
            this.#set({newer: null, conflict: null, removed: bound?.removed ? {name: bound.name} : null});
            if (meta && !bound?.removed) this.#catchUp(meta, bound);
            return null;
        }
        try {
            const remote = await this.drive.get(bound.fileId).catch( (err)=>(err.reason === 'notFound' ? null : Promise.reject(err)) );
            // Only for the Graph and the binding it began with: another may be on screen now, or a push
            // may have bound this one afresh.
            if (generation !== this.#generation || this.views.selectedMeta?.graphId !== meta.graphId
                || this.#bound.get(meta.graphId) !== bound) return null;
            if (!remote || remote.trashed) return this.#removed(meta, bound);
            // Viewed differently elsewhere, with the same content: the file's checksum is this
            // device's to build on from now.
            let base = bound;
            if (remote.md5Checksum !== bound.md5 && CloudSync.#viewedOnly(remote, bound)) {
                base = {...bound, md5: remote.md5Checksum};
                await this.#bind(meta.graphId, base);
            }
            const newer = (remote.md5Checksum !== base.md5) ? CloudSync.#newerOf(remote) : null;
            // A conflict copy says so for as long as the Graph is bound to it, and a recovered one
            // until the Graph changes.
            const kept = this.status.conflict;
            const conflict = base.conflictOf
                ? ((kept?.otherId === base.conflictOf || kept?.recovered) ? kept : {name: base.name, otherId: base.conflictOf})
                : (kept?.recovered ? kept : null);
            this.#set({newer, conflict, removed: null, phase: this.status.phase === 'offline' ? 'idle' : this.status.phase});
            if (!newer) this.#catchUp(meta, base);
            return newer;
        } catch (err) {
            if (err?.reason === 'unauthorized') await this.refresh();
            else if (err?.reason === 'network') this.#set({phase: 'offline'});
            return null;
        }
    }
    // A Graph whose last save, or title, is not in Drive yet goes now.
    #catchUp(meta, bound){
        const written = this.#written.get(meta.graphId);
        const behind = written && (!bound?.fileId || written.signature !== bound.pushedSignature);
        if ((behind || (bound?.fileId && bound.title !== meta.title)) && !this.#pending.has(meta.graphId)) {
            this.#schedule(meta, {now: true});
        }
    }

    // The Graphs in Neurite's folders, the latest first, for Settings → Sync.
    async listFiles(){
        return this.drive.list(await this.#folderIds());
    }
    // Opened as Open… opens a file, and bound to the Drive file it came from. The Graph on screen
    // goes first -- saved, and pushed -- so none of it is left behind in a record nothing reaches; one
    // that could not go up is asked about. The save the opening makes pushes nothing, being what Drive
    // holds; and an open that did not happen -- refused, cancelled, failed -- binds nothing.
    async open(fileId){
        const outgoing = this.views.selectedMeta;
        await this.views.saveNow();
        await this.flush();
        if (outgoing && this.#written.get(outgoing.graphId) && !this.syncedAt(outgoing) && !this.#bound.get(outgoing.graphId)?.removed
            && String(await this.views.keeper.dataForMeta(outgoing) ?? '').includes('data-node_json')) {
            const go = await window.confirm(`The latest changes to “${outgoing.title}” could not go up to Google Drive. `
                + "Open the other graph anyway? Those changes stay in this browser.", {title: "Open from Google Drive?", ok: "Open"});
            if (!go) return null;
        }

        const meta = await this.drive.get(fileId);
        const blob = await this.drive.download(fileId);
        // Bound by the save the opening makes (`afterWrite`), which may come after the open settles.
        this.#opening = meta.appProperties?.neuriteUuid ? {...meta, uuid: meta.appProperties.neuriteUuid} : null;
        await this.views.importFile(new File([blob], meta.name, {type: GoogleDrive.FILE_TYPE}));
        const opened = this.views.selectedMeta;
        if (!opened || opened.graphId === outgoing?.graphId) {
            this.#opening = null;
            return null;
        }
        this.#set({newer: null, conflict: null, removed: null});
        this.views.refreshSaveNote?.();
        this.check();
        return opened;
    }

    // For the save note: when the Graph on screen went to Drive as it is now, or null -- not while a
    // push is waiting for it, or after one failed.
    syncedAt(meta){
        const bound = meta?.graphId && this.#bound.get(meta.graphId);
        const written = meta?.graphId && this.#written.get(meta.graphId);
        if (!bound?.pushedAt || bound.removed || this.#pending.has(meta.graphId) || this.#failures.has(meta.graphId)) return null;
        return (!written || written.signature === bound.pushedSignature) ? bound.pushedAt : null;
    }
}
