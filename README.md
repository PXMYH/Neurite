[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](https://opensource.org/licenses/MIT)

# 🌐 **[neurite.network](https://neurite.network/)** 🌐

⚠️ `Warning:` Contains flashing lights and colors which may affect those with photosensitive epilepsy.

A mind map you can also write as plain text, laid out on a fractal.

The same material exists in two forms at once — a **Graph** of **Nodes** you drag around, and a
**Zettelkasten** you type into — and each edits the other. Under both sits the Mandelbrot set, zoomable
in real time, which acts as terrain rather than wallpaper: it pulls Nodes toward the set's boundary as
they move, so there is always more room one scroll deeper.

Nodes hold text, images, video, audio, web pages, PDFs, code, and AI agents. Connect two AI Nodes and
they talk to each other; connect a web page to one and it reads that page as context.

> <a href="https://www.youtube.com/watch?v=1BiUblUAd7s&list=PLnwfKwpTq3vDlXDrLParmQ_3waM1g-ehf"><strong>Demo video series — start with "Welcome to Neurite | Getting Started"</strong></a>

🌱 Open-source and in active development. This is the [`PXMYH/Neurite`](https://github.com/PXMYH/Neurite) fork.

<p align="center">
  <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/11815c92-0b8c-4f37-8f4d-6f300b380813" alt="Neurite" width="70%">
</p>

## Why fractals, why nodes

The Mandelbrot set is not an aesthetic choice. Fractal logic runs through a great many natural and
constructed things — [polynomial equations](https://www.youtube.com/watch?v=-RdOwhmqP5s),
[art](https://www.nature.com/articles/20833), [music](https://www.mpg.de/9379548/fractals-set-the-tone),
the [cosmic web](https://cosmicweb.kimalbrecht.com/) — which makes it a workable frame for thought that
does not fit a fixed number of dimensions. Movement through it is never interrupted: the render persists
and regenerates as you interact, so zoom is continuous rather than step-by-step.

Nodes are what you put in that space. Physics simulation of the graph is coupled to the fractal's
geometry, so arrangements are kinematic — scatter a set of Nodes and they settle along the boundary
rather than sitting on a grid.

<p align="center">
  <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/65afd5d3-3078-4d17-ac9f-a75fee9784ac" alt="Nodes in the fractal" height="360">
</p>

## Common concepts

These words mean one thing here, and the code, issues and docs all use them the same way. The full
glossary — including the words to avoid — is [`CONTEXT.md`](CONTEXT.md).

| Term | What it means |
| --- | --- |
| **Graph** | The live workspace: every Node, every Edge, and where you are currently looking. One at a time. |
| **Saved Graph** | A Graph kept under a name so it can be reopened later. |
| **Plane** | The space a Graph sits in. A position on it is a single complex number, and so are the Graph's pan and zoom. |
| **Fractal** | The Mandelbrot set drawn under the Graph. Terrain, not backdrop — its shape pulls Nodes toward the boundary. |
| **Node** | One thing in the Graph: a window you can drag, resize and read, which is also a body that moves under force. |
| **Node Type** | Which kind of thing a Node is — text, AI, link, image, media, Wolfram, file tree. A Node has exactly one. |
| **Edge** | A connection between two Nodes, both drawn and simulated: it holds them at a distance from each other. |
| **AI Node** | A Node holding a conversation with a Model, which can read the Nodes connected to it as context. |
| **Zettelkasten** | The plain-text form of the Graph. Typing creates and edits Nodes; editing a Node rewrites its text. Neither side is the original. |
| **Pane** | One independent Zettelkasten document. Several can be open, each a different text for the same Graph. |
| **Node Tag** / **Ref Tag** | The markers that open a Node's section (`##` by default) and a reference to another Node (`[[`). Both are configurable, so never assume them. |
| **Provider** / **Model** | The service that answers a call, and the particular model chosen from it. Set globally or per AI Node. |
| **Proxy** | Optional local gateway that holds your API keys and makes the Provider calls, so no key sits in the browser. |

## Get up and running

Nothing to build, and no account needed. You need **Node.js** and **npm**.

```bash
git clone https://github.com/PXMYH/Neurite.git
cd Neurite
npm install
npm start          # http://localhost:8999
```

The port is strict: if 8999 is busy, the start fails loudly instead of moving. Stop the other copy
rather than looking for a different address. `npm run start:host` serves the same thing on your LAN.

Then, in the browser: `Shift + double click` for a text Node, `Alt/Option + double click` for an AI
Node, scroll to zoom. Paste or drop files and links straight into the fractal. Enter API keys in the
**AI** tab of the menu dropdown. See [`docs/controls.md`](docs/controls.md) for the rest.

### Optional local backend

Cloud AI, web scraping, Wikipedia, Wolfram Alpha and file-tree access work through a small Express
gateway. Neurite detects it on its own — it polls `GET localhost:7070/check` and switches over — so
this is safe to start or skip at any time.

```bash
cd localhost_servers
npm start                # gateway on http://localhost:7070
npm run start:neurite    # also starts the Playwright automation server on :8081
```

Details, including `DIRECTACCESS_ROOT` for the file tree, are in
[`localhost_servers/README.md`](localhost_servers/README.md).

### Checks

```bash
npm test           # node --test, auto-discovers test/
npm run typecheck  # tsc over js/ (.ts files are checked; .js files supply globals)
npm run build      # vite build -> dist/
```

There is no linter. Anything visual is verified in the browser at `http://localhost:8999`.

### Or don't install anything

Use the hosted build at **[neurite.network](https://neurite.network/)**, or download **Neurite
Desktop** for Windows, Linux or macOS — see [`docs/desktop.md`](docs/desktop.md).

## Features, in depth

| Doc | What's in it |
| --- | --- |
| [`docs/features.md`](docs/features.md) | Every capability by category: fractal navigation, multi-agent UI, FractalGPT, synchronized knowledge, mind mapping, AI integration, Neural API. |
| [`docs/controls.md`](docs/controls.md) | Mouse and keyboard controls, node selection and arrangement, fractal controls, UI tips. |
| [`docs/zettelkasten.md`](docs/zettelkasten.md) | Bi-directional sync between the Mind Map and the text notes, custom tags, zoom-to-node. |
| [`docs/fractalgpt.md`](docs/fractalgpt.md) | Modular conversation: structured memory mapping, graphed AI responses, non-linear recall. |
| [`docs/multi-agent.md`](docs/multi-agent.md) | AI Node networks, message looping, conversation hierarchy, supported Providers, AI plugins. |
| [`docs/neural-api.md`](docs/neural-api.md) | The function calling panel and the scriptable API for animating movement through the fractal. |
| [`docs/desktop.md`](docs/desktop.md) | Neurite Desktop: downloads, full web browsing in Link Nodes, current limitations. |
| [`docs/gallery.md`](docs/gallery.md) | Screenshots. |

## Working on the code

| Doc | What's in it |
| --- | --- |
| [`CONTEXT.md`](CONTEXT.md) | The domain glossary, in full. Binding vocabulary for issues, commits and comments. |
| [`CLAUDE.md`](CLAUDE.md) | Commands, architecture and naming conventions, aimed at coding agents. |
| [`docs/README.md`](docs/README.md) | Component map, suggested reading order, and the traps to know before a first change. |
| [`docs/architecture.html`](docs/architecture.html) | Interactive component diagram — open it in a browser, no build or server needed. |
| [`docs/handoff.md`](docs/handoff.md) | Start here when picking up development cold: what to read, how to verify, how work is picked. |
| [`docs/adr/`](docs/adr/) | Decisions that would otherwise get re-proposed. |

The one thing to know before editing: the app is **not bundled**. `PageLoad.scripts` in `js/main.js`
is a hand-ordered list of file paths, load order is the dependency graph, and a file missing from that
list never runs — silently.
