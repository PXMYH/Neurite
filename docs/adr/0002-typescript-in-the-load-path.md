# 0002 — TypeScript lives in `js/`, and the load path does not change

- **Status:** accepted
- **Date:** 2026-08-23
- **Context issue:** [#48](https://github.com/PXMYH/Neurite/issues/48)
- **Relates to:** [`0001`](0001-keep-the-hand-ordered-script-array.md) — still accepted, amended, not superseded

## Context

`js/` is 82 plain scripts loaded in a hand-ordered array. The craft algorithms worth
reusing — Excalidraw's `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/common`
— ship as TypeScript source and nothing else: `packages/element/src` contains zero
`.js` files. In JavaScript every one of those is a hand-translation. That is the cost
[#48](https://github.com/PXMYH/Neurite/issues/48) raised and
[`0001`](0001-keep-the-hand-ordered-script-array.md) never priced.

The fear was that TypeScript means a bundler, and a bundler means paying every cost
ADR-0001 declined. It was measured instead. Two facts decided it.

**Vite's dev server already answers a request for `js/x.js` with `x.ts` transpiled.**
Measured on this tree: the loader asks for `js/zettelkasten/zetsplitter.js`, no such
file exists, and the response is `200 text/javascript` with the types stripped. No
plugin, no config, no change to `PageLoad.scripts`, no watch process. The dev loop
stays edit-then-refresh.

**A TypeScript file with no `import` and no `export` is a *script*, and scripts share
one global scope.** That is the same arrangement `PageLoad.scripts` builds at runtime,
so the load model needs no translation at all: the converted file reads `tagValues`
and `getClosingBracket` straight out of `js/globals.js` with nothing declared and
nothing imported, and a type error that crosses the two files is still reported.
Type checking is whole-program; load order is untouched by it.

## Decision

1. **`js/` may hold `.ts` files. `PageLoad.scripts` does not change** — not the
   entries, not the order, not the `:MODULE` convention. An entry keeps its `.js`
   spelling; the extension on disk is an implementation detail of that one file. A
   converted file therefore cannot move, and cannot be reordered by accident.
2. **No build step enters the dev loop.** `npm start` is unchanged. `npm run
   typecheck` (`tsc --noEmit`) is a question asked about the tree, never a step that
   produces something the browser loads.
3. **The release copy gets one emit.** `postbuild` already copies `js/` verbatim, and
   verbatim ships TypeScript that no browser runs — measured, `dist/js/**/*.ts`. So
   `postbuild` now also runs `tsc -p tsconfig.build.json` and sweeps the `.ts`
   sources out of `dist/`. That config is transpile-only (`noCheck`), so dev and
   release are the same operation by two tools: strip types, check nothing.
   `alwaysStrict` is off so tsc does not prepend `"use strict"` to a script file that
   esbuild leaves alone — dev and `dist/` agree on semantics.
4. **`checkJs` is off.** With `allowJs` the 81 remaining `.js` files are in the
   program, so their globals have types; checking them reports **1,917 errors in 79
   files**, 1,769 of them TS2339. A check nobody can get to zero is a check nobody
   runs. A file gets checked when it becomes `.ts`, one file at a time — the same
   shape ADR-0001 already sanctioned for `:MODULE`.
5. **A test reaches a `.ts` file through one transpile hop.** `ts.transpileModule`,
   then the existing `node:vm` slice. Worked example: `test/zetsplit.test.js`. The
   text-reading route is unaffected apart from the path's extension.

## The first file

`js/zettelkasten/zetsplitter.js` → `.ts`. Chosen because it is a true leaf: 66 lines,
one class, and `ZetSplit` is named by no other file, so the language change could not
ripple. Verified end to end — `npm run typecheck` clean, `npm test` 56 tests green,
the dev server serving all 81 array entries with zero non-200s, and the app booting in
a real browser from both `npm start` and a static server over `dist/`.

Typing it found two defects in 66 lines, which is the argument for the whole exercise
better than any prediction was:

- `checkBracketsMap ?` tested a function object, never called it, so the condition was
  always true and a Ref Tag with no closing half appended the literal string
  `"undefined"` to the Pane text. TypeScript reports it as TS2774.
- `sections[index - 1]` was read without checking it existed. Under `strict` that is
  an error, and the fix is the guard that was missing.

## Consequences

- **ADR-0001 stands.** Its decision — keep the array, convert opportunistically — is
  unchanged and is what this leans on. One sentence of its reasoning is now false and
  is amended there: there *is* a build step for app code, in `postbuild` only, and
  `postbuild` no longer copies `js/` purely verbatim.
- A new `.ts` file still has to be added to `PageLoad.scripts` — spelled `.js`.
- `typescript` is a devDependency. It is not in the load path and no runtime
  dependency was added; the browser still fetches plain scripts.
- `npm run typecheck` is not wired into `npm test`. It is the second automated check
  this repo has ever had, and it should stay cheap to run and separate to read.
- **Revisit when** an actual Excalidraw file is ported and needs `:MODULE` plus
  relative imports. `moduleResolution: "bundler"` means TypeScript accepts the
  `./x.js` spelling that resolves to `x.ts`, and the dev server resolves it the same
  way — measured — but no ported file exercises that yet.
