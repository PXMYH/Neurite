import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The connect effect (#87), after a node editor's: while a link is armed, a white wire from the
// armed card's side to the pointer; over another note, a ring where the Edge will meet it and an
// arc that jumps there, in the colour of the note the link starts from; and on the click that
// makes it, a burst on that note -- the Edge flashing in, a ring rippling out, a comet round the
// card. In screen px, in `#linkFx`, above the cards.

// Alpha on the left and Beta on the right, pinned, with a gap of two card widths between them.
async function two(page) {
    await addNote(page, 'Alpha', 'alpha');
    await addNote(page, 'Beta', 'beta');
    await page.evaluate(() => {
        const by = Object.fromEntries(Object.values(Graph.nodes).map((n) => [n.getTitle(), n]));
        const { hw } = Graph.planeHalfExtent(by.Alpha);
        const at = (n, pos) => { n.pos = pos; n.anchor = pos; n.anchorForce = 1; n.vel = new vec2(0, 0); };
        at(by.Alpha, Graph.pan.plus(new vec2(-3 * hw, 0)));
        at(by.Beta, Graph.pan.plus(new vec2(3 * hw, 0)));
    });
    await page.waitForTimeout(600);
}
const card = (page, title) => page.evaluate((title) => {
    const r = Object.values(Graph.nodes).find((n) => n.getTitle() === title).content.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}, title);
// The layer as drawn: each part's points, display, stroke and width.
const fx = (page) => page.evaluate(() => {
    const svg = document.getElementById('linkFx');
    const points = (d) => {
        const n = (d?.match(/-?\d+(\.\d+)?(e[-+]?\d+)?/g) || []).map(Number), out = [];
        for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
        return out;
    };
    const part = (cls) => {
        const el = svg.querySelector('.' + cls);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { shown: cs.display !== 'none', d: el.getAttribute('d'), points: points(el.getAttribute('d')),
                 commands: (el.getAttribute('d') || '').match(/[A-Za-z]/g)?.join('') ?? '', stroke: cs.stroke,
                 width: Number(el.getAttribute('stroke-width') || 0), r: Number(el.getAttribute('r') || 0),
                 c: { x: Number(el.getAttribute('cx') || 0), y: Number(el.getAttribute('cy') || 0) },
                 dash: el.getAttribute('stroke-dasharray') };
    };
    return { shown: getComputedStyle(svg).display !== 'none', wire: part('link-fx-wire'), arc: part('link-fx-arc'),
             ring: part('link-fx-ring'), bursts: svg.querySelectorAll('.link-fx-burst').length,
             ripple: part('link-fx-ripple'), comet: part('link-fx-comet'), flash: part('link-fx-flash'),
             width: EdgeView.widthPx(true), colour: Node.colourOf(Object.values(Graph.nodes).find((n) => n.getTitle() === 'Alpha')) };
});
const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((h) => parseInt(h, 16)).join(', ')})`;
const near = (p, q, why, within = 1.5) =>
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= within, `${why}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is not (${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
const press = (page, at) => (isIPad ? page.touchscreen.tap(at.x, at.y) : page.mouse.click(at.x, at.y));

test("while a link is armed, a white wire runs from the armed card's side to the pointer", { skip: isIPad && 'a finger does not hover' }, async () => {
    await two(page);
    const a = await card(page, 'Alpha'), b = await card(page, 'Beta');
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.t + 6);
    const there = { x: (a.r + b.l) / 2, y: a.y + 40 };
    await page.mouse.move(there.x, there.y, { steps: 5 });
    await page.waitForTimeout(200);
    const seen = await fx(page);
    await page.keyboard.up('Shift');
    assert.ok(seen.shown && seen.wire.shown, 'no wire is drawn');
    assert.equal(seen.wire.commands, 'MC', 'the wire is not one curve');
    near(seen.wire.points[0], { x: a.r, y: a.y }, "the wire does not leave the middle of Alpha's side");
    near(seen.wire.points[3], there, 'the wire does not reach the pointer', 1);
    assert.equal(seen.wire.stroke, 'rgb(243, 244, 248)', 'the wire is not white');
    assert.ok(Math.abs(seen.wire.width - seen.width) < 1e-9, 'the wire is not as wide as an Edge under the pointer');
    assert.equal(seen.arc.shown, false, 'an arc is drawn with no note under the pointer');
    assert.deepEqual(errors, []);
});

test("over a note, a ring marks where the Edge will meet it, and an arc in the first note's colour jumps there", { skip: isIPad && 'a finger does not hover' }, async () => {
    await two(page);
    const a = await card(page, 'Alpha'), b = await card(page, 'Beta');
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.t + 6);
    const over = { x: b.x, y: b.y + 10 };
    await page.mouse.move(over.x, over.y, { steps: 8 });
    await page.waitForTimeout(150);
    const one = await fx(page);
    await page.waitForTimeout(100);
    const two_ = await fx(page);
    await page.keyboard.up('Shift');
    assert.ok(one.ring.shown && one.arc.shown, 'no ring or arc over Beta');
    near(one.ring.c, { x: b.l, y: b.y }, "the ring is not on the middle of Beta's side");
    assert.equal(one.ring.stroke, rgb(one.colour), "the ring is not in Alpha's colour");
    assert.equal(one.arc.stroke, rgb(one.colour), "the arc is not in Alpha's colour");
    near(one.arc.points[0], over, 'the arc does not start at the pointer', 1);
    near(one.arc.points.at(-1), one.ring.c, 'the arc does not end on the ring', 1);
    assert.ok(one.arc.points.length > 3, 'the arc is a straight line');
    assert.notEqual(one.arc.d, two_.arc.d, 'the arc does not flicker');
    assert.deepEqual(errors, []);
});

test('the click that makes the link plays a burst on the note it reaches, which then ends', { skip: isIPad && 'Shift + click' }, async () => {
    await two(page);
    const a = await card(page, 'Alpha'), b = await card(page, 'Beta');
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.t + 6);
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(60);
    const early = await fx(page);
    await page.waitForTimeout(150);
    const later = await fx(page);
    assert.equal(early.bursts, 1, 'no burst was played');
    assert.equal(early.wire.shown, false, 'the wire stayed after the link was made');
    assert.ok(later.ripple.r > early.ripple.r, `the ring does not ripple out (${early.ripple.r} then ${later.ripple.r})`);
    near(early.ripple.c, { x: b.l, y: b.y }, "the ripple is not where the Edge meets Beta");
    assert.ok(early.comet.shown && early.comet.dash, 'no comet runs round the card');
    assert.equal(early.flash.commands, 'MC', 'the Edge does not flash in');
    near(early.flash.points[0], { x: a.r, y: a.y }, "the flash does not leave Alpha's side");
    near(early.flash.points[3], { x: b.l, y: b.y }, "the flash does not reach Beta's side");
    assert.equal(early.flash.stroke, rgb(early.colour), "the flash is not in Alpha's colour");
    await page.waitForTimeout(1100);
    const done = await fx(page);
    assert.deepEqual([done.bursts, done.shown], [0, false], 'the burst did not end');
    assert.equal(await page.evaluate(() => Object.keys(Graph.edges).length), 1, 'no Edge was made');
    assert.deepEqual(errors, []);
});

test('under reduced motion the arc is straight, and nothing ripples or runs round the card', { skip: isIPad && 'a finger does not hover' }, async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await two(page);
    const a = await card(page, 'Alpha'), b = await card(page, 'Beta');
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.t + 6);
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.waitForTimeout(150);
    const over = await fx(page);
    assert.equal(over.arc.commands, 'ML', 'the arc is not straight under reduced motion');
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(80);
    const one = await fx(page);
    await page.waitForTimeout(150);
    const two_ = await fx(page);
    assert.equal(one.comet.shown, false, 'a comet runs under reduced motion');
    assert.equal(one.ripple.r, two_.ripple.r, 'the ring ripples out under reduced motion');
    assert.deepEqual(errors, []);
});

test('Escape gives the armed link up, and the layer is cleared', { skip: isIPad && 'a finger does not hover' }, async () => {
    await two(page);
    const a = await card(page, 'Alpha'), b = await card(page, 'Beta');
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.t + 6);
    await page.keyboard.up('Shift');
    await page.mouse.move((a.r + b.l) / 2, a.y + 40, { steps: 5 });
    await page.waitForTimeout(150);
    assert.equal((await fx(page)).wire.shown, true, 'no wire before the Escape; this test proves nothing');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.equal((await fx(page)).shown, false, 'the wire stayed after Escape');
    assert.deepEqual(errors, []);
});

test('with the Connect tool, a click or a tap on each note links them and plays the burst', async () => {
    await two(page);
    const a = await card(page, 'Alpha'), b = await card(page, 'Beta');
    await press(page, await page.evaluate(() => { const r = document.getElementById('connectTool').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    await page.waitForTimeout(200);
    await press(page, { x: a.x, y: a.t + 6 });
    await page.waitForTimeout(200);
    await press(page, { x: b.x, y: b.t + 6 });
    await page.waitForTimeout(60);
    assert.equal((await fx(page)).bursts, 1, 'no burst was played');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => Object.keys(Graph.edges).length), 1, 'no Edge was made');
    assert.deepEqual(errors, []);
});
