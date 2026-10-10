// The Mac app's own updates (#76), as a command row in the menu. Only the app has the bridge
// (`window.neuriteDesktop`, desktop/preload.cjs); in a browser the row and its note stay hidden.
//
// The row is the refresh the issue asks for: it checks, and the note under it says what the
// check found. Once a newer release is found, the row installs it -- the app saves the Graph,
// closes, swaps itself for the new one and opens again (desktop/updater.cjs) -- and the menu
// button carries a dot until then, because the check that finds one is the one nobody asked for.
const AppUpdate = {
    bridge: window.neuriteDesktop?.update ?? null,
    row: Elem.byId('update-button'),
    note: Elem.byId('update-note'),
    state: {phase: 'idle'},
    busy: new Set(['checking', 'downloading', 'installing']),

    init(){
        if (!AppUpdate.bridge || !AppUpdate.row) return;

        AppUpdate.row.hidden = false;
        AppUpdate.note.hidden = false;
        AppUpdate.bridge.onState(AppUpdate.render);
        AppUpdate.bridge.state().then(AppUpdate.render);
        On.click(AppUpdate.row, AppUpdate.onClick);
    },

    // Why a release that was found cannot install itself here, with what to do instead. The
    // row then opens the release's page.
    blockedWords: {
        'translocated': "This copy runs where it was downloaded. Move Neurite to Applications, open it "
                      + "from there, then update.",
        'read-only': "Neurite cannot write to its folder. Move it to Applications, or replace it by hand.",
        'no-asset': "This release has no Mac app. Its page has the rest.",
        'unverified': "This release's Mac app has no checksum to check a download against, so it is "
                    + "not installed from here. Its page has the download.",
        'not-bundled': "This copy runs from a checkout, which updates with git.",
        'profile-inside': "This copy keeps its graphs inside the app, and replacing the app would take "
                        + "them with it. Install the new version by hand.",
    },

    // The row's label, the note under it, and whether the note is a warning.
    wordsFor(s){
        const check = "Check for updates";
        switch (s.phase) {
            case 'checking': return [check, "Checking…", false];
            case 'current': return [check, `Neurite ${s.current} is the newest.`, false];
            case 'available': return s.blocked
                ? [`Download ${s.version}…`, AppUpdate.blockedWords[s.blocked] ?? "", false]
                : [`Update to ${s.version}`, `Neurite ${s.version} is out. This is ${s.current}.`, false];
            case 'downloading': return [`Updating to ${s.version}…`, `Downloading, ${s.progress ?? 0}%.`, false];
            case 'installing': return [`Updating to ${s.version}…`, "Installing. Neurite will close and open again.", false];
            case 'failed': return [check, s.error ?? "The update did not install.", true];
            case 'updated': return [check, `Updated to ${s.current}.`, false];
            default: return [check, "", false];
        }
    },

    render(state){
        const s = AppUpdate.state = state ?? {phase: 'idle'};
        const [label, note, isWarning] = AppUpdate.wordsFor(s);
        const ready = (s.phase === 'available' && !s.blocked);

        AppUpdate.row.querySelector('.menu-row-label').textContent = label;
        AppUpdate.row.querySelector('use')?.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href',
            (s.phase === 'available') ? '#download-icon' : '#refresh-icon');
        AppUpdate.row.setAttribute('aria-disabled', String(AppUpdate.busy.has(s.phase)));
        if (AppUpdate.note.textContent !== note) AppUpdate.note.textContent = note;
        AppUpdate.note.classList.toggle('is-warning', isWarning);

        menuButton.classList.toggle('update-ready', ready);
        menuButton.setAttribute('aria-label', ready ? "Menu, with an update ready" : "Menu");
    },

    async onClick(){
        const s = AppUpdate.state;
        if (AppUpdate.busy.has(s.phase)) return;
        if (s.phase !== 'available') return AppUpdate.ask(AppUpdate.bridge.check());

        // The app is about to close under the reader, so it asks; a release it cannot install
        // only opens a page, so that does not. The answer goes with the version it was about,
        // and the main process installs nothing it was not confirmed for.
        const confirmed = !s.blocked
            && await window.confirm(`Neurite saves this graph, closes, installs ${s.version} and opens again.`,
                                    {title: `Update to Neurite ${s.version}?`, ok: "Update"});
        if (!s.blocked && !confirmed) return;
        AppUpdate.ask(AppUpdate.bridge.install({version: s.version, confirmed}));
    },

    // A call the main process could not answer is said in the note, not dropped: the row would
    // otherwise go on offering an update that is not coming.
    ask(call){
        Promise.resolve(call).catch( (err)=>{
            Logger.warn("The update call failed:", err);
            AppUpdate.render({...AppUpdate.state, phase: 'failed', error: "The update could not be started. Try again."});
        });
    }
}

AppUpdate.init();
