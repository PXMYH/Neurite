// A folder of Markdown notes into the Graph (#71): each note one text Node, each top-level
// folder one Archive, and the notes' own Refs drawn as Edges at once. Measured on the AI
// bundle (#69), which keeps its notes as the Open Knowledge Format does -- YAML frontmatter
// with a `type` on every note -- and read only: nothing is written back to the folder.
//
// A script, like zetsplitter.ts: no import and no export, so `Tag`, `LLM_TAG`, `App` and
// `Graph` are the globals every other file reads. Its entry in PageLoad.scripts reads
// 'js/zettelkasten/zetimport.js', right after the splitter.
//
// Most of those globals are classes whose statics are assigned after the class -- `Tag.node`,
// `On.click` -- or replaced by an instance (`Graph = new Graph()`), which TypeScript does not
// follow, so the few places here that reach them go through `any`. They are lexical
// bindings, not properties of `globalThis`, so they are named, never looked up.

interface ImportFile { path: string; text: string }
interface ImportNote { area: string; title: string; path: string; text: string }
interface ImportArea { name: string; text: string; titles: string[] }
interface ImportTags { node: string; ai: string; ref: string; close: string | undefined }
interface ImportPlan {
    root: string;
    notes: ImportNote[];
    areas: ImportArea[];
    // Why each file that is not a note was left out, with the files.
    skipped: Map<string, string[]>;
    // Refs that name no note of the import: they stay text and draw nothing.
    unresolved: {title: string, ref: string}[];
    embeds: number;
    escaped: number;
}

class ZetImport {
    // Files about the notes rather than notes: the bundle's generated indexes, its log and
    // its contract (AGENTS.md). An index would link every note to its area's index page,
    // and the notes' own few Edges -- the thing the map is about -- would drown.
    static aboutTypes = new Set(['index', 'log', 'contract']);

    // A note's frontmatter, and its `type`, or null when it has none.
    static frontmatter(text: string): {type: string | null} | null {
        const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
        if (!match) return null;

        const type = /^type:[ \t]*["']?([^"'#\r\n]*?)["']?[ \t]*(?:#.*)?$/m.exec(match[1]);
        return {type: type?.[1].trim().toLowerCase() || null};
    }

    // Which notes, under which Titles, in which Archives. Pure: the files in, the plan out.
    //
    // - A note is a `.md` file with frontmatter that names its `type`. A file with none is
    //   a draft, a clipping or a course page, not one of the bundle's notes (the bundle's
    //   contract says the same of its Courses folder), and a folder whose name starts with
    //   `.` or `_` holds tool state or attachments.
    // - Its Title is its file name, which is what the bundle's Refs name it by. Where two
    //   names are one in any case -- a Title names one note (#64) -- each takes as much of
    //   its path as makes it unique, as the bundle's own `[[Claude Code/Courses]]` does.
    // - A line of it that opens with the Node Tag or the AI Node's tag would open a Node
    //   where the note has a heading: it is written with one space before it, in Neurite's
    //   copy only. The frontmatter title is not the Title: 17 of the bundle's notes have one
    //   that differs from the file name, and two of them share one.
    static notesFrom(files: ImportFile[], root: string, tags: ImportTags): ImportPlan {
        const skipped = new Map<string, string[]>();
        const skip = (reason: string, path: string)=>{
            if (!skipped.has(reason)) skipped.set(reason, []);
            skipped.get(reason)!.push(path);
        };

        const found: {area: string, dirs: string[], base: string, path: string, text: string}[] = [];
        for (const file of files) {
            const parts = file.path.split('/').filter(Boolean);
            const name = parts.pop() ?? '';
            if (!/\.md$/i.test(name)) continue;
            if (parts.some( (dir)=>(dir.startsWith('.') || dir.startsWith('_')) )) continue;

            const head = ZetImport.frontmatter(file.text);
            if (!head) { skip('no frontmatter', file.path); continue; }
            if (!head.type) { skip('no type', file.path); continue; }
            if (ZetImport.aboutTypes.has(head.type)) { skip(head.type, file.path); continue; }

            found.push({area: parts[0] ?? root, dirs: parts, base: name.replace(/\.md$/i, '').trim(), path: file.path, text: file.text});
        }

        // Titles: the file name, or as much of the path as makes it unique.
        const byName = new Map<string, typeof found>();
        for (const note of found) {
            const key = note.base.toLowerCase();
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key)!.push(note);
        }
        const titled = found.map( (note)=>{
            const group = byName.get(note.base.toLowerCase())!;
            if (group.length === 1) return {note, title: note.base};

            for (let depth = 1; depth <= note.dirs.length; depth++) {
                const title = [...note.dirs.slice(-depth), note.base].join('/');
                const others = group.filter( (other)=>(other !== note) )
                    .map( (other)=>[...other.dirs.slice(-depth), other.base].join('/').toLowerCase() );
                if (!others.includes(title.toLowerCase())) return {note, title};
            }
            return {note, title: note.path.replace(/\.md$/i, '')};
        });

        let escaped = 0;
        const notes: ImportNote[] = titled.map( ({note, title})=>{
            const lines = note.text.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n').map( (line)=>{
                if (!line.startsWith(tags.node) && !line.startsWith(tags.ai)) return line;

                escaped += 1;
                return ' ' + line;
            });
            return {area: note.area, title, path: note.path, text: lines.join('\n')};
        });

        // One Archive for each folder, the notes at the top of the folder first, then by name.
        const areaNames = [...new Set(notes.map( (note)=>note.area ))]
            .sort( (a, b)=>((a === root ? -1 : b === root ? 1 : 0) || a.localeCompare(b, undefined, {sensitivity: 'base'})) );
        const byTitle = (a: ImportNote, b: ImportNote)=>a.title.localeCompare(b.title, undefined, {sensitivity: 'base'});
        const areas: ImportArea[] = areaNames.map( (name)=>{
            const inArea = notes.filter( (note)=>(note.area === name) ).sort(byTitle);
            return {
                name,
                text: inArea.map( (note)=>`${tags.node} ${note.title}\n${note.text}\n` ).join('\n'),
                titles: inArea.map( (note)=>note.title )
            };
        });

        // Refs that will draw nothing, said once in the summary. An embed (`![[x]]`) is an
        // attachment shown in place, not a note named.
        const titles = new Set(notes.map( (note)=>note.title ));
        const unresolved: {title: string, ref: string}[] = [];
        let embeds = 0;
        const open = ZetImport.escape(tags.ref), close = ZetImport.escape(tags.close ?? '');
        const refPattern = tags.close ? new RegExp(`(!?)${open}(.*?)${close}`, 'g') : null;
        for (const note of notes) {
            if (!refPattern) break;
            for (const match of note.text.matchAll(refPattern)) {
                if (match[1]) { embeds += 1; continue; }
                const ref = match[2].trim();
                if (titles.has(ref) || unresolved.some( (u)=>(u.title === note.title && u.ref === ref) )) continue;

                unresolved.push({title: note.title, ref});
            }
        }

        return {root, notes, areas, skipped, unresolved, embeds, escaped};
    }

    static skippedPhrase(reason: string, n: number): string {
        const many = (n !== 1);
        switch (reason) {
            case 'no frontmatter': return `${n} ${many ? 'files' : 'file'} with no frontmatter`;
            case 'no type': return `${n} with no type in ${many ? 'their' : 'its'} frontmatter`;
            case 'index': return `${n} ${many ? 'indexes' : 'index'}`;
            default: return `${n} ${reason}${many ? 's' : ''}`;
        }
    }

    static escape(text: string): string {
        return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
    }

    // What the import did, in one notice. Each part is there because it is a question the
    // reader will otherwise ask of the canvas.
    static summary(plan: ImportPlan, edges: number): string {
        const lines = [`${plan.notes.length} notes from “${plan.root}”, in ${plan.areas.length} Archives, with ${edges} Edges from their own links.`];
        if (plan.escaped) {
            const many = (plan.escaped !== 1);
            lines.push(`${plan.escaped} ${many ? 'lines' : 'line'} of the notes ${many ? 'begin' : 'begins'} with “${(Tag as any).node}” or “${LLM_TAG}”, which would start a note of its own here, so ${many ? 'each begins' : 'it begins'} with a space instead. The folder is unchanged.`);
        }
        // In one order whatever order the browser listed the files in.
        const order = ['index', 'log', 'contract', 'no type', 'no frontmatter'];
        const skipped = [...plan.skipped].sort( (a, b)=>(order.indexOf(a[0]) - order.indexOf(b[0])) )
            .map( ([reason, paths])=>ZetImport.skippedPhrase(reason, paths.length) );
        if (skipped.length) lines.push('Not imported, as not notes: ' + skipped.join(', ') + '.');
        if (plan.unresolved.length) {
            const shown = plan.unresolved.slice(0, 6).map( (u)=>`[[${u.ref}]] in “${u.title}”` );
            const many = (plan.unresolved.length !== 1);
            lines.push(`${plan.unresolved.length} ${many ? 'links name' : 'link names'} no note here, and ${many ? 'stay' : 'stays'} as text: ${shown.join(', ')}${plan.unresolved.length > 6 ? ', and more' : ''}.`);
        }
        if (plan.embeds) lines.push(`${plan.embeds} embedded ${plan.embeds === 1 ? 'attachment stays' : 'attachments stay'} as text.`);
        return lines.join('\n\n');
    }

    // The tags as the reader has set them, read at the time of the import.
    static tags(): ImportTags {
        const tag = Tag as any;
        return {node: tag.node, ai: LLM_TAG, ref: tag.ref, close: getClosingBracket(tag.ref)};
    }

    // From the folder the reader picked. `webkitRelativePath` starts with the folder's own
    // name, which is the bundle's, and is the Archive for notes at its top.
    static async run(fileList: FileList | File[]): Promise<void> {
        // The app's own dialogs, which answer with a promise (customdialog.js).
        const ui = window as any;
        const md = [...fileList].filter( (file)=>/\.md$/i.test(file.name) );
        if (!md.length) {
            await ui.alert('That folder holds no Markdown notes (.md files).');
            return;
        }
        const root = (md[0].webkitRelativePath || md[0].name).split('/')[0];
        const files = await Promise.all(md.map( async (file)=>({
            path: (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name,
            text: await file.text()
        }) ));
        const plan = ZetImport.notesFrom(files, root, ZetImport.tags());
        if (!plan.notes.length) {
            await ui.alert(`“${root}” holds no notes to import: ` + ZetImport.summary(plan, 0));
            return;
        }

        // Into the graph on screen when it holds nothing, otherwise into a graph of its own.
        const app = App as any;
        if (Object.keys((Graph as any).nodes).length > 0) {
            const question = `Import ${plan.notes.length} notes from “${plan.root}” into a new graph, `
                + `an Archive for each of its ${plan.areas.length} folders? The graph on screen is put away `
                + 'first, as Clear puts it away: use Save to… first to keep a copy of it on disk.';
            if (!await ui.confirm(question)) return;

            await app.viewGraphs.startNewGraph();
        }
        const edges = ZetImport.load(plan);
        await ui.alert(ZetImport.summary(plan, edges));
    }

    // The Archives written in, one pass each, then one more over each: a Ref to a note in an
    // Archive written after its own found nothing to draw to yet.
    static load(plan: ImportPlan): number {
        const panes = (App as any).zetPanes;
        panes.resetAllPanes();
        for (const area of plan.areas) panes.restorePane(area.name, area.text);

        const list = (window as any).zetPaneList as any[];
        for (const pane of list) pane.processor.processAs(ZettelkastenProcessor.Pass.rewrite);
        panes.switchPane(list[0].paneId);

        // Each Archive in its Region (#73), and all of them on screen. Laid out now, in the
        // task that made the cards: the arrival settle, which runs a frame later, skips a
        // card that is `laidOut`.
        const areas = list.map( (pane)=>{
            const nodes: any[] = [];
            pane.processor.forEachNodeWrap( (wrap: any)=>{
                if (wrap.node.removed) return;
                wrap.node.laidOut = true;
                nodes.push(wrap.node);
            });
            nodes.sort( (a, b)=>a.getTitle().localeCompare(b.getTitle(), undefined, {sensitivity: 'base'}) );
            return {paneId: pane.paneId, nodes};
        });
        const rootPane = list.find( (pane)=>(panes.getPaneName(pane.paneId) === plan.root) );
        ZetRegions.layout(areas, rootPane?.paneId ?? null);
        (Hud as any).fitAll();

        const imported = new Set(plan.notes.map( (note)=>note.title ));
        const edges = new Set<unknown>();
        (Graph as any).forEachNode( (node: any)=>{
            if (!imported.has(node.getTitle())) return;
            for (const edge of node.edges) edges.add(edge);
        });
        return edges.size;
    }

    // The menu's row, and the folder input it clicks: a page cannot open a folder dialog on
    // its own, and Safari will not open one for an input it treats as unrendered.
    static wire(): void {
        const button = Elem.byId('import-notes-button');
        const input = Elem.byId('import-notes-input') as HTMLInputElement | null;
        if (!button || !input) return;

        const on = On as any;
        on.click(button, ()=>input.click() );
        on.change(input, ()=>{
            const files = [...(input.files ?? [])];
            // The same folder twice fires no `change` otherwise.
            input.value = '';
            if (files.length) ZetImport.run(files).catch( (err)=>(Logger as any).err('The notes import failed:', err) );
        });
    }
}
ZetImport.wire();
