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

// The Worker, with its library swapped for a fake through `Model.load`.
function workerHarness({loadFailures = 0, failCalls = []} = {}){
    const posted = [];
    const ctx = vm.createContext({
        self: {postMessage: (m)=> posted.push(m)},
        console: {log(){}, error(){}},
        Array, Promise,
    });
    vm.runInContext(read('public/embeddings.js') + ';globalThis.M = Model; globalThis.models = models;', ctx);
    let loads = 0, extractions = 0;
    ctx.M.load = async ()=> {
        loads++;
        if (loads <= loadFailures) throw new Error('offline');
        return {
            env: {},
            pipeline: async ()=> async (text)=> {
                extractions++;
                if (failCalls.includes(extractions)) throw new Error('extraction failed');
                return {data: [text.length]};
            },
        };
    };
    const model = ctx.models['local-embeddings-gte-small'];
    return {model, posted, loads: ()=> loads};
}

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
    const replies = h.posted.filter( (m)=> m.id !== undefined ).map( (m)=> `${m.id}:${m.type}` );
    assert.deepEqual(replies, ['1:error', '2:result']);
    assert.equal(h.loads(), 2);
});
