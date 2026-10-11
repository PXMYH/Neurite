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

const execFileP = promisify(execFile);
// Every tool with a deadline: one that hung (a stuck `hdiutil`) kept the row "installing" for
// good, the quit's own watchdog not having started yet.
const run = (cmd, args) => execFileP(cmd, args, { timeout: 120 * 1000 });
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
// Written by the new copy, with its version, once it is up: what the swap script waits on.
const startedFile = () => path.join(app.getPath('userData'), 'update-started');

// Why this copy cannot install what was found, or null. The way out of each is the release page.
async function blocked(update) {
    if (!update.asset) return 'no-asset';
    if (!update.asset.sha256) return 'unverified';
    const problem = core.placeProblem(bundle());
    if (problem) return problem;
    // On the real paths: a symlink, or another casing on APFS, put a profile inside the bundle
    // past a comparison of the text.
    const real = (p) => { try { return fs.realpathSync.native(p) } catch { return p } };
    if (core.profileInside(real(app.getPath('userData')), real(bundle()))) return 'profile-inside';
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

        // An AI answer streaming into a note goes on writing after the save has taken its copy,
        // and no hold stops it, so an update waits for it to finish.
        if (await aiBusy()) throw new Error('an AI answer is still coming in; update once it is done');

        // Saved here, where a failure can still stop the update, with the page held still from
        // now: a save takes its copy of the graph before it writes it, so an edit typed during
        // the write would go with the old app.
        await hold(true);
        if (!await saveGraph()) throw new Error('the graph could not be saved first');

        await fsp.rm(startedFile(), { force: true });
        await fsp.writeFile(markerFile(), JSON.stringify({ version, from: app.getVersion() }));
        // The profile it ran with, so the new copy opens the same graphs: a test's, or the
        // reader's own when there is no such argument.
        const args = process.argv.slice(1).filter((arg) => arg.startsWith('--user-data-dir='));
        spawn('/bin/sh', ['-c', core.SWAP_SCRIPT, 'neurite-update', String(process.pid), target, staged,
                          markerFile(), startedFile(), version, logFile(), path.basename(app.getPath('exe')),
                          '/usr/bin/open', ...args],
              { detached: true, stdio: 'ignore' }).unref();
        pending = { staged, version };
        setTimeout(() => stayOpen('Neurite did not close'), QUIT_MS).unref?.();
        app.quit();
    } catch (err) {
        installing = false;
        await hold(false);
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
    // The swap's rollback finds a stuck copy by its executable's path, so it has to be the same.
    if (await read(staged, 'CFBundleExecutable') !== await read(target, 'CFBundleExecutable')) {
        throw new Error('the download runs under another name');
    }
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
    await hold(false);
    installing = false;
    publish({ phase: 'failed', version, error: `${version} did not install: ${why}. Neurite ${app.getVersion()} is unchanged.` });
}

// The page held still (`inert`) through the last save and the quit, or let go again.
async function hold(on, win = BrowserWindow.getAllWindows()[0]) {
    if (!win || win.isDestroyed()) return;
    await win.webContents.executeJavaScript(`document.body.inert = ${on === true}`).catch(() => {});
}

async function aiBusy(win = BrowserWindow.getAllWindows()[0]) {
    if (!win || win.isDestroyed()) return false;
    return win.webContents.executeJavaScript("typeof activeRequests !== 'undefined' && activeRequests.size > 0")
        .catch(() => false);
}

// Asked by the window's close (main.cjs): is this a quit for an update.
const quitting = () => Boolean(pending);

// After an update, once the window's page is up (`watch`): say whether the update happened, and
// tell the swap script this copy started by writing its version where the script waits for it.
// Up means the page says so and its graph is back (`appReady`, then `whenRestored`) with none
// of its cards lost: the main process
// getting this far was the signal once, and a release whose frontend throws on load, or that
// cannot rebuild a kind of card, then took the old bundle with it. Only the version the update
// went for says it started; an older copy opened on the profile meanwhile reads the marker and
// says the update did not install, and the script, still waiting, puts the old bundle back.
async function confirmStarted(marker) {
    const told = core.afterUpdate(marker, app.getVersion());
    if (told?.phase === 'updated') {
        // Said before anything else, and nothing is said if it cannot be: the script then puts
        // the old copy back, and the marker, still there, lets that copy say why.
        if (!await fsp.writeFile(startedFile(), app.getVersion()).then(() => true, () => false)) return;
        // A swap script still waiting takes the file and clears its own backup within a tenth of
        // a second. One stopped half way (a reboot) leaves both, and the backup is cleared here --
        // never sooner: the backup is what a live script would put back.
        setTimeout(clearStranded, 15000).unref?.();
    }
    await fsp.rm(markerFile(), { force: true }).catch(() => {});
    // `confirmed` ends the page's probation (preload.cjs); a check failing meanwhile does not.
    if (told) publish({ ...told, confirmed: true });
}

// For the window this copy opens (main.cjs): whether it is an update on probation, in which case
// its page saves nothing until `confirmStarted` -- a copy that would not be confirmed (it lost a
// card) wrote its short graph over the old one's during the minute before the old one came back.
function webPreferences() {
    const onProbation = app.isPackaged && fs.existsSync(markerFile());
    return onProbation ? { additionalArguments: ['--neurite-update-probation'] } : {};
}

function watch(win) {
    if (!app.isPackaged) return;
    win.webContents.once('did-finish-load', async () => {
        let marker;
        try { marker = JSON.parse(await fsp.readFile(markerFile(), 'utf8')) }
        catch { return }                               // no update under way
        // Every card the old copy saved: its last save, which the update checked, holds only
        // the cards it could rebuild, so the new copy may skip none (the count once allowed the
        // old copy's own, which its save had already dropped).
        const up = `window.appReady === true && Promise.resolve(App.viewGraphs?.whenRestored)
            .then((ok) => ok === true && (App.viewGraphs?.restoreSkipped ?? 0) === 0)`;
        for (let tries = 0; tries < 120 && !win.isDestroyed(); tries++) {
            if (await win.webContents.executeJavaScript(up).catch(() => false)) return confirmStarted(marker);
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    });
}

// The bundle an interrupted swap left beside this one (a reboot half way), once this copy has
// started and no script came for the started file: an old copy kept for nothing.
async function clearStranded() {
    try { await fsp.access(startedFile()) } catch { return }   // a live script took it
    await fsp.rm(startedFile(), { force: true }).catch(() => {});
    const target = bundle();
    const dir = path.dirname(target);
    for (const name of await fsp.readdir(dir).catch(() => [])) {
        if (!core.isReplacedFor(name, path.basename(target))) continue;
        await bundleFs.rm(path.join(dir, name), { recursive: true, force: true }).catch(() => {});
    }
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

module.exports = { init, watch, webPreferences, quitting, saveGraph, stayOpen };
