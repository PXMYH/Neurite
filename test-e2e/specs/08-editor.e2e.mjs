import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

const nodeCount = (page) => page.evaluate(() => Object.keys(Graph.nodes).length);

// The fractal draws hairline <path>s inside #bg that can take the hit, and
// createnodes.js gates the gesture on `e.target.id === 'svg_bg'`, so #bg is made
// click-through for the duration -- the same thing the existing canvas-gesture spec
// does, and not a workaround for the feature under test.
async function dblclickCanvas(page, x, y) {
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = 'none' });
    await page.mouse.dblclick(x, y);
    await page.evaluate(() => { document.getElementById('bg').style.pointerEvents = '' });
}

test('double-clicking the canvas makes a note ready to type in', async () => {
    const before = await nodeCount(page);
    await dblclickCanvas(page, 700, 420);
    await page.waitForFunction((n) => Object.keys(Graph.nodes).length === n + 1, before, { timeout: 8000 });

    // The caret has to be in the note, not merely somewhere: the visible text is a
    // highlighted overlay with pointer-events none, so focusing the wrong layer puts
    // the caret nowhere and typing goes to the document.
    const focused = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        isNoteBody: !!document.activeElement?.closest?.('.window'),
        isTheRealInput: document.activeElement?.classList?.contains('editable-div'),
    }));
    assert.equal(focused.tag, 'TEXTAREA');
    assert.ok(focused.isNoteBody, 'the caret is inside a card');
    assert.ok(focused.isTheRealInput, 'and in the editable layer, not the overlay');

    await page.keyboard.type('straight in');
    await page.waitForFunction(
        () => Object.values(Graph.nodes).some(n => n.textarea?.value === 'straight in'),
        undefined, { timeout: 5000 });
});

// Shift held is what the gesture used to require, and it still has to work: the
// unmodified case was added beside it, not over it.
test('Shift and double-click still makes a note', async () => {
    const before = await nodeCount(page);
    await page.keyboard.down('Shift');
    await dblclickCanvas(page, 900, 500);
    await page.keyboard.up('Shift');
    await page.waitForFunction((n) => Object.keys(Graph.nodes).length === n + 1, before, { timeout: 8000 });
    assert.equal(await nodeCount(page), before + 1);
});

test('double-clicking a card does not make a note', async () => {
    // A card's own double-click toggles whether the fractal may carry it, so the new
    // canvas gesture must not fire through a card as well.
    const uuid = await addNote(page, 'Target', 'body');
    await page.waitForTimeout(600);
    const before = await nodeCount(page);

    const card = await page.evaluateHandle((id) => Graph.nodes[id].view.div, uuid);
    await card.asElement().dblclick();
    await page.waitForTimeout(900);

    assert.equal(await nodeCount(page), before, 'no extra note was created');
});

test('the notes pane can be opened from the menu', async () => {
    // tab1 had no tablink, so the CodeMirror every node is built from was loaded and
    // unreachable: a reader could edit a note in its card and never learn the map has
    // a text form at all.
    await addNote(page, 'Knowledge Graphs', 'A graph of concepts.');
    await addNote(page, 'Zettelkasten', 'Atomic notes. [[Knowledge Graphs]]');
    await page.waitForTimeout(800);

    await page.click('.menu-button');
    await page.waitForTimeout(300);
    await page.click("button.menu-row.tablink:has-text('Notes')");
    await page.waitForTimeout(600);

    const state = await page.evaluate(() => {
        const cm = document.querySelector('.CodeMirror');
        const box = cm?.getBoundingClientRect();
        return {
            tabShown: getComputedStyle(document.getElementById('tab1')).display,
            width: Math.round(box?.width || 0),
            height: Math.round(box?.height || 0),
            visibility: cm && getComputedStyle(cm).visibility,
            text: window.currentActiveZettelkastenMirror.getValue(),
        };
    });

    assert.equal(state.tabShown, 'block', 'the panel is displayed');
    assert.equal(state.visibility, 'visible', 'the editor is visible');
    assert.ok(state.width > 0 && state.height > 0, `the editor has a box, got ${state.width}x${state.height}`);
    // Tag.node rather than a literal '##', because a reader can reconfigure it.
    const heading = await page.evaluate(() => Tag.node + ' Knowledge Graphs');
    assert.ok(state.text.includes(heading), `the pane holds "${heading}"`);
    assert.ok(state.text.includes('[[Knowledge Graphs]]'), 'and holds the link between the notes');
});
