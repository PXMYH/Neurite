# Cloud sync: Google Drive

[← Back to the Neurite README](../README.md)

Neurite keeps each Graph in the browser's own storage (IndexedDB), and a file on disk only when you
pick one with Save to…. Cloud sync adds a second copy that follows you: once Google Drive is
connected, every Graph you work on is kept as a `.neurite` file in a **Neurite** folder in your
Drive. Another device opens it from Settings → Sync.

This page is the design. The first part records how Notion, which the design follows, does the
same things, read from its shipped Mac app with REA. The second part is what Neurite does.

## 1. How Notion does it (read from Notion 7.39.0)

The shipped artifact: `Notion-7.39.0-arm64.dmg` from `desktop-release.notion-static.com`
(SHA-256 `0e22c2f5…f9e8`), whose `app.asar` (SHA-256 `cebe52a8…cbad`) REA analysed and extracted
(`rea analyze-javascript-application`, Evidence `ev_887180ba…7ee40`; the main bundle alone,
`ev_27b72160…703ed`; extraction `aex_b177e67b…5c27f`). Both analyses report partial semantic
coverage of the 4.4 MB main bundle (`.webpack/main/index.js`, SHA-256 `42900c76…2645a`): its
facts exceed REA's transfer budget, so the module and string facts below were read from the
extracted source at the byte offsets given, and a literal trace of `google-drive-picker-callback`
(`ev_55ad277f…4aa8`) matched no graph entity, which is not evidence of absence.

Notion's desktop app is a shell around the web client, which it loads from `app.notion.com`
(`config.json`: `domainBaseUrl`, `"offline": true`). What the shell shows:

**Google Drive is a source, not a store.** Notion attaches Drive files to pages; it does not keep
its own content in Drive.
- *Observed* (offset 276223, `createGoogleDrivePicker`): the Google Picker opens in a popup
  `BrowserWindow` sized to 80 % of the window it belongs to (566×350 to 1051×650), with
  `nodeIntegration: false`, `sandbox: true`, a preload of its own, and its **own persistent session**,
  `persist:gdrive` (offset 566043; `notion-ephemeral`/`gdrive-ephemeral` when a custom server is
  set). Its URL comes from the web client and is sanitized before loading. *Inferred*: it is
  Notion's own route `/googledrivepickerpopup`, which the route table lists (offset 1138540).
- *Observed*: the popup's preload makes `window.opener` a shim whose `postMessage` sends
  `notion:post-message` to the main process (`renderer/popup/preload.js`), so the same picker page
  works in a browser popup and in the app.
- *Observed* (offset 277209): the main process accepts the answer only from that popup
  (`e.sender.id === popup.webContents.id`) and only in the shape
  `{type: "google-drive-picker-callback", file?: {id, url, mimeType?, name?, resourceKey?}, files?: [...]}`,
  then closes the popup and sends `notion:google-drive-picker-callback` with the request's
  `flowId` to the window that asked. Closing the popup answers `file: undefined`.

**Google's tokens never reach the app.**
- *Observed* (offset 1547261): a Google callback is an authorization code with a base64 JSON
  `state`; `state.drive` makes it a `googleDriveAuthCallback {code, error}`. Notion's server
  exchanges the code and keeps the connection; the shell holds no Google token.
- *Observed* (offset 286882, `GoogleLoginController`): a "Google Login" window, built beside the
  internal settings and SQLite browser windows, loads `accounts.google.com` with a Firefox user
  agent. *Inferred*: a developer tool, and a sign of what Google's own documentation states —
  Google refuses its sign-in inside embedded browsers (`disallowed_useragent`), which is why apps
  send it to the system browser.
- *Observed* (offsets 287557, 240998): the app's navigation checks allow a list of identity-provider
  origins (`accounts.google.com`, Microsoft, Okta, …), and sign-in popups for synced databases
  have per-provider allowlists for GitHub, Atlassian and Salesforce.

**Content is local first, and fetched again on a schedule.**
- *Observed* (offsets 595864, 597995): Notion's own data lives in `userData/notion.db`, a SQLite
  database run by a "SQLite Server" utility process; the web client reaches it over MessagePorts
  (`notion:get-sqlite-meta`, `sqliteConnectionType: "message-ports"`) and runs SQL in batches.
- *Observed* (offset 1423350, `offline_mode_settings`): pages kept offline are fetched again every
  20 minutes (`refetch_interval_ms: 1200000`, `autosync_interval_ms: 1200000`), ten at a time.
- *Observed* (offset 1441724, `google_drive_ingestion`): the Drive connector Notion runs on its
  servers polls every 600 s with live segments of 300 s, 100 files a page, a 60 s timeout per call,
  retries after 500, 1000 and 2000 ms with up to 500 ms of jitter, and a 10 MiB limit per file.
- *Inferred*: the web client's sync with Notion's servers (records, versions, transactions) is in
  the web client the shell loads, not in the shell, so it is outside what this artifact shows.

## 2. What Neurite does

Neurite has no server of its own to hold a Google connection, so it keeps what Notion keeps on its
server in the most protected place it has, and follows Notion's shape everywhere else:

| Notion | Neurite |
|---|---|
| Google tokens on Notion's server | The refresh token in the Mac app's main process, encrypted by the Keychain (`safeStorage`); the page only ever holds an access token that lasts an hour. In a browser, no refresh token at all. |
| Sign-in through the system browser, code exchanged off the page | Authorization code with PKCE (S256) through the system browser, back to a one-time listener on `127.0.0.1` (Google's flow for desktop apps), checked against a random `state`. |
| Picker popup in its own session, answer checked for sender and shape | The Mac app takes the code only on its own listener, once, with the `state` it sent; every Drive answer is checked for the fields it must have before it is used. |
| Only the files a person picks (`drive.file`-like scoping) | The `drive.file` scope: Neurite sees only the files it made, in its **Neurite** folder. It is Google's non-sensitive scope. |
| Local database first, fetched again on a schedule | IndexedDB stays the Graph's home. A push follows a save; a check for a newer copy runs on start, on return to the window and every 5 minutes. |
| Retries at 500/1000/2000 ms ± 500, 60 s timeouts, 10 MiB a file | The same retries and timeout. Files over 5 MiB go up in a resumable upload rather than being refused. |

### What is kept, and where

- **In Drive:** one `.neurite` file per Graph — the same bundle Save to… writes and Open… reads,
  images and media included — in a folder named **Neurite** at the top of My Drive. Its private
  `appProperties` say which Graph it is (`neuriteUuid`, the lineage id a save already carries),
  how far along (`neuriteRevisions`), and where it was last written (`neuriteDevice`).
- **In this browser** (IndexedDB `sync`): per Graph, the Drive file it is bound to and the
  checksum (`md5Checksum`) of the copy this device last wrote or read, which is how a change made
  elsewhere is recognised; and the folder's id. No token is stored by the page.

### When it moves

- **Push:** after a save whose content changed (`View.Graphs.contentSignature`: the Panes' text and
  each Node's title and place), ten seconds after the last change and at least once a minute while
  changes keep coming, and at once when the window goes to the background or the app quits. A pan
  alone pushes nothing. Only the tab that holds the autosave lock pushes, and nothing is pushed
  before the last Graph is back on screen, after a restore that failed, or while a Mac app update
  is on probation.
- **Check:** on start, when the window comes back, and every 5 minutes, the bound file's checksum is
  read. A newer copy from another device is offered in Settings → Sync ("Open it"), never loaded on
  its own: opening a Graph moves the view and replaces the screen.

### When two devices disagree

The Drive file's checksum is compared before every push. If it is not the one this device last
wrote or read, the file was changed elsewhere, and it is not written over: this device's version
goes up beside it as `<title> (conflict, <device>, <date>).neurite`, the Graph on screen is bound to
that copy from then on, and Settings → Sync says so. Nothing is merged, as nothing is merged for a
file on disk either.

### Connecting

- **Mac app:** Settings → Sync → Connect opens Google's consent page in the system browser. Google
  sends the browser back to a listener the app opens on `127.0.0.1` for that one answer (5 minutes
  at most). The app exchanges the code, keeps the refresh token encrypted in its own folder, and
  refreshes the access token as it runs out. Disconnect revokes the token at Google and deletes it.
- **Browser:** Connect loads Google Identity Services and asks for an access token in a popup. It
  lasts an hour and is kept in memory only, so after an hour, or a reload, Sync asks to be
  connected again before it pushes.

### Setting it up (once, by the project's owner)

Google needs to know the app. In the Google Cloud Console, in one project:
1. Enable the **Google Drive API**.
2. On the **OAuth consent screen**, add the scope `https://www.googleapis.com/auth/drive.file`, and,
   while the app is in Testing, your own account as a test user.
3. Create an OAuth client of type **Desktop app**. Its id (and the secret Google issues with it,
   which Google says is not treated as a secret for this type) go into
   `desktop/drive-config.cjs`.
4. Create an OAuth client of type **Web application** with the authorized JavaScript origins
   `https://pxmyh.github.io` and `http://localhost:8999`. Its id goes into
   `js/sync/driveconfig.js`.

Until an id is there, Settings → Sync says that Google Drive is not set up in this build.
