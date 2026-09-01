class TextNode {
    // An empty note would otherwise be a blank rectangle with nothing to say it is
    // typeable, so it says that much and no more. It deliberately does not teach the
    // reference tag: the link strip above the body lists this note's links and its +
    // control is titled "Link this note to another", so a card that also spelled out
    // `[[Title]]` put the mechanism into the space meant for the writing. The syntax is
    // still taught in the ? tab, for the notes pane, where a tag really is typed.
    // `.editable-div::placeholder` gives this a colour of its own -- the textarea's own
    // text colour is near-invisible by design.
    static PLACEHOLDER = 'Write here.';

    static create(name = '', text = '', sx, sy, x, y){
        const textarea = Html.make.textarea('custom-scrollbar node-textarea');
        On.mousedown(textarea, Event.stopPropagation);
        textarea.value = text;

        const editorWrapper = createSyntaxTextarea();  // Now this includes both the input and display div
        editorWrapper.id = 'text-syntax-wrapper';

        const htmlView = Html.make.iframe('html-iframe hidden');
        htmlView.id = 'html-iframe';

        const pythonView = Html.make.div('python-frame hidden');
        pythonView.id = 'python-frame';

        const node = new Node();
        const divView = NodeView.addAtNaturalScale(node, name, [textarea]).div;
        divView.append(htmlView, pythonView, editorWrapper);
        divView.style.minWidth = '100px';
        divView.style.minHeight = '100px';

        // Handle position and scale if necessary
        if (sx !== undefined) {
            const pos = (new vec2(sx, sy)).cmult(Graph.zoom).plus(Graph.pan);
            y = pos.y;
            x = pos.x;
        }

        if (x !== undefined) node.pos.x = x;
        if (y !== undefined) node.pos.y = y;

        node.push_extra_cb( (node)=>({
            f: 'textarea',
            a: {
                p: [0, 0, 1],
                v: node.view.titleInput.value
            }
        }) ).push_extra_cb( (node)=>({
            f: 'textarea',
            a: {
                p: [0, 1, 0],
                v: textarea.value
            }
        }) );

        node.isTextNode = true;
        node.codeEditingState = 'edit';

        TextNode.init(node);

        return node;
    }
    static init(node){
        const content = node.content;

        //No longer a contentEditableDiv, returned to textarea
        const divContentEditable = content.querySelector('.editable-div');
        node.contentEditableDiv = divContentEditable;

        // Assigned here rather than where the textarea is built, because a saved graph is
        // stored as the raw HTML of `#nodes` (`savenet.js`, `Elem.byId('nodes').innerHTML`),
        // so a restored node arrives with whatever `placeholder` attribute it was saved
        // with -- old wording included, forever. This function is the one both paths run
        // through (`TextNode.create` and `savenet.js`'s restore), so setting it here means
        // the hint always comes from the code rather than from the save file.
        divContentEditable.placeholder = TextNode.PLACEHOLDER;

        const divDisplay = content.querySelector('.syntax-display-div');
        node.displayDiv = divDisplay;

        // By class, never by tag. A card holds three textareas -- the title, the body,
        // and the `.editable-div` the reader types into -- and the title comes first in
        // the markup, so `querySelector('textarea')` returns *it*. That was right only
        // while the title was an `<input>`: `upgradeTitleInputElement` made it a textarea
        // so a long title could wrap, and from that commit on `node.textarea` was the
        // title element. Every write meant for the body landed in the title bar, the real
        // body textarea stayed empty, and the card was then blanked from that empty copy
        // on the next pass -- one root cause behind "the title only keeps one character",
        // "body text becomes a `##` heading" and "the second note wipes the first".
        const textarea = content.querySelector('.node-textarea');
        node.textarea = textarea;

        node.htmlView = content.querySelector('#html-iframe');
        node.pythonView = content.querySelector('#python-frame');
        node.textNodeSyntaxWrapper = content.querySelector('#text-syntax-wrapper');

        // Attach events for contentEditable and textarea
        addEventsToUserInputTextarea(divContentEditable, textarea, node, divDisplay);
    }
}
