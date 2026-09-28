# iPad spike: the evidence that does not need an iPad

Context for [#6 — *Spike: what actually breaks on a real iPad?*](https://github.com/PXMYH/Neurite/issues/6),
a `wayfinder:prototype` ticket under the map [#1 — *Neurite on iPad (read + light capture)*](https://github.com/PXMYH/Neurite/issues/1).
It blocks [#8 — *What replaces the mouse-only interactions?*](https://github.com/PXMYH/Neurite/issues/8).

The ticket asks for six observations from a real device. Roughly half of each one is already
determined by the source, and reading it first means the device session records symptoms instead of
re-deriving mechanisms. Everything below is either quoted from `main` or produced by a check that is
reproducible here. Nothing in this file is a fix, and nothing in it substitutes for the device.

## Since v1.5.0: what the WebKit engine says, and what only the iPad can

Most of what follows this section was written before the touch work landed, and describes the code
as it was then. It is kept as the record of why each change was made. This section is the current
state.

It was measured with Playwright's WebKit at the iPad's sizes: 820×1180 portrait and 1180×820
landscape, with an iPad user agent, touch and a coarse pointer. **This is WebKit the engine, not an
iPad.** It has no multi-touch, no on-screen keyboard, no Home Screen and no iCloud Drive, so every
check below that needs one of those is marked as a device check.

**What the engine reported:**

- **Pickers.** `showSaveFilePicker`, `showOpenFilePicker` and `showDirectoryPicker` are all
  undefined. Save to… is therefore a download in a Safari tab, and the share sheet in the installed
  app.
- **APIs present.** `navigator.share`, `navigator.canShare`, `serviceWorker`, `visualViewport`,
  `PointerEvent`, `TouchEvent` and `GestureEvent` all exist. `touch-action: none` and `100dvh` are
  supported.
- **Storage.** `navigator.storage.persisted()` answers `false`, and the quota is 1049 MB.
- **Media queries.** `(pointer: coarse)` and `(hover: none)` both match, and the display mode is
  `browser`.
- **CodeMirror.** It picks `inputStyle: contenteditable` for the Pane under the iPad user agent.
- **Layout.** Nothing on screen is wider than the window, in either orientation.
- **Tap targets under 28 px on screen.**
  - The card header's three buttons, at 20×20 px.
  - A link chip's label, its ×, and **+ link**. Each is 13–14 px tall as drawn, but a coarse
    pointer gets a 44 px target for each.
  - The resize grip. It is 23 px on screen at a card's default scale, drawn from 29 CSS px.

**What is now verified in the engine, with the test that keeps it true:**

- **One pinch.** Its math: `test/pinch-math.test.js`. Its wiring: drive scripts in #55, with real
  touches in Chromium and synthetic pointers in WebKit.
- **By touch** (`test-e2e/specs/20-touch.e2e.mjs`):
  - a header drag;
  - a tap that focuses the Title and moves nothing;
  - a drag that starts on a header button and moves nothing;
  - a grip resize;
  - no tooltip on a tap;
  - Titles typed as spelled.
- **Edges by touch** (same file): the Connect tool and two taps, and **+ link** and ×.
- **Placing a note** (same file): the Note tool and a tap put the note where the tap was. On a
  card, the note is moved clear of it and takes the caret, rather than the card underneath.
- **Every finger on the map** (same file). The cards are part of the map for touch, as the Fractal is:
  - a pinch with one finger or both on a card, or one on a header, zooms about the fingers;
  - one finger on a card's body pans the map, and a tap on it still puts the caret there;
  - one finger on a long note's text scrolls it, with a fling, and pans the map sideways or past the
    text's end;
  - a finger whose lift never arrived is dropped when the next gesture begins;
  - a card past the window's edge no longer makes the page wider than the window;
  - a turned view shows **Upright**, which straightens it in place;
  - the overview scrubs under a finger;
  - the first screen gives touch instructions under a coarse pointer.
- **The keyboard** (same file): the Pane, the menu and the dialogs stay above it, with the keyboard
  simulated as `visualViewport` reports it. A card typed into is moved above the keys. When the
  keyboard leaves little room, as in landscape, the Archive controls give their room to the Pane.
- **Save and Open** (`test-e2e/specs/21-durability.e2e.mjs`):
  - a round trip of one Node of every type, through a reload and through a file;
  - the Save row's note;
  - the share sheet when installed;
  - an older copy asked about;
  - an old text save opening.
- **Offline boot.** The build is served under `/Neurite/`, the server is killed, and a reload still
  boots from the service worker (#9).

**Device checks:** run each on the iPad, record what happens, and say which iPadOS version.

1. **Pinch.** Two fingers on the fractal: the zoom follows the fingers, a clear twist turns the view, and the page
   itself never zooms. Then pinch with a finger on a card, and with both on one: the map zooms the
   same way. Over the Pane, nothing zooms. After a twist, **Upright** straightens the view in place.
2. **One finger on a note.** On a short note it pans the map. On a long note it scrolls the text,
   and a flick carries on after the lift. A long press on the text still selects it. A short pan
   followed at once by a tap: the tap still puts the caret where it lands.
3. **Header.** A finger on a card's header drags the card. A tap on the Title opens the keyboard. A
   long press on the Title selects text rather than starting a drag.
4. **Small targets.** The grip resizes under a finger. Say whether the three 20 px header buttons can
   be hit without missing.
5. **Tools.** Each tool in the bar acts on the first tap, not on a second one. New note and a tap on
   a card: the keyboard comes up for the new note, not for the card under it.
6. **Keyboard.** Type at the end of a long note in the Pane. The caret stays above the keys, the
   Pane shrinks while the keyboard is up, and it comes back when the keyboard goes. In landscape the
   Archive controls step aside while the Pane is typed into. Tap the Title of a card low on the
   screen: the card comes up above the keys.
7. **CodeMirror.** Typing, selection handles, autocorrect staying off, and dictation into the Pane,
   all on CodeMirror's `contenteditable` input.
8. **Install.** Add to Home Screen from https://pxmyh.github.io/Neurite/. The app opens offline after
   one online visit. Record `navigator.storage.persisted()` in the installed app, and whether clearing
   Safari's website data takes the installed app's Graph with it.
9. **Save and Open.** In the installed app, Save to… opens the share sheet. Save to Files puts the
   file in iCloud Drive, and Open… on the Mac reads it back.
10. **Double tap.** A double tap on a card toggles its pin. This checks whether WebKit sends the
    `dblclick`.
11. **Apple Pencil.** The Pencil drags a card by its header, and pans the map from the fractal or
    from a note's body.
12. **Long press.** Say whether iPadOS sends `contextmenu`, which is the route to the Node and Edge
    menus.
13. **Frame rate.** Read the FPS during a pan and during a pinch at the default settings. It is shown
    in the Fractal panel.

## The ticket's premise has moved since it was written

| The ticket says | What `main` holds today |
| --- | --- |
| "add the `<meta name="viewport">` the page currently lacks" | It is already there — `index.html:12`, from commit `50608e0` *feat: lay out at device width on touch screens*. |
| (nothing about installing) | Home Screen install landed in `1446601`: `public/manifest.webmanifest`, `display: standalone`, three icons, and the `apple-mobile-web-app-*` tags at `index.html:21-27`. |
| "the 149 fixed-px dimensions in `styles.css`" | 153 now. |

**So there is no throwaway branch to make.** Run `main`. The revised instruction is: run `npm run
start:host`, open `http://<mac-lan-ip>:8999` in iPad Safari, and record. Add to Home Screen and repeat
the passes that concern storage or chrome, because the two contexts differ (see *Two contexts, not one*).

There is no service worker anywhere in the tree, so an installed instance still needs the Mac to be
serving. Install changes the storage-eviction clock and the window chrome, not the offline story.

## Answered from the source

### Touch is wired to the fractal background, and to nothing else

| Handler | Site | Target | Effect |
| --- | --- | --- | --- |
| `touchstart` / `touchend` / `touchcancel` | `js/interface/interface.js:345,354,360` | `svg` = `#svg_bg` (`js/mandelbrot/mandelbrot.js:2`) | Bookkeeping in a `touches` Map. |
| `touchmove`, 1 touch | `js/interface/interface.js:376-385` | `#svg_bg` | Pans by the finger delta. |
| `touchmove`, 2 touches | `js/interface/interface.js:387-417` | `#svg_bg` | Incremental zoom **and** rotation about the midpoint. |
| `gesturestart` / `gesturechange` / `gestureend` | `js/interface/interface.js:434,444,469` | `window` | Absolute zoom **and** rotation from the gesture's start baseline. |

Two consequences follow from the targets alone:

- The touch path is on `#svg_bg`, so it only fires for a finger that lands on the background. A finger
  that lands on a Node window, a panel or a Pane never reaches it.
- The gesture path is on `window`, so a two-finger pinch **anywhere** — over a Node, over a Pane's
  text, over the settings column — drives the fractal's zoom and rotation.

### Both pinch paths run, and the absolute one discards the incremental one

`On.touchstart` and `On.touchmove` are re-bound as passive listeners after the generic binding
(`js/main.js:107-109`), and `On.thisPassiveEvent(target, cb)` (`js/main.js:89-91`) takes two parameters
and hardcodes `{passive: true}`. The `false` passed as a third argument at `interface.js:345` and
`:366` is therefore dropped, and the `e.preventDefault()` at `interface.js:414` — inside the
two-finger branch — cannot take effect.

Confirmed by running the `On`/`Off` block from `js/main.js` in a `node:vm` context against a recording
`addEventListener`:

```
["touchmove","CB",{"passive":true}]     <- 3rd arg dropped, listener is passive
["touchstart","CB",{"passive":true}]    <- same
["touchend","CB",false]                 <- control: not rewritten, keeps its argument
["gesturestart","CB",null]              <- control: not rewritten
```

`gesturechange` is not in the passive list, so *its* `preventDefault` does work. The net prediction for
a two-finger pinch on the background: `touchmove` case 2 applies an incremental zoom+rotation, and
`gesturechange` then applies an absolute `pan_set`/`zoom_set` computed from `gestureStartParams`
(`interface.js:451-452`), which overwrites the increment whenever it lands last in the frame. The
symptom to look for is a pinch that snaps back or fights itself rather than tracking the fingers.

That is the mechanism behind [#55 — *which of the two pinch paths wins*](https://github.com/PXMYH/Neurite/issues/55).
The source's answer is "neither exclusively"; the device says which one is visible.

One more asymmetry: only the gesture path feeds the fractal's regeneration budget
(`regenAmount += ...` at `interface.js:459`). The `touchmove` pinch adds nothing, so a pinch that is
served only by `touchmove` moves the view without redrawing the fractal at the new scale.

### A Node window has no touch code at all

`js/nodes/createnodes/window.js` registers 16 mouse handlers and zero touch handlers. The two that
matter for the ticket's "can a node be opened, read and scrolled":

- drag — `On.mousedown(this.headerContainer, ...)` in `NodeView.init`, `window.js:84`
- resize — `On.mousedown(this.resizeHandle, ...)` in `NodeView.setResizeEventListeners`, `window.js:607`,
  with `mousemove`/`mouseup` bound on `document` at `:618-619`

Cited by method as well as by line, because this file moves: the two line numbers above were 83 and
581 when this file was written four commits earlier.

iPad Safari synthesises a `mousedown`/`mousemove`/`mouseup` sequence for some single-finger
interactions and not others, and that boundary is exactly what the device pass has to establish. Record
per gesture, not per element: a tap, a slow drag from the header, a drag from the resize handle, and a
one-finger drag starting inside a textarea.

Same shape elsewhere: `ainode.js` 10 mouse handlers, `notestab.js` 6, `nodeclass.js` 5.

### The stylesheet has no responsive layer

`resources/styles/styles.css` is 4808 lines and holds **one** `@media` query — `prefers-reduced-motion`
at line 336. There is no width breakpoint, no `pointer: coarse` query, no `hover: none` query anywhere
in the repo. Three more root-level facts worth holding while looking at a screenshot:

- `body { width: 100vw; height: 0; position: absolute }` (`:69-75`) — the layout is absolute
  positioning throughout, so nothing reflows on its own at a narrower width.
- `* { font-size: 16px }` (`:77-81`) — universal, which incidentally means iOS will not zoom-on-focus
  for a text field (it does that below 16px).
- `overscroll-behavior-x: none` on `html, body` (`:65-67`) is set on **x only**, so vertical rubber-band
  is live. `touch-action` appears nowhere in the repo, so the browser keeps default gesture handling on
  every element the app did not explicitly claim.
- `100vh` at `:89`, `:795`, `:2451` versus `100dvh` at `:1083`, `:1209`. Mixed, so two full-height
  surfaces will disagree about whether the Safari toolbar counts.

### The fixed-px offenders, largest first

153 declarations match `(min-|max-)?(width|height): <n>px` — 73 `width`, 61 `height`, 9 `max-height`,
8 `min-width`, 4 `min-height`, 2 `max-width`. An iPad's portrait CSS width is roughly 744–1024,
so a single 500px surface is over half of it on a mini. Everything at 180px and up:

| Value | Property | Selector | Line |
| --- | --- | --- | --- |
| 550px | height | `.ainodewrapperDiv` | 3254 |
| 500px | width | `.ainodewrapperDiv` | 3255 |
| 500px | width | `.importLinkTextarea` | 967 |
| 500px | max-height | `#howto` | 2430 |
| 400px | max-width | `.prompt-modal-content, .alert-modal-content, .confirm-modal-content` | 4628 |
| 400px | max-height | `.fileTreeContainer` | 4428 |
| 370px / 350px | height / width | `.vector-db-search-results` | 1436, 1435 |
| 350px | height | `.prompt-library-container` | 3385 |
| 320px / 284px | max-height / width | `.editor-wrapper` | 400, 397 |
| 300px | height + max-height | `.function-call-container .neurite-function-cm-style` | 3880-3881 |
| 300px | max-height | `.options-replacer` | 2250 |
| 300px | width + height | `#chunkedTextDisplay` | 1632-1633 |
| 300px | width + height | `textarea#rawTextArea` | 1618-1619 |
| 300px | height | `#key-list` | 1494 |
| 290px | min-width | `.tabcontent` | 2019 |
| 280px | width | `.nodeFileTreeContainer` | 4484 |
| 270px | width + min-width | `.zet-pane-container` | 2091-2093 |
| 270px | width | `.checkboxarray` | 1910 |
| 266px | min-width | `.CodeMirror` | 2825 |
| 265px | min/max-width | `#key-list` | 1492-1493 |
| 261px | width | `.extract-textarea` | 2459 |
| 259px | width | `.node-textarea` | 355 |
| 256px | width | `.settingsSlider.centered` | 3318 |
| 250px | width | `#nodeList` | 974 |

The stacked ones are what to photograph: `.tabcontent`'s 290px `min-width` plus
`.zet-pane-container`'s 270px plus `.CodeMirror`'s 266px `min-width` are all in the same column, and
[#32](https://github.com/PXMYH/Neurite/issues/32) already measured that column as 290px of controls
against 1310px of idle canvas on a desktop. On an 810px-wide portrait iPad the ratio inverts.

### CodeMirror 5 will take its iOS `contenteditable` path

`index.html` pulls CodeMirror from the floating tag `codemirror@5`, which resolves to **5.65.21**
today. Inside that build:

```js
var ios = safari && (/Mobile\/\w+/.test(userAgent) || navigator.maxTouchPoints > 2)
var mobile = ios || android || /webOS|.../i.test(userAgent)
// option default:  inputStyle: mobile ? "contenteditable" : "textarea"
```

iPadOS Safari sends a desktop `Macintosh` user agent, so the `/Mobile\//` test fails — but
`maxTouchPoints` is 5, so `ios` is still true. `ZetPanes.createPane`
(`js/interface/dropdown/tabs/notestab.js:191-197`) passes no `inputStyle`, so a Pane on the iPad runs
`ContentEditableInput`, not `TextareaInput`. That is the path where CM5's caret, selection and
scroll-into-view behaviour differs from the desktop, and `inputStyle` cannot be changed on a running
editor, so it is the path the spike is stuck with.

Two adjacent facts for the same pass:

- The Pane's own height clamp is `window.innerHeight * 0.7`, recomputed on `On.resize(window, ...)`
  (`notestab.js:46-50`). iOS does not resize the layout viewport for the on-screen keyboard — it
  changes `visualViewport` — and nothing in the repo reads `visualViewport`. So the clamp keeps the
  full-height value while the keyboard covers the bottom 40% of it. Expect the caret to end up under
  the keyboard.
- `htmlmixed` is pinned to `codemirror/5.62.3` on cdnjs while the core floats at 5.65.21
  (`index.html`, one CDN line apart). If highlighting inside an HTML text node misbehaves, that skew
  is the first suspect, on any platform. The placeholder add-on used to be the worse case — 5.0.0
  against the same core — but the editor's placeholder is gone and the add-on went with it.

### Frame rate is already on screen — no Web Inspector needed for it

`NodeSimulation.updateFPS` writes the smoothed rate to two places (`nodestep.js:118-119`):
`#debug_layer`, which is `display: none` (`resources/html/viewmatrix.html:25`), and `#fps` in the
**Fractal tab** (`resources/html/tabs/fractaltab.html:39`). Open that tab and the number is readable
from the device itself.

The stall mechanism to watch it against is `updateRegen` (`nodestep.js:137-146`): `regenDebt`
accumulates from pan/zoom distance and is capped at 16, and the loop then calls
`Fractal.render_hair(random() * settings.renderSteps)` **up to 16 times synchronously inside one
`requestAnimationFrame` callback**. Defaults in `js/globals.js`: `maxLines: 128`, `renderSteps: 16`,
`renderQuality: 16`, `regenDebtAdjustmentFactor: 1`, `framesDelay: 0`.

So there are two knobs already exposed for the "does regeneration stall panning" question — the
`regenDebt` slider in the Edit tab (`edittab.js:91-99`) and `settings.framesDelay`, which skips frames
via `(delay + 2) ** 2 / 4` (`nodestep.js:154-155`). Record the FPS at the defaults first, then with
each knob moved, so the answer distinguishes "the fractal is too expensive" from "the device is too
slow".

## Two contexts, not one

Anything about storage or chrome has to be recorded twice, because Safari and an installed Home Screen
app differ on both:

| | iPad Safari tab | Home Screen (standalone) |
| --- | --- | --- |
| Chrome | Safari toolbars; `100vh` ≠ visible height | none; `manifest.webmanifest` `display: standalone` |
| Status bar | Safari's | app's, `black` per `index.html:25`, and nothing pads the safe area yet |
| Storage clock | 7-day idle eviction applies | separate clock — the reason install matters ([#4](https://github.com/PXMYH/Neurite/issues/4), [#59](https://github.com/PXMYH/Neurite/issues/59)) |

## Three addresses, and only one of them is a secure context

`vite.config.js:37` already sets `allowedHosts: ['.local', '.ts.net']`, so the dev server accepts all
three of these. They are not interchangeable:

| Address | Secure context | Use it for |
| --- | --- | --- |
| `http://192.168.1.241:8999` | no | quickest; breaks on a DHCP lease change (re-check with `ipconfig getifaddr en0`) |
| `http://Mac-mini.local:8999` | no | survives a lease change |
| `https://mac-mini.tail72b549.ts.net` via `tailscale serve` | **yes** | anything touching `navigator.storage`, which is simply absent without HTTPS |

Passes 2–6 are fine over plain HTTP. Anything about storage durability or Home Screen install is worth
doing over the Tailscale name, or the missing API will read as a bug in the app.

## Capture protocol — what still needs the device

Six passes, in this order. Record the raw observation, not a diagnosis.

1. **Baseline.** `npm run start:host` on the Mac, then one of the three addresses below on the iPad.
   Record the device model and the iPadOS version first — every number below is meaningless without
   them, and `tsconfig.json` sets `target: ES2022`, so anything older than Safari 16 is a different
   question entirely. Screenshot both orientations. Note `window.innerWidth/Height` — the Fractal tab
   shows FPS but not size, so this one needs Web Inspector, or read it off a screenshot ruler.
2. **Fractal pan and pinch.** One finger on the background: does it pan? Two fingers: does the view
   zoom smoothly, snap, double-apply, or rotate when rotation was not wanted? Then pinch with two
   fingers **starting on a Node** and again **starting inside a Pane** — the gesture path is on
   `window`, so predict that both still zoom the fractal. Confirm or refute.
3. **Node lifecycle.** Can a Node be opened, read, scrolled? Try in this order: tap the header, slow
   drag from the header, drag the resize handle, one-finger drag starting inside the body text. Note
   which of the four produce nothing at all.
4. **Pane and keyboard.** Type into the notes Pane. Does the caret stay visible when the keyboard
   opens? Does the Pane scroll? Does selection work with a long press? Screenshot with the keyboard up.
5. **Frame rate.** Fractal tab open, FPS readout visible. Record: idle, during a one-finger pan, during
   a pinch, then repeat with the `regenDebt` slider at minimum and with `framesDelay` raised.
6. **Layout offenders.** Photograph each stacked surface from the table above in portrait: the settings
   column, a Pane, an AI Node, a modal. Note which are clipped, which overflow off-screen, and which
   are merely cramped — those are three different fixes.

Then install to the Home Screen and repeat 1, 4 and 6.

## What this file does not tell you

- Whether a synthesised mouse event reaches a Node. It is the single most load-bearing unknown for
  [#8](https://github.com/PXMYH/Neurite/issues/8) and only the device can answer it.
- Which of the two pinch paths is visibly winning. The source says the absolute one should, on frame
  order, but frame order is a WebKit detail.
- Anything about the AI layer, the proxy or the embeddings worker — those are
  [#2](https://github.com/PXMYH/Neurite/issues/2), [#3](https://github.com/PXMYH/Neurite/issues/3) and
  [#5](https://github.com/PXMYH/Neurite/issues/5), all closed already.
- Whether a Graph survives — that is [#59](https://github.com/PXMYH/Neurite/issues/59).
