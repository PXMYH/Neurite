import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The wheel is the canvas's gesture. Node.onWheel returned early without Shift, and the
// canvas's own listener is bound to #svg_bg which a card is not inside, so zooming
// silently did nothing wherever a note sat under the pointer -- and cards are drawn at
// full scale now, so that is most of the screen.
test('the wheel zooms the canvas when the pointer is over a note', async () => {
    const uuid = await addNote(page, 'Short', 'One line.');
    await page.waitForTimeout(600);

    const before = await page.evaluate(() => Graph.zoom.mag());
    const pt = await page.evaluate((id) => {
        const b = Graph.nodes[id].view.div.getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 12) };
    }, uuid);
    await page.mouse.move(pt.x, pt.y);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => Graph.zoom.mag());
    assert.ok(after < before, `zoomed in over the card: ${before} -> ${after}`);
});

// But a note with more text than fits keeps the wheel until it is read to the end, which
// is what the wheel means inside a scrollable box.
test('a note with overflowing text scrolls before the canvas zooms', async () => {
    const body = Array.from({ length: 60 }, (_, i) => `Sentence ${i} of a long note.`).join(' ');
    const uuid = await addNote(page, 'Long', body);

    // Waited for rather than slept on: the body reaches the card a sync pass after the
    // card exists, and the box is not scrollable until it has the text in it. A fixed
    // delay here is what made this test flake.
    await page.waitForFunction((id) => {
        const ed = Graph.nodes[id]?.view?.div?.querySelector('.editable-div');
        return !!ed && ed.scrollHeight - ed.clientHeight > 1;
    }, uuid, { timeout: 10000 });

    const pt = await page.evaluate((id) => {
        const b = Graph.nodes[id].view.div.querySelector('.editable-div').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    }, uuid);
    const zoomBefore = await page.evaluate(() => Graph.zoom.mag());
    await page.mouse.move(pt.x, pt.y);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120);
    await page.waitForTimeout(250);

    const mid = await page.evaluate((id) => ({
        top: Graph.nodes[id].view.div.querySelector('.editable-div').scrollTop,
        zoom: Graph.zoom.mag(),
    }), uuid);
    assert.ok(mid.top > 0, `the body scrolled, to ${mid.top}`);
    assert.equal(mid.zoom, zoomBefore, 'and the canvas did not zoom while there was text left');

    // At the end of the text, the canvas takes the gesture.
    await page.evaluate((id) => {
        const ed = Graph.nodes[id].view.div.querySelector('.editable-div');
        ed.scrollTop = ed.scrollHeight;
    }, uuid);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 120);
    await page.waitForTimeout(250);
    const end = await page.evaluate(() => Graph.zoom.mag());
    assert.notEqual(end, zoomBefore, 'the canvas zooms once the note is scrolled to its end');
});

// The menu button's tooltip described the two file commands and then covered them.
test("the menu's tooltip does not cover the menu", async () => {
    await page.click('.menu-button');
    await page.waitForTimeout(350);
    await page.hover('.menu-button');
    await page.waitForTimeout(1300);

    const state = await page.evaluate(() => {
        const tip = document.querySelector('.ui-tooltip');
        const t = tip?.getBoundingClientRect();
        if (!t || !t.width) return { shown: false, covered: [] };
        const covered = [...document.querySelectorAll('.menu-row')]
            .filter(r => {
                const b = r.getBoundingClientRect();
                return b.width && !(t.right < b.left || t.left > b.right || t.bottom < b.top || t.top > b.bottom);
            })
            .map(r => r.textContent.trim().split('\n')[0]);
        return { shown: true, covered };
    });
    assert.ok(state.shown, 'the tooltip appeared, or this test proves nothing');
    assert.deepEqual(state.covered, [], `no menu row is covered; these were: ${state.covered.join(', ')}`);
});

// An instruction on an empty canvas is the one piece of text a reader cannot check, so it
// has to describe something the app does. This one used to promise a Shift-drag link
// gesture that does not exist -- dragging a card onto another moves it and makes no edge.
test('the empty-state hint describes a gesture that exists', async () => {
    const text = await page.evaluate(() => document.querySelector('.canvas-hint')?.textContent || '');
    assert.doesNotMatch(text, /drag a note onto another/i, 'no Shift-drag-to-link claim');
    assert.match(text, /\[\[/, 'it teaches the link syntax the app actually uses');

    // And the syntax it teaches works.
    await addNote(page, 'Target', 'A note to point at.');
    await addNote(page, 'Source', 'Pointing. [[Target]]');
    await page.waitForFunction(() => Object.keys(Graph.edges).length > 0, undefined, { timeout: 8000 });
    assert.ok(await page.evaluate(() => Object.keys(Graph.edges).length > 0), 'the [[link]] made an edge');
});

// Tidy resolves overlaps and nothing else: it is not a layout, and it does not move a
// card that was not on top of something.
test('Tidy separates a pile', async () => {
    for (const t of ['A', 'B', 'C', 'D', 'E', 'F']) await addNote(page, t, `Body ${t}.`);
    await page.waitForTimeout(900);

    const worst = () => page.evaluate(() => {
        const ns = Object.values(Graph.nodes).filter(n => !n.removed);
        let r = Infinity;
        for (let i = 0; i < ns.length; i++) {
            for (let j = i + 1; j < ns.length; j++) {
                const a = Graph.planeHalfExtent(ns[i]), b = Graph.planeHalfExtent(ns[j]);
                if (!a || !b) continue;
                const dx = Math.abs(ns[i].pos.x - ns[j].pos.x), dy = Math.abs(ns[i].pos.y - ns[j].pos.y);
                r = Math.min(r, Math.max(dx / (a.hw + b.hw), dy / (a.hh + b.hh)));
            }
        }
        return r;
    });

    // Stack them deliberately, anchors included -- an anchored card is sprung back to its
    // anchor every frame, so moving pos without the anchor would not hold.
    await page.evaluate(() => {
        let i = 0;
        for (const n of Object.values(Graph.nodes)) {
            n.pos = new vec2(0.01 * (i % 2), 0.01 * i); n.anchor = n.pos; i += 1;
        }
    });
    await page.waitForTimeout(250);
    const piled = await worst();
    assert.ok(piled < 0.5, `they are genuinely piled, worst ratio ${piled.toFixed(3)}`);

    await page.click('.hud-btn[data-act="tidy"]');
    await page.waitForTimeout(400);

    const tidied = await worst();
    assert.ok(tidied >= 1, `no pair overlaps after Tidy; worst ratio ${tidied.toFixed(3)}`);

    // And it stays: the anchors moved with the cards.
    await page.waitForTimeout(1200);
    const held = await worst();
    assert.ok(held >= 1, `still clear a second later; worst ratio ${held.toFixed(3)}`);
});
