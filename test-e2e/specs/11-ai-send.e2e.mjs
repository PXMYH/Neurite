import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The two sends, the main prompt's and an AI Node's, driven for real against a routed
// OpenAI: nothing leaves the machine. A send gathers its context with helper calls -- the
// keywords first -- before it asks for the answer, and it is under way from its first line
// to its last. These pin what the reader sees of that, and what a stop costs.

// Routes OpenAI. A streamed call is an answer, numbered in order; a single call is a
// helper, held for `helperDelay` ms and answered with `helperStatus`.
async function routeOpenAi({ helperDelay = 0, helperStatus = 200 } = {}) {
    const calls = [];
    await context.route('https://api.openai.com/**', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        const call = { n: calls.length + 1, stream: body.stream, at: Date.now() };
        calls.push(call);
        if (body.stream) {
            return route.fulfill({ status: 200, contentType: 'text/event-stream',
                body: `data: {"choices":[{"delta":{"content":"ANSWER-${call.n}"}}]}\n\ndata: [DONE]\n\n` });
        }
        await new Promise((resolve) => setTimeout(resolve, helperDelay));
        if (helperStatus !== 200) {
            return route.fulfill({ status: helperStatus, contentType: 'application/json', body: '{"message":"no"}' });
        }
        return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content: '"fractal", "zoom", "depth"' } }] }) });
    });
    // No gateway: its absence is the case these tests are about.
    await context.route('http://localhost:7070/**', (route) => route.abort());
    return calls;
}

const mainAtRest = () => page.evaluate(() => ({
    responding: Ai.isResponding,
    loader: Elem.byId('aiLoadingIcon').style.display,
    icon: Ai.mainPrompt.use.getAttribute('xlink:href'),
}));
const sendMain = (text) => page.evaluate((t) => { Elem.byId('prompt').value = t; return sendMessage(null); }, text);

// It stayed "responding" whenever the answer's own call never started -- no key, Neurite
// signed out -- and auto mode went round again on nothing: measured, 25 passes and 49
// sign-in dialogs in 3 s with Neurite signed out.
test('a send that gets no answer ends at rest, and auto mode does not go round again', async () => {
    await page.evaluate(() => {
        window.__alerts = [];
        window.alert = async (m) => { window.__alerts.push(m) };
        Elem.byId('inference-select').value = 'OpenAi';
        Elem.byId('api-key-input').value = '';
        Elem.byId('auto-mode-checkbox').checked = true;
    });
    await sendMain('hello there');
    await page.waitForTimeout(1500);

    assert.deepEqual(await page.evaluate(() => window.__alerts), ['Please enter your API key'], 'one send, one alert');
    assert.deepEqual(await mainAtRest(), { responding: false, loader: 'none', icon: '#refresh-icon' });
});

// The stop button stops the send wherever it is. Pressed while the keywords were fetched it
// used to regenerate, deleting the last exchange; then it stopped the helper and paid for
// the answer anyway.
test('a stop while the keywords are fetched asks for nothing more, and gives the question back', async () => {
    const calls = await routeOpenAi({ helperDelay: 800 });
    await page.evaluate(() => {
        Elem.byId('inference-select').value = 'OpenAi';
        Elem.byId('api-key-input').value = 'sk-test';
    });
    await sendMain('first question about fractals');
    await page.waitForTimeout(500);

    const second = sendMain('second question about zoom');
    await page.waitForTimeout(300);                                // inside the keyword call
    assert.equal((await mainAtRest()).responding, true, 'under way while the helper runs');
    const stoppedAt = Date.now();
    await page.evaluate(() => Elem.byId('regen-button').click());
    await second;
    await page.waitForTimeout(1200);

    assert.equal(calls.filter((c) => c.stream && c.at > stoppedAt).length, 0, 'no answer asked for after the stop');
    const notes = await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue());
    assert.ok(notes.includes('ANSWER-1'), 'the last exchange is still there');
    assert.ok(!notes.includes('second question'), 'and nothing of the stopped one was written');
    assert.equal(await page.evaluate(() => Elem.byId('prompt').value), 'second question about zoom');
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
    await routeOpenAi({ helperStatus: 429 });
    await makeAiNode();
    await sendNode('first question about fractals');
    await page.waitForTimeout(500);
    await sendNode('second question about zoom');
    await page.waitForTimeout(800);

    const state = await nodeState();
    assert.deepEqual(state.answers, ['ANSWER-1', 'ANSWER-3'], 'both answers, the keyword call between them');
    assert.equal(state.responding, false);
    assert.equal(state.loader, 'none');
});

test('an AI Node stopped during its keywords asks for nothing more, and keeps the question', async () => {
    const calls = await routeOpenAi({ helperDelay: 800 });
    await makeAiNode();
    await sendNode('first question about fractals');
    await page.waitForTimeout(500);

    const second = sendNode('second question about zoom');
    await page.waitForTimeout(300);
    const stoppedAt = Date.now();
    await page.evaluate(() => window.__node.regenerateButton.click());
    await second;
    await page.waitForTimeout(1200);

    assert.equal(calls.filter((c) => c.stream && c.at > stoppedAt).length, 0, 'no answer asked for after the stop');
    const state = await nodeState();
    assert.equal(state.prompt, 'second question about zoom', 'the question goes back where it was typed');
    assert.ok(!state.conversation.includes('second question'), 'and is not left in the conversation unanswered');
    assert.equal(state.responding, false);
    assert.equal(state.loader, 'none');
});
