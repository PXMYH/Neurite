# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start              # vite dev server on http://localhost:8080
npm run start:host     # same, exposed on the LAN
npm run build          # vite build -> dist/ (+ postbuild copies js/, resources/, wiki/)
```

Optional backend (proxied AI calls, web scraping, Wolfram, wiki search, file tree):

```bash
cd localhost_servers
npm start              # express gateway on http://localhost:7070, mounts each server under /<name>
npm run start:neurite  # also launches the Playwright automation server (port 8081)
```

Each sub-server gets `npm install` run for it automatically on first start, except `automation/`
(install Playwright there manually). The frontend auto-detects the gateway by polling
`GET localhost:7070/check` (`Host.checkServer`) and flips the global `useProxy`.

There is no test suite, no linter, and no typechecker. Verification is manual in the browser
(or via the automation server's `GET localhost:8081/screenshot`, which returns a base64 PNG of a
Playwright-driven instance). `git remote` points at the fork `PXMYH/Neurite`.

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
CodeMirror instance plus its own `ZettelkastenParser`, `ZettelkastenUI`, and `ZettelkastenProcessor`,
registered into the parallel arrays `window.codeMirrorInstances`, `window.zettelkastenParsers`,
`window.zettelkastenUIs`, `window.zettelkastenProcessors` (`ZetPanes` in
`js/interface/dropdown/tabs/notestab.js`).

- Text → graph: `processInput` (on CodeMirror `change`) walks lines, `Tag.node` (default `##`) opens a
  node section, `Tag.ref` (default `[[`) declares edges, `LLM_TAG` (`AI:`) makes an AI node.
- Graph → text: `onTitleInput` / `onNodeBodyInput` rewrite the CodeMirror range for that node's section.
- `wrapPerTitle` / `wrapPerLine` map titles and line numbers to `NodeWrap`s; a wrap not marked `live`
  during a pass gets its node deleted (`deleteInactiveNodesFromDict`).
- Module-level flags in `js/globals.js` gate this loop: `processAll` (full reparse), `bypassZettelkasten`
  (skip the next change event), `restoreZettelkastenEvent` (rebinding to existing nodes on load).
  Writing to CodeMirror or a node textarea without setting the right flag causes feedback loops.
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

Saved graphs live in IndexedDB via localforage (`Stored` in `globals.js`); `savenet.js` holds
`GraphsKeeper`/`GraphExporter`/`GraphImporter` and stores blobs (images, media) separately from graph JSON.

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

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root — neither exists yet, so skills
proceed without them. See `docs/agents/domain.md`.
