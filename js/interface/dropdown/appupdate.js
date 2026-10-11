// The Mac app's own updates (#76), a section of Settings since #78 and a page of the Settings
// modal since #82. Only the app has the bridge (`window.neuriteDesktop`, desktop/preload.cjs); in
// a browser the section and its place in the modal's sidebar stay hidden.
//
// The button is the refresh the issue asks for: it checks, and the note beside it says what the
// check found. Once a newer release is found, the button installs it -- the app saves the Graph,
// closes, swaps itself for the new one and opens again (desktop/updater.cjs) -- and until then a
// dot on the menu button and another on the Settings row lead to it, because the check that
// finds one is the one nobody asked for. A third dot, on Updates in the sidebar, and the modal
// opens on that page while one is ready (`settingsmodal.js`).
const AppUpdate = {
    bridge: window.neuriteDesktop?.update ?? null,
    section: Elem.byId('updateSettings'),
    row: Elem.byId('update-button'),
    note: Elem.byId('update-note'),
    settingsRow: Elem.byId('settings-button'),
    navItem: Elem.byId('settingsNavUpdates'),
    state: {phase: 'idle'},
    busy: new Set(['checking', 'downloading', 'installing']),

    init(){
        if (!AppUpdate.bridge || !AppUpdate.row) return;

        AppUpdate.section.hidden = false;
        AppUpdate.navItem.hidden = false;
        AppUpdate.bridge.onState(AppUpdate.render);
        AppUpdate.bridge.state().then(AppUpdate.render);
        On.click(AppUpdate.row, AppUpdate.onClick);
    },

    // Why a release that was found cannot install itself here, with what to do instead. The
    // button then opens the release's page.
    blockedWords: {
        'translocated': "This copy runs where it was downloaded. Move Neurite to Applications, open it "
                      + "from there, then update.",
        'read-only': "Neurite cannot write to its folder. Move it to Applications, or replace it by hand.",
        'no-asset': "This release has no Mac app. Its page has the rest.",
        'unverified': "This release's Mac app has no checksum to check a download against, so it is "
                    + "not installed from here. Its page has the download.",
        'not-bundled': "This copy runs from a checkout, which updates with git.",
        'profile-inside': "This copy keeps its graphs inside the app, so it does not replace itself. "
                        + "Save each graph to a file with Save to… before you replace it.",
    },

    // The button's label, the note beside it, and whether the note is a warning.
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
        // A row's name is built from its contents ("Settings"), so it is only named outright
        // while it has something more to say.
        for (const [row, name] of [[AppUpdate.settingsRow, "Settings"], [AppUpdate.navItem, "Updates"]]) {
            row.classList.toggle('update-ready', ready);
            if (ready) row.setAttribute('aria-label', name + ", with an update ready");
            else row.removeAttribute('aria-label');
        }
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

    // A call the main process could not answer is said in the note, not dropped: the button
    // would otherwise go on offering an update that is not coming.
    ask(call){
        Promise.resolve(call).catch( (err)=>{
            Logger.warn("The update call failed:", err);
            AppUpdate.render({...AppUpdate.state, phase: 'failed', error: "The update could not be started. Try again."});
        });
    }
}

AppUpdate.init();
