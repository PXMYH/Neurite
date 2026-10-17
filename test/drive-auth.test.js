// The Mac app's Google Drive sign-in (desktop/drive-auth.cjs), run under Node against the fake
// Google over real HTTP, with Electron's few calls stubbed: the IPC handlers it registers are
// called as the page's bridge would call them. What is pinned is what keeps the sign-in Google's
// flow for desktop apps and keeps the refresh token off the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire, Module } from 'node:module';
import http from 'node:http';
import { FakeGoogle } from '../test-e2e/fixtures/fake-google.mjs';

const require = createRequire(import.meta.url);
const APP = 'app://neurite/';

async function load({ fake = new FakeGoogle(), clientId = 'test-client.apps.googleusercontent.com', browser } = {}) {
    const google = await fake.listen();
    const userData = mkdtempSync(join(tmpdir(), 'neurite-drive-auth-'));
    const handlers = new Map();
    const opened = [];
    const electron = {
        app: { getPath: () => userData },
        ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
        safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => String(b).replace(/^enc:/, '') },
        shell: { openExternal: async (url) => { opened.push(url); await browser?.(url) } },
        net: { fetch: (...a) => fetch(...a) },
        BrowserWindow: { getAllWindows: () => [] },
    };
    Object.assign(process.env, {
        NEURITE_DRIVE_CLIENT_ID: clientId, NEURITE_DRIVE_CLIENT_SECRET: '',
        NEURITE_GOOGLE_AUTH_URL: google.authUrl, NEURITE_GOOGLE_TOKEN_URL: google.tokenUrl, NEURITE_GOOGLE_REVOKE_URL: google.revokeUrl,
        NEURITE_TEST_PLAIN_TOKEN_STORE: '',
    });
    delete process.env.NEURITE_AUTH_BROWSER;
    const path = require.resolve('../desktop/drive-auth.cjs');
    delete require.cache[path];
    const original = Module._load;
    Module._load = function (request, ...rest) { return request === 'electron' ? electron : original.call(this, request, ...rest) };
    let auth;
    try { auth = require(path) } finally { Module._load = original }
    auth.init();
    const fromApp = { senderFrame: { url: APP, parent: null } };
    const call = (channel, arg) => handlers.get(channel)(fromApp, arg);
    const done = async () => { await google.close(); rmSync(userData, { recursive: true, force: true }) };
    return { fake, call, handlers, opened, userData, done, tokenFile: join(userData, 'google-drive.bin') };
}
// What a browser does with the consent page: follows Google's redirect back to the app.
const follow = async (url) => {
    const consent = await fetch(url, { redirect: 'manual' });
    const back = consent.headers.get('location');
    if (back) await fetch(back);
};

test('Connect signs in by code and PKCE in the browser, back to 127.0.0.1, and keeps the refresh token in the main process only', async () => {
    const t = await load({ browser: follow });
    try {
        assert.deepEqual(await t.call('drive:status'), { configured: true, connected: false });
        assert.deepEqual(await t.call('drive:connect'), { connected: true });
        const consent = new URL(t.opened[0]);
        assert.equal(consent.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(consent.searchParams.get('response_type'), 'code');
        assert.equal(consent.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
        assert.match(consent.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/$/);
        assert.ok(consent.searchParams.get('state').length >= 32, 'the state is short');
        // The refresh token is written encrypted, and the page is handed access tokens only.
        const [refresh] = [...t.fake.refreshTokens.keys()];
        assert.equal(readFileSync(t.tokenFile, 'utf8'), 'enc:' + refresh);
        const access = await t.call('drive:token');
        assert.match(access, /^ya29\.fake-/);
        assert.notEqual(access, refresh);
        assert.deepEqual(await t.call('drive:status'), { configured: true, connected: true });
        // The listener is gone with the answer.
        await assert.rejects(fetch(consent.searchParams.get('redirect_uri')));
    } finally { await t.done() }
});

test('a frame, or any page but the app, is told nothing', async () => {
    const t = await load({ browser: follow });
    try {
        for (const event of [{ senderFrame: { url: APP, parent: {} } }, { senderFrame: { url: 'https://example.com/', parent: null } }]) {
            assert.equal(await t.handlers.get('drive:token')(event), null);
            assert.deepEqual(await t.handlers.get('drive:connect')(event), { connected: false, error: 'refused' });
        }
        assert.equal(t.opened.length, 0);
    } finally { await t.done() }
});

test("an answer with another state, or another Host, is refused, and the sign-in waits on for Google's", async () => {
    let evil = null;
    const t = await load({
        browser: async (url) => {
            const redirect = new URL(url).searchParams.get('redirect_uri');
            const port = new URL(redirect).port;
            const wrong = await fetch(redirect + '?code=4/stolen&state=not-the-one');
            // `fetch` will not send a Host of its own choosing; a page rebinding a name would.
            const rebound = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port,
                path: `/?code=4/stolen&state=${new URL(url).searchParams.get('state')}`, headers: { Host: 'evil.example:' + port } },
                (res) => { res.resume(); resolve(res) }).on('error', reject));
            evil = [wrong.status, rebound.statusCode];
            await follow(url);
        },
    });
    try {
        assert.deepEqual(await t.call('drive:connect'), { connected: true });
        assert.deepEqual(evil, [404, 404]);
    } finally { await t.done() }
});

test('the access token is refreshed when it runs out; a refusal from Google forgets the connection', async () => {
    const t = await load({ browser: follow });
    try {
        await t.call('drive:connect');
        const first = await t.call('drive:token');
        assert.equal(await t.call('drive:token'), first, 'a token still good was replaced');
        const fresh = await t.call('drive:token', { fresh: true });
        assert.notEqual(fresh, first);
        assert.equal(t.fake.calls.filter((c) => c.path === '/token').length, 2, 'a fresh token was not refreshed from the refresh token');
        // Two asks at once share one refresh.
        await Promise.all([t.call('drive:token', { fresh: true }), t.call('drive:token', { fresh: true })]);
        assert.equal(t.fake.calls.filter((c) => c.path === '/token').length, 3);
        // Revoked at Google: the next refresh is refused, and the token is forgotten.
        t.fake.refreshTokens.clear();
        assert.equal(await t.call('drive:token', { fresh: true }), null);
        assert.equal(existsSync(t.tokenFile), false);
        assert.deepEqual(await t.call('drive:status'), { configured: true, connected: false });
    } finally { await t.done() }
});

test('Disconnect revokes the token at Google and deletes it; no client id is not set up', async () => {
    const t = await load({ browser: follow });
    try {
        await t.call('drive:connect');
        assert.equal(t.fake.refreshTokens.size, 1);
        assert.deepEqual(await t.call('drive:disconnect'), { connected: false });
        assert.equal(t.fake.refreshTokens.size, 0, 'the token was not revoked');
        assert.equal(existsSync(t.tokenFile), false);
        assert.equal(await t.call('drive:token'), null);
    } finally { await t.done() }

    const none = await load({ clientId: '', browser: follow });
    try {
        assert.deepEqual(await none.call('drive:status'), { configured: false, connected: false });
        assert.deepEqual(await none.call('drive:connect'), { connected: false, error: 'not-configured' });
        assert.equal(none.opened.length, 0);
    } finally { await none.done() }
});

test('two Connects at once are one sign-in; a refusal in the browser connects nothing', async () => {
    const t = await load({ browser: follow });
    try {
        const [a, b] = await Promise.all([t.call('drive:connect'), t.call('drive:connect')]);
        assert.deepEqual([a, b], [{ connected: true }, { connected: true }]);
        assert.equal(t.opened.length, 1, 'two sign-ins were opened');
    } finally { await t.done() }

    const denied = await load({
        browser: async (url) => {
            const redirect = new URL(url).searchParams.get('redirect_uri');
            await fetch(redirect + '?error=access_denied&state=' + new URL(url).searchParams.get('state'));
        },
    });
    try {
        assert.deepEqual(await denied.call('drive:connect'), { connected: false, error: 'access_denied' });
        assert.equal(existsSync(denied.tokenFile), false);
    } finally { await denied.done() }
});
