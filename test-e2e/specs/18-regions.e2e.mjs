import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Where the notes of an imported bundle sit on the Plane (#73): each Archive in a Region of
// its own, a disk inside one of the Mandelbrot set's primary bulbs, named on the Plane, and a
// place as well as a text -- picking the Archive goes there, and a note made there is its.
const BUNDLE = fileURLToPath(new URL('../fixtures/notes-bundle', import.meta.url));

async function importBundle(page) {
    await page.click('.menu-button');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#import-notes-button');
    await (await chooser).setFiles(BUNDLE);
    await page.waitForFunction(() => Modal.current?.id === 'alertModal', undefined, { timeout: 30000 });
    await page.click('#customModal .modal-ok');
    await page.waitForTimeout(600);
}
const regions = (page) => page.evaluate(() => window.zetPaneList.map((pane) => {
    const nodes = [];
    pane.processor.forEachNodeWrap((wrap) => nodes.push(wrap.node));
    return {
        name: App.zetPanes.getPaneName(pane.paneId), paneId: pane.paneId, region: ZetRegions.of(pane.paneId),
        nodes: nodes.map((n) => ({ title: n.getTitle(), x: n.pos.x, y: n.pos.y, scale: n.scale, pinned: n.anchorForce === 1 })),
    };
}));
// A point of the Plane on screen, as `Node.draw` places a card.
const onScreen = (page, z) => page.evaluate(({ x, y }) => {
    const uv = fromZtoUV(new vec2(x, y));
    const box = svg.getBoundingClientRect();
    const w = Math.min(box.width, box.height), off = box.width < box.height ? box.right : box.bottom;
    return { x: uv.x * w - (off - box.right) / 2, y: uv.y * w - (off - box.bottom) / 2 };
}, z);

test('each Archive of an imported bundle has a Region of its own, its notes pinned inside it', async () => {
    await importBundle(page);
    const all = await regions(page);
    assert.equal(all.length, 4);
    for (const a of all) {
        assert.ok(a.region, `${a.name} has no Region`);
        for (const n of a.nodes) {
            assert.ok(Math.hypot(n.x - a.region.x, n.y - a.region.y) <= a.region.r, `${n.title} is outside ${a.name}'s Region`);
            assert.equal(n.pinned, true, `${n.title} drifts`);
            assert.ok(Math.abs(n.scale - a.region.s) < 1e-9, `${n.title} is not at its Region's scale`);
        }
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const [p, q] = [all[i].region, all[j].region];
        assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > p.r + q.r - 1e-9, `${all[i].name} and ${all[j].name} overlap`);
    }
    // The larger Archive in the larger bulb: Harnesses and Learning hold two notes each.
    const r = Object.fromEntries(all.map((a) => [a.name, a.region.r]));
    assert.ok(r.Harnesses > r.Agents && r.Learning > r.Agents, JSON.stringify(r));
    // Where they were put, three seconds on: the arrival settle gathered new cards into view,
    // which pulled an imported block out of its bulb.
    await page.waitForTimeout(3000);
    assert.deepEqual((await regions(page)).map((a) => a.nodes), all.map((a) => a.nodes));
    assert.deepEqual(errors, []);
});

test('a Region is named on the Plane, and picking its Archive frames it', async () => {
    // A laptop's window, where the Notes panel takes a third of it.
    if (!isIPad) await page.setViewportSize({ width: 1100, height: 720 });
    await importBundle(page);
    await page.click(".menu-row.tablink:has-text('Notes')");
    await page.click('.archive-choice .select-replacer');
    await page.click(".archive-choice .dropdown-option:has-text('Harnesses')");
    await page.waitForTimeout(600);
    const view = await page.evaluate(() => {
        const pane = window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Harnesses');
        const r = ZetRegions.of(pane.paneId);
        const panel = document.querySelector('.dropdown-content').getBoundingClientRect();
        const cards = [];
        pane.processor.forEachNodeWrap((wrap) => cards.push(wrap.node.view.div.getBoundingClientRect()));
        return { r, pan: [Graph.pan.x, Graph.pan.y], zoom: Graph.zoom.mag(), panelRight: panel.right,
            cards: cards.map((c) => ({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })), w: innerWidth, h: innerHeight };
    });
    // Its block of cards fills the view, beside the Notes panel it was picked from and not
    // under it: the disk was framed, from the middle of the window, half under the panel (rv8).
    assert.ok(Math.hypot(view.pan[0] - view.r.x, view.pan[1] - view.r.y) < view.r.r, 'the view is not on the Region');
    for (const c of view.cards) {
        assert.ok(c.left >= view.panelRight && c.right <= view.w && c.top >= 0 && c.bottom <= view.h,
            'a card is off screen or under the Notes panel: ' + JSON.stringify({ c, panelRight: view.panelRight }));
    }
    assert.ok(Math.max(...view.cards.map((c) => c.right - c.left)) > 0.15 * (view.w - view.panelRight), 'the cards are too small to read');

    await page.click('.menu-button');
    await page.waitForTimeout(400);
    const label = await page.evaluate(() => [...document.querySelectorAll('.region-label')]
        .filter((l) => !l.hidden).map((l) => l.textContent));
    assert.ok(label.includes('Harnesses'), `the Region is not named: ${label}`);
});

test('a note made by double-click in a Region is its Archive\'s, at its scale', async () => {
    await importBundle(page);
    await page.click('.menu-button');   // closed, so the canvas takes the double-click
    const target = await page.evaluate(() => {
        const pane = window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Learning');
        ZetRegions.frame(pane.paneId);
        const r = ZetRegions.of(pane.paneId);
        return { paneId: pane.paneId, x: r.x, y: r.y + r.r * 0.8, s: r.s };
    });
    await page.waitForTimeout(400);
    const at = await onScreen(page, target);
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = 'none'; });
    await page.mouse.dblclick(at.x, at.y);
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = ''; });
    await page.waitForTimeout(800);
    const made = await page.evaluate((paneId) => {
        const pane = window.zetPaneList.find((p) => p.paneId === paneId);
        const titles = [];
        let scale = null;
        pane.processor.forEachNodeWrap((wrap) => {
            titles.push(wrap.node.getTitle());
            if (!['RAG', 'Learning/Courses'].includes(wrap.node.getTitle())) scale = wrap.node.scale;
        });
        return { count: titles.length, scale };
    }, target.paneId);
    assert.equal(made.count, 3, 'the note went into another Archive');
    assert.ok(Math.abs(made.scale - target.s) < 1e-9, `the note is at scale ${made.scale}, its Region's is ${target.s}`);
});

test('a note typed into a Region\'s Archive lands in the Region, at its scale', async () => {
    await importBundle(page);
    const typed = await page.evaluate(async () => {
        const pane = window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Agents');
        pane.processor.writeAs(ZettelkastenProcessor.Pass.edit,
            () => pane.cm.replaceRange('\n## Typed Here\nIts body.\n', { line: pane.cm.lastLine() }));
        await new Promise((r) => setTimeout(r, 1200));
        const node = Object.values(Graph.nodes).find((n) => n.getTitle() === 'Typed Here');
        const r = ZetRegions.of(pane.paneId);
        return { scale: node.scale, s: r.s, inside: Math.hypot(node.pos.x - r.x, node.pos.y - r.y) <= r.r };
    });
    assert.ok(Math.abs(typed.scale - typed.s) < 1e-9, JSON.stringify(typed));
    assert.equal(typed.inside, true, 'the note left its Region');
});

test('the Regions come back with the graph, and a new graph starts with the default Saved Views', async () => {
    await importBundle(page);
    const before = (await regions(page)).map((a) => [a.name, a.region]);
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => window.zetPaneList.length === 4, undefined, { timeout: 15000 });
    await page.waitForTimeout(800);
    assert.deepEqual((await regions(page)).map((a) => [a.name, a.region]), before);

    // A Saved View stored in this graph is this graph's: Clear kept it for the next.
    const views = () => page.evaluate(() => [...document.querySelectorAll('#savedCoordinatesContainer .saved-coordinate-item')].map((b) => b.textContent));
    const defaults = await views();
    await page.evaluate(() => {
        savedViews.mandelbrot.push({ title: 'Stored here', standardCoords: Graph.getCoords(), functionCall: Graph.getCoords(true) });
        updateSavedViewsCache();
        displaySavedCoordinates();
    });
    assert.ok((await views()).includes('Stored here'));
    await page.click('.menu-button');
    await page.click('#clear-button');
    await page.click('#customModal .modal-ok');
    await page.waitForTimeout(800);
    assert.deepEqual(await views(), defaults, 'the new graph kept the last graph\'s Saved View');
});

// A double-click on the Plane beside the Regions makes a note at the size of the view, and its
// separation from the others moved 28 of the bundle's pinned cards and pushed 8 out of their
// Regions (rv8). A Region's cards hold still; the newcomer moves.
test('a note made outside every Region moves none of the Regions\' cards', async () => {
    await importBundle(page);
    await page.click('.menu-button');
    await page.evaluate(() => Hud.fitAll());
    await page.waitForTimeout(400);
    // Just past the edge of the largest Region, where a note the size of the view lands on it.
    const z = await page.evaluate(() => {
        const pane = window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Harnesses');
        const r = ZetRegions.of(pane.paneId);
        const z = { x: r.x + r.r * 1.05, y: r.y };
        return ZetRegions.at(z) === null ? z : null;
    });
    assert.ok(z, 'the point is in a Region');
    const before = await regions(page);
    const at = await onScreen(page, z);
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = 'none'; });
    await page.mouse.dblclick(at.x, at.y);
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = ''; });
    await page.waitForTimeout(1500);
    const after = await regions(page);
    assert.ok(after.reduce((n, a) => n + a.nodes.length, 0) > before.reduce((n, a) => n + a.nodes.length, 0), 'no note was made');
    for (const a of before) {
        const now = after.find((x) => x.paneId === a.paneId);
        for (const n of a.nodes) {
            const m = now.nodes.find((x) => x.title === n.title);
            assert.ok(Math.hypot(m.x - n.x, m.y - n.y) < 1e-9, `${n.title} of ${a.name} moved`);
        }
    }
});

// Fit measured the cards at the size they arrived at, before they were drawn at their Region's
// scale: the import's own view came out 1.36 times too wide (rv8).
test('the import frames its notes as Fit does', async () => {
    await importBundle(page);
    const imported = await page.evaluate(() => Graph.zoom.mag());
    const fitted = await page.evaluate(() => { Hud.fitAll(); return Graph.zoom.mag(); });
    assert.ok(Math.abs(imported / fitted - 1) < 0.08, `imported at |zoom| ${imported}, Fit says ${fitted}`);
});

// Put 0.72 radii up the Plane, the name was under the block with the view turned half round.
test('a Region\'s name is over its block whichever way the view is turned', async () => {
    await importBundle(page);
    await page.click('.menu-button');
    for (const turn of [0, Math.PI / 2, Math.PI / 2]) {
        const seen = await page.evaluate((t) => {
            Graph.zoom_cmultWith(new vec2(Math.cos(t), Math.sin(t)));
            const pane = window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Harnesses');
            ZetRegions.frame(pane.paneId);
            return new Promise((resolve) => setTimeout(() => {
                const label = ZetRegions.labels.get(pane.paneId);
                const lb = label.getBoundingClientRect();
                let top = Infinity;
                pane.processor.forEachNodeWrap((w) => { top = Math.min(top, w.node.view.div.getBoundingClientRect().top); });
                resolve({ hidden: label.hidden, bottom: lb.bottom, top });
            }, 400));
        }, turn);
        assert.equal(seen.hidden, false, 'the name is not drawn');
        assert.ok(seen.bottom <= seen.top + 1, 'the name is not over the block: ' + JSON.stringify(seen));
    }
});
