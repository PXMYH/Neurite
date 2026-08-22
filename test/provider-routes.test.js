// `getAPIParams` decides which host an AI request is sent to and which key rides
// along with it. Until the two switches in it became `ProviderRoutes`, that
// decision could only be exercised by clicking through a browser, because the
// interesting lines were wrapped in `Elem.byId` calls.
//
// It is reachable from Node now, so these tests drive the real function in a `vm`
// sandbox and assert on where a request would actually go. Same sandbox pattern as
// vec2.test.js, with a wider stub because this file walks the DOM when it loads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path)=> readFileSync(new URL(path, root), 'utf8');
const FILE = 'js/ai/ai-utility/handleapikeys.js';

// Values the sandbox hands back for the key inputs, distinct per provider so a
// test can tell which one was read.
const INPUT_VALUES = {
    'api-key-input': 'OPENAI-KEY',
    'GROQ-api-key-input': 'GROQ-KEY',
    'anthropic-api-key-input': 'ANTHROPIC-KEY',
    'max-tokens-slider': '100',
    'model-temperature': '0.5'
};

const CUSTOM_MODEL = 'my-custom-model';

// Loads handleapikeys.js and returns its getAPIParams plus whatever it tried to
// tell the user. `useProxy` is a module-level `let` in globals.js, so the sandbox
// supplies it as a plain global exactly as the browser does.
function loadRouting(useProxy){
    const alerts = [], errors = [];

    // querySelector and closest hand back another element rather than null, because
    // this file walks the dropdown DOM at load time and would throw on null.
    const element = (id)=>{
        const e = {
            id: id || 'inference-select-0',
            value: INPUT_VALUES[id] ?? 'OpenAi',
            options: id === 'custom-model-select'
                ? [{text: CUSTOM_MODEL, dataset: {endpoint: 'https://custom.example/v1', key: 'CUSTOM-KEY'}}]
                : [],
            style: {}, dataset: {}, classList: {add(){}, remove(){}, contains: ()=> false},
            addEventListener(){}, appendChild(){}, querySelectorAll: ()=> [],
            querySelector: ()=> null
        };
        e.querySelector = (sel)=> element(String(sel).includes('custom-model') ? 'custom-model-select' : undefined);
        e.closest = ()=> e;
        return e;
    };

    const ignore = new Proxy(function(){}, {get: ()=> ignore, apply: ()=> ignore});

    const sandbox = createContext({
        useProxy,
        Headers, JSON, Date, parseInt, parseFloat, Object, Array,
        Elem: {byId: element},
        alert: (message)=> alerts.push(message),
        Logger: {info(){}, debug(){}, warn(){}, err: (...parts)=> errors.push(parts.join(' '))},
        On: ignore, Modal: ignore, CustomDropdown: ignore,
        Request: {send: async ()=> undefined},
        Host: {urlForPath: (path)=> 'https://proxy.test' + path, checkServer: {ct: class {}}},
        Ai: {determineModel: ()=> ({providerId: 'OpenAi', model: 'gpt-4'})},
        Providers: {},
        // The file replaces Host.provideAPIKeys with the real one, which reads this.
        Ollama: {userBaseUrl: ()=> 'http://127.0.0.1:11434'},
        localStorage: {getItem: ()=> null, setItem(){}},
        document: {getElementById: ()=> element('model-temperature'), body: {style: {}}}
    });
    sandbox.globalThis = sandbox;

    // `const ProviderRoutes` is a lexical binding, so it is not a property of the
    // sandbox global; an appended line in the same scope is what exposes it.
    runInContext(read(FILE) + '\n;globalThis.exported = {getAPIParams, ProviderRoutes};',
                 sandbox, {filename: FILE});

    const { getAPIParams, ProviderRoutes } = sandbox.exported;
    const route = (providerId, model = 'some-model')=>
        getAPIParams([{role: 'user', content: 'hi'}], false, null, {providerId, model});

    return {route, ProviderRoutes, alerts, errors};
}

// The provider ids a user can actually pick, straight out of the dropdown markup.
function selectableProviderIds(){
    const html = read('resources/html/tabs/aitab.html');
    const open = html.indexOf('id="inference-select"');
    assert.notEqual(open, -1, "no inference-select in aitab.html — this test's parse is stale");
    const block = html.slice(open, html.indexOf('</select>', open));
    return [...block.matchAll(/<option\s+value="([^"]+)"/g)].map( (m)=> m[1] );
}

test('every provider the dropdown offers has a route', ()=>{
    const { ProviderRoutes } = loadRouting(true);
    const selectable = selectableProviderIds();

    assert.ok(selectable.length > 0, 'parsed no dropdown options at all');
    assert.ok(Object.keys(ProviderRoutes).length > 0, 'read no routes at all');

    const unrouted = selectable.filter( (id)=> !ProviderRoutes[id] );
    assert.deepEqual(unrouted, [],
        'A provider with no route gets no request sent at all. Before ProviderRoutes '
      + 'existed this was worse than an error: both switches ended in `default:`, '
      + 'which is OpenAI, so the request went to OpenAI under the OpenAI key.'
    );
});

test('an unrouted provider is refused rather than sent to OpenAI', ()=>{
    // The regression this guards is silent by construction, so it is worth pinning
    // from both sides: the call has to fail, and it specifically must not come back
    // holding an OpenAI URL.
    for (const useProxy of [true, false]) {
        const { route, errors } = loadRouting(useProxy);
        const result = route('typo-provider');

        assert.equal(result, null, `useProxy=${useProxy}: expected null for an unknown provider`);
        assert.ok(errors.some( (e)=> e.includes('typo-provider') ),
            `useProxy=${useProxy}: the refusal has to say which provider it refused`);
    }
});

test('the direct route sends each provider to its own host', ()=>{
    const { route, alerts } = loadRouting(false);

    assert.equal(route('OpenAi').API_URL, 'https://api.openai.com/v1/chat/completions');
    assert.equal(route('GROQ').API_URL, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(route('ollama').API_URL, 'http://127.0.0.1:11434/api/chat');
    assert.equal(route('custom', CUSTOM_MODEL).API_URL, 'https://custom.example/v1');

    // Anthropic has no direct route. It must say so and send nothing, rather than
    // falling through to whatever host happens to be next.
    assert.equal(route('anthropic'), null);
    assert.ok(alerts.some( (a)=> a.includes('proxy server') ),
        'refusing the direct Anthropic route without telling the user leaves a dead button');
});

test('the proxy route sends each provider to its own proxy path', ()=>{
    const { route, ProviderRoutes } = loadRouting(true);

    for (const [providerId, descriptor] of Object.entries(ProviderRoutes)) {
        if (descriptor.managed) continue;   // neurite is answered before either route
        const model = descriptor.fromModelData ? CUSTOM_MODEL : 'some-model';
        assert.equal(route(providerId, model).API_URL, 'https://proxy.test' + descriptor.proxyPath,
            `${providerId} did not reach the proxy path its descriptor names`);
    }
});

test('a Bearer header goes only to the providers whose key was read', ()=>{
    // This is the invariant worth stating out loud: a provider must never send a
    // key it did not read. Attaching one key to another provider's host is how a
    // credential leaks, and it is invisible from the UI.
    const { route, ProviderRoutes } = loadRouting(false);

    for (const [providerId, descriptor] of Object.entries(ProviderRoutes)) {
        if (descriptor.managed || descriptor.proxyOnly) continue;
        const model = descriptor.fromModelData ? CUSTOM_MODEL : 'some-model';
        const auth = route(providerId, model).headers.get('Authorization');

        if (!descriptor.bearer) {
            assert.equal(auth, null, `${providerId} attached a Bearer header it has no key for`);
            continue;
        }
        assert.equal(auth, `Bearer ${INPUT_VALUES[descriptor.keyInputId]}`,
            `${providerId} sent a key that is not the one its own input holds`);
    }
});

test('the proxy route never attaches a key to the request itself', ()=>{
    // Through the proxy the key is handed over separately, by provideAPIKeys. If a
    // Bearer header appeared here too, the browser would be shipping the raw key to
    // the proxy host on every call.
    const { route, ProviderRoutes } = loadRouting(true);

    for (const [providerId, descriptor] of Object.entries(ProviderRoutes)) {
        if (descriptor.managed) continue;
        const model = descriptor.fromModelData ? CUSTOM_MODEL : 'some-model';
        assert.equal(route(providerId, model).headers.get('Authorization'), null,
            `${providerId} attached a Bearer header on the proxy route`);
    }
});
