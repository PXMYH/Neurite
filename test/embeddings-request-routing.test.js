// Two concurrent embedding requests must resolve with two different vectors.
//
// Nothing in the suite had ever compared two of them, which is how this survived: the page
// attached one `message` listener per request to a single shared Worker and let each
// resolve on whatever arrived next. `Embeddings.search` fires 1 + N requests in one
// synchronous burst, so every listener was attached before the Worker's first reply could
// be delivered — a Worker message arrives as its own task, and the burst completes inside
// the current one. That first reply dispatched to all of them, each removed only itself,
// and each resolved with the same vector. Replies two onward arrived with nobody listening.
//
// Measured in a browser before the fix: four distinct vectors posted back for four distinct
// inputs, and the search term's vector cached against all three Nodes — so every Node
// scored an identical cosine and semantic ranking did nothing at all.
//
// `Embeddings` is an object literal in a file that touches the DOM at load and exports
// nothing, so it is sliced out by brace-matching and run in a `node:vm` against stubs, the
// way test/vec2.test.js slices mandelbrot.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const src = read('js/interface/searchapi/embeddingsdb.js');

// The object literal only. Brace-matched rather than line-numbered: the file is 800 lines
// and everything below this object would drag in the DOM.
function sliceEmbeddings(){
    const start = src.indexOf('const Embeddings = {');
    assert.ok(start !== -1, 'the Embeddings object literal was renamed or removed');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1) + ';';
        }
    }
    assert.fail('the Embeddings object literal is unbalanced');
}

// A Worker that answers in the order it was asked, one distinct vector per request, and
// only once the caller lets it — so a test can hold every request open at the same time,
// which is the condition the bug needed.
function makeContext(){
    const listeners = [];
    const posted = [];
    const worker = {
        postMessage(msg){ posted.push(msg) },
        addEventListener(_type, cb){ listeners.push(cb) },
        removeEventListener(_type, cb){
            const i = listeners.indexOf(cb);
            if (i !== -1) listeners.splice(i, 1);
        }
    };
    const ctx = {
        Elem: { byId: ()=> ({ value: 'local-embeddings-gte-small' }) },
        // The real helpers are thin wrappers over addEventListener/removeEventListener.
        On: { message: (t, cb)=> t.addEventListener('message', cb) },
        Off: { message: (t, cb)=> t.removeEventListener('message', cb) },
        Logger: { err(){}, warn(){}, info(){}, debug(){} },
        Worker: function(){ return worker },
        Host: { urlForPath: (p)=> p },
        Request: { send: ()=> Promise.resolve() },
        fetch: ()=> Promise.reject(new Error('no network in this test')),
    };
    vm.createContext(ctx);
    vm.runInContext(sliceEmbeddings() + '\nglobalThis.exported = Embeddings;', ctx);

    const Embeddings = ctx.exported;
    Embeddings.init();
    // Deliver a reply for one request, exactly as the Worker would.
    const reply = (msg, res)=> {
        const e = { data: { type: 'result', res, id: msg.id } };
        for (const cb of [...listeners]) cb(e);
    };
    return { Embeddings, posted, reply, listeners };
}

test('two concurrent requests resolve with their own vectors, not with each other\'s', async ()=>{
    const { Embeddings, posted, reply } = makeContext();

    // The burst: both calls made before either reply is delivered. This is what
    // `Embeddings.search` does with 1 + N requests.
    const promA = Embeddings.fetchLocal('local-embeddings-gte-small', 'alpha');
    const promB = Embeddings.fetchLocal('local-embeddings-gte-small', 'beta');

    assert.equal(posted.length, 2, 'both requests should have been posted before any reply');
    assert.notEqual(posted[0].id, posted[1].id,
        'both requests carry the same id, so their replies cannot be told apart');

    // Answer in order, with distinguishable payloads.
    reply(posted[0], [1, 0, 0]);
    reply(posted[1], [0, 1, 0]);

    const [a, b] = await Promise.all([promA, promB]);
    assert.deepEqual(a, [1, 0, 0], 'the first caller got the wrong reply');
    assert.deepEqual(b, [0, 1, 0],
        'the second caller resolved with the first reply — every Node would share one vector');
    assert.notDeepEqual(a, b, 'two different inputs produced the same vector');
});

test('a reply is delivered once and leaves nothing pending', async ()=>{
    const { Embeddings, posted, reply } = makeContext();

    const prom = Embeddings.fetchLocal('local-embeddings-gte-small', 'only');
    assert.equal(Embeddings.pending.size, 1, 'the request was not registered as pending');

    reply(posted[0], [7, 8, 9]);
    assert.deepEqual(await prom, [7, 8, 9]);
    assert.equal(Embeddings.pending.size, 0,
        'the resolved request is still pending, so the map grows for the tab\'s lifetime');

    // A second delivery of the same id must not throw or resolve anything again.
    reply(posted[0], [0, 0, 0]);
    assert.equal(Embeddings.pending.size, 0);
});

test('an error reaches only the caller that asked', async ()=>{
    const { Embeddings, posted, listeners } = makeContext();

    const promA = Embeddings.fetchLocal('local-embeddings-gte-small', 'alpha');
    const promB = Embeddings.fetchLocal('local-embeddings-gte-small', 'beta');

    const deliver = (data)=> { for (const cb of [...listeners]) cb({ data }) };
    deliver({ type: 'error', res: 'boom', id: posted[0].id });
    deliver({ type: 'result', res: [1, 1, 1], id: posted[1].id });

    await assert.rejects(promA, /boom/, 'the failing request did not reject');
    assert.deepEqual(await promB, [1, 1, 1],
        'one request failing rejected or resolved the other as well');
});

test('a reply with no id is a broadcast and resolves nobody', async ()=>{
    const { Embeddings, posted, listeners } = makeContext();

    const prom = Embeddings.fetchLocal('local-embeddings-gte-small', 'only');
    // `ready` carries no id — it belongs to no caller.
    for (const cb of [...listeners]) cb({ data: { type: 'ready', res: 'local-embeddings-gte-small' } });
    assert.equal(Embeddings.pending.size, 1,
        'a broadcast resolved a waiting request, which is how the old code mixed vectors up');

    for (const cb of [...listeners]) cb({ data: { type: 'result', res: [2, 2, 2], id: posted[0].id } });
    assert.deepEqual(await prom, [2, 2, 2]);
});

test('both sides of the Worker protocol carry the id', ()=>{
    // The routing above is only possible because the id survives the round trip. The Worker
    // is a separate file that no test can import, so this reads it as text.
    const worker = read('public/embeddings.js').replace(/\/\/[^\n]*/g, '');

    assert.match(worker, /function post\(type, res, id\)\{ self\.postMessage\(\{ type, res, id \}\) \}/,
        'the Worker no longer echoes the request id, so replies cannot be routed');
    assert.match(worker, /const \{ verb, modelName, input, id \} = e\.data/,
        'the Worker no longer reads the id off the request');
    assert.match(worker, /model\[verb\]\(input, id\)/,
        'the id is not passed to the model, so the reply cannot carry it');

    // The id is threaded down to the reply rather than stored: several requests are in
    // flight at once, so a single "current id" field would be overwritten.
    assert.match(worker, /#postResult\(id, output\)\{ post\('result', Array\.from\(output\.data\), id\) \}/,
        'the result no longer posts with its id');
    assert.doesNotMatch(worker, /currentId|this\.id\s*=/,
        'the id is being held in state instead of threaded, which breaks under concurrency');

    const page = src.replace(/\/\/[^\n]*/g, '');
    assert.match(page, /postMessage\(\{ verb, modelName, input, id \}\)/,
        'the page no longer sends an id');
    assert.doesNotMatch(page, /listenToWorker/,
        'the per-request listener is back — that is the bug, not a style choice');
});
