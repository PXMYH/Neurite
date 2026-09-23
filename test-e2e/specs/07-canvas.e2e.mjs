import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The properties that make the canvas endless, asserted rather than assumed. None of
// these are guarded anywhere in the app -- there is no minimum zoom, no maximum zoom
// and no pan bound in any of the 42 places that write them -- so what actually
// limits the canvas is arithmetic, and that is what these measure.

test('zooming anchors the point under the cursor', async () => {
    // The single property that decides whether an infinite canvas feels controlled
    // or slippery: the thing you point at has to stay where it is.
    for (const [cx, cy] of [[800, 450], [300, 200], [1400, 800]]) {
        const before = await page.evaluate(([x, y]) => {
            Graph.pan = new vec2(0, 0); Graph.zoom = new vec2(1, 0);
            const z = Graph.xyToZ(x, y);
            const p = fromZ(z);
            return { z: [z.x, z.y], sx: p.x, sy: p.y };
        }, [cx, cy]);

        await page.mouse.move(cx, cy);
        for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
        await page.waitForTimeout(120);

        const after = await page.evaluate((z) => {
            const p = fromZ(new vec2(z[0], z[1]));
            return { sx: p.x, sy: p.y, zoom: Graph.zoom.mag() };
        }, before.z);

        assert.ok(after.zoom < 1, `the wheel zoomed in, |zoom| = ${after.zoom}`);
        assert.ok(Math.abs(after.sx - before.sx) < 1,
            `x drift under the cursor at ${cx},${cy}: ${(after.sx - before.sx).toFixed(3)}px`);
        assert.ok(Math.abs(after.sy - before.sy) < 1,
            `y drift under the cursor at ${cx},${cy}: ${(after.sy - before.sy).toFixed(3)}px`);
    }
});

test('complex division reaches the limit of a double, not the square of one', async () => {
    // cdiv is how every screen-to-plane conversion divides by Graph.zoom, so its
    // floor is the hard floor on zoom depth: past it fromZtoUV returns NaN, every
    // card hides and every edge stops drawing. Computing mag2 first squares the
    // exponent away and gave up at 1.57e-162 while the components were still fine.
    const floor = await page.evaluate(() => {
        const alive = (mag) => {
            const r = new vec2(mag, 0).crecip();
            const q = new vec2(1, 0).cdiv(new vec2(mag, 0));
            return Number.isFinite(r.x) && Number.isFinite(q.x) && q.x !== 0;
        };
        let lo = -324, hi = 0;
        for (let i = 0; i < 200; i++) {
            const mid = (lo + hi) / 2;
            if (alive(10 ** mid)) hi = mid; else lo = mid;
        }
        return hi;
    });
    assert.ok(floor < -300, `divides below 1e-300; floor is 1e${floor.toFixed(1)}`);
});

test('the screen-to-plane map still resolves at extreme depth', async () => {
    const results = await page.evaluate(() => {
        // Autopilot writes pan and zoom every frame while it is chasing something
        // (nodestep.js:40), and a frame can land between setting the zoom and reading the
        // result -- which is a flaky test rather than a real failure. Stopped first, so
        // this measures the arithmetic and nothing else.
        Autopilot.stop();
        const out = [];
        for (const mag of [1e-100, 1e-200, 1e-300]) {
            Graph.pan = new vec2(0, 0);
            Graph.zoom = new vec2(mag, 0);
            const uv = fromZtoUV(new vec2(mag * 0.5, 0));
            out.push({ mag, u: uv.x });
        }
        Graph.pan = new vec2(0, 0); Graph.zoom = new vec2(1, 0);
        return out;
    });
    for (const r of results) {
        // A point at half the view's half-width sits three quarters across it.
        assert.ok(Number.isFinite(r.u), `u is finite at |zoom| = ${r.mag}`);
        assert.ok(Math.abs(r.u - 0.75) < 1e-9, `u is 0.75 at |zoom| = ${r.mag}, got ${r.u}`);
    }
});

test('panning far does not lose the graph', async () => {
    const uuid = await addNote(page, 'Far', 'body');
    const held = await page.evaluate((id) => {
        const out = [];
        for (const d of [1, 1e3, 1e6, 1e9, 1e12]) {
            Graph.pan = new vec2(d, d);
            Graph.zoom = new vec2(1, 0);
            Graph.nodes[id].pos = new vec2(d + 0.1, d + 0.1);
            const uv = fromZtoUV(Graph.nodes[id].pos);
            out.push({ d, u: uv.x, finite: Number.isFinite(uv.x) });
        }
        Graph.pan = new vec2(0, 0); Graph.zoom = new vec2(1, 0);
        return out;
    }, uuid);

    for (const r of held) {
        assert.ok(r.finite, `still mapping at pan ${r.d}`);
        // 0.1 plane units past the pan centre is 0.55 across a view of half-width 1.
        assert.ok(Math.abs(r.u - 0.55) < 1e-3, `pan ${r.d}: u = ${r.u}, expected 0.55`);
    }
});

test('rotating does not change how far in the canvas is zoomed', async () => {
    // `zoom` is one complex number carrying both magnification and rotation, so a
    // rotor multiplied into it has to have magnitude exactly 1. cos^2 + sin^2 is 1
    // only to rounding, which made turning the canvas slowly drift the zoom level.
    const drift = await page.evaluate(() => {
        Graph.zoom = new vec2(1, 0);
        const before = Graph.zoom.mag();
        for (let i = 0; i < 2000; i++) Graph.zoom_cmultWith(Graph.applyRotationDelta(0.001));
        const after = Graph.zoom.mag();
        Graph.zoom = new vec2(1, 0);
        return Math.abs(after - before) / before;
    });
    assert.ok(drift < 1e-12, `2000 rotation steps drifted the zoom by ${drift.toExponential(2)}`);
});
