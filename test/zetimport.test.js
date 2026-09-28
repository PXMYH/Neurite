// The notes import's plan (#71): which files are notes, under which Titles, in which
// Archives, and which of their lines are escaped. `ZetImport.notesFrom` is pure -- files in,
// plan out -- so it runs here as it runs in the page, through one transpile hop and a
// node:vm slice (see zetsplit.test.js for the pattern).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const path = 'js/zettelkasten/zetimport.ts';

function loadZetImport(){
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022}, fileName: path}).outputText;
    // `wire` runs at load and finds no menu row here.
    const sandbox = createContext({Elem: {byId: ()=>null}, On: {}, Tag: {node: '##', ref: '[['}, LLM_TAG: 'AI:'});
    runInContext(js + '\n;globalThis.exported = ZetImport;', sandbox, {filename: path});
    return sandbox.exported;
}
const ZetImport = loadZetImport();
// Arrays and objects made in the sandbox have its prototypes, which deepStrictEqual compares.
const plain = (value)=>JSON.parse(JSON.stringify(value));
const TAGS = {node: '##', ai: 'AI:', ref: '[[', close: ']]'};
const note = (type, body, extra = '')=>`---\ntitle: "x"\n${type ? 'type: ' + type + '\n' : ''}${extra}---\n${body}\n`;

// A small bundle with every case the AI bundle has: the Courses collision, an index, a log,
// a contract, a clipping with no type, a file with no frontmatter, attachments, tool state,
// a heading that would open a Node, one inside a code fence, an embed and a Ref to nothing.
const files = [
    {path: 'Agents/Agent Loop.md', text: note('concept', '# Agent Loop\n\n## Overview\nThe loop. See [[RAG]] and [[Missing Note]].\n```\n## not a heading\n```')},
    {path: 'Agents/index.md', text: note('index', '- [[Agent Loop]]')},
    {path: 'Learning/RAG.md', text: note('concept', 'Retrieval. ![[diagram.png]]')},
    {path: 'Learning/Courses.md', text: note('learning-log', 'Mine.')},
    {path: 'Harnesses/Claude Code/Courses.md', text: note('tool', 'Theirs. [[Claude Code/Courses]]')},
    {path: 'Harnesses/Claude Code/Setup.md', text: note('tool', 'AI: not an AI Node\nSteps.')},
    {path: 'Courses/clipping.md', text: '---\ntitle: "A clipping"\nauthor: "[[Someone]]"\n---\nClipped.\n'},
    {path: 'Courses/MISSION.md', text: '# Mission\nNo frontmatter.\n'},
    {path: 'log.md', text: note('log', '- did things')},
    {path: 'AGENTS.md', text: note('contract', 'Rules.')},
    {path: 'Top Level.md', text: note('prompt', 'At the root.')},
    {path: '_attachments/notes.md', text: note('concept', 'Not a note.')},
    {path: '.claude/memory.md', text: note('concept', 'Not a note either.')},
];

test('a note is a Markdown file whose frontmatter names its type', ()=>{
    const plan = ZetImport.notesFrom(files, 'Artificial Intelligence', TAGS);
    assert.deepEqual(plain(plan.notes.map( (n)=>n.path ).sort()), [
        'Agents/Agent Loop.md', 'Harnesses/Claude Code/Courses.md', 'Harnesses/Claude Code/Setup.md',
        'Learning/Courses.md', 'Learning/RAG.md', 'Top Level.md'
    ]);
    const skipped = Object.fromEntries([...plan.skipped].map( ([reason, paths])=>[reason, [...paths].sort()] ));
    assert.deepEqual(skipped, {
        'index': ['Agents/index.md'],
        'no type': ['Courses/clipping.md'],
        'no frontmatter': ['Courses/MISSION.md'],
        'log': ['log.md'],
        'contract': ['AGENTS.md'],
    });
    assert.match(ZetImport.summary(plan, 1), /Not imported, as not notes: 1 index, 1 log, 1 contract, 1 with no type in its frontmatter, 1 file with no frontmatter\./);
});

test('a Title is the file name, with as much of the path as two alike need', ()=>{
    const plan = ZetImport.notesFrom(files, 'Artificial Intelligence', TAGS);
    const titles = Object.fromEntries(plan.notes.map( (n)=>[n.path, n.title] ));
    assert.equal(titles['Agents/Agent Loop.md'], 'Agent Loop');
    // The bundle's own Ref for the second Courses is [[Claude Code/Courses]].
    assert.equal(titles['Harnesses/Claude Code/Courses.md'], 'Claude Code/Courses');
    assert.equal(titles['Learning/Courses.md'], 'Learning/Courses');
    // Unique in any case: "courses" and "Courses" are one Title (#64).
    const more = ZetImport.notesFrom([...files, {path: 'Work/courses.md', text: note('project', 'x')}], 'AI', TAGS);
    assert.equal(more.notes.find( (n)=>n.path === 'Work/courses.md' ).title, 'Work/courses');
});

test('one Archive for each top-level folder, the bundle itself for notes at its top', ()=>{
    const plan = ZetImport.notesFrom(files, 'Artificial Intelligence', TAGS);
    assert.deepEqual(plain(plan.areas.map( (a)=>a.name )), ['Artificial Intelligence', 'Agents', 'Harnesses', 'Learning']);
    const harnesses = plan.areas.find( (a)=>a.name === 'Harnesses' );
    assert.deepEqual(plain(harnesses.titles), ['Claude Code/Courses', 'Setup']);
    assert.match(harnesses.text, /^## Claude Code\/Courses\n---\ntitle: "x"\ntype: tool\n---\nTheirs\. \[\[Claude Code\/Courses\]\]\n\n## Setup\n/);
});

test('a line that would open a Node is escaped by one space, and nothing else is changed', ()=>{
    const plan = ZetImport.notesFrom(files, 'Artificial Intelligence', TAGS);
    const loop = plan.notes.find( (n)=>n.title === 'Agent Loop' ).text;
    assert.match(loop, /\n ## Overview\n/, 'the heading still opens a Node');
    assert.match(loop, /\n ## not a heading\n/, 'a heading in a code fence is read by the parser too');
    assert.match(loop, /\n# Agent Loop\n/, 'a line that opens no Node was changed');
    assert.match(plan.notes.find( (n)=>n.title === 'Setup' ).text, /\n AI: not an AI Node\n/);
    assert.equal(plan.escaped, 3);
    // And every other character of every note is the file's.
    for (const n of plan.notes) {
        const file = files.find( (f)=>f.path === n.path ).text.trimEnd();
        assert.equal(n.text.replace(/^ (##|AI:)/gm, '$1'), file, n.path + ' changed beyond the escape');
    }
});

test('the tags are the reader\'s: with "@@" as the Node Tag, "##" stays and "@@" is escaped', ()=>{
    const plan = ZetImport.notesFrom([{path: 'A/One.md', text: note('concept', '## kept\n@@ escaped')}], 'Root', {...TAGS, node: '@@'});
    assert.match(plan.areas[0].text, /^@@ One\n/);
    assert.match(plan.notes[0].text, /\n## kept\n @@ escaped$/);
});

test('the Refs that will draw nothing are listed, and an embed is not one of them', ()=>{
    const plan = ZetImport.notesFrom(files, 'Artificial Intelligence', TAGS);
    assert.deepEqual(plain(plan.unresolved), [{title: 'Agent Loop', ref: 'Missing Note'}]);
    assert.equal(plan.embeds, 1);
});
