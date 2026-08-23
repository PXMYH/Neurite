# Handoff — pick up development here

Written 2026-08-22. For an agent or a person arriving with no memory of the last session and asked to
take the next piece of work. Read this, then read the three binding documents it points at, then pick
an issue.

## Read these three first, in this order

1. **[`../CONTEXT.md`](../CONTEXT.md)** — the domain glossary, and it is binding vocabulary. The words
   are **Graph**, **Saved Graph**, **Plane**, **Fractal**, **Node**, **Node Type**, **Edge**,
   **AI Node**, **Link Node**, **Zettelkasten**, **Pane**, **Node Section**, **Title**, **Node Tag**,
   **Ref Tag**, **Ref**, **Provider**, **Model**, **Proxy**. Never write *canvas*, *shape*, *card*,
   *board* or *viewport* in an issue, a decision, a commit message or a code comment. Older comments in
   the source still use those words; do not copy them forward.
2. **[`../CLAUDE.md`](../CLAUDE.md)** — commands, architecture and the naming conventions. The two
   facts that catch every newcomer: the app is **not bundled** — `PageLoad.scripts` in `js/main.js` is
   a hand-ordered list of about 82 paths, and a file missing from it never runs, silently — and a Node
   is an **HTML window** while the Fractal and every Edge are **SVG**. Anything that must draw across
   both, or capture a pointer across both, crosses that split.
3. **[`adr/0001-keep-the-hand-ordered-script-array.md`](adr/0001-keep-the-hand-ordered-script-array.md)**
   — why that array stays. Do not propose replacing it with a module graph.

[`README.md`](README.md) in this folder and [`architecture.html`](architecture.html) beside it are the
component map. Open the HTML in a browser; it needs no server and no build.

## Run it and verify a change

```bash
npm install        # once in the primary checkout
npm start          # vite on http://localhost:8999 — strictPort, so a busy port fails loudly
npm test           # node --test
```

The `prestart` lifecycle links a fresh worktree to the primary checkout's dependencies, so this is the
same command from either checkout and Vite still serves `public/`.

`http://localhost:8999` is the only URL for local development. If something hands you a different
port, that is a defect, not a convention.

There is no linter and no typechecker. There are **46 tests in 9 files** under `test/`, and they are
the only automated check that exists.

```bash
node --test test/*.test.js      # the whole suite
node --test test/vec2.test.js   # one file
```

Use the glob, not the directory: `node --test test/` reads the argument as a module path and fails.

Nothing under `js/` exports anything, so a test cannot import it. Two routes in, both with a worked
example in `test/`:

- **Read the source as text** when the question is about the code's shape —
  `test/provider-routes.test.js`. Cheap, but it goes stale in silence, so assert that the parse found
  something before comparing.
- **Slice a class into a `node:vm` context** when you want the real functions —
  `test/zettelkasten-pass.test.js` slices `ZettelkastenProcessor` out and runs a whole pass against
  about fifteen stubs; `test/node-drag-threshold.test.js` does the same for a pointer gesture on
  `Node`. Two traps. A top-level `class` or `let` is a lexical binding and never lands on the sandbox
  global, so append `;globalThis.exported = TheClass;` to the slice. And an array built **inside** the
  vm carries that realm's `Array` prototype, so it is not `deepStrictEqual` to a plain one — spread it
  first.

**Earn a baseline before you trust a new test.** Revert the fix, run the new tests, and confirm they
fail. A test that passes against the broken tree measures nothing. Same for a grep-based check: a hit
count of zero cannot tell "found nothing" from "cannot look".

For anything visual, verify in a browser at `http://localhost:8999` and say in the commit what you
looked at. A screenshot route exists at `GET localhost:8081/screenshot` when the automation server is
running.

## How work is picked

Issues live in GitHub Issues on this fork, `PXMYH/Neurite`, driven through the `gh` CLI. External pull
requests are not part of the queue. Labels follow the five canonical triage roles; see
[`agents/issue-tracker.md`](agents/issue-tracker.md) and [`agents/triage-labels.md`](agents/triage-labels.md).

```bash
gh issue list --repo PXMYH/Neurite --state open
gh issue view 52 --repo PXMYH/Neurite
```

Two kinds of issue are open, and they are not interchangeable.

**Ordinary work — take one of these.** Labelled `ready-for-agent`, `enhancement`, `bug`,
`documentation`, `ux`, `testing` or `architecture`. Each one is a change to make.

- [#52 — Every icon comes from Lucide, and the collapse button stops being a bare circle](https://github.com/PXMYH/Neurite/issues/52).
  The recon is already in the body: all 47 sprite ids, where each is consumed, the proposed Lucide name
  for each, which ids are dead, and two defects found while measuring. Do not repeat that survey.
- [#48 — Move `js/` to TypeScript](https://github.com/PXMYH/Neurite/issues/48). Large, and a
  prerequisite for porting Excalidraw's TypeScript source directly. Not started.
- [#32 is reserved.](https://github.com/PXMYH/Neurite/issues/32) The settings panel. Labelled
  `ready-for-human`. Leave it alone until it is discussed.

**Decision tickets — do not implement these.** Labelled `wayfinder:grilling`, `wayfinder:prototype`,
`wayfinder:research` or `wayfinder:task`, and each is a child of a map labelled `wayfinder:map`. A
ticket resolves to a *decision* recorded as a comment plus one line on its map, not to code. They are
worked one per session, with a person in the loop for the `grilling` and `prototype` ones. The two maps:

- [Map: Excalidraw's interaction craft, ported to the Graph](https://github.com/PXMYH/Neurite/issues/40)
  — scope was fixed as **the craft layer only, and keep Neurite's clean look**. Drawing tools, the
  hand-drawn look, undo, image export and touch are all explicitly out of scope, each with a reason on
  the map. Open children: #45, #46, #49, #50, #51.
- [Map: Neurite on iPad (read + light capture)](https://github.com/PXMYH/Neurite/issues/1) — open
  children: #7, #8, #9, #10, #11.

If you are unsure which kind you are holding, read the labels. Implementing a `wayfinder:grilling`
ticket destroys the decision it was created to make.

## What landed recently, and why it matters to you

Newest first. Read the commit message before touching the same area — each one records the measurement
that justified it.

| Commit | What changed |
| --- | --- |
| `f7488e5` | A Ref naming a Node written **lower** in the Pane now builds its Edge. `processInput` walks lines top-down, so a forward Ref used to resolve to nothing and was dropped in silence; a Node with several Refs kept only the ones pointing back up the text. Unresolved sections are queued and retried after the walk. |
| `dd1efb2` | The Shift + click + click connect gesture works. It existed the whole time and failed on the first pixel of click drift; one shared `Node.dragThreshold` of 10 px now separates a click from a drag. |
| `919a69f` | Autosave is the only save, mirrored to a file on disk. |
| `69d9150` | The chrome is two floating islands — the tool pill at top centre, the menu bottom left — not a full-width strip. |
| `0467e74` | The dev server moved to 8999 and every hardcoded copy of the old port moved with it. |

Three Node-facing facts that came out of that work and are easy to rediscover the hard way:

- A Node body is a plain `<textarea>`, so it cannot render bold, coloured or clickable text. Ref
  highlighting is a CodeMirror overlay on the **Pane**, not on the Node.
- `connectDistance(a, b)` pushes the new Edge onto **both** endpoints, and `Graph.deleteEdge` removes
  it from both. Do not push it again at the call site.
- A Pane's parser, UI and processor are reached through its record in `window.zetPaneList`
  (`{paneId, cm, parser, ui, processor}`). There are no parallel arrays keyed by index.

## Working rules for this repository

- **Isolate before editing.** Work in a git worktree under `.claude/worktrees/`. Keep dependencies
  installed in the primary checkout; `npm start` links a fresh worktree to them automatically.
- **Push straight to `main`. No pull request is wanted on this fork.** From a worktree:
  `git push origin <branch>:main`. Never force-push, never rewrite history, never touch a branch that
  is checked out somewhere else.
- **When the change is pushed, refresh the local stack** so it can be tried: bring the mainline
  checkout up to date with `git merge --ff-only origin/main` and start the server there on 8999.
- **Back up a database file before any change to it**, to a timestamped copy beside it.
- One concern per commit, and write the measurement into the message. The existing history is the
  style guide.
- Keep a change to a handful of files. If it grows past that, the scope was wrong.

## Conventions that are easy to violate by habit

- `Logger.info/debug/warn/err`, never `console.*`.
- `On.click(elem, cb)` / `Off.click(...)`, never `addEventListener`.
- `Elem.byId`, `Html.new.div()`, `Svg.new.path()`, never raw `document.*`.
- All geometry through `vec2` — complex arithmetic, not x/y pairs.
- Never hardcode `##` or `[[`; they are `Tag.node` and `Tag.ref` and a person can change them. Use
  `ZettelkastenParser.regexpNodeTitle`, `bracketsMap` and `getClosingBracket`.
- Writing into a Pane from code triggers a pass, so name the pass:
  `processor.writeAs(ZettelkastenProcessor.Pass.rewrite, () => cm.setValue(...))`. The four modes are
  `edit` (a person typing), `rewrite` (code replaced the text), `restore` (a Saved Graph reloading) and
  `spawn` (one appended tag).
- A new stateful widget on a Node needs a `push_extra_cb` entry, or it silently fails to survive a
  reload.
- Private state uses `#field`; several classes expose data through `forEach(cb, ct)` rather than
  returning an array.

## Where to start if nothing is assigned

Take [#52](https://github.com/PXMYH/Neurite/issues/52). It is bounded to one file plus two markup
fixes, the survey is already in the issue body, and its acceptance criteria are written down.
