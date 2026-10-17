import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, openSettings, addAiNote } from './helpers.mjs';
import { FakeGoogle } from '../fixtures/fake-google.mjs';
import { withFakeGoogle } from '../fixtures/drive-page.mjs';

let browser;
const contexts = [];
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
afterEach(async () => { for (const c of contexts.splice(0)) await c.close().catch(() => {}); });

// Cloud sync to Google Drive (docs/cloud-sync.md), in a browser, against a fake Google
// (fixtures/fake-google.mjs) that holds Drive's files, uploads and tokens as Drive does. The page
// is given a client id and a stand-in for Google's sign-in script (fixtures/drive-page.mjs); the
// sync's own timers are shortened in the page, and the autosave is asked for rather than waited.

async function device(fake, { answer } = {}) {
    const d = await openNeurite(browser, { setup: (context) => withFakeGoogle(context, fake, { answer }) });
    contexts.push(d.context);
    await d.page.waitForFunction(() => App.cloudSync?.status.phase !== 'starting', undefined, { timeout: 20000 });
    await d.page.evaluate(() => { CloudSync.QUIET_MS = 300; CloudSync.MAX_WAIT_MS = 2000; CloudSync.RETRY_MS = [400, 400, 400] });
    return d;
}
// A save as the eight-second autosave makes one: `saveNow` is the quit's, which also sends what is
// pending at once, so the hook it calls is left out here.
const SAVE = `(async () => { const v = App.viewGraphs, keep = v.onSavedNow; v.onSavedNow = null;
                             try { await v.saveNow() } finally { v.onSavedNow = keep } })()`;
const save = (page) => page.evaluate(SAVE);
const write = async (page, text) => {
    await page.evaluate((t) => window.currentActiveZettelkastenMirror.setValue(t), text);
    await page.waitForTimeout(600);
    await save(page);
};
const edit = async (page, from, to) => {
    await page.evaluate(([from, to]) => { const cm = window.currentActiveZettelkastenMirror; cm.setValue(cm.getValue().replace(from, to)) }, [from, to]);
    await page.waitForTimeout(300);
    await save(page);
};
async function connect(page, { pushes = true } = {}) {
    await openSettings(page, 'sync');
    // Google's script is loaded as the page shows, so that the click can open its popup in its
    // own turn; a click before it is here is told to click again.
    await page.waitForFunction(() => window.google?.accounts?.oauth2, undefined, { timeout: 10000 });
    await page.click('#sync-connect');
    await page.waitForFunction(() => App.cloudSync.isConnected, undefined, { timeout: 10000 });
    if (pushes) await page.waitForFunction(() => App.cloudSync.status.lastPushAt, undefined, { timeout: 10000 });
}
const settled = (page) => page.evaluate(async () => { await App.cloudSync.flush(); return App.cloudSync.status });
const graphs = (fake) => [...fake.files.values()].filter((f) => f.name.endsWith('.neurite') && !f.trashed);
const uploads = (fake) => fake.calls.filter((c) => c.path.startsWith('/upload/') && !c.query.upload_id).length;
// What a `.neurite` file says: its header (to the first NUL) and the Graph's markup in it.
function bundleOf(file) {
    const nul = file.content.indexOf(0);
    return JSON.parse(file.content.subarray(0, nul < 0 ? file.content.length : nul).toString('utf8'));
}
// The Graph's markup in a file, with the Pane's text in it decoded: the rest holds a `%` of its own.
const textOf = (file) => bundleOf(file).data.replace(/(?:%[0-9A-Fa-f]{2})+/g, (s) => { try { return decodeURIComponent(s) } catch { return s } });
// Another device's save of the same Graph: the same file with other words in it -- in the Pane's
// text, encoded, and in the card's, as they are -- so that it opens as it was saved.
function savedElsewhere(file, from, to, device = 'iPad') {
    const nul = file.content.indexOf(0);
    const head = bundleOf(file);
    head.data = head.data.split(encodeURIComponent(from)).join(encodeURIComponent(to)).split(from).join(to);
    head.meta = { ...head.meta, device, revisions: (head.meta?.revisions ?? 0) + 5, updatedAt: Date.now() };
    return Buffer.concat([Buffer.from(JSON.stringify(head)), nul < 0 ? Buffer.alloc(0) : file.content.subarray(nul)]);
}

test("Connect in Settings → Sync puts the Graph on screen in Neurite's folder in Drive, as a .neurite file", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    assert.equal(await page.locator('#sync-connect').textContent(), 'Connect');
    await write(page, '## Alpha\nWritten on this device.\n');
    await connect(page);
    await settled(page);

    const folders = [...fake.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    assert.deepEqual(folders.map((f) => [f.name, f.parents, f.appProperties.neuriteFolder]), [['Neurite', ['root'], '1']]);
    const [file] = graphs(fake);
    assert.ok(file, 'no .neurite file went up');
    assert.deepEqual(file.parents, [folders[0].id]);
    const meta = await page.evaluate(() => App.viewGraphs.selectedMeta);
    assert.equal(file.appProperties.neuriteUuid, meta.uuid);
    assert.ok(Number(file.appProperties.neuriteRevisions) >= 1);
    assert.ok(textOf(file).includes('Written on this device.'), 'the file does not hold the note');
    assert.equal(bundleOf(file).meta.uuid, meta.uuid);
    // And Settings says so.
    assert.match(await page.locator('#sync-note').textContent(), /Connected as reader@example\.com/);
    assert.match(await page.locator('#sync-graph-note').textContent(), /Synced just now/);
    assert.match(await page.locator('#sync-files').textContent(), /Graph 1/);
    assert.deepEqual(errors, []);
});

test("an edit goes up after its quiet; a pan alone sends nothing, and an AI note's answer does", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nFirst words.\n');
    await connect(page);
    await settled(page);
    const before = uploads(fake);

    await page.evaluate(() => Graph.pan_set(Graph.pan.plus(new vec2(0.3, 0.2))));
    await page.waitForTimeout(300);
    await save(page);
    await page.waitForTimeout(1500);
    await settled(page);
    assert.equal(uploads(fake), before, 'a pan went up');

    await edit(page, 'First words.', 'Second words.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(uploads(fake), before + 1, 'the edit did not go up after its quiet');
    assert.ok(textOf(graphs(fake)[0]).includes('Second words.'));
    assert.equal(graphs(fake).length, 1, 'an edit made a second file');

    // An AI note's answer is the Graph's too, though no Pane holds it (its prompt is the Pane's).
    await addAiNote(page, 'Gamma');
    await page.waitForTimeout(900);
    await settled(page);
    const withAi = uploads(fake);
    // Where the answer goes as it streams in (`ResponseHandler`).
    await page.evaluate(() => { Object.values(Graph.nodes).find((n) => n.isLLM).aiResponseTextArea.value = 'Answered on this device.' });
    await save(page);
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(uploads(fake), withAi + 1, "an AI note's answer did not go up");
    assert.ok(bundleOf(graphs(fake)[0]).data.includes('Answered on this device.'));
    assert.deepEqual(errors, []);
});

test('a Graph with no note goes nowhere, and a Graph changed on another device is not written over', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await connect(page, { pushes: false });
    await page.waitForTimeout(800);
    await settled(page);
    assert.deepEqual(graphs(fake), [], 'an empty canvas went up');
    assert.match(await page.locator('#sync-graph-note').textContent(), /once it has a note/);

    await write(page, '## Alpha\nWords here.\n');
    await page.waitForTimeout(900);
    await settled(page);
    const [file] = graphs(fake);
    fake.writeElsewhere(file.id, savedElsewhere(file, 'Words here.', 'Words from the iPad.'), { neuriteDevice: 'iPad', neuriteSignature: 'ipad-content' });

    await edit(page, 'Words here.', 'Words from this device.');
    await page.waitForTimeout(900);
    const status = await settled(page);
    assert.ok(status.conflict, 'no conflict was said');
    const after = graphs(fake);
    assert.equal(after.length, 2);
    const original = fake.files.get(file.id), copy = after.find((f) => f.id !== file.id);
    assert.ok(textOf(original).includes('Words from the iPad.'), "the other device's copy was written over");
    assert.ok(textOf(copy).includes('Words from this device.'), "this device's version did not go up");
    assert.equal(copy.appProperties.neuriteConflictOf, file.id);
    assert.match(copy.name, /^Graph 1 \(conflict, (Mac|iPad), \d{4}-\d\d-\d\d \d\d\.\d\d\)\.neurite$/);
    // Bound to the copy from then on: the next edit goes to it, and the iPad's file stays as it is.
    await edit(page, 'Words from this device.', 'More words from this device.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.ok(textOf(fake.files.get(copy.id)).includes('More words from this device.'));
    assert.ok(textOf(fake.files.get(file.id)).includes('Words from the iPad.'));
    await openSettings(page, 'sync');
    assert.match(await page.locator('#sync-graph-note').textContent(), /changed here and on another device/);
    assert.equal(await page.locator('#sync-graph-action').textContent(), 'Open the other copy');
    assert.deepEqual(errors, []);
});

// A pan on the other device changes the file and not its content (its `neuriteSignature` is the
// same): that is no conflict and no newer copy, and this device's next edit goes to the same file.
test('a change elsewhere to how the Graph is viewed is no conflict and no newer copy', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nThe same words.\n');
    await connect(page);
    await settled(page);
    const [file] = graphs(fake);
    fake.writeElsewhere(file.id, Buffer.concat([file.content, Buffer.from(' ')]), { neuriteDevice: 'iPad' });
    assert.equal(await page.evaluate(() => App.cloudSync.check()), null, 'a pan elsewhere was offered as a newer copy');
    await edit(page, 'The same words.', 'The same words, and more.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(graphs(fake).length, 1, 'a pan elsewhere made a conflict copy');
    assert.ok(textOf(fake.files.get(file.id)).includes('and more.'));
    assert.deepEqual(errors, []);
});

test('a newer copy in Drive is offered and opened only when asked, bound to its file', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nOld words.\n');
    // An AI note saves its settings one way new and another reopened: the same content.
    await addAiNote(page, 'Gamma');
    await page.waitForTimeout(600);
    await save(page);
    await connect(page);
    await settled(page);
    const [file] = graphs(fake);
    fake.writeElsewhere(file.id, savedElsewhere(file, 'Old words.', 'Newer words from the iPad.'), { neuriteDevice: 'iPad', neuriteSignature: 'ipad-content' });

    await page.evaluate(() => App.cloudSync.check());
    await openSettings(page, 'sync');
    assert.match(await page.locator('#sync-graph-note').textContent(), /A newer copy is in Google Drive, saved on the iPad/);
    assert.match(await page.evaluate(() => window.currentActiveZettelkastenMirror.getValue()), /Old words\./, 'the newer copy was loaded on its own');

    const count = uploads(fake);
    await page.click('#sync-graph-action');
    await page.waitForFunction(() => /Newer words from the iPad/.test(window.currentActiveZettelkastenMirror.getValue()), undefined, { timeout: 10000 });
    await save(page);
    await page.waitForTimeout(900);
    assert.equal(uploads(fake), count, 'opening the newer copy sent it straight back up');
    // Bound to the same file: an edit now goes to it.
    await edit(page, 'Newer words from the iPad.', 'Newer words, and more.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(graphs(fake).length, 1);
    assert.ok(textOf(fake.files.get(file.id)).includes('Newer words, and more.'));
    assert.deepEqual(errors, []);
});

test("a second device opens the Graph from Settings → Sync's list, and its edits go to the same file", async () => {
    const fake = new FakeGoogle();
    const a = await device(fake);
    await write(a.page, '## Alpha\nWritten on A.\n');
    await connect(a.page);
    await settled(a.page);

    const b = await device(fake);
    await connect(b.page, { pushes: false });
    await b.page.waitForFunction(() => document.querySelectorAll('#sync-files [role=listitem]').length === 1, undefined, { timeout: 10000 });
    await b.page.click('#sync-files [role=listitem] button');
    await b.page.waitForFunction(() => /Written on A\./.test(window.currentActiveZettelkastenMirror.getValue()), undefined, { timeout: 10000 });
    assert.equal(await b.page.evaluate(() => App.viewGraphs.selectedMeta.uuid), await a.page.evaluate(() => App.viewGraphs.selectedMeta.uuid));
    await edit(b.page, 'Written on A.', 'Written on A, then on B.');
    await b.page.waitForTimeout(900);
    await settled(b.page);
    assert.equal(graphs(fake).length, 1, 'B made a file of its own');
    assert.ok(textOf(graphs(fake)[0]).includes('then on B'));
    assert.equal(graphs(fake)[0].name, 'Graph 1.neurite', 'the file took the name B gave its copy');
    assert.deepEqual([...a.errors, ...b.errors], []);
});

test('a file removed from Drive is not made again until Sync it again is asked for', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nKept.\n');
    await connect(page);
    await settled(page);
    const [file] = graphs(fake);
    fake.files.get(file.id).trashed = true;

    await edit(page, 'Kept.', 'Kept, and changed.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.deepEqual(graphs(fake), [], 'the file was made again');
    await openSettings(page, 'sync');
    assert.match(await page.locator('#sync-graph-note').textContent(), /was removed from Google Drive/);
    await page.click('#sync-graph-action');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(graphs(fake).length, 1, 'Sync it again made no file');
    assert.ok(textOf(graphs(fake)[0]).includes('Kept, and changed.'));
    assert.deepEqual(errors, []);
});

test("a create whose answer never came is not made twice; the browser's hour runs out into Connect again", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nOnce.\n');
    // The first create's answer is lost after Drive made the file.
    const real = fake.handle.bind(fake);
    let lose = 1;
    fake.handle = async (req) => {
        const res = await real(req);
        if (lose > 0 && /\/upload\/drive\/v3\/files$/.test(new URL(req.url).pathname) && req.method === 'POST') { lose -= 1; throw new Error('the answer was lost') }
        return res;
    };
    await connect(page);
    await settled(page);
    assert.equal(graphs(fake).length, 1);
    await edit(page, 'Once.', 'Once, and again.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(graphs(fake).length, 1, 'the lost answer made a second file');
    assert.ok(textOf(graphs(fake)[0]).includes('Once, and again.'));
    fake.handle = real;

    // The hour is up: nothing goes up, and Sync asks for a click.
    fake.accessTokens.clear();
    await edit(page, 'Once, and again.', 'Once more.');
    await page.waitForTimeout(900);
    await settled(page);
    await openSettings(page, 'sync');
    await page.waitForFunction(() => App.cloudSync.status.phase === 'needs-click', undefined, { timeout: 5000 });
    assert.equal(await page.locator('#sync-connect').textContent(), 'Connect again');
    assert.ok(!textOf(graphs(fake)[0]).includes('Once more.'));
    await page.click('#sync-connect');
    await page.waitForFunction(() => App.cloudSync.isConnected, undefined, { timeout: 10000 });
    await page.waitForTimeout(900);
    await settled(page);
    assert.ok(textOf(graphs(fake)[0]).includes('Once more.'), 'connected again, the change did not go up');
    assert.deepEqual(errors, []);
});

test('only the tab that holds the autosave lock pushes, and Disconnect stops it', async () => {
    const fake = new FakeGoogle();
    const { page, context, errors } = await device(fake);
    await write(page, '## Alpha\nFrom the first tab.\n');
    await connect(page);
    await settled(page);
    const second = await context.newPage();
    await second.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await second.waitForFunction(() => window.appReady === true && App.cloudSync?.status.phase !== 'starting', undefined, { timeout: 30000 });
    await second.evaluate(() => { CloudSync.QUIET_MS = 300; CloudSync.MAX_WAIT_MS = 2000 });
    assert.equal(await second.evaluate(() => App.viewGraphs.isWriter), false);
    // Connected too, so that only the lock keeps it from pushing.
    await second.evaluate(async () => { await App.cloudSync.auth.prepare(); await App.cloudSync.connect() });
    assert.equal(await second.evaluate(() => App.cloudSync.isConnected), true, 'the second tab did not connect');
    await second.waitForTimeout(600);
    const count = uploads(fake);
    await write(second, '## Beta\nFrom the second tab.\n');
    await second.waitForTimeout(900);
    await second.evaluate(() => App.cloudSync.flush());
    assert.equal(uploads(fake), count, 'the tab without the lock pushed');

    await openSettings(page, 'sync');
    await page.click('#sync-connect');
    await page.waitForFunction(() => App.cloudSync.status.phase === 'disconnected', undefined, { timeout: 5000 });
    assert.ok(await page.evaluate(() => window.__gisRevoked), 'the token was not revoked');
    await edit(page, 'From the first tab.', 'After disconnecting.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(uploads(fake), count, 'a disconnected tab pushed');
    assert.equal(await page.locator('#sync-connect').textContent(), 'Connect');
    assert.deepEqual(errors, []);
});

// The races the second review found, each held at the request where it bites (`fake.hold`).
test("a push slower than the next save does not count that save as sent", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nOne.\n');
    await connect(page);
    await settled(page);
    const held = fake.hold((c) => c.path.startsWith('/upload/'));
    await edit(page, 'One.', 'Two.');
    await held.reached;
    // While it is out, another save.
    await edit(page, 'Two.', 'Three.');
    held.release();
    await page.waitForTimeout(1200);
    await settled(page);
    await page.waitForTimeout(600);
    await settled(page);
    assert.ok(textOf(graphs(fake)[0]).includes('Three.'), 'the later save never went up');
    assert.deepEqual(errors, []);
});

test("a switch to another graph straight after an edit still sends the edit", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nBefore.\n');
    await connect(page);
    await settled(page);
    await edit(page, 'Before.', 'Edited, then left.');
    await page.evaluate(() => App.viewGraphs.startNewGraph());
    await page.waitForTimeout(900);
    await settled(page);
    assert.ok(textOf(graphs(fake)[0]).includes('Edited, then left.'), "the edit before the switch stayed behind");
    assert.deepEqual(errors, []);
});

test('two devices writing in the same moment keep both versions', async () => {
    const fake = new FakeGoogle();
    const a = await device(fake);
    await write(a.page, '## Alpha\nShared.\n');
    await connect(a.page);
    await settled(a.page);
    const b = await device(fake);
    await connect(b.page, { pushes: false });
    await b.page.waitForFunction(() => document.querySelectorAll('#sync-files [role=listitem]').length === 1, undefined, { timeout: 10000 });
    await b.page.click('#sync-files [role=listitem] button');
    await b.page.waitForFunction(() => /Shared\./.test(window.currentActiveZettelkastenMirror.getValue()), undefined, { timeout: 10000 });
    const [file] = graphs(fake);

    // A has read the file and is about to write it when B's write lands.
    const held = fake.hold((c) => c.path.startsWith('/upload/') && c.method === 'PATCH');
    await edit(a.page, 'Shared.', 'Shared, and from A.');
    await held.reached;
    await edit(b.page, 'Shared.', 'Shared, and from B.');
    await b.page.waitForTimeout(900);
    await settled(b.page);
    held.release();
    await a.page.waitForTimeout(900);
    await settled(a.page);

    const texts = graphs(fake).map((f) => textOf(f));
    assert.ok(texts.some((t) => t.includes('from A')), "A's version is gone");
    assert.ok(texts.some((t) => t.includes('from B')), "B's version was written over");
    assert.ok(graphs(fake).some((f) => f.id !== file.id && f.appProperties.neuriteConflictOf === file.id), 'no copy was kept');
    assert.deepEqual([...a.errors, ...b.errors], []);
});

test('an open from Drive that is refused binds nothing, and Disconnect ends a push already out', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nMine.\n');
    await connect(page);
    await settled(page);
    const [file] = graphs(fake);
    // The same Graph saved by a newer Neurite, which this one refuses to open.
    const head = bundleOf(file);
    fake.writeElsewhere(file.id, Buffer.from(JSON.stringify({ ...head, v: 99 }) + '\x00'), { neuriteSignature: 'future' });
    page.on('dialog', (d) => d.dismiss());
    await page.evaluate(() => { window.alert = () => {} });
    await page.evaluate((id) => App.cloudSync.open(id), file.id);
    await edit(page, 'Mine.', 'Mine, after the refusal.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(bundleOf(fake.files.get(file.id)).v, 99, 'the newer file was written over');

    // A push held at Google when Disconnect comes ends without saying anything.
    const held = fake.hold((c) => c.path.startsWith('/upload/'));
    await edit(page, 'Mine, after the refusal.', 'Mine, once more.');
    await held.reached;
    await page.evaluate(() => App.cloudSync.disconnect());
    held.release();
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => App.cloudSync.status.phase), 'disconnected');
    assert.deepEqual(errors, []);
});

test('a push that failed goes up later with no other change, and a rename renames the file', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nAbout to fail.\n');
    await connect(page);
    await settled(page);
    fake.failures.push({ match: (c) => c.path.startsWith('/upload/'), status: 503, times: 4 });
    await edit(page, 'About to fail.', 'Failed once.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.ok(!textOf(graphs(fake)[0]).includes('Failed once.'));
    assert.equal(await page.evaluate(() => App.cloudSync.syncedAt(App.viewGraphs.selectedMeta)), null, 'a failed push is said to be synced');
    await page.waitForTimeout(1500);
    await settled(page);
    assert.ok(textOf(graphs(fake)[0]).includes('Failed once.'), 'the failed push was never tried again');

    const count = uploads(fake);
    await page.evaluate(async () => { const m = App.viewGraphs.selectedMeta; m.title = 'Renamed'; await App.viewGraphs.keeper.saveMeta(m) });
    await page.evaluate(() => App.cloudSync.check());
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(graphs(fake)[0].name, 'Renamed.neurite');
    assert.equal(uploads(fake), count, 'a rename sent the content again');
    assert.deepEqual(errors, []);
});
