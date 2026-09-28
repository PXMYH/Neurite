// The service worker (#9): the app opens without a network once it has been opened with one,
// which is what an app installed to an iPad's Home Screen is expected to do.
//
// Network first, cache second, for everything the app itself loads -- its scripts, its HTML
// partials and styles, and the libraries index.html takes from the two CDNs -- so the next load
// gets whatever the server has now, and the cache is only ever the fallback. Nothing is listed in
// advance: what a visit fetches is kept as it passes through, and what the first visit fetched
// before this worker took control is sent over by the page once the app is up (the `message`
// handler below), so one visit keeps all a later boot needs.
//
// Only GETs, and only from this origin and the two CDNs. An AI provider, the local gateway and
// every other host pass straight through, uncached.
//
// Registered by the build alone (vite.config.js), so the dev server and the browser tests never
// run it; outside js/ because a worker controls only the pages at or below its own path.
const CACHE = 'neurite-v1';
const CDNS = ['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name !== CACHE) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

// The page's list of what the visit loaded (vite.config.js): the files fetched before this worker
// took control, which it never saw. Kept if they are the app's own or a CDN's, and not kept
// already. A stylesheet or script from an earlier build under `assets/`, whose names carry a
// hash, is let go, or every deploy would leave one more behind.
self.addEventListener('message', (event) => {
    const urls = event.data?.keep;
    if (Array.isArray(urls)) event.waitUntil(keepAll(urls));
});

async function keepAll(urls) {
    const cache = await caches.open(CACHE);
    const wanted = new Set(urls.map((url) => new URL(url, self.location.href).href));
    for (const url of wanted) {
        const origin = new URL(url).origin;
        const own = origin === self.location.origin;
        if (!own && !CDNS.includes(origin)) continue;
        if (await cache.match(url)) continue;

        try {
            const response = await fetch(url, own ? {} : { mode: 'cors', credentials: 'omit' });
            if (response.status === 200) await cache.put(url, response);
        } catch (err) {
            // Offline already, or gone: the next visit keeps it.
        }
    }
    for (const request of await cache.keys()) {
        if (request.url.includes('/assets/') && !wanted.has(request.url)) await cache.delete(request);
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const origin = new URL(request.url).origin;
    const own = origin === self.location.origin;
    if (!own && !CDNS.includes(origin)) return;

    event.respondWith(networkThenCache(request, own));
});

async function networkThenCache(request, own) {
    const cache = await caches.open(CACHE);
    try {
        // A `<script src>` on a CDN is asked for in `no-cors` mode, and its opaque answer is not
        // `ok`, so it would never be kept. Both CDNs send `Access-Control-Allow-Origin: *`, so
        // the worker asks in `cors` mode instead -- and falls back to the page's own request
        // should one ever stop.
        const response = own ? await fetch(request)
                             : await fetch(request.url, { mode: 'cors', credentials: 'omit' })
                                   .catch(() => fetch(request));
        if (response.status === 200) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;

        // The app opened at another address of its own -- `index.html`, a link with a query --
        // is the app's one page.
        if (request.mode === 'navigate') {
            const shell = await cache.match(self.registration.scope);
            if (shell) return shell;
        }
        throw err;
    }
}
