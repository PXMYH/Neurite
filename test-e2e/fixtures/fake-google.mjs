// A stand-in for the parts of Google that cloud sync talks to (docs/cloud-sync.md): Drive v3's
// files, folders and uploads, the OAuth authorize, token and revoke endpoints, and the account.
// One handler holds the state; three adapters put it where a test needs it -- `fetch` for a unit
// test, Playwright routes for the page, and a real HTTP server for the Mac app's main process.
//
// It behaves as Drive does where the client depends on it: only a bearer token it issued is
// accepted; a content upload bumps `version`, sets a new `headRevisionId` and the content's
// `md5Checksum`, while a metadata change bumps `version` only; `appProperties` are matched by the
// `appProperties has { key=... and value=... }` query; a resumable start answers with an upload id
// that the browser can read only as `X-GUploader-UploadID`, as Google's own start answer exposes;
// a list comes a page at a time; an earlier revision is given only once it is kept forever, 200 a
// file at most; and a refresh token is issued for offline access the first time a client is given
// it, and after that only when consent is asked for again.
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const FOLDER = 'application/vnd.google-apps.folder';
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export class FakeGoogle {
    files = new Map();
    calls = [];
    // Failures to answer the next matching requests with: {match: (req) => bool, status, times}, where
    // a status of 'drop' is a connection that drops without an answer.
    failures = [];
    // Requests held until a test lets them go: `const h = fake.hold(match)`, `await h.reached`,
    // `h.release()`. The first matching request waits, before Drive does anything with it.
    holds = [];
    hold(match) {
        let release, reached;
        const h = { match, used: false };
        h.gate = new Promise((r) => { release = r });
        h.reached = new Promise((r) => { reached = r });
        h.release = release;
        h.arrive = reached;
        this.holds.push(h);
        return h;
    }
    user = { emailAddress: 'reader@example.com', displayName: 'Reader' };
    clientIds = new Set(['test-client.apps.googleusercontent.com']);
    // The OAuth side: authorization codes waiting for their exchange, and the tokens issued.
    codes = new Map();
    accessTokens = new Map();
    refreshTokens = new Map();
    uploads = new Map();
    // Whether a resumable start's `Location` is in the answer at all: a browser cannot read it from
    // Google's (it is not among the exposed headers), so a test can take it away.
    hideLocation = false;
    // Drive answers a list a page at a time, at most `pageSize` items, and says nothing of the
    // order of a file's revisions; a test can make the pages small and the order newest first.
    maxPage = Infinity;
    revisionOrder = 'oldest-first';
    // Drive keeps at most 200 revisions of a file forever.
    static MAX_KEPT = 200;
    // Google issues a refresh token the first time a client is given offline access, and after
    // that only when consent is asked for again (`prompt=consent`).
    #offlineGranted = new Set();
    #seq = 0;

    // A token the page may use at once, as a browser sign-in would hand it.
    issueAccessToken(scope = 'https://www.googleapis.com/auth/drive.file', ttlSeconds = 3600) {
        const token = 'ya29.fake-' + randomBytes(12).toString('hex');
        this.accessTokens.set(token, { scope, expires: Date.now() + ttlSeconds * 1000 });
        return token;
    }
    // What another device does to a file: new content, with all that comes with it -- its own push
    // carries an operation id of its own.
    writeElsewhere(id, content, appProperties = {}) {
        const f = this.files.get(id);
        if (!f) throw new Error('no file ' + id);
        this.#setContent(f, Buffer.from(content));
        Object.assign(f.appProperties, { neuriteOp: 'elsewhere-' + randomBytes(4).toString('hex') }, appProperties);
    }
    fileByName(name) { return [...this.files.values()].find((f) => f.name === name && !f.trashed) ?? null }
    filesIn(folderId) { return [...this.files.values()].filter((f) => f.parents.includes(folderId) && !f.trashed) }

    #id() { return 'f' + (++this.#seq).toString(36) + randomBytes(4).toString('hex') }
    // Drive's times have milliseconds, and two writes to it are never in the same one; here they can
    // be, so each time is at least a millisecond after the last.
    #last = 0;
    #now() { this.#last = Math.max(Date.now(), this.#last + 1); return new Date(this.#last).toISOString() }
    // Every content change is a revision, as for a file with binary content in Drive.
    #setContent(f, buf) {
        f.content = buf;
        f.size = String(buf.length);
        f.md5Checksum = createHash('md5').update(buf).digest('hex');
        f.headRevisionId = 'r' + randomBytes(6).toString('hex');
        f.version = String(Number(f.version ?? 0) + 1);
        f.modifiedTime = this.#now();
        (this.revisionsOf[f.id] ??= []).push({ id: f.headRevisionId, md5Checksum: f.md5Checksum, modifiedTime: f.modifiedTime, content: buf });
    }
    revisionsOf = {};
    #create(meta, content) {
        const f = {
            kind: 'drive#file', id: this.#id(), name: meta.name ?? 'Untitled', mimeType: meta.mimeType ?? 'application/octet-stream',
            parents: meta.parents ?? ['root'], appProperties: { ...(meta.appProperties ?? {}) }, trashed: false,
            createdTime: this.#now(), modifiedTime: this.#now(), version: '0',
        };
        if (f.mimeType === FOLDER) f.version = '1';
        else this.#setContent(f, content ?? Buffer.alloc(0));
        this.files.set(f.id, f);
        return f;
    }
    #patch(f, meta) {
        if (meta.name !== undefined) f.name = meta.name;
        if (meta.trashed !== undefined) f.trashed = Boolean(meta.trashed);
        for (const [k, v] of Object.entries(meta.appProperties ?? {})) {
            if (v === null) delete f.appProperties[k];
            else f.appProperties[k] = String(v);
        }
        f.version = String(Number(f.version) + 1);
        f.modifiedTime = this.#now();
    }
    // The fields a request asked for, or Drive's default four. `files(...)` and `user(...)` nest.
    #pick(f, fields) {
        const want = (fields ?? 'kind,id,name,mimeType').split(',').map((s) => s.trim()).filter(Boolean);
        const out = {};
        for (const w of want) if (f[w] !== undefined) out[w] = f[w];
        return out;
    }
    #listFields(fields, key = 'files') {
        const m = new RegExp(key + '\\(([^)]*)\\)').exec(fields ?? '');
        return m ? m[1] : 'kind,id,name,mimeType';
    }
    // One page of a list, and where the next begins.
    #page(items, url, key, defaultSize) {
        const size = Math.min(Number(url.searchParams.get('pageSize')) || defaultSize, this.maxPage);
        const start = Number(/^p(\d+)$/.exec(url.searchParams.get('pageToken') ?? '')?.[1] ?? 0);
        const page = { [key]: items.slice(start, start + size) };
        if (start + size < items.length) page.nextPageToken = 'p' + (start + size);
        return page;
    }
    // Enough of Drive's query language for what the client asks: clauses joined by `and`.
    #matches(f, q) {
        if (!q) return !f.trashed;
        const clauses = q.split(/\s+and\s+(?![^{]*\})/i);
        return clauses.every((c) => {
            c = c.trim();
            let m;
            if ((m = /^trashed\s*=\s*(true|false)$/i.exec(c))) return f.trashed === (m[1] === 'true');
            if ((m = /^name\s*=\s*'((?:[^'\\]|\\.)*)'$/.exec(c))) return f.name === m[1].replace(/\\(.)/g, '$1');
            if ((m = /^mimeType\s*=\s*'([^']*)'$/.exec(c))) return f.mimeType === m[1];
            if ((m = /^mimeType\s*!=\s*'([^']*)'$/.exec(c))) return f.mimeType !== m[1];
            if ((m = /^'([^']*)'\s+in\s+parents$/.exec(c))) return f.parents.includes(m[1]);
            if ((m = /^appProperties\s+has\s+\{\s*key\s*=\s*'([^']*)'\s+and\s+value\s*=\s*'((?:[^'\\]|\\.)*)'\s*\}$/.exec(c))) {
                return f.appProperties[m[1]] === m[2].replace(/\\(.)/g, '$1');
            }
            throw new Error('fake Drive cannot read the query clause: ' + c);
        });
    }

    // One request in, one response out: {method, url, headers (lower-case keys), body: Buffer}.
    async handle(req) {
        const url = new URL(req.url);
        const call = { method: req.method, host: url.host, path: url.pathname, query: Object.fromEntries(url.searchParams) };
        this.calls.push(call);
        const held = req.method !== 'OPTIONS' && this.holds.find((h) => !h.used && h.match(call));
        if (held) { held.used = true; held.arrive(); await held.gate }
        const cors = { 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-expose-headers': 'X-GUploader-UploadID, Date' };
        if (req.method === 'OPTIONS') {
            return { status: 200, headers: { ...cors, 'access-control-allow-methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
                                             'access-control-allow-headers': req.headers['access-control-request-headers'] ?? 'authorization,content-type' }, body: '' };
        }
        const fail = this.failures.find((x) => x.times > 0 && x.match(call));
        if (fail) {
            fail.times -= 1;
            // A connection that drops: the page's fetch fails with no answer at all.
            if (fail.status === 'drop') throw new Error('fake Google dropped the connection');
            return { status: fail.status, headers: { ...cors, 'content-type': 'application/json' },
                     body: JSON.stringify({ error: { code: fail.status, message: 'fake failure' } }) };
        }
        const json = (status, obj, extra = {}) => ({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(obj) });
        const err = (status, message) => json(status, { error: { code: status, message } });

        // OAuth.
        if (url.host === 'accounts.google.com' && url.pathname === '/o/oauth2/v2/auth') return this.#authorize(url);
        if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') return this.#token(req.body, json);
        if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
            const token = url.searchParams.get('token') ?? new URLSearchParams(req.body?.toString() ?? '').get('token');
            this.refreshTokens.delete(token);
            this.accessTokens.delete(token);
            return json(200, {});
        }

        // Drive: a token this fake issued, unexpired.
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        const grant = bearer && this.accessTokens.get(bearer);
        if (!grant || grant.expires < Date.now()) {
            return { ...err(401, 'Request had invalid authentication credentials.'), headers: { ...cors, 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="https://accounts.google.com/"' } };
        }
        const p = url.pathname;
        const fields = url.searchParams.get('fields');
        let m;
        if (p === '/drive/v3/about' && req.method === 'GET') return json(200, { user: this.user });
        if (p === '/drive/v3/files' && req.method === 'GET') {
            const q = url.searchParams.get('q');
            const found = [...this.files.values()].filter((f) => this.#matches(f, q));
            const ff = this.#listFields(fields);
            return json(200, this.#page(found.map((f) => this.#pick(f, ff)), url, 'files', 100));
        }
        if (p === '/drive/v3/files' && req.method === 'POST') {
            const f = this.#create(JSON.parse(req.body.toString() || '{}'));
            return json(200, this.#pick(f, fields));
        }
        if ((m = /^\/drive\/v3\/files\/([^/]+)\/revisions(?:\/([^/]+))?$/.exec(p)) && ['GET', 'PATCH'].includes(req.method)) {
            const f = this.files.get(m[1]);
            if (!f) return err(404, 'File not found: ' + m[1]);
            const revs = this.revisionsOf[f.id] ?? [];
            if (!m[2]) {
                const listed = revs.map(({ id, md5Checksum, modifiedTime, keepForever }) => ({ id, md5Checksum, modifiedTime, keepForever: Boolean(keepForever) }));
                if (this.revisionOrder === 'newest-first') listed.reverse();
                return json(200, this.#page(listed, url, 'revisions', 200));
            }
            const r = revs.find((x) => x.id === m[2]);
            if (!r) return err(404, 'Revision not found: ' + m[2]);
            if (req.method === 'PATCH') {
                const { keepForever } = JSON.parse(req.body.toString() || '{}');
                if (keepForever === true && !r.keepForever && revs.filter((x) => x.keepForever).length >= FakeGoogle.MAX_KEPT) {
                    return err(403, 'This file already has the most revisions that can be kept forever.');
                }
                if (typeof keepForever === 'boolean') r.keepForever = keepForever;
                return json(200, { id: r.id, keepForever: Boolean(r.keepForever) });
            }
            // As Drive: a binary file's revision is downloaded only once it is kept forever.
            if (!r.keepForever) return err(403, 'Only revisions marked keepForever can be downloaded.');
            return { status: 200, headers: { ...cors, 'content-type': f.mimeType }, body: r.content };
        }
        if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p))) {
            const f = this.files.get(m[1]);
            if (!f) return err(404, 'File not found: ' + m[1]);
            if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
                return { status: 200, headers: { ...cors, 'content-type': f.mimeType }, body: f.content };
            }
            if (req.method === 'GET') return json(200, this.#pick(f, fields));
            if (req.method === 'PATCH') { this.#patch(f, JSON.parse(req.body.toString() || '{}')); return json(200, this.#pick(f, fields)); }
            if (req.method === 'DELETE') { this.files.delete(f.id); return { status: 204, headers: cors, body: '' }; }
        }
        // Uploads: multipart (metadata and content in one body) and resumable (a start, then the bytes).
        if ((m = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(p))) {
            const type = url.searchParams.get('uploadType');
            const target = m[1] ? this.files.get(m[1]) : null;
            if (m[1] && !target) return err(404, 'File not found: ' + m[1]);
            if (type === 'multipart' && (req.method === 'POST' || req.method === 'PATCH')) {
                const { meta, content } = parseMultipart(req.headers['content-type'], req.body);
                const f = target ?? this.#create(meta, content);
                if (target) { this.#patch(f, meta); this.#setContent(f, content); }
                return json(200, this.#pick(f, fields));
            }
            if (type === 'resumable' && url.searchParams.has('upload_id') && req.method === 'PUT') {
                const up = this.uploads.get(url.searchParams.get('upload_id'));
                if (!up) return err(404, 'No such upload');
                this.uploads.delete(url.searchParams.get('upload_id'));
                const f = up.target ? this.files.get(up.target) : this.#create(up.meta, req.body);
                if (up.target) { this.#patch(f, up.meta); this.#setContent(f, req.body); }
                return json(200, this.#pick(f, up.fields));
            }
            if (type === 'resumable' && (req.method === 'POST' || req.method === 'PATCH')) {
                const id = 'u' + randomBytes(8).toString('hex');
                this.uploads.set(id, { meta: JSON.parse(req.body.toString() || '{}'), target: target?.id ?? null, fields });
                const loc = `https://www.googleapis.com/upload/drive/v3/files${target ? '/' + target.id : ''}?uploadType=resumable&upload_id=${id}`;
                return { status: 200, headers: { ...cors, 'x-guploader-uploadid': id, ...(this.hideLocation ? {} : { location: loc }) }, body: '' };
            }
        }
        return err(400, `fake Google does not serve ${req.method} ${url.host}${p}`);
    }

    // Consent at once: the browser is sent back to the client's redirect with a code and the state.
    #authorize(url) {
        const q = url.searchParams;
        if (!this.clientIds.has(q.get('client_id'))) return { status: 400, headers: {}, body: 'invalid_client' };
        if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return { status: 400, headers: {}, body: 'pkce required' };
        const code = '4/fake-' + randomBytes(10).toString('hex');
        this.codes.set(code, { challenge: q.get('code_challenge'), redirect: q.get('redirect_uri'), client: q.get('client_id'), scope: q.get('scope'),
                               offline: q.get('access_type') === 'offline', consent: (q.get('prompt') ?? '').split(' ').includes('consent') });
        const back = new URL(q.get('redirect_uri'));
        back.searchParams.set('code', code);
        back.searchParams.set('state', q.get('state') ?? '');
        back.searchParams.set('scope', q.get('scope') ?? '');
        return { status: 302, headers: { location: back.toString() }, body: '' };
    }
    #token(body, json) {
        const form = new URLSearchParams(body?.toString() ?? '');
        const kind = form.get('grant_type');
        if (kind === 'authorization_code') {
            const grant = this.codes.get(form.get('code'));
            this.codes.delete(form.get('code'));
            if (!grant) return json(400, { error: 'invalid_grant', error_description: 'Bad code.' });
            const challenge = b64url(createHash('sha256').update(form.get('code_verifier') ?? '').digest());
            if (challenge !== grant.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch.' });
            if (form.get('redirect_uri') !== grant.redirect) return json(400, { error: 'redirect_uri_mismatch' });
            const access = { access_token: this.issueAccessToken(grant.scope), expires_in: 3599, scope: grant.scope, token_type: 'Bearer' };
            if (!grant.offline || (this.#offlineGranted.has(grant.client) && !grant.consent)) return json(200, access);
            this.#offlineGranted.add(grant.client);
            const refresh = '1//fake-' + randomBytes(12).toString('hex');
            this.refreshTokens.set(refresh, { scope: grant.scope, client: grant.client });
            return json(200, { ...access, refresh_token: refresh });
        }
        if (kind === 'refresh_token') {
            const grant = this.refreshTokens.get(form.get('refresh_token'));
            if (!grant) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
            return json(200, { access_token: this.issueAccessToken(grant.scope), expires_in: 3599, scope: grant.scope, token_type: 'Bearer' });
        }
        return json(400, { error: 'unsupported_grant_type' });
    }

    // Adapters.
    asFetch() {
        return async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            const headers = Object.fromEntries(Object.entries(Object.fromEntries(new Headers(init.headers ?? {}))).map(([k, v]) => [k.toLowerCase(), v]));
            const body = init.body == null ? Buffer.alloc(0) : await toBuffer(init.body);
            // A fault in the fake itself would read as a dropped connection, retried and then reported
            // as Drive being unreachable; it is said here instead.
            const res = await this.handle({ method: (init.method ?? 'GET').toUpperCase(), url, headers, body })
                .catch((e) => { console.error('fake Google failed:', e); throw e });
            return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers });
        };
    }
    async route(context) {
        const handler = async (route) => {
            const r = route.request();
            let res;
            try { res = await this.handle({ method: r.method(), url: r.url(), headers: await r.allHeaders(), body: r.postDataBuffer() ?? Buffer.alloc(0) }) }
            catch { return route.abort('connectionreset') }
            await route.fulfill({ status: res.status, headers: res.headers, body: typeof res.body === 'string' ? res.body : Buffer.from(res.body ?? '') });
        };
        await context.route('https://www.googleapis.com/**', handler);
        await context.route('https://oauth2.googleapis.com/**', handler);
    }
    // The Mac app's main process reaches Google through these, given as its endpoints.
    async listen() {
        const server = createServer(async (req, res) => {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const host = req.url.startsWith('/accounts/') ? 'accounts.google.com' : req.url.startsWith('/oauth2/') ? 'oauth2.googleapis.com' : 'www.googleapis.com';
            const pathname = req.url.replace(/^\/(accounts|oauth2|www)/, '');
            const out = await this.handle({ method: req.method, url: `https://${host}${pathname}`, headers: req.headers, body: Buffer.concat(chunks) });
            res.writeHead(out.status, out.headers);
            res.end(out.body);
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const base = `http://127.0.0.1:${server.address().port}`;
        return {
            server,
            authUrl: base + '/accounts/o/oauth2/v2/auth',
            tokenUrl: base + '/oauth2/token',
            revokeUrl: base + '/oauth2/revoke',
            close: () => new Promise((r) => server.close(r)),
        };
    }
}

async function toBuffer(body) {
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === 'string') return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    if (typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer());
    if (body instanceof URLSearchParams) return Buffer.from(body.toString());
    throw new Error('fake Google cannot read this body');
}

// `multipart/related`: the JSON metadata, then the content, each with its own headers.
export function parseMultipart(contentType, body) {
    const boundary = /boundary="?([^";]+)"?/.exec(contentType ?? '')?.[1];
    if (!boundary) throw new Error('multipart without a boundary');
    const sep = Buffer.from('--' + boundary);
    const parts = [];
    let at = body.indexOf(sep);
    while (at !== -1) {
        const next = body.indexOf(sep, at + sep.length);
        if (next === -1) break;
        let part = body.subarray(at + sep.length, next);
        if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
        if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, part.length - 2);
        const split = part.indexOf('\r\n\r\n');
        parts.push({ head: part.subarray(0, split).toString(), body: part.subarray(split + 4) });
        at = next;
    }
    if (parts.length !== 2) throw new Error(`multipart with ${parts.length} parts`);
    return { meta: JSON.parse(parts[0].body.toString() || '{}'), content: parts[1].body };
}
