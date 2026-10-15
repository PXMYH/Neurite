# ExcalidrawZ, read with REA

[← Back to the docs](README.md)

ExcalidrawZ (`com.chocoford.excalidraw`, MIT, [chocoford/ExcalidrawZ](https://github.com/chocoford/ExcalidrawZ))
is the native Mac app for Excalidraw: SwiftUI around the Excalidraw web build in a WKWebView. It was
read with [REA](https://github.com/morluto/rea) 6.5.0 on 2026-10-14 to find what a native shell adds
on top of the same web app, which is the position the Mac app (`desktop/`) is in. Static analysis
only: nothing was launched, so behaviour below is read from the shipped code, not observed.

Target: `/Applications/ExcalidrawZ.app` 1.5.1 (build 50), arm64 slice of a universal Mach-O,
SHA-256 `1123826e…98f8b`. Embedded web build `Contents/Resources/excalidraw-latest`, `version.json`
`2025-06-29T09:05:06Z-01f3a6747`.

## Evidence

| REA operation | Evidence ID | What it established |
| --- | --- | --- |
| `inspect_artifact` | `ev_7d1dab10…a3fa` | Main binary, `Sparkle.framework`, `QuickLookPreviewExtension.appex`, the web build with 116 source maps |
| `inspect_plist`, app | `ev_477bd049…6d14` | Document types, UTIs, URL scheme, Sparkle feed, camera use, Spotlight activity |
| `inspect_plist`, appex | `ev_c84ae924…b412` | Quick Look preview of `.excalidraw` files, view-based |
| `inspect_macho` | `ev_6337fd75…71fa` | 73 linked libraries, 133 imported Objective-C classes |
| `decode_interface_builder` | `ev_daa9a3d4…207a` | Only Sparkle's nibs: the app's own interface is SwiftUI |
| `analyze_javascript_application` | `ev_e0718470…ca18` | 117 JS files parsed, none failed, 2,291 findings; coverage partial (locale chunks over budget) |

The shipped `assets/index-DHN9vFkk.js.map` carries `sourcesContent` for all 766 sources, so the
quotes below are the source as shipped, including 13 files under `excalidrawZ/`, the Swift↔JS
bridge. REA's `recover_javascript_sources` was not needed (and needs a Linux-only Wakaru).

Running REA's native macOS operations needs a working `swiftc`: REA compiles a small helper with
`xcrun swiftc`. On a Mac whose Command Line Tools carry a stale `usr/include/swift/module.modulemap`
next to the current `bridging.modulemap`, every Swift compile fails with *redefinition of module
'SwiftBridging'*. `REA_DARWIN_SWIFTC_PATH` (a wrapper that adds `-vfsoverlay` over the stale file)
plus `SDKROOT` works around it; removing the stale file fixes it.

## What the native shell adds

- **Files.** Opens `.excalidraw`, `.excalidraw.png` and `.excalidraw.svg` as an editor, in place;
  the scene round-trips through PNG and SVG. A Finder Quick Look preview, Spotlight indexing, iCloud
  sync (Core Data with CloudKit), print, share, and dragging a file out of the sidebar.
- **SwiftUI components** (type names in the binary): `ExcalidrawToolbar`, `FilesSidebar`,
  `GroupsSidebar`, `LibraryView`, `ExportImageView`, `MathInputSheetView`, `ShareView`,
  `SearchableModifier`, `ExcalidrawCollaborationView`.
- **The bridge.** One WebKit handler, `window.webkit.messageHandlers.excalidrawZ`. Swift calls the
  page through one object, `window.excalidrawZHelper` (load, save, export, theme, undo, pen mode),
  and the page reports `onStateChanged`, `historyStateChanged`, `didSetActiveTool`, `didPenDown`
  and the focus of its text fields. The native toolbar drives the page with synthetic keys.
- **Clipboard.** `navigator.clipboard.write` is replaced by a post to Swift: WKWebView has no
  async clipboard.
- **Pen and fingers** (`excalidrawZ/interaction.js`): the first pen contact picks the pen tool; in
  pen mode a finger selects or pans; a two-finger tap undoes, a three-finger tap redoes.

Excalidraw's own wheel (`packages/excalidraw/components/App.tsx`, `handleWheel`): Control or
Command and the wheel zooms -- Control is how Chromium reports a trackpad's pinch -- by
`zoom − deltaY/100` with each step clamped to 10, about the pointer; Shift and the wheel pans across;
the wheel alone pans. Safari's `gesturechange` zooms by `event.scale`. Its zoom keys are Mod `=`,
Mod `-` and Mod `0`.

## What Neurite took

| From ExcalidrawZ / Excalidraw | In Neurite | Where |
| --- | --- | --- |
| A pinch is a zoom by its own scale, about the pointer | `wheelZoomAmount`: Control and the wheel zooms by `exp(-deltaY / 100)`, Chromium's own convention, at most a `+` step an event, over a note too; never the browser's zoom, never a turn or a resize | `js/interface/interface.js`, `js/nodes/nodeclass.js` |
| Its menus run the page's own commands | The Mac app's View menu: Zoom In (Cmd =), Zoom Out (Cmd -), Fit (Cmd 0), Home, through `Hud.command` | `desktop/main.cjs`, `js/interface/hud.js` |

Excalidraw clamps each event at 10, for a zoom that adds: a mouse's Control + wheel, 100 or 120 a
notch, would otherwise take it past its limits in one. Neurite's zoom multiplies, so its cap is one
press of `+` (`Hud.zoomStep`, 47 of `deltaY`): a notch is a step, as on the keys, and a pinch is not
cut -- 9 an event at 800 px/s and 29 at 3000, measured; a clamp at 10 would cut the fast one short.
A pinch does not reach a page shown inside a note (a link's iframe): that page keeps the gesture.

## What was left, and why

- **Pen, finger and tap gestures.** Touch and stylus belong to the iPad map (#1), and the Mac app
  has no touch screen.
- **Drawing, the toolbar's tools, the library, image export, undo.** Ruled out on #40.
- **Opening `.neurite` files from Finder, Quick Look, Spotlight.** Native file handling the Mac app
  does not have yet; each needs the app to own a document type first.
- **The clipboard bridge.** Electron's page has the async clipboard already.
- **Two-finger scroll pans** (Excalidraw's wheel alone). Neurite's wheel zooms, and the
  `scroll` setting that would have offered the choice is unread (`globals.js`).
