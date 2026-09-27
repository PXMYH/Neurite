// Ranking by meaning has to rank by meaning, and cost only what it uses (#75).
//
// Three defects, each pinned here against the source run in a node:vm context:
// - `cosineSimilarity` was a bare dot product, equal to a cosine only for vectors that came
//   in normalised. Ollama's do not, so with an Ollama model a longer text scored higher
//   for being longer.
// - Node search embedded every Node and then skipped all but the text Nodes: a forward
//   pass each for nothing. It also cached a failed `[]` for the session, and cached by
//   Node id, so an edited Node was ranked by its old text.
// - The embeddings Worker chained each request onto the one before it, resolving to the
//   extractor for the next; one failed extraction handed `undefined` on, and every later
//   request in the session failed. A pipeline that failed to load was never retried.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p)=> readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// From `start` to the brace that closes the first `{` after it.
function slice(src, start){
    const at = src.indexOf(start);
    assert.notEqual(at, -1, `${start} was renamed or removed`);
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
    }
    assert.fail(`${start} is unbalanced`);
}

const cosineSrc = slice(read('js/interface/searchapi/embeddingsdb.js'), 'function cosineSimilarity(');
const searchSrc = slice(read('js/interface/searchapi/search.js'), 'Embeddings.search = async function');
const escapeSrc = slice(read('js/zettelkasten/zetcodemirror.js'), 'function escapeRegExp(');

function cosine(){
    const ctx = vm.createContext({Math});
    vm.runInContext(cosineSrc + ';globalThis.f = cosineSimilarity;', ctx);
    return ctx.f;
}

test('cosineSimilarity is a cosine, whatever the vectors\' length', ()=>{
    const f = cosine();
    assert.equal(f([2, 0], [5, 0]), 1, 'parallel vectors: the old dot product said 10');
    assert.equal(f([1, 0], [0, 1]), 0);
    assert.equal(f([1, 0], [-1, 0]), -1);
    // A short aligned vector beats a long, slightly skewed one. The dot product ranked
    // them the other way round, which is length winning over meaning.
    assert.ok(f([1, 0], [1, 0.01]) > f([1, 0], [10, 3]));
});

test('cosineSimilarity answers 0, never NaN, when there is nothing to compare', ()=>{
    const f = cosine();
    for (const [a, b] of [[[], []], [[0, 0], [1, 1]], [[1, 2], [1, 2, 3]], [null, [1]]]) {
        const r = f(a, b);
        assert.ok(r === 0, `${JSON.stringify([a, b])} gave ${r}`);
    }
});

// A Graph of 3 text Nodes and 3 AI Nodes, a fake `Embeddings.fetch` that counts, and the
// real `Embeddings.search`.
function searchHarness(vectors){
    const node = (uuid, isTextNode, text)=> ({
        uuid, isTextNode, title: uuid,
        getTitle: ()=> uuid, getText: ()=> node.texts[uuid] ?? text,
        view: {titleInput: {value: uuid}}, content: {innerText: text},
    });
    node.texts = {};
    const nodes = {
        a: node('a', true, 'alpha'), b: node('b', true, 'beta'), c: node('c', true, 'gamma'),
        x: node('x', false, 'ai one'), y: node('y', false, 'ai two'), z: node('z', false, 'ai three'),
    };
    const calls = [];
    const cache = new Map();
    const ctx = vm.createContext({
        Graph: {nodes},
        Elem: {byId: ()=> ({value: 10})},
        Logger: {debug(){}, info(){}},
        nodeCache: {get: (k)=> cache.get(k), set: (k, v)=> cache.set(k, v)},
        Embeddings: {
            selectModel: {value: 'local-embeddings-gte-small'},
            fetch: async (text)=> { calls.push(text); return vectors(text) },
        },
        Math, RegExp, Promise, Object,
    });
    vm.runInContext(cosineSrc, ctx);
    vm.runInContext(escapeSrc, ctx);
    vm.runInContext(searchSrc + ';', ctx);
    return {search: (term)=> ctx.Embeddings.search(term), calls, texts: node.texts};
}

test('Node search embeds text Nodes only, and ranks by the cosine', async ()=>{
    const vectors = (t)=> (t === 'query' || t.includes('beta')) ? [1, 0] : [0, 1];
    const h = searchHarness(vectors);
    const found = await h.search('query');
    assert.equal(h.calls.length, 4, `1 search term + 3 text Nodes, got ${h.calls.length}`);
    assert.deepEqual(Array.from(found, (n)=> n.uuid).sort(), ['a', 'b', 'c'], 'only text Nodes come back');
    assert.equal(found[0].uuid, 'b', 'the Node whose vector matches the query ranks first');
});

// With embeddings down every vector is `[]`. The relevant notes sent to the model have to be
// the keyword matches alone, not every Node padded in behind them with a cosine of 0 -- and
// searched by what a send really passes: three keywords, joined as the search splits them.
test('with embeddings down, only a keyword match is relevant', async ()=>{
    const join = read('js/ai/aimessage.js').match(/const strKeywords = arrKeywords\.join\((['"])(.*?)\1\)/);
    assert.ok(join, "the send's keyword join should still be in aimessage.js");
    const term = ['zeta', 'beta', 'omega'].join(join[2]);

    const h = searchHarness( ()=> [] );
    assert.deepEqual(Array.from(await h.search(term), (n)=> n.uuid), ['b']);
    assert.deepEqual(Array.from(await h.search(''), (n)=> n.uuid), [], 'and an empty term matches nothing');
});

// A title holding one of the keywords earns the x10 -- the whole term never was in one.
test('a title match on any keyword ranks that Node first', async ()=>{
    const h = searchHarness( ()=> [1, 0] );
    const found = await h.search('zeta, c, omega');
    assert.equal(found[0].uuid, 'c');
});

test('an edited Node is embedded again, and a failed embedding is not kept', async ()=>{
    let fail = true;
    const vectors = (t)=> (t.includes('gamma') && fail) ? [] : [1, 1];
    const h = searchHarness(vectors);
    await h.search('query');                     // 4 calls; gamma failed
    h.calls.length = 0;

    fail = false;
    await h.search('query');
    assert.deepEqual(h.calls.filter( (t)=> t !== 'query' ), ['c gamma'],
        'the Node whose embedding failed is asked again; the other two come from the cache');

    h.calls.length = 0;
    h.texts.a = 'alpha, edited';
    await h.search('query');
    assert.deepEqual(h.calls.filter( (t)=> t !== 'query' ), ['a alpha, edited'],
        'the edited Node is embedded from its new text');
});

// The Worker, with its library swapped for a fake through `Model.load`. The fake keeps a
// module map the way a Worker does, failures included: an `import()` of a URL that failed
// once fails again without going back to the network (measured in Chromium). So `loads`
// counts real fetches of the library, and a retry under the same URL cannot pass.
// `pipelines` counts model loads -- the download a failed `pipeline()` costs again.
function workerHarness({loadFailures = 0, pipelineFailures = 0, failCalls = [], noDataCalls = []} = {}){
    const posted = [];
    const ctx = vm.createContext({
        self: {postMessage: (m)=> posted.push(m)},
        console: {log(){}, error(){}},
        Array, Promise,
    });
    vm.runInContext(read('public/embeddings.js') + ';globalThis.M = Model; globalThis.models = models;', ctx);
    let loads = 0, pipelines = 0, extractions = 0;
    const urls = [];
    const library = {
        env: {},
        pipeline: async ()=> {
            pipelines++;
            if (pipelines <= pipelineFailures) throw new Error('model download failed');
            return async (text)=> {
                extractions++;
                if (failCalls.includes(extractions)) throw new Error('extraction failed');
                if (noDataCalls.includes(extractions)) return undefined;
                return {data: [text.length]};
            };
        },
    };
    const moduleMap = new Map();
    ctx.M.load = (url)=> {
        if (!moduleMap.has(url)) {
            loads++;
            urls.push(url);
            moduleMap.set(url, loads <= loadFailures
                ? Promise.reject(new Error('offline')) : Promise.resolve(library));
        }
        return moduleMap.get(url);
    };
    const model = ctx.models['local-embeddings-gte-small'];
    return {model, posted, loads: ()=> loads, pipelines: ()=> pipelines, urls};
}

const repliesOf = (posted)=> posted.filter( (m)=> m.id !== undefined ).map( (m)=> `${m.id}:${m.type}` );

test('one failed extraction does not fail the requests after it', async ()=>{
    const h = workerHarness({failCalls: [2]});
    await Promise.all(['a', 'bb', 'ccc', 'dddd'].map( (t, i)=> h.model.generate(t, i + 1) ));
    const replies = h.posted.filter( (m)=> m.id !== undefined ).map( (m)=> `${m.id}:${m.type}` );
    assert.deepEqual(replies, ['1:result', '2:error', '3:result', '4:result']);
});

test('a pipeline that failed to load is loaded again on the next request', async ()=>{
    const h = workerHarness({loadFailures: 1});
    await h.model.generate('first', 1);
    await h.model.generate('second', 2);
    assert.deepEqual(repliesOf(h.posted), ['1:error', '2:result']);
    assert.equal(h.loads(), 2);
    assert.notEqual(h.urls[1], h.urls[0], 'the retry has to ask under a URL the module map has not seen');
});

// A search queues one request per text Node. Forgetting a failed model load at once made
// each queued request start the download again. And a retry of the model must not fetch
// the library again: it had arrived.
test('one failed model load answers every request queued behind it, and is tried once', async ()=>{
    const h = workerHarness({pipelineFailures: 1});
    await Promise.all(['a', 'bb', 'ccc'].map( (t, i)=> h.model.generate(t, i + 1) ));
    assert.deepEqual(repliesOf(h.posted), ['1:error', '2:error', '3:error']);
    assert.equal(h.pipelines(), 1, 'one model load between the three');

    await h.model.generate('later', 4);
    assert.deepEqual(repliesOf(h.posted).slice(3), ['4:result'], 'the next request after them tries again');
    assert.equal(h.pipelines(), 2);
    assert.equal(h.loads(), 1, 'with the library it already had');
});

// A reply that throws rejects its own link. Kept as the queue, that rejection skipped every
// request after it.
test('a reply that throws does not stop the requests after it', async ()=>{
    const h = workerHarness({noDataCalls: [1]});
    const first = h.model.generate('a', 1);
    const second = h.model.generate('bb', 2);
    await assert.rejects(first, 'the caller of the broken reply still hears of it');
    await second;
    assert.deepEqual(repliesOf(h.posted), ['2:result']);
});
