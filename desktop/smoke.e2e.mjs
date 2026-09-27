// Smoke test for the macOS app: drives main.cjs in real Electron, `npm test` here.
// NEURITE_APP=<.../Neurite.app/Contents/MacOS/Neurite> runs the same checks against a
// packaged build instead.
//
// Named *.e2e.mjs so the root `npm test` (a bare `node --test`) never picks it up:
// it launches Electron, and it needs the network once, to fill the CDN cache.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';

const here = dirname(fileURLToPath(import.meta.url));
const packaged = process.env.NEURITE_APP;

// A fresh profile per test, never the reader's own. Fresh matters beyond isolation:
// a saved graph is restored ~12ms after `appReady` and replaces the canvas, so a note
// a test makes in that window would be wiped by the restore rather than kept.
const profiles = [];
after(() => profiles.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function freshProfile() {
    profiles.push(mkdtempSync(join(tmpdir(), 'neurite-smoke-')));
    return profiles.at(-1);
}

async function launch(userData, { args = [], ready = true } = {}) {
    const app = await electron.launch({
        executablePath: packaged || electronPath,
        args: [...(packaged ? [] : [here]), `--user-data-dir=${userData}`, ...args],
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (ready) await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 60000 });
    return { app, page, errors };
}

const LIBS = ['CodeMirror', 'localforage', 'marked', 'Prism', 'DOMPurify', 'pdfjsLib'];
const missingLibs = (page) => page.evaluate((names) => names.filter((n) => typeof window[n] === 'undefined'), LIBS);

test('serves the built app from its own origin, and nothing outside it', async () => {
    const { app, page, errors } = await launch(freshProfile());
    try {
        const state = await page.evaluate(async () => ({
            origin: location.origin,
            secure: window.isSecureContext,
            partial: (await fetch('/resources/html/nodes.html')).status,
            traversal: (await fetch('/..%2f..%2fpackage.json')).status,
            foreignCdn: (await fetch('/__cdn__/example.com/x')).status,
        }));
        assert.equal(state.origin, 'app://neurite');
        assert.ok(state.secure, 'a secure context, so navigator.storage exists');
        assert.equal(state.partial, 200);
        assert.equal(state.traversal, 404, 'an encoded ../ cannot leave dist');
        assert.equal(state.foreignCdn, 404, 'the CDN route is not an open proxy');
        assert.deepEqual(await missingLibs(page), [], 'every CDN library loaded');
        assert.deepEqual(errors, []);
    } finally { await app.close() }
});

test('leaves the app only through the default browser', async () => {
    const { app, page } = await launch(freshProfile());
    try {
        await app.evaluate(({ shell }) => {
            globalThis.opened = [];
            shell.openExternal = async (url) => { globalThis.opened.push(url) };
        });
        await page.evaluate(() => { window.open('https://example.com/a') });
        await page.evaluate(() => { location.href = 'https://example.com/b' });
        await page.waitForTimeout(500);
        assert.equal(await page.evaluate(() => location.href), 'app://neurite/', 'the window stays on the app');
        assert.deepEqual(await app.evaluate(() => globalThis.opened), ['https://example.com/a', 'https://example.com/b']);
    } finally { await app.close() }
});

// Big enough that the save the page starts on its own as the window closes does not
// finish inside the unload: without the wait in main.cjs this came back empty, 3 of 3.
const NOTES = 100;

test('keeps a graph made just before quitting, and opens with no network once it has run', async () => {
    const profile = freshProfile();
    // Online, so this launch is also the one that fills the CDN cache.
    const first = await launch(profile);
    try {
        await first.page.evaluate(async (n) => {
            for (let i = 0; i < n; i++) await window.createNote(`Note ${i}`, 'Lorem ipsum dolor sit amet. '.repeat(40));
        }, NOTES);
        await first.page.waitForTimeout(300);            // well inside the 8s autosave tick
    } finally { await first.app.close() }

    // Every hostname unresolvable. app:// is not DNS, so only the CDN could fail.
    const { app, page, errors } = await launch(profile, { args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
    try {
        await page.waitForFunction((n) => Object.keys(Graph.nodes).length >= n, NOTES, { timeout: 30000 })
            .catch(() => {});                            // the count below says what arrived
        const titles = await page.evaluate(() => Object.values(Graph.nodes).map((n) => n.view?.titleInput?.value));
        assert.equal(titles.length, NOTES, `all ${NOTES} notes came back, got ${titles.length}`);
        assert.ok(titles.includes(`Note ${NOTES - 1}`), 'including the last one');
        assert.deepEqual(await missingLibs(page), [], 'the CDN libraries came from the cache');
        assert.deepEqual(errors, []);
    } finally { await app.close() }
});

// The quit waits on `saveNow`, and a quit can come before the saved graph is back on
// screen, while the canvas is still empty. A save then wrote that empty canvas over the
// reader's graph -- a review measured it 6 runs of 6. This calls it at the first moment
// it can be called, and checks the graph is still there afterwards.
test('a quit before the saved graph is back leaves the graph alone', async () => {
    const profile = freshProfile();
    const first = await launch(profile);
    try {
        await first.page.evaluate(async () => {
            for (let i = 0; i < 5; i++) await window.createNote(`Kept ${i}`, 'Stored before the early quit.');
        });
        await first.page.waitForTimeout(300);
    } finally { await first.app.close() }

    const early = await launch(profile, { ready: false });
    try {
        const onCanvasWhenCalled = await early.page.evaluate(() => new Promise((resolve) => {
            // A message loop rather than a timer: it runs between tasks, so it sees `App`
            // in the task after the one that creates it, before the restore lands.
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                if (typeof App === 'object' && App.viewGraphs) {
                    const onCanvas = Object.keys(Graph.nodes).length;
                    App.viewGraphs.saveNow().then(() => resolve(onCanvas));
                } else channel.port2.postMessage(0);
            };
            channel.port2.postMessage(0);
        }));
        assert.equal(onCanvasWhenCalled, 0, 'the save was asked for before the restore, or this proves nothing');
    } finally { await early.app.close() }

    const again = await launch(profile);
    try {
        await again.page.waitForFunction(() => Object.keys(Graph.nodes).length >= 5, undefined, { timeout: 15000 })
            .catch(() => {});                            // the count below says what arrived
        assert.equal(await again.page.evaluate(() => Object.keys(Graph.nodes).length), 5);
    } finally { await again.app.close() }
});
