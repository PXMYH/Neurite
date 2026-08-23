// ZetSplit is the first file in js/ written in TypeScript, so this is also the worked
// example for testing one: a .ts file cannot be sliced straight into a node:vm
// context the way a .js one can, because type annotations are not JavaScript. One
// transpile hop through the TypeScript compiler's transpileModule is the whole
// difference -- it strips types and checks nothing, which is the right split here.
// `npm run typecheck` is what checks types; a test still tests behaviour.
//
// What is being pinned is the Ref writing. ZetSplit asks `checkBracketsMap` whether
// the reader's Ref Tag is one half of a bracket pair, and the two call sites read
// `checkBracketsMap ?` -- the function object, never called, so always truthy. A Ref
// Tag with no closing half therefore appended the string "undefined" to the Pane
// text. The conversion is what surfaced it: TypeScript reports that expression as
// TS2774 ("this condition will always return true since this function is always
// defined"). Revert the fix and the third test fails on literal "undefined".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const path = 'js/zettelkasten/zetsplitter.ts';

// Only the halves ZetSplit actually reaches for, kept literal: js/globals.js builds
// the real map, and a Ref Tag the reader picked may well not be in it.
const brackets = {'[[': ']]', '((': '))'};

// `refTag` is a parameter because Tag.node and Tag.ref are the reader's to change --
// a test that hardcodes '##' or '[[' would pass while the feature was broken for
// anyone who changed them.
function loadZetSplit({nodeTag = '##', refTag = '[['} = {}){
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
        fileName: path
    }).outputText;

    const sandbox = createContext({
        tagValues: {nodeTag, refTag},
        getClosingBracket: (open)=> brackets[open],
        checkBracketsMap: ()=> Object.hasOwn(brackets, refTag)
    });
    // A top-level `class` is a lexical binding and never lands on the sandbox global,
    // so the name has to be handed out from inside the same script scope.
    runInContext(js + '\n;globalThis.exported = ZetSplit;', sandbox, {filename: path});
    return sandbox.exported;
}

test('one paragraph becomes one Node Section, titled by its first four words', ()=>{
    const ZetSplit = loadZetSplit();
    const sections = [...new ZetSplit().splitText('The Graph holds every Node.\n\nThe Fractal is the terrain.')];

    assert.deepStrictEqual(sections, [
        '## The Graph holds every\nThe Graph holds every Node.',
        '## The Fractal is the\nThe Fractal is the terrain.'
    ]);
});

test('a paragraph past the character cap is cut into chunks under it', ()=>{
    const ZetSplit = loadZetSplit();
    // Six sentences past maxSentencesPerNote, each 20 characters, against a 50
    // character cap: the cut is by characters once the sentence count opens it up.
    const sentence = 'Nodes drift outward.';
    const sections = [...new ZetSplit(5, 50).splitText(sentence.repeat(6))];

    assert.ok(sections.length > 1, 'expected more than one Node Section, got ' + sections.length);
    for (const section of sections) {
        const prose = section.split('\n').slice(1).join('\n');
        assert.ok(prose.length <= 50 + sentence.length,
            'a chunk ran to ' + prose.length + ' characters against a cap of 50');
    }
});

test('a Ref uses the reader\'s Ref Tag, and closes it only when the tag has a closing half', ()=>{
    const bracketed = loadZetSplit({refTag: '(('});
    const [first] = [...new bracketed(5, 500, true).splitText('Alpha one two three.\n\nBeta four five six.')];
    assert.ok(first.endsWith('((Beta four five six.))'), 'expected a closed Ref, got: ' + JSON.stringify(first));

    // The regression. '->' is a legal Ref Tag with no closing half, and the old
    // always-true condition wrote `getClosingBracket('->')` into the text.
    const arrow = loadZetSplit({refTag: '->'});
    const [alpha] = [...new arrow(5, 500, true).splitText('Alpha one two three.\n\nBeta four five six.')];
    assert.ok(!alpha.includes('undefined'), 'a Ref leaked "undefined" into the Pane text: ' + JSON.stringify(alpha));
    assert.ok(alpha.endsWith('->Beta four five six.'), 'expected an unclosed Ref, got: ' + JSON.stringify(alpha));
});
