import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// A note's card in Pletor's anatomy with a HUD's finish (#77, foundation.css): its kind as a chip
// before its title, its controls only when it is wanted, its prose in a well inset from the
// card, its links as tags in the colours of the Nodes they name, all in the Node's own colour.

const card = (title) => page.evaluate((t) => {
    const node = Object.values(Graph.nodes).find((n) => n.getTitle() === t);
    const div = node.view.div;
    const chips = div.querySelectorAll('.card-kind');
    const wrapper = div.querySelector('.title-input-wrapper');
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return {
        colour: Node.colourOf(node),
        chips: chips.length,
        first: wrapper.firstElementChild?.getAttribute('class'),
        glyph: chips[0]?.querySelector('use')?.getAttribute('xlink:href'),
        stroke: chips[0] && getComputedStyle(chips[0]).getPropertyValue('--icon-stroke').trim(),
        controls: Number(getComputedStyle(div.querySelector('.button-container')).opacity),
        card: box(div), well: box(div.querySelector('.editor-wrapper')),
        wellColour: getComputedStyle(div.querySelector('.editor-wrapper')).backgroundColor,
        brackets: getComputedStyle(div).backgroundImage.split('linear-gradient').length - 1,
        tags: [...div.querySelectorAll('.link-chip')].map((c) => [c.querySelector('.link-chip-label').textContent,
                                                                  c.style.getPropertyValue('--chip-colour')]),
    };
}, title);

// What is on screen, not what a property says: a property can be right while the rule that reads
// it is gone (a review: switching the consumer off left an earlier version of these green). The
// chip is photographed and decoded in the page, and the pixel most like a colour is returned.
const nearestPixel = async (selector, title) => {
    const box = await page.evaluate(([sel, t]) => {
        const node = Object.values(Graph.nodes).find((n) => n.getTitle() === t);
        const r = node.view.div.querySelector(sel).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, [selector, title]);
    const png = (await page.screenshot({ clip: box })).toString('base64');
    return page.evaluate(async ([data, t]) => {
        const node = Object.values(Graph.nodes).find((n) => n.getTitle() === t);
        const want = Node.colourOf(node).slice(1).match(/../g).map((h) => parseInt(h, 16));
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        let best = Infinity;
        for (let i = 0; i < px.length; i += 4) {
            best = Math.min(best, Math.hypot(px[i] - want[0], px[i + 1] - want[1], px[i + 2] - want[2]));
        }
        return Math.round(best);
    }, [png, title]);
};
// `rgb(…)` or `color(srgb …)` -> [r, g, b] in 0-255.
const channels = (css) => {
    const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css);
    if (srgb) return srgb.slice(1).map((v) => Math.round(Number(v) * 255));
    return /rgba?\((\d+), (\d+), (\d+)/.exec(css).slice(1).map(Number);
};

test('a card shows its kind before its title, in its colour, and keeps one chip through a reload', async () => {
    await addNote(page, 'Alpha', 'alpha');
    const first = await card('Alpha');
    assert.deepEqual([first.chips, first.first, first.glyph], [1, 'card-kind', '#note-icon-symbol']);
    // The glyph's copy of the symbol takes its stroke from this property (foundation.css), and
    // the glyph is drawn in it: some pixel of the chip is the Node's colour, give or take its
    // edges' blending.
    assert.equal(first.stroke, first.colour);
    const off = await nearestPixel('.card-kind', 'Alpha');
    assert.ok(off < 40, `no pixel of the chip is near ${first.colour}: the nearest is ${off} away`);

    // A Saved Graph brings back the chip it was saved with; the card makes its own anew.
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && Object.keys(Graph.nodes).length === 1, undefined, { timeout: 30000 });
    const again = await card('Alpha');
    assert.deepEqual([again.chips, again.first, again.stroke], [1, 'card-kind', first.colour]);
    assert.deepEqual(errors, []);
});

test('a card\'s controls wait until it is wanted, where there is a pointer to want it with', async () => {
    await addNote(page, 'Alpha', 'alpha');
    const rest = await card('Alpha');
    // Where nothing hovers, a control that waits for a hover would never be there.
    assert.equal(rest.controls, isIPad ? 0.8 : 0, isIPad ? 'the controls are hidden on a screen with no hover' : 'the controls show at rest');
    if (!isIPad) {
        await page.mouse.move((rest.well.left + rest.well.right) / 2, rest.well.bottom - 6);
        await page.waitForTimeout(300);
        assert.equal((await card('Alpha')).controls, 0.8, 'the controls do not show on hover');
        await page.mouse.move(2, 2);
    }
    await page.evaluate(() => Object.values(Graph.nodes)[0].view.toggleSelected(true));
    await page.waitForTimeout(300);
    assert.equal((await card('Alpha')).controls, 0.8, 'the controls do not show on a selected card');
});

test('the prose sits in an opaque well inset from the card, under three brackets and the grip', async () => {
    await addNote(page, 'Alpha', 'alpha');
    // A resize writes `width: 100%` on the well, which ran it past the card (a review).
    await page.evaluate(() => { Object.values(Graph.nodes)[0].textNodeSyntaxWrapper.style.width = '100%' });
    const c = await card('Alpha');
    for (const side of ['left', 'bottom']) assert.ok(Math.abs(c.well[side] - c.card[side]) >= 8, `the well is flush with the card's ${side}`);
    assert.ok(c.card.right - c.well.right >= 8, "the well is flush with the card's right");
    // Opaque, so an Edge drawn under the card never shows through the prose.
    assert.match(c.wellColour, /^rgb\(/, `the well is ${c.wellColour}`);
    assert.equal(c.brackets, 6, 'three corners carry their brackets');
});

test('a link\'s tag is in the colour of the Node it names', async () => {
    await addNote(page, 'Target', 'named');
    await addNote(page, 'Source', 'It names [[Target]].');
    await page.waitForFunction(() => document.querySelectorAll('.link-chip').length >= 2, undefined, { timeout: 5000 });
    const source = await card('Source');
    const target = await card('Target');
    assert.deepEqual(source.tags, [['Target', target.colour]]);
    assert.deepEqual(target.tags, [['Source', source.colour]]);
    // And the label is drawn in it: 80% of the named Node's colour, 20% white.
    const drawn = await page.evaluate(() => getComputedStyle(document.querySelector('.link-chip-label')).color);
    const [first] = await page.evaluate(() => [...document.querySelectorAll('.link-chip')].map((c) => c.style.getPropertyValue('--chip-colour')));
    const want = first.slice(1).match(/../g).map((h) => Math.round(parseInt(h, 16) * 0.8 + 255 * 0.2));
    channels(drawn).forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= 2, `the tag's label is ${drawn}, not ${want}`));
});

test('a collapsed card is its disc, with no chip and no brackets', async () => {
    await addNote(page, 'Alpha', 'alpha');
    await page.evaluate(() => Object.values(Graph.nodes)[0].view.toggleCollapse());
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
        const div = Object.values(Graph.nodes)[0].view.div;
        return [getComputedStyle(div.querySelector('.card-kind')).display, getComputedStyle(div).backgroundImage];
    });
    assert.deepEqual(state, ['none', 'none']);
});

// A second review: the well stayed 284-340px whatever the card was resized to, leaving a strip
// of card beside it or running out of it; and the collapsed disc sat 22 px below the card's
// centre under the new header's padding (5 px on main).
test('the well follows a resized card both ways, and a collapsed card keeps its disc centred', { skip: isIPad && 'drags the grip with a mouse' }, async () => {
    await addNote(page, 'Alpha', 'alpha');
    const insets = () => page.evaluate(() => {
        const d = Object.values(Graph.nodes)[0].view.div;
        const c = d.getBoundingClientRect(), w = d.querySelector('.editor-wrapper').getBoundingClientRect();
        return [Math.round(w.left - c.left), Math.round(c.right - w.right)];
    });
    const drag = async (dx) => {
        const g = await page.evaluate(() => { const r = Object.values(Graph.nodes)[0].view.div.querySelector('.resize-handle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.mouse.move(g.x, g.y);
        await page.mouse.down();
        await page.mouse.move(g.x + dx, g.y, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
    };
    const [left] = await insets();
    await drag(150);
    assert.deepEqual(await insets(), [left, left], 'a wider card left a strip beside its well');
    await drag(-300);
    assert.deepEqual(await insets(), [left, left], 'a narrower card ran out of its well');

    await page.evaluate(() => Object.values(Graph.nodes)[0].view.toggleCollapse());
    await page.waitForTimeout(500);
    const dy = await page.evaluate(() => {
        const d = Object.values(Graph.nodes)[0].view.div;
        const c = d.getBoundingClientRect(), disc = d.querySelector('.collapsed-circle').getBoundingClientRect();
        return Math.round((disc.top + disc.height / 2) - (c.top + c.height / 2));
    });
    assert.ok(Math.abs(dy) <= 8, `the collapsed disc is ${dy} px off the card's centre`);
});
