# Clearing every open issue

Asked on 2026-09-26 by Capitan X: clear out all GitHub issues. Plan, research, have adversarial
agents check the plan, then implement, committing and pushing by phase, and cut a release — at
least an Apple Silicon `.dmg` — whenever a feature lands. Judged on correctness, usability,
aesthetics and completeness. Capitan X is away for the run, so the decisions a ticket reserves
for "Capitan X" are made here, each with its reason written on the ticket, and each reversible.

Research (four agents, 2026-09-27: r1 bugs/settings, r2 pointer craft, r3 Archives/AI bundle,
r4 iPad/TypeScript) and two plan reviews (A: completeness against every issue; B: product and
aesthetics) shaped this plan. Their long form lives outside the tree, in the job's scratch
directory; everything a later reader needs is summarised here or on the tickets.

## What "cleared" means

| Kind | Issues | Cleared when |
| --- | --- | --- |
| Defect / task | #65 #66 #67 #68 #75 #48 | fixed, pinned by a test shown to fail on the old code, driven in a browser, closed with the evidence and the commit |
| Feature | #32 #64 | built, driven in a browser, tested, released, closed |
| Decision ticket | 22 `wayfinder:*` | the decision is written on the ticket with its evidence; where it implies code, the code has landed too. A ticket that asks for "something to react to" gets screenshots, not a paragraph |
| Map | #1 #40 #54 #69 | every child closed, every "Not yet specified" line decided or moved to "Out of scope" with a reason, "Decisions so far" filled |

Several maps say "Planning only. Produce decisions, not code." That instruction predates this goal,
which asks for the issues to be finished; where a decision implies code, this plan builds it, and
each closing comment says so.

Honest limit, stated once: no iPad, and no iPad Simulator (Xcode is not installed). Touch work is
verified in Playwright WebKit with an iPad context and labelled "WebKit engine, not iPad". The
checks only a device can answer are listed in `docs/ipad-spike.md` as a device checklist.

## Rules for every phase

- Real thing first, test second: drive the change in a browser before writing the test that pins it.
- A test that pins a fix is shown to fail on the old code.
- Green before every commit: `npm test`, `npm run typecheck`, `npm run test:e2e`.
- One adversarial review agent per phase, on the diff and on the running app; its findings are
  fixed or answered before the push.
- Commit per phase to `main` (fast-forward), push, close the phase's issues with links.
- A release (`vX.Y.0`) at the end of every phase that adds something a reader can see: the arm64
  `.dmg` from `cd desktop && npm run dmg`, smoke-tested inside the mounted image, attached with its
  SHA-256.
- Vocabulary on tickets follows `CONTEXT.md`.

## Phase 0 — the macOS app, and the freeze it found → v1.0.0 (shipped)

`5449127`, `f34c62b`, `2ff1c86`; release v1.0.0. See `tasks/todo.md`.

## Phase 1 — defects → v1.1.0

- **#68** Fixed by `ddc9d5b`, never closed. Close with the fresh measurement (all three bars
  `left: 0`, 20px; open state a symmetric ±45° X).
- **#65** Decided by `678f01e` (the editor has a menu row). Settle the rest: the `?` tab still says
  there is no editor; `js/ai/prompts.js` tells the model the Notes panel has no menu row and that a
  Saves panel exists; the Notes row sits second though its comment, commit and test say first; the
  horizontal drag handle sits on the edge that cannot move, drags backwards, leaks a `mouseup`
  listener per drag and never refreshes CodeMirror; stale comments in six files and CLAUDE.md.
  Keep the `body.ai-disabled #prompt-form` rule — every AI Node's regenerate button reuses that id.
- **#66** `CustomDropdown.carryAccessibility` names each replacer from a deliberate `aria-label`,
  else `select.labels[0]`; hand-written names for the seven selects whose label is a button or
  absent; the per-AI-Node twins named after their global twin; the listboxes named too. Markup
  test that fails on today's tree; AX tree read through CDP.
- **#67** `MainMenu.noFocusToLose()` read by both Escape paths (before `menuButton.click()` in the
  close path — the issue's snippet pasted literally breaks the list-view refocus), and Escape that
  CodeMirror already handled (`defaultPrevented`) leaves the menu alone, so Escape in the Notes
  editor no longer takes the caret out of it. Re-point the two tests that pin the old shape; add
  the panel-view Escape e2e the suite lacks.
- **#75** `cosineSimilarity` divides by the magnitudes (web, vector-DB and Wikipedia ranking use
  it; Node search already divided and moves onto the helper); embed text Nodes only; never cache a
  failed `[]`; key the cache on the text; the Worker's chain survives one failed extraction and a
  failed init is retried.
- **#10's must-fix list** (decided here, built here): the three missing-backend paths that throw —
  `Keys.getRelevant` on a non-array, the Wikipedia `[undefined]`, the bare Wolfram `fetch`.
- Release v1.1.0.

The group-move defect found in research (every group operation skips pinned Nodes, and every Node
is pinned on arrival since `3152396`, so a selection moves nothing) moves to Phase 2 on review B's
blocker: making a selection move before a reader can see it, clear it, or be asked before deleting
it would widen what an accident costs, in an app with no undo.

## Phase 2 — pointer craft: #49, #51, #50, #46, #45, then map #40 → v1.2.0

- **Gate first (review B):** on macOS, Ctrl+click is the secondary click — measured, each Ctrl+click
  on a card fired `contextmenu` and selected nothing. One real Ctrl+click and Ctrl+drag in the arm64
  app and in Brave decide the modifier: Cmd on macOS, Ctrl elsewhere, the native menu prevented when
  the gesture selects. The same rule serves the Pane's "modifier-click flies the view".
- **Selection, made safe before it is made powerful:** a click on empty Plane and Escape clear the
  selection; the HUD says "N selected"; deleting a whole selection from the Node menu asks first;
  then the group operations move pinned Nodes (group drag, arrows, `f`/`d`, Shift+wheel), and
  `f`/`d`/arrows stop firing while typing.

- **#49** Measured: a text ↔ Plane-AI Edge survives a reload (`data-edges` + `node.init()`), so the
  decision is "the Saved Graph is the durable form of every Edge; a Ref is the Pane's form, and
  exists only where both ends have a Node Section". Fix what was found: an AI Node born in the Pane
  is rebuilt twice on every reload (`handleLLM` has no restore branch — 2 Nodes became 3 after one
  reload, and each reload adds one); one missing endpoint throws and half-restores its neighbours;
  `connectNodes` passes half the distance into the strength slot. `CONTEXT.md` Ref/Edge/Fractal
  wording updated. First reload tests in the suite (`10-edges.e2e.mjs`), counting Nodes per type.
- **#51** No new gesture: the chip × (visible, labelled, keyboard and touch), right-click → delete,
  Shift+double-click. One removal rule for every Node Type — remove every Ref that writes the Edge,
  then the Edge (today a text ↔ Pane-born AI removal comes back at the next autosave). Direction:
  measure first which end the arrowhead marks versus which section holds the Ref, decide one
  meaning ("the arrow points at the Node the Ref names"), make the parser, `toggleDirection` and the
  AI context agree with it, and pin it with an e2e comparing the tip to the Ref. Guard the bare
  click (a pan that starts on an Edge toggles its direction). Then a 30px invisible hit halo
  (15px either side, constant) with an accent hover state and `cursor: pointer`, and the chip ×
  gets a 24px hit area (44px under `pointer: coarse`) around its 8×13px glyph. Frame time measured
  with the halo paths on a 100-Edge Graph.
- **#50** The discoverable route is the "+ link" control every Node shows; its tooltip teaches the
  Shift shortcut. It opens the connect modal with an empty, focused query listing the nearest Nodes
  (today it opens with the Node's own Title as the query, so the list is blank), and it keeps its
  word after the first link (today it shrinks to "+"). The Shift "tell" lights the File-tree tool
  today; it moves to a visible **Link** tool in the pill (shared with #58), which Shift lights and a
  tap toggles. Escape cancels an armed link. NodeMode ignores Shift while typing, so capital
  letters do not flash it. The Node and Edge right-click menus read as sentences, not method names.
- **#46** Build the throwaway, screenshot it on the ticket: one and four Nodes selected at ×1, ×0.25
  and ×4; a marquee mid-drag; a group box with handles, drawn to be rejected or kept on sight.
  Expected outcome: per-Node ring and tint, counter-scaled so it survives zooming out (0.5px at
  ×0.25 today; at ×0.1 ring and card shrink together to 33×13px), accent marquee without blur, no
  group box.
- **#45** Review B's objection holds: pinned Nodes now stay where they are put, so alignment would
  last, which argues for snapping rather than against it. Prototype the one coherent version —
  centre snap in the view frame (`u = (z − pan) / zoom`, screen-aligned under rotation, independent
  of scale), about 6px, to the Nodes on screen, while dragging, Alt to place freely — and decide on
  sight, with screenshots on the ticket. Edge-to-edge snapping, a Plane grid and snapping to the
  Fractal are ruled out with reasons either way (no stable frame for edges: the footprint depends on
  the window; a grid is incoherent across 13 decades of zoom; the Fractal offers no target a reader
  can predict). Pin "a dragged Node stays where it was dropped".
- **#40** Close with a craft-list table: every behaviour from #41's list decided (selection,
  marquee, group move/scale, Edge binding/removal, snapping — out, group/ungroup — out, z-order —
  out, zoom-to-selection — Fit covers it or add, save status — the Save row, duplicate — out, paste
  — exists, undo — out by Capitan X). A key ships only with a visible control that prints it; the
  stale Help rows are fixed and pinned in `test/help-tab.test.js`; `Alt+S` (a screenshot that
  silently omits every Node) is removed from the key map, recorded as the defect it is.
- Each Phase 2 e2e also runs once in WebKit with an iPad context, so the pointer decisions meet
  touch before Phase 5 builds on them.
- Release v1.2.0.

## Phase 3 — Archives #64, settings panel #32 → v1.3.0

- **#64** Option 1: one Title namespace, unique across Panes, case-insensitive. The engine first
  (an edit in one Pane can write its body into another Pane's Node with the same Title), then the
  controls in the Notes panel, all text-labelled: an Archive select with Node counts, **New
  Archive**, **Rename Archive…**, **Delete Archive…** (states the Node count; the last Archive
  explains why it cannot go). A taken Title: no second Node, the line marked in the Pane, and one
  status line naming the Archive that holds it. The active Archive shown outside the menu whenever
  there are two or more (where the Note tool writes must be visible). Lowest free "Archive n".
  Reorder, duplicate and per-Archive export recorded as out of scope. `10-archives.e2e.mjs`.
  **Graphs that already hold a duplicate Title (review B):** on load the later Pane's line becomes
  `Title (2)` in the text, both Nodes kept, and one notice lists every Title that was renamed and in
  which Archive — never a silent rename that the next autosave makes permanent. The rule is tested
  on real Saved Graphs from before the change.
- **#32** Option 2: one panel width for every panel and the list view (measured today at 312, 339,
  343, 502 and 971px — the width jumps as panels change), wide enough for two-column grids; only
  the Notes handle changes it. Flatten the five panel accordions into the headed-group pattern the
  Settings tab already uses; keep API Keys as one native `<details>`. The accordions are mouse-only
  today, so this is also the keyboard fix — together with making every checkbox visually hidden but
  focusable (today `display: none`, no keyboard reaches one) and making collapsed content `inert`
  (a Tab walk falls into the collapsed function console today). The two fixes the issue says come
  along: remaining accordions release their height after opening, and the section rules get real
  contrast. Saved Views wrap instead of widening the panel (21 views made it 1,584px). Checked at
  1600×1000 and 1280×800, and at 820×1180 in Phase 5.
- Release v1.3.0.

## Phase 4 — connecting the AI bundle: #71, #73, #72, then map #69 → v1.4.0

Corpus measured: 95 concept Notes (not 140), 240 Refs inside them making 72 Edges, 33 isolated,
13 top-level areas.

- Prerequisites: #75 (Phase 1), #64's engine (Phase 3), the per-pass overlay dedupe (a full pass
  schedules one overlay rebuild per plain line, ~11k per pass at corpus scale, every 8 s), and the
  Pane highlighter rebuilt as one word-bounded regex per change (it builds ~0.31M regexes per
  keystroke in the largest area Pane; plain click places the caret, Cmd/Ctrl-click flies the view
  — at corpus scale a plain click would fly on 2,434 words). Measured on a 3.3k-line Pane.
  Also found in Phase 2's review: an edit pass runs `handleRefTags` once per Ref line of the
  note, each time over the whole note's Refs — 40 identical calls for one keystroke in a note
  with 40 Ref lines. Phase 2 made each call cheap (one ask per linked note, one split of the
  Pane: 7.6 ms at 40 links, where the base was 16.2); calling it once per note is this work.
- **#71** One text Node per Note, one Archive per top-level folder, Title = basename (or
  `parent/basename` on a collision, the bundle's own rule). The card face starts at the content:
  the frontmatter's `description` as one line, the rest of the frontmatter and a leading H1 that
  repeats the Title hidden (kept in the text). Body lines that would parse as a Node Tag are escaped
  by one leading space (Neurite's copy only; nothing is written back to the vault), and the Pane's
  syntax mode colours a Node Tag only at column 0, as the parser reads it, so the 698 escaped lines
  do not look like Node starts. Existing Refs become Edges at once — a rewrite pass over every Pane
  after the last one is restored, so cross-area Refs do not wait for the autosave. The import opens
  in a new Graph by default, after offering Save to… for the current one; a second import refuses
  and lists the Titles. New `js/zettelkasten/zetimport.ts`.
- **#73** Each area is a region of the Plane, its Nodes pinned; depth means nothing. Prototype two
  layouts and decide on the screenshots, both on the ticket: a grid of blocks, and one block per
  primary bulb of the Mandelbrot set (17 bulbs of period ≤ 7) — the grid puts almost every area on
  empty black Plane, while the owner's recorded instinct is that knowledge "sits in different parts
  of the Fractal". Either way: the area's name is drawn on the Plane; an area is one thing — picking
  an Archive frames its region, a Note made inside a region goes into that region's Archive, and the
  active Archive shows in the HUD — with no extra Saved Views (13 would widen the Views panel past
  use; `#startNewGraph` leaking Saved Views into the next Graph is fixed on the way); a new Note takes
  its scale from its Archive. The import places its Nodes after the arrival settle — the settle's
  gather and separation otherwise move a laid-out block by up to 6 Plane units.
- **#72** Prototype first, as the ticket asks, then build: on-demand proposals as a ranked list —
  a "Suggested" group in the connect modal and a Graph-wide "Suggest Edges" list, isolated Notes
  first; top 3 per Node, a cap on how often one hub may be proposed, no similarity threshold; each
  with a checkable reason (an unlinked mention, shared tags), and rows with only "similar wording"
  in a group that starts collapsed. Selecting a row frames both Nodes and draws a dashed line
  between them on the Plane. Accepting writes exactly one Ref; dismissals are saved with the Graph;
  a progress line while vectors compute; vectors persisted and keyed by text; the accent colour,
  not the modal's green outline. Precision@3 measured on 10 isolated Notes before release.
- **#69** Close its fog lines, with a real-corpus run recorded on the ticket against limits set
  beforehand: frame time with the 95 Notes and 72 Edges, the long task at each autosave, time to the
  first suggestion cold and warm.
- Release v1.4.0.

## Phase 5 — iPad: #55, #57, #58, #56, #9, #59, #11, #60, #61, #62, #6, then #7 #8 #1 #54 → v1.5.0

- **Paperwork first.** #54 reversed #1's scope (the iPad authors), so #1 folds into #54; #7 and #8
  close as superseded, each with a comment mapping its questions to the tickets that answer them.
- **#55** Fact sheet on the ticket (both pinch paths executed: the touch path zooms the wrong way
  and flings the pivot; the gesture path pivots on `pageX`, which WebKit leaves 0). Decision: one
  pinch, absolute from a baseline (`Z' = Z0 · d0/d1` in `vec2`), fed by Pointer Events; the touch
  case and the dead gesture code deleted; `preventDefault` on `gesturestart/change` kept only as the
  page-zoom guard; `regenAmount` from the per-event scale change. `test/pinch-math.test.js`.
- **#57** Pointer Events replace — not join — the mouse bindings for Node drag and resize
  (`touch-action: none` on the header and the resize handle only; a hit area of at least 28px
  around the 15px glyph); tooltips skip showing when `(hover: none)`; Titles get
  `autocorrect="off" autocapitalize="off"`. Selection by touch stays out of v1.
- **#58** The Link tool in the pill (from #50) is the touch route: tap it, tap Node A, tap Node B.
- **#56** The Pane is the primary surface for making Nodes and Edges; touch navigates, reads and
  moves. The Pane clamps to `visualViewport` height so the keyboard does not cover the caret;
  CodeMirror's `inputStyle` stays default unless a device check says otherwise.
- **#9** A static `dist/` on HTTPS at one permanent origin, installed to the Home Screen: GitHub
  Pages for this fork. The root-absolute paths that break under a subpath become relative (the
  embeddings Worker, `fetch('/resources/…')`, `/wiki/pages/…`); a service worker caches the app
  shell and the CDN libraries so the app opens offline; a Pages workflow deploys `main`. The origin
  is part of every Graph's identity, which the ticket says in so many words.
- **#59** Durability is the file; IndexedDB is the cache. Installed (`!matchMedia('(display-mode:
  browser)')` — `standalone` reads false on iOS), Save to… goes through the share sheet with the
  file attached (a download strands an installed app — WebKit bugs 236943, 290847); in a Safari tab
  it stays a download. The Save row shows whether storage is persistent, and a failed restore (which
  now turns autosave off) is shown there instead of only logged.
- **#11** The `.neurite` file is the unit of transfer (it already carries images and media), moved
  through iCloud Drive; no sync service. The Save row shows when the graph was last saved to a file.
- **#60** One writer at a time. The desktop's 8-second file mirror checks the file's
  `lastModified` before each write and stops, with a message, if another device changed it — that
  is the one real silent overwrite. The bundle header gains `revisions`, `lastUpdated` and a device
  tag, so an import can say it is older than what is open.
- **#61** Keep the bundle; add `v: 1` and the meta block (an old file with no `v` is version 0);
  "complete" is what `GraphExporter` writes, pinned by a round trip with one Node of every type;
  the Zettelkasten text is not the canonical form (no positions, sizes, media, or non-text Edges).
- **#62** Screenshots of the built chrome at 820×1180 in WebKit, before and after this phase.
- **#6** Run the protocol's WebKit-engine half (capabilities, layout both orientations, synthetic
  touch and pinch math, tap targets, Save/Open round trip) and post it as "WebKit engine, not iPad";
  the device-only checks go into `docs/ipad-spike.md` as a checklist. Close with that split stated.
- Release v1.5.0.

## Phase 6 — TypeScript: #48 and draft PR #63

#48 was reopened on purpose after its decision closed it, and PR #63 carries phases 0–1 (types
and gates, no runtime change). Fix before merging: the `PassiveEvBinder` declaration still says the
passive helpers drop their options, which stopped being true in `d29dc99` and would one day invite
the scroll-wheel bug back; refresh the PR's counts and line numbers; make `verify-served` refuse
the reader's 8999 server; trim the PR's Phase 4 to rules for an opportunistic conversion, since a
planned sweep contradicts ADR-0001/0002 — a full sweep would need ADR-0003 first. Rebase, run the
gates and the suite, fast-forward to main. Close #48 as decided and built.

## Decisions this plan takes in Capitan X's absence

Each is recorded on its ticket with the reason, and each can be reversed.

- #32: option 2, with the width chosen by measurement.
- #45: decided on a prototype of centre snap; edge, grid and Fractal snapping ruled out.
- #46: selection modifier Cmd on macOS if Ctrl+click opens the secondary-click menu there.
- #64: existing duplicate Titles renamed `Title (2)` on load, with a notice listing them.
- #73: grid or Fractal-bulb layout, decided on screenshots.
- #49: `CONTEXT.md`'s Ref, Edge and Fractal definitions updated to match what the code does.
- #51: one direction meaning for the arrowhead, chosen by measurement.
- #71: the one-space escape of body headings, in Neurite's copy only.
- Pane Title marks: plain click places the caret, Cmd/Ctrl-click flies the view.
- #1 folded into #54; #7 and #8 superseded.
- #9: GitHub Pages as the permanent origin.
- #48: phases 2–4 of the migration stay opportunistic unless an ADR-0003 says otherwise.
