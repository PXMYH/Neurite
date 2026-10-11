import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

// The Mac app's updates (#76, js/interface/dropdown/appupdate.js), a section of Settings since
// #78, against a stand-in for the bridge the app's preload gives the page (desktop/preload.cjs).
// The app's side -- the download, the swap and the reopening -- is driven for real by
// desktop/update.e2e.mjs.

let browser, context;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
afterEach(async () => { await context?.close(); });

// What the preload exposes, recording each call, with `__update.push` standing for the main
// process sending a new state.
const bridge = (first) => (ctx) => ctx.addInitScript((state) => {
    const listeners = [];
    window.__update = { calls: [], push: (s) => listeners.forEach((cb) => cb(s)) };
    window.neuriteDesktop = { update: {
        state: async () => state,
        check: async () => { window.__update.calls.push('check') },
        install: async (choice) => {
            window.__update.calls.push('install ' + JSON.stringify(choice));
            if (window.__update.refuse) throw new Error('no handler');
        },
        onState: (cb) => { listeners.push(cb) },
    } };
}, first);

const read = (page) => page.evaluate(() => {
    const row = document.getElementById('update-button');
    const note = document.getElementById('update-note');
    const button = document.querySelector('.menu-button');
    const settings = document.getElementById('tablink-settings');
    return { shown: row.getClientRects().length > 0, label: row.querySelector('.menu-row-label').textContent,
             note: note.textContent, warning: note.classList.contains('is-warning'),
             ready: button.classList.contains('update-ready'), name: button.getAttribute('aria-label'),
             settingsDot: settings.classList.contains('update-ready'), settingsName: settings.getAttribute('aria-label'),
             calls: [...(window.__update?.calls ?? [])] };
});
// The menu, then its Settings row, where the button is.
async function openSettings(page) {
    await page.click('.menu-button');
    await page.waitForTimeout(300);
    await page.click('#tablink-settings');
    await page.waitForTimeout(200);
}
const push = (page, state) => page.evaluate((s) => window.__update.push(s), state);
const available = { phase: 'available', current: '1.6.0', version: '1.7.0', page: 'https://example.com', blocked: null };

test('a browser has no Updates in Settings', async () => {
    let page;
    ({ context, page } = await openNeurite(browser));
    await openSettings(page);
    assert.deepEqual(await page.evaluate(() => [document.getElementById('updateSettings').getClientRects().length,
                                               document.getElementById('update-button').getClientRects().length,
                                               document.getElementById('update-note').getClientRects().length]), [0, 0, 0]);
    // And the list it came from has no row for them.
    assert.equal(await page.evaluate(() => document.querySelector('#menuList #update-button')), null);
});

test('the row checks, says what it found, and asks before it installs', async () => {
    let page;
    ({ context, page } = await openNeurite(browser, { setup: bridge({ phase: 'current', current: '1.6.0' }) }));
    await openSettings(page);
    const current = await read(page);
    assert.deepEqual([current.shown, current.label, current.note, current.ready, current.settingsDot],
                     [true, 'Check for updates', 'Neurite 1.6.0 is the newest.', false, false]);
    // First in the panel, where the dot that led here is answered.
    assert.equal(await page.evaluate(() => document.querySelector('#tab5 .settings-section').id), 'updateSettings');
    await page.click('#update-button');
    assert.deepEqual((await read(page)).calls, ['check']);

    // Found by the six-hourly check, with the menu closed: the menu button says so, and so does
    // the Settings row it leads to.
    await page.click('.menu-button');
    await push(page, available);
    const found = await read(page);
    assert.deepEqual([found.label, found.ready, found.name, found.settingsDot, found.settingsName],
                     ['Update to 1.7.0', true, 'Menu, with an update ready', true, 'Settings panel, with an update ready']);

    await openSettings(page);
    await page.click('#update-button');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => Modal.div.querySelector('.modal-title').textContent), 'Update to Neurite 1.7.0?');
    assert.deepEqual((await read(page)).calls, ['check'], 'it installed before the reader answered');
    await page.click('.modal-ok');
    assert.deepEqual((await read(page)).calls, ['check', 'install {"version":"1.7.0","confirmed":true}']);
});

test('a busy row does nothing, a failure is a warning, and a release it cannot install opens its page', async () => {
    let page;
    ({ context, page } = await openNeurite(browser, { setup: bridge(available) }));
    await openSettings(page);
    await push(page, { phase: 'downloading', current: '1.6.0', version: '1.7.0', progress: 42 });
    const busy = await read(page);
    assert.deepEqual([busy.label, busy.note, busy.ready, busy.settingsDot, busy.settingsName],
                     ['Updating to 1.7.0…', 'Downloading, 42%.', false, false, null]);
    await page.evaluate(() => document.getElementById('update-button').click());
    assert.deepEqual((await read(page)).calls, [], 'a click while it downloads did something');

    await push(page, { phase: 'failed', current: '1.6.0', version: '1.7.0',
                       error: '1.7.0 did not install: the download does not match its release. Neurite 1.6.0 is unchanged.' });
    const failed = await read(page);
    assert.deepEqual([failed.label, failed.warning], ['Check for updates', true]);

    // No confirm: nothing closes, the release's page opens in the browser.
    await push(page, { ...available, blocked: 'translocated' });
    const blocked = await read(page);
    assert.equal(blocked.label, 'Download 1.7.0…');
    assert.match(blocked.note, /Move Neurite to Applications/);
    assert.equal(blocked.ready, false, 'the button promises an update the app cannot make');
    await page.click('#update-button');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => Boolean(Modal.current)), false, 'it asked before opening a page');
    assert.deepEqual((await read(page)).calls, ['install {"version":"1.7.0","confirmed":false}']);
});

// A call the main process cannot answer said nothing, and the row went on offering an update.
test('an update the app could not start is said in the note', async () => {
    let page;
    ({ context, page } = await openNeurite(browser, { setup: bridge(available) }));
    await openSettings(page);
    await page.evaluate(() => { window.__update.refuse = true });
    await page.click('#update-button');
    await page.click('.modal-ok');
    await page.waitForFunction(() => document.getElementById('update-note').classList.contains('is-warning'));
    const after = await read(page);
    assert.deepEqual([after.label, after.note, after.ready], ['Check for updates', 'The update could not be started. Try again.', false]);
});
