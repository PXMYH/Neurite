import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, openSettings } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Every menu and every dialog in one style (#83, panels.css): asked over a screenshot of the
// AI's options -- ten bevelled chips under bold headings -- "make sure ALL menu and modal styles
// are consistent". The windows `#customModal` shows, the questions and the Settings modal share
// one surface; the right-click menu, a node's actions and every select's list share one menu.

// What makes a box look like the others: its fill, edge, corners, and the title's type.
const look = (page, selector) => page.evaluate((selector) => {
    const el = document.querySelector(selector);
    const cs = getComputedStyle(el);
    return { fill: cs.backgroundColor, edge: cs.borderTopColor, width: cs.borderTopWidth, radius: cs.borderTopLeftRadius,
             bottomRadius: cs.borderBottomLeftRadius };
}, selector);
const titleType = (page, selector) => page.evaluate((selector) => {
    const cs = getComputedStyle(document.querySelector(selector));
    return [cs.fontSize, cs.fontWeight, cs.color].join(' ');
}, selector);
// A bevel is an inset or outset border, or one whose sides are drawn in two greys.
const bevelled = (page) => page.evaluate(() => [...document.querySelectorAll('#customModal .modal-content *')]
    .filter((el) => el.getClientRects().length)
    .filter((el) => {
        const cs = getComputedStyle(el);
        const styles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
        const drawn = styles.map((s, i) => s !== 'none' && parseFloat([cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth][i]) > 0);
        const colours = new Set([cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].filter((_, i) => drawn[i]));
        return styles.some((s) => s === 'inset' || s === 'outset') || (drawn.every(Boolean) && colours.size > 1);
    })
    .map((el) => el.id || el.className || el.tagName));

const TOOLS = ['aiModal', 'apiConfigModalContent', 'importLinkModalContent', 'zetSearchModal', 'vectorDbModal',
               'vectorDbSearchModal', 'vectorDbImportConfirmModal', 'ollamaManagerModal', 'promptLibraryModalContent',
               'neurite-modal', 'proposalsModal'];

test('every tool window has the Settings modal\'s surface, title and close button, and nothing bevelled', async () => {
    await openSettings(page, 'theme');
    const settings = await look(page, '.settings-dialog');
    const settingsTitle = await titleType(page, '#settingsPageTitle');
    await page.keyboard.press('Escape');

    // A finger's size under a coarse pointer, as the questions' buttons are.
    const closeSize = await page.evaluate(() => (matchMedia('(pointer: coarse)').matches ? 40 : 28));
    for (const id of [...TOOLS, 'controls-modal', 'nodeConnectionModal', 'fileTreeModal']) {
        await page.evaluate((id) => {
            if (id === 'controls-modal') return openControlsModal();
            if (id === 'fileTreeModal') return FileTree.openModal();
            if (id === 'nodeConnectionModal') return new Modal.Connect(Object.values(Graph.nodes)[0] ?? createNodeFromWindow('Alpha', 'a'));
            Modal.open(id);
        }, id);
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => Modal.current?.id), id, id + ' did not open');
        assert.deepEqual(await look(page, '#customModal .modal-content'), settings, id + "'s frame is not the Settings modal's");
        assert.equal(await titleType(page, '#modal-title'), settingsTitle, id + "'s title is not set as Settings' is");
        const close = await page.evaluate(() => {
            const b = document.querySelector('#customModal .close');
            const r = b.getBoundingClientRect();
            return [b.tagName, b.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)];
        });
        assert.deepEqual(close, ['BUTTON', 'Close', closeSize, closeSize], id + "'s close is not the Settings modal's button");
        assert.deepEqual(await bevelled(page), [], id + ' still has bevelled parts');
        await page.click('#customModal .close');
    }
    // Closing the Vector Database import cancels it, which its caller is told by a rejection.
    assert.deepEqual(errors.filter((e) => !e.includes('User cancelled the operation')), []);
});

test("the file tree's chosen row is marked, and its path is a field", async () => {
    await page.evaluate(() => FileTree.openModal());
    const seen = await page.evaluate(() => {
        const row = document.createElement('div');
        row.className = 'file-item selected';
        row.textContent = 'notes.md';
        document.querySelector('#customModal .fileTreeContainer').append(row);
        const field = getComputedStyle(document.querySelector('#customModal .modal-filepath-input'));
        return { row: getComputedStyle(row).backgroundColor, field: [field.fontSize, field.borderTopWidth, field.borderRightWidth, field.borderBottomWidth] };
    });
    assert.notEqual(seen.row, 'rgba(0, 0, 0, 0)', 'the chosen file is not marked');
    assert.deepEqual(seen.field, ['13px', '1px', '1px', '1px'], 'the path is not a field like the others');
});

test('the questions are drawn on the same surface, with the same title', async () => {
    await page.evaluate(() => { createNodeFromWindow('Alpha', 'a'); });
    await page.evaluate(() => Modal.open('aiModal'));
    const tool = await look(page, '#customModal .modal-content');
    const toolTitle = await titleType(page, '#modal-title');
    await page.click('#customModal .close');
    for (const ask of ['alert', 'confirm', 'prompt']) {
        await page.evaluate((ask) => { window[ask]('A question?'); }, ask);
        await page.waitForTimeout(250);
        const q = await look(page, '#customModal .modal-content');
        assert.deepEqual([q.fill, q.edge, q.width, q.radius], [tool.fill, tool.edge, tool.width, tool.radius], ask + ' is on another surface');
        assert.equal(await titleType(page, '#modal-title'), toolTitle, ask + "'s title is set otherwise");
        const message = await page.evaluate(() => {
            const text = document.querySelector('#customModal :is(.alert-message, .confirm-message, .modal-prompt-message)');
            const box = document.querySelector('#customModal .modal-prompt-textarea');
            return [getComputedStyle(text).fontSize, box ? getComputedStyle(box).marginTop : null];
        });
        assert.deepEqual(message, ['15px', ask === 'prompt' ? '12px' : null], ask + "'s message is set by the tool windows' rules");
        await page.evaluate(() => Modal.close());
    }
});

test('the AI\'s options are switches in groups, where they were bevelled chips with a tick', async () => {
    await page.evaluate(() => Modal.open('aiModal'));
    const rows = await page.evaluate(() => [...document.querySelectorAll('#customModal .settings-group.checkboxarray label')].map((label) => {
        const track = getComputedStyle(label, '::before');
        return [label.textContent, track.width, track.height];
    }));
    assert.equal(rows.length, 10, 'the ten options are not ten rows');
    for (const [name, width, height] of rows) assert.deepEqual([width, height], ['28px', '16px'], name + ' is not a switch');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#customModal .settings-heading')].map((h) => h.textContent)),
        ['Zettelkasten AI', 'Multi-Agent']);
    // And a switch still sets its checkbox, which the AI reads.
    await page.click('#customModal label[for="forget-checkbox"]');
    assert.equal(await page.evaluate(() => document.querySelector('#customModal #forget-checkbox').checked), true);
});

test('the right-click menu, a node\'s actions and a select\'s list are one menu', async () => {
    const menu = (selector) => page.evaluate((selector) => {
        const el = document.querySelector(selector);
        const cs = getComputedStyle(el);
        return { fill: cs.backgroundColor, edge: cs.borderTopColor, radius: cs.borderTopLeftRadius, pad: cs.paddingTop };
    }, selector);
    // Opened as a right-click opens it; a touch screen has no right button to press.
    await page.evaluate(() => App.menuContext.open(innerWidth - 200, innerHeight - 260, document.getElementById('svg_bg')));
    await page.waitForTimeout(300);
    const canvas = await menu('#customContextMenu');
    const row = await page.evaluate(() => {
        const li = document.querySelector('#customContextMenu li');
        const cs = getComputedStyle(li);
        return [Math.round(li.getBoundingClientRect().height), cs.borderTopLeftRadius, cs.fontSize];
    });
    // 32px, and a finger's 40px under a coarse pointer.
    const rowHeight = await page.evaluate(() => (matchMedia('(pointer: coarse)').matches ? 40 : 32));
    assert.deepEqual(row, [rowHeight, '6px', '14px'], 'a row of the right-click menu is not a menu row');
    // The hover is a wash under the same words, where it was pale blue under black.
    await page.hover('#customContextMenu li').catch(() => {});
    const hovered = await page.evaluate(() => getComputedStyle(document.querySelector('#customContextMenu li')).color);
    assert.notEqual(hovered, 'rgb(0, 0, 0)', 'the hovered row is black text again');
    await page.keyboard.press('Escape');

    const uuid = await page.evaluate(() => { createNodeFromWindow('Alpha', 'a'); return Object.keys(Graph.nodes)[0]; });
    await page.waitForTimeout(500);
    await page.evaluate((id) => {
        const div = Graph.nodes[id].view.div;
        const r = div.getBoundingClientRect();
        App.menuContext.open(r.x + r.width / 2, r.y + 8, div);
    }, uuid);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.suggestions-container')).display !== 'none');
    assert.deepEqual(await menu('.suggestions-container'), canvas, "a node's actions are another kind of menu");
    await page.keyboard.press('Escape');

    await page.evaluate(() => openControlsModal());
    await page.click('#customModal .select-replacer');
    await page.waitForSelector('.options-replacer.show');
    assert.deepEqual(await menu('.options-replacer.show'), canvas, "a select's list is another kind of menu");
});

test('the AI node\'s buttons and settings are the Settings controls, even on a card saved before', async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('AI: Helper\nsummarize\n'));
    await page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.isLLM), undefined, { timeout: 8000 });
    const buttons = () => page.evaluate(() => {
        const node = Object.values(Graph.nodes).find((n) => n.isLLM);
        return ['[id^="prompt-form-"]', '#prompt-form', '#aiNodeSettingsButton'].map((s) => {
            const b = node.content.querySelector(s);
            return [b.getAttribute('style'), b.classList.contains('ai-node-button')];
        });
    });
    assert.deepEqual(await buttons(), [[null, true], [null, true], [null, true]]);

    // A card saved before #83 carries the inline bevel in its markup; the init takes it away.
    await page.evaluate(() => {
        const node = Object.values(Graph.nodes).find((n) => n.isLLM);
        for (const b of node.content.querySelectorAll('.ai-node-button')) {
            b.className = '';
            b.style.cssText = 'border: inset; border-color: #8882; background-color: #222226;';
        }
    });
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.isLLM), undefined, { timeout: 15000 });
    assert.deepEqual(await buttons(), [[null, true], [null, true], [null, true]], 'a restored card kept its bevel');

    // Its gear is pressed while its panel is open.
    const gear = await page.evaluate(() => {
        const node = Object.values(Graph.nodes).find((n) => n.isLLM);
        const b = node.content.querySelector('#aiNodeSettingsButton');
        b.click();
        return [b.getAttribute('aria-pressed'), node.content.querySelector('.ainode-settings-container').style.display];
    });
    assert.deepEqual(gear, ['true', 'grid']);
});

// Found by the second review: Escape while Adjust Controls waited for a key bound "Escape" and
// closed the dialog, and a key pressed after its close button bound that key; a tool opened from
// the keyboard left its tooltip up over the dialog; Neurite's folds took no key at all.
test('the dialogs answer the keyboard: a key being bound, a tool\'s tooltip, a fold', async () => {
    await page.evaluate(() => openControlsModal());
    const was = await page.evaluate(() => controls.shiftKey.value || controls.shiftKey.default);
    await page.click('#customModal #shiftKeyInput');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [Modal.current?.id, controls.shiftKey.value || controls.shiftKey.default,
        document.querySelector('#customModal #shiftKeyInput').innerText]), ['controls-modal', was, was],
        'Escape was bound, or closed the dialog');
    await page.click('#customModal #shiftKeyInput');
    await page.click('#customModal .close');
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => controls.shiftKey.value || controls.shiftKey.default), was,
        'a key pressed after the dialog closed was bound');

    await page.focus('.tool-bar .ai-icon');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => [Modal.current?.id,
        document.querySelector('.ui-tooltip')?.classList.contains('ui-tooltip-visible') ?? false]), ['aiModal', false],
        "the tool's tooltip stayed up over its dialog");
    await page.click('#customModal .close');

    // Opened and wired as `neuritePanel.open` does it, short of asking the server for a balance:
    // off neurite.network that ends in an alert in its place. It opens on Usage.
    await page.evaluate(() => neuritePanel.show());
    const folds = () => page.evaluate(() => ['profilePanel', 'usagePanel'].map((id) => {
        const label = document.querySelector(`#customModal label[for="${id}"]`);
        return [label.tabIndex, label.getAttribute('role'), label.getAttribute('aria-expanded')];
    }));
    assert.deepEqual(await folds(), [[0, 'button', 'false'], [0, 'button', 'true']]);
    await page.focus('#customModal label[for="profilePanel"]');
    await page.keyboard.press('Enter');
    assert.deepEqual(await folds(), [[0, 'button', 'true'], [0, 'button', 'false']], 'Enter did not open the fold');
});

test('menu rows and buttons are a finger\'s size under a coarse pointer, and a select\'s rows are menu rows', async () => {
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const row = coarse ? 40 : 32;
    await page.click('.menu-button');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('#menuList .menu-row').getBoundingClientRect().height)), row);
    await page.click('.menu-button');
    await openSettings(page, 'editing');
    if (coarse) {
        assert.equal(await page.evaluate(() => Math.round(document.querySelector('.settings-nav-item').getBoundingClientRect().height)), 40);
    }
    await page.click('#controls-button');
    await page.click('#customModal .select-replacer');
    await page.waitForSelector('.options-replacer.show');
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.options-replacer.show div').getBoundingClientRect().height)), row,
        "a select's row is not a menu row");
});
