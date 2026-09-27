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

test('Wolfram with no gateway says so and lets the send go on', async ()=>{
    const src = slice(read('js/interface/searchapi/wolframapi.js'), 'async function fetchWolfram(');
    const alerts = [];
    const ctx = vm.createContext({
        Logger: logger,
        alert: (m)=> alerts.push(m),
        fetch: ()=> Promise.reject(new TypeError('Failed to fetch')),
        Host: {urlForPath: (p)=> 'http://localhost:7070' + p},
        Elem: {byId: ()=> ({value: ''})},
        AiCall: {stream: ()=> {
            const call = {messages: [], addSystemPrompt(){ return call }, addUserPrompt(){ return call },
                          exec: async ()=> 'Reformulated: "integral of x"'};
            return call;
        }},
        Message: {system: (t)=> t},
        wolframMessage: '',
        window: {currentActiveZettelkastenMirror: {replaceRange(){}, lastLine: ()=> 0}},
        CodeMirror: {Pos: ()=> 0},
    });
    vm.runInContext(src + ';globalThis.fetchWolfram = fetchWolfram;', ctx);
    const node = {aiResponseDiv: {innerHTML: ''}};
    const result = await ctx.fetchWolfram('integrate x', true, node, 'earlier talk');
    assert.equal(result, undefined, 'no Wolfram data, and no throw');
    assert.equal(alerts.length, 1, 'the reader is told what to check');
});
