// Settings → Sync (docs/cloud-sync.md): Google Drive's row -- Connect, or the account and how the
// last push went -- then this Graph's row, which offers what it needs (a newer copy in Drive, the
// other side of a conflict, a file removed from Drive), and the Graphs in Neurite's folder, each
// with Open. Everything here is said from `CloudSync.status`, which it is told of as it changes.
const SyncPage = {
    sync: null,
    note: Elem.byId('sync-note'),
    button: Elem.byId('sync-connect'),
    graphRow: Elem.byId('sync-graph-row'),
    graphNote: Elem.byId('sync-graph-note'),
    graphAction: Elem.byId('sync-graph-action'),
    filesGroup: Elem.byId('sync-files-group'),
    files: Elem.byId('sync-files'),
    filesNote: Elem.byId('sync-files-note'),
    action: null,
    listedAt: null,

    init(sync){
        if (!SyncPage.button) return;
        SyncPage.sync = sync;
        sync.onStatus = SyncPage.render;
        On.click(SyncPage.button, SyncPage.onConnectClicked);
        On.click(SyncPage.graphAction, ()=>SyncPage.action?.());
        On.click(Elem.byId('sync-files-refresh'), SyncPage.loadFiles);
        const shown = SettingsModal.onShow;
        SettingsModal.onShow = (page)=>{ shown(page); if (page === 'sync') SyncPage.onShown() };
        SyncPage.render(sync.status);
    },

    // Google's sign-in is loaded before the click that opens it (a browser's popup must open in
    // the click's own turn), and the list is read.
    onShown(){
        SyncPage.sync.auth?.prepare?.()?.catch?.( (err)=>Logger.warn(err) );
        SyncPage.sync.refresh().then( ()=>SyncPage.sync.check() );
        SyncPage.loadFiles();
    },

    // In the click's own turn: the browser's sign-in opens a popup.
    onConnectClicked(){
        const sync = SyncPage.sync;
        if (sync.isConnected) return sync.disconnect();
        SyncPage.button.setAttribute('aria-disabled', 'true');
        sync.connect().finally( ()=>{
            SyncPage.button.removeAttribute('aria-disabled');
            SyncPage.loadFiles();
        });
    },

    wordsFor(s){
        switch (s.phase) {
            case 'starting': return ["Checking…", "Connect", true];
            case 'not-configured': return ["Google Drive is not set up in this build.", "Connect", true];
            case 'needs-click': return ["Connect again to keep syncing: a browser's sign-in lasts an hour.", "Connect again", false];
            case 'disconnected': return [s.error ?? "Keep every graph you work on in a Neurite folder in your Google Drive, "
                                         + "and open it on another device.", "Connect", false];
        }
        const who = s.account ? `Connected as ${s.account}.` : "Connected.";
        const how = {pushing: " Syncing…", offline: " Offline: the next change tries again.",
                     error: ` The last sync did not finish: ${s.error ?? 'unknown error'}`}[s.phase] ?? '';
        return [who + how, "Disconnect", false];
    },

    render(s){
        const [note, label, disabled] = SyncPage.wordsFor(s);
        if (SyncPage.note.textContent !== note) SyncPage.note.textContent = note;
        SyncPage.note.classList.toggle('is-warning', s.phase === 'error' || s.phase === 'needs-click');
        SyncPage.button.textContent = label;
        SyncPage.button.hidden = (s.phase === 'not-configured');
        if (disabled) SyncPage.button.setAttribute('aria-disabled', 'true');
        else SyncPage.button.removeAttribute('aria-disabled');

        const connected = SyncPage.sync?.isConnected ?? false;
        SyncPage.graphRow.hidden = !connected;
        SyncPage.filesGroup.hidden = !connected;
        if (connected) SyncPage.renderGraph(s);
        // A push changes the list; it is read again while the page is in view.
        if (connected && s.lastPushAt !== SyncPage.listedAt && SettingsModal.isOpen() && SettingsModal.page === 'sync') {
            SyncPage.loadFiles();
        }
    },

    // This Graph's row: the one thing it needs, most urgent first.
    renderGraph(s){
        const sync = SyncPage.sync;
        const ago = (t)=>View.Graphs.ago(typeof t === 'string' ? Date.parse(t) : t);
        const named = (name)=>String(name ?? '').replace(/\.neurite$/i, '');
        let note, label = null, action = null, warn = false;
        if (s.removed) {
            note = `“${named(s.removed.name)}” was removed from Google Drive, so this graph is not synced.`;
            [label, action] = ["Sync it again", ()=>sync.syncAgain()];
        } else if (s.newer) {
            const where = s.newer.device ? ` on the ${s.newer.device}` : '';
            note = `A newer copy is in Google Drive, saved${where} ${ago(s.newer.modifiedTime)}.`;
            [label, action, warn] = ["Open it", ()=>SyncPage.open(s.newer.fileId), true];
        } else if (s.conflict) {
            note = `This graph changed here and on another device, so it is kept in Google Drive as “${named(s.conflict.name)}”, `
                 + "beside the other copy.";
            [label, action, warn] = ["Open the other copy", ()=>SyncPage.open(s.conflict.otherId), true];
        } else {
            const at = sync.syncedAt(App.viewGraphs.selectedMeta);
            note = at ? `Synced ${ago(at)}.`
                 : (Object.keys(Graph.nodes).length ? "Goes up to Google Drive after its next change."
                                                    : "Goes up to Google Drive once it has a note.");
        }
        if (SyncPage.graphNote.textContent !== note) SyncPage.graphNote.textContent = note;
        SyncPage.graphNote.classList.toggle('is-warning', warn);
        SyncPage.graphAction.hidden = !label;
        SyncPage.graphAction.textContent = label ?? '';
        SyncPage.action = action;
    },

    async loadFiles(){
        const sync = SyncPage.sync;
        if (!sync?.isConnected) return;
        SyncPage.listedAt = sync.status.lastPushAt;
        let files = [];
        try { files = await sync.listFiles() }
        catch (err) {
            SyncPage.filesNote.textContent = "Google Drive's list could not be read. Refresh tries again.";
            return;
        }
        SyncPage.filesNote.textContent = files.length
            ? "The graphs in the Neurite folder of your Drive. Open one to carry on with it here."
            : "The Neurite folder in your Drive has no graphs yet.";
        SyncPage.files.replaceChildren(...files.map(SyncPage.rowFor));
    },
    rowFor(file){
        const row = Html.make.div('settings-row');
        row.setAttribute('role', 'listitem');
        const text = Html.make.div('settings-row-text');
        const name = Html.make.span('settings-label');
        name.textContent = file.name.replace(/\.neurite$/i, '');
        const when = Html.make.span('settings-description');
        const device = file.appProperties?.neuriteDevice;
        when.textContent = (device ? `From the ${device}, ` : '') + View.Graphs.ago(Date.parse(file.modifiedTime));
        text.append(name, when);
        const open = Html.make.button('key-button', "Open");
        open.type = 'button';
        open.setAttribute('aria-label', `Open ${name.textContent}`);
        On.click(open, ()=>SyncPage.open(file.id));
        row.append(text, open);
        return row;
    },

    async open(fileId){
        try {
            await SyncPage.sync.open(fileId);
            SettingsModal.close();
        } catch (err) {
            Logger.warn("Could not open from Google Drive:", err);
            alert("This graph could not be opened from Google Drive. The graph on screen is unchanged.");
        }
    }
};
