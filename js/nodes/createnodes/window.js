class NodeView {
    btnExpand = null;
    circleCollapsed = null;
    funcPopulate = 'populateForNode';
    constructor(node){
        this.id = node.uuid;
        this.model = node;
    }
    static byId(id){ return Graph.nodeViews[id] }

    // Wraps a click callback as a keydown handler, so an element that is only
    // focusable because it was given a `tabindex` still activates the way a real
    // <button> would. Every card control is an SVG element rather than a
    // <button>, so each of them needs this.
    static keyActivates(cb){
        return (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault(); // Space would scroll the page
            e.stopPropagation();
            if (e.repeat) return; // a held key is one activation, not many
            cb(e);
        };
    }

    static windowify(title, content, node, nscale_mult = 1, intrinsicScale = 1){
        const odiv = node.content;
        const div = Html.make.div('window');
        const svg = Elem.deepClone(Elem.byId('elements').children[0]);
        svg.setAttribute('class', 'button-container');

        const headerContainer = Html.make.div('header-container');
        headerContainer.appendChild(svg);

        div.appendChild(headerContainer);
        odiv.appendChild(div);

        const innerContent = Html.make.div('content');
        innerContent.append(...content);
        div.appendChild(innerContent);

        odiv.dataset.init = 'window';

        const inputWrapper = Html.make.div('title-input-wrapper');

        // A textarea, not an `<input type="text">`. The two are interchangeable for
        // everything this title does -- `.value`, `.select()`, `selectionStart` and the
        // paste handler are the same API on both -- and only one of them can wrap. An
        // input is a single-line control, so a title longer than the header simply
        // scrolled out of a box with no scrollbar: 271px of text inside 198px, with the
        // end unreachable and nothing to say it was there.
        const titleInput = NodeView.makeTitleInput(title);

        const copyBtn = Html.make.div('copy-button');
        copyBtn.setAttribute('title', 'Copy title');
        const copyIcon = Elem.deepClone(Elem.byId('copy-icon-template'));
        copyIcon.style.display = ''; // unhide
        copyIcon.setAttribute('class', 'copy-icon'); // ✅ set the class here
        copyBtn.appendChild(copyIcon);

        inputWrapper.appendChild(titleInput);
        inputWrapper.appendChild(copyBtn);
        headerContainer.appendChild(inputWrapper);

        const resizeContainer = Html.make.div('resize-container');
        div.appendChild(resizeContainer);

        const resizeHandle = Html.make.div('resize-handle');
        resizeContainer.appendChild(resizeHandle);

        odiv.dataset.viewType = 'nodeViews';
        odiv.dataset.viewId = node.uuid;

        node.scale = nscale_mult * (Graph.zoom.mag2() ** settings.zoomContentExp);
        node.intrinsicScale = intrinsicScale;
        const view = node.view = new NodeView(node);
        view.div = div;
        view.rewindowify();
        return view;
    }

    init(){
        this.refreshControlIcons();
        this.bindDOMRefs();
        this.initCollapsed();
        this.model.dropdown = document.querySelector('.dropdown');
        this.model.wrapperDivs = document.getElementsByClassName('wrapperDiv');

        On.mousedown(this.headerContainer, NodeView.onHeaderContainerMouseDown);
        this.setWindowDivListeners();
        this.setTitleInputListeners();
        this.setResizeEventListeners();
        this.observeContentResize(); // unknown wrappers
    }

    refreshControlIcons(){
        const header = this.headerContainer || this.div?.querySelector('.header-container');
        if (!header) return;

        const savedButtons = header.querySelector('.button-container');
        const buttonTemplate = Elem.byId('elements')?.children[0];
        if (savedButtons && buttonTemplate) {
            const currentButtons = Elem.deepClone(buttonTemplate);
            currentButtons.setAttribute('class', 'button-container');
            savedButtons.replaceWith(currentButtons);
            this.buttons = currentButtons;
        }

        const copyButton = header.querySelector('.copy-button');
        const savedCopy = copyButton?.querySelector('svg');
        const copyTemplate = Elem.byId('copy-icon-template');
        if (savedCopy && copyTemplate) {
            const currentCopy = Elem.deepClone(copyTemplate);
            currentCopy.style.display = '';
            currentCopy.setAttribute('class', 'copy-icon');
            savedCopy.replaceWith(currentCopy);
            this.copyBtn = copyButton;
        }
    }

    bindDOMRefs() {
        const div = this.div;

        this.headerContainer = div?.querySelector('.header-container') || null;
        this.titleInputWrapper = this.headerContainer?.querySelector('.title-input-wrapper') || null;
        this.titleInput = this.titleInputWrapper?.querySelector('.title-input') || null;
        this.titleInput = this.upgradeTitleInputElement();
        this.collapsedTitle = this.ensureCollapsedTitle();
        this.copyBtn = this.titleInputWrapper?.querySelector('.copy-button') || null;
        this.innerContent = div?.querySelector('.content') || null;
        this.resizeHandle = div?.querySelector('.resize-handle') || null;
        this.buttons = this.headerContainer?.querySelector('.button-container') || null;
    }

    // One row to begin with; `fitTitleHeight` grows it from there. `rows` rather than a
    // CSS height so the box is one line tall before any script has run on it.
    static makeTitleInput(value){
        const el = Html.make.textarea('title-input');
        el.setAttribute('rows', '1');
        // A title is one line of prose, not a paragraph: browsers offer to spell-check a
        // textarea and would underline every node name.
        el.setAttribute('spellcheck', 'false');
        // A textarea's value is its text content, not a `value` attribute -- and a Saved
        // Graph is `innerHTML`, which serialises content and not properties. Set as text
        // so the title is in the markup; `.value` then reads it back.
        el.textContent = value ?? '';
        return el;
    }

    // Every card saved before the title became a textarea comes back with an `<input>`,
    // because a Saved Graph is the markup itself. Swapped here, in the one function both
    // paths run, so an older card gains the wrap rather than keeping the truncation
    // forever. The value moves across; nothing else on the element is load-bearing.
    upgradeTitleInputElement(){
        const old = this.titleInput;
        if (!old || old.tagName !== 'INPUT') return old;

        const el = NodeView.makeTitleInput(old.value ?? old.getAttribute('value') ?? '');
        old.replaceWith(el);
        return el;
    }

    // A textarea does not size to its content, so the height is set from it. Called on
    // bind and on every edit; `auto` first because `scrollHeight` never shrinks below the
    // height already set on the element.
    fitTitleHeight = ()=>{
        const el = this.titleInput;
        if (!el) return;

        el.style.height = 'auto';
        const wanted = el.scrollHeight;

        // A card is built before it is placed, so on the first pass the element is not
        // laid out yet and `scrollHeight` is 0. Writing that pins the title shut -- the
        // box measures nothing and the text is clipped to it, which is the bug this whole
        // change is about, reintroduced by the fix for it. Leave the height that `rows="1"`
        // gives and ask again once the browser has measured something.
        if (wanted < 1) {
            el.style.height = '';
            requestAnimationFrame(this.fitTitleHeight);
            return;
        }

        el.style.height = wanted + 'px';
    }

    // The title a collapsed card shows, created here rather than in the builder because
    // this is the one function both paths run. A Saved Graph is the markup itself, so
    // every card saved before this existed comes back without the element -- built in
    // the builder alone, collapsing one of those would find nothing to write the title
    // into and silently show an empty circle.
    //
    // It exists at all because an `<input>` cannot do this job. A text input is a
    // single-line control, so `white-space` has no effect on it, and its intrinsic width
    // comes from a character count rather than from its content: `width: fit-content`
    // resolved to 302px around 405px of title, which is how the last third of
    // "Agent = Model + Harness + Evals" became unreachable with nothing on screen to say
    // it was there.
    //
    // A sibling rather than a replacement. `titleInput.value` is read in 21 places and
    // editing a title is what an input is good at; this element only ever displays, so
    // it is hidden from the accessibility tree -- the input beside it is already the
    // accessible name.
    ensureCollapsedTitle(){
        const wrapper = this.titleInputWrapper;
        if (!wrapper) return null;

        const existing = wrapper.querySelector('.collapsed-title');
        if (existing) return existing;

        const el = Html.make.div('collapsed-title');
        el.setAttribute('aria-hidden', 'true');
        // Before the copy button, which is absolutely positioned and so does not care,
        // but keeps the reading order of the markup matching the visual one.
        wrapper.insertBefore(el, wrapper.querySelector('.copy-button'));
        return el;
    }

    static onHeaderContainerMouseDown(e){
        if (e.getModifierState(controls.altKey.value)) {
            e.stopPropagation() // Prevent dragging if Alt key is pressed
        }
    }

    setWindowDivListeners(){
        const node = this.model;
        const windowDiv = this.div;
        const dropdown = node.dropdown;
        const wrapperDivs = node.wrapperDivs;

        let clickStartX, clickStartY;

        On.mousedown(windowDiv, (e)=>{
            if (e.getModifierState(controls.controlKey.value)) {
                // Record the starting position of the mouse only if the Alt key is held
                clickStartX = e.clientX;
                clickStartY = e.clientY;
            }
        });

        On.mouseup(windowDiv, (e) => {
            if (e.getModifierState(controls.controlKey.value) && e.button !== 2) {
                const distanceMoved = Math.sqrt(
                    Math.pow(e.clientX - clickStartX, 2) + Math.pow(e.clientY - clickStartY, 2)
                );
                if (distanceMoved < Node.dragThreshold) App.selectedNodes.toggleNode(node);
            }

            if (e.button !== 2) App.menuContext.hide(); // not right mouse button
        });

        On.mousedown(windowDiv, (e)=>{
            Autopilot.stop();
            dropdown.classList.add('no-select');
            Array.from(wrapperDivs).forEach(div => div.classList.add('no-select'));
        });

        On.mouseup(windowDiv, (e)=>{
            dropdown.classList.remove('no-select');
            Array.from(wrapperDivs).forEach(div => div.classList.remove('no-select'));
        });

        On.mouseup(window, (e)=>{
            dropdown.classList.remove('no-select');
            Array.from(wrapperDivs).forEach(div => div.classList.remove('no-select'));
        });

        On.dblclick(windowDiv, (e) => {
            const isTextArea = e.target.tagName === 'TEXTAREA';
            const isContentEditable = e.target.closest('[contenteditable="true"]');

            const isTextInteraction = isTextArea || isContentEditable;
            const altHeld = e.getModifierState(controls.altKey.value);

            if (isTextInteraction && !altHeld) {
                return; // Don’t toggle anchoring if inside text and Alt is not held
            }

            node.anchor = node.pos;
            node.anchorForce = 1 - node.anchorForce;
            node.toggleWindowAnchored(node.anchorForce === 1);
            e.stopPropagation();
        });
    }

    setTitleInputListeners(){
        const titleInput = this.titleInput;
        const copyBtn = this.copyBtn;
        const container = this.headerContainer;

        if (copyBtn && container) {
            container.addEventListener('mouseenter', () => {
                copyBtn.style.visibility = 'visible';
            });
            container.addEventListener('mouseleave', () => {
                copyBtn.style.visibility = 'hidden';
            });

            On.click(copyBtn, async () => {
                try {
                    titleInput.select();
                    await navigator.clipboard.writeText(titleInput.value);
                    copyBtn.classList.add('copied');
                    setTimeout(() => copyBtn.classList.remove('copied'), 600);
                } catch (err) {
                    console.error("Clipboard copy failed:", err);
                }
            });
        }

        let isDragging = false;
        let isMouseDown = false;

        On.paste(titleInput, Event.stopPropagation);

        On.mousedown(titleInput, (e)=>{ isMouseDown = true } );

        On.mousemove(titleInput, (e)=>{
            if (isMouseDown) { isDragging = true; }
            if (isDragging && !e.getModifierState(controls.altKey.value)) {
                titleInput.selectionStart = titleInput.selectionEnd; // Reset selection
            }
        });

        On.mouseup(document, (e)=>{
            isDragging = false;
            isMouseDown = false;
        });

        On.mouseleave(titleInput, (e)=>{ isDragging = false } );

        // A textarea does not grow with its text, so the height follows the content on
        // every edit. Also once now: a restored card arrives with its title already long.
        On.input(titleInput, this.fitTitleHeight);
        this.fitTitleHeight();

        // A textarea keeps its saved value in its text content, and editing changes only
        // the property -- so without this an edited title reverts to whatever it was when
        // the card was built the next time the graph is written out as `innerHTML`. Kept
        // in step on `change` rather than on `input`: writing text content while the
        // reader is typing in it would move the caret to the end on every keystroke.
        On.change(titleInput, ()=>{ titleInput.textContent = titleInput.value });

        // Enter would insert a newline, which an input could not do and a title has no use
        // for -- the header would grow a blank second line and the Zettelkasten tag that
        // mirrors this title would gain a line break in the middle of a name. Treat it as
        // "done" instead, which is what it meant while this was an input.
        On.keydown(titleInput, (e)=>{
            if (e.key !== 'Enter' || e.shiftKey) return;

            e.preventDefault();
            titleInput.blur();
        });
    }

    rewindowify() {
        const node = this.model;
        this.init();

        node.push_extra("window");
        const buttons = this.buttons || this.headerContainer;

        const btnDel = buttons.querySelector('#button-delete');
        const btnFs = buttons.querySelector('#button-fullscreen');
        const btnCol = buttons.querySelector('#button-collapse');

        btnDel.classList.add('windowbutton');
        btnFs.classList.add('windowbutton');
        btnCol.classList.add('windowbutton');

        // Track buttons with their style mode
        this.svgButtons = [];

        // "stroke", not "fill": all three glyphs are stroked paths now, so the
        // colour a state change writes has to land on `stroke`. This is also what
        // `addSvgButton` has always defaulted to, so every button in a card header
        // is finally recoloured through one code path.
        this.svgButtons.push([btnDel, "stroke"]);
        this.applySvgButtonUI(btnDel, async () => {
            const title = node.getTitle();
            // A card carries everything typed into it and there is no undo, so
            // one mis-aimed click while dragging used to lose that work outright.
            // `window.confirm` is the app's own modal (`customdialog.js`), not the
            // browser's, and it resolves to a boolean.
            const named = title?.trim();
            if (!await window.confirm(`Delete ${named ? `"${named}"` : 'this note'}?`)) return;

            if (Node.prev === node) {
                Node.prev = null;
                App.nodeSimulation.mousePath = [];
                App.nodeSimulation.svg_mousePath.setAttribute('d', '');
            }
            node.remove();
            if (node.isTextNode) {
                const nodeInfo = getZetNodeCMInstance(node);
                nodeInfo.parser.deleteNodeByTitle(title);
            }
        }, "stroke");

        this.svgButtons.push([btnFs, "stroke"]);
        this.applySvgButtonUI(btnFs, () => {
            Autopilot.zoomToFitFrame(node).targetZoom_scaleBy(1.2).start();
            if (node.isTextNode) {
                const nodeInfo = getZetNodeCMInstance(node);
                nodeInfo.ui.scrollToTitle(node.getTitle());
                App.zetPanes.switchPane(nodeInfo.paneId);
            }
        }, "stroke");

        this.svgButtons.push([btnCol, "stroke"]);
        this.applySvgButtonUI(btnCol, this.toggleCollapse.bind(this), "stroke");

        On.mouseup(document, (e) => {
            if (node.followingMouse) node.stopFollowingMouse();
        });

        if (this.titleInput) {
            On.focus(this.titleInput, () => this.updateSvgStrokeColor(true));
            On.blur(this.titleInput, () => this.updateSvgStrokeColor(false));
        }
    }

    updateSvgStrokeColor = (focused) => {
        const node = this.model;
        const style = focused ? 'focus' : 'initial';

        for (const [btn, mode] of this.svgButtons || []) {
            this.setSvgButtonStyle(btn, style, mode);
        }

        if (node.displayDiv) node.displayDiv.classList.toggle('focused', focused);
        this.resizeHandle.classList.toggle('focused', focused);
    };

    setSvgButtonStyle(btn, state, mode = "fill") {
        const [fill, stroke] = settings.buttonGraphics[state];

        // Background
        if (btn.children[0]) btn.children[0].setAttribute("fill", fill);

        // Main shape
        if (btn.children[1]) {
            if (mode === "stroke") btn.children[1].setAttribute("stroke", stroke);
            else btn.children[1].setAttribute("fill", stroke);
        }

        // Secondary shape (e.g. refresh arrowhead)
        if (btn.children[2] && btn.children[2].tagName !== "rect") {
            if (mode === "stroke") btn.children[2].setAttribute("stroke", stroke);
            else btn.children[2].setAttribute("fill", stroke);
        }
    }

    applySvgButtonUI(btn, cb = () => {}, mode = "fill") {
        const input = this.titleInput;

        // An SVG group is not focusable and receives no key events, so every
        // card button was mouse-only: no way to delete a node, zoom to it or
        // collapse it from the keyboard. `tabindex` puts the group in the tab
        // order, `role` has it announced as a button, and the keydown handler
        // below supplies the Enter/Space activation a real <button> would have
        // brought with it. Wrapping each glyph in an actual <button> would have
        // been the shorter route, but it changes the SVG that saved graphs
        // re-hydrate. The name comes off the id (`button-delete` -> "delete"),
        // so `addSvgButton` callers are covered without touching their signature.
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('role', 'button');
        if (!btn.hasAttribute('aria-label')) {
            btn.setAttribute('aria-label', btn.id.replace(/^button-/, '').replace(/-/g, ' '));
        }

        const onMouseLeave = () => {
            // Also the blur handler, where `btn` has already lost focus, so the
            // first branch only fires for a pointer leaving a button the Tab key
            // is still sitting on — which should keep its ring rather than go dark.
            const focusState = btn.matches(':focus-visible') ? 'keyFocus'
                             : (input?.matches(':focus') ? 'focus' : 'initial');
            this.setSvgButtonStyle(btn, focusState, mode);
            btn.ready = false;
        };

        On.focus(btn, () => {
            // `:focus-visible`, not plain focus: clicking a button focuses it
            // too, and lighting it up afterwards would leave the card looking
            // like it had a button selected. Same distinction the CSS draws.
            if (btn.matches(':focus-visible')) this.setSvgButtonStyle(btn, 'keyFocus', mode);
        });
        On.blur(btn, onMouseLeave);
        On.keydown(btn, NodeView.keyActivates((e) => {
            this.setSvgButtonStyle(btn, "click", mode);
            cb(e);
        }));
        On.keyup(btn, (e) => {
            if (e.key === 'Enter' || e.key === ' ') this.setSvgButtonStyle(btn, 'keyFocus', mode);
        });

        On.mouseenter(btn, () => this.setSvgButtonStyle(btn, "hover", mode));
        On.mouseleave(btn, onMouseLeave);
        On.mousedown(btn, (e) => {
            this.setSvgButtonStyle(btn, "click", mode);
            btn.ready = true;
            e.stopPropagation();
        });
        On.mouseup(btn, (e) => {
            // A mouseup on the button means the pointer is still inside it, so
            // hover is the state it lands in. Setting "initial" here left the
            // button looking un-hovered until the pointer left and came back,
            // because there is no later mouseenter to correct it. A release
            // outside the button never reaches this handler; mouseleave has
            // already restored the focus-or-initial state by then.
            this.setSvgButtonStyle(btn, "hover", mode);
            e.stopPropagation();
            if (btn.ready) cb(e);
        });

        onMouseLeave();
    }

    static #slotWidth = 20; // pre-scale units between two buttons

    // A card control's place in the row is an x offset baked into its own
    // `transform`, so the row used to be numbered by hand in two places: the
    // three base slots in `icons.html` and a `let x = 59` walk in `linknode.js`.
    // That made "delete goes last" impossible to state, because the buttons a
    // link node appends later would land after it. Numbering the row from one
    // rule here fixes that, and takes the magic offsets with it.
    layOutSvgButtons(){
        const svg = this.buttons;
        if (!svg) return;

        // Move delete to the end of the group rather than sorting a copy of the
        // list: the row sits at the right of the header, so the far end is the
        // slot furthest from the note, and document order is also tab order.
        // `appendChild` moves the existing element, so its listeners come along.
        const btnDel = svg.querySelector('#button-delete');
        if (btnDel) svg.appendChild(btnDel);

        const slot = NodeView.#slotWidth;
        const btns = svg.querySelectorAll('.windowbutton');
        btns.forEach((btn, i) => {
            btn.setAttribute('transform', `scale(0.125 0.125) translate(${i * slot + 1} 1)`);
        });
        svg.setAttribute('viewBox', `0 0 ${(btns.length * slot) / 8} 2.125`);
    }

    addSvgButton(id, iconId, clickHandler, mode = "stroke") {
        const svgNs = "http://www.w3.org/2000/svg";
        const buttons = this.buttons;
        if (!buttons) return;

        // Prevent duplicate creation
        if (buttons.querySelector(`#${id}`)) {
            return buttons.querySelector(`#${id}`);
        }

        const g = document.createElementNS(svgNs, "g");
        g.setAttribute("id", id);
        g.classList.add("windowbutton"); // layOutSvgButtons sets the transform

        // Button background
        const bg = document.createElementNS(svgNs, "rect");
        bg.setAttribute("x", "0");
        bg.setAttribute("y", "0");
        bg.setAttribute("width", "16");
        bg.setAttribute("height", "16");
        bg.setAttribute("fill", "RGB(100,100,100)");
        bg.setAttribute("stroke", "none");
        g.appendChild(bg);

        // Icon from symbol
        const symbol = document.getElementById(iconId);
        if (!symbol) return;

        for (const child of symbol.children) {
            const clone = child.cloneNode(true);
            if (clone instanceof SVGGeometryElement || clone instanceof SVGElement) {
                clone.setAttribute(mode, settings.buttonGraphics.initial[1]);
                g.appendChild(clone);
            }
        }

        // Transparent click area
        const overlay = document.createElementNS(svgNs, "rect");
        overlay.setAttribute("x", "0");
        overlay.setAttribute("y", "0");
        overlay.setAttribute("width", "16");
        overlay.setAttribute("height", "16");
        overlay.setAttribute("fill", "transparent");
        overlay.setAttribute("stroke", "none");
        g.appendChild(overlay);

        buttons.appendChild(g);
        this.applySvgButtonUI(g, clickHandler, mode);
        this.layOutSvgButtons();

        if (!this.svgButtons) this.svgButtons = [];
        this.svgButtons.push([g, mode]);

        return g;
    }

    static addAtNaturalScale(node, title, content, window_it = true){
        if (window_it) {
            if (!Array.isArray(content)) content = [content];
            NodeView.windowify(title, content, node, 0.5);
        } else {
            node.content.appendChild(content);
        }
        Graph.appendNode(node);
        Graph.addNode(node);
        return node.view || node.content;
    }

    // impact on responsiveness?
    // On.resize(window, (e)=>{ } );

    setResizeEventListeners(){
        const node = this.model;
        const inverse2DMatrix = (matrix) => {
            const det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
            if (det === 0) return null;

            const invDet = 1 / det;
            return [
                matrix[3] * invDet,
                -matrix[1] * invDet,
                -matrix[2] * invDet,
                matrix[0] * invDet,
            ];
        };

        const getDivInverseTransformMatrix = (div) => {
            const transform = window.getComputedStyle(div).transform;
            if (transform === 'none') return [1, 0, 0, 1];

            const matrix = transform
                .split('(')[1]
                .split(')')[0]
                .split(',')
                .map(parseFloat)
                .slice(0, 4);
            return inverse2DMatrix(matrix);
        };

        let windowDiv = this.div;

        let startX;
        let startY;
        let startWidth;
        let startHeight;

        let isMouseMoving = false;
        let resizeOverlay = null;

        let lastCall = 0;
        const throttleMs = 8; // ~125 FPS cap

        const handleMouseMove = (e) => {
            const now = performance.now();
            if (now - lastCall < throttleMs) return;
            lastCall = now;
            if (!e.buttons) {
                handleMouseUp();
                return;
            }

            isMouseMoving = true;

            // Calculate the change in position of the mouse considering the accumulated transform matrix
            const scalingFactors = scalingFactorsFromElem(windowDiv);
            const dx = 2 * (e.pageX - startX) / scalingFactors.scaleX;
            const dy = 2 * (e.pageY - startY) / scalingFactors.scaleY;

            const content = this.innerContent;
            const minWidth = content ? content.offsetWidth + 0 : 100;
            const minHeight = content ? content.offsetHeight + 35 : 100;
            const newWidth = Math.max(startWidth + dx, minWidth);
            const newHeight = Math.max(startHeight + dy, minHeight);
            windowDiv.style.maxWidth = `${newWidth}px`;
            windowDiv.style.width = `${newWidth}px`;
            windowDiv.style.height = `${newHeight}px`;

            function setStyles(style, rules) {
                for (const key in rules) {
                    if (style[key] !== rules[key]) style[key] = rules[key];
                }
            }

            if (node.textNodeSyntaxWrapper?.style)
                setStyles(node.textNodeSyntaxWrapper.style, {
                    flexGrow: '1',
                    minHeight: '0px',
                    maxHeight: '100%',
                    width: '100%',
                });

            if (node.htmlView?.style)
                setStyles(node.htmlView.style, {
                    width: '100%',
                    height: '100%',
                });

            if (node.viewerWrapper?.style)
                setStyles(node.viewerWrapper.style, {
                    width: '100%',
                    height: '100%',
                });

            if (node.ainodewrapperDiv?.style)
                setStyles(node.ainodewrapperDiv.style, {
                    flexGrow: '1',
                    width: '100%',
                });

            if (node.fileTreeContainer?.style)
                setStyles(node.fileTreeContainer.style, {
                    width: '100%',
                });
        };

        On.mousedown(this.resizeHandle, (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Use the helper to add an overlay
            OverlayHelper.add('nwse-resize');

            startX = e.pageX;
            startY = e.pageY;
            startWidth = parseInt(document.defaultView.getComputedStyle(windowDiv).width, 10);
            startHeight = parseInt(document.defaultView.getComputedStyle(windowDiv).height, 10);
            isMouseMoving = true; // Indicate that a resize is in progress
            On.mousemove(document, handleMouseMove);
            On.mouseup(document, handleMouseUp);
        });

        const handleMouseUp = () => {
            isMouseMoving = false;
            Off.mousemove(document, handleMouseMove);
            Off.mouseup(document, handleMouseUp);
            // Remove the overlay via the helper
            OverlayHelper.remove();
        };
    }

    resetWindowDivSize(){
        const style = this.div.style;
        style.width = 'fit-content';
        style.height = 'fit-content';
        style.maxWidth = 'fit-content';
        style.maxHeight = 'fit-content';
    }

    observeContentResize(iframeWrapper, displayWrapper){
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;

                const buttonsWrapper = this.div.querySelector(".buttons-wrapper");
                if (!buttonsWrapper) continue;

                const buttonsHeight = buttonsWrapper.offsetHeight || 0;
                const iframeHeight = Math.max(0, height - buttonsHeight - 50); // Subtract additional margin

                iframeWrapper.style.width = width + 'px';
                iframeWrapper.style.height = iframeHeight + 'px';
                displayWrapper.style.width = width + 'px';
                displayWrapper.style.height = iframeHeight + 'px';
            }
        });

        resizeObserver.observe(this.div);
    }

    toggleSelected(value){ this.div.classList.toggle('selected', value) }
    static toggleSelectedToThis(nodeView){ nodeView.toggleSelected(this) }

    // Says where a card just appeared. Not the `selected` class: joining
    // App.selectedNodes would make the next multi-node drag or delete include a
    // card the user never chose.
    flashAsNew(){
        this.div.classList.add('just-created');
        On.animationend(this.div, NodeView.onFlashEnd);
    }
    // A card's DOM is what gets saved, so the class comes back off once the
    // animation has run. Filtered by name rather than listened for with
    // {once: true}, because any animation inside the card (a loader's spin, for
    // one) bubbles its own animationend up to this same div.
    static onFlashEnd(e){
        if (!e.animationName.startsWith('newCard')) return;

        const div = e.currentTarget;
        div.classList.remove('just-created');
        Off.animationend(div, NodeView.onFlashEnd);
    }
}

const OverlayHelper = {
    overlay: null,

    add(cursor = 'auto') {
        // If an overlay already exists, remove it first
        if (this.overlay) this.remove();

        this.overlay = document.createElement('div');
        Object.assign(this.overlay.style, {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 9999,
            background: 'transparent',
            pointerEvents: 'auto',
            cursor,
        });
        document.body.appendChild(this.overlay);
        document.body.style.cursor = '';
    },

    remove() {
        if (!this.overlay) return;

        document.body.style.cursor = 'auto';

        try {
            this.overlay.remove();
        } catch (_) {}

        this.overlay = null;
    }
};

function scalingFactorsFromElem(element) {
    const style = window.getComputedStyle(element);
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    const isZero = (width === 0 || height === 0);

    const rect = element.getBoundingClientRect();
    return {
        scaleX: (isZero ? 1 : rect.width / width),
        scaleY: (isZero ? 1 : rect.height / height)
    };
}

function observeParentResize(parentDiv, iframe, paddingWidth = 50, paddingHeight = 80) {
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const rect = entry.contentRect;
            iframe.style.width = Math.max(0, rect.width - paddingWidth) + 'px';
            iframe.style.height = Math.max(0, rect.height - paddingHeight) + 'px';
        }
    });

    resizeObserver.observe(parentDiv);
    return resizeObserver;
}
