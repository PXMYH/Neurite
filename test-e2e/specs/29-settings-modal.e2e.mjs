import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, isIPad, openSettings } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Settings as a modal (#82, js/interface/dropdown/settingsmodal.js), the way Notion's settings
// open: the menu's Settings row brings up one dialog over the page, its pages in a sidebar --
// Notes and Ai among them, which were panels of the menu -- and Esc, a click outside it or its
// close button puts it away again.

const state = (page) => page.evaluate(() => {
    const dialog = document.querySelector('.settings-dialog');
    const active = document.activeElement;
    return {
        open: !document.getElementById('settingsModal').hidden,
        page: document.querySelector('.settings-nav-item[aria-current="page"]')?.dataset.page ?? null,
        title: document.getElementById('settingsPageTitle').textContent,
        menuOpen: document.querySelector('.dropdown-content').classList.contains('open'),
        focus: active.closest('#settingsModal') ? (active.dataset.page ?? active.id ?? active.className)
             : active.classList.contains('menu-button') ? 'menu-button' : active.tagName,
        inert: ['.tool-bar', '.menu-button', '.hud-panel', '#nodes'].map((s) => document.querySelector(s)?.inert),
        name: [dialog.getAttribute('role'), dialog.getAttribute('aria-modal'), dialog.getAttribute('aria-label')],
    };
});
const nodeCount = (page) => page.evaluate(() => Object.keys(Graph.nodes).length);

test('the Settings row opens a dialog over the page, on Notes, with every page in its sidebar', async () => {
    await page.click('.menu-button');
    await page.waitForTimeout(300);
    assert.equal(await page.getAttribute('#settings-button', 'aria-haspopup'), 'dialog');
    await page.click('#settings-button');
    const s = await state(page);
    assert.deepEqual(s.name, ['dialog', 'true', 'Settings']);
    assert.deepEqual([s.open, s.page, s.title, s.menuOpen], [true, 'notes', 'Notes', false],
        'Settings did not open on Notes, or the menu stayed open under it');
    assert.equal(s.focus, 'notes', 'the focus is not on the page shown');
    assert.deepEqual(s.inert, [true, true, true, true], 'the page behind the dialog still takes the keyboard');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.settings-nav-heading')].map((h) => h.textContent)),
        ['Writing', 'View', 'General']);

    // Each page shows its own: Notes and Ai their panels whole, the rest their sections.
    for (const [name, title, shows] of [['ai', 'Ai', '#prompt-form'], ['theme', 'Theme', '#themeGrid'],
                                        ['saved-views', 'Saved views', '#saveCoordinatesBtn'], ['fractal', 'Fractal', '#fractal-select-help'],
                                        ['editing', 'Editing', '#controls-button'], ['data', 'Data', '#clearLocalStorage'],
                                        ['notes', 'Notes', '#zetPaneContainer']]) {
        await page.click(`.settings-nav-item[data-page="${name}"]`);
        const now = await state(page);
        assert.deepEqual([now.page, now.title], [name, title]);
        assert.equal(await page.evaluate((sel) => document.querySelector(sel).closest('.settings-section, .tabcontent')
            .getClientRects().length > 0, shows), true, `${name} does not show ${shows}`);
        // And nothing of the other pages.
        assert.equal(await page.evaluate((name) => [...document.querySelectorAll('#tab5 .settings-section[data-page]')]
            .filter((section) => section.getClientRects().length).some((section) => section.dataset.page !== name), name), false,
            `${name} shows a section of another page`);
    }
    assert.deepEqual(errors, []);
});

test('Esc, a click outside it and its close button each close it, and give the focus back', async () => {
    for (const how of ['Escape', 'outside', 'close']) {
        await openSettings(page, 'theme');
        if (how === 'Escape') await page.keyboard.press('Escape');
        else if (how === 'outside') await page.mouse.click(30, 500);
        else await page.click('#settingsClose');
        const s = await state(page);
        assert.equal(s.open, false, `${how} did not close Settings`);
        assert.equal(s.focus, 'menu-button', `${how} left the focus on ${s.focus}`);
        assert.deepEqual(s.inert, [false, false, false, false], `${how} left the page inert`);
        // The menu closed as Settings opened, and is still closed -- and inert, as it keeps itself.
        assert.equal(await page.evaluate(() => document.querySelector('.dropdown-content').inert), true,
            `${how} left the closed menu reachable`);
    }
    // A click outside it made nothing on the canvas.
    assert.equal(await nodeCount(page), 0, 'the click that closed Settings made a note');
});

test('the sidebar is one Tab stop, and the arrows move through it and choose',
     { skip: isIPad && 'WebKit Tab skips buttons by default' }, async () => {
    await openSettings(page, 'notes');
    await page.focus('.settings-nav-item[data-page="notes"]');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual([(await state(page)).page, (await state(page)).focus], ['ai', 'ai']);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.equal((await state(page)).page, 'data', 'Up from the first page did not wrap to the last');
    // Tab leaves the sidebar for the close button, past no other page.
    await page.keyboard.press('Tab');
    assert.equal((await state(page)).focus, 'settingsClose');
    await page.keyboard.press('Shift+Tab');
    assert.equal((await state(page)).focus, 'data');
});

test('the canvas keeps its keys and its gestures while Settings is open', async () => {
    await openSettings(page, 'data');
    const zoom = await page.evaluate(() => Graph.zoom.mag());
    for (const key of ['1', '2', '0', 't', '+']) await page.keyboard.press(key);
    await page.waitForTimeout(300);
    assert.equal(await nodeCount(page), 0, 'a digit made a note behind Settings');
    assert.equal(await page.evaluate(() => Graph.zoom.mag()), zoom, 'a key zoomed the Graph behind Settings');
    if (!isIPad) {
        const box = await page.evaluate(() => {
            const r = document.getElementById('settingsBody').getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await page.mouse.move(box.x, box.y);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => Graph.zoom.mag()), zoom, 'a wheel over Settings zoomed the Graph');
    }
    assert.equal((await state(page)).open, true);
});

test('Settings opens on the page it was left on, through a reload too', async () => {
    await openSettings(page, 'fractal');
    await page.keyboard.press('Escape');
    await page.click('.menu-button');
    await page.click('#settings-button');
    assert.equal((await state(page)).page, 'fractal');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.click('.menu-button');
    await page.click('#settings-button');
    assert.equal((await state(page)).page, 'fractal');
});

test('a question asked from inside Settings comes up over it, and Esc answers it first', async () => {
    await openSettings(page, 'data');
    await page.click('#clearLocalStorage');
    await page.waitForFunction(() => Modal.current?.id === 'confirmModal', undefined, { timeout: 5000 });
    // On top: the question's own button is what a click there reaches.
    assert.equal(await page.evaluate(() => {
        const r = document.querySelector('#customModal .modal-cancel').getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.classList.contains('modal-cancel');
    }), true, 'the question is under Settings');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.deepEqual([await page.evaluate(() => Modal.current), (await state(page)).open], [null, true],
        'one Escape closed the question and Settings with it');
    await page.keyboard.press('Escape');
    assert.equal((await state(page)).open, false);
});

// Going somewhere on the canvas from Settings -- a Title Cmd- or Ctrl-clicked in the notes, a
// Saved View -- happened behind the dialog, where nothing of it was seen.
test('going to a note or a Saved View from Settings closes it, so the view is seen', async () => {
    await openSettings(page, 'notes');
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\na\n\n## Beta\nSee [[Alpha]].\n'));
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 2, undefined, { timeout: 5000 });
    await page.waitForTimeout(500);
    const pan = () => page.evaluate(() => [Graph.pan.x, Graph.pan.y, Graph.zoom.mag()].map((n) => n.toFixed(6)).join());
    const before = await pan();
    const mention = await page.evaluate(() => {
        const cm = window.currentActiveZettelkastenMirror;
        const at = cm.charCoords({ line: 4, ch: 7 }, 'window');
        return { x: at.left + 2, y: (at.top + at.bottom) / 2 };
    });
    const mod = await page.evaluate(() => (Mod.isCommand ? 'Meta' : 'Control'));
    await page.keyboard.down(mod);
    await page.mouse.click(mention.x, mention.y);
    await page.keyboard.up(mod);
    await page.waitForTimeout(800);
    assert.equal((await state(page)).open, false, 'Settings stayed over the note it went to');
    assert.notEqual(await pan(), before, 'the click did not go to the note');

    await openSettings(page, 'saved-views');
    const at = await pan();
    await page.click(".saved-coordinate-item:has-text('Seahorse Valley West')");
    await page.waitForTimeout(800);
    assert.equal((await state(page)).open, false, 'Settings stayed over the view it went to');
    assert.notEqual(await pan(), at, 'the click did not go to the view');
});

test('in a narrow window Settings takes the window, its sidebar a strip across the top',
     { skip: isIPad && 'the iPad window is its own size' }, async () => {
    await page.setViewportSize({ width: 600, height: 800 });
    await openSettings(page, 'ai');
    const s = await page.evaluate(() => {
        const box = (sel) => document.querySelector(sel).getBoundingClientRect();
        const dialog = box('.settings-dialog'), nav = box('.settings-nav'), body = box('#settingsBody');
        const body2 = document.getElementById('settingsBody');
        return { dialog: [dialog.left, dialog.top, dialog.width, dialog.height].map(Math.round),
                 navAbove: nav.bottom <= body.top + 1, spill: body2.scrollWidth - body2.clientWidth };
    });
    assert.deepEqual(s.dialog, [0, 0, 600, 800]);
    assert.ok(s.navAbove, 'the sidebar is not above the page');
    assert.equal(s.spill, 0, `the Ai page spills ${s.spill}px sideways`);
    await page.keyboard.press('ArrowRight');
    assert.equal((await state(page)).page, 'theme', 'Right did not move along the strip');
});
