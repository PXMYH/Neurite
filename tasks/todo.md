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
- [ ] **2. The card and the edge.** Type hierarchy, readable body text, hit targets at
      24 px, hover and focus states, link chips that can be read, edges that are
      visible and directional.
- [ ] **3. Infinite canvas, made usable.** Zoom readout, minimap with the viewport
      rect, fit-to-view for all and for the selection, and a way home. This is the
      baseline requirement turned into something a person can actually use.
- [ ] **4. Editor gestures.** Double-click empty canvas to create a note already in
      edit mode. Drag from a card to connect, drop on empty space to create connected.
      Keyboard: child, edit, escape.
- [ ] **5. Command palette.** One keystroke to search every note and run every
      command, and to fly to a result.
- [ ] **6. A background worth having.** Density, palette and depth for the fractal.
      A verdict on WebGL and on 3D, taken from measurement.
- [ ] **7. Structure.** Layout for a selection, and a focus mode that dims everything
      more than N hops away.
- [ ] **8. Adversarial review.** Loop until the reviewer has nothing left.

## Review

(filled in as phases land)
