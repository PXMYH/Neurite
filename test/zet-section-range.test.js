// Pins where a note's section ends in the notes pane.
//
// A pass reads the pane top-down, and an `AI:` line starts an AI Node's section just as
// a `##` line starts a note's. The parser's title map holds `##` lines only, so the range
// a note's section was given ran on through any AI section below it, to the next `##`.
// One keystroke in such a note put the AI Node's title and prompt on the note's card, and
// typing on that card wrote the note's words into the prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'js/zettelkasten/zetcodemirror.js'), 'utf8');

function slice(what, start){
    const from = SRC.indexOf(start);
    assert.notEqual(from, -1, what + ' should be declared as `' + start + '`');
    const to = SRC.indexOf('\n}\n', from);
    assert.notEqual(to, -1, what + ' should close at column 0');
    return SRC.slice(from, to + 2);
}

// A parser over `text`, with the title map filled the way its change handler fills it.
function makeParser(text){
    const lines = text.split('\n');
    const cm = {
        on(){},
        lineCount: ()=>lines.length,
        getLine: (i)=>lines[i],
        getValue: ()=>lines.join('\n'),
        eachLine(cb){ lines.forEach((text, i)=>cb({text, lineNo: ()=>i})) }
    };
    const sandbox = {Tag: {node: '##', ref: '[['}, LLM_TAG: 'AI:', tagValues: {refTag: '[['}, bracketsMap: {'[[': ']]'},
        Logger: {err(){}, warn(){}, info(){}, debug(){}}};
    vm.runInNewContext([
        // Node 22 has no `RegExp.escape`, which a static field in the class calls.
        "if (!RegExp.escape) RegExp.escape = (s)=>s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
        slice('RegExp.forNodeTitle', 'RegExp.forNodeTitle = function('),
        slice('ZettelkastenParser', 'class ZettelkastenParser {'),
        'globalThis.exported = ZettelkastenParser'
    ].join('\n;\n'), sandbox, {filename: 'ZettelkastenParser.js'});

    const parser = new sandbox.exported(cm);
    parser.updateNodeTitleToLineMap();
    // Spread into this realm, or deepEqual compares against the sandbox's Object.
    const range = (title)=>({...parser.getNodeSectionRange(title)});
    return {parser, range, cm, lines};
}

const PANE = [
    '## Note',          // 0
    'Note body.',       // 1
    '',                 // 2
    'AI: Helper',       // 3
    'What is this?',    // 4
    '## Next',          // 5
    'Next body.'        // 6
].join('\n');

test('a note above an AI section ends where the AI section starts', ()=>{
    const {range} = makeParser(PANE);

    assert.deepEqual(range('Note'), {startLineNo: 0, endLineNo: 2});
});

test('a note with no AI section below runs to the next note, as before', ()=>{
    const {range} = makeParser(PANE.replace('AI: Helper', 'Helper'));

    assert.deepEqual(range('Note'), {startLineNo: 0, endLineNo: 4});
    assert.deepEqual(range('Next'), {startLineNo: 5, endLineNo: 6}, 'and the last runs to the end');
});

test('a note below an AI section keeps its whole section', ()=>{
    const {range} = makeParser(PANE);

    assert.deepEqual(range('Next'), {startLineNo: 5, endLineNo: 6});
});

// A note that already names the other -- in a sentence, not on a line of Refs -- is named
// once. Changing an Edge's direction wrote a second `[[B]]` on a line of its own, because
// the check looked only at the first line that starts with the Ref Tag (#51).
test('adding a Ref a note already has, inside a sentence, writes nothing', ()=>{
    const {parser, cm, lines} = makeParser(['## A', 'See [[B]] for more.', '', '## B', 'b'].join('\n'));
    const before = lines.join('\n');
    cm.replaceRange = ()=>{ throw new Error('nothing should be written') };
    parser.addEdge('A', 'B', cm);
    assert.equal(lines.join('\n'), before);
});
