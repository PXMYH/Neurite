// The Drive calls cloud sync makes (js/sync/googledrive.js), against the fake Google the browser
// specs use (test-e2e/fixtures/fake-google.mjs). The file exports nothing, so it runs in node:vm
// with the fake as its `fetch`, as savenet-disk-mirror.test.js runs savenet.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { FakeGoogle } from '../test-e2e/fixtures/fake-google.mjs';

const PATH = 'js/sync/googledrive.js';
const src = readFileSync(new URL('../' + PATH, import.meta.url), 'utf8');

function load(){
    const sandbox = createContext({ URL, Blob, AbortSignal, Headers, Response, setTimeout, Math, JSON, String, Object, Promise, Error });
    runInContext(src + '\n;globalThis.exported = {GoogleDrive, DriveError};', sandbox, { filename: PATH });
    return sandbox.exported;
}

// A Drive over the fake, with the pauses it took recorded rather than waited out.
function drive({ fake = new FakeGoogle(), token } = {}){
    const { GoogleDrive, DriveError } = load();
    const pauses = [];
    const tokens = [];
    let current = fake.issueAccessToken();
    const d = new GoogleDrive({
        fetch: fake.asFetch(),
        sleep: (ms) => { pauses.push(ms); return Promise.resolve() },
        random: () => 0.5,
        token: token ?? (async ({ fresh } = {}) => {
            tokens.push(Boolean(fresh));
            if (fresh) current = fake.issueAccessToken();
            return current;
        })
    });
    return { d, fake, pauses, tokens, GoogleDrive, DriveError, revoke: () => fake.accessTokens.delete(current) };
}
const md5 = (s) => createHash('md5').update(s).digest('hex');

test("the Neurite folder is made once at the top of My Drive, found by its mark whatever it is called, and kept by id", async () => {
    const { d, fake } = drive();
    const id = await d.folderId();
    assert.equal(await d.folderId(), id, 'a second look made a second folder');
    assert.equal(await d.folderId(id), id);
    const folders = [...fake.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    assert.deepEqual(folders.map((f) => [f.name, f.parents, f.appProperties.neuriteFolder]), [['Neurite', ['root'], '1']]);
    // Renamed in Drive, it is still Neurite's.
    fake.files.get(id).name = 'My graphs';
    assert.equal(await d.folderId(), id);
    // A remembered folder that went to the bin is not used; a new one is found or made.
    fake.files.get(id).trashed = true;
    const again = await d.folderId(id);
    assert.notEqual(again, id);
    assert.equal(fake.files.get(again).trashed, false);
});

test('two devices that make the folder at once both use the older one, and read the files of both', async () => {
    const fake = new FakeGoogle();
    const a = drive({ fake }).d, b = drive({ fake }).d;
    const [made, alsoMade] = await Promise.all([a.folderId(), b.folderId()]);
    assert.notEqual(made, alsoMade, 'the race this is about did not happen');
    fake.files.get(alsoMade).createdTime = new Date(Date.parse(fake.files.get(made).createdTime) + 1000).toISOString();
    assert.deepEqual([...(await b.folders())], [made, alsoMade]);
    assert.equal(await a.folderId(), made);
    assert.equal(await b.folderId(), made);
    // A Graph put in the newer folder before the two met is still in the list.
    await b.upload({ folderId: alsoMade, name: 'Early.neurite', blob: new Blob(['e']) });
    await a.upload({ folderId: made, name: 'Later.neurite', blob: new Blob(['l']) });
    assert.deepEqual([...(await a.list(await a.folders()))].map((f) => f.name).sort(), ['Early.neurite', 'Later.neurite']);
});

test('a Graph goes up in one request, and new content for it bumps its version and checksum', async () => {
    const { d, fake } = drive();
    const folder = await d.folderId();
    const made = await d.upload({ folderId: folder, name: 'Graph.neurite', appProperties: { neuriteUuid: 'abc' }, blob: new Blob(['first']) });
    assert.equal(made.md5Checksum, md5('first'));
    assert.deepEqual(fake.files.get(made.id).parents, [folder]);
    assert.equal(fake.files.get(made.id).appProperties.neuriteUuid, 'abc');
    const next = await d.upload({ fileId: made.id, name: 'Graph.neurite', appProperties: { neuriteRevisions: '2' }, blob: new Blob(['second']) });
    assert.equal(next.id, made.id);
    assert.equal(next.md5Checksum, md5('second'));
    assert.ok(Number(next.version) > Number(made.version));
    assert.equal(fake.files.get(made.id).content.toString(), 'second');
    assert.equal(fake.files.get(made.id).appProperties.neuriteUuid, 'abc', 'an update dropped the properties it did not name');
    assert.equal(await (await d.download(made.id)).text(), 'second');
});

test("a file's revisions are listed the oldest first, and an earlier one is marked to be kept before it is read", async () => {
    const { d, fake } = drive();
    const folder = await d.folderId();
    const made = await d.upload({ folderId: folder, name: 'Graph.neurite', blob: new Blob(['first']) });
    await d.upload({ fileId: made.id, name: 'Graph.neurite', blob: new Blob(['second']) });
    const revisions = [...(await d.revisions(made.id))];
    assert.deepEqual(revisions.map((r) => r.md5Checksum), [md5('first'), md5('second')]);
    // Drive refuses an earlier revision's content until it is kept forever.
    assert.equal(await (await d.downloadRevision(made.id, revisions[0].id)).text(), 'first');
    assert.deepEqual(fake.revisionsOf[made.id].map((r) => Boolean(r.keepForever)), [true, false]);
});

test('a Graph larger than one request goes up resumable, by the upload id when Location is hidden', async () => {
    for (const hideLocation of [false, true]) {
        const { d, fake, GoogleDrive } = drive();
        fake.hideLocation = hideLocation;
        GoogleDrive.MULTIPART_MAX = 4;
        const folder = await d.folderId();
        const made = await d.upload({ folderId: folder, name: 'Big.neurite', appProperties: { neuriteUuid: 'big' }, blob: new Blob(['0123456789']) });
        assert.equal(fake.files.get(made.id).content.toString(), '0123456789');
        const next = await d.upload({ fileId: made.id, name: 'Big.neurite', blob: new Blob(['abcdefghij']) });
        assert.equal(next.md5Checksum, md5('abcdefghij'), `hideLocation=${hideLocation}`);
        const kinds = fake.calls.filter((c) => c.path.startsWith('/upload/')).map((c) => c.query.uploadType + (c.query.upload_id ? '+id' : ''));
        assert.deepEqual(kinds, ['resumable', 'resumable+id', 'resumable', 'resumable+id']);
    }
});

test("a Graph's file is found by its lineage id, never a conflict copy of it; the list holds only .neurite files", async () => {
    const { d } = drive();
    const folder = await d.folderId();
    const own = await d.upload({ folderId: folder, name: 'Mind.neurite', appProperties: { neuriteUuid: "it's" }, blob: new Blob(['a']) });
    await d.upload({ folderId: folder, name: 'Mind (conflict).neurite', appProperties: { neuriteUuid: "it's", neuriteConflictOf: own.id }, blob: new Blob(['b']) });
    await d.upload({ folderId: folder, name: 'notes.txt', blob: new Blob(['c']) });
    // Spread into this realm: the client's arrays are the sandbox's.
    assert.deepEqual([...(await d.findByUuid(folder, "it's"))].map((f) => f.id), [own.id]);
    assert.deepEqual([...(await d.findByUuid(folder, 'nobody'))], []);
    assert.deepEqual([...(await d.list(folder))].map((f) => f.name).sort(), ['Mind (conflict).neurite', 'Mind.neurite']);
});

test("retries follow Notion's schedule for 5xx, 429 and a dropped connection, and never for a 4xx", async () => {
    const { d, fake, pauses } = drive();
    const folder = await d.folderId();
    fake.failures.push({ match: (c) => c.path === '/drive/v3/files' && c.method === 'GET', status: 503, times: 2 });
    await d.list(folder);
    assert.deepEqual(pauses, [750, 1250], 'the pauses are 500 and 1000 ms, each with its jitter');

    pauses.length = 0;
    fake.failures.push({ match: (c) => c.method === 'GET', status: 429, times: 4 });
    await assert.rejects(d.list(folder), (err) => err.status === 429);
    assert.deepEqual(pauses, [750, 1250, 2250], 'three retries, then the failure is the answer');

    pauses.length = 0;
    fake.failures.push({ match: (c) => c.method === 'GET', status: 400, times: 1 });
    await assert.rejects(d.list(folder), (err) => err.status === 400 && err.reason === 'http');
    assert.deepEqual(pauses, []);

    let drops = 1;
    const flaky = fake.asFetch();
    d.fetch = (...a) => (drops-- > 0 ? Promise.reject(new TypeError('Failed to fetch')) : flaky(...a));
    pauses.length = 0;
    await d.list(folder);
    assert.deepEqual(pauses, [750]);

    // A Retry-After is waited out, up to a minute; a 403 for a rate limit is a 429.
    d.fetch = flaky;
    pauses.length = 0;
    const real = fake.handle.bind(fake);
    let once = 2;
    fake.handle = async (req) => (once-- > 0
        ? { status: once ? 429 : 403, headers: { 'retry-after': once ? '3' : '600', 'content-type': 'application/json' },
            body: JSON.stringify({ error: { code: 403, message: 'slow down', errors: [{ reason: 'userRateLimitExceeded' }] } }) }
        : real(req));
    await d.list(folder);
    assert.deepEqual(pauses, [3000, 60000], 'the Retry-After of 3 s, then 600 s held to a minute');
    fake.handle = real;
});

test('a request that makes a file is not repeated after an answer that never came, or a server error', async () => {
    const { d, fake, pauses } = drive();
    const folder = await d.folderId();
    const flaky = fake.asFetch();
    let drops = 1;
    // The answer is lost after the file was made: the client must not make a second.
    d.fetch = async (...a) => { const res = await flaky(...a); if (drops-- > 0) throw new TypeError('Failed to fetch'); return res };
    await assert.rejects(d.upload({ folderId: folder, name: 'Once.neurite', appProperties: { neuriteOp: 'op1' }, blob: new Blob(['x']) }),
        (err) => err.reason === 'unknown');
    assert.equal(fake.filesIn(folder).filter((f) => f.name === 'Once.neurite').length, 1);
    assert.deepEqual(pauses, []);
    d.fetch = flaky;
    fake.failures.push({ match: (c) => c.path.startsWith('/upload/') && c.method === 'POST', status: 503, times: 1 });
    await assert.rejects(d.upload({ folderId: folder, name: 'Twice.neurite', blob: new Blob(['y']) }), (err) => err.reason === 'unknown');
    assert.deepEqual(pauses, []);
    // New content for a file it has is repeated: the same bytes twice are one change.
    const made = fake.fileByName('Once.neurite');
    fake.failures.push({ match: (c) => c.path.startsWith('/upload/') && c.method === 'PATCH', status: 503, times: 1 });
    await d.upload({ fileId: made.id, name: 'Once.neurite', blob: new Blob(['z']) });
    assert.equal(fake.files.get(made.id).content.toString(), 'z');
});

test('a 401 is retried once with a fresh token; a second is the answer, and no token at all is one', async () => {
    const { d, tokens, revoke, fake } = drive();
    const folder = await d.folderId();
    revoke();
    tokens.length = 0;
    await d.list(folder);
    assert.deepEqual(tokens, [false, true], 'the expired token was not replaced');

    const { d: none, DriveError: NoneError } = drive({ fake, token: async () => null });
    await assert.rejects(none.list(folder), (err) => err instanceof NoneError && err.reason === 'unauthorized');

    let n = 0;
    const { d: stale } = drive({ fake, token: async () => 'ya29.never-' + (n++) });
    await assert.rejects(stale.list(folder), (err) => err.status === 401 && err.reason === 'unauthorized');
    assert.equal(n, 2, 'more than one fresh token was asked for');
});

test("a name with quotes is quoted for Drive's query language", () => {
    const { GoogleDrive } = load();
    assert.equal(GoogleDrive.quote("it's a \\ test"), "'it\\'s a \\\\ test'");
});
