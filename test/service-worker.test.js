// The app on GitHub Pages opens offline (#9). Three things make it so, and each is pinned here:
// the service worker answers from the network first and from its cache when that fails; the
// build registers it and the dev server does not; and nothing the app fetches is addressed from
// the domain's root, which on a project page (`/Neurite/`) is somebody else's site.
//
// `public/sw.js` runs in a `node:vm` context against a fake `self`, `caches` and `fetch`, so the
// fetch handler is the real one. Verified in a browser as well: the build served under
// `/Neurite/`, a note made, the server killed, and a reload that still booted with the note.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = (p)=> readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const SCOPE = 'https://pxmyh.github.io/Neurite/';

// The worker, loaded against a network that answers from `net` (url -> body) or throws.
function loadWorker(net){
    const listeners = {};
    const store = new Map();
    const cache = {
        put: async (req, res)=>{ store.set(typeof req === 'string' ? req : req.url, res) },
        match: async (req)=> store.get(typeof req === 'string' ? req : req.url),
        keys: async ()=> [...store.keys()].map( (url)=>({url}) ),
        delete: async (req)=> store.delete(typeof req === 'string' ? req : req.url),
    };
    const asked = [];
    const sandbox = createContext({
        URL,
        self: {
            location: new URL(SCOPE + 'sw.js'),
            registration: { scope: SCOPE },
            clients: { claim: async ()=>{} },
            skipWaiting(){},
            addEventListener: (type, cb)=>{ listeners[type] = cb },
        },
        caches: { open: async ()=> cache, keys: async ()=> ['neurite-v1'], delete: async ()=> true },
        fetch: async (req, init)=>{
            const url = typeof req === 'string' ? req : req.url;
            asked.push({ url, mode: init?.mode ?? req.mode });
            if (!net.has(url)) throw new TypeError('Failed to fetch');
            return { status: 200, body: net.get(url), clone(){ return this } };
        },
    });
    runInContext(read('public/sw.js'), sandbox, { filename: 'public/sw.js' });

    // A fetch event: whether the worker answered it, and with what.
    const dispatch = async (url, { method = 'GET', mode = 'no-cors' } = {})=>{
        let answer = null;
        listeners.fetch({ request: { url, method, mode }, respondWith: (p)=>{ answer = p } });
        return answer === null ? 'not handled' : answer.then((r)=> r.body, (e)=> 'failed: ' + e.message);
    };
    // A message from the page, and the work it made the worker wait for.
    const message = (data)=>{
        let work = Promise.resolve();
        listeners.message({ data, waitUntil: (p)=>{ work = p } });
        return work;
    };
    return { dispatch, message, store, asked };
}

test('the app\'s own files come from the network, and from the cache once it is gone', async ()=>{
    const net = new Map([[SCOPE + 'js/main.js', 'main v1']]);
    const worker = loadWorker(net);
    assert.equal(await worker.dispatch(SCOPE + 'js/main.js'), 'main v1');
    assert.ok(worker.store.has(SCOPE + 'js/main.js'), 'the response was not kept');

    // A newer file on the server wins over the kept one while there is a network.
    net.set(SCOPE + 'js/main.js', 'main v2');
    assert.equal(await worker.dispatch(SCOPE + 'js/main.js'), 'main v2');

    net.clear();
    assert.equal(await worker.dispatch(SCOPE + 'js/main.js'), 'main v2', 'offline, the kept copy is not served');
    assert.match(await worker.dispatch(SCOPE + 'js/never-fetched.js'), /^failed/);
});

test('a page opened at another address of the app is the app\'s page when offline', async ()=>{
    const net = new Map([[SCOPE, '<html>app</html>']]);
    const worker = loadWorker(net);
    await worker.dispatch(SCOPE, { mode: 'navigate' });
    net.clear();
    assert.equal(await worker.dispatch(SCOPE + 'index.html?state=x', { mode: 'navigate' }), '<html>app</html>');
});

test('the CDN libraries are kept, asked for in cors mode; nothing else is touched', async ()=>{
    const lib = 'https://cdn.jsdelivr.net/npm/codemirror@5/lib/codemirror.js';
    const worker = loadWorker(new Map([[lib, 'codemirror']]));
    assert.equal(await worker.dispatch(lib), 'codemirror');
    assert.equal(worker.asked[0].mode, 'cors', 'an opaque no-cors answer is never ok, so it would never be kept');
    assert.ok(worker.store.has(lib));

    assert.equal(await worker.dispatch('https://api.openai.com/v1/chat/completions', { method: 'POST' }), 'not handled');
    assert.equal(await worker.dispatch('https://api.openai.com/v1/models'), 'not handled');
    assert.equal(await worker.dispatch('http://localhost:7070/check'), 'not handled');
    assert.equal(await worker.dispatch(SCOPE + 'js/main.js', { method: 'POST' }), 'not handled');
});

test('the build registers the worker and the dev server does not', ()=>{
    const config = read('vite.config.js');
    const plugin = config.slice(config.indexOf('const registerServiceWorker = {'));
    assert.match(plugin, /apply: 'build'/, 'the dev server would register it too, and cache the files being worked on');
    assert.match(plugin, /register\('sw\.js'\)/, 'the worker is not registered by a relative path');
    assert.match(config, /plugins: \[registerServiceWorker\]/);
});

test('nothing the app fetches is addressed from the domain\'s root', ()=>{
    // On a project page the root is `pxmyh.github.io/`, not the app. Every file the app loads
    // at boot or later is relative, so it resolves under wherever the app is served.
    const files = ['js/main.js', 'js/interface/dropdown/savenet.js', 'js/interface/searchapi/embeddingsdb.js'];
    const rooted = /(fetch\(|Worker\(|url = )\s*[`'"]\/(resources|wiki|js|embeddings)/;
    for (const file of files) assert.doesNotMatch(read(file), rooted, file);
    // And the three it used to address from the root, which this test would otherwise not find.
    assert.match(read('js/main.js'), /fetch\(`resources\/\$\{templateName\}\.html`\)/);
    assert.match(read('js/interface/searchapi/embeddingsdb.js'), /new Worker\('embeddings\.js'/);
    assert.match(read('js/interface/dropdown/savenet.js'), /fetch\(`wiki\/pages\/neurite-wikis\//);
});

test('a first visit keeps what it loaded before the worker took control', async ()=>{
    // The page, the libraries in index.html and the first scripts are fetched before the worker
    // controls the page, so it never saw them: a first visit left 31 of 126 out, and the app did
    // not open offline until a second (rv15). The page sends the list once the app is up.
    const lib = 'https://cdn.jsdelivr.net/npm/codemirror@5/lib/codemirror.js';
    const net = new Map([[SCOPE, '<html>app</html>'], [SCOPE + 'js/main.js', 'main'], [lib, 'codemirror'],
                         ['https://example.com/tracker.js', 'not ours']]);
    const worker = loadWorker(net);
    worker.store.set(SCOPE + 'assets/index-OLD.css', { status: 200, body: 'an earlier build' });
    await worker.message({ keep: [SCOPE, SCOPE + 'js/main.js', lib, 'https://example.com/tracker.js', SCOPE + 'assets/index-NEW.css'] });

    assert.ok(worker.store.has(SCOPE) && worker.store.has(SCOPE + 'js/main.js') && worker.store.has(lib),
        'the files of the first visit were not kept');
    assert.equal(worker.store.has('https://example.com/tracker.js'), false, 'a host that is not the app nor a CDN was kept');
    assert.equal(worker.store.has(SCOPE + 'assets/index-OLD.css'), false, "an earlier build's stylesheet was kept");
    assert.equal(worker.asked.find((a)=> a.url === lib).mode, 'cors');

    // Kept files are not fetched again, and offline the app is there.
    const fetched = worker.asked.length;
    await worker.message({ keep: [SCOPE, SCOPE + 'js/main.js'] });
    assert.equal(worker.asked.length, fetched, 'a file kept already was fetched again');
    net.clear();
    assert.equal(await worker.dispatch(SCOPE + 'index.html', { mode: 'navigate' }), '<html>app</html>');
});

test('the page hands the worker its list once the app is up', ()=>{
    const config = read('vite.config.js');
    assert.match(config, /registration\.active\?\.postMessage\(\{ keep: \[location\.href,/);
    assert.match(config, /performance\.getEntriesByType\('resource'\)/);
    assert.match(config, /window\.appReady \? keep\(\)/, 'the list is sent before the app has loaded what it boots with');
});
