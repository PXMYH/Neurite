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

// Where a card is on screen, and whether its pin is where it is.
const place = (page, uuid) => page.evaluate((id) => {
    const n = Graph.nodes[id];
    const r = n.view.div.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, cx: r.x + r.width / 2, cy: r.y + r.height / 2,
        pinned: n.anchorForce === 1, pinHere: n.anchor.minus(n.pos).mag() < 1e-9 };
}, uuid);
const hold = async (page, key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(300);
};
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

test('a group drag, the arrows and f move a selection of pinned Nodes as one', async () => {
    // Every note arrives pinned, and each of these skipped pinned Nodes: a group drag moved
    // only the Node under the pointer, the arrows moved nothing, and f grew cards in place.
    ({ context, page } = await openNeurite(browser));
    const [a, b] = await threeNotes(page);
    assert.ok((await place(page, a)).pinned && (await place(page, b)).pinned, 'the notes did not arrive pinned');
    const key = await modKey(page);
    await clickCard(page, a, key);
    await clickCard(page, b, key);

    const a0 = await place(page, a), b0 = await place(page, b);
    await page.mouse.move(a0.cx, a0.y + 3);
    await page.mouse.down();
    await page.mouse.move(a0.cx + 150, a0.y + 3 - 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const a1 = await place(page, a), b1 = await place(page, b);
    assert.ok(near(b1.x - b0.x, a1.x - a0.x) && near(b1.y - b0.y, a1.y - a0.y),
        `the group drag left a pinned Node behind: ${JSON.stringify({ a0, a1, b0, b1 })}`);
    assert.ok(b1.pinHere, 'the pin stayed behind its Node');

    await hold(page, 'ArrowRight', 400);
    const a2 = await place(page, a), b2 = await place(page, b);
    assert.ok(a2.x - a1.x > 30, `the arrows moved nothing: ${a2.x - a1.x}px`);
    assert.ok(near(b2.x - b1.x, a2.x - a1.x) && near(b2.y, b1.y), 'the arrows moved the two apart');

    const gap = (p, q) => Math.hypot(q.cx - p.cx, q.cy - p.cy);
    await hold(page, 'f', 150);
    const a3 = await place(page, a), b3 = await place(page, b);
    const grew = a3.w / a2.w;
    assert.ok(grew > 1.1, 'f did not grow the selection');
    assert.ok(Math.abs(gap(a3, b3) / gap(a2, b2) - grew) < 0.05, 'the cards grew in place, into each other');
    assert.ok(a3.pinHere && b3.pinHere, 'a pin stayed behind when f moved its Node');
});

test('Shift + scroll over a selected card scales the whole selection about the pointer', async () => {
    ({ context, page } = await openNeurite(browser));
    const [a, b] = await threeNotes(page);
    const key = await modKey(page);
    await clickCard(page, a, key);
    await clickCard(page, b, key);
    const a0 = await place(page, a), b0 = await place(page, b);
    await page.mouse.move(a0.cx, a0.cy);
    await page.keyboard.down('Shift');
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);
    const a1 = await place(page, a), b1 = await place(page, b);
    const grew = a1.w / a0.w;
    assert.ok(grew > 1.1, 'Shift + scroll did not grow the selection');
    assert.ok(near(b1.w / b0.w, grew, 0.02), 'the rest of the selection did not grow with it');
    // About the pointer: the other card moves away from it, in proportion.
    const from = (p) => Math.hypot(p.cx - a0.cx, p.cy - a0.cy);
    assert.ok(Math.abs(from(b1) / from(b0) - grew) < 0.08, 'a pinned card grew in place');
    assert.ok(a1.pinHere && b1.pinHere, 'a pin stayed behind');
});

test('f, d and the arrows leave the selection alone while typing, or with Cmd or Ctrl', async () => {
    // Measured: "fd" typed into the notes pane grew the selected Node twice over.
    ({ context, page } = await openNeurite(browser));
    const [a] = await threeNotes(page);
    await clickCard(page, a, await modKey(page));
    await page.click('.menu-button');
    await page.click(".menu-row.tablink:has-text('Notes')");
    await page.click('#zetPaneContainer .CodeMirror-lines');
    const t0 = await place(page, a);
    await hold(page, 'f', 150);
    await hold(page, 'd', 150);
    await hold(page, 'ArrowRight', 300);
    const t1 = await place(page, a);
    assert.ok(near(t1.w, t0.w, 0.5) && near(t1.x, t0.x, 0.5), 'typing moved or scaled the selection');
    assert.match(await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue()), /fd/);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await clickCard(page, a, await modKey(page));
    const k0 = await place(page, a);
    for (const chord of ['Meta', 'Control']) {
        await page.keyboard.down(chord);
        await hold(page, 'f', 150);
        await page.keyboard.up(chord);
    }
    assert.ok(near((await place(page, a)).w, k0.w, 0.5), 'Cmd+F or Ctrl+F scaled the selection');
});

test('a selected Node wears a ring two screen pixels wide, zoomed out as far as x0.1', async () => {
    // The ring is drawn inside the card's own transform, so its 2px were 0.34 screen px at
    // x0.25 -- nothing to see where a selection of many Nodes is most often made.
    ({ context, page } = await openNeurite(browser));
    const [a] = await threeNotes(page);
    await clickCard(page, a, await modKey(page));
    for (const mag of [0.1, 0.25, 1]) {
        await page.evaluate(([id, mag]) => { Graph.pan_set(Graph.nodes[id].pos); Hud.setZoomMag(1 / mag); }, [a, mag]);
        await page.waitForTimeout(400);
        const ring = await page.evaluate((id) => {
            const div = Graph.nodes[id].view.div;
            const s = +/scale\(([\d.e+-]+)/.exec(div.parentElement.style.transform)[1];
            return { s, px: parseFloat(getComputedStyle(div, '::before').borderTopWidth) * s };
        }, a);
        assert.ok(ring.px >= 1.5 && ring.px <= 2.5, `at x${mag} the ring is ${ring.px.toFixed(2)} screen px`);
    }
});

test('the box a Mod + drag draws is the accent, and blurs nothing behind it', async () => {
    // Its 1px blur made the Nodes being chosen unreadable while they were being chosen.
    ({ context, page } = await openNeurite(browser));
    await threeNotes(page);
    const key = await modKey(page);
    const p = await bareCanvas(page);
    await page.keyboard.down(key);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 200, p.y + 120, { steps: 5 });
    const box = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('.drag-box'));
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim();
        return { blur: s.backdropFilter, border: s.borderTopColor, style: s.borderTopStyle, accent };
    });
    await page.mouse.up();
    await page.keyboard.up(key);
    assert.equal(box.blur, 'none');
    assert.equal(box.style, 'solid');
    assert.equal(box.border, 'rgb(115, 150, 212)', `the box is not the accent (${box.accent})`);
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
