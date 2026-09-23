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

    // And it stays: the anchors moved with the cards. An anchored card is sprung back to
    // `anchor` every frame, so a relaxation that moved `pos` alone would snap back.
    await page.waitForTimeout(1200);
    const held = await worst();
    assert.ok(held >= 1, `still clear a second later; worst ratio ${held.toFixed(3)}`);
});

// Shift and mousedown arms a link that the next mousedown anywhere completes, with no
// time limit. The state was real and had nothing on screen saying so, in an app with no
// undo -- arm one, forget, click a note later, and an edge appears that was never asked
// for. `Node.prev` is an accessor now so the marker survives all five of its assignment
// sites, including the two that clear it for reasons other than completing the link.
test('a note with a link armed from it is marked', async () => {
    const a = await addNote(page, 'A', 'first');
    const b = await addNote(page, 'B', 'second');
    await page.waitForTimeout(600);

    const armed = await page.evaluate(([ia, ib]) => {
        Node.prev = Graph.nodes[ia];
        const marked = Graph.nodes[ia].view.div.classList.contains('link-pending');
        const border = getComputedStyle(Graph.nodes[ia].view.div).borderStyle;
        Node.prev = Graph.nodes[ib];
        return {
            marked, border,
            followed: Graph.nodes[ib].view.div.classList.contains('link-pending'),
            released: !Graph.nodes[ia].view.div.classList.contains('link-pending'),
        };
    }, [a, b]);
    assert.ok(armed.marked, 'the armed card is marked');
    assert.equal(armed.border, 'dashed', 'and reads as pending rather than selected');
    assert.ok(armed.followed, 'arming a different note moves the mark');
    assert.ok(armed.released, 'and takes it off the first');

    const cleared = await page.evaluate(() => {
        Node.prev = null;
        return document.querySelectorAll('.link-pending').length;
    });
    assert.equal(cleared, 0, 'clearing the armed link clears the mark');
});

// An arrowhead says which way a relation runs. It should not be the largest mark between
// two notes. At scale factor 1.5 it measured 11.8% of a card's width, and an intermediate
// 0.85 barely moved the ratio because `wscale` also carries the edge's stress -- the two
// partly cancelled. Asserted against the rendered box, since reasoning about the product
// of five factors is what got it wrong twice.
test('an arrowhead is a mark, not a shape competing with the notes', async () => {
    await addNote(page, 'Encoding', 'Turning experience into a trace.');
    await addNote(page, 'Retrieval', 'Finding it again. [[Encoding]]');
    await page.waitForFunction(
        () => [...document.querySelectorAll('.edge-arrow')].some(a => getComputedStyle(a).display !== 'none'),
        undefined, { timeout: 10000 });

    const ratio = await page.evaluate(() => {
        const arrows = [...document.querySelectorAll('.edge-arrow')]
            .filter(a => getComputedStyle(a).display !== 'none');
        const cardW = Object.values(Graph.nodes)[0].view.div.getBoundingClientRect().width;
        const sizes = arrows
            .map(a => { const b = a.getBoundingClientRect(); return Math.max(b.width, b.height); })
            .sort((x, y) => x - y);
        const median = sizes[Math.floor(sizes.length / 2)] || 0;
        return { percent: median / cardW * 100, median, cardW };
    });
    assert.ok(ratio.percent > 1.5,
        `still visible: ${ratio.percent.toFixed(1)}% of a card (${ratio.median.toFixed(1)}px)`);
    assert.ok(ratio.percent < 8,
        `and not dominant: ${ratio.percent.toFixed(1)}% of a card (${ratio.median.toFixed(1)}px of ${ratio.cardW.toFixed(0)}px)`);
});

// The reviewer's blocker: twelve notes typed into the pane arrived with 9 of 66 card pairs
// overlapping, the worst by 41% of a card, because the pane's placement puts cards in three
// x-columns narrower than a card is wide -- so per-arrival separation, which is bracketed by
// a clamp that keeps the newcomer in view, could never win. The parse now settles the whole
// graph once, without the clamp: a map is allowed to be bigger than the screen.
test('a graph typed into the pane arrives without overlapping cards', async () => {
    await page.evaluate(() => {
        const notes = [
            ['Encoding', 'Turning experience into a trace.'],
            ['Retrieval', 'Finding it again. [[Encoding]]'],
            ['Consolidation', 'Sleep makes it durable. [[Encoding]] [[Retrieval]]'],
            ['Forgetting', 'Traces decay. [[Encoding]] [[Retrieval]] [[Consolidation]]'],
            ['Interference', 'Old competes with new. [[Forgetting]] [[Retrieval]]'],
            ['Working Memory', 'A small live buffer. [[Encoding]]'],
            ['Spacing', 'Gaps beat cramming. [[Consolidation]] [[Forgetting]]'],
            ['Cues', 'A cue finds a trace. [[Retrieval]] [[Encoding]] [[Spacing]]'],
            ['Schema', 'Old knowledge shapes new. [[Encoding]]'],
            ['Sleep', 'Where consolidation happens. [[Consolidation]]'],
            ['Chunking', 'Grouping beats listing. [[Working Memory]] [[Schema]]'],
            ['Testing Effect', 'Recall beats review. [[Retrieval]] [[Spacing]] [[Cues]]'],
        ];
        const cm = window.currentActiveZettelkastenMirror;
        cm.setValue(notes.map(([t, b]) => `${Tag.node} ${t}\n${b}\n`).join('\n'));
        cm.refresh();
    });
    await page.waitForFunction(() => Object.keys(Graph.nodes).length >= 12, undefined, { timeout: 25000 });
    // Past ZettelkastenProcessor.relaxDelayMs, which debounces the settle so that typing a
    // note does not separate the graph once per keystroke.
    await page.waitForTimeout(1400);

    const state = await page.evaluate(() => {
        const ns = Object.values(Graph.nodes).filter(n => !n.removed);
        let worst = Infinity, overlapping = 0, total = 0;
        for (let i = 0; i < ns.length; i++) {
            for (let j = i + 1; j < ns.length; j++) {
                const a = Graph.planeHalfExtent(ns[i]), b = Graph.planeHalfExtent(ns[j]);
                if (!a || !b) continue;
                total += 1;
                const dx = Math.abs(ns[i].pos.x - ns[j].pos.x), dy = Math.abs(ns[i].pos.y - ns[j].pos.y);
                const r = Math.max(dx / (a.hw + b.hw), dy / (a.hh + b.hh));
                if (r < 1) overlapping += 1;
                worst = Math.min(worst, r);
            }
        }
        return { count: ns.length, overlapping, total, worst };
    });
    assert.ok(state.count >= 12, `twelve notes exist, got ${state.count}`);
    assert.equal(state.overlapping, 0,
        `no pair overlaps on arrival; ${state.overlapping} of ${state.total} did, worst ${state.worst.toFixed(4)}`);
});

// Fit has to leave nothing behind an opaque island, not merely inside the viewport. Two of
// my own arithmetic errors showed up here: a corner island was charged as a full-width band
// (so Fit over-reserved and wasted two thirds of the width), and then the axis reduction
// used `min` where both axes have to be satisfied, which under-reserved and put cards back
// under the toolbar.
test('Fit leaves no card off screen and none behind the chrome', async () => {
    for (const t of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) await addNote(page, t, `Body of ${t}.`);
    await page.waitForTimeout(900);

    for (const size of [{ width: 1600, height: 1000 }, { width: 1280, height: 800 }, { width: 1024, height: 700 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(250);
        await page.click('.hud-btn[data-act="fit"]');
        await page.waitForTimeout(500);

        const state = await page.evaluate(() => {
            const chrome = [...document.querySelectorAll('.tool-bar, .menu-button, .hud-panel')]
                .map(e => e.getBoundingClientRect()).filter(b => b.width);
            const hits = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
            const boxes = Object.values(Graph.nodes).filter(n => !n.removed)
                .map(n => n.view.div.getBoundingClientRect()).filter(b => b.width);
            return {
                cards: boxes.length,
                offscreen: boxes.filter(b => b.left < 0 || b.top < 0 || b.right > window.innerWidth || b.bottom > window.innerHeight).length,
                behindChrome: boxes.filter(b => chrome.some(c => hits(b, c))).length,
            };
        });
        assert.equal(state.offscreen, 0, `nothing off screen at ${size.width}x${size.height}`);
        assert.equal(state.behindChrome, 0, `nothing behind chrome at ${size.width}x${size.height}`);
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
});

// A control that describes something the app does not do. `#button-fullscreen` announced
// itself as "fullscreen" beside a maximize glyph, and its handler moves the camera to the
// card -- it has never resized it, and `style.width` is unchanged after pressing it.
test('the card buttons say what they do', async () => {
    const uuid = await addNote(page, 'Labelled', 'body');
    await page.waitForTimeout(500);

    const labels = await page.evaluate((id) => {
        const div = Graph.nodes[id].view.div;
        return ['button-collapse', 'button-fullscreen', 'button-delete'].map(bid => {
            const b = div.querySelector('#' + bid);
            return { bid, label: b?.getAttribute('aria-label'), tooltip: b?.getAttribute('data-tooltip') };
        });
    }, uuid);

    for (const l of labels) {
        assert.ok(l.label && l.label.length > 4, `${l.bid} has a real name, got "${l.label}"`);
        assert.ok(l.tooltip && l.tooltip.length > 10, `${l.bid} has a tooltip, got "${l.tooltip}"`);
    }
    const fs = labels.find(l => l.bid === 'button-fullscreen');
    assert.doesNotMatch(fs.label, /fullscreen/i, 'it no longer claims to make the card fullscreen');
    assert.match(fs.tooltip, /view/i, 'and says it moves the view');

    // And the behaviour it now describes is what happens: the camera moves, the card does not.
    const before = await page.evaluate((id) => ({
        width: Graph.nodes[id].view.div.style.width, zoom: Graph.zoom.mag(),
    }), uuid);
    const btn = await page.evaluateHandle((id) => Graph.nodes[id].view.div.querySelector('#button-fullscreen'), uuid);
    await btn.asElement().click();
    await page.waitForTimeout(900);
    const after = await page.evaluate((id) => ({
        width: Graph.nodes[id].view.div.style.width, zoom: Graph.zoom.mag(),
    }), uuid);
    assert.equal(after.width, before.width, 'the card was not resized');
    assert.notEqual(after.zoom, before.zoom, 'the view moved');
});

// Escape closes a modal. Nothing did: the close control is a non-focusable span, and the
// menu's Escape handler yields to an open modal on the assumption the modal takes the key.
test('Escape closes a modal', async () => {
    await page.click('#nodeSearchButton');
    await page.waitForFunction(() => !!Modal.current, undefined, { timeout: 5000 });

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !Modal.current, undefined, { timeout: 5000 });
    const shown = await page.evaluate(() => getComputedStyle(Modal.div).display);
    assert.equal(shown, 'none', 'the modal is hidden');
});
