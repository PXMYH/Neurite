import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Nodes in their own colours over the universe, and Edges as threads in those colours. Every card
// was one brown with one #d49454 edge, and every Edge the same #8fb4e8 ribbon, 5 CSS px at x0.4.

const cards = (page) => page.evaluate(() => Object.values(Graph.nodes).map((n) => ({
    title: n.getTitle(), colour: Node.colourOf(n),
    written: n.view.div.style.getPropertyValue('--node-colour'),
    edge: getComputedStyle(n.view.div).borderTopColor,
})).sort((a, b) => a.title.localeCompare(b.title)));
const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((h) => parseInt(h, 16)).join(', ')})`;

test('each Node has a vivid colour of its own on its card, and keeps it through a reload', async () => {
    for (const t of ['Alpha', 'Beta', 'Gamma']) await addNote(page, t, t.toLowerCase());
    const first = await cards(page);
    assert.equal(new Set(first.map((c) => c.colour)).size, 3, 'two of three Nodes made one after another share a colour');
    for (const c of first) {
        assert.equal(c.written, c.colour, `${c.title}'s card does not carry its colour`);
        assert.equal(c.edge, rgb(c.colour), `${c.title}'s card edge is not its colour`);
    }
    // Restored from the Saved Graph, the colours are worked out again, and come out the same.
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && Object.keys(Graph.nodes).length === 3, undefined, { timeout: 30000 });
    assert.deepEqual(await cards(page), first);
    assert.deepEqual(errors, []);
});

test("an Edge is a thread in its two Nodes' colours, its arrowhead in the colour it points at", async () => {
    await addNote(page, 'Right', 'named');
    await addNote(page, 'Left', 'It names [[Right]].');
    await page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.edges.length > 0), undefined, { timeout: 5000 });
    await page.waitForTimeout(400);
    const e = await page.evaluate(() => {
        const edge = [...new Set(Object.values(Graph.nodes).flatMap((n) => n.edges))][0];
        const v = edge.view, pts = edge.pts;
        // The ribbon's width on screen at its wider end, from the geometry it was drawn with.
        const px = Math.min(innerWidth, innerHeight) / 2 / Graph.zoom.mag();
        const wscale = Math.min(v.style['stroke-width'] / (0.5 + Math.max(edge.stress(), 0.01)) * 1.6, v.maxWidth);
        const widest = Math.max(...pts.map((p) => p.scale));
        return {
            stops: [...v.gradient.children].map((s) => s.getAttribute('stop-color')),
            ends: pts.map((p) => Node.colourOf(p)),
            painted: v.svgLink.getAttribute('fill') === `url(#${v.gradient.id})`,
            tip: [getComputedStyle(v.svgArrow).fill, edge.directionality.start?.getTitle(), Node.colourOf(edge.directionality.start)],
            width: 2 * widest * Math.max(EdgeView.hairPx / (2 * widest * px), Math.min(wscale * EdgeView.slim, EdgeView.threadPx / (2 * widest * px))) * px,
            painted2: v.svgLink.getAttribute('stroke'),
        };
    });
    assert.deepEqual(e.stops, e.ends, "the Edge's gradient is not its two Nodes' colours");
    assert.equal(e.painted, true, 'the ribbon is not painted with its gradient');
    assert.equal(e.tip[1], 'Right', 'the arrow does not point at the Node the Ref names');
    assert.equal(e.tip[0], rgb(e.tip[2]), 'the arrowhead is not the colour of the Node it points at');
    assert.ok(e.width >= 1 - 1e-9 && e.width <= 2.5 + 1e-9, `the ribbon is ${e.width} px wide`);
    // Filled only: WebKit paints a non-scaling stroke's gradient in its last colour.
    assert.equal(e.painted2, 'none');
});
