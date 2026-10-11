# Neurite Desktop

The Electron release: real web browsing inside Link Nodes, and the Localhost Servers started for you.

[← Back to the Neurite README](../README.md)

## The macOS app in this repository

`desktop/` packs **this** checkout's frontend into `Neurite.app`, for Apple Silicon (M1 and
later). It is a separate thing from the upstream release further down, which downloads its
frontend from satellitecomponent's releases at startup.

Download: the `.dmg` on this repository's
[latest release](https://github.com/PXMYH/Neurite/releases/latest). Open it and drag Neurite
to Applications.

Build it yourself:

```bash
cd desktop
npm install         # Electron and @electron/packager, kept out of the root install
npm run dmg         # builds ../dist, packs out/Neurite-darwin-arm64/Neurite.app,
                    # and writes out/Neurite-<version>-arm64.dmg
npm start           # or just run it from the checkout
npm test            # smoke test in real Electron; NEURITE_APP=<.../MacOS/Neurite> tests a build
```

What to know:

- **First launch.** The app is signed ad hoc, not notarized, so macOS refuses the first
  double-click of a downloaded copy. Allow it under System Settings › Privacy & Security ›
  Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Neurite.app`. (Since
  macOS 15 the old Control-click › Open route no longer gets past this.) A copy you build
  yourself is not quarantined and opens directly.
- **Your graphs** live in `~/Library/Application Support/Neurite`, separate from any browser's
  copy. Move a graph across with Save to… in the browser and Open… in the app. `npm start`
  uses `Neurite Dev` instead, so a checkout never writes into the installed app's graphs.
- **Quitting keeps your work.** The app waits for the graph to finish saving before it closes,
  which a browser tab cannot do.
- **Updates.** The app looks for a newer release 20 seconds after it opens and every six hours
  after, and the menu's **Check for updates** row asks again. When one is out, the menu button
  shows a dot and the row reads **Update to x.y.z**: it downloads the release's DMG, checks it
  against the SHA-256 GitHub took when it was uploaded, saves your graph, closes, puts the new
  app where the old one was, and opens it again. A graph that cannot be saved first stops the
  update, and a new version that has not started -- its window up and your graph back -- within a
  minute is taken out and the old one
  put back and opened, saying the update did not install; `update.log` in the app's support
  folder says what happened. Run from the disk image, or from a copy macOS made where it was
  downloaded, it cannot replace itself, and the row opens the release page instead. Until the
  new version is confirmed it saves nothing, so a version that is taken back cannot write over
  the graph the old one kept. Two limits: a power cut in the instant between moving the old app
  aside and the new one in leaves no app at its path, and the old one is beside it as
  `Neurite.app.replaced-<number>` (rename it back); and pictures or media a new version fails to
  load are blank in it but kept, since it writes back only what it read. It is not
  Squirrel (Electron's `autoUpdater`): that only takes an
  update that satisfies the running app's designated requirement, and an ad hoc requirement is
  the build's own hash. `desktop/updater.cjs`; `npm test` here drives a real update of a
  packaged build when `NEURITE_APP` is set.
- **Offline.** index.html loads its libraries from two CDNs. The app keeps a copy of each the
  first time it arrives, so after one launch with a network it opens with none.
- **AI.** OpenAI, Groq and Ollama work directly. Claude and the other gateway features need the
  Localhost Servers running (`cd localhost_servers && npm start`), exactly as in a browser; the
  gateway accepts the app's `app://neurite` origin.
- **Record** and the Neural API's screenshot use macOS's own screen picker.
- **Not included:** upstream's `<webview>` link nodes and its bundled servers. Link nodes are
  iframes here, as they are in the browser.

## The upstream release

<p align="center">
  <img src="https://github.com/user-attachments/assets/27a2c085-3354-42ef-ae37-cca274d8e641" alt="linknodeselectrondemo" />
</p>

## Unchain from the traditional limitations of a browser

Forget tabs! Neurite is all about graphs. Open as many browser windows as you want and display them side by side in our infinite fractal canvas.
### Download the latest version of **Neurite Desktop** ↓
<table align="center">
  <tr>
    <td><a href="https://github.com/satellitecomponent/Neurite/releases/latest/download/Neurite.Setup.1.0.0.exe" target="_blank">Windows</a></td>
  </tr>
  <tr>
    <td><a href="https://github.com/satellitecomponent/Neurite/releases/latest/download/Neurite-1.0.0.AppImage" target="_blank">Linux</a></td>
  </tr>
  <tr>
    <td><a href="https://github.com/satellitecomponent/Neurite/releases/latest/download/Neurite-1.0.0-arm64.dmg" target="_blank">macOS</a></td>
  </tr>
</table>

### The desktop release includes a full web browsing experience within link nodes — no more restrictions on which links you can open.

> - Forward and backward navigation built into each link node  
> - Create new link nodes by directly dragging out URLs  `See the above gif`
> - Works with any site, no sandboxing limitations
> - Runs and updates the Localhost Servers for you

This is a highly experimental feature in early release.

*macOS does not have code signing and requires workarounds to open.

*Windows requires clicking past the security warning on first open.
<p align="center">
<img src="https://github.com/satellitecomponent/Neurite/assets/129367899/609781ec-7440-479a-859c-9248fd60644f" alt="neuritedemo1" width="60%">
</p>
