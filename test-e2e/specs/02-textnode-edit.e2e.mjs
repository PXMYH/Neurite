import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, typeBody } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Locks the ee13525 regression. A card holds three textareas: the title, the
// hidden body (.node-textarea), and the .editable-div the reader types into.
// Body keystrokes must sync into .node-textarea and must NOT leak into the title
// -- the root cause behind "body text becomes a ## heading" and "the title only
// keeps one character".
test('typing in the body lands in .node-textarea, never the title', async () => {
    const uuid = await addNote(page, 'Keep This Title', '');
    assert.ok(uuid, 'note was created');

    await typeBody(page, uuid, 'hello from the body');

    const state = await page.evaluate((id) => ({
        body: Graph.nodes[id].textarea.value,
        title: Graph.nodes[id].view.titleInput.value,
    }), uuid);
    assert.equal(state.body, 'hello from the body', 'body text reached .node-textarea');
    assert.equal(state.title, 'Keep This Title', 'title untouched by body typing');
});

// The "the second note wipes the first" regression: each card must retain its own
// body when another is edited after it.
test('a second note keeps its own body; the first is not wiped', async () => {
    const a = await addNote(page, 'A', '');
    const b = await addNote(page, 'B', '');
    assert.ok(a && b && a !== b, 'two distinct notes created');

    await typeBody(page, a, 'alpha body');
    await typeBody(page, b, 'beta body');

    const bodies = await page.evaluate(([ua, ub]) => ({
        a: Graph.nodes[ua].textarea.value,
        b: Graph.nodes[ub].textarea.value,
    }), [a, b]);
    assert.equal(bodies.a, 'alpha body', 'first note kept its body');
    assert.equal(bodies.b, 'beta body', 'second note kept its body');
});
