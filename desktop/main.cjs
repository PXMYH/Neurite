// Neurite as a macOS app: one window onto the built frontend (`npm run build`, so
// ../dist), served from a privileged `app://neurite` scheme.
//
// Not file://, and not a localhost port:
//
// - file:// breaks the app outright. PageLoad fetches its HTML partials
//   (`resources/*.html`), and Chromium refuses fetch() on file: URLs.
// - A port collides with the dev server on 8999, and anything else on the machine
//   can read what a port serves.
// - A standard, secure scheme is a real origin. IndexedDB and localStorage work, it
//   is a secure context (navigator.storage), and Ollama's default OLLAMA_ORIGINS
//   already admits `app://*`, so a local model answers with no configuration.
//
// Deliberately not exposed: `window.electronAPI`. Setting `startedViaElectron`
// switches link nodes to <webview> and routes neurite.network calls through an IPC
// proxy that lives on upstream's `electron` branch, not here. Without it the page
// runs as it does in a browser tab, which is what the e2e suite checks. The one
// thing the page can reach is the app's own updates (`window.neuriteDesktop`,
// preload.cjs and updater.cjs).
const { app, BrowserWindow, Menu, desktopCapturer, protocol, net, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const updater = require('./updater.cjs');

const ORIGIN = 'app://neurite';
const WEB_ROOT = app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(__dirname, '..', 'dist');
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
const CDN_PREFIX = '/__cdn__/';

protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
}]);

// A checkout run with `npm start` gets a profile of its own. Sharing the installed
// app's would mean a dev build writing into the reader's real graphs -- or, with the
// app open, the single-instance lock below handing the launch to the installed copy,
// so the code being worked on never runs. An explicit --user-data-dir (the smoke
// test) still wins.
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', path.join(app.getPath('appData'), 'Neurite Dev'));
}

// `url` may be an origin ("app://neurite/", as Electron passes one) or a full URL.
const fromApp = (url) => url === ORIGIN || Boolean(url?.startsWith(ORIGIN + '/'));
const isWeb = (url) => /^https?:\/\//.test(url);
const notFound = () => new Response('Not found', { status: 404 });

function serve(request) {
    const url = new URL(request.url);
    if (url.host !== 'neurite') return notFound();
    if (url.pathname.startsWith(CDN_PREFIX)) {
        let target;
        try { target = new URL('https://' + url.pathname.slice(CDN_PREFIX.length) + url.search) }
        catch { return notFound() }                 // no host after the prefix
        return CDN_HOSTS.includes(target.host) ? fromCdn(target.href) : notFound();
    }
    return fromDist(url.pathname === '/' ? '/index.html' : url.pathname);
}

// Every path resolves inside WEB_ROOT or is refused. The check is on where the join
// landed, not on what the URL said: an encoded `..%2f` is a plain `../` once decoded.
// And it is made again on the resolved path, so a symlink inside dist cannot lead out
// of it either -- there are none today, and the second check is one syscall.
let realRoot = null;
async function fromDist(pathname) {
    let file;
    try { file = path.join(WEB_ROOT, decodeURIComponent(pathname)) }
    catch { return notFound() }                     // a malformed %-escape
    if (!file.startsWith(WEB_ROOT + path.sep)) return notFound();

    realRoot ??= await fs.realpath(WEB_ROOT).catch(() => WEB_ROOT);
    let real;
    try { real = await fs.realpath(file) }
    catch { return notFound() }                     // no such file
    if (!real.startsWith(realRoot + path.sep)) return notFound();
    return net.fetch(pathToFileURL(real).href).catch(notFound);
}

// index.html loads 23 scripts and stylesheets from two public CDNs, and the Prism
// autoloader and Pyodide fetch more on demand. Each is kept on disk the first time it
// arrives, so after one launch with a network the app opens with none. A browser tab
// cannot promise that: its HTTP cache expires an entry and then fails the request
// rather than serve it stale.
//
// ponytail: cache-first and never revalidated. Versions freeze at the first launch --
// which also pins what index.html leaves floating, `codemirror@5` and an unversioned
// `marked` -- and deleting <userData>/cdn-cache is how to take newer ones.
let cdnSession;                  // its own partition, so its fetches are not redirected
const cacheDir = () => path.join(app.getPath('userData'), 'cdn-cache');
const cdnResponse = ({ body, type }) => new Response(body, {
    headers: {
        'content-type': type,
        // The request reached here through a cross-origin redirect, which taints it: a
        // module script (Pyodide) is refused without this header.
        'access-control-allow-origin': '*',
        // What this route hands out is third-party bytes under the app's own origin.
        // The redirect never sends a document here, and these two make sure nothing
        // served from here could act as one: no sniffing a script into HTML, and
        // anything rendered as a page runs sandboxed, in an origin of its own.
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
    },
});

// One upstream fetch per URL however many requests wait on it.
const inFlight = new Map();

async function fromCdn(url) {
    const file = path.join(cacheDir(), crypto.createHash('sha256').update(url).digest('hex'));
    try {
        return cdnResponse({ body: await fs.readFile(file), type: await fs.readFile(file + '.type', 'utf8') });
    } catch { /* not cached yet */ }

    if (!inFlight.has(url)) {
        inFlight.set(url, fetchAndStore(url, file).finally(() => inFlight.delete(url)));
    }
    const got = await inFlight.get(url);
    return got instanceof Response ? got.clone() : cdnResponse(got);
}

async function fetchAndStore(url, file) {
    let res;
    try { res = await cdnSession.fetch(url) }
    catch { return new Response('Offline, and not cached yet', { status: 504 }) }
    if (!res.ok) return res;

    const got = { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'application/octet-stream' };
    try {
        // The body is renamed into place last, and the type is written before it, so
        // a quit halfway through leaves no entry -- never a truncated script that
        // every later launch would run.
        const part = `${file}.${crypto.randomUUID()}`;
        await fs.mkdir(cacheDir(), { recursive: true });
        await fs.writeFile(file + '.type', got.type);
        await fs.writeFile(part, got.body);
        await fs.rename(part, file);
    } catch (err) {
        console.warn('[cdn-cache] not stored:', url, err.message);
    }
    return got;
}

// Only subresources go to the cache. A document from a CDN -- a link node opened on a
// jsdelivr or cdnjs page -- would otherwise be served from `app://neurite` and become
// same-origin with the app: able to read every graph and every API key it holds.
const DOCUMENT_TYPES = new Set(['mainFrame', 'subFrame', 'object']);
const cdnRedirect = (details, callback) => {
    if (details.initiatorOrigin !== ORIGIN || DOCUMENT_TYPES.has(details.resourceType)) return callback({});
    callback({ redirectURL: ORIGIN + CDN_PREFIX + details.url.slice('https://'.length) });
};

// Closing waits for the page's own save (savenet.js `saveNow`), with a limit so a hung
// page cannot keep the app from quitting. Without it, work since the last eight-second
// autosave tick rides on a write the unload may not let finish -- a 100-note graph
// quit before its first tick came back empty, 3 runs of 3 (see savenet.js).
const SAVE_ON_CLOSE_MS = 10000;

function createWindow() {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 720,
        minHeight: 480,
        backgroundColor: '#000000',     // the canvas colour: no white flash before paint
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), ...updater.webPreferences() },
    });
    const contents = win.webContents;

    let saved = false;
    win.on('close', (event) => {
        if (saved || contents.isCrashed()) return;
        event.preventDefault();
        // A quit the app chose, for an update, closes only over a graph that is kept: what was
        // made after the update's own save would otherwise go with the old app. Any other quit
        // closes whatever its save did, as it always has.
        if (updater.quitting()) {
            updater.saveGraph(win).then((kept) => {
                if (!kept) return updater.stayOpen('the graph could not be saved as Neurite closed');
                saved = true;
                win.close();
            });
            return;
        }
        const save = contents.executeJavaScript(
            'Promise.resolve(App.viewGraphs?.saveNow?.()).then(() => true)');
        const limit = new Promise((resolve) => setTimeout(resolve, SAVE_ON_CLOSE_MS));
        Promise.race([save, limit])
            .catch((err) => console.warn('[neurite] save on close failed:', err.message))
            .finally(() => { saved = true; win.close() });
    });
    // The page's `beforeunload` kept the window open, so the next close saves again.
    contents.on('will-prevent-unload', () => { saved = false });

    // A crashed page is a blank window, so bring it back -- once in any ten seconds, so
    // a page that crashes as it loads cannot spin. The graph returns from its last save.
    let lastCrash = 0;
    contents.on('render-process-gone', (_, details) => {
        if (details.reason === 'clean-exit' || Date.now() - lastCrash < 10000) return;
        lastCrash = Date.now();
        contents.reload();
    });

    // Tells an update under way that this copy came up (updater.cjs).
    updater.watch(win);
    win.loadURL(ORIGIN + '/');
}

// Two copies would share one profile, and with it the IndexedDB the saved graphs
// live in. A second launch focuses the first instead.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const [win] = BrowserWindow.getAllWindows();
        if (win?.isMinimized()) win.restore();
        win?.focus();
    });

    // Anything that is not the app opens in the default browser. The app window never
    // navigates away, because with no address bar there would be no way back. Link
    // nodes are iframes and keep navigating: `will-navigate` is the top frame only.
    app.on('web-contents-created', (_, contents) => {
        contents.setWindowOpenHandler(({ url }) => {
            if (isWeb(url)) shell.openExternal(url);
            return { action: 'deny' };
        });
        contents.on('will-navigate', (event, url) => {
            if (fromApp(url)) return;
            event.preventDefault();
            if (isWeb(url)) shell.openExternal(url);
        });
    });

    app.on('window-all-closed', () => app.quit());

    app.whenReady().then(() => {
        // Electron's default menu, minus its Help menu, which links to electronjs.org.
        // Keep the Edit menu: on macOS its roles are what carry Cmd+C / Cmd+V / Cmd+Z.
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' },
            { role: 'viewMenu' }, { role: 'windowMenu' },
        ]));
        const ses = session.defaultSession;
        cdnSession = session.fromPartition('cdn');
        protocol.handle('app', serve);
        ses.webRequest.onBeforeRequest({ urls: CDN_HOSTS.map((host) => `https://${host}/*`) }, cdnRedirect);

        // Electron grants every permission by default, to every frame. The app keeps
        // what it asks for; a site in a link node gets nothing.
        ses.setPermissionRequestHandler((_, __, callback, details) => callback(fromApp(details.requestingUrl)));
        ses.setPermissionCheckHandler((_, __, requestingOrigin) => fromApp(requestingOrigin));

        // Screen capture (Record, and the Neural API's screenshot) has no picker of its
        // own in Electron: without a handler getDisplayMedia fails as "Not supported".
        // macOS's own picker where it has one; otherwise the first screen, and only for
        // the app itself asking from a click.
        ses.setDisplayMediaRequestHandler((request, callback) => {
            if (!fromApp(request.securityOrigin) || !request.userGesture) return callback({});
            desktopCapturer.getSources({ types: ['screen'] })
                .then(([screen]) => callback(screen ? { video: screen } : {}), () => callback({}));
        }, { useSystemPicker: true });

        updater.init();
        createWindow();
    });
}
