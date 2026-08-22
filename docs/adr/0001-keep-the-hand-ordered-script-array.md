# 0001 — Keep the hand-ordered script array; migrate to modules file by file

- **Status:** accepted
- **Date:** 2026-08-21
- **Context issue:** [#18](https://github.com/PXMYH/Neurite/issues/18) (declined)

## Context

`index.html` loads one script, `js/main.js`. `PageLoad.scripts` then lists 81 more
paths and `mainLoad` fetches them one at a time into a single shared global scope,
so array position is the dependency graph. A file missing from the array never
runs, silently.

An architecture review proposed replacing the array: give every file `import` /
`export` and let the module graph state the dependencies. `loadScript` already
supports this per file — a `:MODULE` suffix on the path sets `script.type =
'module'` — and three files use it (`bundlecode.js`, `imagenode.js`,
`savenet.js`).

The proposal was declined. This records why, so a future architecture review does
not re-suggest it as though it were unexamined.

## Decision

Keep the array. Convert a file to `:MODULE` opportunistically, when it is being
edited for another reason and its dependencies are already clear. Do not plan a
migration.

## Reasons

**The strongest argument for it turned out to be false here.** The proposal's
central claim was that untestability is not a separate problem from load order but
the same one: nothing exports, so nothing imports, so no test can load a file
without also standing up a DOM. That is no longer true. The suite is six files and
27 tests, and **none of them imports from `js/`** — they read source as text and,
where they need behaviour rather than structure, slice the one class out and
evaluate it in a `node:vm` sandbox with hand-written stubs. The untestability issue
closed without touching load order.

**The proposal does not pass its own deletion test unaided.** It states that
deleting the array concentrates complexity *only if* each file declares its own
dependencies. That precondition is the entire job, across 81 files; without it the
ordering problem just moves into a bundler config. So this is not a refactor gated
on a decision, it is a migration gated on a prerequisite larger than itself.

**There is no oracle for a wrong order.** 26 of the 81 files run a bare top-level
call at load time; whether any of the other 55 depends on its position can only be
found by moving it and watching the app in a browser. No test would catch a bad
order. That is the same untestability, now acting as a blocker to the fix rather
than as a reason for it — and a migration whose only check is "the app still looks
right" is the shape that ships a subtle boot-order bug.

**It spends a property that is deliberate, not accidental.** There is no build step
for app code at all; `postbuild` copies `js/` into `dist/` verbatim, and the dev
loop is edit-then-refresh. A module migration either keeps that and pays 81
sequential network requests, or replaces it with a bundler and a watch process.

**The incremental path is strictly better and needs no plan.** `:MODULE` works
today. A leaf file converted while it is already open costs nothing extra and
shrinks the array by one. Ten of those and the remaining migration is small enough
to judge properly. A big-bang migration cannot be reviewed in pieces; this can.

## Consequences

- Adding a file still means adding it to `PageLoad.scripts` at a position after
  everything it touches at load time. `CLAUDE.md` and `docs/README.md` both warn
  about this; keep those warnings current.
- Tests reach source by reading it, not importing it. This has a ceiling: it works
  for structure (does every written node type appear in the table?) and for one
  class in isolation, but not for a test that needs `Graph`, `Node` and `Fractal`
  wired together.
- **Revisit when** that ceiling is hit — when a test genuinely needs a real object
  graph — or when opportunistic conversion has already reduced the array enough
  that finishing it is a small, reviewable change.
