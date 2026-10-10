// The Mac app updates itself (#76), for real: a packaged build in a scratch folder finds a newer
// build on a local feed, downloads it, checks it, quits, is swapped for it and opens again with
// the same graphs. The newer build is the same app with the next patch version, sealed again.
//
// NEURITE_APP=<.../Neurite.app/Contents/MacOS/Neurite> names the packaged build, as for the smoke
// test; without it this file skips, since a checkout has no bundle to replace. It never touches
// /Applications or the reader's profile, and it stops only the copies it started.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import * as asar from '@electron/asar';

const packaged = process.env.NEURITE_APP;
const skip = !packaged && 'needs NEURITE_APP, a packaged build';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
const plistOf = (bundle) => join(bundle, 'Contents', 'Info.plist');
const versionOf = (bundle) => run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plistOf(bundle)]).trim();
const bump = (version) => version.replace(/(\d+)$/, (patch) => String(Number(patch) + 1));
const pidsOf = (bundle) => run('/bin/ps', ['-axo', 'pid=,args=']).split('\n')
    .filter((line) => line.includes(join(bundle, 'Contents', 'MacOS', 'Neurite')))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
// A read that throws -- a file not written yet -- is a "not yet".
const waitFor = async (what, ms, read) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
        let got = false;
        try { got = read() } catch { /* not yet */ }
        if (got) return got;
    }
    throw new Error(`timed out waiting for ${what}`);
};

const work = mkdtempSync(join(tmpdir(), 'neurite-update-e2e-'));
const started = [];
let server;
after(async () => {
    server?.close();
    for (const bundle of started) for (const pid of pidsOf(bundle)) { try { process.kill(pid) } catch {} }
    // A copy still closing writes into its profile while the folder goes.
    await waitFor('the copies to stop', 15000, () => started.every((bundle) => pidsOf(bundle).length === 0)).catch(() => {});
    rmSync(work, { recursive: true, force: true });
});

// The running copy, in a folder of its own, and a DMG of the build after it -- one that never
// gets as far as opening, when `starts` is false: its main process waits forever, with no window
// and no dialog, which is the case the swap's watchdog has to stop as well as notice; or, when
// `pageUp` is false, one whose window opens on a page that never comes up.
async function prepare(name, { starts = true, pageUp = true } = {}) {
    const source = packaged.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    const dir = join(work, name);
    const apps = join(dir, 'Applications');
    const stage = join(dir, 'dmg');
    mkdirSync(apps, { recursive: true });
    mkdirSync(stage);
    const app = join(apps, 'Neurite.app');
    run('/usr/bin/ditto', [source, app]);
    started.push(app);

    const current = versionOf(app);
    const next = bump(current);
    const nextApp = join(stage, 'Neurite.app');
    run('/usr/bin/ditto', [source, nextApp]);
    for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
        run('/usr/bin/plutil', ['-replace', key, '-string', next, plistOf(nextApp)]);
    }
    // `app.getVersion()` reads the package.json inside app.asar, not Info.plist. The asar's
    // integrity is not checked (the fuse is off), so it can be packed again as it is.
    const archive = join(nextApp, 'Contents', 'Resources', 'app.asar');
    const unpacked = join(dir, 'asar');
    asar.extractAll(archive, unpacked);
    const pkgFile = join(unpacked, 'package.json');
    writeFileSync(pkgFile, JSON.stringify({ ...JSON.parse(readFileSync(pkgFile, 'utf8')), version: next }));
    if (!starts) writeFileSync(join(unpacked, 'main.cjs'), 'setInterval(() => {}, 1000);\n');
    await asar.createPackage(unpacked, archive);
    // The frontend throws as it loads, so the window opens and the page never says it is up.
    if (!pageUp) writeFileSync(join(nextApp, 'Contents', 'Resources', 'dist', 'js', 'main.js'), 'throw new Error("this build does not start");\n');
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', nextApp]);
    const dmg = join(dir, `Neurite-${next}-arm64.dmg`);
    run('/usr/bin/hdiutil', ['create', '-volname', 'Neurite', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);
    return { dir, apps, app, current, next, dmg };
}

// A stand-in for the releases API, offering `dmg` as `next` with the digest given.
async function feed({ next, dmg }, digest) {
    server?.close();
    server = createServer((req, res) => {
        if (req.url === '/dmg') {
            res.writeHead(200, { 'content-length': statSync(dmg).size });
            return createReadStream(dmg).pipe(res);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            tag_name: `v${next}`, draft: false, prerelease: false, html_url: `http://127.0.0.1:${server.address().port}/page`,
            assets: [{ name: `Neurite-${next}-arm64.dmg`, size: statSync(dmg).size, digest: `sha256:${digest}`,
                       browser_download_url: `http://127.0.0.1:${server.address().port}/dmg` }],
        }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}/latest`;
}

// The first profile's CDN cache, copied into each fresh one: a fresh profile fetches its two dozen
// libraries from the network once, and twice in twenty launches that took past two minutes.
let warmCache = null;

async function launch(app, userData, feedUrl) {
    if (warmCache && !existsSync(join(userData, 'cdn-cache'))) cpSync(warmCache, join(userData, 'cdn-cache'), { recursive: true });
    const handle = await electron.launch({
        executablePath: join(app, 'Contents', 'MacOS', 'Neurite'),
        args: [`--user-data-dir=${userData}`],
        env: { ...process.env, NEURITE_UPDATE_FEED: feedUrl },
    });
    const page = await handle.firstWindow();
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 120000 });
    warmCache ??= join(userData, 'cdn-cache');
    return { handle, page };
}

const label = (page) => page.evaluate(() => document.querySelector('#update-button .menu-row-label').textContent);
const note = (page) => page.evaluate(() => document.getElementById('update-note').textContent);

async function checkFromMenu(page) {
    await page.click('.menu-button');
    await page.waitForTimeout(400);
    await page.click('#update-button');
}

test('a packaged app updates itself to a newer build, and opens again with the same graphs', { skip, timeout: 600000 }, async () => {
    const built = await prepare('update');
    const sha = createHash('sha256').update(readFileSync(built.dmg)).digest('hex');
    const feedUrl = await feed(built, sha);
    const userData = join(built.dir, 'profile');

    const { handle, page } = await launch(built.app, userData, feedUrl);
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Survives the update\nStill here.\n'));
    await page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.getTitle() === 'Survives the update'));

    await checkFromMenu(page);
    await page.waitForFunction((v) => document.querySelector('#update-button .menu-row-label').textContent === `Update to ${v}`,
                               built.next, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.querySelector('.menu-button').classList.contains('update-ready')), true);

    const quit = new Promise((resolve) => handle.process().on('exit', resolve));
    await page.click('#update-button');
    await page.click('.modal-ok');
    await quit;

    // Swapped where it was, sealed, with nothing left beside it, and opened again by itself --
    // with the profile it ran with.
    await waitFor('the swap', 60000, () => versionOf(built.app) === built.next);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', built.app]);
    // The old bundle is kept until the new one has started, then removed.
    await waitFor('the old bundle to go', 30000, () => readdirSync(built.apps).length === 1);
    assert.deepEqual(readdirSync(built.apps), ['Neurite.app']);
    const [pid] = await waitFor('the app to open again', 30000, () => pidsOf(built.app).length && pidsOf(built.app));
    assert.match(run('/bin/ps', ['-o', 'args=', '-p', String(pid)]), new RegExp(`--user-data-dir=${userData}`));

    // Opened again by the test, on the same profile: the new version, with the graph. Saying
    // "Updated to" was the job of the copy that opened by itself, which read the marker and
    // removed it; that it is gone is what is left to check.
    process.kill(pid);
    await waitFor('the reopened copy to stop', 15000, () => pidsOf(built.app).length === 0);
    const again = await launch(built.app, userData, feedUrl);
    try {
        assert.equal(await again.handle.evaluate(({ app }) => app.getVersion()), built.next);
        await again.page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.getTitle() === 'Survives the update'),
                                         undefined, { timeout: 20000 });
        assert.throws(() => statSync(join(userData, 'update-pending.json')), 'the copy that opened by itself read the marker');
    } finally { await again.handle.close() }
});

test('a download that does not match its release is not installed', { skip, timeout: 600000 }, async () => {
    const built = await prepare('mismatch');
    const feedUrl = await feed(built, '0'.repeat(64));
    const { handle, page } = await launch(built.app, join(built.dir, 'profile'), feedUrl);
    try {
        await checkFromMenu(page);
        await page.waitForFunction((v) => document.querySelector('#update-button .menu-row-label').textContent === `Update to ${v}`,
                                   built.next, { timeout: 30000 });
        await page.click('#update-button');
        await page.click('.modal-ok');
        await page.waitForFunction(() => document.getElementById('update-note').classList.contains('is-warning'),
                                   undefined, { timeout: 120000 });
        assert.match(await note(page), /did not install: the download does not match its release\. Neurite \d+\.\d+\.\d+ is unchanged\./);
        assert.equal(await label(page), 'Check for updates');
        assert.equal(versionOf(built.app), built.current, 'the bundle changed');
        assert.deepEqual(readdirSync(built.apps), ['Neurite.app'], 'a staged copy was left beside it');
    } finally { await handle.close() }
});

// An adversarial review: the old bundle was deleted before the new one had shown it could start
// (a main process that hangs); a second: "started" was taken from the main process alone (a page
// that throws as it loads).
for (const [name, how] of [['hangs', { starts: false }], ['opens on a broken page', { pageUp: false }]]) {
    test(`a newer build that ${name} is taken out, and the old app opens again`, { skip, timeout: 600000 }, async () => {
        const built = await prepare('rollback-' + name.split(' ')[0], how);
        const sha = createHash('sha256').update(readFileSync(built.dmg)).digest('hex');
        const feedUrl = await feed(built, sha);
        const userData = join(built.dir, 'profile');
        const { handle, page } = await launch(built.app, userData, feedUrl);
        await checkFromMenu(page);
        await page.waitForFunction((v) => document.querySelector('#update-button .menu-row-label').textContent === `Update to ${v}`,
                                   built.next, { timeout: 30000 });
        const quit = new Promise((resolve) => handle.process().on('exit', resolve));
        await page.click('#update-button');
        await page.click('.modal-ok');
        await quit;

        // A minute on, the new copy is stopped and the old bundle is back, and opened.
        await waitFor('the old app back', 150000, () => versionOf(built.app) === built.current
                                                        && readFileSync(join(userData, 'update.log'), 'utf8').includes('the old one is back'));
        const [pid] = await waitFor('the old app to open again', 30000, () => pidsOf(built.app).length && pidsOf(built.app));
        // The copy that opened again read the marker -- and so says the update did not install
        // -- and cleared the stage the swap put the new one back to.
        await waitFor('the marker to be read', 60000, () => { try { statSync(join(userData, 'update-pending.json')); return false } catch { return true } });
        await waitFor('the stage to be cleared', 30000, () => readdirSync(built.apps).length === 1)
            .catch((err) => { throw new Error(`${err.message}: ${readdirSync(built.apps).join(', ')}; log: ${readFileSync(join(userData, 'update.log'), 'utf8')}`) });
        process.kill(pid);
        await waitFor('the reopened copy to stop', 15000, () => pidsOf(built.app).length === 0);
    });
}

test('a feed that stalls is given up on, and the row can check again', { skip, timeout: 300000 }, async () => {
    const built = await prepare('stall');
    server?.close();
    server = createServer(() => { /* never answers */ });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { handle, page } = await launch(built.app, join(built.dir, 'profile'), `http://127.0.0.1:${server.address().port}/latest`);
    try {
        await checkFromMenu(page);
        await page.waitForFunction(() => document.getElementById('update-note').classList.contains('is-warning'),
                                   undefined, { timeout: 60000 });
        assert.equal(await note(page), 'Could not check for updates: nothing arrived for 30 seconds.');
        assert.equal(await label(page), 'Check for updates');
        // Free again: a stalled check had kept the row busy for good.
        await page.click('#update-button');
        await page.waitForFunction(() => document.getElementById('update-note').textContent === 'Checking…',
                                   undefined, { timeout: 5000 });
    } finally { await handle.close() }
});

// Reviews: the window's close saved and then closed whatever the save did, so an update went
// ahead over a save that failed (a first round); over saveNow's own `false`, and over a first
// write that failed and was swallowed (a second and a third); over a save that worked before a
// later one at the close failed; and a quit that was cancelled left the row "installing".
// Each, in one session, changes nothing, and the app stays open saying why.
test('an update whose graph cannot be kept changes nothing, however the save fails', { skip, timeout: 900000 }, async () => {
    const built = await prepare('unsaved');
    const sha = createHash('sha256').update(readFileSync(built.dmg)).digest('hex');
    const userData = join(built.dir, 'profile');
    const { handle, page } = await launch(built.app, userData, await feed(built, sha));
    const attempt = async (why) => {
        await page.click('#update-button');
        await page.waitForFunction((v) => document.querySelector('#update-button .menu-row-label').textContent === `Update to ${v}`,
                                   built.next, { timeout: 30000 });
        await page.click('#update-button');
        await page.click('.modal-ok');
        await page.waitForFunction((w) => document.getElementById('update-note').textContent.includes(w),
                                   why, { timeout: 120000 });
        assert.equal(versionOf(built.app), built.current, `the bundle changed over "${why}"`);
        assert.deepEqual(readdirSync(built.apps), ['Neurite.app'], `a staged copy was left beside it after "${why}"`);
        assert.equal(handle.process().exitCode, null, `the app closed over "${why}"`);
    };
    try {
        await page.click('.menu-button');
        await page.waitForTimeout(400);
        // A real write that fails: the first save of a new graph, which savenet logs and swallows.
        await page.evaluate(() => {
            window.__save = Stored.prototype.save;
            Stored.prototype.save = () => Promise.reject(new Error('the disk is full'));
        });
        await attempt('the graph could not be saved first');
        await page.evaluate(() => { Stored.prototype.save = window.__save });

        await page.evaluate(() => { window.__saveNow = App.viewGraphs.saveNow; App.viewGraphs.saveNow = () => Promise.resolve(false) });
        await attempt('the graph could not be saved first');

        // The update's own save works; the window's, a moment later, does not.
        await page.evaluate(() => {
            let calls = 0;
            App.viewGraphs.saveNow = () => (++calls === 1 ? Promise.resolve() : Promise.reject(new Error('the disk is full')));
        });
        await attempt('the graph could not be saved as Neurite closed');

        // A window that will not close, which cancels the quit (as a page's `beforeunload` does;
        // that one Playwright tries to answer itself, and fails, when Electron does not show it).
        await page.evaluate(() => { App.viewGraphs.saveNow = window.__saveNow });
        await handle.evaluate(({ BrowserWindow }) => {
            globalThis.__keepOpen = (e) => e.preventDefault();
            BrowserWindow.getAllWindows()[0].on('close', globalThis.__keepOpen);
        });
        await attempt('Neurite did not close');
        await handle.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].off('close', globalThis.__keepOpen) });
    } finally { await handle.close() }

    // The swaps those attempts started find their stage gone when the app does quit, and change
    // nothing then either.
    await waitFor('the swaps to give up', 30000, () => /called off/.test(readFileSync(join(userData, 'update.log'), 'utf8')));
    assert.equal(versionOf(built.app), built.current);
    assert.deepEqual(readdirSync(built.apps), ['Neurite.app']);
});
