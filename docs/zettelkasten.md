# Synchronized Knowledge Management

The Mind Map and the Zettelkasten are two views of one thing, and each edits the other.

[← Back to the Neurite README](../README.md)

<table>
  <tr>
    <!-- Top Left: Introduction and Main Features -->
    <td valign="top" width="50%">
      <h3><a href="https://neurite.network/">neurite.network</a></h3>
      <p><a href="https://en.wikipedia.org/wiki/Markdown">Markdown</a> formatted, <a href="https://en.wikipedia.org/wiki/File_synchronization">bi-directional synchronization</a> between UI-focused <a href="https://en.wikipedia.org/wiki/Mind_map">Mind-Mapping</a> and text-based <a href="https://en.wikipedia.org/wiki/Hyperlink">hyperlinking</a>.</p>
      <ul>
        <li><strong>FractalGPT</strong>: Engage with non-linear, rhizomatic memory through our biomimetic interface.</li>
        <li><strong>Local AI</strong>: Privacy-focused, connect to any locally hosted instance of Ollama or your own custom endpoint.</li>
        <li><strong>Vector Embeddings</strong>: Grow a database of memories that can switch out as context for an increasing number of Ai systems.</li>
        <li><strong>Chaos and Order</strong>: Navigate through the depths of Neurite's non-linear environment at the boundary between stability and disorder.</li>
      </ul>
    </td>
    <!-- Top Right: Image -->
    <td valign="top" width="50%">
      <p align="center">
         <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/da23628a-d3e2-4fe6-8dda-6f3f15e850f0" alt="SKM3" width="100%">
      </p>
    </td>
  </tr>
  <tr>
    <!-- Bottom Left: image 2 -->
    <td valign="top" width="50%">
       <p align="center">
         <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/3718856b-fa35-4b5a-bb78-3f0507712ad1" alt="SKM" width="100%">
      </p>
    </td>
    <!-- Bottom Right: Additional Info or CTA -->
    <td valign="top" width="50%">
      <ul>
        <li><strong>Dynamic Fractal Backdrop</strong>: Interactive, multi-media orchestration.</li>
        <li><strong>Zoom-to-Node</strong>: Navigate directly to and between nodes within the Mandelbrot set.</li>
        <li><strong>Bi-Directional Sync</strong>: Real-time updates between Mind Map and Zettelkasten.</li>
        <li><strong>Zettelkasten and Mind Mapping</strong>: Nodes are dynamic objects that can be interacted with from any approach.</li>
        <li><strong>Endless Exploration</strong>: Build custom interfaces within Neurite for any task you have in mind.</li>
      </ul>
    </td>
  </tr>
</table>

Build your Zettelkasten through UI interactions in the Mind Map, and reciprocally shape the Mind Map through text-based note-taking in the Zettelkasten. This navigational fluidity offers unprecedented control over both the granular and macroscopic perspectives of your information.

## Archives

The Notes panel can hold several texts for one graph, each called an Archive. The list at the top of the panel says which Archive is shown and how many notes each holds; **New Archive**, **Rename Archive…** and **Delete Archive…** are under it.

- Every Archive's notes are on the same canvas. A new note, from the tool bar or from an AI answer with no card to go to, is written into the Archive the panel shows. With two Archives or more, the panel at the bottom left of the canvas says which one that is.
- A Title names one note across all the Archives, in any case. A Title line written a second time, in the same Archive or another, makes no second note: the line is dimmed, the Title is underlined in red, and the panel says which Archive has the note. Click the line number in that message to select the Title and rename it. When the first note is renamed or deleted, the second line becomes a note.
- A graph saved with one Title in two Archives opens with the later line renamed "Title (2)", both notes kept where they were, and a notice that lists each rename.
- Delete Archive says how many notes go with the Archive. The last Archive cannot be deleted, because new notes need an Archive to go into.

## Importing a folder of notes

**Import notes…** in the menu reads a folder of Markdown notes into a graph, the way an Open Knowledge Format bundle keeps them (the AI bundle of #69 is the case it was built on):

- Each `.md` file whose YAML frontmatter names a `type` becomes one note. Indexes, logs and the bundle's contract (`type: index`, `log`, `contract`), files with no frontmatter or no `type`, and folders whose names start with `.` or `_` are not notes, and are counted in the summary instead.
- Each top-level folder becomes an Archive; notes at the top of the folder go into an Archive named after it.
- A note's Title is its file name. Two files with one name, in any case, each take as much of their path as tells them apart, as the bundle's own `[[Claude Code/Courses]]` does.
- The notes' own `[[links]]` become Edges at once, across Archives as well. A link by another name (`[[Building Agents|Agents]]`) or to a heading (`[[Setup#Keys]]`) is written as a plain link to its note in Neurite's copy. A link that names no note stays as text, and the summary lists it.
- A line of a note that begins with the Node Tag (`##` by default) or `AI:` would start a note of its own, so Neurite's copy of it begins with a space. The folder itself is only read, never written.
- A card starts at the note's text: its frontmatter, and a first heading that repeats its Title, stay in the note (the Notes panel shows them), and the frontmatter's `description` is the line above the text.
- Into an empty graph the import goes straight in; with notes on screen, or text in the Notes panel, it asks, and puts the graph on screen away first, as **Clear** does.
- Each Archive of the import is a **Region** of the Plane: a disk inside one of the Mandelbrot set's primary bulbs, the largest Archive in the largest bulb and the notes at the folder's top in the main cardioid, with the Archive's name drawn over it. The notes sit in it as a block, pinned, at the size that fits the bulb, so a smaller Archive's notes are smaller and are read by zooming in. Picking the Archive in the Notes panel frames its notes beside the panel; a note made by double-click inside a Region, or typed into its Archive, is that Archive's and takes the Region's size. A double-click puts it where the pointer is when nothing is there, or in the free place of the block nearest the pointer, and the view moves just enough to show it whole.

## Proposed Edges

The light bulb in the tool bar, **Propose Edges**, lists pairs of notes that could be linked and are not, with the reason for each, notes with no Edge at all first:

- **A mention**: one note's text names the other's Title, whole words and outside a link, quoted with the Title marked. A Title of one word counts only in its own case, since "Setup" or "Models" is also a plain word.
- **Tags**: the frontmatter `tags` both notes carry, rarest first. A Tag every note has is no reason.
- **Similar wording**: the two notes' Titles and descriptions (or their first 300 characters) read by the embeddings model chosen in the AI tab, more alike than the note's usual. Pairs with only this to go on are the weakest, and are in a group that starts closed. It is off while the AI features are off.

Each note gets at most three, and no note is named more than four times, so the few notes everything mentions do not fill the list. Nothing is proposed until the button is pressed, and a note's vector is kept in the browser, so a second look is instant.

- Click a pair to frame both notes and to read, under it, what each is about; a dashed line on the canvas shows the Edge it would make.
- **Link** writes one Ref, into the first note of the pair, naming the second: the line a reader would have typed. Its tooltip says what it will write.
- **Dismiss** keeps the pair out of the list from then on, by the two notes' titles; the dismissal is saved with the graph. **Undo** takes it back while the list is open.

The Connect modal (Link "…" to…) offers the note's own three first, under **Proposed**; a click on one writes one Ref, into the note being linked.
