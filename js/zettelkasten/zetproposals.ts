// Proposed Edges (#72): pairs of notes the Graph could link and does not, each with the reason
// it was found, for the reader to accept or dismiss. The AI bundle comes in with 33 of its 95
// notes on no Edge at all; this is how they get one.
//
// A pair is found by three things, strongest first:
// - a mention: one note's text names the other's Title, whole words, outside a Ref. A one-word
//   Title counts only in its own case: "Setup", "Skills" and "Models" are plain words too, and
//   matched in any case they were proposed for nearly every note of the bundle.
// - the Tags both notes carry, a rare Tag counting for more than a common one.
// - similar wording: the cosine of the two notes' vectors, as a z-score against the note's
//   cosine to every other note -- the local model puts every pair of the bundle between 0.76
//   and 0.94, so a raw cosine says little.
//
// Measured on the bundle by hiding each linked note's own Refs and asking for its top 3: the
// three together found one of its real links for 68% of its 62 linked notes, mentions and
// Tags alone for 65%, similar wording alone for 55%. What is embedded is the note's Title and
// its description, or its first 300 characters when it has none: that ranked better than the
// whole text (55% against 47%) and took 3.6 s for the 95 notes where the whole text took 41.
//
// On demand, and the top 3 for each note with no threshold: a threshold over 95 notes
// proposes thousands. In the Graph-wide list one note is named at most `hubCap` times, or the
// few notes every note mentions take every place in it.
//
// Accepting writes one Ref, into the note the proposal is for, naming the other -- the line a
// reader would type (`addEdgeToZettelkasten`). A dismissed pair is kept with the Graph
// (savenet.js) and not proposed again.
//
// A script, like zetregions.ts; globals are reached through `any` for the same reason.

interface ProposalNote {
    node: any;
    title: string;
    // The text without its frontmatter, the H1 that repeats its Title, or its Refs.
    prose: string;
    tags: string[];
    // What is embedded.
    summary: string;
    // What the note is about, in a line: its description, or its opening.
    gist: string;
    // The Nodes it already has an Edge with.
    linked: Set<any>;
}
interface Mention { at: number; length: number }
// A pair the reader dismissed: both notes by uuid and by Title.
interface Dismissal { uuids: string[]; titles: string[] }
interface Proposal {
    // The note it is for, which the Ref is written into, and the note the Ref names.
    from: number;
    to: number;
    score: number;
    // Which of the two mentions the other, and where.
    mention: (Mention & {note: number}) | null;
    // The Tags they share, rarest first.
    tags: string[];
}

class ZetProposals {
    static perNote = 3;
    static hubCap = 4;
    static weights = {mention: 2, tags: 1, similar: 0.5};
    static openingChars = 300;

    // Dismissed pairs, kept with the Graph, each by both notes' uuids and Titles: the uuid follows
    // a rename, which by Title alone brought the pair back; the Title follows a note deleted and
    // made again -- a section cut and pasted back, an undo. A uuid is handed out once in a session
    // (`Graph.nextUuid`), and one whose notes are gone is dropped when the Graph is saved, so a
    // uuid a reload hands out again finds nothing waiting for it.
    static dismissed: Dismissal[] = [];
    static #uuidKey(a: string, b: string): string { return [a, b].sort().join('|') }
    static #titleKey(a: string, b: string): string {
        return [a, b].map( (title)=>String(title ?? '').trim().toLowerCase() ).sort().join('\n');
    }
    static dismissedKeys(): {uuids: Set<string>, titles: Set<string>} {
        const list = ZetProposals.dismissed;
        // A renamed note's dismissals take its new Title, or its old one would dismiss a new
        // note that takes it.
        const nodes = (Graph as any).nodes;
        for (const d of list) d.titles = d.uuids.map( (uuid, i)=>{
            const node = nodes[uuid];
            return (node && !node.removed && node.getTitle) ? node.getTitle() : d.titles[i];
        });
        return {
            uuids: new Set(list.map( (d)=>ZetProposals.#uuidKey(d.uuids[0], d.uuids[1]) )),
            titles: new Set(list.map( (d)=>ZetProposals.#titleKey(d.titles[0], d.titles[1]) )),
        };
    }
    static isDismissed(a: any, b: any, keys = ZetProposals.dismissedKeys()): boolean {
        return keys.uuids.has(ZetProposals.#uuidKey(a.uuid, b.uuid))
            || keys.titles.has(ZetProposals.#titleKey(a.getTitle(), b.getTitle()));
    }
    static setDismissed(a: any, b: any, on: boolean): void {
        const uuids = ZetProposals.#uuidKey(a.uuid, b.uuid), titles = ZetProposals.#titleKey(a.getTitle(), b.getTitle());
        ZetProposals.dismissed = ZetProposals.dismissed.filter( (d)=>(ZetProposals.#uuidKey(d.uuids[0], d.uuids[1]) !== uuids
            && ZetProposals.#titleKey(d.titles[0], d.titles[1]) !== titles) );
        if (on) ZetProposals.dismissed.push({uuids: [a.uuid, b.uuid], titles: [a.getTitle(), b.getTitle()]});
    }
    // What a Saved Graph keeps: each dismissal with its notes as they are now, none whose notes
    // are gone.
    static dismissedForSave(): Dismissal[] {
        const nodes = (Graph as any).nodes;
        const find = (uuid: string, title: string)=>{
            const node = nodes[uuid];
            return (node && !node.removed && node.getTitle?.() !== undefined) ? node : ((Node as any).byTitle?.(title) ?? null);
        };
        const kept: Dismissal[] = [];
        for (const d of ZetProposals.dismissed) {
            const a = find(d.uuids[0], d.titles[0]), b = find(d.uuids[1], d.titles[1]);
            if (a && b && a !== b) kept.push({uuids: [a.uuid, b.uuid], titles: [a.getTitle(), b.getTitle()]});
        }
        return kept;
    }
    static restoreDismissed(list: unknown): void {
        ZetProposals.dismissed = Array.isArray(list) ? list.filter( (d: any)=>(Array.isArray(d?.uuids) && Array.isArray(d?.titles)
            && d.uuids.length === 2 && d.titles.length === 2) ) : [];
    }

    // A note's Tags, from its frontmatter: `tags: [a, b]`, `tags: a, b`, or a YAML list.
    static tagsOf(head: string): string[] {
        const line = /^tags:[ \t]*(.*)$/m.exec(head);
        if (!line) return [];

        const inline = line[1].trim();
        const items = inline ? inline.replace(/^\[|\]$/g, '').split(',')
            : (/^(?:[ \t]*-[^\n]*(?:\n|$))*/.exec(head.slice(line.index + line[0].length + 1))?.[0] ?? '')
                .split('\n').map( (item)=>item.replace(/^[ \t]*-[ \t]*/, '') );
        const tags = items.map( (tag)=>tag.trim().replace(/^(["'])(.*)\1$/, '$2').replace(/^#/, '').toLowerCase() );
        return [...new Set(tags.filter(Boolean))];
    }

    // Where each note names another's Title in its prose: for note i, a Map from note j to the
    // first mention. `pattern` holds every Title, longest first, between non-word characters
    // (`ZettelkastenUI.titlePattern`), and matches in any case; a one-word Title then has to
    // be in its own.
    static mentions(notes: {title: string, prose: string}[], pattern: RegExp | null): Map<number, Mention>[] {
        const byLower = new Map(notes.map( (note, i)=>[note.title.toLowerCase(), i] ));
        return notes.map( (note, i)=>{
            const found = new Map<number, Mention>();
            if (!pattern) return found;

            for (const match of note.prose.matchAll(pattern)) {
                const j = byLower.get(match[0].toLowerCase());
                if (j === undefined || j === i || found.has(j)) continue;
                if (!/\s/.test(notes[j].title) && match[0] !== notes[j].title) continue;

                found.set(j, {at: match.index ?? 0, length: match[0].length});
            }
            return found;
        });
    }

    // Each note's cosine to every other, as a z-score against the rest of its own row. A note
    // with no vector scores 0 against every note, and every note 0 against it.
    static similarity(vectors: (ArrayLike<number> | null)[]): number[][] {
        const unit = vectors.map( (v)=>{
            if (!v?.length) return null;
            let mag = 0;
            for (let k = 0; k < v.length; k++) mag += v[k] * v[k];
            mag = Math.sqrt(mag);
            return mag ? Array.from(v, (x)=>x / mag) : null;
        });
        return unit.map( (a, i)=>{
            const row = new Array<number>(unit.length).fill(0);
            const cos = new Map<number, number>();
            for (let j = 0; j < unit.length; j++) {
                const b = unit[j];
                if (j === i || !a || !b || b.length !== a.length) continue;

                let dot = 0;
                for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
                cos.set(j, dot);
            }
            if (cos.size < 2) return row;

            const all = [...cos.values()];
            const mean = all.reduce( (s, c)=>s + c, 0 ) / all.length;
            const sd = Math.sqrt(all.reduce( (s, c)=>s + (c - mean) ** 2, 0 ) / all.length) || 1;
            for (const [j, c] of cos) row[j] = (c - mean) / sd;
            return row;
        });
    }

    // Every pair a note could be proposed with, scored: a mention either way, the rarity of the
    // Tags they share, and how much more alike their wording is than the note's usual. `open`
    // says whether a pair may be proposed at all -- not linked, not dismissed.
    // ponytail: every pair, O(n²); a few seconds at 1,000 notes, index by Tag and mention first
    // if Graphs get that large.
    static score(notes: {tags: string[]}[], mentions: Map<number, Mention>[], similar: number[][] | null,
                 open: (i: number, j: number)=>boolean): Proposal[] {
        const n = notes.length;
        const df = new Map<string, number>();
        for (const note of notes) for (const tag of new Set(note.tags)) df.set(tag, (df.get(tag) ?? 0) + 1);
        const idf = (tag: string)=>Math.log(n / (df.get(tag) ?? 1));
        const w = ZetProposals.weights;

        const out: Proposal[] = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            if (i === j || !open(i, j)) continue;

            const here = mentions[i].get(j), there = mentions[j].get(i);
            const mention = here ? {note: i, ...here} : there ? {note: j, ...there} : null;
            // A Tag every note carries says nothing about these two, so it is no reason.
            const tags = notes[i].tags.filter( (tag)=>(notes[j].tags.includes(tag) && idf(tag) > 0) )
                .sort( (a, b)=>(idf(b) - idf(a)) );
            // A pair with no reason is no proposal: "similar wording" is said of a pair more
            // alike than the note's usual, and not at all when there are no vectors.
            const alike = similar?.[i][j] ?? 0;
            if (!mention && !tags.length && alike <= 0) continue;

            const rarity = Math.min(tags.reduce( (s, tag)=>s + idf(tag), 0 ) / Math.log(n), 1.5);
            const score = (mention ? w.mention : 0) + w.tags * rarity + w.similar * alike;
            out.push({from: i, to: j, score, mention, tags});
        }
        return out;
    }

    // The Graph-wide list: notes with no Edge first, then the strongest pairs, at most
    // `perNote` for a note and `hubCap` naming any one note, and each pair once.
    static allocate(proposals: Proposal[], isolated: boolean[],
                    perNote = ZetProposals.perNote, hubCap = ZetProposals.hubCap): Proposal[] {
        const order = [...proposals].sort( (a, b)=>((Number(isolated[b.from]) - Number(isolated[a.from])) || (b.score - a.score)) );
        const per = new Map<number, number>(), named = new Map<number, number>(), pairs = new Set<string>();
        const out: Proposal[] = [];
        for (const p of order) {
            const pair = Math.min(p.from, p.to) + ':' + Math.max(p.from, p.to);
            if (pairs.has(pair) || (per.get(p.from) ?? 0) >= perNote || (named.get(p.to) ?? 0) >= hubCap) continue;

            pairs.add(pair);
            per.set(p.from, (per.get(p.from) ?? 0) + 1);
            named.set(p.to, (named.get(p.to) ?? 0) + 1);
            out.push(p);
        }
        return out;
    }

    // The words around a mention, to quote as its reason: `room` characters either side, cut
    // at a space, with an ellipsis where the text goes on. Read as words, not as Markdown: a
    // link is its text, and emphasis and heading marks go -- the bundle's mentions sit inside
    // links more often than not, and a quote of "[large language models](https://www.nvi" says
    // less than the three words.
    static quote(text: string, at: number, length: number, room = 48): {before: string, match: string, after: string} {
        let start = Math.max(0, at - room), end = Math.min(text.length, at + length + room);
        if (start > 0) {
            const space = text.indexOf(' ', start);
            if (space !== -1 && space < at) start = space + 1;
        }
        if (end < text.length) {
            const space = text.lastIndexOf(' ', end);
            if (space > at + length) end = space;
        }
        const words = (s: string)=>s.replace(/\[([^\]\n]*)\]\([^)\s]*\)?/g, '$1')
            .replace(/\*\*|__|`/g, '').replace(/(^|\s)#{1,6}(?=\s)/g, '$1').replace(/\s+/g, ' ');
        // A link round the mention is cut in two by it: its `[` before, its `](…)` after.
        return {
            before: (start > 0 ? '…' : '') + words(text.slice(start, at).replace(/\[(?=[^\]]*$)/, '')).trimStart(),
            match: text.slice(at, at + length),
            after: words(text.slice(at + length, end).replace(/^([^[]*?)\]\([^)\s]*\)?/, '$1')).trimEnd() + (end < text.length ? '…' : ''),
        };
    }

    // ---- The Graph's side.

    // The Graph's text notes that a Pane holds: a Ref can only be written into, and name, a
    // note with a Title line.
    static notes(): ProposalNote[] {
        const ref = (Tag as any).ref as string;
        const close = (bracketsMap as any)[ref] as string | undefined;
        const escape = (RegExp as any).escape as (s: string)=>string;
        const refs = close ? new RegExp(`${escape(ref)}[^\\n]*?${escape(close)}`, 'g')
            : new RegExp(`^${escape(ref)}.*$`, 'gm');

        const notes: ProposalNote[] = [];
        for (const node of Object.values((Graph as any).nodes) as any[]) {
            const title = (node.isTextNode && !node.removed) ? (node.getTitle?.() ?? '').trim() : '';
            if (!title || !paneHoldingTitle(title)) continue;

            const {head, rest, description} = ZettelkastenParser.splitHead(node.getText?.() ?? '', title);
            const prose = rest.replace(refs, ' ');
            const opening = description ? '' : prose.replace(/\s+/g, ' ').trim().slice(0, ZetProposals.openingChars);
            notes.push({
                node, title, prose,
                tags: ZetProposals.tagsOf(head),
                summary: `${title}. ${description}\n${opening}`.trim(),
                // The words of its Refs kept: without them "Holds what [[RAG]] made" read "Holds what made".
                // `[[Note|shown]]` reads as its shown words, and an embed's `!` goes.
                gist: description || rest.replace(new RegExp(`!(?=${escape(ref)})`, 'g'), '').replace(refs, (found: string)=>(close ? found.slice(ref.length, -close.length).split('|').pop() ?? '' : found.slice(ref.length)))
                    .replace(/\s+/g, ' ').trim().slice(0, 160),
                linked: new Set(node.edges.flatMap( (edge: any)=>edge.pts ).filter( (pt: any)=>(pt !== node) )),
            });
        }
        return notes;
    }

    // One vector a note, by the model and what is embedded: kept for the session and in the
    // browser, so a second look costs nothing and an edited note is embedded again. A note the
    // model gave nothing for is null, and is proposed by mentions and Tags alone.
    //
    // Asked for together, not one after another: each answer waits for a frame of a busy Plane,
    // and 95 stored vectors read in turn took 8.3 s after a reload where together they take a
    // fraction of one. Eight at a time for the model -- the local Worker takes one at a time
    // anyway, and a hosted model gets no burst of 95.
    // ponytail: never pruned -- one ~8 KB entry per version of a note's opening; prune by last
    // use if the store ever matters.
    static #memo = new Map<string, number[]>();
    static #pending = new Map<string, Promise<number[] | null>>();
    static #store = new Stored('proposalVectors');
    // `kept` asks for the vectors already kept and nothing else: the Connect modal's group
    // must not load a model the reader did not ask for -- a 127 MB download the first time.
    static async vectors(notes: ProposalNote[], progress: (done: number)=>void = ()=>{}, kept = false): Promise<(number[] | null)[]> {
        const embeddings = Embeddings as any;
        const model = embeddings.selectModel?.value ?? '';
        const keys = notes.map( (note)=>model + '\n' + note.summary );
        const stored: (number[] | null)[] = await Promise.all(keys.map( (key)=>(ZetProposals.#memo.get(key)
            ?? ZetProposals.#store.load(key).catch( ()=>null )) ));

        const out: (number[] | null)[] = new Array(notes.length).fill(null);
        let next = 0, done = 0, answered = 0, failed = 0;
        const one = async (i: number)=>{
            let vector = stored[i]?.length ? stored[i] : null;
            // A model that has answered nothing three times is not asked for the rest: with its
            // Ollama not running, every note of the bundle was two failed requests and five
            // logged errors.
            if (!vector && !kept && (answered || failed < 3)) {
                vector = await ZetProposals.#fetch(keys[i], notes[i].summary, model);
                if (vector) answered += 1;
                else failed += 1;
            }
            if (vector) ZetProposals.#memo.set(keys[i], vector);
            out[i] = vector;
            progress(++done);
        };
        // One at a time until the model has answered once: a model that is not there costs three
        // requests, not one for every note in flight.
        while (next < notes.length && !answered && failed < 3) await one(next++);
        const lane = async ()=>{ while (next < notes.length) await one(next++) };
        await Promise.all(Array.from({length: Math.min(8, notes.length)}, lane));
        return out;
    }
    // One request a text, however many ask for it: the list opened again while the first was
    // still reading asked for every note a second time, and waited behind the first.
    // With the model the key names, not whichever is chosen by the time the request goes: switched
    // in the middle, the new model's vector was kept under the old one's key.
    static #fetch(key: string, text: string, model: string): Promise<number[] | null> {
        const kept = ZetProposals.#memo.get(key);
        if (kept) return Promise.resolve(kept);
        let pending = ZetProposals.#pending.get(key);
        if (pending) return pending;

        pending = Promise.resolve().then( ()=>(Embeddings as any).fetch(text, model || undefined) ).catch( ()=>null )
            .then( (fetched: any)=>{
                const vector = fetched?.length ? Array.from(fetched as ArrayLike<number>) : null;
                if (vector) {
                    ZetProposals.#memo.set(key, vector);
                    ZetProposals.#store.save(key, vector).catch( ()=>{} );
                }
                return vector;
            })
            .finally( ()=>ZetProposals.#pending.delete(key) );
        ZetProposals.#pending.set(key, pending);
        return pending;
    }

    // The proposals for a Graph's notes: the Graph-wide list, or one note's own when `only` is
    // given (the Connect modal's), which no other note's share of the list limits.
    static propose(notes: ProposalNote[], vectors: (number[] | null)[] | null, only: number | null = null): Proposal[] {
        const mentions = ZetProposals.mentions(notes, ZettelkastenUI.titlePattern());
        const similar = vectors?.some(Boolean) ? ZetProposals.similarity(vectors) : null;
        const keys = ZetProposals.dismissedKeys();
        const open = (i: number, j: number)=>((only === null || i === only)
            && !notes[i].linked.has(notes[j].node)
            && !ZetProposals.isDismissed(notes[i].node, notes[j].node, keys));
        const scored = ZetProposals.score(notes, mentions, similar, open);
        if (only !== null) return scored.sort( (a, b)=>(b.score - a.score) ).slice(0, ZetProposals.perNote);
        return ZetProposals.allocate(scored, notes.map( (note)=>!note.linked.size ));
    }

    // Whether similar wording could be read: off with the AI features, and unavailable when the
    // model gave no vector at all.
    static similarNote(vectors: (number[] | null)[] | null): string {
        if (!vectors) return 'Similar wording is off with the AI features.';
        if (!vectors.some(Boolean)) return 'Similar wording is unavailable: the embeddings model gave nothing back.';
        return '';
    }

    // Accepting: one Ref, into `from`'s text, naming `to`. True when the Edge is there after.
    // Only between two notes still in the Graph: a row outlives a note deleted after the list
    // was made, and linking it wrote a Ref to nothing.
    static link(from: any, to: any): boolean {
        const nodes = (Graph as any).nodes;
        if (from.removed || to.removed || nodes[from.uuid] !== from || nodes[to.uuid] !== to) return false;

        addEdgeToZettelkasten(from.getTitle(), to.getTitle());
        return Boolean(findExistingEdge(from, to));
    }

    // ---- The panel: the Graph-wide list, beside the Graph (`.side-modal`).

    static #generation = 0;
    static shown: {a: any, b: any} | null = null;

    static async open(): Promise<void> {
        const generation = ++ZetProposals.#generation;
        // No row is chosen in a list just made: the line of one chosen before, in a list another
        // dialog replaced, was drawn again with nothing chosen.
        ZetProposals.shown = null;
        const modal = Modal as any;
        modal.open('proposalsModal');
        const body = modal.div.querySelector('.modal-body') as HTMLElement;
        const status = body.querySelector('.proposals-status') as HTMLElement;
        const notes = ZetProposals.notes();
        if (notes.length < 2) {
            status.textContent = 'Edges are proposed between notes, and this Graph has fewer than two.';
            return;
        }

        let vectors: (number[] | null)[] | null = null;
        if ((AiFeatures as any).enabled) {
            status.textContent = `Reading ${notes.length} notes for similar wording…`;
            vectors = await ZetProposals.vectors(notes, (done)=>{
                if (generation === ZetProposals.#generation) status.textContent = `Reading notes for similar wording: ${done} of ${notes.length}`;
            });
        }
        if (generation !== ZetProposals.#generation || modal.current?.id !== 'proposalsModal') return;

        ZetProposals.render(body, notes, ZetProposals.propose(notes, vectors), ZetProposals.similarNote(vectors));
        // The keyboard into the list the reader asked for, as Search puts it in its field.
        (body.querySelector('.proposal-pair') as HTMLElement | null)?.focus({preventScroll: true});
    }

    static render(body: HTMLElement, notes: ProposalNote[], list: Proposal[], note: string): void {
        const reasoned = list.filter( (p)=>(p.mention || p.tags.length) );
        const alike = list.filter( (p)=>!(p.mention || p.tags.length) );
        const isolated = notes.filter( (n)=>!n.linked.size ).length;

        const noEdge = (isolated === 1) ? '1 note has no Edge' : `${isolated} notes have no Edge`;
        const count = (list.length === 1) ? '1 proposal' : `${list.length} proposals`;
        const lead = !list.length ? 'Nothing to propose: no two notes, other than those linked or dismissed, mention each other, share a Tag or read alike.'
            : isolated ? `${noEdge}. ${count}, for those first.` : `${count}.`;
        (body.querySelector('.proposals-status') as HTMLElement).textContent = [lead, note].filter(Boolean).join(' ');

        (body.querySelector('.proposals-list') as HTMLElement).replaceChildren(...reasoned.map( (p)=>ZetProposals.row(notes, p) ));
        const similar = body.querySelector('.proposals-similar') as HTMLDetailsElement;
        similar.hidden = !alike.length;
        (similar.querySelector('summary') as HTMLElement).textContent = `Similar wording only (${alike.length})`;
        (similar.querySelector('.proposals-list') as HTMLElement).replaceChildren(...alike.map( (p)=>ZetProposals.row(notes, p) ));
    }

    static row(notes: ProposalNote[], p: Proposal): HTMLElement {
        const a = notes[p.from], b = notes[p.to];
        const html = Html as any, on = On as any;
        const li = html.new.li() as HTMLElement;
        li.className = 'proposal';

        const pair = html.make.button('proposal-pair') as HTMLButtonElement;
        const arrow = html.make.span('proposal-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';
        pair.append(a.title, arrow, b.title);
        pair.setAttribute('aria-label', `Show ${a.title} and ${b.title}`);

        const link = html.make.button('proposal-link', 'Link') as HTMLButtonElement;
        link.setAttribute('aria-label', `Link ${a.title} to ${b.title}`);
        // What the click writes, and where, before it is written: a Ref Tag with no closing half
        // is written as its own line, `@ Title` (`addEdge`).
        const ref = (Tag as any).ref as string, close = (bracketsMap as any)[ref] as string | undefined;
        link.dataset.tooltip = close ? `Writes ${ref}${b.title}${close} into ${a.title}.`
                                     : `Adds ${b.title} to the ${ref} line of ${a.title}.`;
        const dismiss = html.make.button('proposal-dismiss', 'Dismiss') as HTMLButtonElement;
        dismiss.setAttribute('aria-label', `Dismiss ${a.title} and ${b.title}`);
        const actions = html.make.div('proposal-actions');
        actions.append(link, dismiss);

        // What each note is about, shown once the row is chosen: the two framed across Regions
        // are often a few pixels each, too small to read.
        const gist = html.make.div('proposal-gist');
        for (const note of [a, b]) {
            const line = html.make.span('proposal-gist-line');
            const name = html.create('b');
            name.textContent = note.title + ': ';
            line.append(name, note.gist || 'no text yet');
            gist.append(line);
        }
        li.append(pair, actions, ZetProposals.reason(notes, p), gist);
        on.click(pair, ()=>ZetProposals.show(li, a, b) );
        on.click(link, ()=>ZetProposals.accept(li, a, b) );
        on.click(dismiss, ()=>ZetProposals.dismiss(li, a, b) );
        return li;
    }

    // The reason, as the text it rests on: the words round a mention, or the Tags.
    static reason(notes: ProposalNote[], p: Proposal): HTMLElement {
        const html = Html as any;
        const reason = html.new.p() as HTMLElement;
        reason.className = 'proposal-reason';
        if (p.mention) {
            const holder = notes[p.mention.note];
            const words = ZetProposals.quote(holder.prose, p.mention.at, p.mention.length);
            const line = html.make.span('proposal-why');
            const mark = html.create('mark');
            mark.textContent = words.match;
            const quote = html.create('q');
            quote.append(words.before, mark, words.after);
            line.append(`In ${holder.title}: `, quote);
            reason.append(line);
        }
        if (p.tags.length) {
            const line = html.make.span('proposal-why');
            line.textContent = 'Both tagged ' + p.tags.slice(0, 3).map( (tag)=>'#' + tag ).join(' ');
            reason.append(line);
        }
        if (!p.mention && !p.tags.length) {
            const line = html.make.span('proposal-why');
            line.textContent = 'Similar wording';
            reason.append(line);
        }
        return reason;
    }

    // The reason in a line, for the Connect list, which is too narrow to quote the words.
    static why(p: Proposal): string {
        const parts: string[] = [];
        if (p.mention) parts.push(p.mention.note === p.from ? 'This note mentions it' : 'It mentions this note');
        if (p.tags.length) parts.push('Both tagged ' + p.tags.slice(0, 2).map( (tag)=>'#' + tag ).join(' '));
        return parts.join(' · ') || 'Similar wording';
    }

    // A row's note as it is now: the Node the row was made with, or -- deleted and made again, a
    // section cut and pasted back -- the note that holds its Title. Held to the first alone, a
    // note moved in its Archive after the list was made was "gone".
    static live(note: ProposalNote): any {
        const node = note.node;
        if (!node.removed && (Graph as any).nodes[node.uuid] === node) return node;
        const again = (Node as any).byTitle?.(note.title);
        return (again?.isTextNode && !again.removed) ? again : null;
    }

    // A row chosen: both notes framed, and the Edge it would make drawn dashed between them.
    static show(li: HTMLElement, from: ProposalNote, to: ProposalNote): void {
        const a = ZetProposals.live(from), b = ZetProposals.live(to);
        li.closest('.modal-body')?.querySelectorAll('.proposal.selected').forEach( (row)=>row.classList.remove('selected') );
        li.classList.add('selected');
        // A note gone takes the last row's line with it, not left drawn under this one.
        if (!a || !b) return ZetProposals.hide();

        ZetProposals.shown = {a, b};
        (Hud as any).fit( (node: any)=>(node === a || node === b) );
    }
    static hide(): void {
        ZetProposals.shown = null;
        ZetProposals.draw();
    }

    static accept(li: HTMLElement, from: ProposalNote, to: ProposalNote): void {
        const a = ZetProposals.live(from), b = ZetProposals.live(to);
        const gone = !a || !b;
        const linked = !gone && ZetProposals.link(a, b);
        li.classList.add(linked ? 'accepted' : 'failed');
        const done = (Html as any).make.span('proposal-done');
        done.setAttribute('role', 'status');
        done.textContent = linked ? 'Linked' : gone ? 'A note is gone' : 'Not linked';
        li.querySelector('.proposal-actions')?.replaceChildren(done);
        // The keyboard stays in the row: the Link button it was on is gone.
        (li.querySelector('.proposal-pair') as HTMLElement | null)?.focus({preventScroll: true});
        if (ZetProposals.shown?.a === a && ZetProposals.shown?.b === b) ZetProposals.hide();
    }

    // Dismissed, or back again: the row stays, so a slip is one click to undo.
    static dismiss(li: HTMLElement, from: ProposalNote, to: ProposalNote): void {
        const a = ZetProposals.live(from) ?? from.node, b = ZetProposals.live(to) ?? to.node;
        const dismissed = li.classList.toggle('dismissed');
        ZetProposals.setDismissed(a, b, dismissed);

        const button = li.querySelector('.proposal-dismiss') as HTMLButtonElement;
        button.textContent = dismissed ? 'Undo' : 'Dismiss';
        button.setAttribute('aria-label', `${dismissed ? 'Undo dismissing' : 'Dismiss'} ${a.getTitle()} and ${b.getTitle()}`);
        (li.querySelector('.proposal-link') as HTMLButtonElement).disabled = dismissed;
        if (dismissed && ZetProposals.shown?.a === a && ZetProposals.shown?.b === b) ZetProposals.hide();
    }

    // The dashed line, redrawn with the frame (`nodeStep`) while the panel is open.
    static #path: SVGPathElement | null = null;
    static draw(): void {
        const path = ZetProposals.#path ??= document.getElementById('proposedEdge') as SVGPathElement | null;
        if (!path) return;

        const pair = ZetProposals.shown;
        const on = pair && !pair.a.removed && !pair.b.removed && (Modal as any).current?.id === 'proposalsModal';
        const d = on ? `M ${pair.a.pos.toSvg()} L ${pair.b.pos.toSvg()}` : '';
        if (path.getAttribute('d') !== d) path.setAttribute('d', d);
    }

    static wire(): void {
        const button = Elem.byId('proposeEdgesButton');
        if (button) (On as any).click(button, ()=>{ ZetProposals.open().catch( (err)=>(Logger as any).err('Proposing Edges failed:', err) ) });
    }
}
ZetProposals.wire();
