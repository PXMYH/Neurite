import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, nodeDiv } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

const isCollapsed = (page, uuid) =>
    page.evaluate((id) => Graph.nodes[id].view.div.classList.contains('collapsed'), uuid);

// Locks commit 1f4fb0c. A selection is the shortcut's explicit target (it wins
// over the card under the pointer), so selecting first drives the chord without
// depending on pointer position.
test('Ctrl+Shift+M collapses and Ctrl+Shift+F expands a selected card', async () => {
    const uuid = await addNote(page, 'Collapsible', '');
    await page.evaluate((id) => { App.selectedNodes.toggleNode(Graph.nodes[id]); }, uuid);

    await page.keyboard.press('Control+Shift+KeyM');
    await page.waitForFunction((id) => Graph.nodes[id].view.div.classList.contains('collapsed'), uuid, { timeout: 5000 });
    assert.ok(await isCollapsed(page, uuid), 'collapsed after Ctrl+Shift+M');

    await page.keyboard.press('Control+Shift+KeyF');
    await page.waitForFunction((id) => !Graph.nodes[id].view.div.classList.contains('collapsed'), uuid, { timeout: 5000 });
    assert.ok(!(await isCollapsed(page, uuid)), 'expanded after Ctrl+Shift+F');
});

// Shift + scroll resizes a card: node-mode (Shift held) gates Node.onWheel, and
// scrolling up zooms in (commit ed5b1a0), which multiplies node.scale up.
test('Shift + scroll up grows a card scale', async () => {
    const uuid = await addNote(page, 'Resizable', '');
    const win = await nodeDiv(page, uuid);

    const before = await page.evaluate((id) => Graph.nodes[id].scale, uuid);
    await win.hover();
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Shift');

    await page.waitForFunction(
        ([id, b]) => Graph.nodes[id].scale > b,
        [uuid, before],
        { timeout: 5000 }
    );
    const after = await page.evaluate((id) => Graph.nodes[id].scale, uuid);
    assert.ok(after > before, `scale grew ${before} -> ${after}`);
});

// Every dropdown part in an AI Node has a name (#66), including one that comes back from a
// Saved Graph written before the names were. Naming them where they were built missed that
// path: measured, an AI Node saved by the old build loaded with 14 of 14 unnamed. The old
// save is made here by taking the names back out of a real one.
const unnamedInAi = (page) => page.evaluate(() => {
    const ai = Object.values(Graph.nodes).find((n) => n.isLLM);
    const parts = [...ai.view.div.querySelectorAll('[role="combobox"], [role="listbox"]')];
    return { parts: parts.length, unnamed: parts.filter((el) => !el.getAttribute('aria-label')).length };
});

test("an AI Node's dropdowns are named, new and restored from an unnamed save", async () => {
    await page.evaluate(() => createLlmNode('Named AI', 0.2, 0.1));
    await page.waitForTimeout(800);
    const fresh = await unnamedInAi(page);
    assert.ok(fresh.parts > 0, 'the AI Node should have dropdowns to name');
    assert.equal(fresh.unnamed, 0, 'a new AI Node');

    await page.evaluate(() => App.viewGraphs.saveNow());
    const oldSave = await page.evaluate(async () => {
        const graphId = await new Stored('state', 'GraphsView').load('latest-selected');
        const div = document.createElement('div');
        div.innerHTML = await new Stored('graphs', 'graph-data').load(graphId);
        const card = [...div.children].find((el) => el.querySelector('.select-replacer'));
        for (const el of card.querySelectorAll('[aria-label]')) el.removeAttribute('aria-label');
        return div.innerHTML;
    });

    const other = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
        await other.route('**/wiki/pages/neurite-wikis/unnamed.txt',
            (route) => route.fulfill({ body: oldSave, contentType: 'text/plain' }));
        const loaded = await other.newPage();
        await loaded.goto(new URL('?state=unnamed', page.url()).href, { waitUntil: 'domcontentloaded' });
        await loaded.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
        await loaded.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.isLLM), undefined, { timeout: 15000 });
        await loaded.waitForTimeout(800);
        assert.deepEqual(await unnamedInAi(loaded), { parts: fresh.parts, unnamed: 0 }, 'a restored one');
    } finally {
        await other.close();
    }
});
