import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

const nodeCount = (page) => page.evaluate(() => Object.keys(Graph.nodes).length);

test('creates a note through the neural API', async () => {
    const before = await nodeCount(page);
    const uuid = await addNote(page, 'API Note', 'made via createNote');
    assert.ok(uuid, 'returned a uuid');
    assert.equal(await nodeCount(page), before + 1, 'one node added');

    const title = await page.evaluate((id) => Graph.nodes[id].view.titleInput.value, uuid);
    assert.equal(title, 'API Note');
});

test('creates a note with Shift + double-click on the canvas', async () => {
    // The real gesture: node-mode is held (Shift) and the double-click must land
    // on the canvas itself -- createnodes.js gates on e.target.id === 'svg_bg'.
    // The fractal draws thin <path> hairs inside #bg that can steal the hit, so
    // #bg is made click-through for the gesture; svg#svg_bg then receives it.
    const before = await nodeCount(page);
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = 'none'; });
    await page.keyboard.down('Shift');
    await page.mouse.dblclick(1000, 600);
    await page.keyboard.up('Shift');
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = ''; });

    await page.waitForFunction((n) => Object.keys(Graph.nodes).length === n + 1, before, { timeout: 5000 });
    assert.equal(await nodeCount(page), before + 1, 'one node added by the gesture');
});

test('connectNodes writes an edge between two notes', async () => {
    const a = await addNote(page, 'A', 'alpha');
    const b = await addNote(page, 'B', 'beta');
    await page.evaluate(([ua, ub]) => { connectNodes(Graph.nodes[ua], Graph.nodes[ub]); }, [a, b]);

    // The edge key is the two endpoint uuids sorted and joined with '-'.
    const wantKey = [a, b].sort().join('-');
    await page.waitForFunction(
        (key) => Object.values(Graph.edges).some(e =>
            e.pts.map(n => n.uuid).sort().join('-') === key),
        wantKey,
        { timeout: 5000 }
    );
    const connected = await page.evaluate(
        (key) => Object.values(Graph.edges).some(e =>
            e.pts.map(n => n.uuid).sort().join('-') === key),
        wantKey
    );
    assert.ok(connected, `an edge joins the two notes (key ${wantKey})`);
});
