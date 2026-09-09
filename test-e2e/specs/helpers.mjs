// Shared plumbing for the browser eval specs. Uses the bare `playwright` library
// (not @playwright/test) on purpose -- the repo keeps a single test runner,
// `node --test` (see CLAUDE.md), and the automation server already depends on
// `playwright`, so nothing new is added here.
import { chromium } from 'playwright';

const BASE_URL = process.env.NEURITE_E2E_URL || 'http://127.0.0.1:9123/';

export function launchBrowser() {
    // Headless is the point: this runs unattended as an eval, not for watching.
    return chromium.launch({ headless: true });
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
export async function openNeurite(browser) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    // `window.appReady` (globals.js) flips true on the last line of App.init.
    // Graph / App / NodeView are lexical globals, NOT window properties -- reach
    // them by bare name inside evaluate(), never as `window.Graph`.
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
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
export async function deleteViaMenu(page, uuid) {
    await page.evaluate((id) => { NodeActions.forNode(Graph.nodes[id]).delete(); }, uuid);
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
