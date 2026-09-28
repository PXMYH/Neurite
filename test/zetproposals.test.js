// Proposed Edges (#72): the pure half of `ZetProposals` -- how a note's Tags are read, which
// notes mention which, how alike two notes' wording is, how a pair is scored, which pairs make
// the Graph-wide list, and how a mention is quoted. The panel and the Connect modal's group
// are driven in a browser (test-e2e/specs/19-proposals.e2e.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const path = 'js/zettelkasten/zetproposals.ts';

function load(){
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022}, fileName: path}).outputText;
    const sandbox = createContext({
        Stored: class { load(){ return Promise.resolve(null) } save(){ return Promise.resolve() } },
        Elem: {byId: ()=>null},
        On: {click(){}},
    });
    runInContext(js + '\n;globalThis.exported = ZetProposals;', sandbox, {filename: path});
    return sandbox.exported;
}
const ZetProposals = load();
// Values made in the sandbox's realm, compared as plain data.
const plain = (value)=>JSON.parse(JSON.stringify(value));

// The Title pattern as `ZettelkastenUI.titlePattern` builds it: every Title, longest first,
// between non-word characters, in any case.
const escape = (s)=>s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternOf = (titles)=>new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...titles].sort( (a, b)=>(b.length - a.length) ).map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');

test('Tags are read from an inline list, a bare list and a YAML list, and nowhere else', ()=>{
    assert.deepEqual(plain(ZetProposals.tagsOf('---\ntype: concept\ntags: [RAG, evals, "llm-as-judge"]\n---\n')), ['rag', 'evals', 'llm-as-judge']);
    assert.deepEqual(plain(ZetProposals.tagsOf('---\ntags: agents, #mcp\n---\n')), ['agents', 'mcp']);
    assert.deepEqual(plain(ZetProposals.tagsOf('---\ntags:\n  - rag\n  - "Evals"\n  - rag\nstatus: active\n---\n')), ['rag', 'evals']);
    assert.deepEqual(plain(ZetProposals.tagsOf('---\ntype: concept\n---\n')), []);
    assert.deepEqual(plain(ZetProposals.tagsOf('')), []);
});

test('a mention is found in any case for a Title of several words and in its own case for one word', ()=>{
    const notes = [
        {title: 'Setup', prose: 'Nothing here.'},
        {title: 'Claude Code', prose: 'Short.'},
        {title: 'Claude Code Plugin', prose: 'Plugin notes.'},
        {title: 'Reader', prose: 'The setup took a day. Then claude code, and the Claude Code Plugin. Setup: done.'},
    ];
    const mentions = ZetProposals.mentions(notes, patternOf(notes.map( (n)=>n.title )));
    const reader = mentions[3];
    // "setup" in lower case is the word, not the note; "Setup:" is the Title's own case.
    assert.equal(reader.get(0).at, notes[3].prose.indexOf('Setup:'));
    // Any case for two words, the first mention kept.
    assert.equal(reader.get(1).at, notes[3].prose.indexOf('claude code'));
    // The longer Title where both start at one place.
    assert.equal(reader.get(2).length, 'Claude Code Plugin'.length);
    // A note does not mention itself, and nothing mentions anything without a pattern.
    assert.equal(mentions[2].has(2), false);
    assert.equal(ZetProposals.mentions(notes, null)[3].size, 0);
});

test('similar wording is a z-score within each note, and a note without a vector scores 0 both ways', ()=>{
    const z = ZetProposals.similarity([[1, 0, 0], [0.9, 0.1, 0], [0, 1, 0], [0, 0, 1], null, [1, 0]]);
    // The nearer vector ranks first in note 0's row.
    assert.ok(z[0][1] > z[0][2] && z[0][1] > z[0][3], JSON.stringify(z[0]));
    // Nothing against the note with no vector, nor from it, nor across a width mismatch.
    assert.equal(z[0][4], 0);
    assert.deepEqual(plain(z[4]), [0, 0, 0, 0, 0, 0]);
    assert.equal(z[0][5], 0);
    assert.equal(z[0][0], 0);
});

test('a pair scores for a mention either way and for the Tags it shares, a Tag every note has aside', ()=>{
    const notes = [
        {tags: ['all', 'rag']},
        {tags: ['all', 'rag']},
        {tags: ['all']},
    ];
    const mentions = [new Map(), new Map(), new Map([[0, {at: 3, length: 4}]])];
    const scored = ZetProposals.score(notes, mentions, null, ()=>true);
    const of = (from, to)=>scored.find( (p)=>(p.from === from && p.to === to) );
    // 0 and 1 share the rare Tag; the one every note carries is no reason.
    assert.deepEqual(plain(of(0, 1).tags), ['rag']);
    assert.deepEqual(plain(of(0, 2).tags), []);
    // Note 2 mentions note 0: a reason for the pair from either end, named where it is.
    assert.equal(of(0, 2).mention.note, 2);
    assert.equal(of(2, 0).mention.note, 2);
    // No reason, no proposal: 1 and 2 share only the Tag every note has, and no vectors.
    assert.equal(of(1, 2), undefined);
    // A pair `open` refuses is not scored.
    assert.equal(ZetProposals.score(notes, mentions, null, (i, j)=>!(i === 0 && j === 1)).some( (p)=>(p.from === 0 && p.to === 1) ), false);

    // Similar wording is a reason only for a pair more alike than the note's usual.
    const similar = [[0, 0, 0], [0, 0, 0.8], [0, -0.3, 0]];
    const withVectors = ZetProposals.score(notes, [new Map(), new Map(), new Map()], similar, ()=>true);
    assert.ok(withVectors.some( (p)=>(p.from === 1 && p.to === 2) ), 'z 0.8 is proposed');
    assert.equal(withVectors.some( (p)=>(p.from === 2 && p.to === 1) ), false, 'z -0.3 is not');
});

test('the list puts notes with no Edge first, caps each note and each note named, and takes a pair once', ()=>{
    const p = (from, to, score)=>({from, to, score, mention: null, tags: []});
    const proposals = [
        // Note 0 is linked; everyone would name note 9.
        p(0, 9, 10), p(0, 1, 9),
        p(1, 9, 5), p(1, 2, 4), p(1, 3, 3), p(1, 4, 2), p(1, 0, 1),
        p(2, 9, 5), p(3, 9, 5), p(4, 9, 5), p(5, 9, 5),
        p(2, 1, 8),
    ];
    const isolated = [false, true, true, true, true, true];
    const list = plain(ZetProposals.allocate(proposals, isolated, 3, 4));
    const pairs = list.map( (x)=>x.from + '>' + x.to );
    // Notes with no Edge before note 0, whatever its score.
    assert.ok(pairs.indexOf('0>1') > pairs.indexOf('1>9'), pairs.join(' '));
    // Three for a note at most.
    assert.equal(pairs.filter( (x)=>x.startsWith('1>') ).length, 3);
    // Note 9 is named four times, and no more.
    assert.equal(pairs.filter( (x)=>x.endsWith('>9') ).length, 4);
    // 2>1 is taken, so 1>2 is not taken again the other way round.
    assert.ok(pairs.includes('2>1') && !pairs.includes('1>2'), pairs.join(' '));
});

test('a mention is quoted as words: cut at spaces, links as their text, heading marks gone', ()=>{
    const text = 'A long run of words before it. For [large language models](https://example.com/llm) the ## Heading and **bold** text goes on for a while longer here.';
    const at = text.indexOf('large language models');
    const q = ZetProposals.quote(text, at, 'large language models'.length, 20);
    assert.equal(q.match, 'large language models');
    assert.ok(q.before.startsWith('…') && q.before.endsWith('For '), JSON.stringify(q.before));
    assert.ok(!q.after.includes('](') && !q.after.includes('##') && !q.after.includes('**'), JSON.stringify(q.after));
    assert.ok(q.after.endsWith('…'), JSON.stringify(q.after));

    const whole = ZetProposals.quote('Uses RAG.', 5, 3);
    assert.deepEqual(plain(whole), {before: 'Uses ', match: 'RAG', after: '.'});

    // A mention inside a link's text: the link is cut in two, and both halves go.
    const inLink = 'For [large language models](https://example.com/llm) the rest.';
    const cut = ZetProposals.quote(inLink, inLink.indexOf('language'), 'language models'.length);
    assert.deepEqual(plain(cut), {before: 'For large ', match: 'language models', after: ' the rest.'});
});
