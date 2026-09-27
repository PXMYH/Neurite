// Python code blocks run on Pyodide, which bundlecode.js imports from its CDN by URL.
// That URL string held "/* @vite-ignore */ " in front of it -- a Vite directive that
// belongs inside `import(...)`, not inside the string, and that Vite never reads here
// anyway: the file is loaded by PageLoad, not bundled. import() resolved the string as
// a relative path beginning "/*", so no Python block ever ran, in the browser or the
// macOS app. Measured after the fix: `print(6 * 7)` in a note prints 42 in both.
//
// The URL is read out of the source rather than imported, the same way the rest of
// this suite reaches js/: nothing there exports anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('js/nodes/nodeinteraction/bundlecode.js', 'utf8');

test('Pyodide is imported from an absolute https URL', () => {
    const urls = [...source.matchAll(/^\s*url = "([^"]*)";/gm)].map((m) => m[1]);
    assert.equal(urls.length, 1, 'one url field on the Pyodide loader');

    const url = new URL(urls[0]);        // throws on anything relative
    assert.equal(url.protocol, 'https:');
    assert.equal(url.host, 'cdn.jsdelivr.net');
    assert.ok(url.pathname.endsWith('/pyodide.mjs'), url.pathname);
});

test('the loader imports that field, not a literal', () => {
    assert.match(source, /import\(this\.url\)/);
});
