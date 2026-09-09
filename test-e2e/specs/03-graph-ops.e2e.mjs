import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, addAiNote, nodeDiv,
         paneText, deleteViaCard, deleteViaMenu } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

const nodeCount = (page) => page.evaluate(() => Object.keys(Graph.nodes).length);

// createNote is the text -> graph half of the Zettelkasten sync: it appends a
// `<Tag.node> title` section to the notes pane and the sync engine builds the node
// from that text. So this checks both ends agree -- the node carries the title and
// body, and the pane holds the section it was built from. Tag.node is read from
// the app, never hardcoded as '##', because the reader can reconfigure it.
test('creates a note through the neural API and the notes pane agrees', async () => {
    const before = await nodeCount(page);
    const uuid = await addNote(page, 'API Note', 'made via createNote');
    assert.ok(uuid, 'returned a uuid');
    assert.equal(await nodeCount(page), before + 1, 'one node added');

    const state = await page.evaluate((id) => ({
        title: Graph.nodes[id].view.titleInput.value,
        body: Graph.nodes[id].textarea.value,
        paneText: window.currentActiveZettelkastenMirror.getValue(),
        heading: `${Tag.node} API Note`,
    }), uuid);
    assert.equal(state.title, 'API Note');
    assert.equal(state.body, 'made via createNote', 'body reached the node');
    assert.ok(state.paneText.includes(state.heading), `pane holds "${state.heading}"`);
    assert.ok(state.paneText.includes('made via createNote'), 'pane holds the body line');
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

// Bodies are left empty on purpose: this test is about edges, and a note created
// with a body makes addNote wait for the body sync, which would redden this test
// for a body-sync regression that has nothing to do with connecting nodes.
test('connectNodes writes an edge between two notes', async () => {
    const a = await addNote(page, 'A');
    const b = await addNote(page, 'B');
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

// Deleting has to take the node, its window, and its edges together, and it has to
// leave the neighbour alone. All four are asserted in one test because the failure
// this guards against is partial: a delete that finds its targets by identity goes
// wrong when it is handed copies, and then the model drops the node while the DOM
// keeps the card, or the edge outlives an endpoint.
test('removing a node takes its window and its edge, and spares the neighbour', async () => {
    const a = await addNote(page, 'Doomed', '');
    const b = await addNote(page, 'Survivor', '');
    await page.evaluate(([ua, ub]) => { connectNodes(Graph.nodes[ua], Graph.nodes[ub]); }, [a, b]);
    await page.waitForFunction(() => Object.keys(Graph.edges).length > 0, undefined, { timeout: 5000 });

    // Hold the DOM node itself: after the delete its uuid is gone from the model,
    // so the card could only be found again through the handle taken here.
    const doomedCard = await nodeDiv(page, a);
    const survivorCard = await nodeDiv(page, b);

    await page.evaluate((id) => { Graph.nodes[id].remove(); }, a);
    await page.waitForFunction((id) => !(id in Graph.nodes), a, { timeout: 5000 });

    const state = await page.evaluate(([ua, ub, doomed, survivor]) => ({
        aInGraph: ua in Graph.nodes,
        bInGraph: ub in Graph.nodes,
        doomedInDom: doomed.isConnected,
        survivorInDom: survivor.isConnected,
        edgesLeft: Object.keys(Graph.edges).length,
    }), [a, b, doomedCard, survivorCard]);

    assert.equal(state.aInGraph, false, 'deleted node left Graph.nodes');
    assert.equal(state.doomedInDom, false, 'its window left the DOM');
    assert.equal(state.edgesLeft, 0, 'the edge went with it');
    assert.equal(state.bInGraph, true, 'the neighbour survives in the model');
    assert.equal(state.survivorInDom, true, 'the neighbour keeps its window');
});

// The pane is the source of truth, so a delete that drops the node and leaves its
// section behind leaves the note in the reader's notes -- and the next full pass can
// build the node back from it. Both delete paths are covered because they are
// reached differently, and an AI note is used for both: its section opens with
// LLM_TAG rather than Tag.node, which is the case that used to be missed.
test('deleting an AI note through the card button takes its notes text', async () => {
    const uuid = await addAiNote(page, 'Ai Card');
    assert.ok((await paneText(page)).includes('Ai Card'), 'pane holds the section first');

    await deleteViaCard(page, uuid);
    assert.ok(!(await paneText(page)).includes('Ai Card'), 'its section left the pane');
});

test('deleting an AI note through the context menu takes its notes text', async () => {
    const uuid = await addAiNote(page, 'Ai Menu');
    assert.ok((await paneText(page)).includes('Ai Menu'), 'pane holds the section first');

    await deleteViaMenu(page, uuid);
    assert.ok(!(await paneText(page)).includes('Ai Menu'), 'its section left the pane');
});

// A section ends where the next one starts, and an AI section starts one just as a
// Tag.node section does. Deleting the note above one used to swallow it, because the
// scan for the end of the section only ever stopped at Tag.node.
test('deleting a note leaves the AI note below it alone', async () => {
    const doomed = await addNote(page, 'Above', 'body of above');
    const spared = await addAiNote(page, 'Below');

    await deleteViaMenu(page, doomed);

    const text = await paneText(page);
    assert.ok(!text.includes('Above'), 'the deleted note left the pane');
    assert.ok(text.includes('Below'), `the AI section below survived -- pane is now ${JSON.stringify(text)}`);
    assert.equal(await page.evaluate((id) => id in Graph.nodes, spared), true, 'and its node survived');
});
