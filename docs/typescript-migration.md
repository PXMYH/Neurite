# Migrating `js/` to TypeScript

Issue [#48](https://github.com/PXMYH/Neurite/issues/48). A previous attempt converted one
file and stopped. This document is the plan for the rest, and every number in it was
measured in this tree rather than estimated.

Read [ADR-0001](adr/0001-keep-the-hand-ordered-script-array.md) and
[ADR-0002](adr/0002-typescript-in-the-load-path.md) first. They set the two constraints
that make this migration unlike the usual one.

---

## 1. The number that matters, and why you cannot see it

```
$ npm run typecheck
$            # 0 errors
```

That is not progress. `tsconfig.json` sets `checkJs: false`, so `tsc` parses every `.js`
file and checks none of them. The real workload only appears when checking is forced on:

```
$ npx tsc -p tsconfig.json --checkJs --noEmit | grep -c 'error TS'
5675          # in 80 of 82 files -- tsc 5.9.3, strict: true
```

**5,675.** That is the size of the job. `npm run typecheck` will keep printing nothing
until the last file is converted, because a converted file is checked whether `checkJs` is
set or not — which is exactly the property that makes file-by-file conversion possible
here. It also means `npm run typecheck` measures *progress*, never *remaining work*. Use
`--checkJs` for the second number.

The comment in `tsconfig.json` claiming the untyped surface is small is stale. Ignore it.

## 2. Why the previous attempt stalled, and the thing that surprised us

The intuitive plan is "convert the roots first, so the leaves inherit types." Measured, it
is wrong here — actively so.

Converting `js/main.js` to `.ts` **on its own** made the tree worse: **+27 errors total,
+14 of them in other files.** No types propagated outward at all.

The reason is `allowJs: true`. Every `.js` file is *already* in the program and its types
are *already* inferred. `Elem.byId` has had the type `(id: string) => HTMLElement | null`
this whole time. Renaming a file to `.ts` does not change what any other file sees about
it — it only turns on checking *of that file*, which surfaces the errors that were always
there plus a few new strictness ones.

So there is no dependency order to respect and no root to start from. **Conversion order is
free.** The corollary is the useful part:

> The leverage is not in the language change. It is in writing down the things the checker
> cannot infer.

## 3. Where the leverage actually is

Everything below was measured the same way: change one thing, run
`tsc --checkJs --noEmit`, count `error TS`. Four deliberate typos (`Graph.zooom`,
`settings.nonsense`, `window.whatever`, a misspelled method) were planted and re-checked
each time, because an error count that only goes down is not evidence of anything.

| Variant | Errors | Δ | Planted typos still caught |
|---|---|---|---|
| Baseline | 5,675 | — | 4 of 4 |
| `js/main.js` → `.ts`, nothing else | 5,702 | **+27** | 4 of 4 |
| **`js/types/app.d.ts`** (this branch) | **4,946** | **−729** | **4 of 4** |
| ...plus enumerated `Graph`/`App` statics | 4,673 | −1,002 | 4 of 4 |
| Index signatures on `Graph`/`App`/`Settings`/`Window`, `byId<T = any>` | 3,803 | −1,872 | **2 of 4** |

The bottom row is the one to refuse. It looks like three times the progress, and **61% of
it is suppression**: 525 errors from making `Elem.byId` return `any`, and ~615 from
`[k: string]: any` on the four hot globals. Under it, `settings.nonsense` and
`window.whatever` both type-check. That is not a migration; it is buying a lower number
with the thing the migration is for.

`js/types/app.d.ts` is the honest version. Its admission rule is written at the top of the
file and is worth repeating:

> A member may be declared there only if the code that creates it is a loop or a `bind`
> whose result type is already known exactly.

`On.click` qualifies — `js/main.js` binds one static per name over a 42-entry array, and no
annotation inside that file can say so, because the names are strings at runtime. `Html.new.div`
qualifies for the same reason. Mapping `Html` through `HTMLElementTagNameMap` keeps it a
type rather than a suppression: `Html.new.input().value` is allowed and
`Html.new.div().value` is still an error.

### Two things deliberately left out of `app.d.ts`

**`Elem.byId`.** Declaring it *truthfully* costs one error (TS2687/TS2717 — `class Elem`
already owns the static, so a `declare namespace Elem` collides). Declaring it as
`byId<T = any>(id: string): T` removes **525**, every one of them by deleting the result
type. It is the single largest suppression available in this codebase and it is recorded
so nobody rediscovers it as a win. The ~335 "possibly null" errors `byId` leaves behind
are the migration's findings: fix each at the call site, or `Elem.byId('x')!` where the
element is in `index.html` and the code runs after load.

**`Graph` and `App`.** `js/main.js:304-305` does:

```js
Graph = new Graph();
App = new App();
```

A class shadowed by an instance of itself. Every static read afterwards is TS2629
("Class 'Graph' used before its declaration" / cannot be used as a value here), and **no
annotation fixes it** — the fix is code. Enumerating the statics in a `.d.ts` buys 274
errors and is transitional debt; it is left out so the work stays visible. Resolve it by
renaming the classes (`class GraphCtl` / `class AppCtl`) in Phase 3.

## 4. Name collisions with `lib.dom`

Four app globals share a name with a DOM global. This is not theoretical — the tree has a
live collision **today**, with zero files converted:

```
js/interface/neuralapi.js(16,5): error TS2717: Subsequent property declarations must have
the same type. Property 'startTime' must be of type 'CSSNumberish | null', but here has
type 'number'.
```

`class Animation` at `js/interface/neuralapi.js:8` merges with `lib.dom`'s `interface
Animation`, and `startTime = Date.now()` contradicts `Animation.startTime`.

### The rule, measured

A `lib.dom` global declared with an **anonymous type literal** cannot be augmented:

```ts
// lib.dom.d.ts: declare var Node: { new(): Node; prototype: Node; ... }
declare var Node: { new (): any; prev(x: any): any };   // error TS2403
```

The attempt **fails loudly** — TS2403, and the augmentation is rejected, so `Node.prev`
then errors TS2339 against the original lib shape. (An earlier review reported this as
silently ignored with zero diagnostics. It is not silent; it errors. The conclusion is the
same and stronger: you cannot declare your way out of it.)

A global declared through a **named interface** *can* be augmented, silently and
successfully. Verified for all four this repo already extends:

```ts
interface StringConstructor  { isJson(s: string): boolean }   // String.isJson  -- merges
interface FunctionConstructor{ nop(): void }                  // Function.nop   -- merges
interface PromiseConstructor { delay(ms: number): Promise<void> }
interface Math               { PHI: number }
```

### Verdict per name

| App global | Refs in `js/` | DOM global? | Action |
|---|---|---|---|
| `Node` | 367 | yes, anonymous literal | **rename** to `GraphNode` |
| `Animation` | 51 | yes, named interface *and* class-merging | **rename** to `NodeAnimation` |
| `Event` (`js/globals.js:598`) | — | yes, anonymous literal | **rename** |
| `Request` (`js/main.js:111`) | — | yes, anonymous literal | **rename** |
| `Path` | 6 | **no** — the DOM name is `Path2D` | leave alone |

`Path` was previously listed as a blocker. It is not one: `grep -c 'declare var Path:'
node_modules/typescript/lib/lib.dom.d.ts` returns 0.

The `Node` rename is mechanical. Checked before recommending it:

```
instanceof Node                    0
extends Node       (word-bounded)  0     # the 3 textual hits are `extends NodeActions.base`
: Node             (annotations)   0     # the 4 textual hits are `type: Node.getType(...)`
Node.prototype                     6
.animate( / getAnimations(         0     # so the Animation rename is safe too
'Node' in index.html               0
```

`Node` is 75 of the 5,675 errors — **1.3%**. Rename it because it makes the file readable
and the collision unfixable-by-declaration, not because it is where the errors are.

## 5. Phase 0: the gates

Nothing gets converted until each of these has been shown to fail on a planted fault. A
detector that has never fired is not a detector.

| Gate | Command | Catches |
|---|---|---|
| Load path | `npm test` | array/disk disagreement, double-load, `.ts` spelling, `.d.ts` in the array |
| Conversion rules | `npm test` | dev-vs-release emit divergence, `!:`, `.js` beside `.ts`, orphaned `window.` globals |
| Type check | `npm run typecheck` | TS2564, TS2610, everything in a converted file |
| Dev server | `npm run verify:served` | every one of the 81 entries returns parseable JavaScript |
| Release build | `npm run build && npm run verify:dist` | same, against `dist/` |
| Boot | Playwright: navigate, assert `pageerror` set | the app still starts |

`npm test` is 64 tests. All 64 pass on this branch, `npm run verify:served` and
`npm run verify:dist` both clear all 81 entries, `dist/` contains no `.ts`, and the boot
probe reports 81 loaded scripts with every global present:

```
Graph object   App object   Elem function   Html object   On function   Off function
Logger object  Node function  Animation function  Request function  Tag function
Html.new.div().tagName      "DIV"
Html.make.div('x').className "x"
Elem.byId('definitely-not-there')  null      # the honest type, confirmed at runtime
```

The probe reads **bare identifiers**, not `globalThis.X`. A top-level `class`, `let` or
`const` in a classic script never becomes a property of `globalThis`, so a `globalThis`
probe reports "missing" for symbols that are fine — and, worse, cannot detect counterexample
4 at all.

### Why prevention, not detection, for the emit problem

`js/x.js` is compiled by **two different tools that are not the same compiler**: esbuild in
dev (Vite), `tsc -p tsconfig.build.json` for `dist/`. Neither type-checks. Where they
disagree about *emit*, one commit becomes two different programs — and every browser-based
check we have drives the dev server, so the release side is unobserved.

Rather than diff the two outputs, `test/ts-conversion.test.js` forbids the four constructs
where they are known to disagree. A construct that cannot appear cannot diverge, and it
costs no build, no server and no browser:

- **`enum` / `const enum`** — esbuild emits a runtime object; tsc inlines and emits no
  binding. `typeof NodeKind` is `'object'` in dev and `'undefined'` in `dist/`.
- **parameter properties** (`constructor(private x)`) — at target ES2022
  `useDefineForClassFields` is on, so tsc emits a field that `[[Define]]`s an own property
  and shadows an inherited accessor; esbuild emits none and the setter runs. This repo has
  accessor-backed state (`App.get nodeMode()`, `NodeMode.val`), so it is live: `{val: 5}`
  under tsc against `{val: 50}` under esbuild.
- **decorators** — the two implement different proposal stages.
- **`namespace` / `module` blocks** — a runtime object under one, elidable under the other.
  Legitimate in a `.d.ts`, which emits nothing; never in a load-path file.

### Why `!:` is banned

`title!: string` is the reflex fix for TS2564 and it is wrong here. **Both** tools emit a
bare `title;` field, which under `[[Define]]` semantics resets the property to `undefined`
*after* the base constructor already set it. Because both agree, a dev-vs-`dist` diff is
blind to it. `js/nodes/nodeclass.js` seeds ~40 properties exactly that way. Declare the
field with a type that includes what the base assigns, or use `declare` so no field is
emitted.

Consider banning `as any` in `js/**/*.ts` for the same reason: one `as any` makes a
signature divergence invisible to every gate here.

### The five counterexamples these gates exist for

Each was executed against an earlier version of the plan and survived every check it had:

1. `const enum` — dev green, `dist/` throws `ReferenceError`. *Now: banned.*
2. parameter property + inherited accessor — silent arithmetic difference between dev and
   `dist/`. *Now: banned.*
3. `title!: string` on a subclass field — base-constructor values become `undefined` under
   both toolchains. *Now: banned, and `npm run typecheck` catches the TS2564 it came from.*
4. `window.Foo = {...}` → `const Foo = {...}` during a conversion — silences TS2339, keeps
   the file working, breaks every *other* file that reads `window.Foo`. A boot probe cannot
   see it, because a top-level `const` in a classic script is reachable by bare identifier
   and the readers are usually inside a listener that fires only on an OAuth popup or a
   drag. *Now: `test/ts-conversion.test.js` cross-checks every `window.X` read against
   every `window.X =` write, with a justified allowlist for DOM/Electron/Playwright names.*
5. `.js` left beside the new `.ts` — dev serves the `.js` and ignores the `.ts`; then
   `postbuild` copies `js/` and tsc **overwrites** `dist/js/x.js` from the `.ts`. One
   commit, two programs, every gate green. *Now: banned.*

### Traps found while building the gates

- **Vite caches transforms by module id** and will serve the *previous* transform of a path
  whose source was just renamed. Measured: `verify-served` passed immediately after
  `git mv x.ts x.zzz`, then failed on the same entry seconds later. It now appends a
  per-run query string so Vite resolves from disk every time. A gate that passes on cached
  output is worst exactly during a migration, when every path is being renamed.
- **`page.on('console')` does not receive uncaught exceptions.** Only `page.on('pageerror')`
  does. A console-only listener reports a clean boot through a `ReferenceError`.
- **Assert the multiset of console messages, not the count.** The app logs a stable set at
  boot; a count comparison passes when one message is swapped for another.
- **`index.html` pulls 21 CDN scripts.** A boot assertion that requires zero network
  failures is flaky by construction. Filter to same-origin.
- **The boot gate needs the optional backends down**, or their connection errors mask real
  ones. With both absent, the expected set is exactly four, all of them *caught* fetch
  failures rather than uncaught exceptions:

  | Origin | Message |
  |---|---|
  | `localhost:7070/check` | `ERR_CONNECTION_REFUSED`, then `ERR: Not connected to Localhost Servers` via `Request.send` |
  | `127.0.0.1:11434/api/tags` | `ERR_CONNECTION_REFUSED`, then `ERR: In fetching model tags` via `receiveOllamaModelList` |

  Anything else at boot is a regression.

### Deliberately not built

A "drift detector" comparing dev bytes to `dist/` bytes was designed and dropped: to be
accurate it has to normalise away legitimate differences between the two emitters, and
every normalisation is a place a real divergence hides. It cannot be both accurate and
safe, so the four bans above stand in for it. **Documented gap:** a divergence from a
construct not on the ban list is unobserved. Add to the list when one is found.

## 6. Phases

Phase 0 is done on this branch. Phases 1-4 are one commit per step, gates green before each.

- **Phase 0 — gates.** `test/load-path.test.js`, `test/ts-conversion.test.js`,
  `scripts/verify-served.mjs`, ADR-0002. Each fault-proved. **Done.**
- **Phase 1 — declarations.** `js/types/app.d.ts`. Zero files renamed, 5,675 → 4,946.
  **Done.**
- **Phase 2 — behaviour pins**, before any rename touches them: `On`/`Off` add + remove and
  passive-vs-not, `Logger.level` gating, `Request.send` on success/failure/throw,
  `Elem.byId`/`hide`/`displayBlock` against a missing id, `Html.new.div()` and
  `Html.make.div('x')`, `Tag.node`/`Tag.ref`/`getClosingBracket`.
- **Phase 3 — renames.** `Node` → `GraphNode`, `Animation` → `NodeAnimation`, `Event`,
  `Request`, and `Graph`/`App` class-vs-instance. Mechanical, one name per commit, gates
  between. This is the only phase where a mistake is silent, which is why Phase 2 comes
  first.
- **Phase 4 — file-by-file conversion.** Order is free (§2), so take leaf-first for
  reviewability: `js/utils` and `js/types` before `js/nodes` and `js/interface`. Each
  commit: `git mv x.js x.ts`, leave the `PageLoad.scripts` entry spelled `.js`, fix that
  file's errors without `as any` and without touching another file's types, run the gates.

## 7. Unrelated bug found on the way

`js/nodes/nodeinteraction/connect.js:44` calls `connectDistance` with five arguments where
it takes four. The trailing `true` is dropped and a *distance* (`mag()/2`) lands on the
`linkStrength` parameter instead of `0.1`. This is a live behavioural bug, not a typing
artefact, and it is the kind of thing the migration exists to surface. Fix separately from
this branch.
