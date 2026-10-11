import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Themes in Settings (#79, js/interface/dropdown/themes.js): named looks for the page, as cards,
// where the Fractal and Views panels were two rows of the menu. A theme sets the colours, the
// universe and the page filters, and nothing else.

async function openSettings(page) {
    await page.click('.menu-button');
    await page.waitForTimeout(300);
    await page.click('#tablink-settings');
    await page.waitForTimeout(200);
}
const chosen = (page) => page.evaluate(() => document.querySelector('#themeGrid input:checked')?.value ?? null);
const cards = (page) => page.evaluate(() => [...document.querySelectorAll('#themeGrid input')].map((i) => i.value));
const pick = (page, id) => page.click(`#themeGrid .theme-card:has(input[value="${id}"])`);

test('the Fractal and Views panels are sections of Settings, and a fresh page wears Neurite', async () => {
    await openSettings(page);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#menuList .tablink .menu-row-label')]
        .map((l) => l.textContent)), ['Notes', 'Ai', 'Settings', 'Help']);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#tab5 .settings-section > .settings-heading')]
        .filter((h) => h.getClientRects().length).map((h) => h.textContent.trim())),
        ['Theme', 'Saved views', 'Fractal', 'Input', 'Zettelkasten', 'Node placement', 'Data']);
    assert.deepEqual(await cards(page), ['neurite', 'ember', 'aurora', 'nebula', 'ink', 'paper'],
        'a page with nothing of its own already offers a Custom card');
    assert.equal(await chosen(page), 'neurite', 'the look a fresh page has is not the Neurite theme');
    assert.deepEqual(errors, []);
});

test('a theme sets the look, recolours the lines on screen, keeps the view and the equation, and survives a reload', async () => {
    const note = await addNote(page, 'Kept where it is', 'a body');
    await page.waitForTimeout(1500);
    assert.ok(note, 'the note was not made');
    const before = await page.evaluate(() => ({ coords: Graph.getCoords(), equation: document.getElementById('fractal-select').value,
        lines: document.querySelectorAll('#bg path[data-original-points]').length }));
    assert.ok(before.lines > 0, 'no Fractal lines were drawn to recolour; this test reads nothing');

    await openSettings(page);
    await pick(page, 'ember');
    const after = await page.evaluate(() => {
        const line = document.querySelector('#bg path[data-original-points]');
        const start = JSON.parse(line.dataset.originalPoints)[0];
        return {
            coords: Graph.getCoords(), equation: document.getElementById('fractal-select').value,
            g: document.getElementById('gColor').value, brightness: document.getElementById('cSlider').value,
            saved: JSON.parse(localStorage.getItem('inputValues')),
            // The line as the colours are now, which before the recolour only a new one was.
            recoloured: line.getAttribute('stroke') === Fractal.color(settings.iterations, new vec2(start)),
        };
    });
    assert.equal(await chosen(page), 'ember');
    assert.deepEqual([after.g, after.brightness], ['#008c00', '150']);
    // All eight, and not only the last: the panel's own save is debounced and keeps one of a burst.
    assert.deepEqual(Object.keys(after.saved).sort(), ['bColor', 'cSlider', 'colorPicker', 'gColor', 'hue-rotation-slider',
                                                       'inversion-slider', 'rColor', 'sSlider']);
    assert.equal(after.recoloured, true, 'the lines on screen keep the old palette');
    assert.deepEqual([after.coords, after.equation], [before.coords, before.equation], 'the theme moved the view or the equation');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForTimeout(600);
    assert.equal(await chosen(page), 'ember', 'the theme was forgotten in a reload');
    assert.deepEqual(errors, []);
});

test('a look of the reader\'s own is Custom, and a theme chosen over it can bring it back', async () => {
    await openSettings(page);
    await page.evaluate(() => {
        const s = document.getElementById('cSlider');
        s.value = '200';
        s.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(100);
    assert.deepEqual([await chosen(page), (await cards(page)).at(-1)], ['custom', 'custom']);

    await pick(page, 'aurora');
    assert.equal(await chosen(page), 'aurora');
    assert.equal((await cards(page)).at(-1), 'custom', 'the look the reader made is gone once a theme replaced it');
    await pick(page, 'custom');
    assert.deepEqual(await page.evaluate(() => document.getElementById('cSlider').value), '200');
    assert.equal(await chosen(page), 'custom');
});

// WebKit's Tab, like Safari's by default, passes over radios as it does buttons and checkboxes.
test('the cards are one radio group: Tab reaches the chosen one, an arrow chooses the next',
     { skip: isIPad && 'WebKit Tab skips radios by default' }, async () => {
    await openSettings(page);
    await page.focus('#themeGrid input:checked');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    assert.equal(await chosen(page), 'ember', 'the arrow did not choose the next theme');
    assert.equal(await page.evaluate(() => document.activeElement.value), 'ember', 'the focus did not go with it');
    assert.equal(await page.evaluate(() => document.getElementById('gColor').value), '#008c00', 'choosing by key did not apply it');
    // The ring is drawn round the picture, the radio being out of sight.
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement.closest('.theme-card')
        .querySelector('.theme-frame')).outlineStyle), 'solid');
});

// Paper inverts the page and turns it half the hue wheel, and the menu is under that filter too:
// each picture undoes the page's filters, so a dark theme still looks dark while Paper is on.
test('Paper turns the page light, and every picture still shows its own theme', async () => {
    await openSettings(page);
    await pick(page, 'paper');
    const s = await page.evaluate(() => ({
        page: document.getElementById('invert-filter').style.backdropFilter,
        universe: document.getElementById('universe-checkbox').checked,
        neurite: document.querySelector('#themeGrid input[value="neurite"]').closest('label').querySelector('svg').style.filter,
        paper: document.querySelector('#themeGrid input[value="paper"]').closest('label').querySelector('svg').style.filter,
    }));
    assert.equal(s.page, 'invert(100%) hue-rotate(180deg)');
    assert.equal(s.universe, false);
    assert.equal(s.neurite, 'invert(0%) hue-rotate(0deg) hue-rotate(-180deg) invert(100%)');
    assert.equal(s.paper, 'invert(100%) hue-rotate(180deg) hue-rotate(-180deg) invert(100%)');
});
