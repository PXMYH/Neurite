// The Mac app updates itself (#76): it looks for a newer release 20 seconds after it opens and
// every six hours after, and when asked; asked to install, it downloads the release's DMG,
// checks it against the hash GitHub took of it, copies the app out of it beside the running one,
// saves the Graph, quits, and a detached shell swaps the bundles and opens the new one -- and
// puts the old one back if the new one does not start. The page sees all of it through
// `preload.cjs`. Why not Squirrel, and the parts that need no Electron, are in update-core.cjs.
'use strict';

const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
// For removing bundles. Electron's own fs reads an app.asar as a folder, and so could not delete
// one: a stage left by an update that did not take survived its clearing (measured), its
// `rm` failing inside the archive.
const bundleFs = require('original-fs').promises;
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const core = require('./update-core.cjs');

const run = promisify(execFile);
// Another feed for the tests: a local server standing in for the releases API.
const FEED = process.env.NEURITE_UPDATE_FEED || core.RELEASES;
const FIRST_CHECK_MS = 20 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
// A feed or a download that sends nothing for this long is given up on. Without a limit, a
// response that stalled half way kept the row busy, and so turned every later check away,
// until the app was restarted.
const STALL_MS = 30 * 1000;
const SAVE_MS = 10 * 1000;
// A quit that has not ended the app by then was cancelled (a page's `beforeunload`, a window
// that would not close), and the update is taken back rather than left "installing".
const QUIT_MS = 25 * 1000;
// Whether the page's graph is kept, asked the way an update has to ask: `saveNow` resolves
// `false` when the last graph did not reopen and nothing is being saved, and resolves at all
// when the first write of a new graph fails, which only `lastSaveError` says (savenet.js).
const SAVED = 'Promise.resolve(App.viewGraphs?.saveNow?.())'
            + '.then((saved) => saved !== false && !App.viewGraphs?.lastSaveError)';

// What the page is told: `phase` is one of idle, checking, current, available, downloading,
// installing, failed and updated, and the rest says what goes with it.
let state = { phase: 'idle' };
let found = null;               // the newest check's `pickUpdate`, while it is available
let checking = null;            // the check in flight, which a second asks after rather than repeats
let installing = false;
let pending = null;             // the stage and version a quit is under way for

function publish(next) {
    state = { current: app.getVersion(), ...next };
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('update:state', state);
    }
    return state;
}

const bundle = () => core.bundleOf(app.getPath('exe'));
// Written before the app quits to install, read when it opens again: the version it went for
// is the version it is, or the swap did not happen. The swap script waits on it too.
const markerFile = () => path.join(app.getPath('userData'), 'update-pending.json');
const logFile = () => path.join(app.getPath('userData'), 'update.log');

// Why this copy cannot install what was found, or null. The way out of each is the release page.
async function blocked(update) {
    if (!update.asset) return 'no-asset';
    if (!update.asset.sha256) return 'unverified';
    const problem = core.placeProblem(bundle());
    if (problem) return problem;
    if (core.profileInside(app.getPath('userData'), bundle())) return 'profile-inside';
    try { await fsp.access(path.dirname(bundle()), fs.constants.W_OK) }
    catch { return 'read-only' }
    return null;
}

function check() {
    if (installing) return Promise.resolve(state);
    checking ??= (async () => {
        // A check while an update is waiting leaves it on show: the six-hourly one would
        // otherwise turn "Update to x" back into "Check for updates" under a reader about to
        // press it.
        if (state.phase !== 'available') publish({ phase: 'checking' });
        try {
            const res = await net.fetch(FEED, { headers: { accept: 'application/vnd.github+json' },
                                                signal: AbortSignal.timeout(STALL_MS) });
            if (!res.ok) throw new Error(`the releases answered ${res.status}`);
            const update = core.pickUpdate(await res.json(), app.getVersion());
            // An install that began while this was in flight owns the state now.
            if (installing) return state;
            found = update;
            if (!update) return publish({ phase: 'current' });
            const why = await blocked(update);
            if (installing) return state;
            return publish({ phase: 'available', version: update.version, page: update.page, blocked: why });
        } catch (err) {
            if (installing) return state;
            return publish({ phase: 'failed', error: `Could not check for updates: ${reason(err)}.` });
        }
    })().finally(() => { checking = null });
    return checking;
}

const reason = (err) => (err?.name === 'TimeoutError' || err?.name === 'AbortError')
    ? 'nothing arrived for 30 seconds' : err?.message ?? String(err);

// `choice` is what the page showed and the reader answered: the version, and whether they
// confirmed an install. A release that changed under the question, or a confirm the page did
// not ask for, installs nothing.
async function install(choice) {
    const update = found;
    if (installing || state.phase !== 'available' || !update || choice?.version !== update.version) return state;
    // Taken before the first await: two calls in one tick both passed the line above.
    installing = true;
    const why = await blocked(update);
    if (why) {
        installing = false;
        shell.openExternal(update.page);
        // Found only now -- the folder became read-only since the check -- so the row is told.
        return publish({ ...state, blocked: why });
    }
    // The page thought there was nothing to confirm, and there is: it is told again, and asks.
    if (choice.confirmed !== true) {
        installing = false;
        return publish({ ...state, blocked: null });
    }

    const { version, asset } = update;
    const target = bundle();
    const staged = path.join(path.dirname(target), core.stagedName(path.basename(target), version));
    let work = null;
    try {
        work = await fsp.mkdtemp(path.join(app.getPath('temp'), 'neurite-update-'));
        publish({ phase: 'downloading', version, progress: 0 });
        const dmg = path.join(work, `Neurite-${version}-arm64.dmg`);
        await download(asset, dmg, version);

        publish({ phase: 'installing', version });
        const mount = path.join(work, 'mount');
        await fsp.mkdir(mount);
        await run('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mount]);
        try {
            await bundleFs.rm(staged, { recursive: true, force: true });
            await run('/usr/bin/ditto', [path.join(mount, 'Neurite.app'), staged]);
        } finally {
            await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {});
        }
        await checkBundle(staged, version, target);

        // Saved here, where a failure can still stop the update. The window's close saves
        // again, but it closes whatever its save does, which is right for a quit and not for
        // a quit the app chose.
        if (!await saveGraph()) throw new Error('the graph could not be saved first');

        await fsp.writeFile(markerFile(), JSON.stringify({ version, from: app.getVersion() }));
        // The profile it ran with, so the new copy opens the same graphs: a test's, or the
        // reader's own when there is no such argument.
        const args = process.argv.slice(1).filter((arg) => arg.startsWith('--user-data-dir='));
        spawn('/bin/sh', ['-c', core.SWAP_SCRIPT, 'neurite-update', String(process.pid), target, staged,
                          markerFile(), logFile(), path.basename(app.getPath('exe')), '/usr/bin/open', ...args],
              { detached: true, stdio: 'ignore' }).unref();
        pending = { staged, version };
        setTimeout(() => stayOpen('Neurite did not close'), QUIT_MS).unref?.();
        app.quit();
    } catch (err) {
        installing = false;
        await bundleFs.rm(staged, { recursive: true, force: true }).catch(() => {});
        publish({ phase: 'failed', version,
                  error: `${version} did not install: ${reason(err)}. Neurite ${app.getVersion()} is unchanged.` });
    } finally {
        if (work) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }
    return state;
}

// Streamed to disk and hashed on the way, so a 145 MB DMG is never held in memory, and given
// up on when nothing arrives for STALL_MS.
async function download(asset, file, version) {
    const stop = new AbortController();
    let idle = setTimeout(() => stop.abort(new Error('nothing arrived for 30 seconds')), STALL_MS);
    const awake = () => {
        clearTimeout(idle);
        idle = setTimeout(() => stop.abort(new Error('nothing arrived for 30 seconds')), STALL_MS);
    };
    try {
        const res = await net.fetch(asset.url, { signal: stop.signal });
        if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
        const total = Number(res.headers.get('content-length')) || asset.size || 0;
        const hash = crypto.createHash('sha256');
        let got = 0;
        let shown = 0;
        const count = new Transform({
            transform(chunk, _, done) {
                awake();
                hash.update(chunk);
                got += chunk.length;
                const progress = total ? Math.min(99, Math.floor(got * 100 / total)) : 0;
                if (progress !== shown) publish({ phase: 'downloading', version, progress: (shown = progress) });
                done(null, chunk);
            },
        });
        await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(file), { signal: stop.signal });
        if (hash.digest('hex') !== asset.sha256) throw new Error('the download does not match its release');
    } catch (err) {
        throw stop.signal.aborted ? stop.signal.reason : err;
    } finally {
        clearTimeout(idle);
    }
}

// The copy is whole (its seal), is this app (its bundle id), and is the version it says in both
// places one is kept: Info.plist, and the package.json `app.getVersion()` reads. A copy that
// agreed in one and not the other installed, then reported that it had not.
async function checkBundle(staged, version, target) {
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    const read = async (bundlePath, key) =>
        (await run('/usr/bin/plutil', ['-extract', key, 'raw', path.join(bundlePath, 'Contents', 'Info.plist')])).stdout.trim();
    if (await read(staged, 'CFBundleIdentifier') !== await read(target, 'CFBundleIdentifier')) {
        throw new Error('the download is not Neurite');
    }
    if (await read(staged, 'CFBundleShortVersionString') !== version) throw new Error(`the download is not ${version}`);
    const pkg = JSON.parse(fs.readFileSync(path.join(staged, 'Contents', 'Resources', 'app.asar', 'package.json'), 'utf8'));
    if (pkg.version !== version) throw new Error(`the download calls itself ${pkg.version}, not ${version}`);
}

// The page's own save, the one a quit waits for, within the same limit (SAVED).
async function saveGraph(win = BrowserWindow.getAllWindows()[0]) {
    if (!win || win.isDestroyed()) return true;
    const save = win.webContents.executeJavaScript(SAVED);
    const limit = new Promise((resolve) => setTimeout(() => resolve(false), SAVE_MS));
    return Promise.race([save, limit]).catch(() => false);
}

// A quit for an update that did not happen -- the window's last save failed, or the quit was
// cancelled -- takes the update back: the stage and the marker go, so the swap script, which
// waits on the pid and finds no stage, changes nothing whenever the app does quit.
async function stayOpen(why) {
    if (!pending) return;
    const { staged, version } = pending;
    pending = null;
    await fsp.rm(markerFile(), { force: true }).catch(() => {});
    await bundleFs.rm(staged, { recursive: true, force: true }).catch(() => {});
    installing = false;
    publish({ phase: 'failed', version, error: `${version} did not install: ${why}. Neurite ${app.getVersion()} is unchanged.` });
}

// Asked by the window's close (main.cjs): is this a quit for an update.
const quitting = () => Boolean(pending);

// After an update, once the window's page is up (`watch`): say whether the update happened, and
// so tell the swap script, which waits on the marker, that this copy started. Up means the page
// says so (`appReady`, the last line of App.init), not that the main process got this far: a
// release whose frontend throws on load is rolled back as well.
async function confirmStarted() {
    try {
        const told = core.afterUpdate(JSON.parse(await fsp.readFile(markerFile(), 'utf8')), app.getVersion());
        await fsp.rm(markerFile(), { force: true });
        if (told) publish(told);
    } catch { /* no update was under way */ }
}

// Up, and with the graph back: `appReady` comes before the saved graph is restored, and a
// release that could not restore it would otherwise have taken the old bundle with it.
const UP = 'window.appReady === true && Promise.resolve(App.viewGraphs?.whenRestored).then((ok) => ok === true)';

function watch(win) {
    if (!app.isPackaged) return;
    win.webContents.once('did-finish-load', async () => {
        for (let tries = 0; tries < 120 && !win.isDestroyed(); tries++) {
            if (await win.webContents.executeJavaScript(UP).catch(() => false)) return confirmStarted();
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    });
}

// A copy staged by an update that never swapped (the app did not quit within a minute) is
// cleared away -- only this bundle's own stages.
async function afterLaunch() {
    const target = bundle();
    const dir = path.dirname(target);
    for (const name of await fsp.readdir(dir).catch(() => [])) {
        const stagedPath = path.join(dir, name);
        if (stagedPath === target || !core.isStagedFor(name, path.basename(target))) continue;
        await bundleFs.rm(stagedPath, { recursive: true, force: true }).catch(() => {});
    }
}

// Only the app's own page may ask, never a frame inside it.
const fromApp = (event) => Boolean(event.senderFrame?.url?.startsWith('app://neurite/') && !event.senderFrame.parent);

function init() {
    ipcMain.handle('update:state', () => state);
    ipcMain.handle('update:check', (event) => (fromApp(event) ? check() : state));
    ipcMain.handle('update:install', (event, choice) => (fromApp(event) ? install(choice) : state));
    // A checkout has no bundle to replace; it is told so if it asks, and is never asked for.
    if (!app.isPackaged) return;
    afterLaunch();
    setTimeout(check, FIRST_CHECK_MS);
    setInterval(check, EVERY_MS);
}

module.exports = { init, watch, quitting, saveGraph, stayOpen };
