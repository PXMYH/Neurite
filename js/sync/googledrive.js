// The Google Drive calls cloud sync makes (docs/cloud-sync.md): Neurite's folder, the files in it,
// and a file's content up and down. Under the `drive.file` scope, so only what Neurite made is
// visible to it. The page calls Drive itself: Drive answers CORS from `app://neurite`, from
// GitHub Pages and from localhost (measured).
//
// The retries are Notion's, read from its Drive connector's settings (`googleApiRetryConfig`,
// `googleApiTimeoutMS`): after 500, 1000 and 2000 ms, each up to 500 ms later, and a minute at most
// for one call. A 401 is retried once, with a fresh token.
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

    async #send(method, path, {query, json, body, headers = {}, url} = {}){
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
                if (attempt < GoogleDrive.RETRY_MS.length) { await this.#pause(attempt); continue }
                throw new DriveError("Google Drive could not be reached.", 0, 'network');
            }
            if (res.ok) return res;
            if (res.status === 401 && !fresh) { fresh = true; continue }
            if ((res.status === 429 || res.status >= 500) && attempt < GoogleDrive.RETRY_MS.length) {
                await this.#pause(attempt);
                continue;
            }
            const reason = (res.status === 401 ? 'unauthorized' : res.status === 404 ? 'notFound' : 'http');
            throw new DriveError(await GoogleDrive.#messageOf(res), res.status, reason);
        }
    }
    #pause(attempt){
        return this.sleep(GoogleDrive.RETRY_MS[attempt] + Math.floor(this.random() * GoogleDrive.JITTER_MS));
    }
    static async #messageOf(res){
        const text = await res.text().catch( ()=>'' );
        try { return JSON.parse(text)?.error?.message || ('Google Drive answered ' + res.status) }
        catch { return 'Google Drive answered ' + res.status }
    }
    async #json(method, path, options){ return (await this.#send(method, path, options)).json() }

    async about(){
        return (await this.#json('GET', '/drive/v3/about', {query: {fields: 'user(emailAddress,displayName)'}})).user ?? null;
    }

    // Neurite's folder at the top of My Drive, made the first time. By name, since the folder is
    // the one place a person looks for the files; then by id, which is remembered.
    async folderId(known = null){
        if (known) {
            const f = await this.get(known, 'id,trashed,mimeType').catch( (err)=>{
                if (err.reason === 'notFound') return null;
                throw err;
            });
            if (f && !f.trashed && f.mimeType === GoogleDrive.FOLDER_TYPE) return f.id;
        }
        const q = [`name = ${GoogleDrive.quote(GoogleDrive.FOLDER_NAME)}`, `mimeType = '${GoogleDrive.FOLDER_TYPE}'`,
                   `'root' in parents`, 'trashed = false'].join(' and ');
        const found = await this.#json('GET', '/drive/v3/files', {query: {q, fields: 'files(id,createdTime)', spaces: 'drive'}});
        const first = (found.files ?? []).sort( (a, b)=>String(a.createdTime).localeCompare(String(b.createdTime)) )[0];
        if (first) return first.id;

        const made = await this.#json('POST', '/drive/v3/files', {
            query: {fields: 'id'},
            json: {name: GoogleDrive.FOLDER_NAME, mimeType: GoogleDrive.FOLDER_TYPE, parents: ['root']}
        });
        return made.id;
    }

    // The Graphs in the folder, the latest first.
    async list(folderId){
        const q = [`${GoogleDrive.quote(folderId)} in parents`, `mimeType != '${GoogleDrive.FOLDER_TYPE}'`,
                   'trashed = false'].join(' and ');
        const res = await this.#json('GET', '/drive/v3/files', {
            query: {q, fields: `files(${GoogleDrive.FILE_FIELDS})`, spaces: 'drive', pageSize: '1000', orderBy: 'modifiedTime desc'}
        });
        return (res.files ?? []).filter(GoogleDrive.isGraphFile)
            .sort( (a, b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)) );
    }
    static isGraphFile(f){ return Boolean(f?.id) && /\.neurite$/i.test(f.name ?? '') }

    // A Graph's file, by the lineage id its save carries; the latest if there are several.
    async findByUuid(folderId, uuid){
        const q = [`${GoogleDrive.quote(folderId)} in parents`, 'trashed = false',
                   `appProperties has { key='neuriteUuid' and value=${GoogleDrive.quote(uuid)} }`].join(' and ');
        const res = await this.#json('GET', '/drive/v3/files', {query: {q, fields: `files(${GoogleDrive.FILE_FIELDS})`, spaces: 'drive'}});
        return (res.files ?? []).filter( (f)=>!(f.appProperties?.neuriteConflictOf) )
            .sort( (a, b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)) )[0] ?? null;
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
    #multipart(fileId, meta, blob){
        const boundary = 'neurite' + Math.floor(this.random() * 1e16).toString(36);
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(meta),
            `\r\n--${boundary}\r\nContent-Type: ${GoogleDrive.FILE_TYPE}\r\n\r\n`, blob,
            `\r\n--${boundary}--`
        ]);
        return this.#json(fileId ? 'PATCH' : 'POST', this.#uploadPath(fileId), {
            query: {uploadType: 'multipart', fields: GoogleDrive.FILE_FIELDS},
            headers: {'Content-Type': `multipart/related; boundary=${boundary}`},
            body
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
            headers: {'Content-Type': GoogleDrive.FILE_TYPE}, body: blob
        })).json();
    }
}
