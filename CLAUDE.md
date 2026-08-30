# CLAUDE.md

This file is the project context for every coding agent working in this repository
(Claude Code reads it by name; pi loads it as a context file the same way). Global
working agreements live in `~/.agents/AGENTS.core.md`; this file only holds what is
true of this repo, and it wins where the two disagree.

Do not add an `AGENTS.md` beside this file — pi loads the first match per directory
and `AGENTS.md` outranks `CLAUDE.md`, so a second file would silently replace this
one for one harness and not the other.

## Commands

```bash
npm install            # once in the primary checkout
npm start              # http://localhost:8999; linked worktrees reuse the primary dependencies
npm run start:host     # same, exposed on the LAN
npm run build          # vite build -> dist/ (+ postbuild copies js/, resources/, wiki/ and emits js/**/*.ts)
npm test               # node --test, auto-discovers test/
npm run typecheck      # tsc --noEmit over js/ (.ts files are checked, .js files only supply globals)
node --test test/vec2.test.js   # one file (a bare directory arg is read as a module path and fails)
```

The `prestart` lifecycle creates a worktree's missing `node_modules` as a link to the primary
checkout. Keep the primary checkout installed; a fresh linked worktree then uses the same `npm start`
command and Vite root, including `public/`. Port 8999 remains strict, so stop a running copy before
starting another checkout.

Optional backend (proxied AI calls, web scraping, Wolfram, wiki search, file tree):

```bash
cd localhost_servers
npm start              # express gateway on http://localhost:7070, mounts each server under /<name>
npm run start:neurite  # also launches the Playwright automation server (port 8081)
```

Each sub-server gets `npm install` run for it automatically on first start, except `automation/`
(install Playwright there manually). The frontend auto-detects the gateway by polling
`GET localhost:7070/check` (`Host.checkServer`) and flips the global `useProxy`.

`DIRECTACCESS_ROOT` is the one folder the file tree may read; it defaults to the home directory,
and every request path is taken as relative to it, so `/` in the file tree is that folder rather
than the disk's root (`localhost_servers/direct-access/file-access.js`).

There is no linter. There is a typechecker (`npm run typecheck`) and it only checks the `.ts` files.
The test suite carries no runner dependency — `node --test` and nothing else — but it is no longer
thin: 173 tests across 26 files under `test/`, and it is the regression net for anything that can be
read out of the source or sliced into a `node:vm`. What it cannot see is layout, paint and input, so a
real browser pass is still part of the work (or the automation server's `GET localhost:8081/screenshot`,
which returns a base64 PNG of a Playwright-driven instance). `git remote` points at the fork
`PXMYH/Neurite`.

A scratch port costs more than the port. `http://localhost:8999` is hardcoded twice on the backend
side — the CORS allowlist in `localhost_servers/start_servers.js` and `defaultNeuriteUrl` in
`localhost_servers/automation/automation.js`. Serve the app on 9123 and every proxied AI call fails as
a CORS error that names no port, while `GET /screenshot` photographs whatever is on 8999 instead of
your copy. Add your port to the allowlist for the length of the task, or pass the URL to the
automation server as its first argument (`node automation.js http://localhost:9123/`).

## Working in this repo

- **Develop in a worktree**, not in the primary checkout: `git worktree add
  .claude/worktrees/<name> -b <branch>`. `prestart` links the worktree's `node_modules`
  to the primary checkout's, and `node --test` resolves `typescript` by walking up, so a
  fresh worktree needs no install. `.claude/` is untracked and stays that way — never
  stage it.
- **The primary checkout usually holds port 8999**, and the port is strict. That server
  is the reader's, not yours: never kill it. Start your own on another port instead
  (`vite --port 9123 --strictPort`, run from the worktree so Vite's root is your copy).
  The gateway is 7070 and the automation server is 8081; the same rule applies to both.
- **Other worktrees and branches belong to other sessions.** Some are locked. Read them
  if it helps, change nothing.
- **Merging is by fast-forward, not by pull request.** Rebase the branch onto
  `origin/main`, prove the rebase was clean, re-run `npm test` and `npm run typecheck`
  *after* the rebase, confirm `git merge-base --is-ancestor origin/main main`, then
  `git merge --ff-only` and push. Report the revision range that moved. Nothing is
  committed or pushed unless Capitan X asks for it.
- **Verification that counts here, and in this order: the browser first, the test
  second.** The suite reads source as text or slices a file into a `node:vm`, so it can
  only ever agree with the shape of the code that was just written — it cannot see
  wiring. Two bugs walked past a green suite that way: a renderer handing out *copies* of
  the objects a delete had to find by identity, and a file picker nobody was calling with
  the name it accepted. One click in a browser found each of them. So: make the change,
  drive it in a browser, and only then write the test that locks the behaviour down.
  `npm test` and `npm run typecheck` after that, never instead of it. For UI work read
  Chrome's accessibility tree through CDP (`Accessibility.getFullAXTree`) when the change
  is about names, roles or descriptions; a screenshot cannot show those.
- **Measure a browser's capabilities; never recall them.** `DiskMirror.isSupported` is the
  worked example: Brave ships with the File System Access API off, so
  `showSaveFilePicker`, `showOpenFilePicker` and `showDirectoryPicker` are all `undefined`
  there and `Save to…` is a plain download — the same as Safari and every browser on iOS.
  A `typeof` in the browser under test costs one line and is the only thing that settles
  it.
- **Grep every caller before editing a function, not after the fix misbehaves.** Nothing
  under `js/` exports, so a function's callers are found by name across the tree and there
  is no import graph to lean on. `getSavedViewsFromCache` had two, and reading the second
  one is what would have shown the copy bug above before it was written.
- **Tests must not need the backend's dependencies.** Nothing installs `express` for
  `npm test`, so a server under `localhost_servers/` is testable only if its request
  handlers sit in a module that does not import express (see
  `direct-access/file-access.js`, driven by `test/directaccess-path-confinement.test.js`).
- **Clean up after a task**: remove the worktree and merged branch you created, the
  scratch servers you started, and the temp files you wrote. Leave everything you did
  not create, including other sessions' `/tmp` artifacts.
- Commit messages follow the existing log: a plain imperative subject, then a body that
  explains the trap the change avoids and how it was verified. `git log` is the style
  guide.

Nothing under `js/` exports anything, so a test cannot import it. There are two ways in, and
`test/` has one example of each:

- **Read the source as text** when the question is about the code's shape rather than its behaviour
  (`test/provider-ids.test.js` checks that every `case` label in the provider switch names a
  registered provider). Cheap, but it goes stale silently, so assert the parse found something
  before comparing.
- **Run the file in a `node:vm` context** when you want the real functions (`test/vec2.test.js`
  loads `js/mandelbrot/mandelbrot.js` against stubbed globals). Two traps: a script's first lines
  often touch the DOM, so the stubs have to exist before the file is parsed into existence; and a
  top-level `class` or `let` is a lexical binding that never lands on the sandbox global, so the
  names you want out have to be exported explicitly.
- **A `.ts` file needs one transpile hop first** — `ts.transpileModule(src, ...)` from `typescript`,
  then the same `node:vm` slice (`test/zetsplit.test.js`). `transpileModule` strips types and checks
  nothing; `npm run typecheck` is what checks.

## Architecture

### App code is not bundled — it is a manually ordered script loader

`index.html` loads exactly one script: `js/main.js`. Everything else is fetched at runtime by
`PageLoad` in `js/main.js`:

1. `PageLoad.resources` — HTML/SVG partials from `resources/`, injected into `<body>` **sequentially**
   (later scripts assume these elements already exist).
2. `PageLoad.tabs` — dropdown tab HTML, in parallel.
3. `PageLoad.scripts` — ~80 files loaded **sequentially via `<script src>`**, so everything shares one
   global scope and load order is a real dependency graph. Then `Graph = new Graph()`, `App = new App()`,
   `App.init()`.

Consequences that bite:

- **Adding a JS file means adding it to `PageLoad.scripts` at the right position.** A file not listed
  there simply never runs. Classes referenced at *load time* (e.g. `Elem.byId(...)` at class-body
  level, `class X extends Y`) must appear after their dependencies.
- Files are plain scripts, not modules. Use `import`/`export` only if you also append `:MODULE` to the
  entry in `PageLoad.scripts` (see `bundlecode.js:MODULE`, `imagenode.js:MODULE`, `savenet.js:MODULE`).
  Converting one leaf file at a time this way is welcome; a planned migration of all 81 is not — see
  [`docs/adr/0001`](docs/adr/0001-keep-the-hand-ordered-script-array.md).
- **A file under `js/` may be TypeScript, and the array entry does not change.** It keeps its `.js`
  spelling at the same position; Vite's dev server answers `js/x.js` with `x.ts` transpiled, and
  `postbuild` runs `tsc -p tsconfig.build.json` for the `dist/` copy. A `.ts` file that neither imports
  nor exports is a *script*, so it shares the one global scope like every other file and reads
  `Logger`, `Graph`, `tagValues` with nothing declared. `js/zettelkasten/zetsplitter.ts` is the worked
  example — see [`docs/adr/0002`](docs/adr/0002-typescript-in-the-load-path.md).
- Vite only ever sees `index.html`, which is why `postbuild` shells out to copy `js/`, `resources/`, and
  `wiki/` into `dist/`. Third-party libs (CodeMirror 5, Prism, marked, DOMPurify, localforage, pdf.js)
  come from CDN `<script>` tags in `index.html`, not from `package.json`.
- `public/embeddings.js` is a Web Worker (transformers.js from CDN) and is deliberately outside `js/`.

### Global singletons

`App` (owns the tabs, interface, simulation, panes), `Graph` (all nodes/edges + pan/zoom/rotation),
`settings` (persisted via `Settings`/`Stored`), `Logger`, `Ai`, `Fractal`, `Svg`, `Host`, `Providers`,
`Tag`. `Manager`, `View`, `Menu` are namespace objects that later files hang classes off of.

### The fractal is the coordinate system, not a backdrop

Node positions are complex-plane points (`vec2` in `js/mandelbrot/mandelbrot.js`). `Graph.pan`/`Graph.zoom`
are complex numbers; `Graph.xyToZ`/`vecToZ` convert screen to plane, `fromZtoUV` back. Every node's
`step(dt)` integrates velocity, then `applyMandelbrotForce()` pushes it along `Fractal.grad`, which is
why nodes drift toward set boundaries.

`NodeSimulation.nodeStep` (`js/nodes/nodeinteraction/nodestep.js`) is the single `requestAnimationFrame`
loop: autopilot → SVG viewbox → mouse orbit path → FPS → nodes → edges → fractal line regeneration
(`regenDebt`). `settings.framesDelay` throttles it by skipping frames.

### Zettelkasten ↔ mind map bi-directional sync

`ZettelkastenProcessor` (`js/zettelkasten/zettelkasten.js`) is the sync engine. Each notes pane owns a
CodeMirror instance plus its own `ZettelkastenParser`, `ZettelkastenUI`, and `ZettelkastenProcessor`.
All four are held together in **one** array of records, `window.zetPaneList`, whose entries are
`{paneId, cm, parser, ui, processor}` (`ZetPanes.createPane` in
`js/interface/dropdown/tabs/notestab.js`). `window.currentActiveZettelkastenMirror` is the CodeMirror
of the pane on screen, and it is the handle most code reaches for. There are no parallel arrays keyed by
index — reach a pane's parser or processor through its `zetPaneList` record.

The Notes **tab** is gone from the menu; the pane machinery is not. `#tab1` still exists and still
loads `notestab.html`, because `App.init` builds `ZetPanes` from `#zetPaneContainer` and `openTab`
refreshes `currentActiveZettelkastenMirror` on every tab switch — delete that div and boot throws.
Half-removing this in either direction is the trap `test/notes-tab-removed.test.js` pins.

- Text → graph: `processInput` (on CodeMirror `change`) walks lines, `Tag.node` (default `##`) opens a
  node section, `Tag.ref` (default `[[`) declares edges, `LLM_TAG` (`AI:`) makes an AI node.
- Graph → text: `onTitleInput` / `onNodeBodyInput` rewrite the CodeMirror range for that node's section.
- `wrapPerTitle` / `wrapPerLine` map titles and line numbers to `NodeWrap`s; a wrap not marked `live`
  during a pass gets its node deleted (`deleteInactiveNodesFromDict`).
- Writing into CodeMirror from code triggers a pass, so say which pass you want:
  `processor.writeAs(ZettelkastenProcessor.Pass.<mode>, () => cm.setValue(...))`. `Pass.edit` is a human
  typing, `rewrite` reparses every node's body, `restore` binds titles to nodes that already exist,
  `spawn` does that for one appended tag. `processAs(mode)` runs a pass over text already in the editor.
  The mode is scoped to that processor and to that write; nothing to set and clear by hand.
- `Tag.node`/`Tag.ref` are user-configurable, so never hardcode `##` or `[[`; use `Tag.*`,
  `ZettelkastenParser.regexpNodeTitle`, and `bracketsMap`/`getClosingBracket`.

### Nodes

`Node` (`js/nodes/nodeclass.js`) is the physics/DOM object; `NodeView` (`js/nodes/createnodes/window.js`)
is the draggable window chrome. Node *types* are **not subclasses** — each is a free function or static
factory that news up a bare `Node`, builds DOM, calls `NodeView.addAtNaturalScale`/`windowify`, and sets a
duck-typing flag that `Node.getType` reads: `TextNode.create` (`isTextNode`), `createLlmNode`
(`isLLM`), `new LinkNode(...)` (`isLink`), `NodeView.addForImage` (`isImageNode`), `createMediaNode`,
`createWolframNode`, `FileTreeNode.create`.

Persistence is DOM-based: `updateNodeData()` serializes the instance into `content.dataset.node_json`
and re-hydration replays `content.dataset.node_extras` through `Node.Extensions` (`window`, `textarea`,
`textareaId`, `checkboxId`, `sliderId`). New stateful widgets on a node need a `push_extra_cb` entry, or
they will silently not survive save/load. `toJSON` explicitly drops non-serializable fields.

A Saved Graph is *the markup itself*: `Elem.byId('nodes').innerHTML`, taken verbatim
(`savenet.js:735`). So every attribute a node's DOM carried at save time comes back with it, forever —
which makes the builder the wrong place to set anything the source should stay in charge of. A
placeholder written in `TextNode.create` restores under its old wording however the source reads
afterwards; the same line in `TextNode.init` agrees with a new node, because `init` is the one function
both paths run (`savenet.js:896`, `if (node.isTextNode) TextNode.init(node)`). Pinned by
`test/card-placeholder-on-restore.test.js`.

Saved Graphs live in IndexedDB via localforage (`Stored` in `globals.js`); `savenet.js` holds
`GraphsKeeper`/`GraphExporter`/`GraphImporter` and stores blobs (images, media) separately from graph JSON.
`DiskMirror` in the same file is the second copy: one real click on `showSaveFilePicker` and every
autosave lands in that file, so the feature is gated on `DiskMirror.isSupported` before its button is
drawn rather than failing at the click — Safari and every iOS browser have no picker, and there the
download fallback gives a copy taken now instead of a file that keeps itself current
(`test/savenet-disk-mirror.test.js`).

### AI layer

`Providers` (`js/ai/ai-utility/aihelpers.js`) maps a provider id to the DOM ids of its selects and key
inputs; `Ai.determineModel(node)` reads the current selection (global dropdown or per-node select).
`getAPIParams` in `js/ai/ai-utility/handleapikeys.js` then branches twice: once on `useProxy` (route through
`localhost:7070/aiproxy/<provider>`, keys held server-side) and once on the provider (direct calls with
keys from localStorage, or `neurite` which goes through `window.NeuriteBackend`).

`AiCall` (`js/ai/ai_v2.js`) is the request builder: `AiCall.stream(node)` / `AiCall.single(node)` →
`addSystemPrompt`/`addUserPrompt` → `exec()`. With a node it streams into that node's response textarea;
without one it streams into the active Zettelkasten CodeMirror, which is how "FractalGPT" writes notes
that then become nodes through the sync loop above. In-flight requests are tracked in `activeRequests`
by generated `requestId` for aborts. `useDummyResponses` + `js/ai/ai-utility/dummyai.js` fake a stream
for offline UI work.

Multi-agent looping lives in `js/nodes/nodetypes/ainodes/ainodemessage.js` (`@` references, `/` commands)
and reads context from connected nodes; embeddings/RAG in `js/interface/searchapi/embeddingsdb.js`.

### Neural API

`js/interface/neuralapi.js` builds `functionRegistry` and then assigns every base name **and every
alias** onto `window` (`initializeFunctionMappings`), so `neuriteAddNote`, `addNote`, `createNote`, … all
resolve. This is the surface the function-calling panel and the LLM call; adding a scriptable action
means registering it there. `Animation`/`Interpolation` in the same file drive `requestAnimationFrame`
sequences over pan/zoom.

### Desktop build

The Electron wrapper is **not on this branch** — `.github/workflows/electron-release.yml` checks out a
separate `electron` branch. `window.startedViaElectron` / `window.electronAPI` guards in `globals.js`,
`main.js` (`App.signalReady`) and the link nodes are the only traces here.

## Conventions

These are consistent across the codebase and easy to violate by habit:

- `Logger.info/debug/warn/err`, not `console.*` (`Logger.level` gates output).
- `On.click(elem, cb)` / `Off.click(...)` from `main.js`, not `addEventListener`. `On.wheel`,
  `On.touchstart`, `On.touchmove` are passive.
- `Elem.byId(id)`, `Html.new.div()`, `Html.make.div(className)`, `Svg.new.path()` instead of raw
  `document.*` calls.
- Callbacks are frequently static methods that take their subject via `this` bound to a primitive —
  `arr.filter(Object.isntThis, uuid)`, `nodes.forEach(Node.moveAtThisAngle, angle)`, and the
  `...ForThis`/`...This` naming that goes with it. Preserve that idiom when extending such helpers.
- HTTP through `Request.send(ctObject)` where the context object supplies `url`, `options`, and optional
  `onResponse`/`onSuccess`/`onFailure` (see `Host.checkServer.ct`, `Ai.ctCancelRequest`).
- All geometry through `vec2` (`cmult`, `cadd`, `mag2`, `rot`, `unscale`) — complex arithmetic, not
  plain x/y math.
- Private state uses `#field`; several classes expose data via `forEach(cb, ct)` rather than returning
  arrays.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on the fork `PXMYH/Neurite`, driven through the `gh` CLI; external PRs are
not part of the triage queue. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles use their default label strings (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`), all of which exist in the repo.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root is the domain glossary — read it before naming anything.
`docs/adr/` holds the decisions that are settled: `0001` on keeping the hand-ordered script array,
`0002` on TypeScript in the load path. Both are linked from the architecture section above.
See `docs/agents/domain.md`.

`docs/` holds more than the ADRs, and none of it needs re-deriving:

- [`docs/handoff.md`](docs/handoff.md) — where to start with no memory of the last session: what to
  read, how issues are picked, what landed recently.
- [`docs/README.md`](docs/README.md) — the component map as a Mermaid graph, a suggested reading order
  for the seven files that explain the rest, and the same traps this file lists.
- [`docs/architecture.html`](docs/architecture.html) — the interactive version: click a component for
  its files and neighbours, or pick a flow (boot, notes⇄nodes, AI request, save/load, search, render
  tick) to trace one path. Opens straight from disk.
- [`docs/icons.md`](docs/icons.md) — every icon is Lucide Static v1.33.0 geometry inlined into
  `resources/svg/icons.html`, and the existing ids are the interface: markup and scripts refer to the
  id, so replacing an icon means swapping the geometry under the id it already has. No runtime icon
  dependency, ever (`test/icon-sprite.test.js` pins this).
- Feature-level behaviour, if the change is user-visible: `controls.md`, `features.md`,
  `zettelkasten.md`, `fractalgpt.md`, `multi-agent.md`, `neural-api.md`, `desktop.md`.
