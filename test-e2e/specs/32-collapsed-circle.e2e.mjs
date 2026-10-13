import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// A note collapsed to its circle, resized by the wheel. Shift + scroll resizes a card, and did a
// collapsed one, until ed5b1a0 moved the card off the legacy `wheelDelta` and onto `deltaY`: macOS
// sends Shift and a mouse wheel as a scroll across, with `deltaY` 0, so on a Mac it did nothing.
// Alt (Option) + scroll resizes it too now. The circle's title is under the same transform, so it
// grows and shrinks with it.

// Notes made, pinned side by side across the middle of the view, and collapsed.
async function notes(page, titles, collapse = true) {
    for (const t of titles) await addNote(page, t, t.toLowerCase());
    await page.evaluate(({ titles, collapse }) => {
        titles.forEach((t, i) => {
            const n = Object.values(Graph.nodes).find((n) => n.getTitle() === t);
            n.pos = Graph.pan.plus(new vec2((i - (titles.length - 1) / 2) * 0.6, 0));
            n.anchor = n.pos; n.anchorForce = 1;
            if (collapse) n.view.toggleCollapse();
        });
    }, { titles, collapse });
    await page.waitForTimeout(600);
}
// The first note's circle and title on screen, and its scale.
const circle = (page) => page.evaluate(() => {
    const n = Object.values(Graph.nodes)[0], v = n.view;
    const c = v.div.querySelector('.collapsed-circle').getBoundingClientRect();
    const t = v.div.querySelector('.collapsed-title').getBoundingClientRect();
    return { scale: n.scale, circle: c.width, title: [t.width, t.height], at: { x: c.x + c.width / 2, y: c.y + c.height / 2 },
             zoom: Graph.zoom.mag(), angle: Graph.zoom.ang() };
});
// One turn of the wheel at `at`, with `key` held.
async function wheel(page, at, key, dx, dy) {
    await page.mouse.move(at.x, at.y);
    if (key) await page.keyboard.down(key);
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(150);
    if (key) await page.keyboard.up(key);
    await page.waitForTimeout(250);
}
// What one turn of `delta` scales by: the expression the card's wheel uses.
const factor = (page, delta) => page.evaluate((d) => Math.exp(-d * settings.zoomSpeed * settings.zoomSpeedMultiplier), delta);
const near = (a, b, within, why) => assert.ok(Math.abs(a - b) <= within, `${why}: ${a} is not ${b}`);

test("Shift or Alt + scroll over a collapsed note's circle resizes it, and its title with it", { skip: isIPad && 'mobile WebKit takes no wheel' }, async () => {
    await notes(page, ['Alpha']);
    // Up grows it and down shrinks it, as everywhere; Shift's turn across is a Mac's mouse wheel.
    for (const [key, dx, dy, why] of [['Shift', 0, -200, 'Shift + a scroll up'], ['Shift', -200, 0, 'Shift + a scroll across, a Mac mouse wheel under Shift'],
            ['Alt', 0, -200, 'Alt + a scroll up'], ['Alt', 0, 200, 'Alt + a scroll down']]) {
        await page.evaluate(() => { Object.values(Graph.nodes)[0].scale = 1 });
        await page.waitForTimeout(300);
        const was = await circle(page);
        await wheel(page, was.at, key, dx, dy);
        const now = await circle(page);
        const f = await factor(page, dy || dx);
        near(now.scale, f, 1e-9, `${why} did not scale the note by one turn`);
        near(now.circle / was.circle, f, 0.03, `${why}: the circle did not follow its scale`);
        near(now.title[0] / was.title[0], f, 0.03, `${why}: the title's width did not follow the circle`);
        near(now.title[1] / was.title[1], f, 0.03, `${why}: the title's height did not follow the circle`);
        near(now.zoom, was.zoom, 1e-12, `${why} zoomed the canvas as well`);
    }
    assert.deepEqual(errors, []);
});

test('a plain scroll and a pinch over the circle zoom the canvas, and Alt + scroll on the Plane still turns it', { skip: isIPad && 'mobile WebKit takes no wheel' }, async () => {
    await notes(page, ['Alpha']);
    // A trackpad's pinch arrives as Control and the wheel.
    for (const key of [null, 'Control']) {
        await page.evaluate(() => { Graph.zoom = Graph.zoom.unscale(Graph.zoom.mag()) });
        await page.waitForTimeout(300);
        const was = await circle(page);
        await wheel(page, was.at, key, 0, -200);
        const now = await circle(page);
        assert.equal(now.scale, 1, `${key ?? 'a plain'} scroll over the circle resized it`);
        assert.ok(now.zoom < was.zoom * 0.95, `${key ?? 'a plain'} scroll over the circle did not zoom the canvas in`);
    }
    // Away from the note, Alt + scroll is the view's turn.
    const was = await circle(page);
    await wheel(page, { x: 80, y: 500 }, 'Alt', 0, -200);
    const now = await circle(page);
    assert.notEqual(now.angle, was.angle, 'Alt + scroll on the Plane no longer turns the view');
    assert.equal(now.scale, 1);
    assert.deepEqual(errors, []);
});

test('Shift + a scroll across, as a Mac mouse wheel sends it, lengthens an Edge', { skip: isIPad && 'mobile WebKit takes no wheel' }, async () => {
    await addNote(page, 'Right', 'named');
    await addNote(page, 'Left', 'It names [[Right]].');
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, undefined, { timeout: 8000 });
    await page.evaluate(() => {
        const by = Object.fromEntries(Object.values(Graph.nodes).map((n) => [n.getTitle(), n]));
        by.Left.pos = Graph.pan.plus(new vec2(-0.6, 0)); by.Right.pos = Graph.pan.plus(new vec2(0.6, 0));
        for (const n of [by.Left, by.Right]) { n.anchor = n.pos; n.anchorForce = 1; }
    });
    await page.waitForTimeout(500);
    // The middle of the Edge's curve, where the pointer finds it.
    const mid = await page.evaluate(() => {
        const path = Object.values(Graph.edges)[0].view.svgLink;
        const p = path.getPointAtLength(path.getTotalLength() / 2), q = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
        return { x: q.x, y: q.y };
    });
    const was = await page.evaluate(() => Object.values(Graph.edges)[0].length);
    await wheel(page, mid, 'Shift', -200, 0);
    const now = await page.evaluate(() => Object.values(Graph.edges)[0].length);
    near(now / was, await factor(page, -200), 1e-9, 'Shift + a scroll across did not lengthen the Edge by one turn');
    assert.deepEqual(errors, []);
});
