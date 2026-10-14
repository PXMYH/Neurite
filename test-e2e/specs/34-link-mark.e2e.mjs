import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The link mark (#88): a collapsed note whose text holds a web address carries the Link node
// tool's glyph on its circle's lower-right rim, in a disc of the note's colour. A circle showed
// only the title, so a note kept for its link looked like any other.

// Notes written into the Notes text, pinned in a row across the middle of the view, and collapsed.
async function circles(page, text, count) {
    await page.evaluate((text) => window.currentActiveZettelkastenMirror.setValue(text), text);
    await page.waitForFunction((count) => Object.keys(Graph.nodes).length === count, count, { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        // The view held still: a note added flies the view to it (`Autopilot`).
        Autopilot.stop();
        const nodes = Object.values(Graph.nodes);
        nodes.forEach((n, i) => {
            n.pos = Graph.pan.plus(new vec2((i - (nodes.length - 1) / 2) * 0.3, 0));
            n.anchor = n.pos; n.anchorForce = 1;
            n.view.toggleCollapse();
        });
    });
    await page.waitForTimeout(600);
}
// Opens a collapsed note, or collapses an open one.
const toggle = (page, title) => page.evaluate((title) =>
    Object.values(Graph.nodes).find((n) => n.getTitle() === title).view.toggleCollapse(), title);
// How many marks each titled note has.
const marks = (page, titles) => page.evaluate((titles) => titles.map((t) =>
    Object.values(Graph.nodes).find((n) => n.getTitle() === t).view.div.querySelectorAll('.web-link-mark').length), titles);
// A titled note's circle, mark, title and expand button on screen.
const parts = (page, title) => page.evaluate((title) => {
    const n = Object.values(Graph.nodes).find((n) => n.getTitle() === title), v = n.view;
    const box = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, w: r.width }; };
    const mark = v.div.querySelector('.web-link-mark');
    return { circle: box(v.circleCollapsed), mark: box(mark), title: box(v.collapsedTitle), button: box(v.btnExpand),
             fill: mark && getComputedStyle(mark).backgroundColor, colour: Node.colourOf(n) };
}, title);
const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((h) => parseInt(h, 16)).join(', ')})`;

test('what counts as a web link is what GitHub links by itself: http://, https:// or www.', async () => {
    const yes = ['https://github.com/PXMYH/Neurite', 'see http://localhost:8999.', 'the [site](https://example.org)', '<https://a.io>',
        'www.example.com', 'WWW.EXAMPLE.COM/DOCS', '(www.x.io/docs)', 'HTTPS://A.IO'];
    const no = ['notes.md/draft', 'github.com/PXMYH', 'xhttps://a.io', 'https:// a.io', 'http:/a.io', 'awww.cute', 'me@example.com',
        '[[Other note]]', 'ftp://files.example.com', ''];
    const read = (cases) => page.evaluate((cases) => cases.map((s) => NodeView.WEB_LINK.test(s)), cases);
    assert.deepEqual(await read(yes), yes.map(() => true), 'an address went unmarked');
    assert.deepEqual(await read(no), no.map(() => false), 'something that is not an address was marked');
});

test("a collapsed note whose text holds a web address has the mark on its circle's lower-right rim, and one without has none", async () => {
    await circles(page, '## Repo\nSee https://github.com/PXMYH/Neurite for the code.\n\n## Plain\nNo address here.\n\n' +
        '## Docs\nRead www.example.com/docs\n\n## Agent = Model + Harness + Evals\nThe [paper](https://example.org/p).\n\n' +
        '## Near\nnotes.md/draft and xhttps://y\n', 5);
    assert.deepEqual(await marks(page, ['Repo', 'Plain', 'Docs', 'Agent = Model + Harness + Evals', 'Near']), [1, 0, 1, 1, 0]);

    for (const title of ['Repo', 'Agent = Model + Harness + Evals']) {
        const p = await parts(page, title);
        const radius = p.circle.w / 2, dx = p.mark.x - p.circle.x, dy = p.mark.y - p.circle.y;
        // On the rim, half way between its right and its bottom.
        assert.ok(Math.abs(Math.hypot(dx, dy) - radius) <= 2, `${title}: the mark is ${Math.hypot(dx, dy).toFixed(1)} px from the middle, the rim ${radius}`);
        assert.ok(Math.abs(dx - dy) <= 1.5 && dx > 0, `${title}: the mark is not at the lower right (${dx.toFixed(1)}, ${dy.toFixed(1)})`);
        assert.ok(p.mark.t >= p.title.b - 0.5, `${title}: the mark (top ${p.mark.t}) is on the title (bottom ${p.title.b})`);
        assert.equal(p.fill, rgb(p.colour), `${title}: the disc is not in the note's colour`);
    }
    // Clear of the expand button, which shows under the rim while the circle is hovered.
    if (!isIPad) {
        const at = await parts(page, 'Repo');
        await page.mouse.move(at.circle.x, at.circle.y - 10);
        await page.waitForTimeout(250);
        const { mark: m, button: b } = await parts(page, 'Repo');
        const overlap = Math.max(0, Math.min(m.r, b.r) - Math.max(m.l, b.l)) * Math.max(0, Math.min(m.b, b.b) - Math.max(m.t, b.t));
        assert.equal(overlap, 0, 'the mark and the expand button overlap');
    }
    // It grows with the circle.
    const was = (await parts(page, 'Repo')).mark.w;
    await page.evaluate(() => { Object.values(Graph.nodes).find((n) => n.getTitle() === 'Repo').scale = 2 });
    await page.waitForTimeout(300);
    const grown = (await parts(page, 'Repo')).mark.w;
    assert.ok(Math.abs(grown - 2 * was) <= 1, `the mark is ${grown} px on a circle twice the size, from ${was}`);
    // Opened, it goes with the circle; collapsed again, it is back.
    await toggle(page, 'Docs');
    await page.waitForTimeout(200);
    assert.equal((await parts(page, 'Docs')).mark, null, 'an opened note shows the mark');
    await toggle(page, 'Docs');
    await page.waitForTimeout(200);
    assert.ok((await parts(page, 'Docs')).mark, 'the note collapsed again lost its mark');
    assert.deepEqual(errors, []);
});

// The text has writers that send no event, so the mark is kept in step from the frame.
test('the mark follows the Notes text while the note is a circle', async () => {
    await circles(page, '## Repo\nSee https://github.com/PXMYH/Neurite\n\n## Plain\nNo address here.\n', 2);
    assert.deepEqual(await marks(page, ['Repo', 'Plain']), [1, 0]);
    await page.evaluate(() => { const cm = window.currentActiveZettelkastenMirror;
        cm.setValue(cm.getValue().replace('See https://github.com/PXMYH/Neurite', 'See the repository').replace('No address here.', 'Now at www.x.dev')); });
    await page.waitForTimeout(500);
    assert.deepEqual(await marks(page, ['Repo', 'Plain']), [0, 1]);
    assert.deepEqual(errors, []);
});

// The frame is not waited for: a Frames delay holds it back, for up to 30 frames.
test('the mark is right at the collapse itself, before the next frame', async () => {
    await circles(page, '## Repo\nSee https://github.com/PXMYH/Neurite\n\n## Plain\nNo address here.\n', 2);
    const now = await page.evaluate(() => {
        const find = (t) => Object.values(Graph.nodes).find((n) => n.getTitle() === t);
        const count = (t) => find(t).view.div.querySelectorAll('.web-link-mark').length;
        const out = [];
        for (const t of ['Repo', 'Plain']) find(t).view.toggleCollapse();
        // Open, the link moves from one note to the other; no frame runs in between.
        find('Repo').textarea.value = 'See the repository';
        find('Plain').textarea.value = 'Now at https://x.dev';
        for (const t of ['Repo', 'Plain']) { find(t).view.toggleCollapse(); out.push(count(t)); }
        return out;
    });
    assert.deepEqual(now, [0, 1], 'collapsed, a note showed the mark of the text it had before');
    assert.deepEqual(errors, []);
});

// A press on the mark is the circle's: the mark takes no pointer.
test('a click or a tap on the mark with the Connect tool on links the notes and opens neither', async () => {
    await circles(page, '## Alpha\nalpha\n\n## Repo\nSee https://github.com/PXMYH/Neurite\n', 2);
    const a = await parts(page, 'Alpha'), r = await parts(page, 'Repo');
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('class') ?? '', r.mark);
    assert.match(hit, /collapsed-circle/, `a press on the mark lands on "${hit}", not on the circle`);
    const press = (at) => (isIPad ? page.touchscreen.tap(at.x, at.y) : page.mouse.click(at.x, at.y));
    await press(await page.evaluate(() => { const b = document.getElementById('connectTool').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));
    await page.waitForTimeout(200);
    await press(a.circle);
    await page.waitForTimeout(200);
    await press(r.mark);
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => ({
        edges: Object.values(Graph.edges).map((e) => e.pts.map((n) => n.getTitle()).sort().join(' - ')),
        open: Object.values(Graph.nodes).filter((n) => !n.view.div.classList.contains('collapsed')).map((n) => n.getTitle()),
    })), { edges: ['Alpha - Repo'], open: [] });
    assert.deepEqual(errors, []);
});

// A Saved Graph is the markup, mark and all. Restored, the mark comes from the note's text: one
// saved before the mark existed gains it, and one the text has moved on from loses it.
test("a restored note's mark comes from its text, not from the Saved Graph's markup", async () => {
    await circles(page, '## Repo\nSee https://github.com/PXMYH/Neurite\n\n## Plain\nNo address here.\n', 2);
    await page.evaluate(() => {
        const find = (t) => Object.values(Graph.nodes).find((n) => n.getTitle() === t);
        find('Repo').view.div.querySelector('.web-link-mark')?.remove();
        const stale = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        stale.setAttribute('class', 'web-link-mark');
        find('Plain').view.circleCollapsed.append(stale);
        return App.viewGraphs.saveNow();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && Object.keys(Graph.nodes).length === 2, undefined, { timeout: 30000 });
    await page.waitForTimeout(800);
    assert.deepEqual(await marks(page, ['Repo', 'Plain']), [1, 0]);
    assert.deepEqual(errors, []);
});
