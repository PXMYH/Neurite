import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Edges, and whether they come back. The first reload tests in the suite: nothing had ever
// reloaded a Graph, so none of this was measured before #49.

// Nodes by kind and Edges by their two Titles, which is what a reader would count.
const snapshot = (page) => page.evaluate(() => {
    const kind = (n) => n.isTextNode ? 'text' : n.isLLM ? 'ai' : 'other';
    const nodes = {};
    for (const n of Object.values(Graph.nodes)) nodes[kind(n)] = (nodes[kind(n)] || 0) + 1;
    const edges = Object.values(Graph.edges)
        .map((e) => e.pts.map((p) => p.getTitle()).sort().join(' - ')).sort();
    return { nodes, edges };
});

// Save with time to spare, reload in the same context (so IndexedDB is kept), and wait for
// the Graph to come back rather than for `appReady`, which flips before the restore lands.
async function saveAndReload(page, nodeCount) {
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction((n) => Object.keys(Graph.nodes).length >= n, nodeCount, { timeout: 15000 });
    await page.waitForTimeout(800);
}

// A point on a card that is the card itself: the top padding of its header, clear of the
// title field and the buttons.
const cardSpot = (page, uuid) => page.evaluate((id) => {
    const r = Graph.nodes[id].view.div.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 3 };
}, uuid);

test('the Shift connect gesture joins a note to an AI Node, and the Edge survives a reload', async () => {
    const text = await addNote(page, 'Text end', 'A text note.');
    const ai = await page.evaluate(() => createLlmNode('Plane AI', 0.4, 0.2).uuid);
    await page.waitForTimeout(1000);

    const a = await cardSpot(page, text), b = await cardSpot(page, ai);
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    const made = await snapshot(page);
    assert.deepEqual(made.edges, ['Plane AI - Text end'], 'the gesture made one Edge');
    // The strength the spring gets. `connectNodes` passed half the distance into it, so a
    // pointer-drawn Edge to a non-text Node was as stiff as it was long.
    const strength = await page.evaluate(() => Object.values(Graph.edges)[0].strength);
    assert.equal(strength, 0.1);

    await saveAndReload(page, 2);
    assert.deepEqual(await snapshot(page), made, 'the same Nodes and Edge after a reload');
});

// An AI Node written in the notes pane (`AI: Title`) came back twice after one reload, and
// three times after two: the restore pass bound text Nodes to their saved selves and built
// a fresh AI Node every time. Its Edge was duplicated with it.
test('an AI Node written in the notes pane comes back once, however many reloads', async () => {
    await page.evaluate(() => {
        const cm = window.currentActiveZettelkastenMirror;
        cm.setValue(`${LLM_TAG} Pane AI\n\n${Tag.node} Refers\nPoints at it. [[Pane AI]]\n`);
    });
    // On the pass the edit itself runs. That pass handled the first section it changed
    // and no other, so the Ref waited for the save's full pass, up to 8 s later.
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, undefined, { timeout: 2000 });
    const made = await snapshot(page);
    assert.deepEqual(made.nodes, { ai: 1, text: 1 });

    await saveAndReload(page, 2);
    assert.deepEqual(await snapshot(page), made, 'after one reload');
    await saveAndReload(page, 2);
    assert.deepEqual(await snapshot(page), made, 'after two');
});

// A card that does not come back -- markup the loader cannot read -- leaves the Edges
// that pointed at it dangling. Building one threw inside the next card's restore.
test('a saved Edge to a card that did not come back costs no other card', async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror
        .setValue('## A\nSee [[B]] and [[C]].\n\n## B\nb\n\n## C\nc\n'));
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 2, undefined, { timeout: 5000 });
    await page.evaluate(() => App.viewGraphs.saveNow());
    // The real save, with C's card cut out of it.
    const saved = await page.evaluate(async () => {
        const c = Object.values(Graph.nodes).find((n) => n.getTitle() === 'C').uuid;
        const graphId = await new Stored('state', 'GraphsView').load('latest-selected');
        const div = document.createElement('div');
        div.innerHTML = await new Stored('graphs', 'graph-data').load(graphId);
        const card = [...div.children].find((el) => el.dataset.node_json
            && JSON.parse(el.dataset.node_json).uuid === c);
        card?.remove();
        return card ? div.innerHTML : null;
    });
    assert.ok(saved, "C's card should be in the save to cut out");

    // Loaded the way a shared link loads one, into a fresh context.
    const other = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
        await other.route('**/wiki/pages/neurite-wikis/dangling.txt',
            (route) => route.fulfill({ body: saved, contentType: 'text/plain' }));
        const loaded = await other.newPage();
        await loaded.goto(new URL('?state=dangling', page.url()).href, { waitUntil: 'domcontentloaded' });
        await loaded.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
        await loaded.waitForFunction(() => Object.keys(Graph.nodes).length === 3, undefined, { timeout: 10000 });
        await loaded.waitForTimeout(800);

        const cards = await loaded.evaluate(() => Object.fromEntries(Object.values(Graph.nodes)
            .map((n) => [n.getTitle(), TextArea.ofNode(n).value.trim()])));
        // C comes back from the notes pane, which still names it; A and B keep their text.
        assert.deepEqual(cards, { A: 'See [[B]] and [[C]].', B: 'b', C: 'c' });
        assert.deepEqual((await snapshot(loaded)).edges, ['A - B', 'A - C']);
    } finally {
        await other.close();
    }
});

test('an Edge written as a Ref between two notes survives a reload', async () => {
    await addNote(page, 'Target', 'A note to point at.');
    await addNote(page, 'Source', 'Pointing. [[Target]]');
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, undefined, { timeout: 8000 });
    const made = await snapshot(page);

    await saveAndReload(page, 2);
    assert.deepEqual(await snapshot(page), made);
});
