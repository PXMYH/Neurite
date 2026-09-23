# Make Neurite a great knowledge-graph editor

Goal, in the user's words: a super cool editor specifically for building a knowledge
graph / map. Infinite scrolling is the baseline requirement. 3D fractal if feasible.
Nothing may be deleted — every change is additive or a refinement. Every phase is
verified in a real browser with Playwright. Done when the aesthetics, the usage and
the utility survive an adversarial review.

## What was measured first (2026-09-23)

The canvas engine is strong and does not need rewriting:

- Zoom anchors exactly under the cursor: **0.00 px drift** at three different cursor
  positions over 12 wheel notches (probe, real `mouse.wheel`).
- Pan is unbounded. Driven to `1e12` with the SVG layer rebasing under it
  (`Svg.pan` follows, `viewBox` stays at `-8192 … 8192`).
- Zoom depth reached `1.4e-21` with the fractal still rendering. The wall is the ULP
  of `Graph.pan`, not a clamp, so depth is limited by distance from the origin.
- `Graph.zoom` is a complex number, so rotation is already part of the view state.

So "infinite scrolling" is already true in the math. What is missing is everything
that makes an infinite canvas usable and worth looking at.

What is weak, measured rather than felt:

- The app has no typeface. `font-family: "Inter"` on the universal selector, no
  `@font-face`, no font file in the repo, no font link. Every glyph is the OS default.
- 149 distinct colour literals against a 27-token palette. `#222226` is hardcoded 68
  times and never named. Nine interchangeable greys for one surface role.
- `--ui-accent` `#5a7ec0` measures 3.85:1 on `--ui-chrome`. The colour that carries
  focus, selection and hover fails AA everywhere in the chrome.
- The node card, the app's primary object, has **no hover state** at all.
- Card header buttons render ≈20×20 px and shrink further with the card's zoom.
- Only 128 fractal paths, most of them `RGB(73,73,73)` on pure black — the background
  reads as scratches, not as a fractal.
- No orientation aids of any kind: no zoom readout, no minimap, no fit-to-view.
- The notes editor (CodeMirror) is three levels deep: menu › Views › tab.

## Phases

Each phase ends green in the browser and in one commit.

- [x] **1. Foundation.** A real font stack and a type scale. Spacing, radius and
      z-index tokens. Accent and danger raised to AA. One place that defines what the
      app looks like. Turned up three things bigger than the stylesheet: every card
      was drawn at `scale(0.5)` so no card's text was legible; new notes landed on
      top of each other and off screen; and cards drifted away from where they were
      put, which had been hiding both. 19/19 e2e with five new placement tests.
- [x] **2. A background worth having.** Two bugs, not a design limit. The cursor
      flashlight was dividing its own setting by 100 at every boot, so 73% of the
      fractal's samples were not going where the reader was looking. And every pan,
      zoom and pinch accumulated a regeneration figure that `lerp(a, b, 0)` then threw
      away, so the background drew one hair per frame whether you were moving or
      still. Both fixed, a frame budget added because there was none, and the default
      line count raised from 128 to 384 after measuring that holding more of them is
      free.
- [x] **3. Infinite canvas, made usable.** Scale readout, an overview with the
      viewport drawn on it, Fit and Home, and keyboard shortcuts guarded on where the
      caret is. Plus two arithmetic fixes: complex division reached 1e-162 and now
      reaches 1e-309, and rotating no longer changes the zoom level.
- [x] **4. Editor gestures, and the editor.** Plain double-click makes a note with
      the caret already in it. And the notes pane -- the CodeMirror the whole map is
      built from -- has a menu row for the first time; it was loaded and unreachable.
- [x] **5. Adversarial review.** Two reviewers, one on aesthetics and one building a
      real graph by hand. Both found real things, including three comments of mine that
      described fixes which had not landed: the arrowhead recolouring was applied to a
      `display: none` element, the chip label was still paleturquoise, and a `max-width`
      reintroduced the bare-strip defect it was written to fix. Acted on; see the commit.

## What is left, and why it is left rather than half-done

Ranked by what it would cost a reader building a real graph.

1. **No undo.** Verified absent -- `window.js:462` says so outright and a grep of `js/`
   finds no implementation. An accidental link or delete is permanent. This is the
   largest single gap in the app and it is a real project: the save format is live DOM
   (`#nodes`' innerHTML), so an undo stack has to be built against the graph model
   rather than against the document, and the text pane is a second source of truth that
   would have to be kept in step with it.
2. **A note's title defaults to a millisecond timestamp**, and `[[Title]]` is the link
   address, so typing naturally produces a graph addressed by `26-09-23 ~ 00:34:20.090`.
   Fixing it means deciding what an untitled note is called and what happens to links
   when a title changes, which is a design question and not a defect to patch.
3. **Auto-layout.** `relaxOverlaps` separates cards; it does not arrange them. A radial
   or hierarchical layout over a selection is the next real utility win.
4. **The armed-link state has no indicator.** Shift and mousedown on a note arms a link
   that the next mousedown anywhere completes, with nothing on screen saying so, and it
   persists indefinitely. Cheap to fix and worth doing.
5. **Wheel-pan is half cursor speed** and pan is left-button only; middle-drag does
   nothing by default.

Also recorded: the CDN `<script>` tags in index.html carry no Subresource Integrity, so
a compromised CDN would execute in the page. Out of scope for this work and not a thing
to leave unsaid.

Deliberately not attempted, and why:

- A 3D fractal. The 2D one is not a backdrop, it is the coordinate system: node
  positions are complex-plane points, `Graph.pan` and `Graph.zoom` are complex
  numbers, and node physics follows `Fractal.grad`. A Mandelbulb would be wallpaper
  with a force field that no longer matches what is drawn, behind DOM cards it can
  never occlude. The honest version of the same wish is a GPU pass that shades the
  existing 2D set with a distance-estimator normal, which keeps every one of those
  properties -- worth doing, and a project rather than a phase.

## Review

(filled in as phases land)
