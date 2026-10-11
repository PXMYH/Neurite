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
            // The line as the colours are now, which before the recolour only a new one was, and
            // repainted from the index it keeps rather than traced again.
            recoloured: line.getAttribute('stroke') === Fractal.color(settings.iterations, new vec2(start)),
            kept: /^[oi]-?[\d.e+-]+$/.test(line.dataset.colour ?? ''),
        };
    });
    assert.equal(await chosen(page), 'ember');
    assert.deepEqual([after.g, after.brightness], ['#008c00', '150']);
    // All eight, and not only the last: the panel's own save is debounced and keeps one of a burst.
    assert.deepEqual(Object.keys(after.saved).sort(), ['bColor', 'cSlider', 'colorPicker', 'gColor', 'hue-rotation-slider',
                                                       'inversion-slider', 'rColor', 'sSlider']);
    assert.equal(after.recoloured, true, 'the lines on screen keep the old palette');
    assert.equal(after.kept, true, 'a line keeps no colour index to be repainted from');
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

// Found by a review: a theme is its colours and its universe, and a graph kept only the colours.
test('a graph keeps its theme\'s universe with its colours', async () => {
    await openSettings(page);
    await pick(page, 'paper');
    await page.evaluate(() => App.viewGraphs.saveNow());
    // The page's own choice says on, as it would after another graph switched it back on.
    await page.evaluate(() => localStorage.setItem('universe', 'on'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => document.getElementById('universe-checkbox').checked), false,
        'the graph came back with its colours and the universe on');
    assert.equal(await chosen(page), 'paper');
});

test('a number typed beside a slider is saved, and moves the mark', async () => {
    await openSettings(page);
    await page.evaluate(() => { document.getElementById('colorSettingsContainer').open = true; });
    await page.fill('#c_value', '200');
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => ({ slider: document.getElementById('cSlider').value,
        saved: JSON.parse(localStorage.getItem('inputValues') ?? '{}').cSlider }));
    assert.deepEqual(s, { slider: '200', saved: '200' }, 'the typed brightness was not saved');
    assert.equal(await chosen(page), 'custom', 'the mark stayed on a theme the colours no longer are');
});

test('Reset puts the theme back to Neurite, and a hue of 360 is no turn at all', async () => {
    await openSettings(page);
    await pick(page, 'ember');
    await page.click('#resetSettings');
    await page.waitForTimeout(200);
    assert.equal(await chosen(page), 'neurite', 'Reset left the theme as it was');

    await page.evaluate(() => {
        const s = document.getElementById('hue-rotation-slider');
        s.value = '360';
        s.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(100);
    assert.equal(await chosen(page), 'neurite', 'a full turn of the hue reads as a look of its own');
});

// A partial inversion squeezes the whole page, the menu with it, into a narrower band of
// grey. A picture under it cannot show more than the band, but it should fill it: the dark
// theme's corner is as dark as the page lets anything be, not lighter.
test('under a partial inversion a dark theme\'s picture is as dark as the page allows', async () => {
    await openSettings(page);
    await page.evaluate(() => {
        const s = document.getElementById('inversion-slider');
        s.value = '25';
        s.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
        const r = document.querySelector('#themeGrid input[value="neurite"]').closest('label')
            .querySelector('.theme-frame').getBoundingClientRect();
        // Its top left corner, where no line and none of the sky is drawn: the page's colour.
        return { x: Math.round(r.left + 3), y: Math.round(r.top + 3), width: 2, height: 2 };
    });
    const png = (await page.screenshot({ clip: box })).toString('base64');
    const level = await page.evaluate(async (data) => {
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return Math.round((r + g + b) / 3);
    }, png);
    // The page's black at 25% is 64; inverting the picture at 25% again, as it was, gave 96.
    assert.ok(level <= 75, `the dark theme's picture is ${level} of 255 where the page's darkest is 64`);
    assert.match(await page.evaluate(() => document.querySelector('#themeGrid input[value="neurite"]')
        .closest('label').querySelector('svg').style.filter), /contrast\(2\)/);
});
