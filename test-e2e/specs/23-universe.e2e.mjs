import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The universe under the Fractal (universe.ts): stars, a galaxy seen almost edge on, a nebula, on
// one WebGL canvas. The Graph sat on flat black.

// Draw now and read the drawing buffer in the same task, before the browser presents and clears it.
const pixels = (page) => page.evaluate(() => {
    Universe.moved = true;
    Universe.draw(performance.now());
    const gl = Universe.built.gl, c = Universe.canvas;
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let lit = 0, hash = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 120) lit++;
    for (let i = 0; i < px.length; i += 997) hash = (hash * 31 + px[i]) >>> 0;
    return { lit, hash };
});
const panBy = (page, share) => page.evaluate(async (share) => {
    const p = Graph.pan;
    Graph.pan_set(new vec2(p.x + Graph.zoom.mag() * share, p.y));
    await new Promise((r) => setTimeout(r, 300));
    return Universe.panX;
}, share);

test('the universe is drawn under the Fractal, and a press still lands on the Fractal', async () => {
    assert.deepEqual(await page.evaluate(() => {
        const canvas = document.getElementById('universe');
        return {
            shown: !canvas.hidden,
            // `document.` rather than `Node.`: the app's own `class Node` is the global of that name.
            under: canvas.compareDocumentPosition(document.getElementById('svg_bg')) === document.DOCUMENT_POSITION_FOLLOWING,
            pressed: document.elementFromPoint(20, innerHeight / 2)?.id,
            fills: [canvas.getBoundingClientRect().width === innerWidth, canvas.getBoundingClientRect().height === innerHeight],
        };
    }), { shown: true, under: true, pressed: 'svg_bg', fills: [true, true] });
    const p = await pixels(page);
    assert.ok(p.lit > 300, `only ${p.lit} pixels are lit: no stars`);
    assert.deepEqual(errors, []);
});

test('a pan moves its stars, and under reduced motion nothing moves', async () => {
    const before = await page.evaluate(() => Universe.panX);
    assert.ok(Math.abs(await panBy(page, 0.3) - before) > 10, 'a pan left the sky where it was');
    const a = await pixels(page);
    await page.waitForTimeout(800);
    assert.notEqual((await pixels(page)).hash, a.hash, 'the sky does not move with time');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(200);
    const still = await pixels(page);
    const at = await page.evaluate(() => Universe.panX);
    await page.waitForTimeout(800);
    assert.equal((await pixels(page)).hash, still.hash, 'the sky moves with time under reduced motion');
    assert.equal(await panBy(page, 0.3), at, 'a pan moves the sky under reduced motion');
});

test('the Fractal panel switches it off, and the page keeps the choice', async () => {
    const toggle = (on) => page.evaluate((on) => {
        const t = document.getElementById('universe-checkbox');
        t.checked = on;
        t.dispatchEvent(new Event('change'));
    }, on);
    const state = () => page.evaluate(() => ({ hidden: document.getElementById('universe').hidden,
        checked: document.getElementById('universe-checkbox').checked }));
    await toggle(false);
    assert.deepEqual(await state(), { hidden: true, checked: false });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    assert.deepEqual(await state(), { hidden: true, checked: false }, 'off was forgotten in a reload');
    await toggle(true);
    assert.deepEqual(await state(), { hidden: false, checked: true });
});

test('a lost WebGL context shows the page colour, and a restored one the sky again', async () => {
    const lost = await page.evaluate(async () => {
        const ext = Universe.built.gl.getExtension('WEBGL_lose_context');
        ext.loseContext();
        await new Promise((r) => setTimeout(r, 200));
        const hidden = document.getElementById('universe').hidden;
        ext.restoreContext();
        await new Promise((r) => setTimeout(r, 500));
        return [hidden, document.getElementById('universe').hidden];
    });
    assert.deepEqual(lost, [true, false]);
    assert.ok((await pixels(page)).lit > 300, 'nothing is drawn after the context came back');
    assert.deepEqual(errors, []);
});

// A build that fails half way -- iOS caps canvas memory, and a refused 2D canvas made the nebula
// throw -- left half a universe whose first draw threw inside `nodeStep`, the app's one frame
// loop: Edges stopped being drawn and the fps read "??".
test('a universe that fails to build is put away, and the Graph goes on drawing', async () => {
    await context.close();
    ({ context, page, errors } = await openNeurite(browser, { setup: (ctx) => ctx.addInitScript(() => {
        const real = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
            return (kind === '2d' && this.width === 1024 && this.height === 1024) ? null : real.call(this, kind, ...rest);
        };
    }) }));
    const s = await page.evaluate(async () => {
        window.currentActiveZettelkastenMirror.setValue('## One\na [[Two]]\n\n## Two\nb\n');
        await new Promise((r) => setTimeout(r, 1500));
        const edge = [...new Set(Object.values(Graph.nodes).flatMap((n) => n.edges))][0];
        return { built: Boolean(Universe.built), hidden: document.getElementById('universe').hidden,
                 edgeDrawn: Boolean(edge?.view.svgLink.getAttribute('d')) };
    });
    assert.deepEqual(s, { built: false, hidden: true, edgeDrawn: true });
    assert.deepEqual(errors, []);
});

// A reader who had chosen a colour for the page with the BG picker kept a dark sky over it.
test('a page colour already chosen keeps it off, and picking one turns it off', async () => {
    await context.close();
    ({ context, page, errors } = await openNeurite(browser, { setup: (ctx) => ctx.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('inputValues', JSON.stringify({ colorPicker: '#203040' }));
    }) }));
    assert.deepEqual(await page.evaluate(() => ({ on: Universe.enabled, built: Boolean(Universe.built),
        bg: getComputedStyle(document.body).backgroundColor })), { on: false, built: false, bg: 'rgb(32, 48, 64)' },
        'a chosen page colour is hidden under the sky, or the sky was built for nothing');

    await page.evaluate(() => { localStorage.removeItem('universe'); localStorage.removeItem('inputValues'); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    assert.equal(await page.evaluate(() => Universe.enabled), true);
    // The panel's replay of the saved colour at boot is an `input` event, and no choice.
    await page.evaluate(() => document.getElementById('colorPicker').dispatchEvent(new Event('input')));
    assert.equal(await page.evaluate(() => Universe.enabled), true, 'a replayed colour turned it off');
    await page.evaluate(() => { const p = document.getElementById('colorPicker'); p.value = '#334455'; p.dispatchEvent(new Event('change')); });
    assert.deepEqual(await page.evaluate(() => [Universe.enabled, document.getElementById('universe').hidden, localStorage.getItem('universe')]),
        [false, true, 'off']);
});
