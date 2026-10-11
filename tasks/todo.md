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
