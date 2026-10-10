// A card's links, shown on the card: one chip per connected node, under the
// title, with a control to add one and a control to cut one. Typing `[[ ]]` was
// the only way to see or change a note's links, so a card could not answer "what
// does this connect to" without reading its prose for markup.
//
// This is a *view* of the prose, never a store. An edge between two text notes is
// held as `Tag.ref` markup inside the note body, and `handleRefTags` deletes any
// edge whose ref is absent from the text on the next pass -- so a copy of the
// links kept here would be silently overwritten on the next keystroke. Everything
// below reads `node.edges` and writes back only by calling the same helpers the
// connect modal calls, which edit the prose.
//
// It repaints from a poll in `Node.step` rather than from the places edges change.
// Seven sites mutate `node.edges`: two push straight onto the array in connect.js,
// one assigns a whole new array in zettelkasten.js, and only two route through
// `updateEdgeData`. Hooking the mutations would therefore miss `connectDistance`,
// which is the path every Zettelkasten edge takes -- including the one a promoted
// mention draws. A poll cannot be bypassed and cannot go stale.
//
// ponytail: the poll builds one short string per card per frame. That sits next to
// the `getBoundingClientRect` `Node.draw` already forces on the same card in the
// same frame, so it is not what a big graph would notice first. Move it onto an
// event if the mutation sites are ever funnelled into one.
class LinkStrip {
    // Repaints `view`'s strip when its links have changed, and does nothing on
    // every other frame. The signature is uuid and title per link, so a note
    // renamed elsewhere on the canvas relabels the chips that point at it.
    static refresh(view){
        const node = view?.model;
        if (!node || !view.div) return;

        const links = [];
        // `forEachConnectedNode(cb, ct)` invokes `cb.call(ct, otherNode)`, so the
        // array is the receiver and `push` is the whole callback.
        node.forEachConnectedNode(Array.prototype.push, links);

        const sig = links.map(LinkStrip.#keyOf).join('\0');
        if (sig === view.linkSig) return;

        view.linkSig = sig;
        LinkStrip.#render(view, links);
    }

    static #titleOf(node){ return node.view?.titleInput?.value ?? '' }
    static #keyOf(node){ return node.uuid + ' ' + LinkStrip.#titleOf(node) }

    static #render(view, links){
        const strip = LinkStrip.#ensure(view);
        // Clearing drops the old chips' listeners with them, so nothing here has
        // to be unbound by hand.
        strip.textContent = '';
        for (const other of links) {
            strip.appendChild(LinkStrip.#makeChip(view.model, other));
        }
        strip.appendChild(LinkStrip.#makeAdd(view.model));
    }

    // The strip is a child of `.window`, so a saved graph re-hydrates with one
    // already in it -- and its chips come back without listeners, because those do
    // not serialize. Finding it rather than making a second one is what lets the
    // first frame after a load rebuild the row in place.
    static #ensure(view){
        const existing = view.div.querySelector(':scope > .link-strip');
        if (existing) return existing;

        const strip = Html.make.div('link-strip');
        // Between the header and the note body: a card's links belong to its
        // title, not to a corner of its prose. A null reference node appends,
        // which is the right answer for a card whose header is somehow last.
        view.div.insertBefore(strip, view.headerContainer?.nextSibling ?? null);
        return strip;
    }

    static #makeChip(node, other){
        const title = LinkStrip.#titleOf(other);
        const chip = Html.make.span('link-chip');

        // A real <button>, not a tabindex'd span: the chip is chrome over a card
        // whose body is a drag handle, and a button brings its own keyboard
        // activation, focus ring and role.
        const label = Html.make.button('link-chip-label', title || '(untitled)');
        label.title = 'Go to "' + title + '"';
        On.click(label, ()=>Animation.zoomToNodeTitle(other));

        const cut = Html.make.button('link-chip-cut', '×');
        cut.title = 'Unlink "' + title + '"';
        cut.setAttribute('aria-label', 'Unlink ' + title);
        On.click(cut, ()=>LinkStrip.#unlink(node, other));

        chip.append(label, cut);
        // In the colour of the Node it names, as the Edge to that Node is at its end (#77).
        chip.style.setProperty('--chip-colour', Node.colourOf(other));
        LinkStrip.#dontDragTheCard(chip);
        return chip;
    }

    // Cutting a link means deleting the ref that made it. `Edge.removeInstance` is
    // the one place that already knows to rewrite both notes' prose when both ends
    // are text nodes, and to drop the edge outright for anything else.
    static #unlink(node, other){
        const edge = findExistingEdge(node, other);
        if (!edge) {
            Logger.warn("No edge between", node.uuid, "and", other.uuid, "to unlink");
            return;
        }
        edge.removeInstance();
    }

    // The way to connect a Node that every Node shows, so it keeps its word beside chips:
    // it shrank to a bare "+" after the first link, the moment it stopped being the only
    // thing in the row. Its tooltip teaches the shortcut (#50).
    static #makeAdd(node){
        const btn = Html.make.button('link-add', '+ link');
        btn.title = 'Link to another node. Or hold Shift, click this node, then the other.';
        On.click(btn, ()=>{ new Modal.Connect(node) });
        LinkStrip.#dontDragTheCard(btn);
        return btn;
    }

    // The card moves when its body is pressed, so a press that starts on a control
    // in this row would otherwise fling the note across the canvas.
    static #dontDragTheCard(elem){ On.mousedown(elem, Event.stopPropagation) }
}
