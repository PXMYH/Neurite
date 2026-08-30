// The ? tab is documentation, and documentation is the one part of the app that
// can be wrong while every test passes: a key that no handler implements still
// renders, and a reader who tries it learns nothing except that the page lies.
// So each group below is pinned to the source that implements it, and the two
// controls that left this tab are pinned to the file they left for.
//
// Read as text, the way settings-tab.test.js does: nothing under js/ exports, and
// the questions here are about the shape of the markup and of the handlers.
//
// What this cannot check is whether the sentences are clear. It checks that every
// promise the tab makes still has code behind it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const HELP = 'resources/html/tabs/helptab.html';
const SAVES = 'resources/html/tabs/networkstab.html';
const MENU = 'resources/html/tabs/dropdown.html';
const help = read(HELP);
const menu = read(MENU);

// The rows, as [keys, meaning] with the tags stripped. `<td>` order is the
// contract: keys on the left, what they do on the right.
function rows(html){
    return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map( (tr)=>
        [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/g)]
            .map( (td)=> td[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() )
    );
}

test('the ? tab is a controls reference rather than a pair of links', ()=>{
    // What it held before: a checkbox, two links, and the Screenshot/Record pair.
    // The size checks are the floor -- a rewrite that drops half the reference
    // passes every other test in this file, because each of those only asks that
    // what is left is true.
    const headings = [...help.matchAll(/class="button-label settings-heading">([^<]+)</g)]
        .map( (m)=> m[1].trim() );
    assert.ok(headings.length >= 7,
        'the reference has ' + headings.length + ' groups: ' + headings.join(', '));

    // A heading with no table under it is a group whose rows were deleted, which
    // reads as a finished section rather than as a gap.
    for (const heading of headings) {
        assert.match(help.slice(help.indexOf('>' + heading + '<')),
            /^[^<]*<\/div>\s*<table class="howto-controls">\s*<tr>/,
            heading + ' has no rows under it');
    }

    const body = rows(help);
    assert.ok(body.length >= 25, 'only ' + body.length + ' control rows');
    assert.deepEqual(body.filter( (cells)=> cells.length !== 2 ), [],
        'a row is not a key/meaning pair');
    assert.deepEqual(body.filter( ([keys, meaning])=> !keys || meaning.length < 5 ), [],
        'a row names a control without saying what it does');

    // `.settings-heading` is defined inside `.dropdown-content`, which is what makes
    // it usable in this tab at all; and the group headings have to be the same shape
    // as the Settings tab's, or the two panels read as different applications.
    assert.match(read('resources/html/tabs/settingstab.html'),
        /class="button-label settings-heading"/,
        'the Settings tab no longer uses this heading, so the ? tab now looks foreign');
});

test('the reference overrides the grid the global table rule would draw', ()=>{
    // Thirty rows of centred, 15px-padded, bordered cells is a spreadsheet eight
    // screens long. The override is by id so no other table changes; this pins both
    // halves, so that deleting the global rule shows up here as dead weight rather
    // than as a silent duplicate.
    const css = read('resources/styles/styles.css');
    const global = css.slice(css.indexOf('\nth,\ntd {'), css.indexOf('}', css.indexOf('\nth,\ntd {')));
    assert.match(global, /text-align:\s*center/, 'the global cell rule is gone; drop the override');
    assert.match(global, /border:\s*1px/);

    const start = css.indexOf('#howto .howto-controls td {');
    assert.notEqual(start, -1, 'the ? tab has no cell rule of its own');
    const scoped = css.slice(start, css.indexOf('}', start));
    for (const declaration of [/border:\s*none/, /text-align:\s*left/, /padding:\s*3px/]) {
        assert.match(scoped, declaration);
    }

    // `#howto` sits inside `.dropdown-content` in this stylesheet, and so does the
    // `table { background-color }` rule these tables inherit from.
    assert.match(css.slice(css.indexOf('#howto .howto-controls {'),
                           css.indexOf('}', css.indexOf('#howto .howto-controls {'))),
        /background:\s*none/, 'the reference tables keep the panel-input background');
});

// Each entry: a claim the tab makes, and the code that has to still be there for the
// claim to hold. These are the rows most likely to rot, because each one names a
// literal that lives in exactly one handler.
const CLAIMS = [
    {row: /Alt<\/kbd> \+ <kbd>s/, says: /PNG/,
     file: 'js/mandelbrot/mandelbrot.js', code: /a\.download = name \+ "\.png"/,
     why: 'the fractal-line export writes a PNG, whatever the row says'},
    {row: /<kbd>1<\/kbd>/, says: /note, link, edges, Ai/,
     file: 'js/interface/dropdown/dropdown.js', code: /const toolShortcuts = \{/,
     why: 'the digit shortcuts are gone, so the row promises four keys that do nothing'},
    {row: /<kbd>f<\/kbd>/, says: /Grow or shrink/,
     file: 'js/nodes/nodeinteraction/movenodes.js', code: /'f': 'scaleUp'/,
     why: 'f no longer scales the selection'},
    {row: /Esc/, says: /following the pointer/,
     file: 'js/nodes/nodeinteraction/nodemode.js', code: /Escape/,
     why: 'Escape no longer drops a node that follows the mouse'},
    {row: /instructions-checkbox/, says: /instructions/,
     file: 'js/ai/aimessage.js', code: /Elem\.byId\('instructions-checkbox'\)\.checked/,
     why: 'the How-To checkbox is read nowhere, so ticking it changes nothing'},
];

// "Any character" tempered to stop at the row's own end. `[\s\S]*?` is lazy but
// crosses `</tr>` freely, so `<tr>[\s\S]*?KEYS[\s\S]*?</tr>` began at the table's
// first row every time -- the Alt+s claim spanned 26 rows and 5KB -- and `claim.says`
// was then checked against the whole prefix instead of the row. Measured: rewriting
// the Alt+s row to promise an SVG file, which `mandelbrot.js` contradicts, failed as
// it should; putting the word PNG back in an earlier row's text passed 113 of 113
// with the lie still on screen. A comment did it too.
const IN_ROW = '(?:(?!<\\/tr>)[\\s\\S])*?';

test('every control the reference names is still implemented', ()=>{
    for (const claim of CLAIMS) {
        const match = help.match(new RegExp('<tr>' + IN_ROW + claim.row.source + IN_ROW + '<\\/tr>'));
        assert.ok(match, 'no row matches ' + claim.row + '; this test is stale');
        // One row, so that a later loosening of the pattern shows up here rather than
        // as five claims quietly checked against the table around them.
        assert.doesNotMatch(match[0].slice('<tr>'.length, -'</tr>'.length), /<\/tr>/,
            claim.row + ' matched more than its own row');
        assert.match(match[0], claim.says, 'the row no longer says what it did');
        assert.match(read(claim.file), claim.code, claim.why);
    }
});

test('the keys the reference does not repeat are the ones the reader can rebind', ()=>{
    // Shift, Alt and Control are defaults, not constants, so the tab says so once
    // instead of hedging in thirty rows. That sentence is only true while the three
    // are read through `controls.*`.
    assert.match(help, /Shift, Alt and Control are defaults/);
    const globals = read('js/globals.js');
    for (const key of ['shiftKey', 'altKey', 'controlKey']) {
        assert.match(globals, new RegExp(key + ':\\s*\\{'),
            key + ' is no longer a rebindable control, so the closing sentence is wrong');
    }
});

test('the commands are rows of the menu, once each, with their labels intact', ()=>{
    // Screenshot and Record came from this tab; Open, Save to… and Clear came from the
    // Saves panel, which is one level further in, and Save graph is new. All six are
    // commands, so they are rows of the menu itself rather than contents of a panel.
    //
    // "The id is somewhere in the page" was true before the move and after it, so it
    // cannot see the move. Name the file.
    for (const id of ['open-file-button', 'disk-file-button', 'save-graph-button',
                      'clear-button', 'screenshotButton', 'recordButton']) {
        const files = ['index.html', HELP, SAVES, MENU,
                       'resources/html/tabs/notestab.html',
                       'resources/html/tabs/aitab.html',
                       'resources/html/tabs/fractaltab.html',
                       'resources/html/tabs/settingstab.html']
            .filter( (p)=> new RegExp('\\sid="' + id + '"').test(read(p)) );
        assert.deepEqual(files, [MENU], id + ' is not in the menu exactly once');
    }

    // The label span is not cosmetic: `Recorder.setRecordLabel` and savenet's
    // `#updateDiskFileButton` write into it, and writing to the button instead would
    // replace the icon along with the words.
    for (const id of ['open-file-button', 'disk-file-button', 'save-graph-button',
                      'clear-button', 'screenshotButton', 'recordButton']) {
        const button = menu.match(new RegExp('<button[^>]*id="' + id + '"[\\s\\S]*?</button>'));
        assert.ok(button, id + ' is no longer a button');
        assert.match(button[0], /class="menu-row"/, id + ' does not use the row pattern');
        assert.match(button[0], /<span class="menu-row-label">[^<]+<\/span>/,
            id + ' has no label span for the icon to sit beside');
        assert.match(button[0], /<use xlink:href="#[\w-]+-icon">/, id + ' lost its icon');
        // A chevron says "this opens a panel", which a command does not.
        assert.doesNotMatch(button[0], /menu-row-chevron/, id + ' promises a panel it does not open');
    }
    // Screenshot and Record are the two whose title text is the only place the reader
    // learns what they capture. Open's and Clear's are the same kind of promise -- and
    // Clear's is the only place the row says it saves first and deletes nothing, which is
    // the whole difference between it and the delete a reader fears it is. Save to…'s is
    // written by `savenet.js`, which is why it is not asserted here.
    for (const id of ['open-file-button', 'save-graph-button', 'clear-button',
                      'screenshotButton', 'recordButton']) {
        const button = menu.match(new RegExp('<button[^>]*id="' + id + '"[\\s\\S]*?</button>'));
        assert.match(button[0], /title="[^"]{20,}"/, id + ' says nothing on hover');
    }

    // The commands come first and the panels after, with the hairline between them.
    // Without this the group could scatter and every check above would still pass.
    const iSeparator = menu.indexOf('class="menu-separator"');
    assert.ok(iSeparator > 0, 'the commands and the panels are no longer separated');
    assert.ok(menu.indexOf('id="recordButton"') < iSeparator,
        'a command sits below the separator, among the panel rows');
    assert.ok(iSeparator < menu.indexOf("openTab('tab4'"),
        'a panel row sits above the separator, among the commands');

    // Open's file input has to stay rendered for Safari to open a dialog for it, so it
    // cannot live in either view: `.menu-list` and `.menu-detail` take turns at
    // `display: none`, so a box in one of them is unrendered half the time.
    //
    // Past the end of the detail view, not merely past the end of the list. Being after
    // `</nav>` was all that was asserted, and `.menu-detail` opens immediately after that
    // nav -- so moving the input inside it kept both of the old checks green while
    // putting it back in a container that is `display: none` whenever the list is up.
    // The close is found by counting divs rather than by matching the next `</div>`,
    // which belongs to a tab placeholder six levels in.
    const iList = menu.indexOf('class="menu-list"');
    const iInput = menu.indexOf('id="open-file-input"');
    const iDetail = menu.indexOf('id="menuDetail"');
    assert.ok(iDetail > 0, 'the detail view is gone from the menu');
    let depth = 0, iEndOfDetail = -1;
    for (const m of menu.slice(iDetail).matchAll(/<div\b|<\/div>/g)) {
        depth += m[0] === '</div>' ? -1 : 1;
        if (depth === 0) { iEndOfDetail = iDetail + m.index + m[0].length; break }
    }
    assert.ok(iEndOfDetail > iDetail, 'the detail view never closes; this test is stale');
    assert.ok(iInput > iEndOfDetail,
        'the file input is inside a view that is display:none half the time');
    assert.ok(iInput > iList, 'the file input is gone from the menu');

    const record = read('js/interface/dropdown/customui/record/record.js');
    assert.match(record, /setRecordLabel\(text\)\{[\s\S]*?\.menu-row-label'\)\.textContent = text/,
        'the label writer no longer targets the span');
    assert.match(read('js/interface/dropdown/savenet.js'),
        /querySelector\('\.menu-row-label'\) \?\? btn/,
        'the Save to… label writer no longer targets the span');
    // Comments stripped: one of them quotes the write it warns against, and the
    // question here is what the file does, not what it says about itself.
    const code = record.replace(/^\s*\/\/.*$/gm, '');
    assert.equal((code.match(/textContent\s*=/g) || []).length, 1,
        'record.js writes textContent somewhere other than the label writer');
    assert.doesNotMatch(code, /button\.textContent/,
        'a write to the button itself would delete the icon');
    // Four call sites used to write the label directly; all of them go through the
    // helper now, including the two that reset it when the reader stops sharing.
    assert.ok((record.match(/Recorder\.setRecordLabel\(/g) || []).length >= 4,
        'a label reset was dropped, so the button stays on the pause glyph');
});

test('the notes editor opens empty, and the syntax it taught is in the ? tab', ()=>{
    // The placeholder was four lines of sample syntax inside the editor. It was
    // rebuilt from the current tags on every tag change, which is why three functions
    // and a call in `Tag.#onTagInput` went with it.
    for (const gone of ['generateCmPlaceholder', 'updateAllCodeMirrorPlaceholders',
                        'updatePlaceholder']) {
        for (const file of ['js/zettelkasten/zetcodemirror.js', 'js/globals.js',
                            'js/interface/dropdown/tabs/notestab.js']) {
            const source = read(file);
            // The names survive in comments that say where the syntax went; a call
            // does not have a backtick in front of it.
            assert.doesNotMatch(source, new RegExp('[^`]\\b' + gone + '\\('),
                file + ' still calls ' + gone);
        }
    }

    // The CodeMirror options, up to the closing brace of the call.
    const notes = read('js/interface/dropdown/tabs/notestab.js');
    const options = notes.slice(notes.indexOf('CodeMirror.fromTextArea(textarea, {'),
                                notes.indexOf('});', notes.indexOf('CodeMirror.fromTextArea(textarea, {')));
    assert.doesNotMatch(options, /placeholder/, 'the editor is given a placeholder again');
    assert.match(options, /mode: 'custom'/, 'the options parse is stale');

    // The tag change still has to recompile the mode: the tags are baked into the
    // highlighter, so dropping this call leaves the colours wrong with no error.
    assert.match(read('js/globals.js'), /updateAllZetMirrorModes\(\);/,
        'a tag change no longer recompiles the editor mode');

    // The claim the removal rests on. Both examples use the default tags, which is
    // what the placeholder did too.
    const syntax = rows(help).filter( ([keys])=> /## Title|\[\[Title\]\]/.test(keys) );
    assert.equal(syntax.length, 2,
        'the ? tab does not teach both the title tag and the reference tag');
    assert.match(help, /Rebindable in Settings/,
        'the ? tab does not say the tags can be changed');
});
