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

// ---- found by the Phase 3 UX review ----

// The empty canvas's hint was drawn over the menu, and at 480px every panel meets it below
// about 1376px of window. Drawn under it instead, it was cut in half, reading "title ]] in a
// note to link them" beside the panel.
test('the empty canvas\'s hint is under an open panel, and out of sight while the panel reaches it', async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openMenu(page);
    await openPanel(page, 'Ai');
    await page.waitForTimeout(700);   // the overview's tick, then the hint's fade
    const opacity = () => page.evaluate(() => getComputedStyle(document.querySelector('.canvas-hint')).opacity);
    assert.equal(await opacity(), '0', 'the hint shows beside the panel that cuts it');
    const top = await page.evaluate(() => {
        const elem = document.querySelector('.canvas-hint');
        const hint = elem.getBoundingClientRect();
        const menu = document.querySelector('.dropdown-content').getBoundingClientRect();
        const x = Math.max(hint.left, menu.left) + 4, y = Math.max(hint.top, menu.top) + 4;
        if (x >= Math.min(hint.right, menu.right) || y >= Math.min(hint.bottom, menu.bottom)) return 'apart';
        // The hint takes no pointer, so hit testing passes through it; for the one probe
        // it does, and the hit is whichever of the two is drawn on top.
        elem.style.pointerEvents = 'auto';
        const hit = document.elementFromPoint(x, y);
        elem.style.pointerEvents = '';
        return hit.closest('.dropdown-content') ? 'menu' : hit.closest('.canvas-hint') ? 'hint' : hit.className;
    });
    assert.equal(top, 'menu');
    await page.click('.menu-button');
    await page.waitForTimeout(800);
    assert.equal(await opacity(), '1', 'the hint did not come back when the menu closed');
});

// The side handle sets every panel's width, and a bare `1fr` column grew to the widest
// thing that would not wrap: one long model name made the Ai panel wider than the menu.
test('at the side handle\'s narrowest the Ai panel keeps its right-hand column, with a long model name', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMenu(page);
    await openPanel(page, 'Ai');
    await page.click('#tab4 .dropdown-container:has(#inference-select) .select-replacer');
    await page.click("#tab4 .dropdown-container:has(#inference-select) .dropdown-option:has-text('Groq')");
    await page.click('#tab4 .dropdown-container:has(#groq-select) .select-replacer');
    await page.click("#tab4 .dropdown-container:has(#groq-select) .dropdown-option:has-text('Deepseek R1 distill Llama 70b')");
    await page.click('#menuBackButton');
    await openPanel(page, 'Notes');
    const handle = await page.evaluate(() => {
        const r = document.getElementById('zetHorizDragHandle').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(handle.x - 80 * i, handle.y);
    await page.mouse.up();
    await page.click('#menuBackButton');
    await openPanel(page, 'Ai');
    const box = await menuBox(page);
    assert.ok(box.width < 400, `the drag left the menu ${box.width}px wide`);
    assert.equal(box.spill, 0, `the Ai panel spills ${box.spill}px past a ${box.width}px menu`);
});

test('a Saved View is reached and chosen with the keyboard',
     { skip: isIPad && 'WebKit Tab skips buttons by default' }, async () => {
    await openMenu(page);
    await openPanel(page, 'Views');
    let on = null;
    for (let i = 0; i < 6 && on !== 'saved-coordinate-item'; i++) {
        await page.keyboard.press('Tab');
        on = await page.evaluate(() => document.activeElement.className);
    }
    assert.equal(on, 'saved-coordinate-item', 'Tab never reached a Saved View');
    const zoom = await page.evaluate(() => Graph.zoom.mag());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    assert.deepEqual(await page.evaluate((before) => [document.activeElement.getAttribute('aria-pressed'), Graph.zoom.mag() !== before], zoom),
        ['true', true], 'Enter did not go to the view, or did not select it');
});

// Opening grows the console above its strip, and pushed the strip, which has the focus,
// 460px below the foot of the menu.
test('the console opened from the keyboard keeps its strip in view', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openMenu(page);
    await openPanel(page, 'Ai');
    await page.focus('.function-call-container > .toggle-panel');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const [strip, menu] = await page.evaluate(() => {
        const s = document.querySelector('.function-call-container > .toggle-panel').getBoundingClientRect();
        const m = document.querySelector('.dropdown-content');
        const r = m.getBoundingClientRect();
        return [[s.top, s.bottom], [r.top, r.top + m.clientTop + m.clientHeight]];
    });
    // Its focus ring is drawn 2px out and 2px wide, and was cut in half at the menu's foot.
    assert.ok(strip[0] >= menu[0] && strip[1] + 4 <= menu[1], `the strip is at ${strip}, the menu's visible area at ${menu}`);
});

// With the text clear of the chevron, 130px left 88px for a choice: "Burning Ship", "Middle
// Click" and "Scroll Wheel" ended in an ellipsis, and in the Adjust Controls table the
// values sat centred.
test('every choice in the panels\' and the Adjust Controls selects fits, at the start of its box', async () => {
    await openMenu(page);
    const cut = [];
    const measure = () => page.evaluate(() => {
        const out = [];
        for (const rep of document.querySelectorAll('.select-replacer')) {
            if (!rep.getClientRects().length || rep.closest('.node')) continue;
            const shown = rep.querySelector('.selected-text');
            const select = rep.parentElement.querySelector('select');
            const box = shown.getBoundingClientRect();
            const room = shown.clientWidth - parseFloat(getComputedStyle(shown).paddingLeft) - parseFloat(getComputedStyle(shown).paddingRight);
            const probe = document.createElement('span');
            probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit';
            shown.appendChild(probe);
            for (const option of select.options) {
                probe.textContent = option.text;
                if (probe.getBoundingClientRect().width > room + 0.5) out.push(`${select.id}: ${option.text}`);
            }
            probe.remove();
            const range = document.createRange();
            range.selectNodeContents(shown);
            const start = range.getClientRects()[0]?.left ?? box.left;
            if (Math.abs(start - box.left - parseFloat(getComputedStyle(shown).paddingLeft)) > 1) out.push(`${select.id}: text starts ${Math.round(start - box.left)}px in`);
        }
        return out;
    });
    await openPanel(page, 'Fractal');
    cut.push(...await measure());
    await page.click('#menuBackButton');
    await openPanel(page, 'Settings');
    cut.push(...await measure());
    await page.click('#controls-button');
    await page.waitForTimeout(300);
    cut.push(...await measure());
    assert.deepEqual(cut, []);
});

// One dialog opened from inside another -- an alert from Custom Endpoint -- replaced the body
// that held the focused button before the focus was read, so it went back to `body`.
test('a dialog opened from inside another gives the focus back to what opened the first', async () => {
    await openMenu(page);
    await openPanel(page, 'Ai');
    await page.click('#tab4 .dropdown-container:has(#inference-select) .select-replacer');
    await page.click("#tab4 .dropdown-container:has(#inference-select) .dropdown-option:has-text('Custom')");
    await page.focus('#addApiConfigBtn');
    await page.keyboard.press('Enter');
    await page.click('#customModal .api-modal-button');   // empty: it says what is missing
    assert.equal(await page.evaluate(() => Modal.current?.id), 'alertModal');
    await page.click('#customModal .modal-ok');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'addApiConfigBtn');
});

// The same rule took the keyboard from a reader working beside an open modal: with Search
// Nodes open and the caret in a note, an alert's OK sent the next keystroke to the tool bar.
test('an alert that comes up while the reader writes beside an open modal gives the caret back', async () => {
    await openMenu(page);
    await openPanel(page, 'Notes');
    await page.click('#nodeSearchButton');
    assert.equal(await page.evaluate(() => Modal.current?.id), 'zetSearchModal');
    await page.click('#zetPaneContainer .zet-pane.active .CodeMirror-lines');
    await page.keyboard.type('## Alpha');
    await page.evaluate(() => { window.alert('Something happened.'); });
    await page.click('#customModal .modal-ok');
    await page.keyboard.type('X');
    assert.equal(await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue()), '## AlphaX');
});

// Left by Escape or the ×, an alert, a confirm or a prompt settled nothing: `await
// confirm(...)` never returned.
test('a dialog left by Escape or its × still answers its caller', async () => {
    for (const [ask, leave, expected] of [['confirm', 'Escape', false], ['prompt', 'Escape', null],
                                          ['alert', 'Escape', 'answered'], ['confirm', 'x', false]]) {
        await page.evaluate((ask) => {
            window.answer = 'pending';
            window[ask]('A question?').then((value) => { window.answer = (value === undefined ? 'answered' : value); });
        }, ask);
        await page.waitForTimeout(100);
        if (leave === 'x') await page.click('#customModal .close');
        else {
            await page.focus('#customModal .modal-ok');   // on a button, where the prompt's own Escape is not
            await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.answer), expected, `${ask} left by ${leave}`);
    }
});

// The panels are drawn over the overview, and one that ended just short of its foot left
// Fit, Tidy and Home showing under it as if they were its own.
test('the overview is out of sight under a panel that reaches it, and back when the menu closes',
     { skip: isIPad && 'the iPad window is its own size' }, async () => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openMenu(page);
    await openPanel(page, 'Fractal');
    await page.waitForTimeout(300);
    const seen = () => page.evaluate(() => getComputedStyle(document.querySelector('.hud-panel')).visibility);
    assert.equal(await seen(), 'hidden');
    await page.click('.menu-button');
    await page.waitForTimeout(400);
    assert.equal(await seen(), 'visible');
});
