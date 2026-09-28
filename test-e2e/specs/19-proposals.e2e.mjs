import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Proposed Edges (#72). Five notes: Retrieval names Vector Store in its prose and shares the
// #rag Tag with Evaluation, Linked A and Linked B are joined already, and Vector Store has no
// Tag in common with anything. No model is loaded here: the AI features are off, or the
// embeddings are a stand-in that counts its calls.
const NOTES = [
    '## Retrieval', '---', 'type: concept', 'tags: [rag, search]', 'description: Finding passages for a model.', '---',
    'The Vector Store holds the chunks it searches.', '',
    '## Vector Store', '---', 'type: concept', 'tags: [storage]', 'description: Where the vectors live.', '---',
    'Rows of numbers.', '',
    '## Evaluation', '---', 'type: concept', 'tags: [rag, evals]', 'description: Judging the answers.', '---',
    'Judge with care.', '',
    '## Linked A', 'Its body.', '[[Linked B]]', '',
    '## Linked B', 'Its body.', '',
].join('\n');

async function setup(page, { ai = false, delay = 0 } = {}) {
    await page.evaluate(async ([text, ai, delay]) => {
        AiFeatures.enabled = ai;
        // A stand-in for the embeddings: letter counts, so similar words give similar vectors,
        // one request at a time as the Worker takes them.
        window.embedCalls = 0;
        let queue = Promise.resolve();
        Embeddings.fetch = async (t) => {
            window.embedCalls += 1;
            const turn = queue.then(() => new Promise((r) => setTimeout(r, delay)));
            queue = turn;
            await turn;
            const v = new Array(26).fill(0);
            for (const ch of t.toLowerCase()) { const k = ch.charCodeAt(0) - 97; if (k >= 0 && k < 26) v[k] += 1; }
            return v;
        };
        window.currentActiveZettelkastenMirror.setValue(text);
    }, [NOTES, ai, delay]);
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 5 && Object.values(Graph.nodes).some((n) => n.edges.length), undefined, { timeout: 10000 });
    await page.waitForTimeout(800);
}
async function openPanel(page) {
    await page.click('#proposeEdgesButton');
    await page.waitForFunction(() => {
        const s = document.querySelector('#customModal .proposals-status')?.textContent || '';
        return s && !/Reading/.test(s);
    }, undefined, { timeout: 15000 });
}
const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#customModal .proposal')].map((li) => ({
    pair: li.querySelector('.proposal-pair').textContent,
    why: [...li.querySelectorAll('.proposal-why')].map((w) => w.textContent),
    similarOnly: Boolean(li.closest('.proposals-similar')),
})));
const textOf = (page, title) => page.evaluate((t) => Object.values(Graph.nodes).find((n) => n.getTitle() === t).getText(), title);

test('the panel lists pairs with the words or Tags they rest on, and none already linked', async () => {
    await setup(page);
    await openPanel(page);
    const list = await rows(page);
    const status = await page.evaluate(() => document.querySelector('#customModal .proposals-status').textContent);
    assert.match(status, /3 notes have no Edge/);
    assert.match(status, /Similar wording is off with the AI features/);

    const mention = list.find((r) => r.pair === 'Retrieval→Vector Store' || r.pair === 'Vector Store→Retrieval');
    assert.ok(mention, 'Retrieval names Vector Store: ' + JSON.stringify(list));
    // The quotation marks are the `<q>`'s own, drawn by the browser rather than in the text.
    assert.deepEqual(mention.why, ['In Retrieval: The Vector Store holds the chunks it searches.']);
    const tags = list.find((r) => /Retrieval/.test(r.pair) && /Evaluation/.test(r.pair));
    assert.deepEqual(tags?.why, ['Both tagged #rag']);
    assert.ok(!list.some((r) => /Linked A/.test(r.pair) && /Linked B/.test(r.pair)), 'a linked pair is not proposed');
    // Reasons only, with the AI features off: nothing rests on wording alone.
    assert.ok(list.every((r) => !r.similarOnly && r.why.length), JSON.stringify(list));
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('proposal-pair')), true,
        'the keyboard is in the list');
    assert.deepEqual(errors, []);
});

test('choosing a pair frames both notes clear of the panel and draws the dashed line between them', async () => {
    await setup(page);
    await page.evaluate(() => { Graph.pan_set(new vec2(40, 40)); Hud.setZoomMag(0.01); });
    await openPanel(page);
    await page.click('#customModal .proposal .proposal-pair');
    await page.waitForTimeout(500);
    const seen = await page.evaluate(() => {
        const { a, b } = ZetProposals.shown;
        const panel = document.querySelector('#customModal .modal-content').getBoundingClientRect();
        const clear = (n) => { const r = n.view.div.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= panel.left && r.bottom <= innerHeight; };
        const path = document.getElementById('proposedEdge');
        return { a: clear(a), b: clear(b), d: path.getAttribute('d'), dash: getComputedStyle(path).strokeDasharray,
            box: path.getBoundingClientRect().width + path.getBoundingClientRect().height };
    });
    assert.ok(seen.a && seen.b, 'both cards on screen and left of the panel: ' + JSON.stringify(seen));
    assert.match(seen.d, /^M .+ L .+/);
    assert.notEqual(seen.dash, 'none');
    assert.ok(seen.box > 10, 'the line has a length on screen');

    await page.click('#customModal .close');
    assert.equal(await page.evaluate(() => document.getElementById('proposedEdge').getAttribute('d')), '', 'closing the panel takes the line away');
});

test('Link writes one Ref, into the note it is for, and makes the Edge', async () => {
    await setup(page);
    await openPanel(page);
    const row = page.locator('#customModal .proposal', { hasText: 'Vector Store' }).first();
    const [from, to] = (await row.locator('.proposal-pair').textContent()).split('→');
    const before = { from: await textOf(page, from), to: await textOf(page, to) };
    assert.equal(await row.locator('.proposal-link').getAttribute('data-tooltip'), `Writes [[${to}]] into ${from}.`);

    await row.locator('.proposal-link').click();
    await page.waitForTimeout(300);
    const afterFrom = await textOf(page, from);
    const words = (s) => s.replace(/\s+/g, ' ').trim();
    assert.equal(words(afterFrom.replace(`[[${to}]]`, '')), words(before.from), 'only the Ref was added: ' + JSON.stringify(afterFrom));
    assert.equal((afterFrom.match(/\[\[/g) || []).length - (before.from.match(/\[\[/g) || []).length, 1, 'one Ref');
    assert.equal(await textOf(page, to), before.to, 'the other note is unchanged');
    assert.equal(await page.evaluate(([a, b]) => {
        const n = (t) => Object.values(Graph.nodes).find((x) => x.getTitle() === t);
        return Boolean(findExistingEdge(n(a), n(b)));
    }, [from, to]), true, 'the Edge is made');
    assert.equal(await row.locator('.proposal-done').textContent(), 'Linked');
});

test('a dismissed pair stays dismissed through a save and a reload, and Undo brings it back', async () => {
    await setup(page);
    await openPanel(page);
    const first = page.locator('#customModal .proposal').first();
    const pair = await first.locator('.proposal-pair').textContent();
    await first.locator('.proposal-dismiss').click();
    assert.equal(await first.locator('.proposal-dismiss').textContent(), 'Undo');
    await first.locator('.proposal-dismiss').click();
    assert.equal(await page.evaluate(() => ZetProposals.dismissed.size), 0, 'Undo takes the dismissal back');
    await first.locator('.proposal-dismiss').click();

    await page.click('#customModal .close');
    await openPanel(page);
    assert.ok(!(await rows(page)).some((r) => r.pair === pair), 'not proposed again');

    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && Object.keys(Graph.nodes).length === 5, undefined, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => { AiFeatures.enabled = false; });
    await openPanel(page);
    assert.ok(!(await rows(page)).some((r) => r.pair === pair), 'still dismissed after a reload');
});

test('similar wording is read with a line saying how far it has got, once, and its rows start closed', async () => {
    await setup(page, { ai: true, delay: 150 });
    await page.click('#proposeEdgesButton');
    await page.waitForFunction(() => /Reading notes for similar wording: [1-4] of 5/.test(document.querySelector('#customModal .proposals-status')?.textContent || ''), undefined, { timeout: 10000, polling: 20 });
    await page.waitForFunction(() => !/Reading/.test(document.querySelector('#customModal .proposals-status')?.textContent || 'Reading'), undefined, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.embedCalls), 5);
    const similar = await page.evaluate(() => {
        const group = document.querySelector('#customModal .proposals-similar');
        return { shown: !group.hidden, open: group.open, rows: group.querySelectorAll('.proposal').length,
            summary: group.querySelector('summary').textContent };
    });
    assert.ok(similar.shown && !similar.open && similar.rows > 0, JSON.stringify(similar));
    assert.equal(similar.summary, `Similar wording only (${similar.rows})`);

    await page.click('#customModal .close');
    await openPanel(page);
    assert.equal(await page.evaluate(() => window.embedCalls), 5, 'a second look reads no note again');
});

// With the AI features on, and no vector read yet: opening the list is no reason to load a
// model, so the group rests on mentions and Tags until Propose Edges has read the notes.
test('the Connect modal proposes first, and a proposed row writes one Ref into the note being linked', async () => {
    await setup(page, { ai: true });
    await page.evaluate(() => new Modal.Connect(Object.values(Graph.nodes).find((n) => n.getTitle() === 'Vector Store')));
    await page.waitForFunction(() => document.querySelector('#nodeList li.proposed'), undefined, { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.embedCalls), 0, 'the Connect modal embedded notes');
    const list = await page.evaluate(() => [...document.querySelectorAll('#nodeList li')].map((li) => li.className + ' | ' + li.textContent));
    assert.match(list[0], /group-label \| Proposed$/);
    assert.match(list[1], /proposed.*\| Retrieval.*It mentions this note$/);

    const before = { vs: await textOf(page, 'Vector Store'), r: await textOf(page, 'Retrieval') };
    await page.click('#nodeList li.proposed');
    await page.waitForTimeout(300);
    const vs = await textOf(page, 'Vector Store');
    assert.equal((vs.match(/\[\[Retrieval\]\]/g) || []).length, 1, 'one Ref, in the note being linked: ' + JSON.stringify(vs));
    assert.equal(await textOf(page, 'Retrieval'), before.r, 'the other note is unchanged');
    assert.match(await page.evaluate(() => document.querySelector('#nodeList li.proposed').className), /\bconnected\b/);
});
