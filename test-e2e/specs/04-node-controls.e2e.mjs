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
