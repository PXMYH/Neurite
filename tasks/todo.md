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

## Two corrections to claims made in earlier commit messages

Both caught by the final review, recorded here because a commit cannot be amended once it
is pushed and a wrong number left standing is worse than the mistake.

- "Fit ... margin 1.46" holds at 1600px wide only. The chrome insets are absolute pixels,
  so the margin climbs as the viewport shrinks: measured 1.4601 at 1600x1000, 1.6122 at
  1280x800 and 1.7418 at 1024x700. The behaviour is right at all three -- 0 cards off
  screen, 0 behind chrome -- but the single number was not the whole picture.
- "0 of 66 pairs overlapping, worst ratio 1.0521" reads as a contradiction and is not one.
  The ratio is the separating-axis clearance, where 1.0 is exactly touching and 1.05 is 5%
  clear; the review's "worst 0" is overlap depth on a different scale. Both say the same
  thing. The sentence should have named its scale.

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
5. **A card's footprint in plane units depends on the viewport**, so shrinking the window
   re-introduces overlaps that Tidy had resolved. Measured with positions byte-identical
   throughout: 0 overlapping pairs at 1440x900, 11 at 900x600, 0 again on the way back.
   Cards are sized in CSS pixels while positions are in plane units, and the conversion
   runs through `min(viewportW, viewportH)` -- so `Graph.planeHalfExtent` honestly returns
   a different answer at a different window size, and every separation routine measures
   through it. Fixing it means deciding whether a card scales with the window, which is a
   question about what this canvas is rather than a defect to patch. Tidy is the
   workaround and it is one keystroke.
6. **Wheel-pan is half cursor speed** and pan is left-button only; middle-drag does
   nothing by default.
7. **The empty-state hint paints through an open modal**, since it is only hidden on note
   count.

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

# macOS app, and the freeze it found (2026-09-26)

Asked: "pack this up as a macOS app". Then: release a DMG for Apple Silicon (M1+) whenever
a feature lands.

- [x] `desktop/` -- Electron 44, its own `package.json` so the root install stays Electron-free.
      `main.cjs` serves the built `dist/` from a privileged `app://neurite` scheme (not file://,
      which breaks `fetch('/resources/...')`; not a port, which collides with 8999). Measured
      first that `dist/` is faithful to the dev server: 53/53 e2e against it, and 0 differing
      computed values over 1,233 elements x 21 properties with the notes pane open.
- [x] Offline after the first launch: the 23 CDN scripts are redirected to a cache-first disk
      copy, but only for requests the app itself makes (`initiatorOrigin`).
- [x] Quit keeps the work: the window waits for `App.viewGraphs.saveNow()` (savenet.js).
      Without it a 100-note graph quit 300ms after its last note came back empty, 3 of 3.
- [x] The smoke test that drove that out found a worse bug of my own: 100 notes arriving at
      once froze the page for **89 seconds**. Two causes, both fixed, both measured by CPU
      profile rather than guessed: `relaxOverlaps` resolved one pair per pass with a 4000-pass
      cap and `settlePlacement` ran it six times per arriving note; and every card's editor
      forced a whole-page layout as its text arrived. Now 572ms worst stall at 100 notes,
      186ms at 50, 60fps steady at 200, and 0 overlapping pairs after bursts of 5 to 100.
- [x] Packaged arm64 `.app` (ad-hoc signed, valid) and `.dmg`; the smoke test passes against
      the app inside the mounted DMG.

# The delete dialog, polished (2026-10-02)

Asked: "improve the delete experience, the modal looks not beautiful, iterate until it's
polished, use playwright to verify". Tier T2, brownfield.

Measured first, in Chromium, WebKit and WebKit as an iPad: the delete of a note opened a
280x125 box under the tool pill, not over the middle of the window; nothing behind it was
dimmed and every click still reached the Graph; the box was 75% see-through with square bottom
corners; it was titled "Confirm" and asked `Delete "Chunking"?` on two bevelled half-width
buttons, a maroon Yes and a grey No. The alert and the prompt share the same shell.

- [x] Phase 1a -- the three dialogs that ask (alert, confirm, prompt): a dimmed page that takes
      the clicks, the card in the middle of the window (of what the keyboard leaves, on an
      iPad), the question as the title, no ×, buttons in one row at the right with Cancel
      first, 44px tall under a coarse pointer, a 180ms rise that reduced motion turns off.
      A click on the dimmed page is Escape for an alert or a confirm; a prompt keeps it.
- [x] Phase 1b -- a note's delete is asked by its Title and answered Delete in red, and says
      when its text in the Notes panel goes too (`confirmNodeDelete`, zetcodemirror.js).
- [x] Phase 1c -- a delete takes the text of its own Node, found by the Node and not its
      Title: an image named like a note took that note's text, and then the note.
- [x] Phase 2 -- the other deletes say what they delete the same way: an Archive, documents
      in the Vector Database, this site's storage, a Neurite account; and the two questions
      that put a graph away or take a Ref out (Clear, an import, Turn the arrow) are red too.
- [x] Phase 3 (asked after 1.5.1: "Click beside a dialog should dismiss the delete dialog") --
      a click beside a confirm is its Cancel, and beside an alert its OK; a prompt keeps what was
      typed and stays. The rest of a double-click there is the dialog's: measured without that,
      its second click landed on the Graph, made a note and cleared the selection.

Not done, and why: an Undo in place of the question. The Notes panel's own undo already brings
a deleted note back (measured: section, Node and Edge), but it is an editor's history, not a
promise the dialog can make, so the dialog makes no claim about undo either way.

## Review

- Browser first, in Chromium, WebKit and WebKit as an iPad: before and after screenshots of
  every dialog that asks, the accessibility tree through CDP, and a script for Escape, Tab,
  Enter, the wheel, a finger, a pinch, a drag, long titles and messages, the keyboard's
  `--visible-height` and reduced motion. Pinned by 22-dialogs.e2e.mjs.
- An adversarial review found eleven things, ten measured. Fixed: keys and a double-click
  reaching the Graph through the dialog, a press taking the keyboard out of it, a dialog
  raised mid-drag, a stale explanation overlay over the question (`Modal.closeOverlay;`
  was never called), a Safari pinch zooming behind it, a long title in a short window, a
  file dropped on it, the misplaced comment, the image named like a note, and the other
  destructive confirms that lost their red. The backdrop click that closed a question was
  taken out at first, because a double-click's second click made a note; it is back in Phase 3,
  with the rest of the double-click taken out instead.
- A trap of my own on the way: `Modal.onBehind = function(){...}` followed by a line that
  opened with `[` -- no semicolon in this codebase's style -- read as an index into the
  function, threw at load, and took the rest of custommodal.js with it. The behaviour
  script's page-error check caught it; a `for` loop cannot be glued on that way.
