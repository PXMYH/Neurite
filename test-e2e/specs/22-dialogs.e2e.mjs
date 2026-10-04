import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, addNote, nodeDiv, paneText, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The dialogs that wait for an answer -- an alert, a confirm and a prompt -- and the delete of a
// note, the one most often met. It opened under the tool pill as a tool modal does, over a page
// that went on taking clicks, asked `Delete "Chunking"?` under the title "Confirm", and was
// answered on two bevelled half-width buttons, Yes and No.

// What the open dialog says and where it is. `behind` is whether a point at the window's left
// edge lands on the dialog's own frame, which is the dimmed page that takes the clicks.
const dialog = (page) => page.evaluate(() => {
    const m = Modal.div, box = Modal.content.getBoundingClientRect();
    return {
        id: Modal.current?.id ?? null,
        title: m.querySelector('.modal-title').textContent,
        message: m.querySelector('.confirm-message, .alert-message, .modal-prompt-message')?.textContent ?? null,
        buttons: [...m.querySelectorAll('.modal-actions button')].map((b) => b.textContent.trim()),
        danger: m.querySelector('.modal-ok')?.classList.contains('danger') ?? null,
        focused: document.activeElement?.textContent?.trim() ?? null,
        centre: [box.left + box.width / 2 - innerWidth / 2, box.top + box.height / 2 - innerHeight / 2].map(Math.round),
        behind: document.elementFromPoint(8, innerHeight / 2) === m,
        describedBy: document.getElementById(m.getAttribute('aria-describedby'))?.textContent ?? null,
    };
});
const titles = (page) => page.evaluate(() => Object.values(Graph.nodes).map((n) => n.getTitle()).sort());
// A press on the dimmed page, at the window's left edge, where no dialog reaches.
const pressBehind = (page) => page.evaluate(() => innerHeight / 2)
    .then((y) => (isIPad ? page.touchscreen.tap(8, y) : page.mouse.click(8, y)));

test("a note's × asks in the middle of a dimmed page, by its Title, and is answered Cancel or Delete", async () => {
    const uuid = await addNote(page, 'Chunking', 'Cutting documents into pieces.');
    await addNote(page, 'Evaluation', 'Judging the answers.');
    const ask = async () => {
        await (await (await nodeDiv(page, uuid)).$('#button-delete')).click();
        await page.waitForFunction(() => Modal.current?.id === 'confirmModal');
        await page.waitForTimeout(250);
        return dialog(page);
    };
    const d = await ask();
    assert.deepEqual({ ...d, centre: undefined }, {
        id: 'confirmModal',
        title: 'Delete “Chunking”?',
        message: 'This also deletes its text in the Notes panel.',
        buttons: ['Cancel', 'Delete'],
        danger: true,
        // The answer that changes nothing has the keyboard, and Enter.
        focused: 'Cancel',
        centre: undefined,
        behind: true,
        describedBy: 'This also deletes its text in the Notes panel.',
    });
    assert.ok(Math.abs(d.centre[0]) <= 1 && Math.abs(d.centre[1]) <= 1, `off centre by ${d.centre}`);
    // No ×: Cancel and Escape answer, and the × answered nothing a reader could see.
    assert.equal(await page.evaluate(() => getComputedStyle(Modal.div.querySelector('.close')).display), 'none');
    // A finger's target on a touch screen.
    const heights = await page.evaluate(() => [...Modal.div.querySelectorAll('.modal-actions button')].map((b) => b.getBoundingClientRect().height));
    for (const h of heights) assert.ok(h >= (isIPad ? 44 : 32), `a button is ${h}px tall`);

    await page.click('#customModal .modal-cancel');
    await page.waitForTimeout(200);
    assert.deepEqual(await titles(page), ['Chunking', 'Evaluation'], 'Cancel deleted the note');

    await ask();
    await page.click('#customModal .modal-ok');
    await page.waitForFunction((id) => !(id in Graph.nodes), uuid, { timeout: 5000 });
    assert.deepEqual(await titles(page), ['Evaluation']);
    assert.ok(!(await paneText(page)).includes('Chunking'), 'the text in the Notes panel stayed');
    assert.deepEqual(errors, []);
});

// A click beside a question is Cancel for a confirm and OK for an alert. Nothing else reaches the
// page behind: a right-click there opened the context menu over the dialog, a press took the
// keyboard to `body`, and with the focus even on Cancel, `1` made a note behind the question.
test('a click beside a confirm or an alert answers it, and nothing else reaches the page behind', async () => {
    const at = await page.evaluate(() => [8, innerHeight / 2]);
    const ask = (kind) => page.evaluate((kind) => {
        window.answer = 'pending';
        window[kind]('A question?').then((v) => { window.answer = (v === undefined ? 'answered' : v); });
    }, kind);
    const now = () => page.evaluate(() => ({
        open: Modal.current?.id ?? null, answer: window.answer, nodes: Object.keys(Graph.nodes).length,
        menu: getComputedStyle(document.getElementById('customContextMenu')).display,
        focused: document.activeElement?.textContent?.trim(),
    }));

    await ask('confirm');
    await page.waitForTimeout(250);
    assert.equal((await dialog(page)).behind, true, 'the page behind the confirm is not covered');
    if (!isIPad) await page.mouse.click(at[0], at[1], { button: 'right' });
    await page.keyboard.press('1');
    await page.waitForTimeout(300);
    assert.deepEqual(await now(), { open: 'confirmModal', answer: 'pending', nodes: 0, menu: 'none', focused: 'Cancel' },
        'a right-click or a key reached the page behind the question');
    await pressBehind(page);
    await page.waitForTimeout(600);   // past a double-click's interval: the next click is one of its own
    assert.deepEqual([(await now()).open, (await now()).answer], [null, false], 'a click beside the confirm is no Cancel');

    await ask('alert');
    await page.waitForTimeout(250);
    await pressBehind(page);
    await page.waitForTimeout(600);
    assert.deepEqual([(await now()).open, (await now()).answer], [null, 'answered'], 'a click beside the alert does not answer it');

    // A prompt keeps what is typed into it, and the caret, through a press beside it.
    await page.evaluate(() => { window.answer = 'pending'; window.prompt('Save this graph as:', 'Draft', 'Save Graph').then((v) => { window.answer = v; }); });
    await page.waitForTimeout(250);
    await page.keyboard.type('Final');
    await pressBehind(page);
    await page.keyboard.type(' copy');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.answer), 'Final copy');

    // A press on a dialog's own text leaves the keyboard in the dialog, where the page's keys
    // do not reach: it went to `body`, and the arrows and `0` moved the Graph behind it.
    await page.evaluate(() => { window.confirm('', { title: 'Delete “Alpha”?', ok: 'Delete', danger: true }); });
    await page.waitForTimeout(250);
    const title = await page.evaluate(() => { const r = Modal.div.querySelector('.modal-title').getBoundingClientRect(); return [r.left + 8, r.top + r.height / 2]; });
    if (isIPad) await page.touchscreen.tap(title[0], title[1]); else await page.mouse.click(title[0], title[1]);
    const zoom = await page.evaluate(() => Graph.zoom.mag());
    await page.keyboard.press('0');
    await page.keyboard.press('1');
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [Modal.div.contains(document.activeElement), Graph.zoom.mag(), Object.keys(Graph.nodes).length]),
        [true, zoom, 0], 'the keys reached the Graph behind the dialog');
    assert.deepEqual(errors, []);
});

// The first click of a double-click beside the question closes it, so the second came down on
// the Graph behind it, where a double-click makes a note and a click on bare Graph clears the
// selection. The rest of a double-click is the dialog's; a click elsewhere straight after lands.
test('a double-click beside the delete question closes it, and leaves the Graph and the selection alone', async () => {
    const a = await addNote(page, 'Alpha', 'a');
    const b = await addNote(page, 'Beta', 'b');
    await page.evaluate((id) => App.selectedNodes.toggleNode(Graph.nodes[id]), a);
    const ask = () => page.evaluate((id) => {
        window.answer = 'pending';
        confirmNodeDelete([Graph.nodes[id]]).then((v) => { window.answer = v; });
    }, b);
    const at = await page.evaluate(() => [8, Math.round(innerHeight / 2)]);
    await ask();
    await page.waitForTimeout(250);
    if (isIPad) {
        await page.touchscreen.tap(at[0], at[1]);
        await page.touchscreen.tap(at[0] + 1, at[1] + 1);
    } else await page.mouse.dblclick(at[0], at[1]);
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => [Modal.current?.id ?? null, window.answer, Object.keys(Graph.nodes).length, App.selectedNodes.uuids.size]),
        [null, false, 2, 1], 'the rest of the double-click reached the Graph behind the question');

    if (isIPad) return;
    await page.evaluate(() => Hud.zoomBy(1.6));
    await page.waitForTimeout(300);
    await ask();
    await page.waitForTimeout(250);
    await page.mouse.click(at[0], at[1]);
    const home = await page.evaluate(() => {
        const r = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Home' && x.offsetParent).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
    });
    const zoom = await page.evaluate(() => Graph.zoom.mag());
    await page.mouse.click(home[0], home[1]);
    await page.waitForTimeout(800);
    assert.notEqual(await page.evaluate(() => Graph.zoom.mag()), zoom, 'a click on Home straight after was taken for the rest of a double-click');
});

// A drag that selects the message and is let go past the dialog's edge sends its click to the
// common ancestor of its two ends, which is the dimmed page.
test('a press in the dialog let go on the dimmed page is no answer, and does not move it',
     { skip: isIPad && 'a mouse drag' }, async () => {
    await page.evaluate(() => { window.answer = 'pending'; window.confirm('', { title: 'Delete “Alpha”?', ok: 'Delete', danger: true }).then((v) => { window.answer = v; }); });
    await page.waitForTimeout(250);
    const at = await page.evaluate(() => { const r = Modal.div.querySelector('.modal-title').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.move(8, at[1] + 200, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const d = await dialog(page);
    assert.deepEqual([d.id, await page.evaluate(() => window.answer)], ['confirmModal', 'pending']);
    assert.ok(Math.abs(d.centre[0]) <= 1 && Math.abs(d.centre[1]) <= 1, `moved to ${d.centre}`);
    // An empty message is no line of the dialog, and describes nothing.
    assert.equal(d.describedBy, null);
});

// A tool modal is dragged by its frame, which is the dimmed page of a dialog that asks: one
// opened after a drag was off centre, with a strip of the Graph undimmed and in reach.
test('after a tool modal is dragged aside, a dialog that asks still opens in the middle',
     { skip: isIPad && 'a mouse drag' }, async () => {
    await page.evaluate(() => Modal.open('zetSearchModal'));
    const at = await page.evaluate(() => { const r = Modal.div.querySelector('.modal-title').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.move(at[0] - 400, at[1] + 200, { steps: 5 });
    await page.mouse.up();
    assert.notEqual(await page.evaluate(() => Modal.div.style.left), '', 'the tool modal did not move');

    await page.evaluate(() => { window.confirm('A question?'); });
    await page.waitForTimeout(250);
    const d = await dialog(page);
    assert.ok(Math.abs(d.centre[0]) <= 1 && Math.abs(d.centre[1]) <= 1, `off centre by ${d.centre}`);
    assert.equal(d.behind, true);
});

test('a long message keeps its lines and scrolls, with its buttons on screen', async () => {
    await page.evaluate(() => {
        const keys = Array.from({ length: 60 }, (_, i) => `papers/retrieval-${i + 1}.pdf`);
        window.confirm('Are you sure you want to delete the following keys?\n\n' + keys.join('\n') + '\n\nThis action cannot be undone.');
    });
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
        const msg = Modal.div.querySelector('.confirm-message'), box = Modal.content.getBoundingClientRect();
        const ok = Modal.div.querySelector('.modal-ok').getBoundingClientRect();
        // One key to a line: the first key's line holds nothing else.
        const range = document.createRange();
        range.selectNodeContents(msg);
        const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
        return { scrolls: msg.scrollHeight > msg.clientHeight, inWindow: box.top >= 0 && box.bottom <= innerHeight, okShown: ok.bottom <= box.bottom, lines };
    });
    assert.deepEqual({ ...m, lines: m.lines >= 64 }, { scrolls: true, inWindow: true, okShown: true, lines: true }, JSON.stringify(m));
});
