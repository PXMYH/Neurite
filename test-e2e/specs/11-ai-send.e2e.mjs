import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

// The two sends, the main prompt's and an AI Node's, driven for real against a routed
// OpenAI: nothing leaves the machine. A send gathers its context with helper calls -- the
// keywords first -- before it asks for the answer, and it is under way from its first line
// to its last. These pin what the reader sees of that, and what a stop costs.

let browser, context, page, calls, provider;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
    calls = [];
    // What the routed OpenAI does; a test changes it before it sends.
    provider = { helperDelay: 0, helperStatus: 200, forgetDelay: 0 };
    ({ context, page } = await openNeurite(browser, { setup: routeProviders }));
});
afterEach(async () => { await context?.close(); });

// Routed before the page loads. With the documented gateway running on 7070, the page
// finds it at boot and sends everything through it: measured, 511 answers in 1.5 s. A
// streamed call is an answer, numbered in order; a single call is a helper -- the keywords,
// or `forget` -- held and answered as `provider` says.
async function routeProviders(ctx) {
    await ctx.route('http://localhost:7070/**', (route) => route.abort());
    await ctx.route('https://api.openai.com/**', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        const forget = JSON.stringify(body.messages || '').includes('should be forgotten');
        const call = { n: calls.length + 1, kind: body.stream ? 'answer' : forget ? 'forget' : 'keywords', at: Date.now() };
        calls.push(call);
        if (body.stream) {
            return route.fulfill({ status: 200, contentType: 'text/event-stream',
                body: `data: {"choices":[{"delta":{"content":"ANSWER-${call.n}"}}]}\n\ndata: [DONE]\n\n` });
        }
        await new Promise((resolve) => setTimeout(resolve, forget ? provider.forgetDelay : provider.helperDelay));
        if (provider.helperStatus !== 200) {
            return route.fulfill({ status: provider.helperStatus, contentType: 'application/json', body: '{"message":"no"}' });
        }
        const content = forget ? 'Nothing' : '"fractal", "zoom", "depth"';
        return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content } }] }) });
    });
}

const mainAtRest = () => page.evaluate(() => ({
    responding: Ai.isResponding,
    loader: Elem.byId('aiLoadingIcon').style.display,
    icon: Ai.mainPrompt.use.getAttribute('xlink:href'),
}));
const useOpenAi = (key = 'sk-test') => page.evaluate((k) => {
    Elem.byId('inference-select').value = 'OpenAi';
    Elem.byId('api-key-input').value = k;
}, key);
const sendMain = (text) => page.evaluate((t) => { Elem.byId('prompt').value = t; return sendMessage(null); }, text);
const clickStop = () => page.evaluate(() => Elem.byId('regen-button').click());
const callsSince = (at) => calls.filter((c) => c.at > at).map((c) => c.kind);

// It stayed "responding" whenever the answer's own call never started -- no key, Neurite
// signed out -- and auto mode went round again on nothing: measured, 25 passes and 49
// sign-in dialogs in 3 s with Neurite signed out.
test('a send that gets no answer ends at rest, and auto mode does not go round again', async () => {
    await useOpenAi('');
    await page.evaluate(() => {
        window.__alerts = [];
        window.alert = async (m) => { window.__alerts.push(m) };
        Elem.byId('auto-mode-checkbox').checked = true;
    });
    await sendMain('hello there');
    await page.waitForTimeout(1500);

    assert.deepEqual(await page.evaluate(() => window.__alerts), ['Please enter your API key'], 'one send, one alert');
    assert.deepEqual(await mainAtRest(), { responding: false, loader: 'none', icon: '#refresh-icon' });
});

// The stop button stops the send wherever it is. Pressed while the keywords were fetched it
// used to regenerate, deleting the last exchange; then it stopped the helper and paid for
// the rest anyway -- forget, and the answer.
test('a stop while the keywords are fetched asks for nothing more, and gives the question back', async () => {
    await useOpenAi();
    await page.evaluate(() => { Elem.byId('forget-checkbox').checked = true });
    await sendMain('first question about fractals');
    await page.waitForTimeout(500);

    provider.helperDelay = 800;
    const second = sendMain('second question about zoom');
    await page.waitForTimeout(300);                                // inside the keyword call
    assert.equal((await mainAtRest()).responding, true, 'under way while the helper runs');
    const stoppedAt = Date.now();
    await clickStop();
    await second;
    await page.waitForTimeout(1200);

    assert.deepEqual(callsSince(stoppedAt), [], 'no forget and no answer after the stop');
    const notes = await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue());
    assert.ok(notes.includes('ANSWER-1'), 'the last exchange is still there');
    assert.ok(!notes.includes('second question'), 'and nothing of the stopped one was written');
    assert.equal(await page.evaluate(() => Elem.byId('prompt').value), 'second question about zoom');
    assert.deepEqual(await mainAtRest(), { responding: false, loader: 'none', icon: '#refresh-icon' });
});

test('a stop during forget asks for no answer', async () => {
    await useOpenAi();
    await page.evaluate(() => { Elem.byId('forget-checkbox').checked = true });
    await sendMain('first question about fractals');
    await page.waitForTimeout(500);

    provider.forgetDelay = 800;
    const second = sendMain('second question about zoom');
    for (let i = 0; i < 50 && !calls.some((c) => c.kind === 'forget' && c.n > 1); i++) await page.waitForTimeout(20);
    const stoppedAt = Date.now();
    await clickStop();
    await second;
    await page.waitForTimeout(1200);

    assert.deepEqual(callsSince(stoppedAt), [], 'no answer after the stop');
    assert.deepEqual(await mainAtRest(), { responding: false, loader: 'none', icon: '#refresh-icon' });
});

// A shared stop flag could not tell a stopped send from the one sent after it: stopped
// during a helper that cannot be aborted and sent again, the first resumed when its helper
// settled, and both questions were answered.
test('a send stopped and sent again answers only the second', async () => {
    await useOpenAi();
    await sendMain('first question about fractals');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        // Wikipedia is a request nothing aborts: held for 1.5 s.
        Elem.byId('wiki-checkbox').checked = true;
        window.__wiki = 0;
        Wikipedia.getSummaries = () => new Promise((resolve) => { window.__wiki++; setTimeout(resolve, 1500, '') });
    });

    const stopped = sendMain('the question stopped');
    await page.waitForTimeout(300);
    await clickStop();
    await page.evaluate(() => { Elem.byId('wiki-checkbox').checked = false });
    await sendMain('the question sent again');
    await stopped;
    await page.waitForTimeout(1500);

    const notes = await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue());
    assert.ok(notes.includes('the question sent again'), 'the second is asked');
    assert.ok(!notes.includes('the question stopped'), 'the stopped one is not');
    assert.equal(calls.filter((c) => c.kind === 'answer').length, 2, 'one answer for each question asked');
    assert.deepEqual(await mainAtRest(), { responding: false, loader: 'none', icon: '#refresh-icon' });
});

// One send at a time: Enter again while one ran ended the first send's state early, and a
// click then deleted the first exchange.
test('a second send while one runs waits, and keeps its text', async () => {
    await useOpenAi();
    await sendMain('first question about fractals');
    await page.waitForTimeout(500);

    provider.helperDelay = 800;
    const first = sendMain('second question about zoom');
    await page.waitForTimeout(300);
    await page.evaluate(() => { Elem.byId('prompt').value = 'third, too soon'; return sendMessage(null) });
    assert.equal(await page.evaluate(() => Elem.byId('prompt').value), 'third, too soon', 'refused, and left in the box');
    await first;
    await page.waitForTimeout(500);
    assert.equal(calls.filter((c) => c.kind === 'answer').length, 2);
});

// A helper that throws ends the send like any failure.
test('a helper that throws shows the error and gives the question back', async () => {
    await useOpenAi();
    await page.evaluate(() => { Graph.searchNotes = async () => { throw new Error('search failed') } });
    await sendMain('a question the search breaks');
    await page.waitForTimeout(800);

    assert.equal(await page.evaluate(() => Elem.byId('aiErrorIcon').style.display), 'block');
    assert.equal(await page.evaluate(() => Elem.byId('prompt').value), 'a question the search breaks');
    assert.deepEqual(await mainAtRest(), { responding: false, loader: 'none', icon: '#refresh-icon' });
});

async function makeAiNode() {
    await page.evaluate(() => {
        Elem.byId('api-key-input').value = 'sk-test';
        const node = window.__node = createLlmNode('Probe AI', 0.2, 0.1);
        node.inferenceSelect.value = 'OpenAi';
        Elem.byId('wiki-checkbox-' + node.index).checked = true;   // so it fetches keywords
        Wikipedia.getSummaries = async () => '';                    // and asks no server
    });
    await page.waitForTimeout(300);
}
const nodeState = () => page.evaluate(() => {
    const n = window.__node;
    return {
        answers: n.aiResponseTextArea.value.match(/ANSWER-\d+/g) || [],
        responding: n.aiResponding,
        loader: n.content.querySelector('#aiLoadingIcon-' + n.index).style.display,
        prompt: n.promptTextArea.value,
        conversation: n.aiResponseTextArea.value,
    };
});
const sendNode = (text) => page.evaluate((t) => AiNode.sendMessage(window.__node, t), text);

// A helper's failure halted the Node, so the answer asked for next was thrown away.
test("an AI Node's answer arrives when its keyword call fails", async () => {
    await makeAiNode();
    await sendNode('first question about fractals');
    await page.waitForTimeout(500);
    provider.helperStatus = 429;
    await sendNode('second question about zoom');
    await page.waitForTimeout(800);

    const state = await nodeState();
    assert.deepEqual(state.answers, ['ANSWER-1', 'ANSWER-3'], 'both answers, the keyword call between them');
    assert.equal(state.responding, false);
    assert.equal(state.loader, 'none');
});

// Stopped during a helper nothing aborts -- Wikipedia, held for 1.5 s -- the question came
// back only when the helper settled, over whatever had been typed in the box since.
test('an AI Node stopped during a helper asks for nothing more, and gives the question back at once', async () => {
    await makeAiNode();
    await sendNode('first question about fractals');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        Wikipedia.getSummaries = () => new Promise((resolve) => setTimeout(resolve, 1500, ''));
    });

    const second = sendNode('second question about zoom');
    await page.waitForTimeout(400);                                  // keywords done, Wikipedia held
    const stoppedAt = Date.now();
    await page.evaluate(() => window.__node.regenerateButton.click());
    const atStop = await nodeState();
    assert.equal(atStop.prompt, 'second question about zoom', 'the question goes back at the stop');
    assert.equal(atStop.loader, 'none', 'and the loader stops');
    await page.evaluate(() => { window.__node.promptTextArea.value = 'typed since' });
    await second;
    await page.waitForTimeout(500);

    assert.deepEqual(callsSince(stoppedAt), [], 'no helper and no answer after the stop');
    const state = await nodeState();
    assert.equal(state.prompt, 'typed since', 'what was typed after the stop is kept');
    assert.ok(!state.conversation.includes('second question'), 'and the question is not left unanswered in the conversation');
    assert.equal(state.responding, false);
});
