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
  images and media included — in Neurite's folder at the top of My Drive. The folder is called
  **Neurite** and is found by a private mark (`neuriteFolder`), so renaming it changes nothing. A
  file's private `appProperties` say which Graph it is (`neuriteUuid`, the lineage id a save
  already carries), how far along (`neuriteRevisions`), where it was last written
  (`neuriteDevice`), the content signature of what it holds (`neuriteSignature`), and the id of
  the push that wrote it (`neuriteOp`).
- **In this browser** (IndexedDB `sync`): per record, the Drive file it is bound to, the checksum
  (`md5Checksum`) of the copy this device last wrote or read, the revision and content signature
  it pushed, the id of a push still out, and whether the file was removed in Drive; and the
  account. No token is kept by the page. Connecting another account forgets every binding.

### When it moves

- **Push:** after a save that changed a Graph's content. Content is the saved markup less how it
  is viewed (`CloudSync.signatureOf`): each card's place on the screen, the camera and the look are
  left out; so are the heights a title box and an editor are given to fit their text, an image's
  `blob:` address and its blob's number in this browser's store; and one setting an AI note writes
  two ways is read one way. Each of those was measured changing in a Graph opened from its own
  file. A pan sends nothing; an edit, a moved or resized card, or an AI note's answer does. The
  push goes ten seconds after the last such save, at least once a minute while they keep coming,
  and at once when the window goes to the background or the app quits (which waits for it five
  seconds at most). A push still waiting for one Graph goes at once when another is opened. Only
  the tab that holds the autosave lock pushes. Nothing is pushed before the last Graph is back on
  screen, for the Graph on screen after a restore that failed, while a Mac app update is on
  probation (it waits, and goes after), or for a Graph with no note in it. A Graph saved while some
  of its cards could not be reopened goes up once beside its file rather than over it (below). A
  push that fails is tried again after half a minute, two minutes, then every ten minutes, and on
  every check. On start, the last save of the Graph on screen is read from the store, so one that
  never went up is not called synced, and goes once Drive is connected.
- **Disconnect** is at once: no save after the click starts a push, though the Mac app's main
  process may still be telling Google; a push or a check already under way ends without writing
  anything or changing what Sync says.
- **Check:** on start, when the window comes back, and every 5 minutes, the bound file's checksum is
  read. A newer copy from another device is offered in Settings → Sync ("Open it"), never loaded on
  its own: opening a Graph moves the view and replaces the screen. Open saves and pushes the Graph
  on screen first, and asks before it leaves behind changes that are not in Drive -- a push that
  failed, or a file removed from Drive. Disconnect during an open stops it before the screen
  changes. Opens go one at a time; each binds the record its own import made to the file it came from, as Drive holds it, so
  the save the opening makes sends nothing back. Each Graph has its own check: one still out for
  the last Graph does not stand in for the next.
- **Another kind of browser:** a Graph opened in the Mac app (Chromium) from an iPad's save (WebKit),
  or the other way, can settle a card a little differently, as the two measure text apart. A moved
  card is content, so that move goes up once.

### When two devices disagree

The Drive file's checksum is compared before every push. If it is not the one this device last
wrote or read, the file was changed elsewhere:
- If its `neuriteSignature` is the content this device last wrote or read, only the view changed
  there — a pan — and the push goes ahead.
- If the content changed there and only the view changed here, nothing is pushed, and the newer
  copy is offered.
- If the content changed on both, the file is not written over: this device's version goes up
  beside it as `<title> (conflict, <device>, <date>).neurite`, the Graph on screen is bound to that
  copy from then on, and Settings → Sync says so and offers the other copy.

Nothing is merged, as nothing is merged for a file on disk either. The check and the write are two
requests, so two devices pushing in the same second can still write one after the other. After
every write, the file's revisions are read: a revision between the one this device built on and
its own is another device's write that landed in between. It is kept as a conflict copy too, and
Settings → Sync says that another device saved the Graph in the same moment. Drive gives an
earlier revision of a binary file only once it is marked to be kept forever, so Neurite marks it
before it reads it, and takes the mark off once the copy is made (Drive allows 200 a file). Drive
does not say in what order it lists revisions, so they are put in order of time; every page of a
list is read. A write sent again after its answer was lost lands twice, so the check looks past
this device's own copies of the same bytes to the revision before them. The check after a write is
recorded before it runs: one that fails is not called synced, even after a reload, and runs again
before the next push, and a copy it made whose answer never came is found by its own operation id
rather than made twice (and not offered if it went to the bin meanwhile). A push that builds on a
lost push's write counts what that one built on as a base too, since its own check never ran. The
note about a copy kept this way stays while the Graph is bound to the same file.

A push whose answer never came may still have written. Each push carries an id (`neuriteOp`), kept
before it goes with the SHA-256 of the bytes it sends: the next push looks for the file with that
id -- the Graph's own, a new one, or a conflict copy -- and goes on from there, rather than making
a second file or calling its own write a conflict. It builds on that file only if Drive still
holds those bytes (`sha256Checksum`): one written since by something that left Neurite's
properties alone is another's, kept as a conflict. One moved to the bin since is not made again.

A Graph saved while some of its cards could not be reopened (a restore that skipped a card it could
not rebuild) is smaller than its file in Drive. It goes up once beside it as a conflict copy, and
Settings → Sync says why and offers the whole one; the saves after that go to the copy.

A file moved to the bin or deleted in Drive is not made again: the Graph stops syncing, and
Settings → Sync offers to sync it again, which makes a new file.

Two devices that make Neurite's folder at the same moment make two. Both read the files of every
marked folder, and new files go to the oldest one.

### What the page may do with a token

The Mac app's page is handed an access token for the `drive.file` scope, an hour at a time; the
refresh token never leaves the main process. A script that took over the page could use that hour
on Neurite's own files, as it could use the page's own access to them; it could not keep the
connection, or reach any other file in the Drive. A browser holds the same kind of token, by
Google's design for web apps. On `pxmyh.github.io`, every GitHub Pages site of the account shares
the origin that the browser client is allowed from, and could ask Google for the same consent;
they are the account owner's own sites.

### Connecting

- **Mac app:** Settings → Sync → Connect opens Google's consent page in the system browser. Google
  sends the browser back to a listener the app opens on `127.0.0.1` for that one answer (5 minutes
  at most), which takes it only with the `state` it sent and its own Host. The consent asks for
  offline access, so that Google issues a refresh token; a sign-in without one connects nothing.
  The app exchanges the code with its PKCE verifier, keeps the refresh token encrypted by the
  Keychain in its own folder, and refreshes the access token as it runs out. A refresh Google
  refuses forgets the connection. Disconnect revokes the token at Google and deletes it. Without
  the Keychain, it does not keep a sign-in at all.
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
