// The hover tooltip for the canvas chrome.
//
// The tools in the pill carry no labels any more, so a tool's name has to arrive
// on hover, and `title` cannot be what delivers it: the browser waits about a
// second before showing one, paints it in the OS's own box, and places it at the
// cursor rather than against the control. A pill floating over a fractal that
// answers "what is this?" a second late in a system font reads as an accident.
//
// Excalidraw hits the same wall with the same toolbar and solves it the same way
// -- one div appended to `body`, shown on pointer enter, positioned against the
// hovered element's rect and clamped to the viewport
// (`packages/excalidraw/components/Tooltip.tsx`, `Tooltip.scss`). This is that,
// without the React: `updateTooltipPosition` is `HoverTooltip.place`.
//
// Attribute-driven and delegated from `document`, unlike `Tooltip` in
// customtooltip.js, which is bound per element and carries a payload. A control
// opts in with `data-tooltip="..."` and nothing else: there is no registration
// call to forget, and markup that arrives later -- a tab's HTML is fetched after
// boot -- is covered the moment it lands.
class HoverTooltip {
    static selector = '[data-tooltip]';
    static gap = 6; // between the control and the box
    static elem = null;
    static target = null;

    static show(target) {
        const text = target.dataset.tooltip;
        if (!text) return;

        const elem = HoverTooltip.element();
        elem.textContent = text;
        // Shown before it is placed, because the text decides the width and a
        // display: none box measures 0. One frame, so no flash: both happen in
        // this handler, before the browser paints.
        elem.classList.add('ui-tooltip-visible');
        HoverTooltip.target = target;
        HoverTooltip.place(target.getBoundingClientRect());
    }

    static hide() {
        HoverTooltip.target = null;
        if (HoverTooltip.elem) HoverTooltip.elem.classList.remove('ui-tooltip-visible');
    }

    static place(rect) {
        const elem = HoverTooltip.elem;
        const box = elem.getBoundingClientRect();
        const gap = HoverTooltip.gap;

        // Centred under the control, then pulled back inside the window. The pill
        // is centred at the top, so its outer tools are near the edges on a phone
        // and the box would otherwise hang off the screen.
        const left = Math.min(Math.max(gap, rect.left + (rect.width - box.width) / 2),
                              window.innerWidth - box.width - gap);

        // Below by default: everything in the top island has the whole canvas under
        // it. Above only when the box would fall off the bottom, which is where the
        // menu button in the opposite corner puts it.
        let top = rect.bottom + gap;
        if (top + box.height > window.innerHeight) top = rect.top - box.height - gap;

        elem.style.left = Math.round(left) + 'px';
        elem.style.top = Math.round(top) + 'px';
    }

    static element() {
        if (!HoverTooltip.elem) {
            // `body`, not the chrome root: `.dropdown > *` turns pointer events back
            // on for every child of that root, and this box must never take one --
            // a box under the cursor fires `mouseout` on the control it describes,
            // which hides it, which un-fires it, forever.
            HoverTooltip.elem = Html.make.div('ui-tooltip');
            document.body.appendChild(HoverTooltip.elem);
        }
        return HoverTooltip.elem;
    }
}

// `mouseenter` does not bubble, so the delegated pair is `mouseover`/`mouseout`
// and the control is read out of the event target. Cheap: these fire when the
// hovered element changes, not per pixel.
On.mouseover(document, (e)=>{
    const target = e.target.closest?.(HoverTooltip.selector);
    if (target === HoverTooltip.target) return;
    if (target) HoverTooltip.show(target);
    else HoverTooltip.hide();
});

// Moving from a control onto anything else fires `mouseover` there and the handler
// above hides the box. Leaving the window fires no `mouseover` at all, which is
// what this is for.
On.mouseout(document, (e)=>{
    if (!HoverTooltip.target) return;
    if (e.relatedTarget) return;
    HoverTooltip.hide();
});

// Pressing a tool starts a drag-out-to-place, and a name trailing the cursor
// through that is noise. Capture phase, because the islands stop `mousedown` from
// reaching `document` in the bubble phase (dropdown.js) so the canvas beneath them
// is never dragged.
On.mousedown(document, HoverTooltip.hide, true);

// Tab reaches the tools as well, and a focused icon with no name is the same dead
// end the labels were removed from. `focus` does not bubble either, hence capture.
// `:focus-visible` filters out the focus a click leaves behind, which would strand
// a box on screen after the cursor has moved on.
On.focus(document, (e)=>{
    const target = e.target.closest?.(HoverTooltip.selector);
    if (target && target.matches(':focus-visible')) HoverTooltip.show(target);
}, true);

On.blur(document, HoverTooltip.hide, true);
