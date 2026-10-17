// Google Drive sync in the Mac app (docs/cloud-sync.md), in real Electron, against the fake Google
// (../test-e2e/fixtures/fake-google.mjs): the main process signs in over HTTP to it -- its
// endpoints given by environment, its browser a fetch -- and the page's Drive calls are routed to
// it. NEURITE_APP=<.../Neurite.app/Contents/MacOS/Neurite> runs the same against a packaged build.
// A scratch profile, and a token store with no Keychain behind it (the test's own).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { FakeGoogle } from '../test-e2e/fixtures/fake-google.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packaged = process.env.NEURITE_APP;
const profiles = [];
after(() => profiles.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function launch(profile, fake, google) {
    const app = await electron.launch({
        executablePath: packaged || electronPath,
        args: [...(packaged ? [] : [here]), `--user-data-dir=${profile}`],
        env: { ...process.env, NEURITE_DRIVE_CLIENT_ID: 'test-client.apps.googleusercontent.com', NEURITE_DRIVE_CLIENT_SECRET: '',
               NEURITE_GOOGLE_AUTH_URL: google.authUrl, NEURITE_GOOGLE_TOKEN_URL: google.tokenUrl, NEURITE_GOOGLE_REVOKE_URL: google.revokeUrl,
               NEURITE_AUTH_BROWSER: 'fetch', NEURITE_TEST_PLAIN_TOKEN_STORE: '1' },
    });
    await fake.route(app.context());
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 60000 });
    await page.waitForFunction(() => App.cloudSync?.status.phase !== 'starting', undefined, { timeout: 20000 });
    await page.evaluate(() => { CloudSync.QUIET_MS = 300; CloudSync.MAX_WAIT_MS = 2000 });
    return { app, page, errors };
}
const graphs = (fake) => [...fake.files.values()].filter((f) => f.name.endsWith('.neurite') && !f.trashed);

test('the Mac app signs in through its main process, syncs, stays connected when opened again, and disconnects', { timeout: 180000 }, async () => {
    const fake = new FakeGoogle();
    const google = await fake.listen();
    const profile = mkdtempSync(join(tmpdir(), 'neurite-drive-e2e-'));
    profiles.push(profile);
    // Closed whatever happens: an app left open keeps the test runner waiting on it.
    let app = null;
    try {
        let page, errors;
        ({ app, page, errors } = await launch(profile, fake, google));
        assert.equal(await page.evaluate(() => App.cloudSync.auth.kind), 'desktop');
        await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## On the Mac\nWritten in the app.\n'));
        await page.waitForFunction(() => Object.keys(Graph.nodes).length === 1, undefined, { timeout: 10000 });
        await page.waitForTimeout(600);

        // Settings → Sync → Connect, as a reader does it.
        // The menu's own click: a real one over the HUD reached something else in Electron.
        await page.evaluate(() => document.querySelector('.menu-button').click());
        await page.click('#settings-button');
        await page.click('.settings-nav-item[data-page="sync"]');
        await page.click('#sync-connect');
        await page.waitForFunction(() => App.cloudSync.status.lastPushAt, undefined, { timeout: 20000 });
        assert.equal(graphs(fake).length, 1);
        assert.match(await page.locator('#sync-note').textContent(), /Connected as reader@example\.com/);
        // The refresh token is the main process's: in its file, and nowhere the page can read.
        const [refresh] = [...fake.refreshTokens.keys()];
        assert.equal(readFileSync(join(profile, 'google-drive.bin'), 'utf8'), refresh);
        const seen = await page.evaluate(async (r) => {
            const stores = [];
            for (const name of ['sync', 'state', 'Neurite']) {
                const db = await new Promise((ok) => {
                    const q = indexedDB.open(name);
                    q.onsuccess = () => ok(q.result); q.onerror = q.onblocked = () => ok(null);
                    setTimeout(() => ok(null), 5000);
                });
                if (!db) continue;
                for (const s of db.objectStoreNames) {
                    const all = await new Promise((ok) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => ok(q.result) });
                    stores.push(JSON.stringify(all));
                }
            }
            return [JSON.stringify(localStorage), document.documentElement.outerHTML, ...stores].some((t) => t.includes(r));
        }, refresh);
        assert.equal(seen, false, 'the page can read the refresh token');
        const tokenCalls = fake.calls.filter((c) => c.path === '/token').length;
        await app.close();

        // Opened again: still connected, and a change goes up on a refreshed access token.
        ({ app, page, errors } = await launch(profile, fake, google));
        assert.equal(await page.evaluate(() => App.cloudSync.status.phase), 'idle');
        await page.evaluate(() => { const cm = window.currentActiveZettelkastenMirror; cm.setValue(cm.getValue().replace('Written in the app.', 'Written in the app, again.')) });
        await page.waitForTimeout(400);
        await page.evaluate(() => App.viewGraphs.saveNow());
        await page.waitForFunction(() => App.cloudSync.status.lastPushAt, undefined, { timeout: 20000 });
        const [file] = graphs(fake);
        assert.ok(file.content.toString('latin1').includes(encodeURIComponent('Written in the app, again.')), 'the change did not go up');
        // The new process had no access token: it refreshed one, once, from the stored refresh token.
        assert.equal(fake.calls.filter((c) => c.path === '/token').length, tokenCalls + 1, 'the access token was not refreshed once');

        assert.equal(await page.evaluate(() => App.cloudSync.disconnect().then(() => App.cloudSync.status.phase)), 'disconnected');
        assert.equal(existsSync(join(profile, 'google-drive.bin')), false);
        assert.equal(fake.refreshTokens.size, 0, 'the token was not revoked at Google');
        assert.deepEqual(errors, []);
    } finally {
        await app?.close().catch(() => {});
        await google.close();
    }
});
