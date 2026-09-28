import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
afterEach(async () => { await context?.close(); });

// A Graph that survives (#59, #11, #60, #61). The file is the copy that lasts and IndexedDB the
// cache, so: the Save row says how old the file is and when nothing is being kept at all; the
// file says which Graph it is a copy of; a file another device changed is not written over;
// an installed app shares the file rather than stranding a download; an older copy is asked
// about; an old text save opens; and a settings button does not take the Graphs with it.

const dir = mkdtempSync(join(tmpdir(), 'neurite-durability-'));

async function withNotes(page, text) {
    await page.evaluate(async (t) => {
        window.currentActiveZettelkastenMirror.setValue(t);
        await new Promise((r) => setTimeout(r, 1500));
        await App.viewGraphs.saveNow();
    }, text);
}
const saveNote = (page) => page.evaluate(() => {
    const n = document.getElementById('save-note');
    return { text: n.textContent, warning: n.classList.contains('is-warning') };
});
const dialogText = (page) => page.evaluate(() => (Modal.current ? document.querySelector('.modal-body').innerText : null));
const answer = (page, ok) => page.evaluate((ok) => document.querySelector(ok ? '.modal-body .modal-ok' : '.modal-body .modal-cancel').click(), ok);
const openMenu = (page) => page.evaluate(() => { if (!dropdownContent.classList.contains('open')) menuButton.click(); });
const titles = (page) => page.evaluate(() => Object.values(Graph.nodes).map((n) => n.getTitle()).sort());

// Chromium has a file picker, and this browser's download path is the one to test here.
const noPicker = { setup: (ctx) => ctx.addInitScript(() => { delete window.showSaveFilePicker; }) };

// Save to…, OK on the name, and the file it downloaded: its name and its header.
async function download(page) {
    await openMenu(page);
    await page.click('#disk-file-button');
    await page.waitForFunction(() => Boolean(Modal.current), undefined, { timeout: 5000 });
    const [file] = await Promise.all([page.waitForEvent('download'), answer(page, true)]);
    const path = join(dir, String(Date.now()) + '-' + file.suggestedFilename());
    await file.saveAs(path);
    const bytes = readFileSync(path);
    return { path, name: file.suggestedFilename(), header: JSON.parse(bytes.subarray(0, bytes.indexOf(0)).toString('utf8')) };
}

test('the Save row says whether the Graph is in a file yet, and the file says which Graph it is', async () => {
    ({ context, page } = await openNeurite(browser, noPicker));
    await withNotes(page, '## Alpha\nFirst.\n');
    await openMenu(page);
    const persisted = await page.evaluate(() => navigator.storage.persisted());
    const before = await saveNote(page);
    assert.match(before.text, /^Not saved to a file yet/);
    assert.equal(before.warning, !persisted, 'the risk is said where the browser does not keep its storage, and only there');

    const { name, header } = await download(page);
    assert.equal(name, 'Graph.neurite');
    assert.equal(header.v, 1, 'the file carries no format version');
    assert.match(header.meta.uuid, /^[0-9a-f]{32}$/);
    assert.equal(typeof header.meta.updatedAt, 'number');
    assert.ok(header.meta.revisions >= 1);
    assert.equal(header.meta.device, isIPad ? 'iPad' : 'Mac');
    await page.waitForTimeout(300);
    assert.deepEqual(await saveNote(page), { text: 'Saved to a file just now.', warning: false });
});

test('installed, Save to… hands the file to the share sheet', async () => {
    ({ context, page } = await openNeurite(browser, { setup: (ctx) => ctx.addInitScript(() => {
        delete window.showSaveFilePicker;
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q) => (q === '(display-mode: browser)' ? { matches: false, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
        window.shared = [];
        navigator.canShare = (d) => Boolean(d?.files?.length);
        navigator.share = async (d) => { window.shared.push(d.files.map((f) => [f.name, f.type, f.size > 0])); };
    }) }));
    await withNotes(page, '## Alpha\nFirst.\n');
    await openMenu(page);
    assert.match(await page.getAttribute('#disk-file-button', 'title'), /^Share this graph/);
    await page.click('#disk-file-button');
    await page.waitForFunction(() => Boolean(Modal.current), undefined, { timeout: 5000 });
    await answer(page, true);
    await page.waitForFunction(() => window.shared.length > 0, undefined, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.shared), [[['Graph.neurite', 'application/octet-stream', true]]]);
    await page.waitForTimeout(300);
    assert.equal((await saveNote(page)).text, 'Saved to a file just now.');
});

test('a file another device changed is not written over, and the Save row says so', { skip: isIPad && 'no file picker in WebKit' }, async () => {
    // The Mac mirrors every autosave to a file in iCloud Drive; the iPad saves over the same
    // file. The picker is stood in for by a file whose `lastModified` the test moves.
    ({ context, page } = await openNeurite(browser, { setup: (ctx) => ctx.addInitScript(() => {
        window.file = { name: 'Graph.neurite', lastModified: 1000, writes: 0 };
        window.showSaveFilePicker = async () => ({
            queryPermission: async () => 'granted',
            getFile: async () => ({ name: window.file.name, lastModified: window.file.lastModified }),
            createWritable: async () => ({ write: async () => { window.file.writes++; }, close: async () => { window.file.lastModified++; } }),
        });
    }) }));
    await withNotes(page, '## Alpha\nFirst.\n');
    await openMenu(page);
    await page.click('#disk-file-button');
    await page.waitForFunction(() => window.file.writes === 1, undefined, { timeout: 5000 });
    assert.equal(await page.textContent('#disk-file-button .menu-row-label'), 'Saving to file');

    await page.evaluate(() => { window.file.lastModified += 5000; });
    await withNotes(page, '## Alpha\nFirst, edited here.\n');
    await page.waitForFunction(() => Boolean(Modal.current), undefined, { timeout: 5000 });
    assert.match(await dialogText(page), /Graph\.neurite was changed on another device/);
    await answer(page, true);
    assert.equal(await page.evaluate(() => window.file.writes), 1, "the other device's file was written over");
    const note = await saveNote(page);
    assert.match(note.text, /^Graph\.neurite was changed on another device, so it was not written over/);
    assert.equal(note.warning, true);
    assert.equal(await page.textContent('#disk-file-button .menu-row-label'), 'Save to…');
});

test('opening an older copy of the Graph on screen asks first, and No keeps the screen', async () => {
    ({ context, page } = await openNeurite(browser, noPicker));
    await withNotes(page, '## Alpha\nFirst.\n');
    const { path } = await download(page);
    await page.evaluate(() => menuButton.click());
    await page.waitForTimeout(600);
    await withNotes(page, '## Alpha\nFirst, and more since.\n');

    await page.setInputFiles('#open-file-input', path);
    await page.waitForFunction(() => Boolean(Modal.current), undefined, { timeout: 5000 });
    assert.match(await dialogText(page), /This file is an older copy of the graph on screen/);
    await answer(page, false);
    await page.waitForTimeout(800);
    assert.match(await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue()), /and more since/,
        'the answer was No, and the older copy opened anyway');
});

test('an old save, the markup as text, opens', async () => {
    ({ context, page } = await openNeurite(browser));
    await withNotes(page, '## Old one\nFrom the old file.\n');
    const markup = await page.evaluate(async () => {
        const db = await new Promise((ok) => { const r = indexedDB.open('graphs'); r.onsuccess = () => ok(r.result); });
        return new Promise((ok) => { const q = db.transaction('graph-data').objectStore('graph-data').getAll(); q.onsuccess = () => ok(q.result.at(-1)); });
    });
    const path = join(dir, 'old-save.txt');
    writeFileSync(path, markup);
    await withNotes(page, '## Current\nOn screen now.\n');

    await page.setInputFiles('#open-file-input', path);
    await page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.getTitle() === 'Old one'), undefined, { timeout: 8000 });
    assert.deepEqual(await titles(page), ['Old one']);
});

test('Clear Local Storage keeps the Graphs', async () => {
    // It dropped every Graph in the browser under a tooltip saying they were untouched.
    ({ context, page } = await openNeurite(browser));
    await withNotes(page, '## Alpha\nFirst.\n\n## Beta\nSecond.\n');
    await page.evaluate(() => document.getElementById('clearLocalStorage').click());
    await page.waitForFunction(() => Boolean(Modal.current), undefined, { timeout: 5000 });
    assert.match(await dialogText(page), /Your graphs are kept/);
    await answer(page, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 2, undefined, { timeout: 15000 });
    assert.deepEqual(await titles(page), ['Alpha', 'Beta']);
});

test('a Graph that did not reopen is said to be unsaved, where it was only logged', async () => {
    ({ context, page } = await openNeurite(browser));
    await withNotes(page, '## Alpha\nFirst.\n');
    // The stored markup made unreadable: the restore throws on it.
    await page.evaluate(async () => {
        const db = await new Promise((ok) => { const r = indexedDB.open('graphs'); r.onsuccess = () => ok(r.result); });
        const store = db.transaction('graph-data', 'readwrite').objectStore('graph-data');
        const keys = await new Promise((ok) => { const q = store.getAllKeys(); q.onsuccess = () => ok(q.result); });
        await new Promise((ok) => { const q = store.put(null, keys.at(-1)); q.onsuccess = ok; });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('save-note').textContent.length > 0, undefined, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const note = await saveNote(page);
    assert.match(note.text, /^The last graph did not reopen, so nothing is being saved/);
    assert.equal(note.warning, true);
});

// "Complete" is what the exporter writes (#61), pinned by a round trip with one Node of every
// type: made on one page, saved to a file, opened on a page with empty storage.
test('one Node of every type comes back from a file', async () => {
    ({ context, page } = await openNeurite(browser, noPicker));
    await page.evaluate(async () => {
        const settle = (ms) => new Promise((r) => setTimeout(r, ms));
        await window.createNote('Text note', 'A body.');
        createLlmNode('Ai note');
        new LinkNode('https://example.com/', 'Example');
        FileTreeNode.create('/');
        const table = Html.new.div();
        table.textContent = '4';
        createWolframNode({ table, reformulatedQuery: '2+2' });

        // An image and a sound, dropped as files are.
        const png = await new Promise((ok) => {
            const c = document.createElement('canvas');
            c.width = 8; c.height = 6;
            c.getContext('2d').fillRect(0, 0, 8, 6);
            c.toBlob(ok, 'image/png');
        });
        const rate = 8000, n = 800, wav = new DataView(new ArrayBuffer(44 + n * 2));
        const put = (o, s) => [...s].forEach((ch, i) => wav.setUint8(o + i, ch.charCodeAt(0)));
        put(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); put(8, 'WAVEfmt '); wav.setUint32(16, 16, true);
        wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true);
        wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); put(36, 'data'); wav.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.round(8000 * Math.sin(i / 3)), true);
        const dt = new DataTransfer();
        dt.items.add(new File([png], 'dot.png', { type: 'image/png' }));
        dt.items.add(new File([wav.buffer], 'tone.wav', { type: 'audio/wav' }));
        document.getElementById('neurite-workspace').dispatchEvent(
            new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
        await settle(1500);
        Graph.forEachNode(Node.stopFollowingMouse);
        await settle(500);
        await App.viewGraphs.saveNow();
    });
    const describe = (page) => page.evaluate(() => Object.values(Graph.nodes).map((n) => {
        const img = n.content.querySelector('img'), audio = n.content.querySelector('audio');
        return [Node.getType(n), n.getTitle(),
            img ? (img.src.startsWith('blob:') && img.naturalWidth === 8 ? 'image 8px' : 'image broken: ' + img.src.slice(0, 20)) : '',
            audio ? (audio.src.startsWith('blob:') ? 'audio' : 'audio broken') : ''].join('|');
    }).sort());
    const made = await describe(page);
    assert.equal(made.length, 7, 'the page did not make one Node of every type: ' + JSON.stringify(made));

    // Through a reload first, the path every visit takes: a dropped sound was kept by
    // neither, and came back as a player with nothing to play.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction((n) => Object.keys(Graph.nodes).length === n, made.length, { timeout: 10000 });
    await page.waitForTimeout(1500);
    assert.deepEqual(await describe(page), made, 'a reload lost part of a Node');

    const { path } = await download(page);
    await context.close();

    ({ context, page } = await openNeurite(browser));
    await page.setInputFiles('#open-file-input', path);
    await page.waitForFunction((n) => Object.keys(Graph.nodes).length === n, made.length, { timeout: 10000 });
    await page.waitForTimeout(1500);
    assert.deepEqual(await describe(page), made);
});
