import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, isIPad, openSettings } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// A Mac trackpad's pinch in Chromium -- the Mac app's engine. Chromium sends no gesture event for
// it: it sends wheel events with Control set, whose `deltaY` it picks so that
// Math.exp(-deltaY / 100) is the pinch's scale. On 1.9.8 the Plane read them as a scroll, at the
// wheel's speed: a 0.5x pinch zoomed out 0.933x, and over a note with text to scroll it zoomed
// 1.000x. `Input.synthesizePinchGesture` from a "mouse" is Chromium's own touchpad pinch, the
// path a real trackpad takes; how far it gets is Chromium's, so each test compares the zoom with
// the events that arrived, not with the scale it asked for.
const skip = isIPad && "WebKit's pinch is Safari's gesture events (20-touch)";

async function pinch(page, at, scaleFactor) {
    await page.evaluate(() => {
        // One listener for the page, however many pinches: a second one counted each event twice.
        if (!window.__pinch) window.addEventListener('wheel', (e) => {
            window.__pinch.sum += e.deltaY;
            window.__pinch.ctrl &&= e.ctrlKey;
        }, true);
        window.__pinch = { sum: 0, ctrl: true };
    });
    await page.mouse.move(at.x, at.y);
    const before = await page.evaluate(([x, y]) => {
        const z = Graph.xyToZ(x, y);
        return { mag: Graph.zoom.mag(), x: z.x, y: z.y };
    }, [at.x, at.y]);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture',
        { x: at.x, y: at.y, scaleFactor, relativeSpeed: 800, gestureSourceType: 'mouse' });
    await page.waitForTimeout(300);
    const after = await page.evaluate(([x, y]) => {
        const z = Graph.xyToZ(x, y);
        return { mag: Graph.zoom.mag(), x: z.x, y: z.y, pxPerUnit: Svg.scale / 2 / Graph.zoom.mag(),
                 ...window.__pinch };
    }, [at.x, at.y]);
    return {
        // Above 1 is closer, as `performZoom`'s argument is.
        magnification: before.mag / after.mag,
        pinched: Math.exp(-after.sum / 100),
        allControl: after.ctrl,
        driftPx: Math.hypot(after.x - before.x, after.y - before.y) * after.pxPerUnit,
    };
}

test('a pinch on the Plane zooms by its own scale, about the pointer', { skip }, async () => {
    const out = await pinch(page, { x: 1100, y: 330 }, 0.5);
    assert.ok(out.allControl, 'the pinch did not arrive as Control and the wheel');
    assert.ok(Math.abs(out.pinched - 0.5) < 0.05, `Chromium sent a pinch of ${out.pinched}, not about 0.5`);
    assert.ok(Math.abs(out.magnification / out.pinched - 1) < 1e-6,
        `a ${out.pinched}x pinch zoomed ${out.magnification}x`);
    assert.ok(out.driftPx < 0.5, `the point under the pointer moved ${out.driftPx} px`);

    const closer = await pinch(page, { x: 600, y: 600 }, 2);
    assert.ok(closer.pinched > 1.2, `Chromium sent a pinch of ${closer.pinched}, not a spread`);
    assert.ok(Math.abs(closer.magnification / closer.pinched - 1) < 1e-6,
        `a ${closer.pinched}x pinch zoomed ${closer.magnification}x`);
    assert.deepEqual(errors, []);
});

// A note with text to scroll keeps the wheel until it is read to the end (09-gestures). A pinch
// is not the wheel: handed to the note's scroller it scrolled nothing, since the page cancels every
// Control + wheel against the browser's own zoom (dropdown.js).
test('a pinch over a note with text to scroll zooms the Plane, and leaves the text', { skip }, async () => {
    const body = Array.from({ length: 60 }, (_, i) => `Sentence ${i} of a long note.`).join(' ');
    const uuid = await addNote(page, 'Long', body);
    await page.waitForFunction((id) => {
        const ed = Graph.nodes[id]?.view?.div?.querySelector('.editable-div');
        return !!ed && ed.scrollHeight - ed.clientHeight > 1;
    }, uuid, { timeout: 10000 });
    // Where the card settled: it is placed on the frame after it exists.
    const box = () => page.evaluate((id) => {
        const b = Graph.nodes[id].view.div.querySelector('.editable-div').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    }, uuid);
    let at = await box();
    for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(100);
        const again = await box();
        if (again.x === at.x && again.y === at.y) break;
        at = again;
    }
    await page.evaluate(() => Autopilot.stop());

    // Out, the way the text could scroll; then in, the way it could not.
    for (const scale of [0.5, 2]) {
        const out = await pinch(page, at, scale);
        assert.ok(Math.abs(out.magnification / out.pinched - 1) < 1e-6,
            `a ${out.pinched}x pinch over the note zoomed ${out.magnification}x`);
        const top = await page.evaluate((id) => Graph.nodes[id].view.div.querySelector('.editable-div').scrollTop, uuid);
        assert.equal(top, 0, 'the pinch scrolled the note');
        at = await box();
    }
    assert.deepEqual(errors, []);
});

// Adjust Controls can give the zoom to a mouse button's drag, and then the wheel no longer zooms.
// A pinch still does: it is the trackpad's zoom, not the wheel.
test("a pinch zooms when the wheel is set not to", { skip }, async () => {
    await page.evaluate(() => { controls.zoomClick.value = 1; updateSettingsFromControls(); });
    await page.mouse.move(800, 500);
    const before = await page.evaluate(() => Graph.zoom.mag());
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => Graph.zoom.mag()), before, 'the wheel zoomed, set to the middle button');

    const out = await pinch(page, { x: 800, y: 500 }, 0.5);
    assert.ok(Math.abs(out.magnification / out.pinched - 1) < 1e-6,
        `a ${out.pinched}x pinch zoomed ${out.magnification}x with the wheel set not to zoom`);
    assert.deepEqual(errors, []);
});

// Settings holds everything behind it (#82): Safari's pinch is kept from the Graph there
// (29-settings-modal), and Chromium's, which is the wheel, has to be as well -- over the dialog
// and over the dimmed page beside it.
test('a pinch under Settings leaves the Graph', { skip }, async () => {
    await openSettings(page, 'notes');
    const zoom = await page.evaluate(() => Graph.zoom.mag());
    const over = await page.evaluate(() => {
        const r = document.getElementById('settingsBody').getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    for (const at of [over, { x: 20, y: 500 }]) {
        await pinch(page, at, 0.5);
        assert.equal(await page.evaluate(() => Graph.zoom.mag()), zoom,
            `a pinch at (${at.x}, ${at.y}) zoomed the Graph behind Settings`);
    }
    assert.deepEqual(errors, []);
});
