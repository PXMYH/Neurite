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

// A card's visible body is a highlighted overlay above the real textarea, kept in step
// by the change event TextArea.update dispatches. The reference path assigned `.value`
// directly and dispatched nothing, so a line of prose carrying a link reached the model
// and not the reader: the card showed its placeholder while node.textarea.value held
// the text. In a knowledge graph most body lines carry a link.
test('a note whose body contains a link shows that body', async () => {
    await addNote(page, 'Encoding', 'Turning an experience into a trace.');
    await addNote(page, 'Retrieval', 'Finding the trace. [[Encoding]]');
    await page.waitForTimeout(900);

    const state = await page.evaluate(() => Object.values(Graph.nodes).map(n => ({
        title: n.getTitle(),
        model: n.textarea?.value ?? '',
        visible: n.contentEditableDiv?.value ?? '',
    })));

    const linked = state.find(s => s.title === 'Retrieval');
    assert.ok(linked, 'the linked note exists');
    assert.match(linked.model, /Finding the trace\./, 'the model has the text');
    assert.match(linked.visible, /Finding the trace\./,
        `the reader can see it too; visible layer held ${JSON.stringify(linked.visible)}`);
    assert.match(linked.visible, /\[\[Encoding\]\]/, 'including the link itself');

    // And exactly once: accumulating the line in both the reference path and the plain
    // path is the obvious wrong fix, and it duplicates the body.
    const occurrences = (linked.visible.match(/Finding the trace\./g) || []).length;
    assert.equal(occurrences, 1, `the line appears once, saw ${occurrences}`);
});

// Finding a note you cannot see is the other half of an endless canvas, and it used to
// take three actions: click Search, click into the box, type. Focus stayed on the
// toolbar button, and the second click is not something a reader should have to work out.
test('search opens with the caret in it and finds a note that is off screen', async () => {
    for (const t of ['Encoding', 'Retrieval', 'Consolidation']) await addNote(page, t, `About ${t}.`);
    await page.waitForTimeout(700);

    // Pan away, so the notes are genuinely unreachable by looking.
    await page.evaluate(() => { Graph.pan_set(new vec2(60, 40)) });
    await page.waitForTimeout(200);
    const visible = await page.evaluate(() => Object.values(Graph.nodes)
        .filter(n => { const uv = fromZtoUV(n.pos); return uv.x > 0 && uv.x < 1 && uv.y > 0 && uv.y < 1 })
        .length);
    assert.equal(visible, 0, 'nothing is on screen to start with');

    await page.click('#nodeSearchButton');
    await page.waitForFunction(() => document.activeElement?.id === 'Searchbar', undefined, { timeout: 5000 });

    // Typed without clicking into the field first, which is the whole point.
    await page.keyboard.type('retr');
    await page.waitForFunction(
        () => (document.getElementById('search-results')?.textContent || '').includes('Retrieval'),
        undefined, { timeout: 5000 });

    const state = await page.evaluate(() => ({
        typed: document.getElementById('Searchbar').value,
        count: document.getElementById('search-results').children.length,
    }));
    assert.equal(state.typed, 'retr', 'the keystrokes reached the field');
    assert.equal(state.count, 1, 'one note matched');
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
