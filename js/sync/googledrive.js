// The Google Drive calls cloud sync makes (docs/cloud-sync.md): Neurite's folder, the files in it,
// and a file's content up and down. Under the `drive.file` scope, so only what Neurite made is
// visible to it. The page calls Drive itself: Drive answers CORS from `app://neurite`, from
// GitHub Pages and from localhost (measured).
//
// The retries are Notion's, read from its Drive connector's settings (`googleApiRetryConfig`,
// `googleApiTimeoutMS`): after 500, 1000 and 2000 ms, each up to 500 ms later -- or after what a
// `Retry-After` asks, up to a minute -- and a minute at most for one call. A 401 is retried once,
// with a fresh token. A request that makes a file is not repeated after an answer that never came
// or a server error, which may have made it: the caller finds it by its operation id instead.
class DriveError extends Error {
    constructor(message, status = 0, reason = 'http'){
        super(message);
        this.name = 'DriveError';
        this.status = status;
        this.reason = reason;
    }
}

class GoogleDrive {
    static API = 'https://www.googleapis.com';
    static FOLDER_TYPE = 'application/vnd.google-apps.folder';
    static FOLDER_NAME = 'Neurite';
    static FILE_TYPE = 'application/octet-stream';
    static FILE_FIELDS = 'id,name,md5Checksum,headRevisionId,version,modifiedTime,size,appProperties,trashed,parents';
    static RETRY_MS = [500, 1000, 2000];
    static JITTER_MS = 500;
    static TIMEOUT_MS = 60000;
    // Google's limit for an upload of metadata and content in one request; larger goes resumable.
    static MULTIPART_MAX = 5 * 1024 * 1024;

    // `token()` settles on an access token or null; `token({fresh: true})` asks for a new one.
    constructor({token, fetch = globalThis.fetch?.bind(globalThis), sleep, random = Math.random}){
        this.token = token;
        this.fetch = fetch;
        this.sleep = sleep ?? ((ms)=>new Promise( (r)=>setTimeout(r, ms) ));
        this.random = random;
    }

    // A quoted value in Drive's query language.
    static quote(value){ return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'" }

    async #send(method, path, {query, json, body, headers = {}, url, makes = false} = {}){
        const target = new URL(url ?? (GoogleDrive.API + path));
        for (const [k, v] of Object.entries(query ?? {})) target.searchParams.set(k, v);
        if (json !== undefined) {
            body = JSON.stringify(json);
            headers = {'Content-Type': 'application/json; charset=UTF-8', ...headers};
        }

        let fresh = false;
        for (let attempt = 0; ; attempt++) {
            const token = await this.token({fresh});
            if (!token) throw new DriveError("Google Drive is not connected.", 401, 'unauthorized');

            let res = null;
            try {
                res = await this.fetch(target.toString(), {
                    method, body, headers: {...headers, Authorization: 'Bearer ' + token},
                    signal: AbortSignal.timeout?.(GoogleDrive.TIMEOUT_MS)
                });
            } catch (err) {
                if (!makes && attempt < GoogleDrive.RETRY_MS.length) { await this.#pause(attempt); continue }
                throw new DriveError("Google Drive could not be reached.", 0, makes ? 'unknown' : 'network');
            }
            if (res.ok) return res;
            if (res.status === 401 && !fresh) { fresh = true; continue }
            const error = await GoogleDrive.#errorOf(res);
            const limited = (res.status === 429 || (res.status === 403 && /rateLimitExceeded/i.test(error.reason)));
            if ((limited || (!makes && res.status >= 500)) && attempt < GoogleDrive.RETRY_MS.length) {
                await this.#pause(attempt, res.headers.get('Retry-After'));
                continue;
            }
            const reason = (res.status === 401 ? 'unauthorized'
                          : (makes && (res.status >= 500 || res.status === 404)) ? 'unknown'
                          : res.status === 404 ? 'notFound' : 'http');
            throw new DriveError(error.message, res.status, reason);
        }
    }
    #pause(attempt, retryAfter = null){
        const asked = Number(retryAfter) * 1000;
        const ms = (asked > 0) ? Math.min(asked, 60000)
                 : GoogleDrive.RETRY_MS[attempt] + Math.floor(this.random() * GoogleDrive.JITTER_MS);
        return this.sleep(ms);
    }
    static async #errorOf(res){
        const text = await res.text().catch( ()=>'' );
        let e = null;
        try { e = JSON.parse(text)?.error } catch {}
        return {message: e?.message || ('Google Drive answered ' + res.status), reason: String(e?.errors?.[0]?.reason ?? e?.status ?? '')};
    }
    async #json(method, path, options){ return (await this.#send(method, path, options)).json() }
    // Every page of a list: Drive answers one page at a time, with where the next one begins.
    async #all(path, query, key){
        const items = [];
        let pageToken = null;
        do {
            const page = await this.#json('GET', path, {query: pageToken ? {...query, pageToken} : query});
            items.push(...(page[key] ?? []));
            pageToken = page.nextPageToken ?? null;
        } while (pageToken);
        return items;
    }
    // Files that match a query, with the fields a binding needs.
    #files(q, extra = {}){
        return this.#all('/drive/v3/files', {q, fields: `nextPageToken,files(${GoogleDrive.FILE_FIELDS})`, spaces: 'drive', pageSize: '1000', ...extra}, 'files');
    }

    async about(){
        return (await this.#json('GET', '/drive/v3/about', {query: {fields: 'user(emailAddress,displayName)'}})).user ?? null;
    }

    // Neurite's folders, the oldest first: those marked as Neurite's, whatever each is called now.
    // There is meant to be one; two devices that make it together make two, and the files of both
    // are read, while new files go to the oldest.
    async folders(){
        const q = [`mimeType = '${GoogleDrive.FOLDER_TYPE}'`, 'trashed = false',
                   `appProperties has { key='neuriteFolder' and value='1' }`].join(' and ');
        const found = await this.#all('/drive/v3/files', {q, fields: 'nextPageToken,files(id,createdTime)', spaces: 'drive'}, 'files');
        return found.sort( (a, b)=>String(a.createdTime).localeCompare(String(b.createdTime)) ).map( (f)=>f.id );
    }
    // The oldest, made the first time at the top of My Drive. Not asked twice: an answer that never
    // came may have made it, and the next look finds it by its mark.
    async folderId(){
        const [oldest] = await this.folders();
        if (oldest) return oldest;
        const made = await this.#json('POST', '/drive/v3/files', {
            query: {fields: 'id'},
            json: {name: GoogleDrive.FOLDER_NAME, mimeType: GoogleDrive.FOLDER_TYPE, parents: ['root'],
                   appProperties: {neuriteFolder: '1'}},
            makes: true
        });
        return made.id;
    }

    // The Graphs in the folders, the latest first.
    async list(folderIds){
        const files = [];
        for (const id of [].concat(folderIds)) {
            const q = [`${GoogleDrive.quote(id)} in parents`, `mimeType != '${GoogleDrive.FOLDER_TYPE}'`, 'trashed = false'].join(' and ');
            files.push(...await this.#files(q, {orderBy: 'modifiedTime desc'}));
        }
        return files.filter(GoogleDrive.isGraphFile)
            .sort( (a, b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)) );
    }
    static isGraphFile(f){ return Boolean(f?.id) && /\.neurite$/i.test(f.name ?? '') }

    // A Graph's files, by the lineage id its saves carry, the latest first; never a conflict copy.
    async findByUuid(folderIds, uuid){
        const files = [];
        for (const id of [].concat(folderIds)) {
            const q = [`${GoogleDrive.quote(id)} in parents`, 'trashed = false',
                       `appProperties has { key='neuriteUuid' and value=${GoogleDrive.quote(uuid)} }`].join(' and ');
            files.push(...await this.#files(q));
        }
        return files.filter( (f)=>!(f.appProperties?.neuriteConflictOf) )
            .sort( (a, b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)) );
    }
    // The files a push made, by the operation id it carried, wherever they are now: a create, an
    // update or a conflict copy whose answer never came back.
    findByOp(op){
        return this.#files(['trashed = false', `appProperties has { key='neuriteOp' and value=${GoogleDrive.quote(op)} }`].join(' and '));
    }

    // A file's content revisions, the oldest first by time: where a write that landed between
    // another device's check and its own is found again. Drive does not say in what order it lists
    // them, so they are put in order here.
    async revisions(fileId){
        const all = await this.#all('/drive/v3/files/' + encodeURIComponent(fileId) + '/revisions',
                                    {fields: 'nextPageToken,revisions(id,md5Checksum,modifiedTime)', pageSize: '1000'}, 'revisions');
        return all.map( (r, i)=>({r, i}) )
            .sort( (a, b)=>(String(a.r.modifiedTime).localeCompare(String(b.r.modifiedTime)) || a.i - b.i) )
            .map( ({r})=>r );
    }
    // Drive gives a binary file's earlier revision only once it is marked to be kept forever, which
    // also keeps Drive from purging it while it is read. The mark is taken off again once a copy of
    // it is safe (`keepRevision(..., false)`): Drive allows 200 a file.
    keepRevision(fileId, revisionId, keep = true){
        return this.#json('PATCH', '/drive/v3/files/' + encodeURIComponent(fileId) + '/revisions/' + encodeURIComponent(revisionId),
                          {query: {fields: 'id,keepForever'}, json: {keepForever: keep}});
    }
    async downloadRevision(fileId, revisionId){
        await this.keepRevision(fileId, revisionId, true);
        return (await this.#send('GET', '/drive/v3/files/' + encodeURIComponent(fileId) + '/revisions/' + encodeURIComponent(revisionId),
                                 {query: {alt: 'media'}})).blob();
    }

    get(fileId, fields = GoogleDrive.FILE_FIELDS){
        return this.#json('GET', '/drive/v3/files/' + encodeURIComponent(fileId), {query: {fields}});
    }
    async download(fileId){
        return (await this.#send('GET', '/drive/v3/files/' + encodeURIComponent(fileId), {query: {alt: 'media'}})).blob();
    }
    rename(fileId, name){
        return this.#json('PATCH', '/drive/v3/files/' + encodeURIComponent(fileId), {
            query: {fields: GoogleDrive.FILE_FIELDS}, json: {name}
        });
    }

    // A new file in the folder, or new content for one: in one request up to 5 MiB, resumable above.
    upload({fileId = null, folderId = null, name, appProperties = {}, blob}){
        const meta = {name, appProperties};
        if (!fileId) Object.assign(meta, {mimeType: GoogleDrive.FILE_TYPE, parents: [folderId]});
        return (blob.size <= GoogleDrive.MULTIPART_MAX) ? this.#multipart(fileId, meta, blob)
                                                         : this.#resumable(fileId, meta, blob);
    }
    #uploadPath(fileId){ return '/upload/drive/v3/files' + (fileId ? '/' + encodeURIComponent(fileId) : '') }
    // As bytes rather than a Blob: at most 5 MiB, and a body every test harness can read --
    // Playwright's WebKit cannot see a Blob body, and the upload looked blocked there.
    async #multipart(fileId, meta, blob){
        const boundary = 'neurite' + Math.floor(this.random() * 1e16).toString(36);
        const body = await new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(meta),
            `\r\n--${boundary}\r\nContent-Type: ${GoogleDrive.FILE_TYPE}\r\n\r\n`, blob,
            `\r\n--${boundary}--`
        ]).arrayBuffer();
        return this.#json(fileId ? 'PATCH' : 'POST', this.#uploadPath(fileId), {
            query: {uploadType: 'multipart', fields: GoogleDrive.FILE_FIELDS},
            headers: {'Content-Type': `multipart/related; boundary=${boundary}`},
            body, makes: !fileId
        });
    }
    // The start answers with the session's address. A browser may read only the upload id that
    // Google exposes, so the address is built from it when `Location` is hidden.
    async #resumable(fileId, meta, blob){
        const start = await this.#send(fileId ? 'PATCH' : 'POST', this.#uploadPath(fileId), {
            query: {uploadType: 'resumable', fields: GoogleDrive.FILE_FIELDS},
            json: meta,
            headers: {'X-Upload-Content-Type': GoogleDrive.FILE_TYPE, 'X-Upload-Content-Length': String(blob.size)}
        });
        const id = start.headers.get('X-GUploader-UploadID');
        const session = start.headers.get('Location')
            ?? (id && `${GoogleDrive.API}${this.#uploadPath(fileId)}?uploadType=resumable&upload_id=${encodeURIComponent(id)}`);
        if (!session) throw new DriveError("Google Drive gave no upload address.", start.status, 'http');

        return (await this.#send('PUT', null, {
            url: session, query: {fields: GoogleDrive.FILE_FIELDS},
            headers: {'Content-Type': GoogleDrive.FILE_TYPE}, body: blob, makes: true
        })).json();
    }
}
