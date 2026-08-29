// Pins what unlinking does to the text a link lives in.
//
// A ref is not a separate field: `[[Title]]` sits in the note's prose, and the
// title inside it reads as part of the sentence. Deleting the whole ref is right
// for a "see also" line, which is nothing but links, and wrong for a sentence,
// which is left with a hole in it -- "and  is the one it leans on". The words also
// have to survive for the same mention to be promotable back into a link.
//
// `ZettelkastenParser` only touches the app through the CodeMirror instance handed
// to its constructor, so the class body evaluates in a sandbox with a fake one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'js/zettelkasten/zetcodemirror.js'), 'utf8');

// A named declaration, lifted out of the file it ships in.
function slice(what, start){
    const from = SRC.indexOf(start);
    assert.notEqual(from, -1, what + ' should be declared as `' + start + '`');
    const to = SRC.indexOf('\n}\n', from);
    assert.notEqual(to, -1, what + ' should close at column 0');
    return SRC.slice(from, to + 2);
}

// Enough of a CodeMirror to be edited: lines, and one whole line replaced at a
// time. The range assertions are the point of the fake -- a line measured after it
// was rewritten would truncate the next edit on the same pass.
function makeCm(text){
    const lines = text.split('\n');
    const cm = {
        lines,
        on(){},
        refresh(){},
        lineCount(){ return cm.lines.length },
        getLine(i){ return cm.lines[i] },
        getValue(){ return cm.lines.join('\n') },
        replaceRange(str, from, to){
            assert.equal(from.line, to.line, 'unlinking rewrites single lines');
            assert.equal(from.ch, 0, 'a replaced line starts at its start');
            assert.equal(to.ch, cm.lines[from.line].length,
                'the range must cover the line as it stands now');
            cm.lines[from.line] = str;
        }
    };
    return cm;
}

// `Tag.ref` is user-settable, and whether it has a closing bracket decides how a
// ref is written: `[[Title]]` on its own, or one comma-separated list per note.
function load(refTag = '[[' ){
    const errors = [];
    const sandbox = {
        Tag: {node: '##', ref: refTag},
        tagValues: {get refTag(){ return sandbox.Tag.ref }},
        bracketsMap: {'[[': ']]', '((': '))', '{{': '}}'},
        PROMPT_IDENTIFIER: '​',
        PROMPT_END: '‎',
        Logger: {debug(){}, info(){}, warn(){}, err(...a){ errors.push(a.join(' ')) }}
    };
    vm.runInNewContext([
        // Node 22 has no `RegExp.escape`, which a static field in the class calls.
        "if (!RegExp.escape) RegExp.escape = (s)=>s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
        slice('RegExp.forNodeTitle', 'RegExp.forNodeTitle = function('),
        slice('escapeRegExp', 'function escapeRegExp('),
        slice('ZettelkastenParser', 'class ZettelkastenParser {'),
        'globalThis.exported = ZettelkastenParser'
    ].join('\n;\n'), sandbox, {filename: 'ZettelkastenParser.js'});
    return {ZettelkastenParser: sandbox.exported, errors};
}

// A parser over `text`, with the title map the real one fills from a change event.
function makeParser(text, refTag){
    const {ZettelkastenParser, errors} = load(refTag);
    const cm = makeCm(text);
    const parser = new ZettelkastenParser(cm);
    text.split('\n').forEach((line, i)=>{
        const m = /^##\s*(.*)$/.exec(line);
        if (m) parser.nodeTitleToLineMap.set(m[1].trim(), i);
    });
    return {cm, parser, errors};
}

// Unlinks and hands back the note's text, which is what the card shows.
function unlink(text, from, to, refTag){
    const {cm, parser, errors} = makeParser(text, refTag);
    parser.removeEdge(from, to, cm);
    return {value: cm.getValue(), errors, cm};
}

test('unlinking a mention inside a sentence keeps the words', ()=>{
    const {value} = unlink(
        '## Zettelkasten\nA note is worth its links, and [[Fractal geometry]] is the one it leans on.\n',
        'Zettelkasten', 'Fractal geometry'
    );

    assert.equal(value,
        '## Zettelkasten\nA note is worth its links, and Fractal geometry is the one it leans on.\n');
});

test('unlinking an entry on a line of links removes the entry', ()=>{
    // Nothing but links on the line, so the words are the link and go with it.
    const {value} = unlink(
        '## Zettelkasten\n[[Fractal geometry]] [[Mandelbrot set]]\n',
        'Zettelkasten', 'Fractal geometry'
    );

    assert.equal(value, '## Zettelkasten\n[[Mandelbrot set]]\n');
});

test('unlinking the last entry leaves no empty markup behind', ()=>{
    const {value} = unlink(
        '## Zettelkasten\n[[Fractal geometry]]\n',
        'Zettelkasten', 'Fractal geometry'
    );

    assert.equal(value, '## Zettelkasten\n\n', 'an empty [[]] would link nothing');
});

test('a second plain mention of the same note survives the unlink', ()=>{
    // The line begins with a ref and still reads as prose, so only the markup goes.
    // A bare title is not a link, and deleting it would edit words nobody linked.
    const {value} = unlink(
        '## Zettelkasten\n[[Fractal geometry]] is why Fractal geometry repeats at every scale.\n',
        'Zettelkasten', 'Fractal geometry'
    );

    assert.equal(value,
        '## Zettelkasten\nFractal geometry is why Fractal geometry repeats at every scale.\n');
});

test('unlinking leaves the rest of a prose line exactly as it was', ()=>{
    // The whole line used to be trimmed, so unlinking silently reflowed a quote or
    // an indented list item that happened to mention another note.
    const {value} = unlink(
        '## Zettelkasten\n    - leans on [[Fractal geometry]], as every note leans somewhere.  \n',
        'Zettelkasten', 'Fractal geometry'
    );

    assert.equal(value,
        '## Zettelkasten\n    - leans on Fractal geometry, as every note leans somewhere.  \n');
});

test('the other links on the line are left alone', ()=>{
    const {value} = unlink(
        '## Zettelkasten\nIt leans on [[Fractal geometry]] and on [[Mandelbrot set]].\n',
        'Zettelkasten', 'Fractal geometry'
    );

    assert.equal(value,
        '## Zettelkasten\nIt leans on Fractal geometry and on [[Mandelbrot set]].\n');
});

test('a link in the next note is not touched', ()=>{
    // Two notes can hold a ref to the same third note, and only this one's goes.
    const {value} = unlink(
        '## Zettelkasten\nIt leans on [[Fractal geometry]].\n'
        + '## Mandelbrot set\nSo does [[Fractal geometry]].\n',
        'Zettelkasten', 'Fractal geometry'
    );

    assert.equal(value,
        '## Zettelkasten\nIt leans on Fractal geometry.\n'
        + '## Mandelbrot set\nSo does [[Fractal geometry]].\n');
});

test('a ref to a note that is not linked changes nothing', ()=>{
    const text = '## Zettelkasten\nIt leans on [[Mandelbrot set]].\n';

    const {value} = unlink(text, 'Zettelkasten', 'Fractal geometry');

    assert.equal(value, text);
});

test('a comma-separated ref line loses only the title named', ()=>{
    // With a ref tag that has no closing bracket, every link of a note shares one
    // line, so that line is a list however much text is on it.
    const {value} = unlink(
        '## Zettelkasten\nref: Fractal geometry, Mandelbrot set\n',
        'Zettelkasten', 'Fractal geometry', 'ref:'
    );

    assert.equal(value, '## Zettelkasten\nref: Mandelbrot set\n');
});

test('a comma-separated ref line goes when its last title does', ()=>{
    const {value} = unlink(
        '## Zettelkasten\nref: Fractal geometry\n',
        'Zettelkasten', 'Fractal geometry', 'ref:'
    );

    assert.equal(value, '## Zettelkasten\n\n', 'a lonely ref tag links nothing');
});

test('unlinking without both titles is refused, and edits nothing', ()=>{
    const text = '## Zettelkasten\nIt leans on [[Fractal geometry]].\n';

    const {value, errors} = unlink(text, 'Zettelkasten', '');

    assert.equal(value, text);
    assert.equal(errors.length, 1, 'a missing title must be reported, not guessed at');
});
