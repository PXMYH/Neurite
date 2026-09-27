import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// Archives (#64): the controls in the Notes panel, and one Title namespace across them.
// The controls were removed as bare icons, which took the capability with them; a Title
// written in two Archives made two Nodes, and a Saved Graph holding the pair bound both
// Archives to one Node when it opened.

const state = (page) => page.evaluate(() => ({
    shown: document.querySelector('.archive-choice .selected-text')?.textContent,
    archives: [...document.getElementById('archiveSelect').options].map((o) => o.text),
    hud: document.querySelector('.hud-archive').hidden ? null
        : document.querySelector('.hud-archive').textContent.replace(/\s+/g, ' ').trim(),
    status: document.getElementById('archiveStatus').textContent || null,
    notes: Object.values(Graph.nodes).filter((n) => !n.removed).map((n) => n.getTitle()).sort(),
}));
// What the app's own dialog says, when one is open.
const dialog = (page) => page.evaluate(() => (Modal.current
    ? Modal.div.querySelector('.alert-message, .confirm-message, .modal-prompt-message')?.textContent : null));
const answer = (page, button) => page.click(`#customModal .modal-body ${button}`);

async function openNotes(page) {
    await page.click('.menu-button');
    await page.click(".menu-row.tablink:has-text('Notes')");
}
// Real keys into the Archive shown, at its end.
async function type(page, text) {
    await page.click('#zetPaneContainer .zet-pane.active .CodeMirror-lines');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(text);
    await page.waitForTimeout(400);
}
async function saveAndReload(page) {
    await page.evaluate(() => App.viewGraphs.saveNow());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => window.zetPaneList.length > 0 && Object.keys(Graph.nodes).length > 0,
        undefined, { timeout: 15000 });
    await page.waitForTimeout(800);
}

test('a Title another Archive holds makes no second note, and the Notes panel says where it is', async () => {
    await openNotes(page);
    await type(page, '## Alpha\nThe first.\n\n## Beta\nThe second. [[Alpha]]\n');
    assert.equal((await state(page)).shown, 'Archive 1 · 2 notes');

    await page.click('#archiveNew');
    await page.keyboard.type('## Alpha\nWritten again.\n');   // the caret is in the new Archive
    await page.waitForTimeout(400);

    const s = await state(page);
    assert.deepEqual(s.notes, ['Alpha', 'Beta'], 'a second Archive made a second Alpha');
    assert.equal(s.shown, 'Archive 2 · 0 notes');
    assert.match(s.status ?? '', /“Alpha” is already a note in Archive 1/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#zetPaneContainer .zet-title-taken').length), 1,
        'the taken Title line is not marked in the text');
    assert.deepEqual(errors, []);
});

test('delete says how many notes go with the Archive, and the last one says why it stays', async () => {
    await openNotes(page);
    await type(page, '## Alpha\na\n\n## Beta\nb\n');
    await page.click('#archiveNew');
    await page.keyboard.type('## Gamma\ng\n');
    await page.waitForTimeout(400);

    // Back to Archive 1 with the select, as a reader: it opens, and closes on the choice.
    await page.click('.archive-choice .select-replacer');
    await page.click(".archive-choice .dropdown-option:has-text('Archive 1')");
    assert.equal(await page.evaluate(() => document.querySelector('.archive-choice .options-replacer').classList.contains('show')),
        false, 'the list stayed open over the buttons after the choice');
    assert.equal((await state(page)).shown, 'Archive 1 · 2 notes');

    await page.click('#archiveDelete');
    assert.equal(await dialog(page), 'Delete the Archive “Archive 1” and the 2 notes written in it?');
    assert.deepEqual(await page.evaluate(() => {
        const m = document.getElementById('customModal');
        return [m.getAttribute('role'), document.getElementById(m.getAttribute('aria-describedby'))?.textContent];
    }), ['alertdialog', 'Delete the Archive “Archive 1” and the 2 notes written in it?'], 'the question is not what describes the dialog');
    await answer(page, '.modal-ok');
    await page.waitForTimeout(500);
    const s = await state(page);
    assert.deepEqual(s.notes, ['Gamma'], 'the Archive\'s notes went with it');
    assert.deepEqual(s.archives, ['Archive 2 · 1 note']);

    await page.click('#archiveDelete');
    assert.match(await dialog(page) ?? '', /only Archive.*cannot be deleted/, 'the last Archive gave no reason');
    await answer(page, '.modal-ok');
    assert.deepEqual((await state(page)).archives, ['Archive 2 · 1 note']);

    // The next one is numbered after the highest there is, so the list reads in order.
    await page.click('#archiveNew');
    assert.deepEqual((await state(page)).archives, ['Archive 2 · 1 note', 'Archive 3 · 0 notes']);
});

test('a renamed Archive keeps its name and its place through a save and a reload', async () => {
    await openNotes(page);
    await type(page, '## Alpha\na\n');
    await page.click('#archiveNew');
    await page.keyboard.type('## Beta\nb\n');
    await page.waitForTimeout(300);

    await page.click('#archiveRename');
    assert.equal(await dialog(page), 'Rename the Archive “Archive 2” to:');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Learning');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.deepEqual((await state(page)).archives, ['Archive 1 · 1 note', 'Learning · 1 note']);

    await saveAndReload(page);
    assert.deepEqual((await state(page)).archives, ['Archive 1 · 1 note', 'Learning · 1 note']);
});

test('with two Archives the HUD says where new notes go, and opens the Notes panel', async () => {
    assert.equal((await state(page)).hud, null, 'one Archive needs no saying');
    await openNotes(page);
    await page.click('#archiveNew');
    // The HUD redraws on its own interval.
    await page.waitForFunction(() => !document.querySelector('.hud-archive').hidden, undefined, { timeout: 2000 });
    assert.equal((await state(page)).hud, 'New notes go to Archive 2');
    // Set 8px in from everything else in the overview by the padding its hover needs.
    const lefts = await page.evaluate(() => ['.hud-archive-caption', '.hud-scale', '.hud-map']
        .map((s) => document.querySelector(s).getBoundingClientRect().left));
    assert.ok(Math.max(...lefts) - Math.min(...lefts) <= 1, `the line is not aligned with the rest of the overview: ${lefts}`);

    await page.click('.menu-button');   // the menu closed
    await page.click('.hud-archive');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('tab1')).display), 'block',
        'the HUD line did not open the Notes panel');
});

test('a Saved Graph with one Title in two Archives opens with the later renamed, and says so', async () => {
    // What the code before #64 could save: Beta turned into a second Alpha in the stored text.
    await openNotes(page);
    await type(page, '## Alpha\nbody one\n');
    await page.click('#archiveNew');
    await page.keyboard.type('## Beta\nbody two\n');
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
        await App.viewGraphs.saveNow();
        const table = localforage.createInstance({ name: 'graphs', storeName: 'graph-data' });
        const keys = await table.keys();
        for (const key of keys) {
            const text = await table.getItem(key);
            if (typeof text === 'string') await table.setItem(key, text.replaceAll('Beta', 'Alpha'));
        }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => Modal.current?.id === 'alertModal', undefined, { timeout: 15000 });

    assert.match(await dialog(page) ?? '', /“Alpha” in Archive 2 is now “Alpha \(2\)”/);
    // A full pass writes each body a moment after the walk (`handleLineWithoutTags`).
    await page.waitForFunction(() => Object.values(Graph.nodes).every((n) => n.textarea.value.trim()),
        undefined, { timeout: 5000 });
    const loaded = await page.evaluate(() => ({
        notes: Object.values(Graph.nodes).map((n) => `${n.getTitle()}: ${n.textarea.value.trim()}`).sort(),
        panes: window.zetPaneList.map((p) => p.cm.getValue().split('\n')[0]),
    }));
    assert.deepEqual(loaded.notes, ['Alpha (2): body two', 'Alpha: body one'], 'both notes, each with its own body');
    assert.deepEqual(loaded.panes, ['## Alpha', '## Alpha (2)']);
});

// A card's Title is a textarea whose markup, which is what a Saved Graph keeps, was written
// once when the card was built. A note typed into the Pane is built at "##", under a
// timestamp; a rename on the card changes the value only. Either came back from a reload
// under its old Title, so the pass made a second Node and the first stayed, empty.
test('a note typed into the Pane, and one renamed on its card, each come back as one note where it was', async () => {
    await openNotes(page);
    await type(page, '## Alpha\nbody one\n');
    await page.evaluate(() => window.createNote('Beta', 'body two'));
    await page.waitForTimeout(600);
    const title = await page.evaluateHandle(() => Object.values(Graph.nodes).find((n) => n.getTitle() === 'Beta').view.titleInput);
    await title.asElement().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' renamed');
    await page.waitForTimeout(400);
    const where = () => page.evaluate(() => Object.values(Graph.nodes)
        .map((n) => `${n.getTitle()} @ ${n.pos.x.toFixed(2)},${n.pos.y.toFixed(2)}`).sort());
    const before = await where();
    assert.deepEqual(before.map((w) => w.split(' @ ')[0]), ['Alpha', 'Beta renamed']);

    await saveAndReload(page);
    assert.deepEqual(await where(), before, 'a reload made a second note, or moved one');
});

// ---- found by the Phase 3 reviews ----

// A load gave each Title to whichever Archive it restored first: a note in Archive 2 with a
// taken copy in Archive 1 opened as the copy, its own section the one marked.
test('a note keeps its Title through a reload when an Archive restored before it holds a taken copy', async () => {
    await openNotes(page);
    await page.click('#archiveNew');
    await page.keyboard.type('## Alpha\noriginal\n');
    await page.waitForTimeout(300);
    await page.click('.archive-choice .select-replacer');
    await page.click(".archive-choice .dropdown-option:has-text('Archive 1')");
    await type(page, '## Alpha\ncopy\n');
    await saveAndReload(page);

    const after = await page.evaluate(() => ({
        alpha: Object.values(Graph.nodes).filter((n) => n.getTitle() === 'Alpha').map((n) => n.textarea.value.trim()),
        taken: window.zetPaneList.map((p) => p.processor.taken.map((t) => t.title)),
    }));
    assert.deepEqual(after.alpha, ['original'], 'the note opened as its taken copy');
    assert.deepEqual(after.taken, [['Alpha'], []]);
});

// The saved card's Title was its markup, written when the card was built, and the saves also
// keep the Title in the card's saved fields -- which pointed at the wrong elements, so a
// graph saved before the markup was kept current still came back with a second, empty card.
test('a card whose saved markup has an old Title comes back under its Title, once', async () => {
    await page.evaluate(() => window.createNote('Alpha', 'body'));
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
        await App.viewGraphs.saveNow();
        const table = localforage.createInstance({ name: 'graphs', storeName: 'graph-data' });
        for (const key of await table.keys()) {
            const text = await table.getItem(key);
            if (typeof text === 'string') await table.setItem(key, text.replace('>Alpha</textarea>', '>An old title</textarea>'));
        }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => Object.keys(Graph.nodes).length > 0, undefined, { timeout: 15000 });
    await page.waitForTimeout(800);
    assert.deepEqual(await page.evaluate(() => Object.values(Graph.nodes).map((n) => n.getTitle())), ['Alpha']);
});

test("deleting an AI Node leaves a note with the same Title in its Archive", async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('AI: Helper\nsummarize\n\n## Helper\nmy note\n'));
    await page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.isLLM), undefined, { timeout: 8000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.confirm = async () => true; });
    const ai = await page.evaluateHandle(() => Object.values(Graph.nodes).find((n) => n.isLLM).view.div.querySelector('#button-delete'));
    await ai.asElement().click();
    await page.waitForFunction(() => !Object.values(Graph.nodes).some((n) => n.isLLM), undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue()), '## Helper\nmy note\n',
        "the note's section went with the AI Node");
});

test('typing a space after a Title another Archive holds, on a card, keeps the space', async () => {
    await openNotes(page);
    await type(page, '## Beta\nb\n');
    await page.click('#archiveNew');
    await page.keyboard.type('## Rust\nr\n');
    await page.waitForTimeout(300);
    // The menu closed: in the iPad's smaller window the card can land under the panel.
    await page.click('.menu-button');
    await page.waitForTimeout(400);
    const title = await page.evaluateHandle(() => Object.values(Graph.nodes).find((n) => n.getTitle() === 'Beta').view.titleInput);
    await title.asElement().click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('rust ownership');
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => Object.values(Graph.nodes).map((n) => n.getTitle()).sort()), ['Rust', 'rust ownership']);
});

test("an AI Node renamed on its card is renamed in its Archive's text", async () => {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('AI: Helper\nsummarize\n'));
    await page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.isLLM), undefined, { timeout: 8000 });
    await page.waitForTimeout(400);
    const [uuid] = await page.evaluate(() => Object.keys(Graph.nodes));
    const title = await page.evaluateHandle(() => Object.values(Graph.nodes)[0].view.titleInput);
    await title.asElement().click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue()), 'AI: HelperX\nsummarize\n');
    assert.deepEqual(await page.evaluate(() => Object.keys(Graph.nodes)), [uuid], 'the AI Node was made again');
});

test('Delete says an Archive of text will go, when none of it is a note', async () => {
    await openNotes(page);
    await type(page, '## Alpha\na\n');
    await page.click('#archiveNew');
    await page.keyboard.type('## Alpha\ntaken, and some prose\n');
    await page.waitForTimeout(300);
    await page.click('#archiveDelete');
    assert.equal(await dialog(page), 'Delete the Archive “Archive 2” and its text? None of it is a note yet.');
});

// ---- found by the Phase 3 UX review ----

// The status line is a live region: it was `hidden` until it had something to say, which a
// screen reader can pass over, and a pass at every keystroke wrote the same sentence again.
// It names a line the editor does not number, so the line is a button to it.
test('the status line says why once, and its line selects the taken Title', async () => {
    await openNotes(page);
    assert.deepEqual(await page.evaluate(() => {
        const s = document.getElementById('archiveStatus');
        return [s.hidden, s.getAttribute('role'), s.textContent];
    }), [false, 'status', ''], 'the empty status line is not in the page');
    await type(page, '## Alpha\na\n');
    await page.click('#archiveNew');
    await page.keyboard.type('Prose.\n\n## Alpha\nagain\n');
    await page.waitForTimeout(400);

    await page.evaluate(() => {
        window.statusWrites = 0;
        new MutationObserver((changes) => { window.statusWrites += changes.length; })
            .observe(document.getElementById('archiveStatus'), { childList: true, characterData: true, subtree: true });
        const cm = window.currentActiveZettelkastenMirror;
        cm.focus();
        cm.setCursor({ line: 0, ch: 6 });
    });
    await page.keyboard.type(' More of it.');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.statusWrites), 0, 'the status was written again at each keystroke');

    await page.click('#archiveStatus .archive-status-line');
    assert.deepEqual(await page.evaluate(() => {
        const cm = window.currentActiveZettelkastenMirror;
        return [cm.getSelection(), cm.getCursor().line];
    }), ['Alpha', 2]);

    // Three more taken, in a narrow window: "(" ended one line and "line 3" began the next,
    // and each button was a 32 x 18px target.
    await page.setViewportSize({ width: 400, height: 700 });
    await page.evaluate(() => window.zetPaneList[0].processor.writeAs(ZettelkastenProcessor.Pass.edit,
        () => window.zetPaneList[0].cm.replaceRange('\n## Beta\nb\n\n## Gamma\ng\n', { line: 99 })));
    await type(page, '\n## Beta\nagain\n\n## Gamma\nagain\n');
    const entries = await page.evaluate(() => [...document.querySelectorAll('#archiveStatus .archive-status-entry')].map((entry) => {
        const button = entry.querySelector('button').getBoundingClientRect();
        const x = button.left + button.width / 2;
        const edge = (y) => document.elementFromPoint(x, y)?.closest('.archive-status-line') !== null;
        return { lines: entry.getClientRects().length, target: edge(button.top - 2) && edge(button.bottom + 2) };
    }));
    assert.match((await state(page)).status ?? '', /^3 Title lines make no note.*“Alpha”.*“Beta”.*“Gamma”/);
    assert.equal(entries.length, 3, 'a line button is not kept with its "("');
    assert.deepEqual(entries, entries.map(() => ({ lines: 1, target: true })));
});

// Tab went through a dialog's text box and on into the page behind -- and a Tab typed into
// the note behind it went in as a tab: CodeMirror answered it before the dialog could.
test('a Tab in the note behind an open dialog types nothing and goes into the dialog', async () => {
    await openNotes(page);
    await type(page, '## Alpha\nbody\n');
    await page.focus('#archiveRename');
    await page.keyboard.press('Enter');
    await page.click('#zetPaneContainer .zet-pane.active .CodeMirror-lines');
    await page.keyboard.press('Tab');
    assert.deepEqual(await page.evaluate(() => [window.currentActiveZettelkastenMirror.getValue(),
        document.getElementById('customModal').contains(document.activeElement)]), ['## Alpha\nbody\n', true]);
});

// Chromium makes a list that scrolls a Tab stop of its own: from a list of fifteen Archives,
// Tab went into the list, which closed on it, and left the focus on `body`.
test('Tab from a long open list goes on to the next control', async () => {
    await openNotes(page);
    for (let i = 0; i < 14; i++) await page.click('#archiveNew');
    await page.focus('.archive-choice .select-replacer');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => {
        const list = document.querySelector('.archive-choice .options-replacer');
        return list.scrollHeight > list.clientHeight;
    }), true, 'the list of fifteen does not scroll, so this proves nothing');
    await page.keyboard.press('Tab');
    const after = await page.evaluate(() => ({
        focus: document.activeElement === document.body ? 'body' : document.activeElement.id,
        open: document.querySelector('.archive-choice .options-replacer').classList.contains('show'),
    }));
    // WebKit's Tab passes over buttons, so there it lands further on; never on `body`.
    assert.equal(after.open, false, 'the list stayed open');
    if (isIPad) assert.notEqual(after.focus, 'body');
    else assert.equal(after.focus, 'archiveNew');
});

// The dialog offered the name with the caret after it, so "Learning" made "Archive 1Learning";
// its Escape also took the menu back to the list; it gave the keyboard to `body` when it
// closed; and Tab went on out of it into the page behind.
test('Rename offers the name selected, keeps it to one line, and Escape closes only the dialog', async () => {
    await openNotes(page);
    await page.focus('#archiveRename');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => [document.getElementById('modal-title').textContent,
        document.getElementById('customModal').getAttribute('role'), document.getElementById('customModal').getAttribute('aria-modal'),
        document.querySelector('#customModal .modal-prompt-textarea').getAttribute('aria-label')]),
        ['Rename Archive', 'dialog', 'true', 'Rename the Archive “Archive 1” to:']);
    for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.getElementById('customModal').contains(document.activeElement)), true,
            'Tab left the dialog');
    }
    await page.focus('#customModal .modal-prompt-textarea');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [Modal.current, getComputedStyle(document.getElementById('tab1')).display,
        document.activeElement.id]), [null, 'block', 'archiveRename'], 'Escape left the panel, or the keyboard was not given back');

    await page.keyboard.press('Enter');
    await page.keyboard.type('Learning');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('notes');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.deepEqual((await state(page)).archives, ['Learning notes · 0 notes']);
    assert.equal(await page.evaluate(() => window.currentActiveZettelkastenMirror.getInputField().getAttribute('aria-label')),
        'Learning notes', 'the editor is not named for its Archive');
});

// Only a choice closed the list: opened with Enter, it stayed open over the next control
// once Tab had moved there.
test('the Archive list opened from the keyboard closes when the focus moves on', async () => {
    await openNotes(page);
    await page.click('#archiveNew');
    await page.focus('.archive-choice .select-replacer');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    const open = () => page.evaluate(() => document.querySelector('.archive-choice .options-replacer').classList.contains('show'));
    assert.equal(await open(), true);
    await page.keyboard.press('Tab');
    assert.equal(await open(), false, 'the list stayed open over the next control');
    assert.equal((await state(page)).shown, 'Archive 1 · 0 notes');
});
