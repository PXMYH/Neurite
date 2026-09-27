// With no local gateway running -- always, on an iPad, and on a desktop until someone
// starts one -- three AI helpers threw instead of degrading, and the throw took the whole
// AI send with it (#10). Each is behind an opt-in checkbox, so this bit only readers who
// had switched it on. Pinned here against the source, run in node:vm with stubs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p)=> readFileSync(new URL('../' + p, import.meta.url), 'utf8');

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

const logger = {info(){}, debug(){}, warn(){}, err(){}};

test('embedding search with the checkbox on and no keys ranks nothing instead of throwing', async ()=>{
    const src = slice(read('js/interface/searchapi/embeddingsdb.js'), 'Keys.getRelevant = async function');
    const ctx = vm.createContext({Keys: {}, Logger: logger, Map, getLastPromptsAndResponses: ()=> ''});
    vm.runInContext(src + ';', ctx);
    // `isEmbedEnabled` hands over `true`, not a list, when no key is visible.
    const keys = await ctx.Keys.getRelevant('question', null, 'query', true);
    assert.equal(keys.length, 0);
});

test('a Wikipedia search that finds nothing returns nothing instead of throwing', async ()=>{
    const src = slice(read('js/interface/searchapi/wikipedia.js'), 'Wikipedia.getSummaries = async function');
    const shown = [];
    const ctx = vm.createContext({
        Wikipedia: {getSummary: async ()=> [], displayResult: (s)=> shown.push(s)},
        isNoveltyEnabled: ()=> false, shuffleArray(){}, sampleSummaries: ()=> [],
        Promise, Array,
    });
    vm.runInContext(src + ';', ctx);
    const text = await ctx.Wikipedia.getSummaries(['fractal']);
    assert.equal(text, '');
    assert.equal(shown.length, 0, 'nothing to display, and nothing displayed');
});

// `fetchWolfram` in a sandbox: `useProxy` is whether the gateway answered its health check,
// and `fetch` is what the Wolfram route then does.
function wolfram({useProxy, fetch, gatewayUp = false, stopped = false}){
    const src = slice(read('js/interface/searchapi/wolframapi.js'), 'async function fetchWolfram(');
    const alerts = [];
    let reformulations = 0, helper = false;
    const ctx = vm.createContext({
        useProxy, fetch,
        wolframUnreachable: 'unreachable',
        Logger: logger,
        alert: (m)=> alerts.push(m),
        // `Host.recheck` answers whether the gateway is up now; its own rules are pinned in
        // provider-routes.test.js, next to the rest of handleapikeys.js.
        Host: {urlForPath: (p)=> 'http://localhost:7070' + p, recheck: async ()=> useProxy || gatewayUp},
        Ai: {shouldContinue: !stopped},
        Elem: {byId: ()=> ({value: ''})},
        AiCall: {stream: ()=> {
            const call = {messages: [], addSystemPrompt(){ return call }, addUserPrompt(){ return call },
                          asHelper(){ helper = true; return call },
                          exec: async ()=> { reformulations++; return 'Reformulated: "integral of x"' }};
            return call;
        }},
        Message: {system: (t)=> t},
        wolframMessage: '',
        window: {currentActiveZettelkastenMirror: {replaceRange(){}, lastLine: ()=> 0}},
        CodeMirror: {Pos: ()=> 0},
    });
    vm.runInContext(src + ';globalThis.fetchWolfram = fetchWolfram;', ctx);
    const node = {aiResponseDiv: {innerHTML: ''}, shouldContinue: !stopped};
    return {
        call: ()=> ctx.fetchWolfram('integrate x', true, node, 'earlier talk'),
        alerts, reformulations: ()=> reformulations, helper: ()=> helper,
    };
}

// A stop pressed while the gateway was asked must hold: the reformulation is a request.
test('Wolfram in a send already stopped asks for nothing', async ()=>{
    const w = wolfram({useProxy: true, stopped: true, fetch: ()=> assert.fail('no query after a stop')});
    assert.equal(await w.call(), undefined);
    assert.equal(w.reformulations(), 0);
});

// Streamed, so the reader watches it form, and still not the answer: marked as a helper,
// or its start and end drove the send's own state.
test("Wolfram's reformulation is a helper call", async ()=>{
    const w = wolfram({useProxy: true, fetch: async ()=> ({ok: true, json: async ()=> ({})})});
    await w.call();
    assert.equal(w.helper(), true);
});

// With no gateway the Wolfram query can never be sent, so the AI round trip that
// reformulates it was paid for nothing -- on every send, and every pass of auto mode.
test('Wolfram with no gateway says so, spends no AI call, and lets the send go on', async ()=>{
    const w = wolfram({useProxy: false, fetch: ()=> assert.fail('nothing to fetch from')});
    assert.equal(await w.call(), undefined, 'no Wolfram data, and no throw');
    assert.equal(w.alerts.length, 1, 'the reader is told what to check');
    assert.equal(w.reformulations(), 0, 'no reformulation for a query nobody can send');
});

// `useProxy` is the gateway as it was at boot. One started later has to be found, or
// Wolfram refuses it for the rest of the session.
test('Wolfram finds a gateway started after the page loaded', async ()=>{
    let fetched = 0;
    const w = wolfram({useProxy: false, gatewayUp: true,
                       fetch: async ()=> { fetched++; return {ok: true, json: async ()=> ({})} }});
    await w.call();
    assert.equal(w.alerts.length, 0, 'no refusal');
    assert.equal(w.reformulations(), 1);
    assert.equal(fetched, 1, 'the query went to the gateway');
});

test('Wolfram with the gateway gone mid-session says so and lets the send go on', async ()=>{
    const w = wolfram({useProxy: true, fetch: ()=> Promise.reject(new TypeError('Failed to fetch'))});
    assert.equal(await w.call(), undefined);
    assert.equal(w.alerts.length, 1);
});

// A gateway without the Wolfram route answers with an HTML 404, and `response.json()` on
// that threw out of the AI send.
test('Wolfram answered with a page that is not JSON lets the send go on', async ()=>{
    const html = async ()=> { throw new SyntaxError('Unexpected token <') };
    for (const ok of [false, true]) {
        const w = wolfram({useProxy: true, fetch: async ()=> ({ok, json: html})});
        assert.equal(await w.call(), undefined, `ok=${ok}: no data, and no throw`);
    }
});

// The keywords every send searches the notes with, and Wikipedia when it is on. The AI
// call was not awaited, so from the second exchange on the regex read "[object Promise]":
// the notes were searched for '' and Wikipedia for "undefined".
function keywords(answer, context = 'earlier talk'){
    const src = slice(read('js/interface/searchapi/searchapi.js'), 'async function generateKeywords(');
    const ctx = vm.createContext({
        Logger: logger,
        getLastPromptsAndResponses: ()=> context,
        AiCall: {single: ()=> {
            const call = {addSystemPrompt(){ return call }, addUserPrompt(){ return call },
                          exec: ()=> new Promise( (resolve)=> setTimeout(resolve, 5, answer) )};
            return call;
        }},
        setTimeout,
    });
    vm.runInContext('String.trim = (s)=> s.trim();' + src + ';globalThis.generateKeywords = generateKeywords;', ctx);
    return ctx.generateKeywords('how deep does the mandelbrot zoom go', 3);
}

test('keywords come from the AI answer once there is a conversation', async ()=>{
    assert.deepEqual(Array.from(await keywords('"fractal", "zoom", "depth"')), ['fractal', 'zoom', 'depth']);
});

test('keywords fall back to the longest words when the AI gives none', async ()=>{
    // A failed call answers undefined; so does one with no quotes in it. "does" is as long
    // as "deep" and "zoom", and is left out as a word every message has.
    for (const answer of [undefined, 'no quotes here']) {
        assert.deepEqual(Array.from(await keywords(answer)), ['mandelbrot', 'deep', 'zoom']);
    }
    assert.deepEqual(Array.from(await keywords('unused', '')), ['mandelbrot', 'deep', 'zoom'],
        'and a first exchange, with no conversation yet, never asks');
});

// A first exchange searches by these words. "What is a fractal?" gave "fractal?", "What"
// and "is", and "is" ranked every note that uses it with the one about fractals.
test("a first exchange's keywords leave out punctuation and the words every message has", async ()=>{
    const src = slice(read('js/interface/searchapi/searchapi.js'), 'async function generateKeywords(');
    const ctx = vm.createContext({Logger: logger, getLastPromptsAndResponses: ()=> ''});
    vm.runInContext(src + ';globalThis.generateKeywords = generateKeywords;', ctx);
    assert.deepEqual(Array.from(await ctx.generateKeywords('What is a fractal?', 3)), ['fractal']);
    assert.deepEqual(Array.from(await ctx.generateKeywords('Is c++ faster than python?', 3)),
        ['faster', 'python', 'c++'], 'a word that ends in symbols keeps them');
});
