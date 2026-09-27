import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, paneText, isIPad } from './helpers.mjs';

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
// A press on bare canvas, which closes a menu. Found rather than assumed: on an iPad's
// smaller window a fixed point landed on the open list and ran one of its actions.
async function clickEmpty(page) {
    const p = await page.evaluate(() => {
        for (let y = 120; y < innerHeight - 120; y += 40) {
            for (let x = 120; x < innerWidth - 120; x += 40) {
                if (document.elementFromPoint(x, y)?.id === 'svg_bg') return { x, y };
            }
        }
        return null;
    });
    assert.ok(p, 'no bare canvas to press on');
    await page.mouse.click(p.x, p.y);
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
    await clickEmpty(page);

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
    await clickEmpty(page);

    // Just enough room below: it opens downward, where the margin would push it out.
    await page.evaluate(() => App.pinnedItems.removeItem('zoomTo'));
    await openAbove(50);
    const bare = await measure();
    assert.ok(onScreen(bare.menuTop, bare.menuBottom), 'the menu runs off the window: ' + JSON.stringify(bare));
});

// ---- found by the Phase 2 reviews ----

// The middle of a card's body, which is most of the card, and is a textarea.
const bodySpot = (page, uuid) => page.evaluate((id) => {
    const r = Graph.nodes[id].view.div.querySelector('.editable-div').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, uuid);
async function pressAt(page, p) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
}
const caretInBody = (page) => page.evaluate(() => !!document.activeElement?.classList?.contains('editable-div'));

test("a press on a note's body arms and finishes a link, and selects, as its header does", async () => {
    // The body kept every press for its text: measured, 0 of 48 points on a body armed a
    // link, Shift + click on two bodies made no Edge, and Cmd + click selected nothing.
    const [a, b, c, d] = await fourNotes(page);
    await page.click('#connectTool');
    await pressAt(page, await bodySpot(page, a));
    assert.equal(await armed(page), a, 'a press on the body armed nothing');
    assert.equal(await caretInBody(page), false, 'the press put the caret in the text');
    await pressAt(page, await bodySpot(page, b));
    assert.ok(await joined(page, a, b), 'the Connect tool made no Edge from body to body');
    await page.click('#connectTool');

    await page.keyboard.down('Shift');
    await pressAt(page, await bodySpot(page, c));
    await pressAt(page, await bodySpot(page, d));
    await page.keyboard.up('Shift');
    assert.ok(await joined(page, c, d), 'Shift + a press on two bodies made no Edge');

    const mod = await page.evaluate(() => (Mod.isCommand ? 'Meta' : 'Control'));
    await page.keyboard.down(mod);
    await pressAt(page, await bodySpot(page, a));
    await page.keyboard.up(mod);
    assert.deepEqual(await page.evaluate(() => [...App.selectedNodes.uuids]), [a], 'Mod + a press on the body selected nothing');
});

test('a link is finished by a click and not by a drag, and turning the tool off drops it', async () => {
    const [a, b, c] = await fourNotes(page);
    await page.click('#connectTool');
    await press(page, a);
    // A drag from another card moves it and finishes nothing.
    const p = await cardSpot(page, c);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 120, p.y + 60, { steps: 8 });
    await page.mouse.up();
    assert.equal(await joined(page, a, c), false, 'a drag from another card finished the link');

    await press(page, a);
    assert.equal(await armed(page), a);
    await page.click('#connectTool');
    assert.equal(await armed(page), null, 'turning the tool off left the link armed');
    await press(page, b);
    assert.equal(await joined(page, a, b), false, 'a click after the tool went off finished the link');
});

test('Escape closes the right-click menu first, then leaves a card, then clears the selection', async () => {
    const [a, b] = await fourNotes(page);
    const mod = await page.evaluate(() => (Mod.isCommand ? 'Meta' : 'Control'));
    for (const id of [a, b]) {
        const s = await cardSpot(page, id);
        await page.keyboard.down(mod);
        await page.mouse.click(s.x, s.y);
        await page.keyboard.up(mod);
    }
    const selected = () => page.evaluate(() => App.selectedNodes.uuids.size);
    await rightClick(page, a);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('custom-node-method-input')), true,
        'the menu opened without its search taking the keys');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('customContextMenu')).display), 'none',
        'Escape left the menu open');
    assert.equal(await selected(), 2, 'the Escape meant for the menu cleared the selection');

    await page.evaluate((id) => Graph.nodes[id].view.div.querySelector('.editable-div').focus(), b);
    await page.keyboard.press('Escape');
    assert.equal(await caretInBody(page), false, 'Escape left the caret in the card');
    assert.equal(await selected(), 2, 'leaving the card cleared the selection too');
    await page.keyboard.press('Escape');
    assert.equal(await selected(), 0);
});

test('the connect mode goes off when the window loses focus, or at the next press without Shift', async () => {
    // A Shift released in another window sends no keyup here; the mode stayed on, lit.
    await fourNotes(page);
    await page.keyboard.down('Shift');
    assert.equal(await tool(page), 'true');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await tool(page), 'false', 'a blur left the mode on');
    await page.keyboard.up('Shift');

    await page.evaluate(() => App.interface.nodeMode.switch(1));
    const p = await page.evaluate(() => {
        for (let y = 140; y < innerHeight - 140; y += 40) for (let x = 140; x < innerWidth - 140; x += 40) {
            if (document.elementFromPoint(x, y)?.id === 'svg_bg') return { x, y };
        }
    });
    await page.mouse.click(p.x, p.y);
    assert.equal(await tool(page), 'false', 'a press without Shift left the mode on');
});

test('"+ link": Enter links the first Node not linked yet, and the arrows choose another', async () => {
    // The nearest Node is often one already linked, and Enter took the first row: it unlinked it.
    await page.evaluate(() => window.currentActiveZettelkastenMirror
        .setValue('## Alpha\nsee [[Beta]] for the argument\n\n## Beta\nb\n\n## Gamma\ng\n\n## Delta\nd\n'));
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 1, undefined, { timeout: 5000 });
    await page.waitForTimeout(800);
    const id = (t) => page.evaluate((t) => Object.keys(Graph.nodes).find((k) => Graph.nodes[k].getTitle() === t), t);
    const [a, b] = [await id('Alpha'), await id('Beta')];
    await openPicker(page, a);
    const rowsNow = () => page.evaluate(() => [...document.querySelectorAll('#nodeList li[data-node-id]')]
        .map((li) => [li.textContent, li.classList.contains('connected')]));
    const listed = await rowsNow();
    const firstFree = listed.find(([, linked]) => !linked)[0];
    await page.keyboard.press('Enter');
    assert.ok(await joined(page, a, b), 'Enter unlinked a Node that was linked');
    assert.ok(await joined(page, a, await id(firstFree)), 'Enter did not link the first Node not linked');
    assert.match(await paneText(page), /see \[\[Beta\]\] for the argument/);

    const second = (await rowsNow())[1];
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const active = await page.evaluate(() => document.querySelector('#nodeList li.active')?.textContent);
    assert.equal(active, second[0], 'the arrows did not move to the second row');
    assert.equal(await page.getAttribute('#connectModalSearchBar', 'aria-activedescendant'),
        await page.evaluate(() => document.querySelector('#nodeList li.active').id));
    await page.keyboard.press('Enter');
    assert.equal(await joined(page, a, await id(second[0])), !second[1], 'Enter on the chosen row did not toggle it');
});

test("the right-click menu's list opens below it, clear of the pointer", async () => {
    // It opened above and to the left of the pointer, with its last row under it, so the
    // click that dismissed the menu ran that row: measured, "Run its code".
    const [a] = await fourNotes(page);
    const p = await page.evaluate((id) => {
        const r = Graph.nodes[id].view.div.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height - 20 };
    }, a);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.waitForFunction(() => document.getElementById('suggestions-container').style.display === 'block');
    const geometry = await page.evaluate(({ x, y }) => {
        const m = document.getElementById('customContextMenu').getBoundingClientRect();
        const s = document.getElementById('suggestions-container').getBoundingClientRect();
        return { menuBottom: m.bottom, listTop: s.top, underPointer: !!document.elementFromPoint(x, y)?.closest('.suggestion-item') };
    }, p);
    assert.ok(geometry.listTop >= geometry.menuBottom, 'the list is not below the menu');
    assert.equal(geometry.underPointer, false, 'a row of the list is under the pointer');
    await page.mouse.click(p.x, p.y);
    assert.equal(await page.evaluate((id) => Graph.nodes[id].codeEditingState ?? 'edit', a), 'edit',
        'the click that dismissed the menu ran an action');
});

test('Shift + scroll over a card resizes it with the caret in the notes pane', { skip: isIPad && 'mobile WebKit takes no wheel' }, async () => {
    // The Shift went to the pane and was not taken as the mode, so the wheel zoomed the Plane.
    const [a] = await fourNotes(page);
    await caretInPane(page);
    await page.keyboard.press('Escape');
    const p = await cardSpot(page, a);
    const scale = () => page.evaluate((id) => Graph.nodes[id].scale, a);
    const before = await scale();
    await page.evaluate(() => window.currentActiveZettelkastenMirror.focus());
    await page.mouse.move(p.x, p.y + 60);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);
    assert.ok(await scale() > before * 1.05, 'Shift + scroll over the card did not resize it');
});

// ---- found by the review of those fixes ----

test('a right-click neither arms nor finishes a link, and a plain click on a body finishes one', async () => {
    // The right button armed and finished links as the left did, and wrote Refs.
    const [a, b, c] = await fourNotes(page);
    await page.click('#connectTool');
    const body = await bodySpot(page, a);
    await page.mouse.click(body.x, body.y, { button: 'right' });
    assert.equal(await armed(page), null, 'a right-click armed a link');
    await page.keyboard.press('Escape');
    await page.click('#connectTool');

    await page.keyboard.down('Shift');
    await press(page, a);
    await page.keyboard.up('Shift');
    assert.equal(await armed(page), a);
    const bb = await bodySpot(page, b);
    await page.mouse.click(bb.x, bb.y, { button: 'right' });
    await page.keyboard.press('Escape');
    assert.equal(await joined(page, a, b), false, 'a right-click finished the link');
    // The first Escape closed the menu; the link is still armed, from Alpha.
    assert.equal(await armed(page), a);

    // A link armed, then a plain click on another note's body: finished, as on its header.
    await pressAt(page, await bodySpot(page, c));
    assert.ok(await joined(page, a, c), 'a plain click on a body left the link armed');
});

test('on a Mac, Control + click is the right-click: it neither arms nor finishes a link', async () => {
    // It reports button 0 there, and it armed and finished links as a left click did, from
    // a header and from a body, writing Refs into both notes.
    await context.close();
    ({ context, page, errors } = await openNeurite(browser, {
        setup: (ctx) => ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' })),
    }));
    const controlClick = async (p) => {
        await page.keyboard.down('Control');
        await page.mouse.click(p.x, p.y);
        await page.keyboard.up('Control');
    };
    const [a, b, c] = await fourNotes(page);
    await page.keyboard.down('Shift');
    await press(page, a);
    await page.keyboard.up('Shift');
    await controlClick(await cardSpot(page, b));
    await controlClick(await bodySpot(page, c));
    assert.equal(await joined(page, a, b), false, 'a Control + click on a header finished the link');
    assert.equal(await joined(page, a, c), false, 'a Control + click on a body finished the link');
    assert.equal(await armed(page), a, 'the link is no longer armed');
    // Two: the first leaves Gamma's text, where the Control + click put the caret.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    assert.equal(await armed(page), null);

    await page.click('#connectTool');
    await controlClick(await cardSpot(page, b));
    assert.equal(await armed(page), null, 'a Control + click armed a link');
    assert.ok(!(await paneText(page)).includes('[['), 'Refs were written into the notes');
});

test('an Escape during the press that would finish a link cancels it', async () => {
    const [a, b] = await fourNotes(page);
    await page.keyboard.down('Shift');
    await press(page, a);
    await page.keyboard.up('Shift');
    const p = await cardSpot(page, b);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await joined(page, a, b), false, 'the release linked a link Escape had dropped');
});

test('a connect key rebound to a letter still connects', async () => {
    // A press read the key as up and turned the mode off, so nothing armed.
    // As the Controls modal records it: the control, and the setting it writes.
    await page.evaluate(() => {
        controls.shiftKey.value = 'z';
        localStorage.setItem('controls', JSON.stringify(controls));
        settings.nodeModeKey = 'z';
    });
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    assert.equal(await page.evaluate(() => App.interface.nodeMode.key), 'z');
    const [a, b] = await fourNotes(page);
    await page.mouse.move(10, 500);
    await page.keyboard.down('z');
    await press(page, a);
    await press(page, b);
    await page.keyboard.up('z');
    assert.ok(await joined(page, a, b), 'holding the rebound key and clicking two Nodes made no Edge');

    // Held while the window loses focus, it goes off as Shift does. The blur left a letter on,
    // with its keyup gone to the other window, and two plain clicks then joined two notes.
    await page.keyboard.down('z');
    assert.equal(await tool(page), 'true');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await tool(page), 'false', "a blur left the rebound key's mode on");
    await page.keyboard.up('z');
});

test('a select list left open in a closed modal does not keep Escape from the Plane', async () => {
    const [a] = await fourNotes(page);
    await page.evaluate(() => openControlsModal());
    await page.click('#customModal .modal-body .select-replacer');
    await page.click('#customModal .close');
    await page.click('#connectTool');
    await page.keyboard.press('Escape');
    assert.equal(await tool(page), 'false', 'the open list kept Escape from turning the tool off');
    assert.ok(a);
});

test('Escape closes the right-click menu before the menu panel it opened over', async () => {
    const [a] = await fourNotes(page);
    await page.click('.menu-button');
    await page.click(".menu-row.tablink:has-text('Help')");
    const panelOpen = () => page.evaluate(() => document.querySelector('.dropdown-content').classList.contains('open'));
    assert.equal(await panelOpen(), true);
    // Opened from the card itself: in a small window the panel can lie over the card.
    await page.evaluate((id) => {
        const r = Graph.nodes[id].view.div.getBoundingClientRect();
        App.menuContext.open(r.right - 20, r.bottom - 20, Graph.nodes[id].view.div);
    }, a);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('customContextMenu')).display !== 'none');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('customContextMenu')).display), 'none');
    assert.equal(await panelOpen(), true, 'one Escape closed both the right-click menu and the panel');
});

test('a menu closed within a frame of opening leaves no action list behind', async () => {
    // The list opens a frame after the menu, and opened even when an Escape, or a click
    // elsewhere, had closed the menu inside that frame: on its own, over the tool bar, where
    // it took the next click meant for the Connect tool. Measured on an iPad in WebKit.
    const [a] = await fourNotes(page);
    const shown = await page.evaluate(async (id) => {
        const div = Graph.nodes[id].view.div;
        const r = div.getBoundingClientRect();
        App.menuContext.open(r.x + r.width / 2, r.y + r.height / 2, div);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return { menu: document.getElementById('customContextMenu').style.display,
                 list: document.getElementById('suggestions-container').style.display };
    }, a);
    assert.deepEqual(shown, { menu: 'none', list: 'none' });
});

test("in a short window the action list goes beside the menu, over neither it nor the pointer", async () => {
    // Where it fitted neither below nor above, it was put at the top of the window, on the menu
    // and its focused search; flipped above near the right edge, it ended under the pointer.
    await page.setViewportSize({ width: 1440, height: 650 });
    const [a] = await fourNotes(page);
    for (const at of [{ x: 700, y: 300 }, { x: 1300, y: 500 }]) {
        const r = await page.evaluate((id) => {
            const b = Graph.nodes[id].view.div.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height };
        }, a);
        await page.evaluate(([id, at]) => App.menuContext.open(at.x, at.y, Graph.nodes[id].view.div), [a, at]);
        await page.waitForFunction(() => document.getElementById('suggestions-container').style.display === 'block');
        const g = await page.evaluate((at) => {
            const m = document.getElementById('customContextMenu').getBoundingClientRect();
            const s = document.getElementById('suggestions-container').getBoundingClientRect();
            const overlap = s.left < m.right && s.right > m.left && s.top < m.bottom && s.bottom > m.top;
            const under = at.x >= s.left && at.x <= s.right && at.y >= s.top && at.y <= s.bottom;
            return { overlap, under, inside: s.left >= 0 && s.top >= 0 && s.right <= innerWidth && s.bottom <= innerHeight };
        }, at);
        assert.deepEqual(g, { overlap: false, under: false, inside: true }, `menu at ${JSON.stringify(at)}`);
        await page.keyboard.press('Escape');
        assert.ok(r.w > 0);
    }
});

test('wherever the menu opens, the action list lies over neither the pointer nor the menu', async () => {
    // The menu opens 5px from the pointer, and the list on the pointer's side was measured
    // from the menu alone, so it ended over the pointer and was never used; the fallback
    // then put it on the menu, or under the pointer, where the dismissing click ran a row.
    // Measured at 1024x600: "Zoom to it" under the pointer, and with pins, over the search.
    await page.setViewportSize({ width: 1024, height: 600 });
    const [a] = await fourNotes(page);
    const counts = await page.evaluate((id) => {
        const list = document.getElementById('suggestions-container');
        const menu = document.getElementById('customContextMenu');
        const meets = (p, q) => p.left < q.right && p.right > q.left && p.top < q.bottom && p.bottom > q.top;
        const seen = { opened: 0, underPointer: 0, overMenu: 0, offScreen: 0 };
        for (const pinned of [0, 3]) {
            ['zoomTo', 'toggleSelect', 'delete'].slice(0, pinned).forEach((k) => App.pinnedItems.addItem(k));
            for (let y = 4; y < innerHeight; y += 24) for (let x = 4; x < innerWidth; x += 24) {
                App.menuContext.open(x, y, Graph.nodes[id].view.div);
                if (pinned) App.menuContext.inputField.click();     // the search shows the list
                if (list.style.display !== 'block') { App.menuContext.hide(); continue; }
                seen.opened++;
                const l = list.getBoundingClientRect();
                if (list.contains(document.elementFromPoint(x, y))) seen.underPointer++;
                if (meets(l, menu.getBoundingClientRect())) seen.overMenu++;
                if (l.left < 0 || l.top < 0 || l.right > innerWidth || l.bottom > innerHeight) seen.offScreen++;
                App.menuContext.hide();
            }
        }
        return seen;
    }, a);
    assert.ok(counts.opened > 1000, `the list opened ${counts.opened} times`);
    assert.deepEqual({ ...counts, opened: 0 }, { opened: 0, underPointer: 0, overMenu: 0, offScreen: 0 });
});

test('"+ link" and each × take a finger-sized press on a touch screen, in one row of links or two', { skip: !isIPad && 'a coarse pointer only' }, async () => {
    // "+ link"'s 44px target was clipped by the strip to 24px. Where the links wrapped, rows
    // 4px apart let "+ link" take the lower half of the × above it: a tap meant to unlink
    // opened the link modal.
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\na [[Beta]] [[Gamma]]'
        + ' [[Delta]] [[Epsilon]] [[Zeta]] [[Eta]]\n\n## Beta\nb\n\n## Gamma\ng\n\n## Delta\nd\n\n## Epsilon\ne\n\n'
        + '## Zeta\nz\n\n## Eta\nh\n'));
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 6, undefined, { timeout: 8000 });
    await page.waitForTimeout(800);
    for (const [title, rows] of [['Alpha', 2], ['Beta', 1]]) {
        const hits = await page.evaluate((t) => {
            const strip = Object.values(Graph.nodes).find((n) => n.getTitle() === t).view.div.querySelector('.link-strip');
            const takes = (el) => {
                const r = el.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                return [-20, 20].every((dy) => el.contains(document.elementFromPoint(cx, cy + dy)));
            };
            return {
                rows: new Set([...strip.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
                cuts: [...strip.querySelectorAll('.link-chip-cut')].map(takes),
                add: takes(strip.querySelector('.link-add')),
            };
        }, title);
        assert.ok(hits.rows >= rows, `${title}'s links are on ${hits.rows} row(s)`);
        assert.deepEqual(hits, { rows: hits.rows, cuts: hits.cuts.map(() => true), add: true }, title);
    }
});

test('"+ link": ArrowUp with no row chosen goes to the last row', async () => {
    const [a] = await fourNotes(page);
    await openPicker(page, a);
    await page.keyboard.press('ArrowUp');
    const [last, active] = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#nodeList li[data-node-id]')];
        return [rows[rows.length - 1].textContent, document.querySelector('#nodeList li.active')?.textContent];
    });
    assert.equal(active, last);
});

test('one keystroke asks each linked note once whether it names the note typed in', async () => {
    // Each ask splits the whole Pane, and the three loops that decide a note's Edges asked
    // again each: measured, 3200 asks for 40 answers on one keystroke, 26 ms where it was 16.
    const lines = ['## Hub', 'intro'];
    for (let i = 1; i <= 12; i++) lines.push(`[[N${i}]]`);
    lines.push('');
    for (let i = 1; i <= 12; i++) lines.push(`## N${i}`, `body ${i} [[Hub]]`, '');
    await page.evaluate((t) => window.currentActiveZettelkastenMirror.setValue(t), lines.join('\n'));
    await page.waitForFunction(() => Object.keys(Graph.edges).length === 12, undefined, { timeout: 10000 });
    await page.waitForTimeout(800);
    const counts = await page.evaluate(() => {
        const P = ZettelkastenProcessor.prototype;
        const [names, refs] = [P.sectionNames, P.handleRefTags];
        let asks = 0, calls = 0;
        P.sectionNames = function (...a) { asks++; return names.apply(this, a); };
        P.handleRefTags = function (...a) { calls++; return refs.apply(this, a); };
        const cm = window.currentActiveZettelkastenMirror;
        cm.replaceRange('x', { line: 1, ch: cm.getLine(1).length });
        P.sectionNames = names;
        P.handleRefTags = refs;
        return { asks, calls };
    });
    assert.ok(counts.calls > 0, 'the keystroke ran no pass');
    assert.ok(counts.asks <= counts.calls * 12, `${counts.asks} asks over ${counts.calls} passes of 12 links`);
});
