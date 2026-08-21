# Neurite

A mind map you can also write as plain text, laid out on a fractal. The same
material exists in two forms at once — a Graph of Nodes you drag around, and a
Zettelkasten you type into — and each edits the other.

## Language

### The canvas

**Graph**:
The live workspace: every Node, every Edge, and where the reader is currently
looking. There is one at a time.
_Avoid_: canvas, map, mind map, net, network, workspace, board

**Saved Graph**:
A Graph kept under a name so it can be reopened later.
_Avoid_: save, file, document, project, net

**Plane**:
The space a Graph sits in. A position on it is a single complex number, not a
pair of coordinates, and so are the Graph's pan and zoom.
_Avoid_: canvas, viewport, grid, coordinates, xy

**Fractal**:
The Mandelbrot set drawn under the Graph. It is the terrain, not a backdrop:
its shape pulls Nodes toward the set's boundary as they move.
_Avoid_: background, backdrop, wallpaper, texture

### Nodes and edges

**Node**:
One thing in the Graph — a window the reader can drag, resize and read, which
is also a body that moves under force.
_Avoid_: card, item, vertex, cell, block, box

**Node Type**:
Which kind of thing a Node is: text, AI, link, image, media, Wolfram, or file
tree. A Node has exactly one.
_Avoid_: node class, node kind, node subclass, variant

**Edge**:
A connection between two Nodes, both drawn and simulated — it holds the two
Nodes at a distance from each other.
_Avoid_: link, connection, relation, arrow, line, join

**AI Node**:
A Node that holds a conversation with a Model and can read the Nodes connected
to it as context.
_Avoid_: LLM node, GPT node, chat node, agent, assistant

**Link Node**:
A Node that displays a web page or a dropped file inside itself.
_Avoid_: link, iframe node, web node, embed, preview

### The text form

**Zettelkasten**:
The plain-text form of the Graph. Typing creates and edits Nodes; editing a
Node rewrites its text. Neither side is the original.
_Avoid_: notes, note text, editor, markdown, outline, source

**Pane**:
One independent Zettelkasten document. A reader can keep several open, each
holding a different text for the same Graph.
_Avoid_: tab, instance, buffer, document, editor, sheet

**Node Section**:
The run of lines in a Pane that describes one Node: its Title line, then its
body, up to the next Title.
_Avoid_: block, chunk, entry, note, paragraph, stanza

**Title**:
The text on the first line of a Node Section. It is the Node's identity in the
text, so renaming it renames the Node and every Ref that pointed at it.
_Avoid_: name, label, heading, header, id, key

**Node Tag**:
The marker that opens a Node Section. The reader can change it, so it is not
always `##`.
_Avoid_: heading marker, hash, delimiter, prefix

**Ref Tag**:
The marker that opens a Ref. The reader can change it, so it is not always
`[[`.
_Avoid_: link syntax, wikilink, bracket, delimiter

**Ref**:
A mention of another Node's Title inside a Node Section. A Ref is how an Edge
is written down.
_Avoid_: link, backlink, mention, citation, pointer

### Models

**Provider**:
A service that answers a model call — a hosted one, a local one, or a custom
endpoint the reader supplies.
_Avoid_: vendor, backend, service, API, platform

**Model**:
The particular model chosen from a Provider for a call. It can be chosen once
for everything, or separately on one AI Node.
_Avoid_: engine, LLM, AI, agent

**Proxy**:
An optional local gateway that holds the keys and makes the Provider calls, so
no key sits in the browser.
_Avoid_: server, backend, gateway, localhost server, relay
