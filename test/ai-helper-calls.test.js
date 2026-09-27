// A single, non-streamed AI call is a helper inside a send -- the keywords, a search query,
// what to forget -- and must leave the conversation's state to the call that streams the
// answer. Routed through an AI Node, the keyword call's start and end flipped the Node to
// "not responding" before the answer began, so its stop button regenerated instead; and
// its failure halted the Node, so the answer asked for next arrived and was thrown away
// (measured in Chromium with a 429 on the keyword call).
//
// `AiCall` runs for real in a node:vm context; `callAiApi`, the one thing it calls, is
// replaced after load to record what it was handed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../js/ai/ai_v2.js', import.meta.url), 'utf8');

function load(){
    const ctx = vm.createContext({
        Logger: {info(){}, debug(){}, warn(){}, err(){}},
        AbortController,
        Elem: {byId: ()=> ({style: {}}), hideById(){}},
        Svg: {pause: 'pause', refresh: 'refresh'},
        Host: {urlForPath: (p)=> 'http://localhost:7070' + p},
    });
    // `Function.nop` comes from main.js; the context's own `Function` needs it too.
    vm.runInContext('Function.nop = function(){};' + SRC
        + ';globalThis.AiCall = AiCall; globalThis.Ai = Ai;', ctx);
    const handed = [];
    // A function declaration is a property of the script's global, so this replaces it
    // for the class that calls it by name.
    ctx.callAiApi = async (args)=>{ handed.push(args); return 'answer' };
    ctx.Ai.mainPrompt = {setPause(){}, setRefresh(){}};
    return {ctx, handed};
}

// An AI Node as far as `#callchatLLMnode` reaches into it.
function makeNode(){
    const shown = {};
    const node = {
        index: 7, aiResponding: false, shouldContinue: true, halted: 0,
        haltResponse(){ node.halted += 1 },
        regenerateButton: {innerHTML: 'refresh'},
        controller: new AbortController(),
        aiResponseTextArea: {},
        content: {querySelector: (sel)=> {
            if (sel.startsWith('#node-temperature-')) return {value: '0.8'};
            return (shown[sel] ??= {style: {display: 'none'}});
        }},
    };
    return node;
}

test("an AI Node's helper call leaves the Node's state alone, and does not halt it", async ()=>{
    const {ctx, handed} = load();
    ctx.Ai.determineModel = ()=> ({providerId: 'OpenAi', model: 'm'});
    const node = makeNode();
    node.aiResponding = true;                  // the send under way

    const call = ctx.AiCall.single(node).addUserPrompt('keywords, please');
    call.customTemperature = 0;
    await call.exec();

    const args = handed[0];
    args.onBeforeCall();
    args.onAfterCall();
    args.onError('429 rate limited');
    assert.equal(node.aiResponding, true, 'still responding: the answer has not been asked for yet');
    assert.equal(node.halted, 0, "a helper's failure does not stop the send");
    assert.equal(args.customTemperature, 0, "the helper's own temperature, not the Node's");
});

test("an AI Node's streamed answer still drives the Node", async ()=>{
    const {ctx, handed} = load();
    ctx.Ai.determineModel = ()=> ({providerId: 'OpenAi', model: 'm'});
    const node = makeNode();

    await ctx.AiCall.stream(node).addUserPrompt('the question').exec();

    const args = handed[0];
    args.onBeforeCall();
    assert.equal(node.aiResponding, true);
    args.onError('500');
    assert.equal(node.halted, 1, 'the answer failing does stop the send');
    assert.equal(args.customTemperature, 0.8, "the Node's temperature");
});

test("a global helper call leaves the prompt's state alone, and keeps a stop", async ()=>{
    const {ctx, handed} = load();
    ctx.Ai.isResponding = true;               // the send under way
    ctx.Ai.shouldContinue = false;            // and stopped while an earlier helper ran

    await ctx.AiCall.single().addUserPrompt('keywords, please').exec();

    handed[0].onBeforeCall();
    handed[0].onAfterCall();
    assert.equal(ctx.Ai.isResponding, true);
    assert.equal(ctx.Ai.shouldContinue, false, 'the stop still holds for the next step');
});

// Streamed, and still not the answer: Wolfram's reformulation. It says so, and is then a
// helper like any single call -- its start and end ended "responding" before the answer,
// and its start reset a stop already pressed.
test('a streamed call marked as a helper leaves the send alone', async ()=>{
    const {ctx, handed} = load();
    ctx.Ai.isResponding = true;
    ctx.Ai.shouldContinue = false;

    await ctx.AiCall.stream().asHelper().addUserPrompt('reformulate').exec();

    handed[0].onBeforeCall();
    handed[0].onAfterCall();
    assert.equal(ctx.Ai.isResponding, true);
    assert.equal(ctx.Ai.shouldContinue, false, 'the stop still holds');
});

// A streamed answer to an AI Node is what was streamed. The dummy responses stream and
// return nothing, so a Node's send read no answer, and its auto mode and message loop
// stopped after one pass.
test("an AI Node's streamed answer is what was streamed", async ()=>{
    const {ctx} = load();
    ctx.TextArea = {append(){}};
    ctx.Ai.determineModel = ()=> ({providerId: 'OpenAi', model: 'm'});
    ctx.callAiApi = async ({onStreamingResponse})=>{ onStreamingResponse('ANSWER'); return undefined };
    const node = makeNode();

    assert.equal(await ctx.AiCall.stream(node).addUserPrompt('the question').exec(), 'ANSWER');
});
