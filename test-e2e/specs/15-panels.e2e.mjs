import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The menu's panels (#32). Each sized the menu to itself, so it changed width from one to
// the next (312 to 971px); the Ai and Fractal groups were accordions no keyboard could
// open, and every checkbox was `display: none`, so no keyboard could turn one on.

const PANELS = ['Notes', 'Ai', 'Fractal', 'Views', 'Settings', 'Help'];

async function openMenu(page) {
    await page.click('.menu-button');
    await page.waitForTimeout(300);
}
async function openPanel(page, name) {
    await page.click(`.menu-row.tablink:has-text('${name}')`);
    await page.waitForTimeout(250);
}
const menuBox = (page) => page.evaluate(() => {
    const menu = document.querySelector('.dropdown-content');
    return { width: Math.round(menu.getBoundingClientRect().width), spill: menu.scrollWidth - menu.clientWidth };
});

for (const [width, height] of [[1600, 1000], [1280, 800]]) {
    test(`at ${width}x${height} the list and every panel are one width, and nothing spills sideways`, async () => {
        await page.setViewportSize({ width, height });
        await openMenu(page);
        const list = await menuBox(page);
        const widths = { list: list.width };
        for (const name of PANELS) {
            await openPanel(page, name);
            const box = await menuBox(page);
            widths[name] = box.width;
            assert.ok(box.spill <= 0, `${name} spills ${box.spill}px sideways`);
            await page.click('#menuBackButton');
        }
        assert.deepEqual(new Set(Object.values(widths)).size, 1, 'the menu changes width: ' + JSON.stringify(widths));
        assert.ok(list.width >= 440, `the panels are ${list.width}px, too narrow for two columns`);
    });
}

// WebKit's Tab, like Safari's by default, passes over buttons and checkboxes (Option+Tab
// reaches them), so the walk is a desktop one.
test('a keyboard reaches every control in the Ai panel, and opens API Keys',
     { skip: isIPad && 'WebKit Tab skips buttons and checkboxes by default' }, async () => {
    await openMenu(page);
    await openPanel(page, 'Ai');
    const reached = new Set();
    for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const id = await page.evaluate(() => {
            const el = document.activeElement;
            return el.id || (el.tagName === 'SUMMARY' ? 'summary' : el.getAttribute('aria-label') || el.tagName);
        });
        reached.add(id);
        if (id === 'Function console') break;
    }
    for (const id of ['Inference', 'Embeddings model', 'google-search-checkbox', 'code-checkbox', 'auto-mode-checkbox',
                      'embed-checkbox', 'enable-wolfram-alpha', 'wiki-checkbox', 'max-tokens-slider', 'model-temperature',
                      'max-context-size-slider', 'node-count-slider', 'summary']) {
        assert.ok(reached.has(id), `Tab never reached ${id}: ${[...reached].join(', ')}`);
    }

    await page.focus('#code-checkbox');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => document.getElementById('code-checkbox').checked), true, 'Space did not check it');

    await page.focus('#apiContainer > summary');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.getElementById('api-key-input').getClientRects().length > 0), true,
        'Enter on API Keys did not show the key inputs');
});

test('the folded function console is out of the Tab order, and its toggle is a button', async () => {
    await openMenu(page);
    const state = () => page.evaluate(() => ({
        inert: document.querySelector('.function-call-panel').inert,
        expanded: document.querySelector('.function-call-container > .toggle-panel').getAttribute('aria-expanded'),
    }));
    assert.deepEqual(await state(), { inert: true, expanded: 'false' });
    // At height 0 its prompt was a Tab stop nobody could see.
    assert.equal(await page.evaluate(() => {
        const prompt = document.getElementById('function-prompt');
        prompt.focus();
        return document.activeElement === prompt;
    }), false, 'the folded console takes the focus');

    await page.focus('.function-call-container > .toggle-panel');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert.deepEqual(await state(), { inert: false, expanded: 'true' });
});

test('no label of one or two words wraps in the panels', async () => {
    await openMenu(page);
    const wrapped = [];
    for (const name of ['Ai', 'Fractal', 'Settings']) {
        await openPanel(page, name);
        wrapped.push(...await page.evaluate((panel) => [...document.querySelectorAll('.tabcontent')]
            .filter((tab) => tab.style.display === 'block')
            .flatMap((tab) => [...tab.querySelectorAll('label')])
            .filter((label) => label.getClientRects().length > 0 && !label.querySelector('br')
                && label.textContent.trim().split(/\s+/).length <= 2)
            .filter((label) => {
                const range = document.createRange();
                range.selectNodeContents(label);
                return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
            })
            .map((label) => `${panel}: ${label.textContent.trim()}`), name));
        await page.click('#menuBackButton');
    }
    assert.deepEqual(wrapped, []);
});
