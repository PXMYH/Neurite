// Shared plumbing for the browser eval specs. Uses the bare `playwright` library
// (not @playwright/test) on purpose -- the repo keeps a single test runner,
// `node --test` (see CLAUDE.md), and the automation server already depends on
// `playwright`, so nothing new is added here.
import { chromium } from 'playwright';

const URL = process.env.NEURITE_E2E_URL || 'http://127.0.0.1:9123/';

export function launchBrowser() {
    // Headless is the point: this runs unattended as an eval, not for watching.
    return chromium.launch({ headless: true });
}

// A fresh, storage-isolated page sitting at the ready signal. Isolation is not
// optional: Neurite autosaves the graph and restores it on the next load, so a
// shared context would leak one test's nodes into the next. A new browser
// context per test gets its own IndexedDB / localStorage, so every test starts
// from the same blank graph.
export async function openNeurite(browser) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    // `window.appReady` (globals.js) flips true on the last line of App.init.
    // Graph / App / NodeView are lexical globals, NOT window properties -- reach
    // them by bare name inside evaluate(), never as `window.Graph`.
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    return { context, page };
}

// Create a text note through the public neural API (window.createNote) and return
// its uuid. The uuid is found by diffing Graph.nodes rather than trusting the
// call's return value, so it holds whatever shape createNote resolves to and
// makes no assumption about the graph being empty first. Note: createNote routes
// the body through the shared Zettelkasten pane, so the per-node body textarea is
// empty until the reader types into it -- pass '' and drive the body via typeBody.
export async function addNote(page, title, body) {
    return await page.evaluate(async ([t, b]) => {
        const before = new Set(Object.keys(Graph.nodes));
        await window.createNote(t, b);
        return Object.keys(Graph.nodes).find(k => !before.has(k)) ?? null;
    }, [title, body]);
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
// fires it on the input event).
export async function typeBody(page, uuid, text) {
    const ed = await editableDiv(page, uuid);
    await ed.click();
    await page.keyboard.type(text);
    await page.waitForFunction(
        ([id, t]) => Graph.nodes[id]?.textarea?.value === t,
        [uuid, text],
        { timeout: 5000 }
    );
}
