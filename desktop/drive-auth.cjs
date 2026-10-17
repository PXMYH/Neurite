// The Mac app's Google Drive sign-in (docs/cloud-sync.md). Notion keeps Google's tokens on its
// server and the app never holds one; Neurite has no server, so the main process is that place.
// The refresh token is written only here, encrypted by the Keychain (`safeStorage`), and the page
// is handed access tokens, which last an hour, one at a time.
//
// The sign-in is Google's flow for desktop apps: an authorization code with PKCE (S256), in the
// system browser -- Google refuses its sign-in inside an embedded browser -- sent back to a
// listener on 127.0.0.1 that this opens for that one answer, on a port of the system's choosing,
// and that takes it only with the `state` it sent.
const { app, ipcMain, safeStorage, shell, BrowserWindow, net } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const config = require('./drive-config.cjs');

const env = process.env;
const ENDPOINTS = {
    auth: env.NEURITE_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    token: env.NEURITE_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    revoke: env.NEURITE_GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
};
const CLIENT = { id: env.NEURITE_DRIVE_CLIENT_ID || config.clientId, secret: env.NEURITE_DRIVE_CLIENT_SECRET ?? config.clientSecret };
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SIGN_IN_MS = 5 * 60 * 1000;
// The token a minute before Google says it runs out, so a push that starts on it finishes on it.
const EARLY_MS = 60 * 1000;
// A test profile has no Keychain to ask; the token is then written as it is, and only there.
const PLAIN = env.NEURITE_TEST_PLAIN_TOKEN_STORE === '1';

const tokenFile = () => path.join(app.getPath('userData'), 'google-drive.bin');
const b64url = (buf) => Buffer.from(buf).toString('base64url');
let access = null;          // {token, expires}
let signingIn = null;       // the sign-in under way, which a second Connect joins

async function readRefresh() {
    const buf = await fs.readFile(tokenFile()).catch(() => null);
    if (!buf) return null;
    if (PLAIN) return buf.toString('utf8');
    try { return safeStorage.decryptString(buf) }
    catch (err) {
        console.warn('[neurite] the Google Drive token could not be read:', err.message);
        return null;
    }
}
async function writeRefresh(token) {
    if (!PLAIN && !safeStorage.isEncryptionAvailable()) throw new Error('no-keychain');
    const data = PLAIN ? Buffer.from(token, 'utf8') : safeStorage.encryptString(token);
    await fs.writeFile(tokenFile(), data, { mode: 0o600 });
}
async function forget() {
    access = null;
    await fs.rm(tokenFile(), { force: true });
}

async function post(url, form) {
    const res = await net.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text || '{}') } catch {}
    return { ok: res.ok, status: res.status, json };
}
const clientForm = () => ({ client_id: CLIENT.id, ...(CLIENT.secret ? { client_secret: CLIENT.secret } : {}) });

// One answer, from the browser Google sent back here; any other request is told nothing -- one
// with another Host too, which a page rebinding a name of its own to 127.0.0.1 would send.
function waitForCode(server, state, host) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: 'timeout' }), SIGN_IN_MS);
        server.on('request', (req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (req.method !== 'GET' || req.headers.host !== host || url.pathname !== '/'
                || url.searchParams.get('state') !== state) {
                res.writeHead(404, { 'content-type': 'text/plain' });
                return res.end('Not found');
            }
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error') || (code ? null : 'no-code');
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(page(error));
            clearTimeout(timer);
            resolve({ code, error });
        });
    });
}
function page(error) {
    const words = error ? 'Neurite was not connected to Google Drive (' + String(error).replace(/[^\w.-]/g, '') + '). You can close this tab.'
                        : 'Neurite is connected to Google Drive. You can close this tab and go back to Neurite.';
    return `<!doctype html><meta charset="utf-8"><title>Neurite</title><body style="font:16px -apple-system,sans-serif;margin:3em">${words}</body>`;
}

// Where the browser goes. A test has no browser, so it can ask for the request to be made here,
// as a browser would make it: the consent page, then wherever that sends it.
async function openInBrowser(url) {
    if (env.NEURITE_AUTH_BROWSER !== 'fetch') return shell.openExternal(url);
    // Node's own fetch, which reads a redirect's Location; Electron's cancels a manual redirect.
    const consent = await globalThis.fetch(url, { redirect: 'manual' });
    const back = consent.headers.get('location');
    if (back) await globalThis.fetch(back);
}

async function signIn() {
    if (!CLIENT.id) return { connected: false, error: 'not-configured' };

    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(24));
    const server = http.createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const host = `127.0.0.1:${server.address().port}`;
    const redirect = `http://${host}/`;
    try {
        const consent = new URL(ENDPOINTS.auth);
        for (const [k, v] of Object.entries({ client_id: CLIENT.id, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
                                              code_challenge: challenge, code_challenge_method: 'S256', state })) {
            consent.searchParams.set(k, v);
        }
        const answer = waitForCode(server, state, host);
        await openInBrowser(consent.toString());
        const { code, error } = await answer;
        BrowserWindow.getAllWindows()[0]?.focus();
        if (error) return { connected: false, error };

        const res = await post(ENDPOINTS.token, { ...clientForm(), code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
        if (!res.ok || !res.json.refresh_token) return { connected: false, error: res.json.error || 'exchange-failed' };
        await writeRefresh(res.json.refresh_token);
        access = { token: res.json.access_token, expires: Date.now() + (res.json.expires_in ?? 0) * 1000 - EARLY_MS };
        return { connected: true };
    } catch (err) {
        console.warn('[neurite] Google Drive sign-in failed:', err.message);
        return { connected: false, error: err.message === 'no-keychain' ? 'no-keychain' : 'failed' };
    } finally {
        server.close();
        server.closeAllConnections?.();
    }
}
function connect() {
    signingIn ??= signIn().finally(() => { signingIn = null });
    return signingIn;
}

// An access token, refreshed when it has run out or `fresh` asks for a new one. A refusal from
// Google means the connection is gone -- revoked, or expired -- and it is forgotten; a network
// failure is thrown, so the page tells offline from disconnected.
let refreshing = null;
function accessToken({ fresh = false } = {}) {
    if (!fresh && access && access.expires > Date.now()) return Promise.resolve(access.token);
    // Pushes that ask together share one refresh.
    refreshing ??= refreshAccess().finally(() => { refreshing = null });
    return refreshing;
}
async function refreshAccess() {
    const refresh = await readRefresh();
    if (!refresh) return null;
    const res = await post(ENDPOINTS.token, { ...clientForm(), refresh_token: refresh, grant_type: 'refresh_token' });
    if (!res.ok) {
        if (res.json.error === 'invalid_grant' || res.status === 400 || res.status === 401) { await forget(); return null }
        throw new Error('Google answered ' + res.status);
    }
    access = { token: res.json.access_token, expires: Date.now() + (res.json.expires_in ?? 0) * 1000 - EARLY_MS };
    return access.token;
}

async function disconnect() {
    const refresh = await readRefresh();
    if (refresh) await post(ENDPOINTS.revoke, { token: refresh }).catch(() => {});
    await forget();
    return { connected: false };
}

async function status() {
    return { configured: Boolean(CLIENT.id), connected: Boolean(await readRefresh()) };
}

// Only the app's own page may ask, never a frame inside it -- as for the updates (updater.cjs).
const fromApp = (event) => Boolean(event.senderFrame?.url?.startsWith('app://neurite/') && !event.senderFrame.parent);

function init() {
    ipcMain.handle('drive:status', (event) => (fromApp(event) ? status() : null));
    ipcMain.handle('drive:connect', (event) => (fromApp(event) ? connect() : { connected: false, error: 'refused' }));
    ipcMain.handle('drive:disconnect', (event) => (fromApp(event) ? disconnect() : null));
    ipcMain.handle('drive:token', (event, options) => (fromApp(event) ? accessToken({ fresh: Boolean(options?.fresh) }) : null));
}

module.exports = { init };
