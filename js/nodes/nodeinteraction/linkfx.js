// The link being drawn, and the moment it is made (#87), after a node editor's connect effect:
// a white wire from the armed card to the pointer; over another note, a ring where the Edge will
// meet that note's side and an arc that jumps to it from the pointer, in the colour of the note
// the link starts from; and on the click that makes it, the Edge flashing in that colour, a ring
// rippling out from where it meets the card and a comet running round the card's edge.
//
// Drawn in screen px, in a layer above the cards that takes no pointer (`#linkFx`, nodes.html),
// from the frame's own boxes (`Node.screenBox`): over a card, the Edge layer under the cards could
// not show the arc that crosses one. Redrawn with the frame (`NodeSimulation.nodeStep`), and hidden
// when there is nothing to draw.
class LinkFx {
    static svg = null;
    static parts = null;
    static bursts = [];
    static reduced = matchMedia('(prefers-reduced-motion: reduce)');
    // How long a burst plays, its ripple and its flash, and its comet, in ms.
    static burstMs = 900;
    static rippleMs = 600;
    static cometMs = 750;

    static #make(tag, cls){
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (cls) el.setAttribute('class', cls);
        return el;
    }
    static #ensure(){
        if (LinkFx.parts) return LinkFx.parts;

        const svg = LinkFx.svg = Elem.byId('linkFx');
        if (!svg) return null;
        const make = LinkFx.#make;
        const parts = LinkFx.parts = {
            wire: make('path', 'link-fx-wire'),
            arcGlow: make('path', 'link-fx-arc-glow'),
            arc: make('path', 'link-fx-arc'),
            arc2: make('path', 'link-fx-arc2'),
            halo: make('circle', 'link-fx-halo'),
            ring: make('circle', 'link-fx-ring'),
            port: make('circle', 'link-fx-port'),
            bursts: make('g', 'link-fx-bursts'),
        };
        svg.append(parts.wire, parts.bursts, parts.arcGlow, parts.arc, parts.arc2, parts.halo, parts.ring, parts.port);
        return parts;
    }

    // A Node's card on screen, or null before it has been drawn.
    static #box(node){
        const box = node?.screenBox?.();
        return (box && box.half.x > 0 && box.half.y > 0) ? box : null;
    }
    static #inside(box, p, pad = 0){
        return Math.abs(p.x - box.centre.x) <= box.half.x + pad && Math.abs(p.y - box.centre.y) <= box.half.y + pad;
    }
    // The card under the pointer other than `armed`: the last one drawn there, which is the one on
    // top. From the frame's boxes rather than `elementFromPoint`, which after the frame's writes
    // would lay the page out again.
    static #targetAt(p, armed){
        let found = null;
        Graph.forEachNode( (node)=>{
            if (node === armed || node.removed) return;
            const box = LinkFx.#box(node);
            if (box && LinkFx.#inside(box, p)) found = node;
        } );
        return found;
    }
    static #curve(points){
        const [p0, c0, c1, p1] = points;
        return 'M ' + p0.x + ' ' + p0.y + ' C ' + c0.x + ' ' + c0.y + ', ' + c1.x + ' ' + c1.y + ', ' + p1.x + ' ' + p1.y;
    }
    // A jagged line from `a` to `b`, new at every frame, pinned at both ends: the arc. Straight
    // under reduced motion.
    static #bolt(a, b){
        const d = b.minus(a), len = d.mag();
        if (LinkFx.reduced?.matches || len < 1) return 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y;

        const n = Math.max(4, Math.round(len / 12));
        const side = new vec2(-d.y / len, d.x / len);
        const amp = Math.min(9, 3 + len * 0.14);
        let path = 'M ' + a.x + ' ' + a.y;
        for (let i = 1; i < n; i++) {
            const t = i / n;
            const p = a.plus(d.scale(t)).plus(side.scale((Math.random() * 2 - 1) * amp * Math.sin(Math.PI * t)));
            path += ' L ' + p.x + ' ' + p.y;
        }
        return path + ' L ' + b.x + ' ' + b.y;
    }

    static draw(now = performance.now()){
        const parts = LinkFx.#ensure();
        if (!parts) return;

        const armed = Node.prev;
        const from = LinkFx.#box(armed);
        const p = Graph.mousePos;
        const drawing = Boolean(from) && !LinkFx.#inside(from, p);
        LinkFx.bursts = LinkFx.bursts.filter( (b)=>(now - b.at < LinkFx.burstMs && !b.target.removed && !b.source.removed) );
        LinkFx.svg.style.display = (drawing || LinkFx.bursts.length) ? '' : 'none';

        LinkFx.#drawArmed(parts, drawing ? armed : null, from, p, now);
        LinkFx.#drawBursts(parts, now);
    }
    static #drawArmed(parts, armed, from, p, now){
        const show = (el, on)=>{ el.style.display = (on ? '' : 'none') };
        // The wire, from the side of the armed card that faces the pointer, as the Edge will leave it.
        const wire = armed && EdgeView.sideCurve(from, {centre: p, half: new vec2(0, 0)});
        if (!wire) {
            for (const el of [parts.wire, parts.arcGlow, parts.arc, parts.arc2, parts.halo, parts.ring, parts.port]) show(el, false);
            return;
        }
        parts.wire.setAttribute('d', LinkFx.#curve(wire.points));
        parts.wire.setAttribute('stroke-width', EdgeView.widthPx(true));
        show(parts.wire, true);

        // Over a note it could be linked to: where the Edge would meet it, and the arc to there.
        const target = LinkFx.#targetAt(p, armed);
        const to = LinkFx.#box(target);
        const meet = to && EdgeView.sideCurve(from, to);
        for (const el of [parts.arcGlow, parts.arc, parts.arc2, parts.halo, parts.ring, parts.port]) show(el, Boolean(meet));
        if (!meet) return;

        const at = meet.points[3];
        const colour = Node.colourOf(armed);
        const bolt = LinkFx.#bolt(p, at);
        for (const el of [parts.arcGlow, parts.arc]) {
            el.setAttribute('d', bolt);
            el.setAttribute('stroke', colour);
        }
        parts.arc2.setAttribute('d', LinkFx.#bolt(p, at));
        parts.arc2.setAttribute('stroke', colour);
        const pulse = (LinkFx.reduced?.matches ? 0 : Math.sin(now / 120));
        for (const [el, r] of [[parts.halo, 14 + pulse], [parts.ring, 9 + pulse * 0.6], [parts.port, 3.5]]) {
            el.setAttribute('cx', at.x);
            el.setAttribute('cy', at.y);
            el.setAttribute('r', r);
        }
        parts.halo.setAttribute('stroke', colour);
        parts.ring.setAttribute('stroke', colour);
    }

    // The click that makes a link: played on the note it was made to, in the colour of the note it
    // came from. `connectNodes` is the gesture's and the link picker's, and the AI's too, so the two
    // gestures call this and the AI does not.
    static burst(source, target){
        if (!source || !target || source === target) return;
        LinkFx.bursts.push({source, target, at: performance.now(), els: null});
    }
    static #drawBursts(parts, now){
        const live = new Set(LinkFx.bursts);
        for (const g of [...parts.bursts.children]) if (!live.has(g.burst)) g.remove();

        for (const b of LinkFx.bursts) {
            const from = LinkFx.#box(b.source), to = LinkFx.#box(b.target);
            if (!b.els) b.els = LinkFx.#makeBurst(parts, b);
            const meet = from && to && EdgeView.sideCurve(from, to);
            b.els.g.style.display = (meet ? '' : 'none');
            if (!meet) continue;

            const t = now - b.at, colour = Node.colourOf(b.source);
            const curve = meet.points;
            const at = curve[3];
            const reduced = LinkFx.reduced?.matches;

            // The Edge flashing in, wide and bright, settling into the drawn one.
            const flash = Math.max(0, 1 - t / LinkFx.rippleMs);
            const d = LinkFx.#curve(curve);
            for (const [el, w, o] of [[b.els.flashGlow, 10, 0.35], [b.els.flash, 3, 1]]) {
                el.setAttribute('d', d);
                el.setAttribute('stroke', colour);
                el.setAttribute('stroke-width', (reduced ? w : w * (0.5 + 0.5 * flash)));
                el.setAttribute('stroke-opacity', o * flash);
            }

            // The ring rippling out from where the Edge meets the card.
            const ease = 1 - (1 - Math.min(1, t / LinkFx.rippleMs)) ** 3;
            b.els.ripple.setAttribute('cx', at.x);
            b.els.ripple.setAttribute('cy', at.y);
            b.els.ripple.setAttribute('r', (reduced ? 9 : 6 + 34 * ease));
            b.els.ripple.setAttribute('stroke', colour);
            b.els.ripple.setAttribute('stroke-opacity', 0.9 * flash);

            // The comet round the card's edge, from where the Edge meets it.
            if (reduced) { b.els.comet.style.display = b.els.cometGlow.style.display = 'none'; continue; }
            const {path, length, start} = LinkFx.#rim(to, at, b.target.view?.div?.classList.contains('collapsed'));
            const progress = Math.min(1, t / LinkFx.cometMs);
            // Grown out of where the Edge meets the card, with no tail behind that point.
            const run = length * 0.45 * (1 - (1 - progress) ** 2);
            const head = start + run;
            const comet = Math.max(0.5, Math.min(length * 0.18, run));
            const fade = (progress < 0.6 ? 1 : Math.max(0, 1 - (progress - 0.6) / 0.4));
            for (const [el, w, o] of [[b.els.cometGlow, 12, 0.5], [b.els.comet, 2.5, 1]]) {
                el.setAttribute('d', path);
                el.setAttribute('stroke', colour);
                el.setAttribute('stroke-width', w);
                el.setAttribute('stroke-opacity', o * fade);
                el.setAttribute('stroke-dasharray', comet + ' ' + (length - comet));
                el.setAttribute('stroke-dashoffset', comet - head);
            }
        }
    }
    static #makeBurst(parts, b){
        const make = LinkFx.#make;
        const g = make('g', 'link-fx-burst');
        g.burst = b;
        const els = {g, flashGlow: make('path', 'link-fx-flash-glow'), flash: make('path', 'link-fx-flash'),
                     ripple: make('circle', 'link-fx-ripple'), cometGlow: make('path', 'link-fx-comet-glow'),
                     comet: make('path', 'link-fx-comet')};
        g.append(els.flashGlow, els.flash, els.ripple, els.cometGlow, els.comet);
        parts.bursts.append(g);
        return els;
    }
    // A card's edge as a path that starts at its top-left corner and runs clockwise, its length, and
    // how far along it `at` lies -- the middle of the side the Edge meets. A circle for a collapsed
    // card, which is one.
    static #rim(box, at, round){
        const {centre: c, half: h} = box;
        const r = (round ? Math.min(h.x, h.y) : Math.min(6, h.x, h.y));
        const [x0, y0, x1, y1] = [c.x - h.x, c.y - h.y, c.x + h.x, c.y + h.y];
        const w = x1 - x0 - 2 * r, v = y1 - y0 - 2 * r, q = Math.PI * r / 2;
        const path = 'M ' + (x0 + r) + ' ' + y0 + ' H ' + (x1 - r)
                   + ' A ' + r + ' ' + r + ' 0 0 1 ' + x1 + ' ' + (y0 + r) + ' V ' + (y1 - r)
                   + ' A ' + r + ' ' + r + ' 0 0 1 ' + (x1 - r) + ' ' + y1 + ' H ' + (x0 + r)
                   + ' A ' + r + ' ' + r + ' 0 0 1 ' + x0 + ' ' + (y1 - r) + ' V ' + (y0 + r)
                   + ' A ' + r + ' ' + r + ' 0 0 1 ' + (x0 + r) + ' ' + y0 + ' Z';
        const length = 2 * w + 2 * v + 4 * q;
        // The four side middles, in the order the path passes them: top, right, bottom, left.
        const mids = [[c.x, y0, w / 2], [x1, c.y, w + q + v / 2], [c.x, y1, w + 2 * q + v + w / 2], [x0, c.y, 2 * w + 3 * q + v + v / 2]];
        let start = 0, best = Infinity;
        for (const [mx, my, s] of mids) {
            const dist = Math.hypot(mx - at.x, my - at.y);
            if (dist < best) { best = dist; start = s; }
        }
        return {path, length, start};
    }
}
