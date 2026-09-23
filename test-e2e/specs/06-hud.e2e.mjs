import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

const view = (page) => page.evaluate(() => ({
    panX: Graph.pan.x, panY: Graph.pan.y,
    zoom: Graph.zoom.mag(),
    scale: document.querySelector('.hud-scale').textContent,
    count: document.querySelector('.hud-count').textContent,
}));

const allNotesOnScreen = (page) => page.evaluate(() =>
    Object.values(Graph.nodes).every(n => {
        const uv = fromZtoUV(n.pos);
        return uv.x > 0 && uv.x < 1 && uv.y > 0 && uv.y < 1;
    }));

test('the panel mounts inside the chrome layer and is on screen', async () => {
    // Inside `.dropdown` specifically: that is the one layer whose children have the
    // canvas gestures stop-propagated for them, so a control anywhere else pans and
    // zooms the canvas when a reader tries to use it.
    const state = await page.evaluate(() => {
        const panel = document.querySelector('.hud-panel');
        const box = panel?.getBoundingClientRect();
        return {
            inDropdown: !!panel?.closest('.dropdown'),
            onScreen: !!box && box.width > 0 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1,
        };
    });
    assert.ok(state.inDropdown, 'panel is inside .dropdown');
    assert.ok(state.onScreen, 'panel is within the viewport');
});

// A first load was a black field with a fractal in it and no instruction anywhere. The
// gesture that makes a note leaves no trace until someone tries it, so the canvas says
// so once and retires the moment there is something on it.
test('the empty canvas says what to do, and stops once there is a note', async () => {
    const empty = await page.evaluate(() => {
        const h = document.querySelector('.canvas-hint');
        const box = h?.getBoundingClientRect();
        return {
            present: !!h,
            visible: h ? getComputedStyle(h).opacity !== '0' : false,
            // It must not eat the double-click it is asking for.
            pointerEvents: h && getComputedStyle(h).pointerEvents,
            centred: box ? Math.abs((box.left + box.width / 2) - window.innerWidth / 2) < 4 : false,
            mentionsTheGesture: /double-click/i.test(h?.textContent || ''),
        };
    });
    assert.ok(empty.present, 'the hint exists on an empty canvas');
    assert.ok(empty.visible, 'and is visible');
    assert.equal(empty.pointerEvents, 'none', 'and does not intercept the gesture it describes');
    assert.ok(empty.centred, 'and is centred');
    assert.ok(empty.mentionsTheGesture, 'and names the gesture');

    await addNote(page, 'First', 'A note.');

    // The state, not the opacity: opacity is transitioned over 400ms, so reading it
    // straight after the change catches a value mid-fade and reports "still visible"
    // for a hint that is already on its way out. The class is what the code decides.
    await page.waitForFunction(
        () => document.querySelector('.canvas-hint')?.classList.contains('is-hidden'),
        undefined, { timeout: 5000 });

    // And it does reach fully transparent, once the transition has run.
    await page.waitForFunction(
        () => getComputedStyle(document.querySelector('.canvas-hint')).opacity === '0',
        undefined, { timeout: 5000 });
});

test('the scale readout tracks the zoom', async () => {
    const start = await view(page);
    assert.match(start.scale, /1(\.0)?$/, `starts near unity, got "${start.scale}"`);

    await page.mouse.move(800, 500);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(300);

    const zoomed = await view(page);
    assert.ok(zoomed.zoom < start.zoom, 'the wheel zoomed in');
    assert.notEqual(zoomed.scale, start.scale, `the readout changed, got "${zoomed.scale}"`);
});

test('the note count reports the graph', async () => {
    assert.match((await view(page)).count, /^0 notes$/);
    await addNote(page, 'One', 'body');
    await page.waitForTimeout(250);
    assert.match((await view(page)).count, /^1 note$/, 'singular for one');
    await addNote(page, 'Two', 'body');
    await page.waitForTimeout(250);
    assert.match((await view(page)).count, /^2 notes$/);
});

test('Fit brings every note back on screen from a deep zoom', async () => {
    for (const t of ['A', 'B', 'C', 'D']) await addNote(page, t, `Body ${t}`);
    await page.waitForTimeout(700);

    // Zoom in hard and pan away, so nothing is visible to start with.
    await page.evaluate(() => {
        Graph.zoom_scaleBy(1 / 5000);
        Graph.pan_set(new vec2(12, -7));
    });
    await page.waitForTimeout(200);
    assert.equal(await allNotesOnScreen(page), false, 'nothing is in view first');

    await page.click('.hud-btn[data-act="fit"]');
    await page.waitForTimeout(400);
    assert.ok(await allNotesOnScreen(page), 'every note is in view after Fit');
});

test('Home returns to the origin at unit zoom', async () => {
    await page.evaluate(() => {
        Graph.pan_set(new vec2(400, -260));
        Graph.zoom_scaleBy(1 / 900);
    });
    await page.click('.hud-btn[data-act="home"]');
    await page.waitForTimeout(300);

    const v = await view(page);
    assert.equal(v.panX, 0);
    assert.equal(v.panY, 0);
    assert.ok(Math.abs(v.zoom - 1) < 1e-9, `zoom is 1, got ${v.zoom}`);
});

test('dragging the overview moves the camera', async () => {
    await addNote(page, 'Anchor', 'body');
    await page.waitForTimeout(300);
    const before = await view(page);

    const box = await page.locator('.hud-map').boundingBox();
    await page.mouse.move(box.x + 16, box.y + 16);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 16, box.y + box.height - 16, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const after = await view(page);
    const moved = Math.hypot(after.panX - before.panX, after.panY - before.panY);
    assert.ok(moved > 0, `the camera moved, by ${moved}`);
});

// The shortcuts are guarded on where the caret is, which the app's older global
// handlers are not -- f, d and the arrows are read out of keyState every frame with
// no focus check, so typing "f" in a field still scales the selection. This asserts
// the new keys do not join them.
test('the view shortcuts do not fire while typing', async () => {
    const uuid = await addNote(page, 'Typing', 'body');
    await page.waitForTimeout(300);
    const before = await view(page);

    await page.evaluate((id) => Graph.nodes[id].view.titleInput.focus(), uuid);
    await page.keyboard.type('0--0++0');
    await page.waitForTimeout(300);

    const after = await view(page);
    assert.equal(after.panX, before.panX, 'pan x unchanged');
    assert.equal(after.panY, before.panY, 'pan y unchanged');
    assert.equal(after.zoom, before.zoom, 'zoom unchanged');
});

test('the view shortcuts do fire when the canvas has focus', async () => {
    await page.evaluate(() => {
        document.activeElement?.blur?.();
        Graph.pan_set(new vec2(9, 9));
    });
    await page.keyboard.press('Home');
    await page.waitForTimeout(250);

    const v = await view(page);
    assert.equal(v.panX, 0, 'Home reached the handler');
    assert.equal(v.panY, 0);
});
