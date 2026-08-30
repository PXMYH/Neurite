// The chrome -- the tool island, the menu button and the menu panel -- is the one
// part of the stylesheet whose material is meant to be changed as a set. It used to
// hold that material as literals: `#1a1921f2` written out four times with a matching
// `#8882` hairline beside each, so retuning the islands meant finding every copy
// first, and missing one meant two islands that no longer matched.
//
// These pin the joint rather than the values. A literal is allowed to come back only
// by also coming back through a token, which is the thing a future edit is likely to
// do by habit and unlikely to notice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const css = readFileSync(new URL('resources/styles/styles.css', root), 'utf8');

// Comments in this file explain the values they sit above, so they quote them. A
// scan for a literal has to read the code and not the prose, or every assertion
// below passes on its own explanation.
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

// One rule by its opening selector at its own indent, so a *call* to the same class
// name elsewhere -- or a longer selector that merely contains it -- cannot stand in
// for the definition.
function rule(selector){
    const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                          + '\\s*\\{([^{}]*)\\}');
    const m = code.match(re);
    assert.ok(m, 'the rule for `' + selector + '` was not found -- it was renamed or '
                 + 'reformatted, and every assertion about it is now vacuous');
    return m[2];
}

// The tool geometry is declared on a two-selector rule, which `rule()` cannot anchor
// because its escaping is what makes single selectors safe. Anchored on the first
// selector and read to the closing brace instead.
function ruleFrom(anchor){
    const i = code.indexOf(anchor);
    assert.ok(i !== -1, '`' + anchor + '` was not found, so this test checks nothing');
    const open = code.indexOf('{', i);
    const close = code.indexOf('}', open);
    assert.ok(open !== -1 && close > open, 'the rule at `' + anchor + '` is not a block');
    return code.slice(open + 1, close);
}

test('the chrome tokens exist and each one is read', ()=>{
    const TOKENS = [
        '--ui-chrome', '--ui-chrome-border', '--ui-chrome-rule', '--ui-chrome-hover',
        '--ui-chrome-text', '--ui-chrome-text-strong', '--ui-chrome-blur',
        '--ui-chrome-icon', '--ui-chrome-icon-hover', '--ui-chrome-raised',
        '--ui-tool-size', '--ui-tool-icon-size',
    ];
    for (const token of TOKENS) {
        assert.match(code, new RegExp('\\n\\s*' + token + ':\\s*\\S'),
            token + ' is not declared, so every rule reading it falls back to nothing');
    }
});

test('no --ui- token is declared and then never read', ()=>{
    // Deliberately not a fixed list. A named list can only check the names already
    // thought of, and the failure this guards against is the *next* token -- added
    // beside a rule, then not wired to it, so the value on screen and the value in
    // `:root` quietly disagree. Planting an unused token is what showed the fixed
    // list could not see one.
    //
    // Scoped to `--ui-`: the `--cm-` block is the syntax highlighter's, consumed by
    // rules generated from CodeMirror's class names, and the file says that split is
    // on purpose.
    const declared = [...code.matchAll(/\n\s*(--ui-[a-z0-9-]+):/g)].map(m=> m[1]);
    assert.ok(declared.length >= 12,
        'the --ui- token block was not found, so this test is checking nothing');

    const orphans = declared.filter( (token)=>
        !new RegExp('var\\(\\s*' + token + '\\s*[,)]').test(code) );
    assert.deepEqual(orphans, [],
        'declared and never read: ' + orphans.join(', ')
        + '. Either wire it to the rule it was added for, or drop it -- a token with '
        + 'no consumer is a value that looks authoritative and governs nothing');
});

test('the islands take their material from tokens, not from copies of it', ()=>{
    // All four surfaces that make up the chrome. Every one of these carried its own
    // copy of the same three values.
    for (const selector of ['.tool-bar', '.dropdown-content', '.menu-button']) {
        const body = rule(selector);
        assert.match(body, /background:\s*var\(--ui-chrome\)/,
            selector + ' sets its own background instead of reading --ui-chrome');
        assert.match(body, /border:\s*1px solid var\(--ui-chrome-border\)/,
            selector + ' hardcodes its hairline');
        assert.match(body, /backdrop-filter:\s*var\(--ui-chrome-blur\)/,
            selector + ' hardcodes its blur, which is the one chrome property with a '
            + 'measurable cost and so the one that most needs finding in a single place');
    }

    // The tool box and its glyph do not scale together, so they are two tokens. The
    // comparison that matters -- 38/20 here against Excalidraw's 36/16 -- is only
    // possible while both are named.
    const tool = ruleFrom('.tool-bar .node-add-item,');
    assert.match(tool, /width:\s*var\(--ui-tool-size\)/, 'the tool box hardcodes its size');
    assert.match(tool, /color:\s*var\(--ui-chrome-icon\)/, 'the tool glyph hardcodes its colour');
});

test('no chrome rule holds a colour literal any more', ()=>{
    // Named rules rather than a line range. A range would also sweep up `.submenu`,
    // which sits between them in the file and is *content* inside the panel rather
    // than the panel itself -- it still carries `#bbb` and an inverted `#ddd` hover
    // from before any of this, and giving those a token would change what is on
    // screen, which this phase is not allowed to do.
    const CHROME = [
        '.tool-bar {', '.tool-bar-divider {', '.dropdown-content {', '.menu-button {',
        '.menu-button:hover {', '.menu-icon {', '.menu-row {', '.menu-row:hover {',
        '.tool-bar .node-add-item,',
    ];
    const found = [];
    for (const anchor of CHROME) {
        for (const m of ruleFrom(anchor).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
            found.push(anchor.replace(/\s*\{$/, '') + ': ' + m[0]);
        }
    }
    assert.deepEqual(found, [],
        'a colour literal is back on a chrome rule: ' + found.join(', ')
        + '. Add it to the :root block and read it with var() instead, or the four '
        + 'chrome surfaces drift apart one edit at a time');
});

test('Save to... is the same size as every row beside it', ()=>{
    // `#disk-file-button { font-size: 13px }` sat 1,500 lines below the `.menu-row`
    // rule it overrode, which is why one row in the menu rendered a pixel smaller
    // than its neighbours for as long as it did. An id beats a class, so this cannot
    // be fixed by ordering -- only by not existing.
    assert.doesNotMatch(code, /#disk-file-button\s*\{[^{}]*font-size/,
        'a per-id font-size is back on Save to..., so it no longer matches the rows '
        + 'around it. Menu row type belongs to `.menu-row`');
});
