// Pins the three failure modes that made the Zettelkasten sync flags a bug.
//
// A pass over a Zettelkasten pane's text runs as a CodeMirror 'change' handler,
// so a caller that wants a non-default pass cannot hand it arguments -- it used
// to set a module-level flag and then write into the editor. That produced:
//
//   1. a mode set on a global, so writing to one pane armed every pane's
//      processor;
//   2. a mode cleared by the pass rather than by the caller, so a write that
//      fires two change events got the mode on the first pass only (the paste
//      handler in handledrop.js writes twice);
//   3. a flag with no writer at all -- bypassZettelkasten was declared, read and
//      cleared, and nothing ever set it, so its guard could never fire.
//
// Each test below asserts both what it found and what it did not: a scan that
// silently matches nothing reports the same "clean" as a clean tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel)=>readFileSync(join(ROOT, rel), 'utf8');

const ZETTELKASTEN = 'js/zettelkasten/zettelkasten.js';

function scriptsUnder(dir, out = []){
    for (const entry of readdirSync(join(ROOT, dir), {withFileTypes: true})) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) scriptsUnder(rel, out);
        else if (entry.name.endsWith('.js')) out.push(rel);
    }
    return out;
}

// The old flag names survive in the comment that explains why they are gone, so
// a scan for them has to read code only.
const withoutComments = (src)=>src.replace(/\/\/.*$/gm, '');

// ZettelkastenProcessor is a plain class declaration -- its instance fields only
// run on construction -- so the class body alone evaluates in a sandbox. Slicing
// it out avoids the rest of the file, which does call into the app at load.
function loadProcessor(){
    const src = read(ZETTELKASTEN);
    const start = src.indexOf('class ZettelkastenProcessor {');
    assert.notEqual(start, -1, 'ZettelkastenProcessor should be a class declaration');
    const end = src.indexOf('\n}\n', start);
    assert.notEqual(end, -1, 'the class body should close at column 0');

    const sandbox = {
        // Everything the class touches on the paths these tests exercise.
        NodePlacementStrategy: class { constructor(objects, options){ this.nodeObjects = objects; this.options = options } },
        ZettelkastenParser: {regexpNodeTitle: /^##\s*(.+)$/},
        Tag: {node: '##', ref: '[['},
        LLM_TAG: 'AI:',
        Node: {byTitle: ()=>null},
        Logger: {debug(){}, info(){}, warn(){}, err(){}}
    };
    vm.runInNewContext(
        src.slice(start, end + 2) + '\n;globalThis.exported = ZettelkastenProcessor;',
        sandbox, {filename: 'ZettelkastenProcessor.js'}
    );
    return sandbox.exported;
}

// A processor over an editor that holds one blank line, recording the mode each
// pass sees.
function makeProcessor(Processor){
    const seen = [];
    const noteInput = {
        on(){},
        getValue(){ seen.push(this.owner.mode); return '' }
    };
    const processor = new Processor(noteInput, {getNodeSectionRange: ()=>({startLineNo: 0, endLineNo: 0})});
    noteInput.owner = processor;
    return {processor, seen};
}

test('the three module-level sync flags are gone from every script', ()=>{
    const files = scriptsUnder('js');
    const flags = /\b(processAll|restoreZettelkastenEvent|bypassZettelkasten)\b/;

    const hits = files.filter(rel => flags.test(withoutComments(read(rel))));

    // Both numbers: 82 scripts are loaded by PageLoad, so a scan finding nothing
    // in a handful of files has not looked at the tree.
    assert.ok(files.length >= 80, `expected to scan the whole tree, saw ${files.length} scripts`);
    assert.deepEqual(hits, [], 'a pass mode must be an argument, not a module-level flag');
});

test('every pass mode a caller names exists in the table', ()=>{
    const Processor = loadProcessor();
    const modes = Object.keys(Processor.Pass);

    const named = [];
    for (const rel of scriptsUnder('js')) {
        for (const m of read(rel).matchAll(/ZettelkastenProcessor\.Pass\.(\w+)/g)) {
            named.push({rel, mode: m[1]});
        }
    }

    assert.ok(modes.length >= 3, `expected a table of modes, saw ${modes.length}`);
    assert.ok(named.length >= 5, `expected callers to name modes, found ${named.length}`);
    assert.ok(new Set(named.map(n => n.rel)).size >= 3, 'expected callers in several scripts');
    assert.deepEqual(
        named.filter(n => !modes.includes(n.mode)),
        [], 'a caller named a mode the table does not define'
    );
});

test('no mode in the table is unreachable', ()=>{
    // bypassZettelkasten was read and cleared but never written, so the branch it
    // guarded was dead. A mode nothing asks for is the same defect.
    const Processor = loadProcessor();
    const modes = Object.keys(Processor.Pass);
    const source = scriptsUnder('js').map(read).join('\n');

    assert.ok(modes.length >= 3, `expected a table of modes, saw ${modes.length}`);
    assert.deepEqual(
        modes.filter(mode => !source.includes(`Pass.${mode}`)),
        [], 'every mode must have a caller, or its branches are dead'
    );
});

test('a pass leaves the mode it ran in untouched, so two writes both get it', ()=>{
    const Processor = loadProcessor();
    const {Pass} = Processor;
    const {processor, seen} = makeProcessor(Processor);

    assert.equal(processor.mode, Pass.edit, 'a processor starts in edit mode');

    // What the paste handler does: one bracketed write that fires two changes.
    processor.writeAs(Pass.rewrite, ()=>{
        processor.processInput();
        processor.processInput();
    });

    assert.deepEqual(seen, [Pass.rewrite, Pass.rewrite],
        'the mode was cleared between passes, so the second write lost it');
    assert.equal(processor.mode, Pass.edit, 'the mode must not outlive the write');
});

test('writeAs restores the mode when the write throws', ()=>{
    const Processor = loadProcessor();
    const {Pass} = Processor;
    const {processor} = makeProcessor(Processor);

    assert.throws(
        ()=>processor.writeAs(Pass.restore, ()=>{ throw new Error('write failed') }),
        /write failed/
    );

    // Left in restore mode, the next keystroke would bind titles to existing
    // nodes instead of spawning them.
    assert.equal(processor.mode, Pass.edit, 'a failed write must not leave the mode set');
});
