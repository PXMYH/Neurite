import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openNeurite } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// A folder of Markdown notes into the Graph (#71). The fixture holds the AI bundle's cases in
// a few files and none of its text: notes in three folders and at the top, two with one file
// name, a heading in a note and one in a code fence, an AI line, an embed, a link by another
// name, a link to nothing, an index, a log, a contract, a page with no frontmatter, and the
// folders a bundle keeps that are not notes.
const BUNDLE = fileURLToPath(new URL('../fixtures/notes-bundle', import.meta.url));

async function importBundle(page, { answer } = {}) {
    await page.click('.menu-button');
    const chooser = page.waitForEvent('filechooser');
    await page.click('#import-notes-button');
    await (await chooser).setFiles(BUNDLE);
    if (answer) {
        await page.waitForFunction(() => Modal.current?.id === 'confirmModal', undefined, { timeout: 15000 });
        const question = await page.evaluate(() => document.querySelector('#customModal .confirm-message').textContent);
        await page.click(`#customModal ${answer === 'yes' ? '.modal-ok' : '.modal-cancel'}`);
        if (answer !== 'yes') return question;
    }
    await page.waitForFunction(() => Modal.current?.id === 'alertModal', undefined, { timeout: 30000 });
    const summary = await page.evaluate(() => document.querySelector('#customModal .alert-message').textContent);
    await page.click('#customModal .modal-ok');
    await page.waitForTimeout(500);
    return summary;
}
const state = (page) => page.evaluate(() => {
    const nodes = Object.values(Graph.nodes);
    const edges = new Set();
    for (const node of nodes) for (const edge of node.edges) edges.add(edge);
    const pair = (edge) => edge.pts.map((p) => p.getTitle()).sort().join(' ~ ');
    return {
        titles: nodes.map((n) => n.getTitle()).sort(),
        edges: [...edges].map(pair).sort(),
        archives: [...document.getElementById('archiveSelect').options].map((o) => o.text),
        pinned: nodes.every((n) => n.anchorForce === 1),
    };
});

test('a folder of notes becomes a note each, an Archive for each folder, and its own links Edges', async () => {
    const summary = await importBundle(page);
    assert.match(summary, /^6 notes from “notes-bundle”, in 4 Archives, with 4 Edges/);
    assert.match(summary, /4 lines of the notes begin with “##” or “AI:”/);
    assert.match(summary, /Not imported, as not notes: 1 index, 1 log, 1 contract, 1 file with no frontmatter\./);
    assert.match(summary, /2 links name no note here.*\[\[RAG\|retrieval\]\] in “Agent Loop”.*\[\[Missing\]\] in “Agent Loop”/);

    const s = await state(page);
    // The file names, and the two named Courses by as much of their path as tells them apart.
    assert.deepEqual(s.titles, ['Agent Loop', 'Claude Code/Courses', 'Learning/Courses', 'RAG', 'Setup', 'Top']);
    assert.deepEqual(s.archives, ['notes-bundle · 1 note', 'Agents · 1 note', 'Harnesses · 2 notes', 'Learning · 2 notes']);
    // Between two Archives as well as inside one, and one Edge for a pair that name each other.
    assert.deepEqual(s.edges, ['Agent Loop ~ Claude Code/Courses', 'Agent Loop ~ RAG', 'Agent Loop ~ Top',
                               'Claude Code/Courses ~ Learning/Courses']);
    assert.equal(s.pinned, true, 'an imported note drifts with the Fractal');

    // A heading, in the text or in a fence, is in its note, and opened no note of its own.
    const agents = await page.evaluate(() => window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Agents').cm.getValue());
    assert.match(agents, /\n ## Overview\n/);
    assert.match(agents, /\n ## A heading inside a fence\n/);
    assert.deepEqual(errors, []);
});

test('an imported note\'s card starts at its text, and typing in it keeps the frontmatter', async () => {
    await importBundle(page);
    const card = await page.evaluate(() => {
        const node = Object.values(Graph.nodes).find((n) => n.getTitle() === 'RAG');
        const line = node.content.querySelector('.card-description');
        return { text: node.contentEditableDiv.value.trim(), line: line.hidden ? null : line.textContent };
    });
    assert.deepEqual(card, { text: 'The agent loop fetches context: [[Agent Loop]].', line: 'Retrieval-augmented generation.' });

    const handle = await page.evaluateHandle(() => Object.values(Graph.nodes).find((n) => n.getTitle() === 'RAG').contentEditableDiv);
    // The Learning Region framed, so its cards are large enough to click into (#73).
    await page.evaluate(() => {
        if (dropdownContent.classList.contains('open')) menuButton.click();
        ZetRegions.frame(window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Learning').paneId);
    });
    await page.waitForTimeout(600);
    await handle.asElement().click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' More.');
    await page.waitForTimeout(500);
    const pane = await page.evaluate(() => window.zetPaneList.find((p) => App.zetPanes.getPaneName(p.paneId) === 'Learning').cm.getValue());
    // The card's text ends in a newline, so the typing lands on the line after it.
    assert.match(pane, /## RAG\n---\ntitle: "Retrieval"\ndescription: "Retrieval-augmented generation\."\ntype: concept\n[\s\S]*?---\n# RAG\n\nThe agent loop fetches context: \[\[Agent Loop\]\]\.\n More\.$/);
});

test('an import survives a save and a reload', async () => {
    await importBundle(page);
    const before = await state(page);
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 6 && window.zetPaneList.length === 4, undefined, { timeout: 15000 });
    await page.waitForTimeout(1000);
    assert.deepEqual(await state(page), before);
});

test('with notes on screen the import asks first, and fills a graph of its own', async () => {
    await page.evaluate(() => window.createNote('Mine', 'A note already here.'));
    await page.waitForTimeout(600);
    const question = await importBundle(page, { answer: 'no' });
    assert.match(question, /^Import 6 notes from “notes-bundle” into a new graph, an Archive for each of its 4 folders\?/);
    assert.deepEqual((await state(page)).titles, ['Mine'], 'No imported something');

    await page.click('.menu-button');   // the menu closed with the dialog
    await importBundle(page, { answer: 'yes' });
    const s = await state(page);
    assert.equal(s.titles.length, 6);
    assert.ok(!s.titles.includes('Mine'), 'the import went into the graph that was on screen');
});
