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

# The universe behind the Graph (2026-10-09)

Asked: "I want the effect in 我把claude画成了一片星空 … as the universe as background, also the link
between knowledge node make it slimmer, now it's too thick. The color of nodes links etc should be
more vivid and colorful." The reference is the RedNote video of Terse: a galaxy seen almost edge on,
its disc of glowing green, teal, gold and pink stars around a warm core, on black, with hairline
filaments between the stars. Tier T3, brownfield.

Measured first, in Chromium and WebKit as an iPad, with nine notes and eleven Edges: the page is
black (`document.body.style.backgroundColor` from the BG picker), the Fractal's lines are faint
orange hairs, every Edge is a #8fb4e8 ribbon about 5 CSS px wide at ×0.4, and every card is the same
brown with the same #d49454 outline. 60 fps in both.

Decisions:
- The Fractal stays. It is the coordinate system (CONTEXT.md), so the universe is a layer under
  it, not a replacement: one WebGL canvas `#universe` before `#neurite-workspace`, sized in vw/vh
  (the body carries a transform and is 0px tall), `pointer-events: none`, so input still lands on
  `#svg_bg` and nothing in a Saved Graph changes.
- Drawn from `NodeSimulation.nodeStep` right after `Svg.updateViewbox`, so it moves in the same
  frame as the view and keeps the `framesDelay` throttle. Its pan is the screen distance the plane
  moved, accumulated (deep zoom never reaches it as a huge number); far stars move at a fraction of
  it and wrap, the galaxy barely moves; the sky turns with the view.
- Motion is slow (the disc turns, inner faster; stars twinkle) and stops under
  `prefers-reduced-motion`, with no parallax. Still, it redraws at half rate. A frame budget steps
  the canvas resolution down on a slow GPU; without WebGL the page stays black, as now.
- A switch in the Fractal panel turns it off, for a slow machine or a reader who wants black.
- Edges: much thinner ribbons with the arrowhead kept at its size, coloured from the two Nodes'
  colours; set in `EdgeView.draw`/CSS so saved Edges follow (their style is saved per Edge).
- Nodes: a vivid colour per Node from a stable hash of its uuid, as a custom property written in
  `rewindowify` (create and restore both run it), read by the card's outline and glow, the header,
  and the overview's marks. The selection ring keeps the accent.

- [x] Phase 1 -- the universe layer, its switch, reduced motion, the frame budget.
- [x] Phase 2 -- slim, colourful Edges.
- [x] Phase 3 -- vivid Nodes, and the overview following them.
- [x] Review, full e2e in Chromium and the iPad specs, a release.

## Review

- An adversarial review found ten things, eight measured. Fixed: a universe build that failed half
  way (iOS refuses canvas memory past a cap) threw on its first draw inside `nodeStep` and stopped
  the app's one frame loop -- it is built whole or not at all now, and a draw that throws puts it
  away; WebKit painted a `non-scaling-stroke` gradient in its last colour, so the hairline floor
  of an Edge is geometry now; the resolution ceiling only ever went down, so a stall of the page's
  own cost a step for good -- it retries after a wait that doubles; a chosen BG colour was hidden
  under the sky -- a saved one keeps the universe off, and picking one turns it off; parallax died
  below |zoom| 1e-153, where the zoom squared is 0; the collapsed disc copied the card's computed
  glow into its inline style, which a Saved Graph kept; a pinned card and a loose one measured
  1.01:1; switched off it was still built; the gradient ends were rewritten every frame; the dither
  overflowed half precision. A zoom jump no longer flies through the stars.

# The menu list as wide as its words (2026-10-10)

Asked, with a screenshot of the open menu: "width too much, more align with text". Tier T2,
brownfield. Measured: the list is 480px (`--ui-panel-width`, the one width #32 gave the list and
every panel), its longest label ends 152px in, and the chevrons stand 328px past it.

Decisions:
- The panels keep their one width (#32 was about them: a 290px column of sliders). The list is
  not a panel, so it is `width: max-content` with a 220px floor, which keeps "Not saved to a file
  yet." on one line, and opening a panel widens the menu to the panels' width.
- Two things in the list are not rows and must not size it: the save note (up to 120 characters)
  and the folded function console. Both are `contain: inline-size`; without it they made the list
  699 and 312px. The console opened under the list takes the panels' width, keyed on `.hidden`
  so the menu stays wide until it has folded.

- [x] The list hugs its rows; panels, the console and narrow windows keep their widths.
- [x] Chromium, WebKit and an iPad measured: 220px list, 480px panels and console, 0 spill.
- [x] Tests: the panels spec reads the list's slack and the note and console cases; the
  selector guard in notes-tab.test.js admits the two width-only rules and holds them to widths.

## Review

- An adversarial review found one thing: the save note names the file a stopped mirror wrote
  to, and a name has no space to wrap at, so 40 letters ran 194px past the narrow list and
  `overflow-x: hidden` cut them off. The note breaks anywhere now; the panels spec writes that
  note and fails without the fix.

# The Mac app updates itself (#76, 2026-10-10)

Asked (#76): "auto detect there's a new release and auto update the mac version, there should be
a refresh button and click update to download and close and install and reopen the app". Tier T3,
brownfield: the desktop main process, a new preload, a menu row in the page, docs.

Measured first: the app is ad-hoc signed (`codesign --sign -`), so Squirrel.Mac, and with it
Electron's `autoUpdater` and electron-updater, cannot validate an update: they compare the new
bundle's designated requirement against the running one, and an ad-hoc requirement is its own
cdhash. The releases API gives each asset a `digest` (`sha256:...`); v1.6.0's DMG reads
b19bb76e..., the hash taken when it was published. The DMG is the only Mac asset.

Decisions:
- The main process owns it (`desktop/updater.cjs`), with the parts that need no Electron in
  `desktop/update-core.cjs`, so the root `npm test` can run them: version order, the asset, where
  the bundle is and whether it can be replaced, and the swap.
- Check 20 s after launch and every 6 hours, against `releases/latest` (drafts and pre-releases
  never), and when asked. `NEURITE_UPDATE_FEED` points it at another feed, for the tests.
- Update: download the DMG, check it against the asset's digest (none: refuse), mount it
  read-only off Finder, copy the app next to the running one (same volume, so the swap is a
  rename), check its seal, bundle id and version, then quit -- the window's close already saves
  the Graph -- and a detached `/bin/sh` waits for the process to end, swaps the bundles (the old
  one comes back if the second rename fails) and opens the new one with the same profile.
- Refused, with a way out (the release page in the browser): running from the disk image or a
  translocated copy, or from a folder that cannot be written.
- The page gets one narrow bridge, `window.neuriteDesktop.update` (state, check, install,
  onState), from a preload; still no `electronAPI` and no `startedViaElectron`, so link nodes
  and everything else run as in a tab. The menu gains one command row, desktop only: "Check for
  updates" with its state in a note under it, "Update to x.y.z" once one is found, and a dot on
  the menu button while one waits.

- [x] Phase 1 -- update-core.cjs and its unit tests (order, asset, place, swap in a temp dir).
- [x] Phase 2 -- updater.cjs, preload.cjs, main.cjs wiring.
- [x] Phase 3 -- the menu row, its states and the dot; an e2e spec with a stand-in bridge.
- [x] Phase 4a -- a packaged build updates itself to the next patch from a local feed, in a scratch
  folder (desktop/update.e2e.mjs), and refuses a DMG whose hash does not match.
- [x] Phase 4b -- the real one, from GitHub: the published 1.7.0 DMG, installed in a scratch folder
  with a profile of its own, found the published 1.8.0 by itself 18 s after opening, and after one
  Update downloaded it from GitHub, swapped, and opened again as 1.8.0 with its note, in the new
  cards; update.log "updated", the seal verified, nothing left in the profile.

## Review

- An adversarial review found eleven things, all answered. The old bundle went before the new
  one had started, so a release that hashed right and would not open left no app: the old one
  is kept until the new copy removes the marker, and one that has not within 30 seconds is
  stopped, the old put back and opened (a hanging build, for real, in update.e2e.mjs). The
  window's close saves and then closes whatever the save did: the update saves first and stops
  if that fails. A six-hourly check in flight could put "Update to x" back over a download and
  let a second install start: one check at a time, its answer dropped once an install began,
  and the install takes the version the reader confirmed. Launch cleared any
  `.x-1.2.3-update.app` beside the bundle: only its own stages now. A feed or download that
  stalled kept the row busy for good: 30 seconds of nothing gives up. The DMG was checked
  against Info.plist and run by package.json: both. The script's `sleep` came from PATH, which
  turned the minute's wait into 0.4 s with PATH=/usr/bin: every tool by its path. A failed IPC
  call said nothing; a confirm the page skipped on stale state could install; a DMG without a
  digest was called "no Mac app".
- Mine, found by the rollback test: the launch that should clear the put-back stage could not,
  because Electron's fs reads app.asar as a folder and its `rm` failed inside it, silently.
  Bundles are removed with `original-fs`.
- A second round found five, in what the first round's answers added, and they are answered:
  "started" was the main process reaching its updater, so a release whose page throws on load
  still cost the old app -- it is the page saying `appReady` now, and such a build is rolled
  back, for real, in update.e2e.mjs; `saveNow`'s own `false` (the last graph did not reopen) was
  taken for a save; two installs in one tick both passed the guard, which is now taken before
  the first await; a check could still publish "available" over a download that began during
  its last await; and the way back said "the old one is back" before either rename, then
  reopened whatever was at the path -- each rename is checked now, a failure says where the old
  bundle is, and the copy that would not start is never reopened. The watchdog waits a minute.
- A third round found eight, answered: `saveNow` resolves after a first write that failed, which
  savenet logs and swallows, so `lastSaveError` now says so; an edit after the update's own save
  rode on the window's, which closes whatever happens -- for an update it closes only over a
  save that worked, and stays open otherwise; `appReady` comes before the graph is restored, so
  started is now the graph back (`whenRestored`); one TERM and a second let a copy deaf to TERM
  keep the profile's lock -- it is KILLed three seconds on; a profile inside the bundle would go
  with it, so such a copy is not updated in place; a cancelled quit left the row "installing" --
  25 seconds on it is taken back, and the swap script, finding no marker and no stage, changes
  nothing when the app does quit; a block found only at install did not reach the row; the docs
  said 30 seconds.
- A fourth round found eight, answered: a blob that failed to save was swallowed without a
  word (`lastSaveError` now covers it, and is cleared as each save begins rather than after);
  an edit typed while the last save wrote could be lost, so the page is held (`inert`) from that
  save to the quit and let go if the update is taken back; a graph restored with a card fewer
  than the old copy managed counted as started -- the marker carries the old copy's count; the
  in-bundle profile check compared text, which a symlink or another casing passes -- it compares
  real paths; any copy reading the marker counted as the new one starting, an older copy
  included -- the new one now writes its version to `update-started`, which is what the script
  waits on; a swap stopped half way (a reboot) stranded the old bundle -- the copy that starts
  clears it when no script came for its started file; `hdiutil` and the other tools had no
  deadline; and the in-bundle profile's advice would have lost it.
- A fifth round found eight, and the review loop stops here: the findings moved from the updater
  to the save and restore under it. Answered: a copy on probation (an update not yet confirmed)
  wrote its graph during the minute before it was taken back -- for a note that costs nothing,
  the Pane's text makes the card again, but an image it could not rebuild was gone; it saves
  nothing now until confirmed (measured both ways, update.e2e.mjs); the skipped-card allowance
  was stale, since the old copy's last save already holds only what it could rebuild -- the new
  copy may skip none; a failed blob write moved the image to an id never written and deleted the
  one it had, in every autosave, not only an update's -- it keeps its blob now
  (21-durability, which fails on main); an AI answer streaming into a note goes on writing after
  the last save, so an update waits for it; the new bundle must run under the same executable
  name the rollback looks for; and the started file is written before the marker goes, or the
  marker stays. Accepted, and said in docs/desktop.md: a power cut between the two renames
  leaves no app at the path (the old one is beside it as `.replaced-<pid>`); and media a new
  version fails to load are blank in it, but kept, since it writes nothing it did not read.

# Text cards: Pletor's anatomy, a HUD's finish (#77, 2026-10-10)

Asked (#77): "text node need aesthetic upgrade", pointing at the GIF on
docs.pletor.ai/build-your-system/nodes/brand-nodes; then, in chat, a sheet of futuristic HUD
panels: "make sure the color scheme is consistent but style can adapt". Tier T2/T3, brownfield.

Read from the GIF (24 s, 393 frames): each node is a quiet rounded card with its kind as a tinted
square chip and its name beside it; the content sits in an inset well; no window chrome until a
node is chosen; thin grey curves between nodes. Read from the HUD sheet: thin luminous outlines
with a glow, corner brackets, square indicators, monospace uppercase labels, hatching and
scanlines, one accent colour per panel.

Measured on the cards as they are (1.6.0): a header bar tinted with the note's colour and three
25px controls always drawn, the prose flush with the card's edges, links as pale pills.

Decisions:
- The title stays on the card, not above it as Pletor puts it: Edges run from Node to Node and
  are drawn under the cards, so a label on the canvas would have them cross it, and every
  measurement of a card (placement, overview, Edges) reads `.window`'s box.
- The colour scheme is Neurite's: everything that is coloured takes the Node's own colour
  (`--node-colour`), the outline stays that colour in full, and the accent stays the selection.
- CSS only, scoped to text cards (`.window:has(.editor-wrapper)`), except two pieces of markup
  made where both creating and restoring a card run: the kind chip (`TextNode.init`, the sprite's
  note glyph, rebuilt each time so a Saved Graph never keeps an old one), and each link tag's
  colour, the colour of the Node it names (`LinkStrip`).
- The window controls are drawn on hover, focus and selection, and always where there is no
  hover. The resize grip becomes the bottom-right bracket.

- [x] The card: chip, title row, tags, well, brackets, controls, grip.
- [x] Chromium and WebKit, at x1 and zoomed out, loose, pinned, selected, collapsed, link armed.
- [x] Tests: a spec for the card's anatomy through a reload; the colours spec still green.

Found on the way: the well's floor at 60px was shorter than a note of one line and the empty
line after it, so a new card grew a frame after it was drawn and stood 3 px off its place (the
touch spec's first-frame test), and an imported note's centre fell on its first line. The well
keeps the 72px floor it had. And the import test put the caret at the end with
ControlOrMeta+End, which on a Mac is Meta+End and moves nothing (measured: 0 of 43); it had
passed only while the click landed on the last line.

## Review

- An adversarial review found four, and a test gap. A resize writes `width: 100%` on the well,
  which with its inset ran 16px past the card, and a Saved Graph kept the write -- the well is
  `width: auto !important`; a selected collapsed card took the card's corner radius over its
  disc's circle; an imported note's description sat outside the well's line; a tag's hover no
  longer showed. And 26-text-card read the custom properties rather than what is drawn: it now
  photographs the chip and finds a pixel of the Node's colour, and reads the tag's computed
  colour; switching each consumer rule off fails it.
- A second round found two: the collapsed card kept the header's new padding, which sat its disc
  22 px below the card's centre (5 px on main) -- the collapsed header keeps the old padding; and
  the well stayed 284-340 px whatever the card was resized to, a strip of card beside it when
  wider and running out of it when narrower -- on main too, but the inset well made it show. A
  resize now lets the well follow the card both ways (NodeView's resize writes `min-width: 0`
  and `max-width: none` with its `width: 100%`). Measured before and after, and in 26-text-card.

# A shorter menu, themes in Settings, and the panels redone (#78, #79, #80, 2026-10-10)

Asked, in chat, over two screenshots (the menu, and the Settings panel): "check for update
should be in settings"; "open and import notes are doing the same thing, keep import notes,
rename it to import"; "screenshort rename to share screen"; "views etc. move to settings and
have each to be a theme, research some popular apps how they provide themes"; of the "Set
Task..." strip, "what is this set task? if not useful remove it"; "move clear feature to the
horizontal toolbox on middle top screen"; "remove record feature"; and "settings and in general
any menu when clicked in needs an aesthetic upgrade, research some popular apps and design
systems to make it better". Tier T3/T4, brownfield. Filed as #78 (the menu), #79 (themes) and
#80 (the panels).

Read from the handlers before moving anything:
- Open… reads a `.neurite` file, which is the only way back to a graph Save to… wrote; Import
  notes… reads a folder of Markdown. Not the same thing, and no browser dialog offers both.
- Set Task is the function console: a task goes to the model with the Neural API's description,
  the JavaScript that comes back is shown and run, and each run is kept. The only way to have
  the AI act on the canvas, and the Neural API's vision loop drives it too. Useful, so kept.
- Record made a video node; Screenshot (`captureScreenToImage`) and the still the vision loop
  reads (`returnScreenshot`) are separate from it.
- A Saved View is a pan and a zoom on the plane the notes are on, so one that moved the camera
  as a theme would carry the reader away from their own notes.

Decisions:
- Import is one row that opens its two sources under itself, as a submenu does: Neurite file…
  and Folder of notes…, each keeping the id its handler binds.
- The console is the last fold of the Ai panel, named Tasks, with a line that says what it does.
  It is hidden with the rest of AI when AI features are off.
- Clear is a tool of the pill, after Propose, with an eraser: a folder with a plus beside the
  File tree tool read as a new folder, and a bin would say it deletes, which it does not.
- Check for updates is the first section of Settings, in the app only; the Settings row carries
  the dot the menu button does while a release is ready.
- A theme is the look only -- line colours, background, brightness and saturation, the universe,
  and the page filters -- and never the camera or the equation. The Saved Views are a section of
  Settings beside the themes, under the glossary's own name (`CONTEXT.md` lists "place" as a word
  to avoid, so not "Places" as #79 first said), and keep moving the camera and nothing else.
- Six themes, a light one among them: Neurite (the defaults), Ember, Aurora, Nebula, Ink, and
  Paper, which is the page filters' inversion turned half the hue wheel, so each Node keeps its
  own colour while the page goes light. A look that is none of them is Custom, kept when a theme
  replaces it. Which card is chosen is read off the controls, never stored, so a graph that opens
  with colours of its own marks its own card.

Phases:
- [x] A: the menu (#78). Import and its sources, Share screen, Clear in the pill, Record gone,
  Updates in Settings, the console in the Ai panel. Unit tests and the four specs it touched.
- [x] B: themes and the Saved Views in Settings (#79). The Fractal and Views panels' markup
  moved verbatim into Settings (Theme with Customize folded, Saved views, Fractal with Drawing
  folded), `themes.js` builds the cards, and 27-themes covers choosing, keys, Custom and Paper.
Research, as asked ("research some popular apps how they provide themes"; "research some popular
apps and design systems"), read from first-party pages:
- Themes, nine apps. Eight keep the theme in Settings, under Appearance or Preferences (VS Code,
  Obsidian, Linear, GitHub, Slack, Raycast, macOS, Notion; Arc in its sidebar). Six make a theme
  colours only. A click applies one with no confirm in most; VS Code alone previews on focus, and
  shows the theme in use by where the focus starts. Obsidian and Raycast show each as a picture
  of the app (512x288 shots; a mock Raycast window). Six let a reader make their own.
  Sources: code.visualstudio.com/docs/configure/themes, obsidian.md/help/themes,
  linear.app/docs/account-preferences, docs.github.com (managing your theme settings),
  slack.com/help/articles/205166337, manual.raycast.com/themes, support.apple.com (mchlp1225),
  notion.com/help/account-settings.
- Panels. Apple's HIG (settings, toggles, sliders, segmented controls, buttons, layout, dark
  mode), Material 3's switch, slider and state tokens, Radix Themes (spacing, type, radius,
  segmented control, switch), shadcn (theming, field), Linear's redesign notes. What they agree
  on: a short heading over a group of rows; the label left and every control on one right edge;
  a description under the label, not in a tooltip; a switch for what is on at once; a slider with
  its value; up to five short choices as a segmented control; one prominent button at most, and
  never a destructive one; 2px focus rings; 24px targets at least; sentence case.

Tokens chosen (`resources/styles/panels.css`): 16px panel padding, 24px between sections, 8px
under a heading; a heading 12/600 in `--text-secondary`, left, no rules; a group white 4% with a
white 6% edge and an 8px radius, rows at least 36px with white 6% hairlines; label 13/500,
description 12/400 in `--text-secondary` (7.2:1 on the group; `--text-muted` was 4.0:1); controls
28px, 6px radius, white 6% fill and white 15% edge, hover 12%, pressed 16%; switches 28x16; the
focus ring 2px of `--ui-accent` 2px out. The chrome is glass, as asked of the tool pill: the pill
and the islands at 60% of `--ui-chrome` with an 18px blur, the panel at 86% because it holds text,
and solid under `prefers-reduced-transparency`.

- [x] C: the panels' design system (#80). `panels.css` for every panel; Settings laid out as
  groups of rows, its sliders one to a row with their values, the placement style a segmented
  control (`Segmented`), the Ai panel's toggles switches; the tool pill and the islands glass,
  their glyphs #ddd. 28-panels covers the anatomy, the values, the switches, the segments and the
  glass.

Found in C: every tool's glyph was #9d9d9d whatever its tool said, because the universal
`* { color }` reaches the `<svg>` and its `<use>` -- harmless on an opaque pill, 1.6:1 on glass over
the brightest sky. `ZetPath` showed a placement style's sliders with an inline `display: block`,
which would have undone each slider's row; `Elem.show` takes the inline display off instead, and
`Elem.displayBlock` had no other caller. Three WebKit-iPad tests fail on main as they do here
(07-canvas's zoom anchor, 08-editor's pane handle, 12-connect's right-click list); the suite had
not been run whole on the iPad before.

- [ ] Review, release 1.9.0, close the three issues.

Found on the way: a tab's markup was not in the page when `loadTab` resolved
(`onResponse` dropped the promise from `res.text()`), which nothing noticed while no tab's
markup held another's slot. The console's slot is inside the Ai panel's markup now, so its
loader found no element on 5 of the 15 page loads of one run of 15-panels; `loadTab` waits for
the markup now.

Found in B: the panel's own save of a slider is debounced, so a burst of eight writes kept only
the last -- a theme saves each control itself. A Fractal line takes its colour once, when it is
drawn, and most of them still wore the old palette 3.5 s after a theme was chosen;
`Fractal.recolour` repaints the lines on screen. The page filters lie over the menu too, so each
card's picture undoes them. And the slot inside another tab's markup is loaded in a second round
by `PageLoad.loadTabs`, which keeps `PageLoad.tabs` the one list the tests read.

## Review

- An adversarial review (Codex, read-only) found seven, and two tests that could not fail. Each
  answered, and each new test fails on the code before its fix:
  - a graph kept its theme's colours and not its universe, so Paper came back as Custom with the
    sky on: a graph saves the universe too (`#saved-universe`);
  - a number typed beside a slider set the slider without telling it, so it was neither saved nor
    seen by the theme's mark -- on main too, for every slider the panel saves with a graph:
    `updateValueSlider` sends the slider's `input`;
  - under a partial inversion the pictures were the page's filter applied twice: `invert(p)` is
    `contrast(1 - 2p)`, so it is undone by the contrast that scales back, as far as the band the
    page leaves can show;
  - the recolour traced every line's orbit again, a million steps at 2048 lines, and coloured a
    line kept from another equation as this one's: a line keeps its colour index (`data-colour`)
    and is repainted from it;
  - the segments' radios were placed against the panel, so a Tab onto them scrolled Settings to
    its top: each segment is positioned;
  - Reset left the theme as it was under a row that said "every setting": it puts the theme back
    to Neurite, keeping a look of the reader's own as Custom, and says so;
  - a hue of 360 read as a look of its own: the hue is taken round the wheel.
  - 28-panels let a control past the row's edge pass, and a blank value pass for a slider at 0.
- Full suite after C: Chromium 298 of 299 (1 skipped); as an iPad 256 passed, 40 skipped, and the
  3 that fail on main.
- A second round found nothing.
- Released as 1.9.0 (ec9687a; the asset's digest matches the DMG's SHA-256). desktop/update.e2e.mjs
  had reached Check for updates through the menu's list, where it was a row until #78, so all
  seven of its tests failed against the new app; it opens Settings first now, and passes 7/7.
  The real thing, from GitHub: the scratch 1.8.0 found 1.9.0 by itself in 20 s, downloaded,
  swapped, sealed and reopened as 1.9.0 with its note, its Updates in Settings, and its menu as
  above.
- Found after 1.9.0 shipped, on the real app's Settings: the universal `* { font-size: 16px }`
  held the update button's label, the theme names and a dozen more words at 16px in rows of 12
  and 13. They take their row's size now, 28-panels checks for any word left at 16px (failing on
  1.9.0), and 1.9.1 carries it.
- And one that 1.9.0 and 1.9.1 claimed and did not do: the tool glyphs at #ddd on the glass. The
  fix set `color: inherit` on the `<svg>` and its `<use>`, and 28-panels read the `<svg>`'s
  computed colour, #ddd -- while a screenshot of the glyph read 157, the universal rule's #9d9d9d,
  because that rule matches the paths cloned into each `<use>` (the trap the card chip met in #77).
  The tool symbols stroke with `--icon-stroke` now, set by each tool for its rest, hover and lit
  states; 28-panels measures the glyph's brightest pixel, 221 now and 157 on 1.9.1. 1.9.2 carries
  it.

# AI always on, and Settings as a modal (#81, #82, 2026-10-11)

Asked, in chat: "no need for ai toggle anymore, should be on always"; then "move notes and ai to
settings as well, and when click settings bring up a modal, research how notion does settings, i
want the same experience, then release 1.9.3". Tier T3, brownfield. Filed as #81 and #82.

## Phase D: AI always on (#81, 4ff23c1)

- The switch in the tool pill, `AiFeatures`, the `ai-disabled` class on `body` and the rule that
  hid every AI surface behind it are gone, and so is every check of the flag: Alt+double-click
  and the right-click menu always offer an AI node, and Connect Notes and Propose Edges always
  ask the embeddings model. A stale `aiFeaturesEnabled=false` in a reader's storage is ignored.
- Propose Edges said "Similar wording is off with the AI features" when the model gave no
  vectors; it says the model gave nothing back now.

## Phase E: Settings as a modal (#82)

What Notion's settings are, read from the screenshots in Notion's help pages and its 2026
release notes (dark mode is not shown anywhere; the sizes are taken, the colours are Neurite's):
- one dialog over a page dimmed to about 60%, 1150 x 715 at most and about 40px clear of the
  window's edges in a smaller one, its corners about 12px;
- a 240px sidebar in its own shade, grey 12px group headings, items 28px tall every 30px with an
  18-20px outline icon and a 14px label, the chosen one a grey fill with no accent;
- the page beside it 60px in and 36px down, its title over a 1px rule, rows of a label with a
  grey line under it and the control at the right;
- a close button at the dialog's top right. Esc and a click outside are not documented;
- a search field at the top of the sidebar (left out here: seven pages need none yet);
- on a phone, no dialog: Settings is a screen of its own;
- Notion calls each entry a tab. Here they are pages, because CONTEXT.md keeps "tab" and
  "pane" for the Zettelkasten's Panes.

Decisions:
- The menu keeps its commands and Help. Its Settings row opens the modal
  (`aria-haspopup="dialog"`, no chevron) and closes the menu as it does.
- The pages: Writing (Notes, Ai), View (Theme, Saved views, Fractal), General (Editing, Data,
  and Updates in the Mac app only). Not "Workspace" or "Appearance", which CONTEXT.md keeps from
  naming the Graph and the Theme. Notes and Ai are the old panels' markup whole; the others show
  the sections of Settings that name them with `data-page`. A page of one section hides that
  section's heading, as the title above says it.
- Not a native `<dialog>`: `showModal()` draws in the top layer, so `#customModal`, which the
  controls inside open (Adjust…, every confirm), would land behind it, and the page filters that
  Paper and the theme pictures count on would not reach it. A child of `.dropdown` instead, at
  `z-index: 50` in its layer, and everything outside it inert while it is open, except
  `#customModal`. Elements that were inert already, the closed menu among them, are left as
  they were and stay inert when it closes.
- Esc closes it unless a dialog of its own is on top or something inside already took the key;
  focus goes back to what opened it, or to the menu button when that was the menu's row.
- The sidebar is one Tab stop (roving `tabIndex`), and the arrows move through it and choose.
- It opens on the page it was left on (`localStorage`), and on Updates while an update is ready,
  which also puts a dot on Updates in the sidebar.
- The notes editor fills its page, so its two drag handles, the code that sized the menu by
  them, and the bar-height tracker that kept the handle on screen are gone.
- A Cmd- or Ctrl-click on a Title in the notes and a click on a Saved View go somewhere on the
  canvas, which the dialog covers, so they close it first.
- Narrower than 900px the dialog takes the window and the sidebar is a strip across its top:
  under that, a page beside a 240px sidebar was narrower than the menu's panels had been.

Found while doing it:
- The overview and the canvas's hint are `z-index: 0` and come later in `.dropdown`, so they
  drew over the dialog at `auto` (screenshot).
- The notes editor's inline `height: 100%` with a 3px inset border ran it 6px past its box,
  where its bottom edge and its resize grip were cut off; it keeps the border inside its height
  now, and the grip, which nobody could reach, is gone.
- Words that sent a reader to "the Notes panel" or "the Ai panel" -- Help, the delete question,
  two Wolfram alerts, the Custom model alert, the AI's own system prompt and the docs -- name
  the page instead ("Settings → Notes").

## Review

- The first adversarial review (Codex, read-only) found five, each answered with a test that
  fails with its guard taken out (a650e0f):
  - the canvas's keys were guarded by where the focus was, and a Saved Graph restored under
    Settings replaces the notes editor that held it, so the focus fell to `body` and `+` zoomed
    behind the dialog: `Hud.isTyping` answers yes while Settings is open;
  - a Mac trackpad's pinch (Safari's gesture events) zoomed the Graph behind it;
  - a double-click outside it closed it and made a note with the second click;
  - a file let go over it was opened by the browser in place of the app;
  - it was centred in the whole window, so an iPad's keyboard covered its foot -- 20-touch's
    two keyboard tests found that one as well.
- The second found ten (c5bb5bb, 0faa7bb, and the probation fix):
  - a question over Settings left it in reach of Tab and a screen reader: inert under it;
  - Esc dropped a note following the pointer, and Ctrl+Shift+M/F folded the selection;
  - a double-click on the close button made a note, as the backdrop's had;
  - closed after its opener stopped being drawn, the focus went to `body`;
  - two tests passed for the wrong reason (the drop, and a refresh on a path no longer used);
  - and two in the Mac app's updates, from before #81: a page reloaded after an update was
    confirmed (Cmd+R, or the page brought back after a crash) came back on probation and saved
    nothing for the rest of the session, as the window's flag is the same for every load --
    the preload asks the main process now; and a servers-* release would have become the latest
    release and hidden every newer Mac release from the app -- it is made with `--latest=false`.
  - Left as it was: a key held as Settings opens moves the selection until it is let go, as it
    does under any click.
- The third found one: had the marker not been removed, a reload after the confirmation would
  have read it and gone back on probation. The main process remembers the confirmation itself.
  A fourth round was not run: the third found one, in code the second had added.
- Full suite on 8037951: Chromium 308 of 311 and 1 skipped, the two keyboard tests failing; as
  an iPad 263 passed, 44 skipped, those two and the two that fail on main. On a650e0f: Chromium
  311 of 312 (1 skipped), iPad 266 passed, 44 skipped, and the two that fail on main.
- The Mac app, 1.9.3 from its DMG, in a scratch folder: smoke 4/4, updates 8/8, the reload test
  among them (it fails on the code before the fix: `onProbation()` is true again after a reload).

# Every menu and dialog in one style (#83, 2026-10-11)

Asked, in chat, over a screenshot of the "Experimental Ai Settings" window: "those menus are
disgusting, research the menu of popular apps and follow the style, also we should make sure ALL
menu and modal styles are consistent". Tier T3, brownfield. Filed as #83.

What popular apps do, read from shadcn/ui's source (new-york-v4), Radix Themes' base-menu.css and
Apple's HIG (measured), and from memory of Linear, Notion, Raycast and Figma (inferred):
- a menu is a raised panel 4-8px in, with an 8px radius, a hairline edge and a shadow; its rows
  are flat, about 32px, 14px text, with a rounded wash for the hover inside the panel and the text
  unchanged; a check sits in a left column; small grey group labels; 1px separators; shortcuts
  grey at the right; a destructive item red with a red wash;
- a dialog is about 512px wide, 24px in, 10-12px corners, a 16-18px semibold title, the close X at
  the top right, and its buttons at the foot on the right with the primary one last;
- no app draws options as bevelled buttons. For a list of on/off options in a dialog, Notion and
  Linear use switches, Apple, Figma and Raycast checkboxes. Here: switches, as Settings has them.

What there was, from an inventory of every menu and modal (17 windows in `#customModal`, the
right-click menu and its action list, the select lists, the AI node's panel, the tooltips): two
styles. Settings, its pages and Help had #80's design system, scoped to `.menu-detail`; the
windows, the right-click menu, the action list, a select's list outside Settings and the AI node
had the older rules -- see-through frames with a 2px #333 edge and square bottom corners, title
bars with a 30px shadow, a 32px × that turned black, checkboxes drawn as bevelled chips with a tick,
`border: inset` buttons and fields, a light select list, a right-click menu with corners of 0 and
10px in turn and a pale blue hover under black text.

Decisions:
- One set of tokens: `--dialog-fill`, `--dialog-edge`, `--dialog-radius` (12px, the Settings
  modal's), `--dialog-shadow`; `--menu-fill`, `--menu-edge`, `--menu-radius` (10px), `--menu-pad`
  (6px), `--menu-item-h` (32px, the main menu's rows), `--menu-item-radius` (6px), `--menu-hover`,
  `--menu-shadow`.
- The tool windows keep their place and stay draggable and undimmed (they work beside the Graph),
  on the Settings modal's surface, with a title over a hairline and the Settings close button --
  a real `<button>` now, where it was a `<span>` of `&times;`. Every title is 16px semibold, the
  questions' and Settings' too.
- Every dialog's body is `.menu-detail`, so its buttons, fields, selects and switches are
  Settings'. The AI's options are two groups of switches; Import Text's options are rows of a
  group; the action a dialog is for is the accent at its foot, Cancel before it.
- Lists in dialogs (Search Nodes, Connect, Ollama, the Vector Database, the file tree) have menu
  rows: 32px, rounded, a wash for the hover, no rule between rows; linked is a green wash and the
  tick, a row chosen for a delete the danger's wash.
- The right-click menu, a node's actions and every select's list are one menu; the tooltip is a
  small panel of the same fill and edge, above the dialogs (950) and still under Paper's filter.
- The AI node's panel is on the dialog surface, its six options toggle chips, its selects,
  sliders, button and text box the Settings controls. Its three buttons lose their inline bevel and
  the mouse handlers that wrote their colours; the init takes the old inline style off a card saved
  before, since a Saved Graph is the markup itself.

## Review

- The first adversarial review (Codex, read-only) of 98619fa found four, fixed in e295cf4:
  - the questions' text lost its size to an id selector inside `:is()`, which raised every
    branch's specificity;
  - the file tree's chosen row was no longer marked;
  - the file tree's path was still the old field;
  - a finger's targets were too small under a coarse pointer.
- The second found five, fixed in 16fba71:
  - Escape while Adjust Controls waited for a key bound "Escape" and closed the dialog, and a key
    pressed after its close button was bound;
  - a tool opened from the keyboard left its tooltip up over its dialog;
  - the coarse sizes missed the menu rows, the nav items, the AI node's buttons and the help
    overlay's close;
  - Neurite's folds took no key;
  - the Prompt Library's titles had no `type`, so the field rules missed them.
- The third (with #84's first) found one more here: a key armed in Adjust Controls survived a
  close and a reopen, and a Tab there bound Tab. Fixed in 464c3c3: the handler holds the field it
  was armed for, and reopening draws a new one.
- 30-menus-and-dialogs: eight tests, all failing on main; the last two fail on e295cf4, and the
  reopen case fails on 15d2205.
- Full suite on e295cf4: Chromium 320 of 321 and 1 skipped; as an iPad 275 passed, 44 skipped,
  and the two that fail on main (07-canvas's zoom anchor, 12-connect's right-click list).

# Edges as slim curves between the cards' sides (#84, 2026-10-11)

Asked, in chat: "The connection between two nodes are too disgusting, need to be slimer and more
beautifully connected. Have different colors as well". Tier T3, brownfield. Filed as #84.

What canvas apps do. M means read in source, CSS or first-party docs; I means inferred:
- Obsidian Canvas, read in its installed bundle (app.css, and the canvas code in app.js): a cubic
  curve from the middle of a card's side to the middle of the other's, with control points on each
  side's normal at clamp(d/2, 70, 150) px, and a 7 px straight stub to the border (M). The line is
  2 px at 100%, and 2 px x sqrt(zoom) on screen (M). The arrowhead is a filled triangle 10.4 px long
  and 13 across, with its tip on the border, at the far end only by default (M). Grey by default,
  or one of six preset colours (M). Under the pointer the line is 5.5 px, and its 24 px target is
  tinted by a tenth of its colour (M).
- React Flow (xyflow source): 1 px; a cubic curve whose control points are half the gap out from
  each side, or 0.25 x 25 x sqrt(overlap) where the sides have passed each other (M). It ends on
  a 6 px handle at the side's middle (M). No arrowhead by default (M). Its hit path is 20 px (M).
- tldraw: 2, 3.5, 5 or 10 px, 3.5 by default; a straight line or an arc; open chevron heads (M).
- Excalidraw: 1, 2 or 4 px, 2 by default; sharp, round or elbow; 15-25 px heads (M).
- Kinopio: 5 px round-capped curves, each connection in its own colour (M). Miro: 1 px by
  default, curved, snapped to a side's middle (M). Heptabase and Whimsical publish no numbers.
- tldraw, React Flow, Excalidraw and Kinopio draw in page units, so their widths scale one for
  one with the zoom (I).

What there was: a filled ribbon from one Node's centre to the other's, 1 to 2.5 px at its wider
end, that met each card wherever the line crossed its edge. The arrowhead was half way along the
Edge, with a faint larger copy laid over it, and the hover turned the Edge one light blue. The
colours were already the gradient of the two notes' colours (since 2026-10-09).

Decisions:
- The side's middle, as Obsidian, React Flow and Miro do: Neurite's cards are rectangles, and a
  line that leaves square looks joined. The sides face across where the gap between the cards is
  wider than it is tall, and up and down where it is not.
- React Flow's control points, not Obsidian's clamp. React Flow's depend only on the geometry, so
  the curve keeps its shape at any zoom. Obsidian's 70-150 px is in canvas units, so here it would
  need a zoom factor of its own.
- Worked out in screen px from the boxes the frame has just placed (`Node.screenBox`), and
  converted by the SVG scale read once per frame, before the cards are written.
- Stroked, at a width written in the SVG's units every frame: 1.5 px at x1, with Obsidian's sqrt
  of the zoom, from 1 px to 2; 1.5 px more under the pointer. Not `non-scaling-stroke`, whose
  gradient WebKit paints in its last colour.
- The gradient stays, from the note that names the other to the note it names. It is what tells
  one Edge from the next; Kinopio gives each connection its own colour for the same reason. The
  hover keeps the colours.
- Obsidian's arrowhead in proportion to the line (5.2 widths long, 6.5 across), with its tip on the
  card's border. It is cut down on a card too small on screen for it.
- Left out: Obsidian's 7 px stub (the curve leaves its side square already); a glow under the
  pointer (over the 30 px halo it read as a flat band in one colour); dimming the other Edges on
  hover (inferred, and not asked for).
- A Proposed Edge is dashed along the curve its Edge would take, and a link being drawn is as wide
  as an Edge under the pointer.

## Review

- The first adversarial review (Codex, read-only) of de66822 found three here (464c3c3):
  - a Saved Graph from before 5b25a7d drew its Edges at half the opacity of new ones, because the
    view copied the saved style onto the path; nothing draws that style now, and it is still kept;
  - under a Frames delay the hover waited for the next frame, up to half a second: the width is
    written at once;
  - left as it was: under a Frames delay, a card that changes size between frames keeps its Edge
    on its old side until the next frame, as the card itself is re-centred only then.
- The full suite on de66822 failed one test in both browsers: 18-regions double-clicked the middle
  of a gap between two cards, where an Edge to another Region now crosses (a probe read
  `edge-halo` there), and a double-click on an Edge is the Edge's. The test clicks a fifth of the
  way down the gap.
- The second found one defect, in the first's fix (69571d3). The hover's width came from the live
  zoom against the frame's SVG: 5.1 px where 3 was meant, after a zoom out under held frames. Now
  the frame works out both widths. It also found three tests that could pass without their case:
  31's throttled hover, 18's typing, and 30's tooltip. Each now proves its case. Making 30's
  tooltip check real showed an older trap, left as it was: a pointer resting where a dialog's
  close button was gets a `pointerover` on the page's first change after the dialog goes, and
  that hides the first tooltip a Tab shows.
- The third found one test reading the whole Region's text for the typing (baab73d). No defect in
  the code. Stopped there: the findings went from three to one to none.
- Negative controls:
  - all four of 31's tests fail on the code before de66822;
  - 31's restored Edge (opacity 0.5) and throttled hover fail on 15d2205;
  - 31's held-frames hover fails on 464c3c3 (5.12 px);
  - 30's reopened key binding fails on 15d2205, and its tooltip check fails with
    `HoverTooltip.hide()` taken out of `Modal.open`.
- Full suite on 464c3c3: Chromium 326 of 327 and 1 skipped. Its iPad run was spoilt: a control
  script removed and rebuilt the snapshot it ran from, which now has a name of its own.
- Full suite on 69571d3: Chromium 326 of 327 and 1 skipped; as an iPad 281 passed, 44 skipped,
  and the two that fail on main (07-canvas's zoom anchor, 12-connect's right-click list).

# A collapsed note's circle resized by the wheel again (2026-10-12)

Asked, in chat: "i want to be able to adjust the collapsed text node circle size by a shortcut,
previously i believe if i hold option or control key then scroll, the circle becomes larger or
small, but that feature is lost, get it back, also i want the text to be shrinking or expanding
accordingly as well based on the size of circle". Tier T2, brownfield.

What there is, measured in Chromium over a collapsed note (60 px circle, "Alpha" in 25 px type):
- Shift + a vertical wheel resizes it: `node.scale` 1 to 1.221 for one notch up, and the
  circle (62 to 76 px) and its title (62 x 29 to 76 x 35 px) grow by the same factor, since
  both are drawn under the card's one `scale()` transform. Shift + scroll is the documented
  gesture (Help, controls.md), and the one the code has had since upstream.
- Shift + a horizontal wheel does nothing. macOS sends Shift and a mouse wheel as a scroll
  across: `deltaX`, with `deltaY` 0. The card read the legacy `wheelDelta` until ed5b1a0
  (2026-08-30), and in Chromium a horizontal wheel carries `wheelDelta` 120, the X axis's. Since
  then it reads `deltaY`, which is 0 there. On a Mac with a mouse, the shortcut was lost then.
- Alt (Option), Control and Command + scroll over the circle zoom the canvas, as a plain scroll does.

Plan:
- [x] The card's resize reads `deltaY`, or `deltaX` where there is none (`Node.wheelTurn`; a
      name with `wheelDelta` in it trips the test that keeps the legacy property out), and so
      does Shift + scroll on an Edge.
- [x] Alt (Option) + scroll over a card resizes it too, the circle included: Alt is how a
      gesture reaches a Node through its text already, and on a Mac Option is not turned
      sideways. Not Control: a Mac trackpad's pinch arrives as Control + wheel, and over a card
      it must stay the canvas's zoom. Over the Plane, Alt + scroll still turns the view.
- [x] The resize keeps the wheel from also scrolling a note's text under it.
- [x] An AI note's response lets the resize through, as it does for Shift (probed: Alt and
      Shift 1 to 1.221 over it, a plain scroll leaves it at 1).
- [x] The text: nothing to add. The title is under the same transform as the circle, so it
      grows and shrinks with it (measured above). Pinned by the spec.
- [x] Help and controls.md say Shift or Alt.
- [x] Spec (32-collapsed-circle): Shift (vertical and horizontal), Alt, and the gestures that must not resize
      (plain, Control), over a collapsed circle, with its title's size; Alt over the Plane
      still turns it; Shift + horizontal wheel lengthens an Edge. The unit test for the zoom
      signs reads the new expression.

## Linking collapsed notes without opening them

Asked, in chat, while the above was under way: "when i link two nodes together and use shift key,
when i click the second circle text it always expand the text node becaues the expand action
happens to be in center of circle, figure out if there's better itneraction nto to accientally
trigger this".

Measured in Chromium, on a collapsed note with a two-line title: the expand button ran from 12 to
36 px under the circle's middle, over the last 8 px of the title. It showed under any hover,
Shift's included. A Shift + click there finished the link on the release
(`Node.stopFollowingMouse`), then the click reached the button and opened the note. A drag that
began on the button opened the note where it was let go.

What canvas and outline apps do with a node's collapse toggle (from memory): XMind, MindNode and
Miro's mind maps put it on the node's edge, where its branches leave. Outliners put it beside the
title as a disclosure triangle. None puts it on the label.

Decisions:
- [x] The button sits under the circle's lower rim, clear of the title. It overlaps the circle by
      4 px, because crossing a gap would end the circle's hover, and the button shows only under it.
- [x] While the connect mode is on (Shift, or the Connect tool), it is gone. Every click on the
      circle links it.
- [x] A click on it opens the note only when it is a plain click. A press that links (the connect
      mode, or an armed link) or selects (Mod) belongs to the note, and so does a drag. The keyboard
      still opens it (Enter or Space on the focused button).
- [x] Found on the way: a note collapsed in the frame it was made got its link strip drawn after,
      shown, and its circle pushed 45 px out of its card. The strip is hidden there now.

## Review

- The first adversarial review (Codex, read-only) of 4b4259c and c008986 found five, fixed in
  e1f24d5:
  - with Alt's key moved to Control, a pinch resized the card under it;
  - Alt + scroll during a flight to coordinates threw (`referenceFrame` is null there);
  - a link strip saved shown in a collapsed card stayed shown after a restore;
  - the expand button's verdict on a press outlived the press;
  - a title of three or more lines still reached the button. It now grows up from three
    quarters of the way down the circle.
- Found while pinning those, and older than the branch: a reload put every collapsed card's
  window buttons back on show (`refreshControlIcons` swapped in an unhidden copy). Their 30 px
  pushed the circle out of its card, so that its middle was where the expand button sat, which
  is the spot the request named.
- The second found three, fixed in f5d7cd6. Two of them were measured on 3888110 as well:
  - a rename in the Notes text left a collapsed circle's old title;
  - a restored collapsed card asked to fit its title on every frame (94 times a second for two);
  - a press whose release was lost to another window kept its verdict and added a listener.
- Negative controls, each on the commit before its fix:
  - 32's resize tests fail on 3888110 ("1 is not 1.2214");
  - its linking tests fail on 4b4259c;
  - its first-review tests fail on c008986;
  - its rename and fitter tests fail on e1f24d5.
- Full suite on c008986: Chromium 333 of 334 and 1 skipped; as an iPad 283 passed, 49 skipped, and
  the two that fail on main. On e1f24d5: Chromium 335 of 336 and 1 skipped. On 931ce9e, the code
  released as 1.9.5: Chromium 337 of 338 and 1 skipped; as an iPad 287 passed, 49 skipped, and the
  two that fail on main. The Mac app from its DMG: smoke 4/4, updates 8/8.

# The connect effect (#87, 2026-10-13)

Asked, in chat, over a screen recording of a node editor (Limns, on Xiaohongshu): "I want this
effect when connecting nodes". Tier T3, brownfield.

What the recording shows, read frame by frame at 4 and 10 frames a second:
- A white wire is dragged from an output port. Near a target port, the port gets a glowing ring,
  and an electric arc in the connection's colour jumps from the wire's end to the port. The arc is
  jagged, with a fainter second bolt, and changes shape on every frame.
- On release, the wire turns that colour and a bright streak lights the node's edge at the port. A
  ring ripples out from the port and fades, and a comet of light runs up the node's side and
  across its top, in about half a second.
- Each connection has its own colour.

Decisions:
- [x] A layer of its own, `#linkFx`, above the cards (DOM order), taking no pointer, in screen px.
      The Edge layer is under the cards, so it could not show an arc that crosses one. Sized in
      viewport units, because the body carries a transform, so a fixed box sits on the 0 px body.
- [x] Drawn with the frame, from the frame's boxes (`Node.screenBox`), with no `elementFromPoint`,
      which would lay the page out again after the frame's writes. Hidden when idle.
- [x] The wire is white, as in the recording, and leaves the armed card from the side facing the
      pointer, as the Edge will.
- [x] The arc, the ring, the ripple, the comet and the flash are in the colour of the note the link
      starts from. The Edge then settles into its gradient of the two notes' colours, so each link
      arrives in its own colour.
- [x] Played by the two gestures that make a link: the click on a second note, and the link
      picker. `connectNodes` is also the AI's (memory notes, child notes), and those stay quiet.
- [x] Under reduced motion: a straight arc, no ripple, no comet; the flash only fades.

## Review

- The first adversarial review (Codex, read-only) of 910d5c6 and 07b1a93 found five, fixed in
  b4984bc:
  - under a Frames delay the effect had a pose every 30 frames, so a burst could end undrawn;
    it is drawn on skipped frames now;
  - over overlapping cards the ring went to the one underneath (`Graph.nodes` runs in uuid order;
    the card on top is the one later in the page);
  - the arc had no cap on its jags, and froze the page on a card scaled thousands of times;
  - linking two notes linked already played the burst;
  - the comet's corners were 6 px whatever the card's.
- The second found one, in the first's fix (096be45): a note opened during its burst kept the
  corner it had as a circle (`50%`, read as 50 px).
- The third found none. Stopped: five, then one, then none.
- Negative controls: all six of 33's first tests fail on bfd1d91, which has no layer. The five
  first-review tests fail on 07b1a93 (the ring "(1061, 519) is not (974, 500)", "the arc has 106
  points"), and the second's on b4984bc ("50 px, the opened card's 5").
- Seen in a browser first: screenshots, a recorded video read at 6 and 12 frames a second beside
  the reference, the comet's head tracked along the card's edge, and the burst in WebKit as an
  iPad after two taps with Connect on.
- Full suite on 07b1a93: Chromium 343 of 344 and 1 skipped; as an iPad 288 passed, 54 skipped, and
  the two that fail on main. On b4984bc: Chromium 348 of 349 and 1 skipped; as an iPad 288 passed,
  59 skipped, and the same two. On ed1a5a2, the code released as 1.9.6: Chromium 349 of 350 and 1
  skipped; as an iPad 288 passed, 60 skipped, and the same two. The Mac app from its DMG: smoke 4/4,
  updates 8/8.

# A link mark on a collapsed note (#88, 2026-10-13)

Asked, in chat: "for the text nodes, i also want to add a small symbol or icon to the collapsed
node if there are hyperlinks in the content, e.g. if i put a github link in there i want to make
it visible that this node has links". Tier T2, brownfield.

Measured on 1.9.6: a collapsed note is its 62 px circle and its title, and nothing else. The
title's last line ends 43 px down the circle, and the expand button shows under the middle of the
lower rim on hover.

Decisions:
- [ ] A link is what GitHub's Markdown links by itself: an address that starts with `http://`,
      `https://` or `www.`, anywhere in the note's text. A bare `github.com/...` is not, as a
      file name before a slash would pass for one.
- [ ] The mark is the toolbar's Link node glyph (`#link-icon-symbol`) cut out of a disc in the
      Node's colour, on the circle's lower-right rim: clear of the title and the expand button.
      Mocked four ways on real circles; a dark glyph reads at 5.7:1 or better on all seven
      palette colours, a white one under 3:1 on every one.
- [ ] In the circle, so it is drawn and hidden with it and scales with the card. It takes no
      pointer: dragging, linking and opening the circle stay as they are.
- [ ] Kept in step from the frame (`Node.step`), as the collapsed title is: the text has writers
      that send no event (an AI's reply, a Saved Graph's restore). There while the text holds a
      link and absent otherwise, so a Saved Graph keeps no state of it that the text does not.
