// The first file in js/ written in TypeScript. See
// docs/adr/0002-typescript-in-the-load-path.md for why the language changed and why
// nothing about the load path did: the entry in PageLoad.scripts still reads
// 'js/zettelkasten/zetsplitter.js', at the same position it always held.
//
// ZetSplit cuts one run of prose into Node Sections a Pane can hold: a Title line
// built from the first few words, then the prose, optionally with a Ref to the
// section before and after so the Nodes arrive already connected.

// Nothing is imported and nothing is declared: `tagValues`, `getClosingBracket` and
// `checkBracketsMap` come from js/globals.js, which loads first. A TypeScript file
// with no import and no export is a *script*, and scripts share one global scope --
// the same arrangement PageLoad.scripts builds at runtime -- so the types cross the
// file boundary even though nothing else does.

class ZetSplit {
    maxSentencesPerNote: number;
    maxCharsPerNote: number;
    connectNotes: boolean;

    constructor(maxSentencesPerNote: number = 5, maxCharsPerNote: number = 500, connectNotes: boolean = false){
        this.maxSentencesPerNote = maxSentencesPerNote;
        this.maxCharsPerNote = maxCharsPerNote;
        this.connectNotes = connectNotes;
    }

    splitText(text: string): string[] {
        const sections: string[] = [];
        const paragraphs = text.split(/\n\n+/);

        paragraphs.forEach( (paragraph)=>{
            const sentences = paragraph.match(/[^.!?]+[.!?]/g) || [paragraph];
            if (sentences.length > this.maxSentencesPerNote) {
                this._processLongParagraph(sentences, sections);
            } else {
                sections.push(paragraph);
            }
        });

        return this._formatSections(sections);
    }

    _processLongParagraph(sentences: string[], sections: string[]): void {
        let currentChunk = '';
        sentences.forEach( (sentence)=>{
            if (currentChunk.length + sentence.length > this.maxCharsPerNote) {
                sections.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += ' ' + sentence;
            }
        });
        if (currentChunk.trim().length > 0) {
            sections.push(currentChunk.trim());
        }
    }

    // A Ref is written with the reader's own Ref Tag, and closed only when that tag is
    // one half of a bracket pair. `checkBracketsMap` is the question, so it has to be
    // called: the two call sites here read `checkBracketsMap ?`, which is a function
    // object and therefore always truthy, so a Ref Tag with no closing half used to
    // append the string "undefined" to the text. TypeScript reports that as TS2774 --
    // it is the first defect the conversion found, and test/zetsplit.test.js pins it.
    #ref(title: string): string {
        if (!checkBracketsMap()) return tagValues.refTag + title;

        return tagValues.refTag + title + getClosingBracket(tagValues.refTag);
    }

    static #titleOf(section: string): string {
        return section.split(/\s+/).slice(0, 4).join(' ');
    }

    _formatSections(sections: string[]): string[] {
        return sections.map( (section, index)=>{
            const titleWords = ZetSplit.#titleOf(section);
            const title = titleWords.length > 4 ? titleWords : section.slice(0, 30);
            let formattedSection = `${tagValues.nodeTag} ${title}\n${section}`;

            if (this.connectNotes) {
                const prev = sections[index - 1];
                const next = sections[index + 1];
                if (prev !== undefined) formattedSection += '\n\n' + this.#ref(ZetSplit.#titleOf(prev));
                if (next !== undefined) formattedSection += '\n\n' + this.#ref(ZetSplit.#titleOf(next));
            }

            return formattedSection;
        });
    }
}

const zetSplit = new ZetSplit(5, 500, false);
