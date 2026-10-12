import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// An Edge drawn as the threads between cards are in Obsidian's Canvas, React Flow and tldraw
// (#84): from the side of one card that faces the other to the other's facing side, on a curve
// that leaves and meets each square, slim, with its arrowhead on the card it points at. It was a
// ribbon from centre to centre that met each card wherever the line crossed its edge, with the
// arrowhead half way along it.

// The width it is drawn at on screen: 1.5 px at x1, going with the square root of the zoom from
// 1 px to 2, and 1.5 px more under the pointer.
const widthAt = (zoom, hovered = false) => Math.min(2, Math.max(1, 1.5 / Math.sqrt(zoom))) + (hovered ? 1.5 : 0);

// Left, which names Right, so the Edge's arrow points at Right.
async function link(page) {
    await addNote(page, 'Right', 'named');
    await addNote(page, 'Left', 'It names [[Right]].');
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, undefined, { timeout: 8000 });
}
// The two pinned where they stay, Right `dx` card widths and `dy` card heights from Left.
async function pin(page, dx, dy) {
    await page.evaluate(({ dx, dy }) => {
        const by = Object.fromEntries(Object.values(Graph.nodes).map((n) => [n.getTitle(), n]));
        const { hw, hh } = Graph.planeHalfExtent(by.Left);
        const at = (n, pos) => { n.pos = pos; n.anchor = pos; n.anchorForce = 1; n.vel = new vec2(0, 0); };
        at(by.Left, Graph.pan);
        at(by.Right, Graph.pan.plus(new vec2(2 * hw * dx, 2 * hh * dy)));
    }, { dx, dy });
    await page.waitForTimeout(400);
}
// The Edge as it is drawn, in screen px -- its path's commands and points, its width, its
// arrowhead's points and its paint -- and the two cards' boxes, all from one frame.
const drawn = (page) => page.evaluate(() => {
    const v = Object.values(Graph.edges)[0].view;
    const ctm = v.svgLink.getScreenCTM();
    const points = (d) => {
        const n = (d.match(/-?\d+(\.\d+)?(e[-+]?\d+)?/g) || []).map(Number), out = [];
        for (let i = 0; i + 1 < n.length; i += 2) {
            const p = new DOMPoint(n[i], n[i + 1]).matrixTransform(ctm);
            out.push({ x: p.x, y: p.y });
        }
        return out;
    };
    const box = (title) => {
        const r = Object.values(Graph.nodes).find((n) => n.getTitle() === title).content.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    };
    const d = v.svgLink.getAttribute('d');
    return {
        commands: d.match(/[A-Za-z]/g).join(''), curve: points(d), arrow: points(v.svgArrow.getAttribute('d')),
        width: Number(v.svgLink.getAttribute('stroke-width')) * Math.hypot(ctm.a, ctm.b),
        paint: getComputedStyle(v.svgLink).stroke, gradient: v.gradient.id, zoom: Graph.zoom.mag(),
        Left: box('Left'), Right: box('Right'),
    };
});
const near = (p, q, why, within = 1) =>
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= within, `${why}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is not (${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);

test('an Edge runs from the side of one card that faces the other to the facing side of the other, square to each', async () => {
    await link(page);

    // Side by side, Right a little lower: the right side of Left to the left side of Right.
    await pin(page, 3, 0.3);
    let e = await drawn(page);
    assert.equal(e.commands, 'MC', 'the Edge is not one curve');
    let [p0, c0, c1, p1] = e.curve;
    near(p0, { x: e.Left.r, y: e.Left.y }, "it does not leave the middle of Left's right side");
    near(p1, { x: e.Right.l, y: e.Right.y }, "it does not meet the middle of Right's left side");
    assert.ok(Math.abs(c0.y - p0.y) < 0.5 && c0.x > p0.x + 10, 'it does not leave Left square to its side');
    assert.ok(Math.abs(c1.y - p1.y) < 0.5 && c1.x < p1.x - 10, 'it does not meet Right square to its side');

    // One above the other, a little to the side: the bottom of Left to the top of Right.
    await pin(page, 0.3, 3);
    e = await drawn(page);
    [p0, c0, c1, p1] = e.curve;
    near(p0, { x: e.Left.x, y: e.Left.b }, "it does not leave the middle of Left's bottom");
    near(p1, { x: e.Right.x, y: e.Right.t }, "it does not meet the middle of Right's top");
    assert.ok(Math.abs(c0.x - p0.x) < 0.5 && c0.y > p0.y + 10, 'it does not leave Left square to its bottom');
    assert.ok(Math.abs(c1.x - p1.x) < 0.5 && c1.y < p1.y - 10, 'it does not meet Right square to its top');

    // The view turned: the cards stay upright on screen, and so do the sides the Edge meets,
    // though the Plane it is drawn in turns under them.
    await page.evaluate(() => { Graph.zoom = Graph.zoom.rot(0.5) });
    await page.waitForTimeout(400);
    e = await drawn(page);
    [p0, , , p1] = e.curve;
    const gap = (axis) => (axis === 'x' ? Math.abs(e.Right.x - e.Left.x) - (e.Left.r - e.Left.l + e.Right.r - e.Right.l) / 2
                                        : Math.abs(e.Right.y - e.Left.y) - (e.Left.b - e.Left.t + e.Right.b - e.Right.t) / 2);
    const facing = (box, other) => (gap('x') >= gap('y') ? { x: other.x > box.x ? box.r : box.l, y: box.y }
                                                         : { x: box.x, y: other.y > box.y ? box.b : box.t });
    near(p0, facing(e.Left, e.Right), 'turned, it does not leave the side of Left that faces Right');
    near(p1, facing(e.Right, e.Left), 'turned, it does not meet the side of Right that faces Left');
    assert.deepEqual(errors, []);
});

// Its arrowhead is Obsidian's, 5.2 widths long and 6.5 across, smaller on a card too small on
// screen for it: at most a quarter of the card's smaller half, and never under half its own size.
test('an Edge is as slim as the zoom says, its arrowhead on the card it points at', async () => {
    await link(page);
    await pin(page, 3, 0);
    for (const factor of [1, 2, 0.5, 8]) {
        await page.evaluate((f) => { Graph.zoom = Graph.zoom.scale(f) }, factor);
        await page.waitForTimeout(300);
        const e = await drawn(page);
        const w = widthAt(e.zoom);
        assert.ok(Math.abs(e.width - w) < 0.05, `the Edge is ${e.width.toFixed(2)} px wide after a zoom by ${factor}, not ${w.toFixed(2)}`);

        // Its tip on the middle of the side it points at, its base out from it along the Edge.
        const [l, tip, r] = e.arrow;
        const room = Math.min(e.Right.r - e.Right.l, e.Right.b - e.Right.t) / 2;
        const long = 5.2 * w * Math.min(1, Math.max(0.5, room / 4 / (5.2 * w)));
        near(tip, { x: e.Right.l, y: e.Right.y }, 'the arrowhead is not on the card it points at');
        near({ x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 }, { x: tip.x - long, y: tip.y },
            `the arrowhead is not ${long.toFixed(1)} px long along the Edge after a zoom by ${factor}`, 0.3);
        assert.ok(Math.abs(Math.hypot(l.x - r.x, l.y - r.y) - long * 6.5 / 5.2) < 0.3, 'the arrowhead is not 1.25 times as wide as it is long');
        await page.evaluate((f) => { Graph.zoom = Graph.zoom.scale(1 / f) }, factor);
    }
});

test('under the pointer an Edge is wider in the same colours, and a link being drawn is as wide', async () => {
    await link(page);
    await pin(page, 3, 0);
    const e = await drawn(page);
    assert.equal(e.paint, `url("#${e.gradient}")`, "the Edge is not painted with its notes' gradient");

    if (!isIPad) {
        // The middle of the curve, where the pointer finds it.
        const [p0, c0, c1, p1] = e.curve;
        await page.mouse.move((p0.x + 3 * c0.x + 3 * c1.x + p1.x) / 8, (p0.y + 3 * c0.y + 3 * c1.y + p1.y) / 8);
        await page.waitForTimeout(200);
        const hovered = await drawn(page);
        assert.ok(Math.abs(hovered.width - widthAt(e.zoom, true)) < 0.05, `under the pointer the Edge is ${hovered.width.toFixed(2)} px wide`);
        assert.equal(hovered.paint, e.paint, 'under the pointer the Edge lost its colours');
        await page.mouse.move(5, 500);
        await page.waitForTimeout(200);
        assert.ok(Math.abs((await drawn(page)).width - widthAt(e.zoom)) < 0.05, 'the Edge stayed wide after the pointer left');
    }

    // The band from an armed note to the pointer, while a link is being drawn.
    const band = await page.evaluate(async () => {
        Node.prev = Object.values(Graph.nodes).find((n) => n.getTitle() === 'Left');
        await new Promise((done) => setTimeout(done, 200));
        const path = document.getElementById('mousePath');
        const ctm = path.getScreenCTM();
        const width = Number(path.getAttribute('stroke-width')) * Math.hypot(ctm.a, ctm.b);
        Node.prev = null;
        return width;
    });
    assert.ok(Math.abs(band - widthAt(e.zoom, true)) < 0.05, `a link being drawn is ${band.toFixed(2)} px wide`);
    assert.deepEqual(errors, []);
});

// The style an Edge carries in a Saved Graph is the old ribbon's, a fill and a width in the Plane's
// units; restored, it is drawn as any other Edge is.
test('an Edge restored from a Saved Graph is drawn as a new one is', async () => {
    await link(page);
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && Object.keys(Graph.edges).length === 1, undefined, { timeout: 30000 });
    await pin(page, 3, 0);
    const e = await drawn(page);
    assert.equal(e.commands, 'MC', 'the restored Edge is not one curve');
    assert.equal(e.paint, `url("#${e.gradient}")`, "the restored Edge is not in its notes' colours");
    assert.ok(Math.abs(e.width - widthAt(e.zoom)) < 0.05, `the restored Edge is ${e.width.toFixed(2)} px wide`);
    near(e.curve[3], { x: e.Right.l, y: e.Right.y }, "the restored Edge does not meet Right's side");
    assert.deepEqual(errors, []);
});
