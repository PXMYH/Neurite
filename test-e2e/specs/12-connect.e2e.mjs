import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, paneText } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// How a reader finds the connect gesture (#50), and what the gesture does once found. It
// was Shift + two clicks and nothing on screen said so; the Connect tool in the pill is
// that mode made visible, and a click on it keeps the mode on without the key.

const tool = (page) => page.evaluate(() => document.getElementById('connectTool').getAttribute('aria-pressed'));
const armed = (page) => page.evaluate(() => Node.prev?.uuid ?? null);
const joined = (page, a, b) => page.evaluate(([a, b]) => Object.values(Graph.edges)
    .some((e) => e.pts.includes(Graph.nodes[a]) && e.pts.includes(Graph.nodes[b])), [a, b]);

// Four notes typed into the pane, which places them apart, by Title.
async function fourNotes(page) {
    await page.evaluate(() => window.currentActiveZettelkastenMirror
        .setValue('## Alpha\na\n\n## Beta\nb\n\n## Gamma\ng\n\n## Delta\nd\n'));
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 4, undefined, { timeout: 5000 });
    await page.waitForTimeout(800);
    return page.evaluate(() => ['Alpha', 'Beta', 'Gamma', 'Delta']
        .map((t) => Object.keys(Graph.nodes).find((k) => Graph.nodes[k].getTitle() === t)));
}

// A point on a card that is the card itself -- the top padding of its header, clear of
// the title field and the buttons -- checked to be on top there, so a press lands on it.
async function cardSpot(page, uuid) {
    const spot = await page.evaluate((id) => {
        const div = Graph.nodes[id].view.div;
        const r = div.getBoundingClientRect();
        const p = { x: r.x + r.width / 2, y: r.y + 3 };
        return { ...p, onTop: div.contains(document.elementFromPoint(p.x, p.y)) };
    }, uuid);
    assert.ok(spot.onTop, 'something covers the card where the test would press it');
    return spot;
}

async function press(page, uuid) {
    const p = await cardSpot(page, uuid);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
}

// The caret in the notes pane, put there by a click as a reader would.
async function caretInPane(page) {
    await page.click('.menu-button');
    await page.click(".menu-row.tablink:has-text('Notes')");
    await page.click('#zetPaneContainer .CodeMirror-lines');
    const inPane = await page.evaluate(() => !!document.activeElement?.closest('.CodeMirror'));
    assert.ok(inPane, 'the caret did not reach the notes pane');
}

test('Shift lights the Connect tool, and a capital typed into the notes pane does not', async () => {
    await page.keyboard.down('Shift');
    assert.equal(await tool(page), 'true', 'Shift on the canvas did not light the Connect tool');
    await page.keyboard.up('Shift');
    assert.equal(await tool(page), 'false');

    await caretInPane(page);
    await page.evaluate(() => {
        window.modeSeen = [];
        On.keydown(window, () => window.modeSeen.push(App.nodeMode));
    });
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyH');
    const mode = await page.evaluate(() => App.nodeMode);
    await page.keyboard.up('Shift');

    // Measured before: the mode went on with the Shift of every capital, which froze the
    // Graph and lit a tool on each one.
    assert.equal(mode, 0, 'typing a capital turned the connect mode on');
    assert.deepEqual(await page.evaluate(() => window.modeSeen.filter(Boolean)), []);
    assert.match(await paneText(page), /H/, 'the capital was not typed');
});

test('Shift held with the caret in the notes pane still connects two Nodes', async () => {
    // The guard above must not cost the gesture: the Shift went to the pane and was not
    // taken as the mode, so the press itself has to say that Shift is down.
    const [, b, c] = await fourNotes(page);
    await caretInPane(page);
    await page.keyboard.down('Shift');
    await press(page, b);
    await press(page, c);
    await page.keyboard.up('Shift');
    assert.ok(await joined(page, b, c), 'Shift + two clicks from the notes pane made no Edge');
});

test('the Connect tool joins Nodes without a key, and Escape turns it off', async () => {
    const [a, b, c, d] = await fourNotes(page);
    await page.click('#connectTool');
    assert.equal(await tool(page), 'true');
    await press(page, a);
    await press(page, b);
    assert.ok(await joined(page, a, b), 'two clicks with the tool on made no Edge');
    assert.equal(await tool(page), 'true', 'the tool turned itself off after one Edge');

    await page.keyboard.press('Escape');
    assert.equal(await tool(page), 'false', 'Escape left the Connect tool on');
    await press(page, c);
    await press(page, d);
    assert.equal(await joined(page, c, d), false, 'the mode outlived the Escape');

    await page.click('#connectTool');
    await page.click('#connectTool');
    assert.equal(await tool(page), 'false', 'a second click did not turn the tool off');
});

test('Escape drops a link armed with Shift', async () => {
    // Armed, a link waited for the next press on any Node, however much later.
    const [a, b] = await fourNotes(page);
    await page.keyboard.down('Shift');
    await press(page, a);
    await page.keyboard.up('Shift');
    assert.equal(await armed(page), a);

    await page.keyboard.press('Escape');
    assert.equal(await armed(page), null, 'Escape left the link armed');
    await press(page, b);
    assert.equal(await joined(page, a, b), false, 'a press after Escape completed the link');
});

test('a modal takes the first Escape, and the Connect tool the next', async () => {
    const [a] = await fourNotes(page);
    await page.click('#connectTool');
    await page.evaluate((id) => Graph.nodes[id].view.div.querySelector('.link-add').click(), a);
    await page.waitForFunction(() => Modal.current?.id === 'nodeConnectionModal');

    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => Modal.current), null, 'Escape did not close the modal');
    assert.equal(await tool(page), 'true', 'one Escape closed the modal and turned the tool off');
    await page.keyboard.press('Escape');
    assert.equal(await tool(page), 'false');
});

// The connect modal, as "+ link" opens it.
const picker = (page) => page.evaluate(() => ({
    query: document.getElementById('connectModalSearchBar')?.value,
    focused: document.activeElement?.id,
    items: [...document.querySelectorAll('#nodeList li')].map((li) => li.textContent),
}));
// The strip is painted from the frame loop, so a card can exist a frame before its "+ link".
const openPicker = async (page, uuid) => {
    await page.waitForFunction((id) => Graph.nodes[id].view.div.querySelector('.link-add'), uuid);
    await page.evaluate((id) => Graph.nodes[id].view.div.querySelector('.link-add').click(), uuid);
    await page.waitForFunction(() => Modal.current?.id === 'nodeConnectionModal');
};

test('"+ link" opens a list of the nearest Nodes, with the caret in its search', async () => {
    // It opened with the Node's own Title as the query and the Node left out of the
    // results, so the list was empty; and the caret was not in the field.
    const [a] = await fourNotes(page);
    const nearest = await page.evaluate((id) => {
        const origin = Graph.nodes[id].pos;
        return Object.values(Graph.nodes).filter((n) => n.uuid !== id)
            .sort((p, q) => p.pos.minus(origin).mag() - q.pos.minus(origin).mag())
            .map((n) => n.getTitle());
    }, a);
    await openPicker(page, a);
    assert.deepEqual(await picker(page),
        { query: '', focused: 'connectModalSearchBar', items: nearest });
});

test('in the list, a Node named by the query comes first, and Enter links it', async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror
        .setValue('## Alpha\na\n\n## Mentions\nsee gamma here\n\n## Gamma\ng\n'));
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 3, undefined, { timeout: 5000 });
    const [a, g] = await page.evaluate(() => ['Alpha', 'Gamma']
        .map((t) => Object.keys(Graph.nodes).find((k) => Graph.nodes[k].getTitle() === t)));
    await openPicker(page, a);
    await page.fill('#connectModalSearchBar', 'gamma');
    assert.deepEqual((await picker(page)).items, ['Gamma', 'Mentions']);
    await page.keyboard.press('Enter');
    assert.ok(await joined(page, a, g), 'Enter did not link the first Node in the list');
});

test("search reads a card's own words, not the links on it", async () => {
    // Every card's strip says "+ link" and names the Nodes it is linked to, and search
    // read the strip: "link" matched every Node, "gamma" each Node linked to Gamma.
    await page.evaluate(() => window.currentActiveZettelkastenMirror
        .setValue('## Alpha\na [[Gamma]]\n\n## Beta\nb\n\n## Gamma\ng\n'));
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, undefined, { timeout: 5000 });
    await page.click('#nodeSearchButton');
    const results = async (term) => {
        await page.fill('#Searchbar', term);
        return page.evaluate(() => [...document.querySelectorAll('#search-results .search-result-title')]
            .map((d) => d.textContent));
    };
    assert.deepEqual(await results('link'), []);
    assert.deepEqual(await results('beta'), ['Beta']);
    // Alpha's prose names Gamma, so it is found; Gamma's chip names Alpha, so it is not.
    assert.deepEqual(await results('alpha'), ['Alpha']);
});

test('a message to the window leaves the connect mode as it was', async () => {
    // Any page in a Link Node can post to this window. `data.nodeMode ?? 0` turned the
    // mode off on each message, and a `null` message threw.
    await page.keyboard.down('Shift');
    await page.evaluate(() => { window.postMessage('hello', '*'); window.postMessage(null, '*'); });
    await page.waitForTimeout(100);
    const mode = await page.evaluate(() => App.nodeMode);
    await page.keyboard.up('Shift');
    assert.equal(mode, 1, 'a message turned the mode off while Shift was held');
    assert.deepEqual(errors, []);
});

// The right-click menus, which named each action by its method: `toggleSelect`,
// `spawnNode`, "toggle direction".
const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#suggestions-container .suggestion-item')]
    .map((d) => d.textContent.trim()));
const menuItems = (page) => page.evaluate(() => [...document.querySelectorAll('#customContextMenu > li.dynamic-option')]
    .map((li) => li.textContent.trim()));
async function rightClick(page, uuid) {
    const p = await page.evaluate((id) => {
        const r = Graph.nodes[id].view.div.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height - 20 };
    }, uuid);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('customContextMenu')).display !== 'none');
}
async function clickIn(page, selector, text) {
    const p = await page.evaluate(([s, t]) => {
        const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t);
        const r = el.getBoundingClientRect();
        return { x: r.x + 12, y: r.y + r.height / 2 };
    }, [selector, text]);
    await page.mouse.click(p.x, p.y);
}

test("a Node's menu names its actions, and a click on one runs it", async () => {
    const [, b] = await fourNotes(page);
    await page.evaluate(() => { window.confirm = async () => true; });
    await rightClick(page, b);
    await page.waitForFunction(() => document.querySelectorAll('#suggestions-container .suggestion-item').length > 0);
    const named = await rows(page);
    assert.ok(named.includes('Delete') && named.includes('Zoom to it'), 'the menu lost its actions: ' + named);
    assert.deepEqual(named.filter((r) => /[a-z][A-Z]/.test(r)), [], 'the menu shows a method name');

    // Measured before: a click on "delete" deleted nothing, and pinned "delete".
    await clickIn(page, '#suggestions-container .suggestion-item', 'Delete');
    await page.waitForFunction((id) => !(id in Graph.nodes), b, { timeout: 5000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('pinnedContextMenuItems')), null);
});

test('the pin keeps an action in the menu without running it', async () => {
    const [, , c] = await fourNotes(page);
    const pin = '#suggestions-container .pin-button[aria-label="Pin Select"]';
    await rightClick(page, c);
    await page.waitForSelector(pin);
    await page.click(pin);
    assert.equal(await page.evaluate(() => App.selectedNodes.uuids.size), 0, 'pinning ran the action');
    assert.equal(await page.getAttribute(pin, 'aria-pressed'), 'true');
    await page.mouse.click(800, 500);

    // Opened again, the pinned action is in the menu, named for what it will do now.
    await rightClick(page, c);
    assert.deepEqual(await menuItems(page), ['Select']);
    await clickIn(page, '#customContextMenu > li.dynamic-option', 'Select');
    assert.deepEqual(await page.evaluate(() => [...App.selectedNodes.uuids]), [c]);
    await rightClick(page, c);
    assert.deepEqual(await menuItems(page), ['Deselect']);
});

test("Enter in a Node's menu runs the first action its search finds", async () => {
    const [a] = await fourNotes(page);
    await page.evaluate(() => { window.confirm = async () => true; });
    await rightClick(page, a);
    await page.click('#customContextMenu .custom-node-method-input');
    await page.keyboard.type('del');
    assert.deepEqual(await rows(page), ['Delete']);
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => !(id in Graph.nodes), a, { timeout: 5000 });
});

test('the Edge menu says what its items do', async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\na\n\n## Beta\nb [[Alpha]]\n'));
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, undefined, { timeout: 5000 });
    await page.waitForTimeout(800);
    const mid = await page.evaluate(() => {
        const [p, q] = Object.values(Graph.edges)[0].pts.map((n) => {
            const r = n.view.div.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    });
    await page.mouse.click(mid.x, mid.y, { button: 'right' });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('customContextMenu')).display !== 'none');
    assert.deepEqual(await menuItems(page), ['Turn the arrow', 'Delete edge']);
    await clickIn(page, '#customContextMenu > li.dynamic-option', 'Delete edge');
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 0, undefined, { timeout: 5000 });
});

test("a Node's menu opened at the bottom of the window stays on it, every action shown", async () => {
    // The menu was placed before it was filled, and a <ul>'s margin moved it 16px more: a
    // pinned action came out at y 908 in a 900px window. The list cut the first two of a
    // note's nine actions off, in a box whose scrollbar is hidden.
    const [a] = await fourNotes(page);
    const height = await page.evaluate(() => innerHeight);
    const onScreen = (top, bottom) => top >= 0 && bottom <= height;
    const measure = () => page.evaluate(() => {
        const m = document.getElementById('customContextMenu').getBoundingClientRect();
        const c = document.getElementById('suggestions-container');
        const s = c.getBoundingClientRect();
        return { menuTop: m.top, menuBottom: m.bottom, listTop: s.top, listBottom: s.bottom,
            clipped: c.scrollHeight > c.clientHeight + 1, rows: c.querySelectorAll('.suggestion-item').length };
    });
    // Put the point the menu opens from `above` pixels over the bottom of the window.
    const openAbove = async (above) => {
        const y = await page.evaluate((id) => {
            const r = Graph.nodes[id].view.div.getBoundingClientRect();
            return r.y + r.height - 20;
        }, a);
        await page.evaluate((dy) => Graph.pan_incBy(toDZ(new vec2(0, dy))), y - (height - above));
        await page.waitForTimeout(400);
        await rightClick(page, a);
    };

    // Too little room below for the menu: it has to open upward, and measure itself to.
    await page.evaluate(() => App.pinnedItems.addItem('zoomTo'));
    await openAbove(25);
    await page.click('#customContextMenu .custom-node-method-input');
    const pinned = await measure();
    assert.ok(onScreen(pinned.menuTop, pinned.menuBottom), 'the menu runs off the window: ' + JSON.stringify(pinned));
    assert.ok(onScreen(pinned.listTop, pinned.listBottom), 'the list runs off the window: ' + JSON.stringify(pinned));
    assert.equal(pinned.rows, 9);
    assert.equal(pinned.clipped, false, 'the list hides some of its actions');
    await page.mouse.click(800, 300);

    // Just enough room below: it opens downward, where the margin would push it out.
    await page.evaluate(() => App.pinnedItems.removeItem('zoomTo'));
    await openAbove(50);
    const bare = await measure();
    assert.ok(onScreen(bare.menuTop, bare.menuBottom), 'the menu runs off the window: ' + JSON.stringify(bare));
});
