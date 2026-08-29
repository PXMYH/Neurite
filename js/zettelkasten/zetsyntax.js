class SyntaxHighlighter {
    static escapeHTML(text) {
        return text.replace(/[&<>"']/g, function (match) {
            switch (match) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#39;';
            }
        });
    }

    static escapeHTMLOutsideCodeBlocks(content) {
        const codeBlockRegex = /(```)(html|css|js|javascript|python)?(\s*[\r\n]+)([\s\S]*?)(```)/gi;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = codeBlockRegex.exec(content)) !== null) {
            // Escape the content before this code block
            let beforeCode = content.slice(lastIndex, match.index);
            result += this.escapeHTML(beforeCode);
            // Add the code block as is, wrapped with spellcheck="false"
            result += `<div spellcheck="false">${match[0]}</div>`;
            lastIndex = match.index + match[0].length;
        }
        // Escape any content after the last code block
        if (lastIndex < content.length) {
            let afterCode = content.slice(lastIndex);
            result += this.escapeHTML(afterCode);
        }
        return result;
    }

    static applyCodeBlockHighlighting(content) {
        // Regex to capture multiline code blocks including HTML
        const codeBlockRegex = /<div spellcheck="false">(```)(html|css|js|javascript|python)?(\s*[\r\n]+)([\s\S]*?)(```)<\/div>/gi;
        return content.replace(codeBlockRegex, (match, startDelimiter, languageLabel, leadingWhitespace, codeText, endDelimiter) => {
            const language = this.mapLanguage(languageLabel || '');
            const formattedCode = this.highlightCode(codeText, language);
            // Ensure languageLabel is not undefined
            const languageLabelText = languageLabel ? languageLabel : '';
            return `<div style="font-size: inherit">${startDelimiter}${languageLabelText}${leadingWhitespace}${formattedCode}${endDelimiter}</div>`;
        });
    }

    static mapLanguage(lang) {
        switch (lang.toLowerCase()) {
            case 'js':
            case 'javascript': return 'javascript';
            case 'html': return 'htmlmixed';
            case 'css': return 'css';
            case 'python': return 'python';
            default: return 'htmlmixed';
        }
    }

    static highlightCode(code, language) {
        let highlightedCode = '';
        CodeMirror.runMode(code, language, (text, style) => {
            let className = style ? `class="neurite-${style}"` : '';
            let escapedText = this.escapeHTML(text);
            highlightedCode += `<span ${className}>${escapedText}</span>`;
        });
        return highlightedCode;
    }

    static applyNodeTitleHighlighting(content) {
        const sortedTitles = Array.from(nodeTitles).sort((a, b) => b.length - a.length);
        const titleRegex = new RegExp(`(${sortedTitles.map(RegExp.escape).join('|')})`, 'g');

        return content.replace(titleRegex, (match, title) => {
            const startIndex = content.lastIndexOf('<span', match.index);
            const endIndex = content.indexOf('</span>', match.index);

            if (startIndex !== -1 && endIndex !== -1 && startIndex < match.index && match.index < endIndex) {
                return match;
            } else {
                return `<span class="node-title-sd">${title}</span>`;
            }
        });
    }

    static applyZettelkastenSyntax(content, applyNodeTag = false) {
        const refTag = tagValues.refTag;

        if (applyNodeTag) {
            const nodeTag = tagValues.nodeTag;
            const nodeTagRegex = new RegExp(`\\b${RegExp.escape(nodeTag)}(?!\\w)`, 'gi');
            content = content.replace(nodeTagRegex, `<span class="cm-node">${nodeTag}</span>`);
        }

        if (bracketsMap[refTag]) {
            const openingBracket = refTag;
            const closingBracket = bracketsMap[refTag];
            const refRegex = new RegExp(`(${RegExp.escape(openingBracket)}|${RegExp.escape(closingBracket)})`, 'g');
            content = content.replace(refRegex, match => `<span class="cm-ref">${match}</span>`);
        } else {
            const directRefRegex = new RegExp(`\\b${RegExp.escape(refTag)}(?!\\w)`, 'gi');
            content = content.replace(directRefRegex, `<span class="cm-ref">${refTag}</span>`);
        }

        return content;
    }
}


class ZetSyntaxDisplay {
    static syncAndHighlight(displayDiv, hiddenTextarea) {
        let content = hiddenTextarea.value;

        // Escape HTML outside of code blocks
        content = SyntaxHighlighter.escapeHTMLOutsideCodeBlocks(content);

        // Apply code block highlighting
        content = SyntaxHighlighter.applyCodeBlockHighlighting(content);

        // Apply additional highlighting
        content = SyntaxHighlighter.applyNodeTitleHighlighting(content);
        content = SyntaxHighlighter.applyZettelkastenSyntax(content);

        content += '\n'; // Adds visual spacing

        displayDiv.innerHTML = content;

        // Every span in here was just replaced, so a chip still pointing at one is
        // pointing at a detached node at a stale position.
        ZetPromote.hide();
    }
}


// A bare mention of another note's title is already highlighted, and already
// click-navigates -- `applyNodeTitleHighlighting` above wraps every occurrence of
// every known title, brackets or not. The one thing a bare mention does not do is
// draw an edge, because an edge is stored as `Tag.ref` markup in the prose and
// nothing but typing has ever put it there.
//
// That missing step is what this fills: hover a mention and a chip offers to
// promote it in place, wrapping words that are already written. The chip's label
// is the markup it inserts, which is also how the syntax gets taught now that
// nobody has to type it.
//
// The chip lives in `.editor-wrapper`, never in the overlay. The overlay is
// `pointer-events: none`, its `innerHTML` is rebuilt from the textarea on every
// keystroke, and it has to stay glyph-for-glyph aligned with that textarea -- so
// nothing may be added to it, and nothing may change a span's `textContent`, which
// the click handler below reads as the title.
class ZetPromote {
    static #btn = null;
    static #span = null;

    static get #openTag(){ return tagValues.refTag }
    // Only a bracket-style ref tag can wrap a phrase mid-sentence. A bare tag like
    // `Ref:` claims the rest of its line, so promoting in place would swallow the
    // sentence around the mention. No closing tag, no chip.
    static get #closeTag(){ return bracketsMap[tagValues.refTag] }

    static onMouseOver(e){
        if (e.target.classList.contains('node-title-sd')) ZetPromote.#show(e.target);
    }
    static onMouseOut(e){
        const to = e.relatedTarget;
        if (to === ZetPromote.#btn || to === ZetPromote.#span) return;
        // Reaching the chip means crossing the note's own text, which is neither of
        // those two, so the chip stays for as long as the pointer is in this note.
        // `parentElement` is the `.editor-wrapper` it was appended to.
        if (to && ZetPromote.#btn?.parentElement?.contains(to)) return;
        ZetPromote.hide();
    }
    static hide(){
        ZetPromote.#span = null;
        ZetPromote.#btn?.remove();
    }

    static #show(span){
        ZetPromote.hide();
        if (ZetPromote.#offsetOf(span) === -1) return;

        const overlay = span.closest('.syntax-display-div');
        const wrapper = span.closest('.editor-wrapper');
        const btn = ZetPromote.#btn ??= ZetPromote.#makeBtn();
        btn.textContent = ZetPromote.#openTag + ' ' + ZetPromote.#closeTag;
        btn.title = 'Link this note to "' + span.textContent + '"';
        ZetPromote.#span = span;
        // `offsetParent` is the wrapper -- the overlay between them is static -- so
        // a span's offsets are already in the wrapper's own coordinates, untouched
        // by the canvas transform above it. Only the overlay's scroll comes off.
        // The chip's own size is measurable only once it is in the document.
        wrapper.appendChild(btn);
        const top = span.offsetTop - overlay.scrollTop;
        // Above the mention, the way a selection toolbar sits. Beside it would cover
        // the rest of the sentence being read, which is the habit this is meant to
        // break. Below when the mention is on the note's first line.
        btn.style.top = (top >= btn.offsetHeight ? top - btn.offsetHeight
                                                 : top + span.offsetHeight) + 'px';
        // The note body clips, so a mention near the right edge needs its chip
        // pulled back inside.
        const left = span.offsetLeft - overlay.scrollLeft;
        btn.style.left = Math.min(left, wrapper.clientWidth - btn.offsetWidth) + 'px';
    }

    static #makeBtn(){
        const btn = Html.make.button('zet-promote');
        On.click(btn, ZetPromote.#promote);
        // It floats over the note body, which is also a drag handle for the card.
        On.mousedown(btn, Event.stopPropagation);
        return btn;
    }

    // Where in the editable textarea the hovered mention sits, or -1 when
    // promoting it would be wrong or cannot be verified. The overlay is a separate
    // element from the textarea it mirrors, so a span carries no character offset
    // of its own; a Range from the overlay's start to the span's start measures one.
    static #offsetOf(span){
        const closeTag = ZetPromote.#closeTag;
        if (!closeTag) return -1;

        const wrapper = span.closest('.editor-wrapper');
        const overlay = span.closest('.syntax-display-div');
        const textarea = wrapper?.querySelector('.editable-div');
        if (!overlay || !textarea) return -1;

        const title = span.textContent;
        // A note mentioning its own title would promote to an edge to itself.
        const ownTitle = wrapper.closest('.window')?.querySelector('.title-input')?.value;
        if (title === ownTitle?.trim()) return -1;

        const range = document.createRange();
        range.setStart(overlay, 0);
        range.setEnd(span, 0);
        const offset = range.toString().length;

        // The overlay is escaped HTML wrapped in spans, so the walk above can drift
        // from the plain text it was built from -- and a drifted offset would splice
        // brackets into the middle of a sentence rather than fail. Reading the title
        // back at the offset is what proves it did not drift.
        const value = textarea.value;
        if (value.substr(offset, title.length) !== title) {
            Logger.warn("Mention", JSON.stringify(title), "did not read back at offset", offset);
            return -1;
        }
        // `applyNodeTitleHighlighting` runs before the ref markup is spanned, so a
        // title already inside the tag is highlighted too. Nothing left to promote.
        const openTag = ZetPromote.#openTag;
        if (value.slice(offset - openTag.length, offset) === openTag) return -1;

        return offset;
    }

    static #promote(){
        const span = ZetPromote.#span;
        const offset = (span?.isConnected ? ZetPromote.#offsetOf(span) : -1);
        if (offset === -1) return ZetPromote.hide();

        const title = span.textContent;
        const textarea = span.closest('.editor-wrapper').querySelector('.editable-div');
        const value = textarea.value;
        textarea.value = value.slice(0, offset)
                       + ZetPromote.#openTag + title + ZetPromote.#closeTag
                       + value.slice(offset + title.length);
        ZetPromote.hide();
        // The event a keystroke fires, and the only way in: the card's own `input`
        // handler is what copies this into the hidden textarea the Zettelkasten
        // processor listens to, and that pass is what draws the edge.
        textarea.dispatchEvent(new Event('input'));
    }
}

On.mouseover(document, ZetPromote.onMouseOver);
On.mouseout(document, ZetPromote.onMouseOut);

On.click(document, (e)=>{
    if (e.target.classList.contains('node-title-sd')) {
        const title = e.target.textContent;
        handleTitleClick(title);
    }
});

// Manage scroll behavior and temporarily disable pointer events
On.wheel(document, (e)=>{
    const target = e.target;
    if (target.classList.contains('node-title-sd')) {
        target.style.pointerEvents = 'none'; // Disable pointer events during scroll

        // Clear any existing timeout to avoid conflicts
        clearTimeout(target.pointerEventTimeout);

        // Set a timeout to restore pointer events after a period of inactivity
        target.pointerEventTimeout = setTimeout(() => {
            target.style.pointerEvents = 'auto';
        }, 20); // Adjust delay as necessary based on user behavior and preferences
    }
}, { passive: false });
