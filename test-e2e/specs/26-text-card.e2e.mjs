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

test('a card shows its kind before its title, in its colour, and keeps one chip through a reload', async () => {
    await addNote(page, 'Alpha', 'alpha');
    const first = await card('Alpha');
    assert.deepEqual([first.chips, first.first, first.glyph], [1, 'card-kind', '#note-icon-symbol']);
    // The glyph's copy of the symbol takes its stroke from this property (foundation.css).
    assert.equal(first.stroke, first.colour);

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
