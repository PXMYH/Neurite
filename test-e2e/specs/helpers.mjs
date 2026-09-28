// Shared plumbing for the browser eval specs. Uses the bare `playwright` library
// (not @playwright/test) on purpose -- the repo keeps a single test runner,
// `node --test` (see CLAUDE.md), and the automation server already depends on
// `playwright`, so nothing new is added here.
import { chromium, webkit, devices } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.NEURITE_E2E_URL || 'http://127.0.0.1:9123/';

// The CDN libraries `index.html` loads -- CodeMirror, localforage, Prism, pdf.js -- served
// from a cache on disk after the first fetch. A run of the suite loads them some 2,800
// times, and on a bad minute the CDN answered some with nothing: three boots in one run
// came up with no CodeMirror and no localforage, and failed as timeouts on `appReady`.
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//;
const CDN_CACHE = join(tmpdir(), 'neurite-e2e-cdn');
async function fromCdnCache(route) {
    const file = join(CDN_CACHE, createHash('sha1').update(route.request().url()).digest('hex'));
    if (existsSync(file + '.json')) {
        const { headers } = JSON.parse(readFileSync(file + '.json', 'utf8'));
        return route.fulfill({ status: 200, headers, body: readFileSync(file) });
    }
    const response = await route.fetch();
    const body = await response.body();
    if (response.ok()) {
        mkdirSync(CDN_CACHE, { recursive: true });
        writeFileSync(file, body);
        writeFileSync(file + '.json', JSON.stringify({ headers: {
            'content-type': response.headers()['content-type'] ?? 'application/octet-stream',
            'access-control-allow-origin': '*',
        } }));
    }
    return route.fulfill({ response, body });
}

// `NEURITE_E2E_BROWSER=webkit-ipad` runs a spec in WebKit as an iPad in landscape --
// Safari's engine, a touch screen, a 1194x834 window -- so a pointer decision meets the
// tablet before the tablet work builds on it. It needs `npx playwright install webkit`.
const IPAD = process.env.NEURITE_E2E_BROWSER === 'webkit-ipad';
// For a test to skip itself where Playwright cannot drive the gesture: mobile WebKit takes no
// `mouse.wheel`. The tablet's own gestures are the iPad map's.
export const isIPad = IPAD;

export function launchBrowser() {
    // Headless is the point: this runs unattended as an eval, not for watching.
    return (IPAD ? webkit : chromium).launch({ headless: true });
}

// A fresh, storage-isolated page sitting at the ready signal. Isolation is not
// optional: Neurite autosaves the graph and restores it on the next load, so a
// shared context would leak one test's nodes into the next. A new browser
// context per test gets its own IndexedDB / localStorage, so every test starts
// from the same blank graph.
//
// The `pageerror` listener is attached before the first navigation, so `errors`
// holds every uncaught exception the boot raised and a spec can assert it is
// empty. Only `pageerror` is collected, never console.error: the console carries
// failed fetches whenever the optional localhost gateway (7070) or Ollama is not
// running, which is an environment difference rather than a regression.
// `setup(context)` runs before the first navigation: a route the page needs at boot -- to
// hide a running gateway, say -- has to exist before the page asks. `touch` gives Chromium a
// touch screen and a coarse pointer at the iPad's size; the iPad already has both.
export async function openNeurite(browser, { setup, touch } = {}) {
    const context = await browser.newContext(IPAD ? devices['iPad Pro 11 landscape']
                                           : touch ? { viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true }
                                                   : { viewport: { width: 1600, height: 1000 } });
    await context.route(CDN, fromCdnCache);
    if (setup) await setup(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const failed = [];
    page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure()?.errorText ?? '')));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    // `window.appReady` (globals.js) flips true on the last line of App.init.
    // Graph / App / NodeView are lexical globals, NOT window properties -- reach
    // them by bare name inside evaluate(), never as `window.Graph`.
    //
    // A boot that never gets there says why, rather than only that it timed out: the
    // page errors, the requests that failed, and the last script the loader had added.
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 }).catch(async (e) => {
        const last = await page.evaluate(() => [...document.scripts].pop()?.src ?? null).catch(() => null);
        const local = failed.filter((u) => u.includes(new URL(BASE_URL).host));
        throw new Error(`${e.message}\n  page errors: ${JSON.stringify(errors)}\n  failed requests: ${JSON.stringify(local)}\n  last script: ${last}`);
    });
    return { context, page, errors };
}

// Create a text note through the public neural API (window.createNote) and return
// its uuid. The uuid is found by diffing Graph.nodes rather than trusting the
// call's return value, so it holds whatever shape createNote resolves to and
// makes no assumption about the graph being empty first.
//
// createNote writes `\n<Tag.node> title\nbody` into the shared Zettelkasten pane
// and the sync engine builds the node from that text, so the body reaches the
// node's textarea one pass LATER than the node itself appears in Graph.nodes.
// Reading the body straight after the call therefore sees '' and looks like the
// body was dropped. Waiting for it here is what keeps that race out of the specs.
export async function addNote(page, title, body = '') {
    const uuid = await page.evaluate(async ([t, b]) => {
        const before = new Set(Object.keys(Graph.nodes));
        await window.createNote(t, b);
        return Object.keys(Graph.nodes).find(k => !before.has(k)) ?? null;
    }, [title, body]);
    if (uuid !== null && body !== '') await waitForBody(page, uuid, body);
    return uuid;
}

// Create an AI note by appending an `<LLM_TAG> title` line to the pane, which is
// how a reader makes one -- there is no neural-API call for it. The write declares
// a rewrite pass, exactly as createNote's does, so the sync engine reads it as
// code-authored rather than typed, and the node arrives one pass later.
export async function addAiNote(page, title) {
    await page.evaluate((t) => {
        const cm = window.currentActiveZettelkastenMirror;
        const pane = window.zetPaneList.find(p => p.cm === cm) ?? window.zetPaneList[0];
        const last = cm.lastLine();
        pane.processor.writeAs(ZettelkastenProcessor.Pass.rewrite, () => cm.replaceRange(
            `\n\n${LLM_TAG} ${t}\n`, { line: last, ch: cm.getLine(last).length }));
    }, title);
    await page.waitForFunction(
        (t) => Object.values(Graph.nodes).some(n => n.getTitle() === t && n.isLLM),
        title,
        { timeout: 5000 }
    );
    return page.evaluate((t) => Object.keys(Graph.nodes).find(k => Graph.nodes[k].getTitle() === t), title);
}

export function paneText(page) {
    return page.evaluate(() => window.currentActiveZettelkastenMirror.getValue());
}

// Delete through the card's own header button, with a real click: the header
// buttons are bound through applySvgButtonUI, and a synthetic MouseEvent does not
// drive them. window.confirm is the app's own modal (customdialog.js) resolving to
// a boolean, so it is answered here rather than clicked through.
export async function deleteViaCard(page, uuid) {
    await page.evaluate(() => { window.confirm = async () => true; });
    const div = await nodeDiv(page, uuid);
    const btn = await div.$('#button-delete');
    if (!btn) throw new Error(`no delete button on node ${uuid}`);
    await btn.click();
    await page.waitForFunction((id) => !(id in Graph.nodes), uuid, { timeout: 5000 });
}

// Delete through the context menu's Delete entry, via the same NodeActions
// instance the menu builds. The class is chosen per node type, which is the point
// of covering this path separately from the card button.
// The menu's Delete asks first, as the card's does, so it is answered here too.
export async function deleteViaMenu(page, uuid) {
    await page.evaluate((id) => {
        window.confirm = async () => true;
        NodeActions.forNode(Graph.nodes[id]).delete();
    }, uuid);
    await page.waitForFunction((id) => !(id in Graph.nodes), uuid, { timeout: 5000 });
}

// Wait until a node's hidden body textarea holds `text`.
export function waitForBody(page, uuid, text) {
    return page.waitForFunction(
        ([id, t]) => Graph.nodes[id]?.textarea?.value === t,
        [uuid, text],
        { timeout: 5000 }
    );
}

// The DOM handles for a node are reached through the model, not a CSS id: a
// freshly created .window carries no queryable attribute (data-view-id is written
// only when a graph is saved and restored).
export async function nodeDiv(page, uuid) {
    const handle = await page.evaluateHandle((id) => Graph.nodes[id]?.view?.div ?? null, uuid);
    const el = handle.asElement();
    if (!el) throw new Error(`no .window for node ${uuid}`);
    return el;
}

export async function editableDiv(page, uuid) {
    const handle = await page.evaluateHandle((id) => Graph.nodes[id]?.contentEditableDiv ?? null, uuid);
    const el = handle.asElement();
    if (!el) throw new Error(`no editable-div for node ${uuid}`);
    return el;
}

// Type into a node's body through the real editable-div, the way a reader does,
// and wait for the sync into the hidden .node-textarea to land (contenteditable.js
// fires it on the input event). A synthetic `new Event('input')` does NOT drive
// this path -- only real keystrokes do -- so this types for real.
export async function typeBody(page, uuid, text) {
    const ed = await editableDiv(page, uuid);
    await ed.click();
    await page.keyboard.type(text);
    await waitForBody(page, uuid, text);
}
