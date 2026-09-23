import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, addAiNote } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Where a new card lands, and whether it stays there. All three of these were
// broken in ways that hid each other: cards were drawn at half scale so nothing
// was legible enough to notice they overlapped, and they drifted along the fractal
// gradient, so one created off screen wandered into view and looked placed.

// UV is the renderer's own screen space -- 0..1 across the viewport on both axes,
// at any zoom -- so this asks the question the reader asks: can I see the note I
// just made?
const uvOf = (page, uuid) => page.evaluate((id) => {
    const uv = fromZtoUV(Graph.nodes[id].pos);
    return { u: uv.x, v: uv.y };
}, uuid);

test('a new note lands inside the viewport', async () => {
    const uuid = await addNote(page, 'Arrival', 'body');
    const { u, v } = await uvOf(page, uuid);
    assert.ok(u > 0 && u < 1, `horizontally in view, got u=${u.toFixed(3)}`);
    assert.ok(v > 0 && v < 1, `vertically in view, got v=${v.toFixed(3)}`);
});

// An Ai node's spawn point is a random draw over `(random - 0.5) * 1.8` per axis
// (zettelkasten.js:630), which is a wider range than the viewport, so this one
// arrived out of sight roughly a third of the time before the clamp.
test('a new AI note lands inside the viewport', async () => {
    const uuid = await addAiNote(page, 'Ai Arrival');
    const { u, v } = await uvOf(page, uuid);
    assert.ok(u > 0 && u < 1, `horizontally in view, got u=${u.toFixed(3)}`);
    assert.ok(v > 0 && v < 1, `vertically in view, got v=${v.toFixed(3)}`);
});

// Ten, not five. Five notes can be separated by moving only the newest one; ten cannot
// -- a card arriving into a cluster of three has no free direction and settles on top of
// one of them, which is how a real graph ended up with several cards more than half
// occluded. The relaxation moves whatever pair is worst, so this is the count that tells
// the difference.
test('notes created in a row do not land on top of each other', async () => {
    for (const t of ['One', 'Two', 'Three', 'Four', 'Five',
                     'Six', 'Seven', 'Eight', 'Nine', 'Ten']) {
        await addNote(page, t, `Body of ${t}.`);
    }
    // Placement settles twice: once on the frame the card appears, and again after
    // its body has arrived and changed its height (NodeView.settlePlacement). The
    // second pass is what makes the number below true, so the assertion has to be
    // after it rather than racing it.
    await page.waitForTimeout(700);
    // Two boxes miss each other if they are clear on either axis, so the test is
    // the same separating-axis check the placement uses -- not centre distance,
    // which would call a tall thin pair overlapping when it is not.
    const worst = await page.evaluate(() => {
        const ns = Object.values(Graph.nodes);
        let ratio = Infinity, pair = null;
        for (let i = 0; i < ns.length; i++) {
            for (let j = i + 1; j < ns.length; j++) {
                const a = Graph.planeHalfExtent(ns[i]), b = Graph.planeHalfExtent(ns[j]);
                if (!a || !b) continue;
                const dx = Math.abs(ns[i].pos.x - ns[j].pos.x);
                const dy = Math.abs(ns[i].pos.y - ns[j].pos.y);
                const r = Math.max(dx / (a.hw + b.hw), dy / (a.hh + b.hh));
                if (r < ratio) { ratio = r; pair = [ns[i].getTitle(), ns[j].getTitle()]; }
            }
        }
        return { ratio, pair, count: ns.length };
    });
    assert.equal(worst.count, 10, 'ten notes exist');
    assert.ok(worst.ratio >= 1,
        `no pair overlaps; tightest was ${worst.pair?.join(' / ')} at ${worst.ratio.toFixed(3)}`);
});

test('a new note stays where it was placed', async () => {
    const uuid = await addNote(page, 'Pinned', 'body');
    const before = await page.evaluate((id) => ({ x: Graph.nodes[id].pos.x, y: Graph.nodes[id].pos.y }), uuid);
    await page.waitForTimeout(2500);
    const after = await page.evaluate((id) => ({ x: Graph.nodes[id].pos.x, y: Graph.nodes[id].pos.y }), uuid);

    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    // Exactly zero is the expectation, not an approximation: the card is anchored,
    // so no force integrates into its position at all. A tolerance is here only so
    // a future sub-ulp change does not read as a regression.
    assert.ok(moved < 1e-9, `drifted ${moved.toExponential(2)} plane units in 2.5s`);
});

// The legibility assertion, written against what reaches the screen rather than
// against the stylesheet: a card is drawn through `transform: scale()`, so a 15px
// declaration rendered at 7.5px while the multiplier was 0.5 and the CSS looked
// blameless.
test('a note title is legible at the default zoom', async () => {
    const uuid = await addNote(page, 'Legible', 'body');
    const px = await page.evaluate((id) => {
        const n = Graph.nodes[id];
        const declared = parseFloat(getComputedStyle(n.view.titleInput).fontSize);
        // The scale actually applied to the card, read off the element.
        const m = new DOMMatrixReadOnly(getComputedStyle(n.content).transform);
        return { declared, scale: m.a, onScreen: declared * m.a };
    }, uuid);
    assert.ok(px.onScreen >= 13,
        `title renders at ${px.onScreen.toFixed(1)}px (${px.declared}px x scale ${px.scale.toFixed(3)})`);
});

// Notes typed into the notes pane, which is the flow the whole app is built around and
// the one none of these tests had exercised. `window.createNote` sets
// `zetPlacementOverride` (neuralapi.js:607) and takes the spread path, so every legibility
// assertion above was measuring the branch that was already fine. Typing goes through the
// ZetPath walk, where the first note was seeded at scale 0.05 and each one after it
// multiplied by 0.8 -- twenty notes ended at 0.016, with body text a quarter of a pixel.
test('notes typed into the pane are legible, however many there are', async () => {
    await page.evaluate(async () => {
        const cm = window.currentActiveZettelkastenMirror;
        const lines = [];
        for (let i = 1; i <= 20; i++) lines.push(`${Tag.node} Typed ${i}`, `Body of typed note ${i}.`, '');
        cm.setValue(lines.join('\n'));
        cm.refresh();
    });
    await page.waitForFunction(() => Object.keys(Graph.nodes).length >= 20, undefined, { timeout: 20000 });
    await page.waitForTimeout(1500);

    const sizes = await page.evaluate(() => {
        const out = [];
        for (const n of Object.values(Graph.nodes)) {
            if (n.removed) continue;
            const declared = parseFloat(getComputedStyle(n.view.titleInput).fontSize);
            const m = new DOMMatrixReadOnly(getComputedStyle(n.content).transform);
            out.push({ t: n.getTitle(), scale: n.scale, titlePx: declared * m.a });
        }
        return out;
    });

    assert.ok(sizes.length >= 20, `twenty notes exist, got ${sizes.length}`);
    const smallest = sizes.reduce((a, b) => (a.titlePx < b.titlePx ? a : b));
    // 8px is not comfortable, but it is a size a reader can see and one zoom step from
    // reading. A quarter of a pixel is not.
    assert.ok(smallest.titlePx >= 8,
        `the smallest title renders at ${smallest.titlePx.toFixed(2)}px ("${smallest.t}", scale ${smallest.scale})`);

    // And the range is bounded, so a graph does not become a size gradient.
    const largest = sizes.reduce((a, b) => (a.titlePx > b.titlePx ? a : b));
    assert.ok(largest.titlePx / smallest.titlePx <= 4,
        `largest/smallest is ${(largest.titlePx / smallest.titlePx).toFixed(2)} (${largest.titlePx.toFixed(1)} vs ${smallest.titlePx.toFixed(1)})`);
});

// The canvas responds to a double-click everywhere, including where the fractal drew a
// line. The gesture tested `e.target.id === 'svg_bg'` exactly, and the hairs are children
// of that svg, so 5.9% of the canvas silently did nothing.
test('double-click makes a note even where the fractal drew a line', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#bg path').length > 20,
        undefined, { timeout: 15000 });

    const onAPath = await page.evaluate(() => {
        for (const p of document.querySelectorAll('#bg path')) {
            const b = p.getBoundingClientRect();
            if (b.width < 4 || b.height < 4) continue;
            const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
            if (document.elementFromPoint(x, y)?.tagName === 'path') return { x, y };
        }
        return null;
    });
    if (!onAPath) return;  // no hair sat under a probe point this run

    const before = await page.evaluate(() => Object.keys(Graph.nodes).length);
    await page.mouse.dblclick(onAPath.x, onAPath.y);
    await page.waitForFunction((n) => Object.keys(Graph.nodes).length === n + 1, before,
        { timeout: 8000 });
});
