import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
afterEach(async () => { await context?.close(); });

// Selecting Nodes, and what a selection lets a reader do to them.

// The page as a given platform reports itself, which is what the selection key is read from.
const asPlatform = (platform) => ({
    setup: (ctx) => ctx.addInitScript((p) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => p }), platform),
});

async function threeNotes(page) {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\na\n\n## Beta\nb\n\n## Gamma\ng\n'));
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 3, undefined, { timeout: 5000 });
    await page.waitForTimeout(800);
    return page.evaluate(() => ['Alpha', 'Beta', 'Gamma']
        .map((t) => Object.keys(Graph.nodes).find((k) => Graph.nodes[k].getTitle() === t)));
}
const selected = (page) => page.evaluate(() => [...App.selectedNodes.uuids].map((u) => Graph.nodes[u].getTitle()).sort());
const clearSelection = (page) => page.evaluate(() => App.selectedNodes.clear());

// The top padding of a card's header, which is the card and nothing on it.
async function clickCard(page, uuid, key) {
    const p = await page.evaluate((id) => {
        const r = Graph.nodes[id].view.div.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + 3 };
    }, uuid);
    await page.keyboard.down(key);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up(key);
}
// A box drawn from bare canvas round every card.
async function boxAll(page, key) {
    const b = await page.evaluate(() => {
        const rs = Object.values(Graph.nodes).map((n) => n.view.div.getBoundingClientRect());
        return { x0: Math.min(...rs.map((r) => r.left)) - 30, y0: Math.min(...rs.map((r) => r.top)) - 30,
            x1: Math.max(...rs.map((r) => r.right)) + 30, y1: Math.max(...rs.map((r) => r.bottom)) + 30 };
    });
    await page.keyboard.down(key);
    await page.mouse.move(b.x0, b.y0);
    await page.mouse.down();
    await page.mouse.move(b.x1, b.y1, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up(key);
}

// The key this page selects with.
const modKey = (page) => page.evaluate(() => (Mod.isCommand ? 'Meta' : 'Control'));

// A point on bare canvas, found rather than assumed.
async function bareCanvas(page) {
    const p = await page.evaluate(() => {
        for (let y = 140; y < innerHeight - 140; y += 40) {
            for (let x = 140; x < innerWidth - 140; x += 40) {
                if (document.elementFromPoint(x, y)?.id === 'svg_bg') return { x, y };
            }
        }
        return null;
    });
    assert.ok(p, 'no bare canvas to press on');
    return p;
}

test('a click on bare canvas and Escape each clear the selection, and a pan does not', async () => {
    // The Help panel said a click on empty space cleared it; nothing did, and nor did
    // Escape, while the arrows, f and d, and the menu's Delete act on all of it.
    ({ context, page } = await openNeurite(browser));
    const [a, b] = await threeNotes(page);
    const key = await modKey(page);
    const selectTwo = async () => { await clickCard(page, a, key); await clickCard(page, b, key); };

    await selectTwo();
    assert.deepEqual(await selected(page), ['Alpha', 'Beta']);
    const p = await bareCanvas(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 120, p.y + 40, { steps: 6 });
    await page.mouse.up();
    assert.deepEqual(await selected(page), ['Alpha', 'Beta'], 'a pan cleared the selection');

    const q = await bareCanvas(page);
    await page.mouse.click(q.x, q.y);
    assert.deepEqual(await selected(page), [], 'a click on bare canvas left the selection');

    await selectTwo();
    await page.keyboard.press('Escape');
    assert.deepEqual(await selected(page), [], 'Escape left the selection');
});

test('the panel at the bottom left counts the selection', async () => {
    ({ context, page } = await openNeurite(browser));
    const [a, b] = await threeNotes(page);
    const key = await modKey(page);
    const count = () => page.evaluate(() => document.querySelector('.hud-count').textContent);
    await page.waitForFunction(() => document.querySelector('.hud-count').textContent === '3 notes');
    await clickCard(page, a, key);
    await clickCard(page, b, key);
    await page.waitForFunction(() => document.querySelector('.hud-count').textContent !== '3 notes');
    assert.equal(await count(), '2 of 3 selected');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.hud-count').textContent === '3 notes');
});

test("Delete in a selected Node's menu asks first, and says how many", async () => {
    // It deleted every Node in the selection at one click, unasked, with no undo.
    ({ context, page } = await openNeurite(browser));
    const [a, b] = await threeNotes(page);
    const key = await modKey(page);
    await clickCard(page, a, key);
    await clickCard(page, b, key);

    // Not awaited in the page: the action waits on the question this test answers.
    const askDelete = async () => {
        await page.evaluate((id) => { App.menuContext.runAction('delete', NodeActions.forNode(Graph.nodes[id])); }, a);
        await page.waitForFunction(() => Modal.current?.id === 'confirmModal');
        return page.evaluate(() => document.querySelector('.modal-content .confirm-message').textContent);
    };
    assert.equal(await askDelete(), 'Delete the 2 selected nodes?');
    await page.click('.modal-content .modal-cancel');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => Object.keys(Graph.nodes).length), 3, 'No deleted something');

    await askDelete();
    await page.click('.modal-content .modal-ok');
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 1, undefined, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => Object.values(Graph.nodes).map((n) => n.getTitle())), ['Gamma']);
});

for (const [platform, key, other, label] of [['MacIntel', 'Meta', 'Control', 'Cmd'], ['Win32', 'Control', 'Meta', 'Ctrl']]) {
    test(`on ${platform}, ${label} + click and ${label} + drag select, and the Help says ${label}`, async () => {
        // On a Mac, Control and a click is the secondary click: Blink and WebKit fire
        // `contextmenu` for it, and the browser's own menu opens over the Graph.
        ({ context, page } = await openNeurite(browser, asPlatform(platform)));
        const [a] = await threeNotes(page);

        await clickCard(page, a, key);
        assert.deepEqual(await selected(page), ['Alpha'], `${label} + click did not select`);
        await clearSelection(page);
        await clickCard(page, a, other);
        assert.deepEqual(await selected(page), [], `the other key selected on ${platform}`);

        await clearSelection(page);
        await boxAll(page, key);
        assert.deepEqual(await selected(page), ['Alpha', 'Beta', 'Gamma'], `${label} + drag drew no box`);

        const help = await page.evaluate(() => [...document.querySelectorAll('#howto kbd.mod-key')].map((k) => k.textContent));
        assert.ok(help.length >= 3, 'the Help panel marks no keys as the selection key');
        assert.deepEqual([...new Set(help)], [label]);
    });
}
