'use strict';

// The two DirectAccess endpoints hand a caller-supplied string to `fs`. Any page
// that can reach the gateway can call them, so the string has to be treated as
// hostile: `path.resolve('/etc/passwd')` is a valid path, and so is
// `../../../../etc/passwd` from wherever the server happens to have started.
//
// Everything here answers one question -- which real file on disk does this
// request name -- and refuses to answer any other way than "one inside the root".
// Three rules make that hold:
//
//   1. The request path is always read as *relative to the root*, never as a
//      filesystem path. `/` is the root, not the disk's root. The file tree in the
//      browser already builds its paths by descending from `/`, so it keeps
//      working; a saved absolute path from before this change lands under the root
//      and is refused, which is the intended loss.
//   2. Containment is decided after `realpath`, not by comparing strings. A
//      symlink inside the root that points out of it resolves out of it and is
//      refused. A path that does not exist yet is canonicalised through its
//      deepest existing ancestor, because the missing tail cannot be a symlink.
//   3. Containment is a path-segment test (`path.relative`), never
//      `startsWith(root)`. `/tmp/root-evil` starts with `/tmp/root` and is not
//      inside it.
//
// `path` and `realpath` are injectable so the separator rules can be tested for
// both platforms from either one: on POSIX a backslash is a legal filename
// character, on Windows it is a separator, and a guard built on the wrong one is
// a traversal on the other.

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const nodePath = require('path');

const REFUSAL_INVALID = 'invalid';  // the request is not a path we can read at all
const REFUSAL_DENIED = 'denied';    // it is a path, and it is not inside the root

// Where the root comes from. Set DIRECTACCESS_ROOT to the one folder the file
// tree may browse. The default is the home directory: narrow enough to be a
// boundary, wide enough that the file tree still has something to show. A
// configured root that does not exist is a startup error, never a fallback to
// something wider.
function resolveRoot(env = process.env) {
    const configured = env.DIRECTACCESS_ROOT;
    if (typeof configured === 'string' && configured.trim() !== '') return configured.trim();
    return os.homedir() || process.cwd();
}

function defaultRealpath(p) {
    // `.native` follows the platform's own casing rules, which is what the
    // containment test needs on a case-insensitive filesystem.
    return (fs.realpathSync.native || fs.realpathSync)(p);
}

// Does something sit at this path, symlink or not? Used to tell "nothing is
// here" apart from "a symlink is here and it points at nothing".
function entryExists(p, lstat) {
    try {
        lstat(p);
        return true;
    } catch {
        return false;
    }
}

// Reads a request path as a location under the root. Absolute input, a drive
// letter, repeated separators and `.`/`..` segments all collapse into a plain
// relative path; nothing here decides whether the result is allowed.
function toRootRelative(requestPath, path) {
    let rest = requestPath;
    if (path.sep === '\\') {
        // Windows accepts both separators, and a drive letter cannot be allowed to
        // pick a root of its own.
        rest = rest.replace(/\//g, '\\').replace(/^[A-Za-z]:/, '');
    }
    while (rest.startsWith(path.sep)) rest = rest.slice(path.sep.length);
    return rest === '' ? '.' : rest;
}

// The real path of `target`, resolving every symlink that exists. A missing tail
// is re-attached to the canonical form of the deepest ancestor that does exist,
// so a path that is only about to be created is still judged in the right place.
function canonicalize(target, path, realpath, lstat) {
    const tail = [];
    let current = target;
    for (;;) {
        try {
            const resolved = realpath(current);
            return tail.length > 0 ? path.join(resolved, ...tail) : resolved;
        } catch (err) {
            // ENOTDIR is the same question as ENOENT here: a segment of the path is
            // a file, so the rest of it does not exist.
            if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
            // A dangling symlink is an entry with no real path. Re-attaching it as
            // if it were a missing name would judge a link by its own location
            // while `stat` and `open` would follow it to wherever its target
            // appears -- possibly outside the root, and possibly only after this
            // check. Nothing can be proven about it, so it does not resolve.
            if (entryExists(current, lstat)) {
                const dangling = new Error('dangling symlink');
                dangling.code = 'ENOENT_LINK';
                throw dangling;
            }
        }
        const parent = path.dirname(current);
        // Nothing along the path exists (only reachable with a stubbed realpath).
        // `target` is already absolute and normalised, so it is safe to judge.
        if (parent === current) return target;
        tail.unshift(path.basename(current));
        current = parent;
    }
}

// Path-segment containment. `root` and `target` are both canonical.
function isInside(root, target, path) {
    if (target === root) return true;
    const rel = path.relative(root, target);
    if (rel === '') return true;
    if (rel === '..' || rel.startsWith('..' + path.sep)) return false;
    return !path.isAbsolute(rel);
}

function createPathGuard(options = {}) {
    const path = options.path || nodePath;
    const realpath = options.realpath || defaultRealpath;
    const lstat = options.lstat || fs.lstatSync;
    const root = options.root;

    if (typeof root !== 'string' || root.trim() === '') {
        throw new Error('DirectAccess needs a root directory; set DIRECTACCESS_ROOT.');
    }

    let canonicalRoot;
    try {
        canonicalRoot = realpath(path.resolve(root));
    } catch (err) {
        throw new Error(
            'DirectAccess root is not a readable directory: ' + root +
            ' (' + (err.code || err.message) + '). Set DIRECTACCESS_ROOT to a folder that exists.'
        );
    }

    // A root that is a file answers every request with the same puzzling refusal, so
    // say it once at startup instead. Only when it can be read at all: an injected
    // `lstat` that cannot see the root is not evidence against it.
    let rootStats = null;
    try { rootStats = lstat(canonicalRoot) } catch { /* nothing to add */ }
    if (rootStats && !rootStats.isDirectory()) {
        throw new Error('DirectAccess root is not a directory: ' + canonicalRoot);
    }

    function resolve(requestPath) {
        // No path at all means the root itself, which is how `/navigate` opens.
        if (requestPath === undefined || requestPath === null || requestPath === '') {
            return {ok: true, path: canonicalRoot};
        }
        if (typeof requestPath !== 'string') {
            return {ok: false, code: REFUSAL_INVALID, reason: 'path is not a string'};
        }
        // Express has already percent-decoded the query, so a NUL byte can arrive
        // here as one character. `fs` throws on it; refuse it by name instead.
        if (requestPath.includes('\0')) {
            return {ok: false, code: REFUSAL_INVALID, reason: 'path contains a NUL byte'};
        }

        const target = path.resolve(canonicalRoot, toRootRelative(requestPath, path));

        let canonical;
        try {
            canonical = canonicalize(target, path, realpath, lstat);
        } catch (err) {
            // Cannot prove where this points (EACCES, ELOOP, ENAMETOOLONG), so it
            // does not get read. Fail closed.
            return {ok: false, code: REFUSAL_DENIED, reason: 'unresolvable: ' + (err.code || err.message)};
        }

        if (!isInside(canonicalRoot, canonical, path)) {
            return {ok: false, code: REFUSAL_DENIED, reason: 'outside the root'};
        }
        return {ok: true, path: canonical};
    }

    return {root: canonicalRoot, resolve};
}

const MIME_TYPES = {
    // Text files
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.py': 'application/x-python-code',
    '.rb': 'application/x-ruby',
    '.php': 'application/x-httpd-php',
    '.java': 'text/x-java-source',
    '.c': 'text/x-csrc',
    '.cpp': 'text/x-c++src',
    '.cs': 'text/x-csharp',
    '.go': 'text/x-go',
    '.rs': 'application/x-rust',
    '.sh': 'application/x-sh',
    '.xml': 'application/xml',
    '.json': 'application/json',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
    '.csv': 'text/csv',
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    // Video
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.mkv': 'video/x-matroska',
    // Documents
    '.pdf': 'application/pdf',
    // Archives
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    // Executables
    '.exe': 'application/vnd.microsoft.portable-executable',
    '.msi': 'application/x-msdownload',
    // Fonts
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function getMimeType(extension) {
    return MIME_TYPES[String(extension).toLowerCase()] || 'application/octet-stream';
}

// The request handlers, free of express so they can be driven directly. Every
// refusal answers in the same words whatever the reason was: the response says
// only that the request was refused, and the detail goes to the server's log.
function createFileAccess(options = {}) {
    const guard = options.guard || createPathGuard({root: options.root || resolveRoot()});
    const fileSystem = options.fs || fs;
    const promises = options.fsPromises || fsp;
    const log = options.log || ((...args) => console.warn('[DirectAccess]', ...args));

    function refuse(res, requestPath, refusal) {
        log('refused', JSON.stringify(String(requestPath)), '-', refusal.reason);
        if (refusal.code === REFUSAL_INVALID) return res.status(400).json({error: 'Invalid path'});
        return res.status(403).json({error: 'Access denied'});
    }

    async function navigate(req, res) {
        const requestPath = req.query ? req.query.path : undefined;
        const resolved = guard.resolve(requestPath);
        if (!resolved.ok) return refuse(res, requestPath, resolved);

        try {
            const stats = await promises.stat(resolved.path);
            if (!stats.isDirectory()) return res.status(400).json({error: 'Invalid directory path'});

            const items = await promises.readdir(resolved.path, {withFileTypes: true});
            return res.json(items.map((item) => ({
                name: item.name,
                type: item.isDirectory() ? 'directory' : 'file'
            })));
        } catch (err) {
            if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
                return res.status(400).json({error: 'Invalid directory path'});
            }
            // `err.message` carries the absolute path and the errno; keep both out
            // of the response.
            log('navigate failed', err.code || err.message);
            return res.status(500).json({error: 'Unable to navigate directory'});
        }
    }

    async function readFile(req, res) {
        const requestPath = req.query ? req.query.path : undefined;
        if (!requestPath) return res.status(400).json({error: 'File path is required'});

        const resolved = guard.resolve(requestPath);
        if (!resolved.ok) return refuse(res, requestPath, resolved);

        try {
            const stats = await promises.stat(resolved.path);
            if (!stats.isFile()) return res.status(404).json({error: 'File not found or is not a file'});
        } catch (err) {
            log('read-file stat failed', err.code || err.message);
            return res.status(404).json({error: 'File not found or is not a file'});
        }

        const mimeType = getMimeType(nodePath.extname(resolved.path));
        res.setHeader('Content-Type', mimeType);

        // The canonical path is what gets opened: re-resolving the request string
        // here would be a second answer to a question already settled.
        const readStream = fileSystem.createReadStream(resolved.path, {
            encoding: mimeType.startsWith('text/') ? 'utf8' : null
        });
        readStream.on('error', (err) => {
            log('read-file stream failed', err.code || err.message);
            if (res.headersSent) res.end();
            else res.status(500).json({error: 'Unable to read file'});
        });
        readStream.pipe(res);
    }

    return {root: guard.root, guard, navigate, readFile};
}

module.exports = {
    REFUSAL_DENIED,
    REFUSAL_INVALID,
    createFileAccess,
    createPathGuard,
    getMimeType,
    resolveRoot
};
