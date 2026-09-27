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
