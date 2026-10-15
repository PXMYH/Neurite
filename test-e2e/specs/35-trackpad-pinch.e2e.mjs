import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, addAiNote, isIPad, openSettings } from './helpers.mjs';

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

async function pinch(page, at, scaleFactor, relativeSpeed = 800) {
    await page.evaluate(() => {
        // One listener for the page, however many pinches: a second one counted each event twice.
        // The events are kept, since an event reads `defaultPrevented` after its dispatch is over.
        if (!window.__pinch) window.addEventListener('wheel', (e) => { window.__pinch.push(e) }, true);
        window.__pinch = [];
    });
    await page.mouse.move(at.x, at.y);
    const before = await page.evaluate(([x, y]) => {
        const z = Graph.xyToZ(x, y);
        return { mag: Graph.zoom.mag(), angle: Math.atan2(Graph.zoom.y, Graph.zoom.x), x: z.x, y: z.y };
    }, [at.x, at.y]);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture',
        { x: at.x, y: at.y, scaleFactor, relativeSpeed, gestureSourceType: 'mouse' });
    await page.waitForTimeout(300);
    const after = await page.evaluate(([x, y]) => {
        const z = Graph.xyToZ(x, y);
        const events = window.__pinch;
        return { mag: Graph.zoom.mag(), angle: Math.atan2(Graph.zoom.y, Graph.zoom.x), x: z.x, y: z.y,
                 pxPerUnit: Svg.scale / 2 / Graph.zoom.mag(),
                 sum: events.reduce((a, e) => a + e.deltaY, 0), events: events.length,
                 ctrl: events.every((e) => e.ctrlKey), cancelled: events.filter((e) => e.defaultPrevented).length };
    }, [at.x, at.y]);
    return {
        // Above 1 is closer, as `performZoom`'s argument is.
        magnification: before.mag / after.mag,
        pinched: Math.exp(-after.sum / 100),
        allControl: after.ctrl,
        driftPx: Math.hypot(after.x - before.x, after.y - before.y) * after.pxPerUnit,
        turned: after.angle - before.angle,
        events: after.events,
        cancelled: after.cancelled,
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

    // A fast one sends up to 50 in an event (8000 px/s); a cap of one step on an event cut it to
    // 0.517x where it was 0.5x (the second review).
    const fast = await pinch(page, { x: 1100, y: 330 }, 0.25, 8000);
    assert.ok(Math.abs(fast.pinched - 0.25) < 0.05, `Chromium sent a fast pinch of ${fast.pinched}, not about 0.25`);
    assert.ok(Math.abs(fast.magnification / fast.pinched - 1) < 1e-6,
        `a fast ${fast.pinched}x pinch zoomed ${fast.magnification}x`);
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

// An AI note's response keeps the wheel, to scroll, and it stopped the event there -- a pinch too,
// so over a response a pinch zoomed nothing (1.000x, measured).
test("a pinch over an AI note's response zooms the Plane", { skip }, async () => {
    const uuid = await addAiNote(page, 'Asked');
    await page.waitForTimeout(1200);
    await page.evaluate(() => Autopilot.stop());
    const at = await page.evaluate((id) => {
        const el = Graph.nodes[id].view.div.querySelector('.ai-response-div');
        const b = el.getBoundingClientRect();
        const pt = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(b.height / 2, 20)) };
        return { ...pt, hit: document.elementFromPoint(pt.x, pt.y)?.closest('.ai-response-div') === el };
    }, uuid);
    assert.ok(at.hit, 'no point over the response to pinch on');
    const out = await pinch(page, at, 0.5);
    assert.ok(Math.abs(out.magnification / out.pinched - 1) < 1e-6,
        `a ${out.pinched}x pinch over the response zoomed ${out.magnification}x`);
    assert.deepEqual(errors, []);
});

// From the adversarial review. The page cancels every Control + wheel against the browser's own
// zoom, but on the way up: the Plane's wheel listener stopped the event first and, passive, could
// not cancel it itself, so 0 of a pinch's events over the Plane came out cancelled, nor over the
// tool bar, which stops the wheel too. Cancelled before anything sees it now.
test("a pinch never reaches the browser's own zoom", { skip }, async () => {
    const bar = await page.evaluate(() => {
        const b = document.querySelector('.tool-bar').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    });
    for (const [where, at] of [['the Plane', { x: 1100, y: 500 }], ['the tool bar', bar]]) {
        const out = await pinch(page, at, 0.5);
        assert.ok(out.events > 0, `no pinch arrived over ${where}`);
        assert.equal(out.cancelled, out.events, `${out.events - out.cancelled} of ${out.events} events over ${where} were left to the browser`);
    }
    assert.deepEqual(errors, []);
});

// A mouse's wheel turned with Control held is the same event as a pinch's, 120 a notch -- at a
// pinch's scale a 3.3x jump. The keyboard tells them apart: Control held, it is the wheel.
async function controlWheel(page, deltaY) {
    await page.mouse.move(800, 500);
    const before = await page.evaluate(() => [Graph.zoom.mag(), Math.atan2(Graph.zoom.y, Graph.zoom.x)]);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, deltaY);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => [Graph.zoom.mag(), Math.atan2(Graph.zoom.y, Graph.zoom.x)]);
    return { magnification: before[0] / after[0], turned: after[1] - before[1] };
}

test("Control held and a mouse's wheel zoom as the wheel does, not as a pinch", { skip }, async () => {
    const out = await controlWheel(page, -120);
    const wheel = await page.evaluate(() => Math.exp(120 * settings.zoomSpeed * settings.zoomSpeedMultiplier));
    assert.ok(Math.abs(out.magnification - wheel) < 1e-9, `a notch with Control held zoomed ${out.magnification}x, the wheel ${wheel}x`);
    // And the next pinch is a pinch again: Control let go.
    const after = await pinch(page, { x: 1100, y: 500 }, 0.5);
    assert.ok(Math.abs(after.magnification / after.pinched - 1) < 1e-6, `a ${after.pinched}x pinch zoomed ${after.magnification}x`);
});

// Adjust Controls can give the turn of the view to Control, and a pinch comes with Control set:
// on 1.9.8 a pinch then turned the view and zoomed nothing. The pinch stays the zoom, and Control
// held on the keyboard with the wheel turns the view, as the reader chose (the second review).
test('with the turn given to Control, a pinch zooms and Control with the wheel turns', { skip }, async () => {
    await page.evaluate(() => { controls.altKey.value = 'Control'; updateSettingsFromControls(); });
    assert.equal(await page.evaluate(() => settings.rotateModifier), 'Control');
    const out = await pinch(page, { x: 1100, y: 500 }, 0.5);
    assert.ok(Math.abs(out.magnification / out.pinched - 1) < 1e-6, `a ${out.pinched}x pinch zoomed ${out.magnification}x`);
    assert.equal(out.turned, 0, 'the pinch turned the view');

    const held = await controlWheel(page, -120);
    assert.ok(Math.abs(held.turned) > 0.01, `Control and the wheel turned the view ${held.turned} rad`);
    assert.ok(Math.abs(held.magnification - 1) < 1e-9, `Control and the wheel zoomed ${held.magnification}x`);
    assert.deepEqual(errors, []);
});

// With Connect on, the wheel over a note resizes it and over an Edge changes its length, as Shift
// does. A pinch did the same on 1.9.8, and zoomed nothing. It is the Plane's zoom now, in any mode.
test('with Connect on, a pinch over a note or an Edge zooms the Plane and leaves them be', { skip }, async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\nSee [[Beta]].\n\n## Beta\nb\n'));
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => Autopilot.stop());
    await page.click('#connectTool');
    assert.equal(await page.evaluate(() => document.getElementById('connectTool').getAttribute('aria-pressed')), 'true');
    const at = await page.evaluate(() => {
        const node = Object.values(Graph.nodes).find((n) => n.getTitle() === 'Alpha');
        const b = node.view.div.getBoundingClientRect();
        const path = Object.values(Graph.edges)[0].view.svgLink;
        const p = path.getPointAtLength(path.getTotalLength() / 2);
        const m = path.getScreenCTM();
        const edge = { x: Math.round(p.x * m.a + p.y * m.c + m.e), y: Math.round(p.x * m.b + p.y * m.d + m.f) };
        return { note: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 14) }, edge,
                 onEdge: Boolean(document.elementFromPoint(edge.x, edge.y)?.closest('.edge-halo, .edge-link')) };
    });
    assert.ok(at.onEdge, 'the point half way along the Edge is not on it');
    const sizes = () => page.evaluate(() => ({
        scale: Object.values(Graph.nodes).find((n) => n.getTitle() === 'Alpha').scale,
        length: Object.values(Graph.edges)[0].length,
    }));
    const start = await sizes();

    const overNote = await pinch(page, at.note, 0.5);
    assert.ok(Math.abs(overNote.magnification / overNote.pinched - 1) < 1e-6,
        `a ${overNote.pinched}x pinch over the note zoomed ${overNote.magnification}x`);
    // Out by a half about the note's top, the Edge's middle is still where it was on the Plane;
    // read again, so the second pinch is over the Edge as it is drawn now.
    const edgeNow = await page.evaluate(() => {
        const path = Object.values(Graph.edges)[0].view.svgLink;
        const p = path.getPointAtLength(path.getTotalLength() / 2);
        const m = path.getScreenCTM();
        return { x: Math.round(p.x * m.a + p.y * m.c + m.e), y: Math.round(p.x * m.b + p.y * m.d + m.f) };
    });
    const overEdge = await pinch(page, edgeNow, 2);
    assert.ok(Math.abs(overEdge.magnification / overEdge.pinched - 1) < 1e-6,
        `a ${overEdge.pinched}x pinch over the Edge zoomed ${overEdge.magnification}x`);
    assert.deepEqual(await sizes(), start, 'a pinch resized the note or changed the Edge');
    assert.deepEqual(errors, []);
});

// From the third review. Control held and the wheel, over a note with text to scroll, went to the
// text's scroller as a plain wheel does, and the page cancels every Control + wheel against the
// browser's own zoom: neither the text nor the Plane moved. It is a zoom, as a pinch is.
test('Control held and the wheel over a note with text to scroll zoom the Plane', { skip }, async () => {
    const body = Array.from({ length: 60 }, (_, i) => `Sentence ${i} of a long note.`).join(' ');
    const uuid = await addNote(page, 'Long', body);
    await page.waitForFunction((id) => {
        const ed = Graph.nodes[id]?.view?.div?.querySelector('.editable-div');
        return !!ed && ed.scrollHeight - ed.clientHeight > 1;
    }, uuid, { timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => Autopilot.stop());
    const at = await page.evaluate((id) => {
        const b = Graph.nodes[id].view.div.querySelector('.editable-div').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    }, uuid);
    await page.mouse.move(at.x, at.y);
    const before = await page.evaluate(() => Graph.zoom.mag());
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 120);              // down: the way the text could scroll
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    const magnification = before / await page.evaluate(() => Graph.zoom.mag());
    const wheel = await page.evaluate(() => Math.exp(-120 * settings.zoomSpeed * settings.zoomSpeedMultiplier));
    assert.ok(Math.abs(magnification - wheel) < 1e-9, `Control and the wheel over the note zoomed ${magnification}x, the wheel ${wheel}x`);
    assert.equal(await page.evaluate((id) => Graph.nodes[id].view.div.querySelector('.editable-div').scrollTop, uuid), 0,
        'Control and the wheel scrolled the note');
    assert.deepEqual(errors, []);
});

// Where Control is comes from the keys and the mouse's moves (`ControlKey`). A key the page never
// heard -- pressed while a link's web page had the keyboard, or let go over a menu of the system's
// -- left it wrong until the next key; the next move of the mouse puts it right.
test("a key the page never heard is put right by the mouse's next move", { skip }, async () => {
    // A keyup lost: Control taken for held, so the next pinch would have been the wheel's zoom.
    await page.evaluate(() => { ControlKey.held = true });
    await page.mouse.move(1100, 300);
    await page.mouse.move(1100, 330);
    assert.equal(await page.evaluate(() => ControlKey.held), false, 'a move without Control left Control held');
    const out = await pinch(page, { x: 1100, y: 330 }, 0.5);
    assert.ok(Math.abs(out.magnification / out.pinched - 1) < 1e-6, `a ${out.pinched}x pinch zoomed ${out.magnification}x`);

    // A keydown lost: Control down, the page told it is not.
    await page.keyboard.down('Control');
    await page.evaluate(() => { ControlKey.held = false });
    await page.mouse.move(900, 500);
    const held = await page.evaluate(() => ControlKey.held);
    await page.keyboard.up('Control');
    assert.equal(held, true, 'a move with Control down left Control let go');
    assert.deepEqual(errors, []);
});
