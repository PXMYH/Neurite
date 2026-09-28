// Where an Archive's notes are on the Plane (#73). A Region belongs to an Archive a notes
// folder was imported into -- one area of the bundle -- and is a disk inside one of the
// Mandelbrot set's primary bulbs: the largest area in the largest bulb, and the notes at the
// folder's top in the main cardioid. Its notes sit in it as a block of cards scaled to fit
// it, so the Plane is a place to learn one's way around, and each area is framed by the
// Fractal's own filaments rather than set on bare black. The Fractal is terrain, not a
// force: every note in a Region is pinned.
//
// Depth means nothing but size: a smaller area is in a smaller bulb, so its cards are
// smaller, and are read by zooming in, as every card of the Plane is.
//
// A script, like zetimport.ts, loaded right after it. Globals are reached through `any` for
// the same reason as there.

// A disk of the Plane (x, y, r), the scale of its cards (s), and the grid its block was laid
// in: `cw` x `ch` cells at scale 1, `cols` x `rows` of them, centred on the disk.
interface Region { x: number; y: number; r: number; s: number; cw?: number; ch?: number; cols?: number; rows?: number }

class ZetRegions {
    // A Region's name is drawn once the Region is this wide on screen: smaller, it is a
    // speck of cards with a word over it.
    static labelMinPx = 40;
    // The side of the square the last block took, and its grid (`place`).
    static lastSide = 0;
    static lastGrid = {cw: 0, ch: 0, cols: 0, rows: 0};

    // The primary bulbs of the set, largest first, as many as asked for. The p/q bulb touches
    // the main cardioid at c = e^{iθ}/2 − e^{2iθ}/4, θ = 2πp/q, and is close to a disk of
    // radius sin(πp/q)/q² lying outward from that point. Exact for 1/2 (centre −1, radius
    // 1/4) and within a few per cent for the others.
    static bulbs(count: number): Region[] {
        const bulbs: Region[] = [];
        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
        for (let q = 2; bulbs.length < count + 8 && q < 64; q++) {
            for (let p = 1; p < q; p++) {
                if (gcd(p, q) !== 1) continue;

                const t = 2 * Math.PI * p / q;
                const rootX = Math.cos(t) / 2 - Math.cos(2 * t) / 4, rootY = Math.sin(t) / 2 - Math.sin(2 * t) / 4;
                const nx = (Math.cos(t) - Math.cos(2 * t)) / 2, ny = (Math.sin(t) - Math.sin(2 * t)) / 2;
                const n = Math.hypot(nx, ny), r = Math.sin(Math.PI * p / q) / (q * q);
                bulbs.push({x: rootX + r * nx / n, y: rootY + r * ny / n, r, s: 0});
            }
        }
        return bulbs.sort( (a, b)=>(b.r - a.r) ).slice(0, count);
    }

    // The Region of an Archive, kept on its Pane's element -- and so in a Saved Graph.
    static of(paneId: string): Region | null {
        const raw = ZetRegions.paneElem(paneId)?.dataset.region;
        if (!raw) return null;
        try { return JSON.parse(raw) as Region } catch { return null }
    }
    static set(paneId: string, region: Region | null): void {
        const elem = ZetRegions.paneElem(paneId);
        if (!elem) return;
        if (region) elem.dataset.region = JSON.stringify(region);
        else delete elem.dataset.region;
    }
    static paneElem(paneId: string): HTMLElement | null {
        return (App as any).zetPanes?.paneContent?.querySelector('#' + paneId) ?? null;
    }
    static paneOf(processor: unknown): any {
        return (window as any).zetPaneList.find( (pane: any)=>(pane.processor === processor) ) ?? null;
    }

    // Each Archive's notes laid out in its Region, largest area first into the largest bulb;
    // the notes at the folder's top in the main cardioid.
    static layout(areas: {paneId: string, nodes: any[]}[], rootPaneId: string | null): void {
        const rest = areas.filter( (a)=>(a.paneId !== rootPaneId && a.nodes.length) )
            .sort( (a, b)=>(b.nodes.length - a.nodes.length) );
        const bulbs = ZetRegions.bulbs(rest.length);
        let largest = 0;
        rest.forEach( (area, i)=>{
            const s = ZetRegions.place(area.nodes, bulbs[i]);
            largest = Math.max(largest, s);
            ZetRegions.set(area.paneId, {...bulbs[i], s, ...ZetRegions.lastGrid});
        });
        // The cardioid is far larger than a bulb, and its block at the bulbs' largest scale
        // fills only its middle: the Region is the disk that block needs, so its name sits
        // over its notes and not over the Agents' bulb above it.
        const root = areas.find( (a)=>(a.paneId === rootPaneId && a.nodes.length) );
        if (root) {
            const cardioid = {x: -0.18, y: 0, r: 0.42, s: 0};
            const s = ZetRegions.place(root.nodes, cardioid, largest || Infinity);
            ZetRegions.set(root.paneId, {...cardioid, r: Math.min(cardioid.r, ZetRegions.lastSide / 1.3), s, ...ZetRegions.lastGrid});
        }
    }

    // A block of cards in the square inside a disk, at the largest scale that fits. Returns
    // the scale. The cell is the largest card's footprint at scale 1, with a gap.
    static place(nodes: any[], disk: Region, maxScale = Infinity): number {
        const graph = Graph as any;
        let w = 0, h = 0;
        for (const node of nodes) {
            const half = graph.planeHalfExtent(node);
            if (!half) continue;
            w = Math.max(w, 2 * half.hw / (node.scale || 1));
            h = Math.max(h, 2 * half.hh / (node.scale || 1));
        }
        const cell = {w: (w || 0.76) * 1.12, h: (h || 0.36) * 1.12};
        const cols = Math.ceil(Math.sqrt(nodes.length)), rows = Math.ceil(nodes.length / cols);
        const side = 1.3 * disk.r;
        const s = Math.min(side / (cols * cell.w), side / (rows * cell.h), maxScale);
        ZetRegions.lastSide = Math.max(cols * cell.w, rows * cell.h) * s;
        ZetRegions.lastGrid = {cw: cell.w, ch: cell.h, cols, rows};
        nodes.forEach( (node, i)=>{
            const col = i % cols, row = Math.floor(i / cols);
            node.scale = s;
            node.pos = new vec2(disk.x + (col - (cols - 1) / 2) * cell.w * s, disk.y + (row - (rows - 1) / 2) * cell.h * s);
            node.anchor = node.pos;
            node.anchorForce = 1;
            node.vel = new vec2(0, 0);
            node.toggleWindowAnchored?.(true);
        });
        return s;
    }

    // Whether a Node is one of a Region's: its Archive has a Region and it sits inside it. Read
    // off the Plane and the Panes rather than a flag, so it holds after a reload.
    static holds(node: any): boolean {
        const title = node.getTitle?.();
        const pane = title ? paneHoldingTitle(title) : null;
        const region = pane ? ZetRegions.of(pane.paneId) : null;
        return Boolean(region) && Math.hypot(node.pos.x - region!.x, node.pos.y - region!.y) <= region!.r;
    }

    // The Archive whose Region holds a point of the Plane, or null.
    static at(z: {x: number, y: number}): string | null {
        for (const pane of (window as any).zetPaneList) {
            const region = ZetRegions.of(pane.paneId);
            if (region && Math.hypot(z.x - region.x, z.y - region.y) <= region.r) return pane.paneId;
        }
        return null;
    }

    // Where a new note of a Region goes: the free cell of its block's grid nearest its middle,
    // inside the disk while there is room, and just outside it once there is not. The path a
    // note otherwise walks from the last one made lands on a neighbour, and the separation
    // then pushed it out of a small Region altogether.
    // `near`, a double-click's point: the note goes there if it is free, else to the free cell
    // nearest it with its middle in the disk. A block is packed a card's width apart, so a note
    // put down on a gap between cards cannot be separated from them in place -- the cards hold
    // still, and it was pushed back and forth between two of them for good (rv11).
    static freeSpot(region: Region, others: any[], near: {x: number, y: number} | null = null): any {
        if (!region.cw || !region.ch || !region.cols || !region.rows) return null;

        const cw = region.cw * region.s, ch = region.ch * region.s;
        const x0 = region.x - (region.cols - 1) / 2 * cw, y0 = region.y - (region.rows - 1) / 2 * ch;
        const free = (x: number, y: number)=>!others.some( (n)=>(Math.abs(n.pos.x - x) < cw * 0.9 && Math.abs(n.pos.y - y) < ch * 0.9) );
        if (near && free(near.x, near.y)) return new vec2(near.x, near.y);
        const cells: {x: number, y: number, d: number, inside: boolean}[] = [];
        for (let row = -3; row < region.rows + 3; row++) for (let col = -3; col < region.cols + 3; col++) {
            const x = x0 + col * cw, y = y0 + row * ch;
            const d = Math.hypot(x - region.x, y - region.y);
            cells.push({x, y, d, inside: d + Math.hypot(cw, ch) / 2 <= region.r});
        }
        if (near) {
            const away = (c: {x: number, y: number})=>Math.hypot(c.x - near.x, c.y - near.y);
            const nearest = cells.filter( (c)=>(c.d <= region.r && free(c.x, c.y)) ).sort( (a, b)=>(away(a) - away(b)) )[0];
            if (nearest) return new vec2(nearest.x, nearest.y);
        }
        // And a full Region, with no free cell inside: the free cell nearest the pointer, not the
        // one nearest the middle, which put a note on the far side of the block (rv12).
        const from = (c: {x: number, y: number, d: number})=>(near ? Math.hypot(c.x - near.x, c.y - near.y) : c.d);
        cells.sort( (a, b)=>((Number(b.inside) - Number(a.inside)) || (from(a) - from(b))) );
        const cell = cells.find( (c)=>free(c.x, c.y) );
        return cell ? new vec2(cell.x, cell.y) : null;
    }
    // A Region takes in a note placed past its edge, so a full Region grows by its new notes
    // instead of losing them: a Region that held one note had no free cell inside it.
    // Only for a note whose middle is past the edge: one made at the rim, its card over the
    // edge, grew a Region with room inside by a fifth (rv11).
    static grow(paneId: string, pos: {x: number, y: number}): void {
        const region = ZetRegions.of(paneId);
        if (!region) return;

        const d = Math.hypot(pos.x - region.x, pos.y - region.y);
        if (d <= region.r) return;

        const half = Math.hypot((region.cw ?? 0) * region.s, (region.ch ?? 0) * region.s) / 2;
        ZetRegions.set(paneId, {...region, r: d + half});
    }
    // A point inside a Region, for a Region saved without its grid.
    static clampInto(region: Region, pos: {x: number, y: number}): any {
        const dx = pos.x - region.x, dy = pos.y - region.y, d = Math.hypot(dx, dy), limit = 0.8 * region.r;
        if (d <= limit) return pos;
        return new vec2(region.x + dx / d * limit, region.y + dy / d * limit);
    }

    // The view framed on an Archive's Region. False when the Archive has none.
    static frame(paneId: string): boolean {
        const region = ZetRegions.of(paneId);
        if (!region) return false;

        // Its block of cards, not the whole disk: the disk left a Region of 17 cards at 75 px
        // a card, too small to read. Through Fit, which leaves the chrome and the open Notes
        // panel the room they take.
        const hud = Hud as any;
        const block = new Set<any>();
        ((window as any).zetPaneList as any[]).find( (pane)=>(pane.paneId === paneId) )?.processor.forEachNodeWrap( (wrap: any)=>{
            const node = wrap.node;
            if (!node.removed && Math.hypot(node.pos.x - region.x, node.pos.y - region.y) <= region.r) block.add(node);
        });
        if (block.size) {
            // With room above the block for the Region's name, which is drawn there.
            const box = hud.contentBounds( (node: any)=>block.has(node) );
            if (box) box.minY -= 0.15 * Math.max(box.maxX - box.minX, box.maxY - box.minY);
            hud.fitBox(box);
            return true;
        }

        (Autopilot as any).stop?.();
        (Graph as any).pan_set(new vec2(region.x, region.y));
        // The zoom first: the centring converts screen pixels at the zoom it finds.
        hud.setZoomMag(region.r * hud.chromeMargin());
        hud.centreOnUsableRect?.();
        return true;
    }

    // Each Region's name, above it on the Plane, redrawn with the frame (`nodeStep`). Sized by
    // how large the Region is on screen, and left out when it is too small to read or when
    // it fills the screen, which is when the reader is in it and has the cards to read.
    static labels = new Map<string, HTMLElement>();
    static draw(): void {
        const panes = (window as any).zetPaneList as any[] | undefined;
        if (!panes) return;

        const layer = ZetRegions.layer();
        const seen = new Set<string>();
        const graph = Graph as any;
        // The same box and offsets `Node.draw` places a card by.
        const box = (svg as any).getBoundingClientRect();
        const w = Math.min(box.width, box.height);
        const off = (box.width < box.height ? box.right : box.bottom);
        for (const pane of panes) {
            const region = ZetRegions.of(pane.paneId);
            if (!region || !layer) continue;

            seen.add(pane.paneId);
            let label = ZetRegions.labels.get(pane.paneId);
            if (!label) {
                label = document.createElement('div');
                label.className = 'region-label';
                layer.append(label);
                ZetRegions.labels.set(pane.paneId, label);
            }
            const name = (App as any).zetPanes.getPaneName(pane.paneId);
            if (label.textContent !== name) label.textContent = name;

            const diameter = 2 * region.r / graph.zoom.mag() * w / 2;
            // Just over the block of cards, on screen, whichever way the view is turned: the
            // block's corners taken to the screen, and the name over the highest. It was put
            // 0.72 radii up the Plane, which at 180 degrees is under the block, and for the
            // folder's top notes -- one row in a disk sized for more -- 150 px above them.
            // With a gap of 0.07 radii, as the name had over a full block: a card is often a little
            // taller than the cell it was measured into, and the name is drawn under the cards.
            const gap = 0.07 * region.r;
            const hx = gap + ((region.cols && region.cw) ? region.cols * region.cw * region.s / 2 : 0.65 * region.r);
            const hy = gap + ((region.rows && region.ch) ? region.rows * region.ch * region.s / 2 : 0.65 * region.r);
            const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
                .map( ([sx, sy])=>fromZtoUV(new vec2(region.x + sx * hx, region.y + sy * hy)) );
            const top = {x: fromZtoUV(new vec2(region.x, region.y)).x, y: Math.min(...corners.map( (c: any)=>c.y ))};
            const shown = diameter >= ZetRegions.labelMinPx && diameter < 2.5 * w
                       && top.x > -0.5 && top.x < 1.5 && top.y > -0.5 && top.y < 1.5;
            label.hidden = !shown;
            if (!shown) continue;

            label.style.left = (top.x * w - (off - box.right) / 2) + 'px';
            label.style.top = (top.y * w - (off - box.bottom) / 2) + 'px';
            label.style.fontSize = Math.max(12, Math.min(34, diameter * 0.09)).toFixed(1) + 'px';
        }
        for (const [paneId, label] of ZetRegions.labels) {
            if (seen.has(paneId)) continue;
            label.remove();
            ZetRegions.labels.delete(paneId);
        }
    }
    // Beside the cards and under them, and not among them: `#nodes` is what a Saved Graph
    // keeps, and a label is drawn from the Region, not saved as one.
    static layer(): HTMLElement | null {
        let layer = document.getElementById('region-labels');
        if (layer) return layer;

        const nodes = document.getElementById('nodes');
        if (!nodes) return null;
        layer = document.createElement('div');
        layer.id = 'region-labels';
        layer.setAttribute('aria-hidden', 'true');
        nodes.before(layer);
        return layer;
    }
}
