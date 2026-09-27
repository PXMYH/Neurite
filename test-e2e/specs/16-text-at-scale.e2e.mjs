import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The notes at the size of a real bundle (#69): the AI bundle is 95 notes in 13 Archives,
// the largest 3,263 lines. At that size a keystroke in the Pane cost 72ms, a plain click on
// any of 2,434 marked words flew the view away, and a note naming itself threw at every
// keystroke after.

async function openNotes(page) {
    await page.click('.menu-button');
    await page.click(".menu-row.tablink:has-text('Notes')");
}
const write = (page, text) => page.evaluate((text) => {
    const pane = window.zetPaneList[0];
    pane.processor.writeAs(ZettelkastenProcessor.Pass.edit, () => pane.cm.setValue(text));
}, text);
const marks = (page) => page.evaluate(() => window.currentActiveZettelkastenMirror.getAllMarks()
    .filter((m) => m.className === 'node-title')
    .map((m) => { const r = m.find(); return `${r.from.line}:${r.from.ch}-${r.to.ch}`; }));

test('a Title is marked where it is a whole word, and the longer of two wins', async () => {
    await write(page, '## RAG\nr\n\n## Leverage\nIt uses leverage and RAG, and ragged edges.\n\n'
        + '## Claude Code\nc\n\n## Claude Code/Courses\nSee Claude Code/Courses and Claude Code.\n');
    await page.waitForTimeout(400);
    const found = await marks(page);
    // "ragged" is not RAG; "leverage" is Leverage in any case.
    assert.ok(found.includes('4:8-16') && found.includes('4:21-24'), 'a whole word is not marked: ' + found);
    assert.ok(!found.includes('4:30-33'), '"ragged" was marked as RAG');
    // Line 10: "See Claude Code/Courses and Claude Code." -- the longer Title, then the shorter.
    assert.ok(found.includes('10:4-23') && found.includes('10:28-39'), 'the longer Title did not win: ' + found);
    assert.ok(!found.includes('10:4-15'), 'the shorter Title was marked inside the longer');
});

// A reader writing in the Pane clicks to place the caret; a plain click on a marked word
// flew the view to that note instead.
test('a plain click on a Title places the caret, and the modifier goes to the note',
     { skip: isIPad && 'a touch has no modifier; the tap places the caret' }, async () => {
    await openNotes(page);
    await write(page, '## RAG\nr\n\n## Notes\nIt uses RAG here.\n');
    await page.waitForTimeout(400);
    const at = await page.evaluate(() => {
        const c = window.currentActiveZettelkastenMirror.charCoords({ line: 4, ch: 9 }, 'window');
        return { x: c.left + 1, y: (c.top + c.bottom) / 2 };
    });
    const view = () => page.evaluate(() => Graph.pan.toString() + ' ' + Graph.zoom.toString());
    const before = await view();
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(() => { const c = window.currentActiveZettelkastenMirror.getCursor(); return [c.line, c.ch]; }), [4, 9]);
    assert.equal(await view(), before, 'a plain click moved the view');

    const mod = await page.evaluate(() => (Mod.isMac ? 'Meta' : 'Control'));
    await page.keyboard.down(mod);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.CodeMirror .node-title')).cursor), 'pointer');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up(mod);
    await page.waitForTimeout(1500);
    assert.notEqual(await view(), before, 'the modifier and a click did not go to the note');
});

// Two notes of the AI bundle name themselves. The Ref made an Edge from the note to itself,
// listed twice on it, and the next pass threw on an Edge with no other end -- at every
// keystroke in that Pane, so the note's text stopped reaching its card.
test('a note that names itself has no Edge, and what is typed after it reaches its card', async () => {
    await write(page, '## Alpha\nIt names itself: [[Alpha]]\n');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
        const pane = window.zetPaneList[0];
        pane.processor.writeAs(ZettelkastenProcessor.Pass.edit, () => pane.cm.replaceRange('Still ', { line: 1, ch: 0 }));
        const node = Object.values(Graph.nodes).find((n) => n.getTitle() === 'Alpha');
        return { edges: node.edges.length, body: node.textarea.value.trim() };
    });
    assert.deepEqual(after, { edges: 0, body: 'Still It names itself: [[Alpha]]' });
    assert.deepEqual(errors, []);
});

// Every Ref line of a note reconciled the note's Edges again, with the same answer: forty
// times a keystroke for a note of forty Ref lines.
test('a keystroke in a note of forty Ref lines reconciles its Edges once, and keeps all forty', async () => {
    const others = Array.from({ length: 40 }, (_, i) => `## Other ${i}\nbody\n`).join('\n');
    const hub = '## Hub\n' + Array.from({ length: 40 }, (_, i) => `See [[Other ${i}]].`).join('\n') + '\n';
    await write(page, hub + '\n' + others);
    await page.waitForTimeout(800);
    const result = await page.evaluate(() => {
        const processor = window.zetPaneList[0].processor;
        let calls = 0;
        const real = processor.handleRefTags;
        processor.handleRefTags = function (...args) { calls += 1; return real.apply(this, args); };
        processor.writeAs(ZettelkastenProcessor.Pass.edit, () => window.zetPaneList[0].cm.replaceRange('x', { line: 1, ch: 0 }));
        processor.handleRefTags = real;
        return { calls, edges: Object.values(Graph.nodes).find((n) => n.getTitle() === 'Hub').edges.length };
    });
    assert.deepEqual(result, { calls: 1, edges: 40 });
});

// The measure the rest serves: a keystroke in an Archive the size of the bundle's largest.
// 72ms before, 12ms after, on the machine this was written on; the limit leaves room for a
// slower one and still catches the old marking coming back.
test('a keystroke in a 3,000-line Archive with 95 Titles stays under 40ms', async () => {
    const ms = await page.evaluate(async () => {
        const words = ['model', 'agent', 'prompt', 'context', 'eval', 'tool', 'memory', 'harness'];
        const sections = Array.from({ length: 95 }, (_, i) => {
            const body = Array.from({ length: 31 }, (_, j) => `Line ${j} on ${words[(i + j) % 8]} and Title ${(i * 7 + j) % 95} of the set.`);
            return `## Title ${i}\n${body.join('\n')}\n`;
        });
        const pane = window.zetPaneList[0];
        pane.processor.writeAs(ZettelkastenProcessor.Pass.edit, () => pane.cm.setValue(sections.join('\n')));
        await new Promise((r) => setTimeout(r, 3000));
        const line = Math.floor(pane.cm.lineCount() / 2);
        const times = [];
        for (let i = 0; i < 5; i++) {
            const t = performance.now();
            pane.processor.writeAs(ZettelkastenProcessor.Pass.edit, () => pane.cm.replaceRange('x', { line, ch: 0 }));
            times.push(performance.now() - t);
            await new Promise((r) => setTimeout(r, 50));
        }
        return times.sort((a, b) => a - b)[2];
    });
    assert.ok(ms < 40, `a keystroke took ${Math.round(ms)}ms`);
});
