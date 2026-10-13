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

// Notes made, pinned side by side across the middle of the view, and collapsed once they have
// been drawn, as a reader collapses one.
async function notes(page, titles) {
    for (const t of titles) await addNote(page, t, t.toLowerCase());
    await page.waitForTimeout(500);
    await page.evaluate((titles) => {
        titles.forEach((t, i) => {
            const n = Object.values(Graph.nodes).find((n) => n.getTitle() === t);
            n.pos = Graph.pan.plus(new vec2((i - (titles.length - 1) / 2) * 0.6, 0));
            n.anchor = n.pos; n.anchorForce = 1;
            n.view.toggleCollapse();
        });
    }, titles);
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
    // A trackpad's pinch arrives as Control and the wheel -- and stays the canvas's zoom though
    // Adjust Controls gave Alt's place to Control.
    for (const [key, alt] of [[null, 'Alt'], ['Control', 'Alt'], ['Control', 'Control']]) {
        await page.evaluate((alt) => { controls.altKey.value = alt; Graph.zoom = Graph.zoom.unscale(Graph.zoom.mag()) }, alt);
        await page.waitForTimeout(300);
        const was = await circle(page);
        await wheel(page, was.at, key, 0, -200);
        const now = await circle(page);
        assert.equal(now.scale, 1, `${key ?? 'a plain'} scroll over the circle resized it, with Alt's key ${alt}`);
        assert.ok(now.zoom < was.zoom * 0.95, `${key ?? 'a plain'} scroll over the circle did not zoom the canvas in, with Alt's key ${alt}`);
    }
    await page.evaluate(() => { controls.altKey.value = 'Alt' });
    // Away from the note, Alt + scroll is the view's turn.
    const was = await circle(page);
    await wheel(page, { x: 80, y: 500 }, 'Alt', 0, -200);
    const now = await circle(page);
    assert.notEqual(now.angle, was.angle, 'Alt + scroll on the Plane no longer turns the view');
    assert.equal(now.scale, 1);
    assert.deepEqual(errors, []);
});

test('Alt + scroll over a note during a flight to coordinates resizes it, and throws nothing', async () => {
    await notes(page, ['Alpha']);
    const scale = await page.evaluate(() => {
        const n = Object.values(Graph.nodes)[0];
        Autopilot.referenceFrame = null;
        Autopilot.speed = 0.1;
        n.view.div.querySelector('.collapsed-circle').dispatchEvent(new WheelEvent('wheel', { deltaY: -200, altKey: true, bubbles: true, cancelable: true }));
        Autopilot.speed = 0;
        return n.scale;
    });
    assert.ok(scale > 1.2, `the note was not resized (${scale})`);
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

// Linking collapsed notes (asked in chat: "when i click the second circle text it always expand
// the text node"). The expand button sat inside the circle, from just under its middle, where it
// covered the last 8 px of a two-line title; a Shift + click there linked the notes and opened the
// second one as well. It is under the circle's rim now, gone while the connect mode is on, and a
// press that links, selects or drags never opens the note.
const spot = (page, title) => page.evaluate((title) => {
    const v = Object.values(Graph.nodes).find((n) => n.getTitle() === title).view;
    const c = v.div.querySelector('.collapsed-circle').getBoundingClientRect(), t = v.div.querySelector('.collapsed-title').getBoundingClientRect();
    const b = v.div.querySelector('.expand-button').getBoundingClientRect();
    // Where the button and a two-line title met: the button ran from 12 px under the circle's
    // middle to 36 px under it, and the title's second line ends about 17 px under it.
    return { centre: { x: c.x + c.width / 2, y: c.y + c.height / 2 }, was: { x: c.x + c.width / 2, y: c.y + c.height / 2 + 15 },
             button: { x: b.x + b.width / 2, y: b.y + b.height / 2, top: b.top }, title: { bottom: t.bottom }, circle: { bottom: c.bottom } };
}, title);
const linked = (page) => page.evaluate(() => ({
    edges: Object.values(Graph.edges).map((e) => e.pts.map((n) => n.getTitle()).sort().join(' - ')).sort(),
    open: Object.values(Graph.nodes).filter((n) => !n.view.div.classList.contains('collapsed')).map((n) => n.getTitle()),
}));
const press = (page, at) => (isIPad ? page.touchscreen.tap(at.x, at.y) : page.mouse.click(at.x, at.y));

test("Shift + click on a collapsed note's circle links it, under its title too, and never opens it", { skip: isIPad && 'a finger has no Shift' }, async () => {
    await notes(page, ['Alpha', 'Agent = Model + Harness + Evals']);
    const a = await spot(page, 'Alpha'), b = await spot(page, 'Agent = Model + Harness + Evals');
    // The title's last line, and where the button was; both on the circle.
    for (const at of [{ x: b.centre.x, y: b.title.bottom - 4 }, b.was]) {
        assert.ok(at.y < b.circle.bottom, 'the spot under test is off the circle; this test proves nothing');
        await page.keyboard.down('Shift');
        await page.mouse.click(a.centre.x, a.centre.y);
        await page.mouse.move(at.x, at.y);
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => getComputedStyle(Object.values(Graph.nodes)[1].view.div.querySelector('.expand-button')).opacity), '0',
            'the expand button shows while the connect mode is on');
        await page.mouse.click(at.x, at.y);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(400);
        assert.deepEqual(await linked(page), { edges: ['Agent = Model + Harness + Evals - Alpha'], open: [] });
        // Unlinked again for the next spot, by the Ref it wrote.
        await page.evaluate(() => {
            const cm = window.currentActiveZettelkastenMirror;
            cm.setValue(cm.getValue().replace(/\[\[[^\]]*\]\]/g, ''));
        });
        await page.waitForFunction(() => Object.keys(Graph.edges).length === 0, undefined, { timeout: 5000 });
    }
    assert.deepEqual(errors, []);
});

test('with the Connect tool on, a click or a tap on each circle links them and opens neither', async () => {
    await notes(page, ['Alpha', 'Agent = Model + Harness + Evals']);
    const a = await spot(page, 'Alpha'), b = await spot(page, 'Agent = Model + Harness + Evals');
    await press(page, await page.evaluate(() => { const r = document.getElementById('connectTool').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    await page.waitForTimeout(200);
    await press(page, a.centre);
    await page.waitForTimeout(200);
    await press(page, b.was);
    await page.waitForTimeout(400);
    assert.deepEqual(await linked(page), { edges: ['Agent = Model + Harness + Evals - Alpha'], open: [] });
    assert.deepEqual(errors, []);
});

test("the expand button is under the circle's rim, clear of its title; a click on it opens the note, a drag from it does not", { skip: isIPad && 'shows under a mouse' }, async () => {
    const long = 'Retrieval practice spaced over weeks beats one long session';
    await notes(page, ['Alpha', 'Agent = Model + Harness + Evals', long]);
    for (const title of ['Alpha', 'Agent = Model + Harness + Evals', long]) {
        const s = await spot(page, title);
        await page.mouse.move(s.centre.x, s.centre.y);
        await page.waitForTimeout(200);
        const now = await spot(page, title);
        assert.ok(now.button.top >= now.title.bottom, `${title}: the expand button is on the title (${now.button.top} < ${now.title.bottom})`);
        assert.ok(now.button.top < now.circle.bottom, `${title}: the expand button has come off the circle, and its hover with it`);
    }
    // A drag that starts on it moves the circle and leaves it collapsed.
    let s = await spot(page, 'Alpha');
    await page.mouse.move(s.centre.x, s.centre.y);
    await page.mouse.move(s.button.x, s.button.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(s.button.x + 80, s.button.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.deepEqual((await linked(page)).open, [], 'a drag from the expand button opened the note');
    // A click with no press before it, as assistive technology sends one, after that drag.
    await page.evaluate(() => Object.values(Graph.nodes)[0].view.div.querySelector('.expand-button')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(300);
    assert.deepEqual((await linked(page)).open, ['Alpha'], 'a click after a drag from the button opened nothing');
    await page.evaluate(() => Object.values(Graph.nodes)[0].view.toggleCollapse());
    await page.waitForTimeout(400);
    // Reached from the circle, a plain click on it opens the note.
    s = await spot(page, 'Alpha');
    await page.mouse.move(s.centre.x, s.centre.y);
    await page.mouse.move(s.button.x, s.button.y, { steps: 4 });
    await page.waitForTimeout(150);
    await page.mouse.click(s.button.x, s.button.y);
    await page.waitForTimeout(400);
    assert.deepEqual((await linked(page)).open, ['Alpha'], 'a click on the expand button did not open the note');
    assert.deepEqual(errors, []);
});

// A note collapsed in the frame it was made, before its link strip was first drawn: the strip
// was made after, shown, and pushed the circle 45 px out of its card -- off its title and its
// expand button.
test('a note collapsed as it is made shows no link strip, and its circle stays in its card', async () => {
    // Made and collapsed in one task, so no frame runs between: the strip is drawn after.
    const before = await page.evaluate(() => {
        window.currentActiveZettelkastenMirror.setValue('## Alpha\nalpha\n\n## Agent = Model + Harness + Evals\nagent\n');
        return Object.values(Graph.nodes).map((n) => {
            n.anchor = n.pos; n.anchorForce = 1;
            n.view.toggleCollapse();
            return Boolean(n.view.div.querySelector(':scope > .link-strip'));
        });
    });
    assert.deepEqual(before, [false, false], 'the strip was drawn before the collapse; this test proves nothing');
    await page.waitForTimeout(600);
    const seen = await page.evaluate(() => Object.values(Graph.nodes).map((n) => {
        const strip = n.view.div.querySelector(':scope > .link-strip');
        const card = n.view.div.getBoundingClientRect(), disc = n.view.div.querySelector('.collapsed-circle').getBoundingClientRect();
        return [strip ? getComputedStyle(strip).display : 'none', Math.round(disc.top - card.top)];
    }));
    for (const [display, offset] of seen) {
        assert.equal(display, 'none', 'a collapsed card shows its link strip');
        assert.ok(Math.abs(offset) <= 8, `the circle is ${offset} px down its card`);
    }
    assert.deepEqual(errors, []);
});

// A Saved Graph is the markup, with what a collapse hid in it -- and a strip shown, saved before
// this. Restored, the window buttons came back shown too: a fresh copy replaced the saved ones
// (`refreshControlIcons`), and their 30 px pushed the circle out of its card, so that its middle
// was where the expand button sat.
test('a collapsed note restored from a Saved Graph keeps its circle in its card, its buttons and links hidden', async () => {
    await notes(page, ['Alpha']);
    await page.evaluate(() => {
        const strip = Object.values(Graph.nodes)[0].view.div.querySelector(':scope > .link-strip');
        strip.style.display = '';
        return App.viewGraphs.saveNow();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && Object.keys(Graph.nodes).length === 1, undefined, { timeout: 30000 });
    await page.waitForTimeout(800);
    const [display, buttons, offset] = await page.evaluate(() => {
        const v = Object.values(Graph.nodes)[0].view;
        const card = v.div.getBoundingClientRect(), disc = v.div.querySelector('.collapsed-circle').getBoundingClientRect();
        return [getComputedStyle(v.div.querySelector(':scope > .link-strip')).display,
            getComputedStyle(v.headerContainer.querySelector('.button-container')).display, Math.round(disc.top - card.top)];
    });
    assert.equal(display, 'none', 'the restored collapsed card shows its link strip');
    assert.equal(buttons, 'none', 'the restored collapsed card shows its window buttons');
    assert.ok(Math.abs(offset) <= 8, `the circle is ${offset} px down its card`);
    assert.deepEqual(errors, []);
});

// Its title follows the Notes text while it is a circle. The circle's copy was taken only at the
// collapse, so a rename in the Pane showed the old title until the note was opened.
test('a collapsed note renamed in the Notes text shows its new title', async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\nalpha\n'));
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 1, undefined, { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => Object.values(Graph.nodes)[0].view.toggleCollapse());
    await page.waitForTimeout(300);
    await page.evaluate(() => { const cm = window.currentActiveZettelkastenMirror; cm.setValue(cm.getValue().replace('## Alpha', '## Beta')); });
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => { const n = Object.values(Graph.nodes)[0];
        return [n.getTitle(), n.view.div.querySelector('.collapsed-title').textContent]; }), ['Beta', 'Beta']);
    assert.deepEqual(errors, []);
});

// A restored collapsed card's title is stowed, and measures 0 high; the fitter asked again every
// frame for as long as the card stayed a circle -- 94 times in a second for two cards.
test('a restored collapsed note does not ask to fit its title every frame', async () => {
    await notes(page, ['Alpha', 'Beta']);
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && Object.keys(Graph.nodes).length === 2, undefined, { timeout: 30000 });
    await page.waitForTimeout(800);
    const asked = await page.evaluate(() => new Promise((done) => {
        const fits = new Set(Object.values(Graph.nodes).map((n) => n.view.fitTitleHeight));
        let n = 0;
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = (cb) => { if (fits.has(cb)) n++; return raf.call(window, cb); };
        setTimeout(() => { window.requestAnimationFrame = raf; done(n); }, 1000);
    }));
    assert.equal(asked, 0, `the title fitter was asked for ${asked} times in a second`);
    // Opened, its title has its height.
    await page.evaluate(() => Object.values(Graph.nodes)[0].view.toggleCollapse());
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => parseFloat(Object.values(Graph.nodes)[0].view.titleInput.style.height) > 0), 'the opened title has no height');
    assert.deepEqual(errors, []);
});
