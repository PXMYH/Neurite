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
// And that device's push of it, which says what content it holds as Neurite says it.
async function pushedElsewhere(page, fake, file, from, to, device = 'iPad') {
    const content = savedElsewhere(file, from, to, device);
    const nul = content.indexOf(0);
    const { data } = JSON.parse(content.subarray(0, nul).toString('utf8'));
    const neuriteSignature = await page.evaluate((d) => CloudSync.signatureOf(d), data);
    fake.writeElsewhere(file.id, content, { neuriteDevice: device, neuriteSignature });
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
    await pushedElsewhere(page, fake, file, 'Words here.', 'Words from the iPad.');

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
    await pushedElsewhere(page, fake, file, 'Old words.', 'Newer words from the iPad.');

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

test('a Graph moved to a second device in a file before it connected goes on in the same Drive file', async () => {
    const fake = new FakeGoogle();
    const a = await device(fake);
    await write(a.page, '## Alpha\nCarried over in a file.\n');
    await connect(a.page);
    await settled(a.page);
    const [file] = graphs(fake);

    // Open… on B, with the file A saved, and then Connect.
    const b = await device(fake);
    await b.page.evaluate(async (bytes) => {
        await App.viewGraphs.importFile(new File([new Uint8Array(bytes)], 'Graph 1.neurite'));
    }, [...fake.files.get(file.id).content]);
    await b.page.waitForFunction(() => /Carried over/.test(window.currentActiveZettelkastenMirror.getValue()), undefined, { timeout: 10000 });
    await b.page.waitForTimeout(600);
    await connect(b.page);
    await settled(b.page);
    assert.equal(graphs(fake).length, 1, 'the same content went up beside itself as a conflict copy');

    await edit(b.page, 'Carried over in a file.', 'Carried over, and edited on B.');
    await b.page.waitForTimeout(900);
    await settled(b.page);
    assert.equal(graphs(fake).length, 1);
    assert.ok(textOf(fake.files.get(file.id)).includes('edited on B'), "B's edit did not go to the Graph's file");
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

test("a switch to another graph straight after an edit still sends the edit, and the new graph's own", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nBefore.\n');
    await connect(page);
    await settled(page);
    // A wait long enough that the edit's push is still waiting when the next Graph saves.
    await page.evaluate(() => { CloudSync.QUIET_MS = 5000; CloudSync.MAX_WAIT_MS = 5000 });
    await edit(page, 'Before.', 'Edited, then left.');
    await page.evaluate(() => App.viewGraphs.startNewGraph());
    await write(page, '## Beta\nOn the new graph.\n');
    await page.waitForTimeout(600);
    assert.ok(graphs(fake).some((f) => textOf(f).includes('Edited, then left.')), "the edit before the switch stayed behind");
    await settled(page);
    assert.ok(graphs(fake).some((f) => textOf(f).includes('On the new graph.')), "the new graph did not go up");
    assert.equal(graphs(fake).length, 2);
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

// The third review's cases.
// A request Drive carried out whose answer never came back: the page sees a dropped connection.
function loseAnswers(fake, match, times = 1) {
    const real = fake.handle.bind(fake);
    fake.handle = async (req) => {
        const res = await real(req);
        const u = new URL(req.url);
        if (times > 0 && match({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams) })) { times -= 1; throw new Error('the answer was lost') }
        return res;
    };
}
// What the browser keeps bound: graph title to Drive file id.
const boundFiles = (page) => page.evaluate(async () => {
    const out = {};
    await new Stored('sync', 'drive-files').table.iterate((b) => { if (b.fileId) out[b.title] = b.fileId });
    return out;
});

test('two opens of one Graph\'s files at once each bind the record they made, and send nothing', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nThe original.\n');
    await connect(page);
    await settled(page);
    const [file] = graphs(fake);
    // A conflict copy of it beside it, as another device leaves one.
    const copy = await page.evaluate(async ({ bytes, id }) => {
        const d = App.cloudSync.drive;
        const blob = new Blob([new Uint8Array(bytes)]);
        const { data } = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)).split('\0')[0]);
        const props = { neuriteUuid: App.viewGraphs.selectedMeta.uuid, neuriteConflictOf: id, neuriteSignature: CloudSync.signatureOf(data) };
        return d.upload({ folderId: (await d.folders())[0], name: 'Alpha copy.neurite', appProperties: props, blob });
    }, { bytes: [...savedElsewhere(file, 'The original.', 'The copy.')], id: file.id });
    const count = uploads(fake);
    await page.evaluate(([a, b]) => Promise.all([App.cloudSync.open(a), App.cloudSync.open(b)]), [file.id, copy.id]);
    await page.waitForFunction(() => /The copy\./.test(window.currentActiveZettelkastenMirror.getValue()), undefined, { timeout: 10000 });
    await save(page);
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(uploads(fake), count, 'an open sent its Graph back up');
    const bound = await boundFiles(page);
    assert.equal(bound['Alpha copy'], copy.id, 'the copy opened is not bound to its file');
    assert.equal(bound['Graph 1 (2)'], file.id, 'the original opened is not bound to its file');
    await edit(page, 'The copy.', 'The copy, edited.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.ok(textOf(fake.files.get(copy.id)).includes('The copy, edited.'));
    assert.ok(textOf(fake.files.get(file.id)).includes('The original.'), 'the original was written over');
    assert.deepEqual(errors, []);
});

test('a Graph with an image opened from Drive sends nothing back, and its content signature ignores what each load renumbers', async () => {
    const fake = new FakeGoogle();
    const a = await device(fake);
    await write(a.page, '## Alpha\nWith a picture.\n');
    await a.page.evaluate(async () => {
        const png = await new Promise((ok) => { const c = document.createElement('canvas'); c.width = 8; c.height = 6; c.getContext('2d').fillRect(0, 0, 8, 6); c.toBlob(ok, 'image/png') });
        const dt = new DataTransfer();
        dt.items.add(new File([png], 'dot.png', { type: 'image/png' }));
        document.getElementById('neurite-workspace').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
    });
    await a.page.waitForTimeout(1500);
    await a.page.evaluate(() => Graph.forEachNode(Node.stopFollowingMouse));
    await save(a.page);
    await connect(a.page);
    await settled(a.page);

    const b = await device(fake);
    await connect(b.page, { pushes: false });
    await b.page.waitForFunction(() => document.querySelectorAll('#sync-files [role=listitem]').length === 1, undefined, { timeout: 10000 });
    const count = uploads(fake);
    await b.page.click('#sync-files [role=listitem] button');
    await b.page.waitForFunction(() => Object.values(Graph.nodes).some((n) => n.content.querySelector('img')?.naturalWidth === 8), undefined, { timeout: 10000 });
    await b.page.waitForTimeout(600);
    await save(b.page);
    await b.page.waitForTimeout(900);
    await settled(b.page);
    assert.equal(uploads(fake), count, 'opening an image Graph sent it back up');
    // A class added for a card's first frame is the view's, and so is the height a title box is given
    // to fit; the same words in a note, and the title itself, are content.
    assert.deepEqual(await b.page.evaluate(() => [
        CloudSync.signatureOf('<div class="window just-created">x</div>') === CloudSync.signatureOf('<div class="window">x</div>'),
        CloudSync.signatureOf('<p>a just-created b</p>') === CloudSync.signatureOf('<p>a b</p>'),
        CloudSync.signatureOf('<textarea class="title-input" rows="1" style="height: 24px;">A</textarea>')
            === CloudSync.signatureOf('<textarea class="title-input" rows="1" style="">A</textarea>'),
        CloudSync.signatureOf('<textarea class="title-input" rows="1" style="">A</textarea>')
            === CloudSync.signatureOf('<textarea class="title-input" rows="1" style="">B</textarea>'),
    ]), [true, false, true, false]);
    assert.deepEqual([...a.errors, ...b.errors], []);
});

test("a write the check after it could not finish is not called synced, and is checked again later", async () => {
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

    // B's write lands under A's, and A cannot read the revisions afterwards.
    const held = fake.hold((c) => c.path.startsWith('/upload/') && c.method === 'PATCH');
    await edit(a.page, 'Shared.', 'Shared, and from A.');
    await held.reached;
    await edit(b.page, 'Shared.', 'Shared, and from B.');
    await b.page.waitForTimeout(900);
    await settled(b.page);
    fake.failures.push({ match: (c) => c.path.endsWith('/revisions'), status: 500, times: 4 });
    held.release();
    await a.page.waitForTimeout(300);
    await settled(a.page);
    assert.equal(await a.page.evaluate(() => App.cloudSync.syncedAt(App.viewGraphs.selectedMeta)), null, 'an unchecked write is said to be synced');
    // Tried again, the check finds B's write and keeps it.
    await a.page.waitForTimeout(1200);
    await settled(a.page);
    const texts = graphs(fake).map((f) => textOf(f));
    assert.ok(texts.some((t) => t.includes('from B')), "B's version was lost");
    assert.ok(textOf(fake.files.get(file.id)).includes('from A'));
    assert.equal(graphs(fake).length, 2);
    assert.ok(await a.page.evaluate(() => App.cloudSync.syncedAt(App.viewGraphs.selectedMeta)), 'checked, the write is still not synced');
    assert.ok(fake.revisionsOf[file.id].every((r) => !r.keepForever), 'a revision kept to be read stayed kept');
    assert.deepEqual([...a.errors, ...b.errors], []);
});

test('a Graph saved with cards that could not be reopened goes up beside the whole one, and the next Graph syncs as usual', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nWhole.\n');
    await connect(page);
    await settled(page);
    const [file] = graphs(fake);
    // As a restore that skipped a card leaves it (`#loadGraph`).
    await page.evaluate(() => { App.viewGraphs.restoreSkipped = 1 });
    await edit(page, 'Whole.', 'Whole, and edited with a card missing.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.ok(textOf(fake.files.get(file.id)).includes('Whole.') && !textOf(fake.files.get(file.id)).includes('edited'), 'the whole copy was written over');
    assert.equal(graphs(fake).length, 2, 'the version with a card missing did not go up beside it');
    await openSettings(page, 'sync');
    assert.match(await page.locator('#sync-graph-note').textContent(), /could not be reopened here/);

    await page.evaluate(() => App.viewGraphs.startNewGraph());
    await write(page, '## Beta\nA new graph.\n');
    await page.waitForTimeout(900);
    await settled(page);
    assert.ok(graphs(fake).some((f) => textOf(f).includes('A new graph.')), 'the next graph never went up');
    // Whole, it goes on in its own file: the count of cards that did not reopen was the last Graph's.
    await edit(page, 'A new graph.', 'A new graph, edited.');
    await page.waitForTimeout(900);
    await settled(page);
    assert.equal(graphs(fake).length, 3, 'the next graph went up as a copy of itself');
    assert.ok(graphs(fake).some((f) => textOf(f).includes('A new graph, edited.')));
    assert.deepEqual(errors, []);
});

test('a save that never went up before a reload is not called synced after it, and goes up once connected', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nSent.\n');
    await connect(page);
    await settled(page);
    // Saved with no push begun -- here, disconnected; in the Mac app, a quit inside the quiet.
    await page.evaluate(() => App.cloudSync.disconnect());
    await edit(page, 'Sent.', 'Never sent.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true && App.cloudSync?.status.phase !== 'starting', undefined, { timeout: 30000 });
    await page.waitForFunction(() => /Never sent\./.test(window.currentActiveZettelkastenMirror.getValue()), undefined, { timeout: 10000 });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => App.cloudSync.syncedAt(App.viewGraphs.selectedMeta)), null, 'the unsent save is said to be synced');
    await page.evaluate(() => { CloudSync.QUIET_MS = 300; CloudSync.MAX_WAIT_MS = 2000; CloudSync.RETRY_MS = [400, 400, 400] });
    await connect(page);
    await settled(page);
    assert.ok(textOf(graphs(fake)[0]).includes('Never sent.'));
    assert.deepEqual(errors, []);
});

test('nothing goes up once Disconnect is clicked, while Google is still being told; a check that fails after it changes nothing', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nBefore.\n');
    await connect(page);
    await settled(page);
    const count = uploads(fake);
    // The Mac app's Disconnect waits for its main process; the token works until then.
    await page.evaluate(() => {
        const auth = App.cloudSync.auth, real = auth.disconnect.bind(auth);
        auth.disconnect = () => new Promise((r) => setTimeout(() => r(real()), 1500));
    });
    const gone = page.evaluate(() => App.cloudSync.disconnect());
    await edit(page, 'Before.', 'After the click.');
    await page.waitForTimeout(600);
    await page.evaluate(() => App.cloudSync.flush());
    await gone;
    assert.equal(uploads(fake), count, 'a save after Disconnect went up');

    // Connected again, a check whose connection keeps dropping is on its last try at Google when
    // Disconnect comes, and that try fails too.
    await connect(page);
    await settled(page);
    const isCheck = (c) => c.method === 'GET' && /^\/drive\/v3\/files\/[^/]+$/.test(c.path) && !c.query.alt;
    let tries = 0;
    const held = fake.hold((c) => isCheck(c) && ++tries === 4);
    fake.failures.push({ match: isCheck, status: 'drop', times: 4 });
    const checking = page.evaluate(() => App.cloudSync.check());
    await held.reached;
    await page.evaluate(() => App.cloudSync.disconnect());
    held.release();
    await checking;
    assert.equal(await page.evaluate(() => App.cloudSync.status.phase), 'disconnected');
    assert.deepEqual(errors, []);
});

test('a rename that failed once goes, and then the Graph is synced', async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nNamed.\n');
    await connect(page);
    await settled(page);
    fake.failures.push({ match: (c) => c.method === 'PATCH' && c.path.startsWith('/drive/'), status: 503, times: 4 });
    await page.evaluate(async () => { const m = App.viewGraphs.selectedMeta; m.title = 'Renamed'; await App.viewGraphs.keeper.saveMeta(m) });
    await page.evaluate(() => App.cloudSync.check());
    await page.waitForTimeout(300);
    await settled(page);
    assert.equal(await page.evaluate(() => App.cloudSync.syncedAt(App.viewGraphs.selectedMeta)), null, 'a rename not made is said to be synced');
    await page.waitForTimeout(1200);
    await settled(page);
    assert.equal(graphs(fake)[0].name, 'Renamed.neurite');
    assert.ok(await page.evaluate(() => App.cloudSync.syncedAt(App.viewGraphs.selectedMeta)), 'the rename went, and the Graph is not called synced');
    assert.deepEqual(errors, []);
});

test("a conflict copy whose answer never came is not made twice", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nWords here.\n');
    await connect(page);
    await settled(page);
    const [file] = graphs(fake);
    await pushedElsewhere(page, fake, file, 'Words here.', 'Words from the iPad.');
    loseAnswers(fake, (c) => c.method === 'POST' && c.path === '/upload/drive/v3/files');
    await edit(page, 'Words here.', 'Words from this device.');
    await page.waitForTimeout(900);
    await settled(page);
    await page.waitForTimeout(1200);
    await settled(page);
    const copies = graphs(fake).filter((f) => f.appProperties.neuriteConflictOf === file.id);
    assert.equal(copies.length, 1, 'the lost answer made a second conflict copy');
    assert.ok(textOf(copies[0]).includes('Words from this device.'));
    assert.ok(textOf(fake.files.get(file.id)).includes('Words from the iPad.'));
    assert.deepEqual(errors, []);
});

test("a check of one Graph does not stand in for the next one's", async () => {
    const fake = new FakeGoogle();
    const { page, errors } = await device(fake);
    await write(page, '## Alpha\nFirst graph.\n');
    await connect(page);
    await settled(page);
    const [first] = graphs(fake);
    // The first Graph's check is still out at Google when the screen moves on to a second.
    const held = fake.hold((c) => c.method === 'GET' && c.path === '/drive/v3/files/' + first.id && !c.query.alt);
    const firstCheck = page.evaluate(() => App.cloudSync.check());
    await held.reached;
    await page.evaluate(() => App.viewGraphs.startNewGraph());
    await write(page, '## Beta\nSecond graph.\n');
    await page.waitForTimeout(900);
    await settled(page);
    const second = graphs(fake).find((f) => f.id !== first.id);
    await pushedElsewhere(page, fake, second, 'Second graph.', 'Second graph, from the iPad.');
    // The second Graph's own check finds the newer copy, with the first's still out.
    page.evaluate(() => App.cloudSync.check());
    await page.waitForFunction((id) => App.cloudSync.status.newer?.fileId === id, second.id, { timeout: 3000 })
        .catch(() => assert.fail("the second Graph's check was the first's"));
    held.release();
    await firstCheck;
    assert.equal(await page.evaluate(() => App.cloudSync.status.newer?.fileId), second.id, "the first Graph's check spoke for the second");
    assert.deepEqual(errors, []);
});
