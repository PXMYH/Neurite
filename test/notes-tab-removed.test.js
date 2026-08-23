// The Notes tab is gone from the menu, but the markup it loaded is not: `#tab1` still
// exists and still loads `notestab.html`, because `App.init` builds `ZetPanes` from
// `#zetPaneContainer` and `openTab` refreshes `currentActiveZettelkastenMirror` on every
// tab switch. Deleting the div would throw at boot and on every tab click.
//
// That makes this removal easy to get half-right in two opposite directions: delete the
// div and break boot, or delete the tablink and leave the main AI prompt stranded in a
// tab nobody can open. Both halves are pinned here, together with the reason the div
// stays -- so that when the reason goes, this test says the div can go with it.
//
// Read as text, like settings-tab.test.js: nothing under js/ exports, and the questions
// here are about which file holds which element and what `dropdown.js` opens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const NOTES = 'resources/html/tabs/notestab.html';
const AI = 'resources/html/tabs/aitab.html';
const dropdownHtml = read('resources/html/tabs/dropdown.html');
const dropdownJs = read('js/interface/dropdown/dropdown.js');

// Every menu row, as [tabId, label] in DOM order. The label is the text of the row's
// own `.menu-row-label`, which is also what `MainMenu.showDetail` copies into the
// panel heading -- so a row with no label would open a panel titled "Menu".
const tablinks = [...dropdownHtml.matchAll(/onclick="openTab\('(\w+)', this\)"[\s\S]*?class="menu-row-label">([^<]+)</g)]
    .map( (m)=> [m[1], m[2].trim()] );

test('no menu row opens the Notes tab, and the ones left are in a known order', ()=>{
    assert.deepEqual(tablinks, [
        ['tab4', 'Ai'],
        ['tab2', 'Fractal'],
        ['tab6', 'Saves'],
        ['tab5', 'Settings'],
        ['tab3', 'Help'],
    ], 'the menu column changed; check that every row still has a label to open under');

    // Every remaining link has both halves: a div to show, and an entry that fills it.
    const main = read('js/main.js');
    for (const [tabId] of tablinks) {
        assert.match(dropdownHtml, new RegExp('<div id="' + tabId + '" class="tabcontent">'),
            tabId + ' has a tablink and no content div');
        assert.match(main, new RegExp("'" + tabId + "': '\\w+\\.html'"),
            tabId + ' has a tablink and nothing loads into it');
    }
});

test('the Notes markup still loads, and the reason it has to is still in the source', ()=>{
    // Invisible, not deleted. If this pair ever stops being true, the div and the
    // `PageLoad.tabs` entry can go -- that is what this test is for.
    assert.match(dropdownHtml, /<div id="tab1" class="tabcontent">/,
        'the Notes div is gone; boot reads what loads into it');
    assert.match(read('js/main.js'), /'tab1': 'notestab\.html'/,
        'nothing loads the editor any more');

    assert.match(read('js/main.js'), /new ZetPanes\(Elem\.byId\('zetPaneContainer'\)\)/,
        'App.init no longer needs #zetPaneContainer, so #tab1 can be deleted outright');
    assert.match(dropdownJs, /window\.currentActiveZettelkastenMirror\.refresh\(\)/,
        'openTab no longer refreshes the editor, so #tab1 can be deleted outright');
    assert.match(read(NOTES), /<div id="zetPaneContainer"/, 'the editor host is gone');

    // A reader who finds a tab with no way in needs the reason next to it.
    assert.match(dropdownHtml.slice(0, dropdownHtml.indexOf('<div id="tab1"')),
        /#65/, 'nothing near #tab1 says why it has no tablink');
});

test('the main prompt is in the Ai tab, once, and not in the Notes markup', ()=>{
    const ai = read(AI);
    const notes = read(NOTES);
    for (const pattern of [/id="prompt-form"/g, /id="prompt"/g, /id="regen-button"/g]) {
        assert.equal((ai.match(pattern) || []).length, 1,
            pattern + ' is not in the Ai tab exactly once');
        assert.equal((notes.match(pattern) || []).length, 0,
            pattern + ' is still in the tab nobody can open');
    }
    // The form is the first thing in the tab: it is the action, and the rest of that
    // tab is configuration.
    assert.ok(ai.indexOf('id="prompt-form"') < ai.indexOf('id="modelSelectContainer"'),
        'the prompt is below the model configuration');

    // The submit path is inline markup, so a move that dropped it would look fine.
    assert.match(ai, /<form id="prompt-form" onsubmit="sendMessage\(event\);">/);
    // Leading whitespace, so that a renamed attribute -- `data-oninput`, which the
    // browser never fires -- does not satisfy this as a substring.
    assert.match(ai, /\soninput="autoGrow\(event\);"/, 'the prompt no longer grows as you type');
    for (const id of ['aiLoadingIcon', 'aiErrorIcon']) {
        assert.match(ai, new RegExp('id="' + id + '"'), id + ' did not come along');
    }

    // Hiding the prompt with AI features off was a rule on the form itself; the tab
    // around it is hidden too now, and the rule has to keep naming the form, because
    // `#tab4` is only hidden while the tab is closed by other means.
    //
    // The declaration as well as the selectors. Matching `body.ai-disabled
    // #prompt-form,` reads the left of the brace and never the right, so swapping
    // `display: none !important` for `opacity: 0.99` left all five selectors
    // byte-identical, showed every AI surface with AI features off, and passed 113 of
    // 113 -- including this assertion, whose message says the prompt is no longer
    // hidden. `!important` is load-bearing too: `openTab` writes `display: block`
    // inline on the panel it opens, and without the flag that inline value wins.
    const css = read('resources/styles/styles.css');
    const iRule = css.indexOf('body.ai-disabled #tablink-ai,');
    assert.notEqual(iRule, -1, 'the AI-off rule no longer starts at #tablink-ai');
    const rule = css.slice(iRule, css.indexOf('}', iRule));
    for (const selector of ['#tab4', '#prompt-form', '.function-call-container',
                            '.node-add-item.ai-icon']) {
        assert.ok(rule.includes('body.ai-disabled ' + selector),
            selector + ' is no longer hidden when AI features are off');
    }
    assert.match(rule, /display:\s*none\s*!important/,
        'the AI-off rule names every AI surface and then hides none of them');
});

test('the menu opens on the list, and nothing opens tab1 by hand', ()=>{
    assert.doesNotMatch(dropdownJs, /openTab\('tab1'/,
        'something still opens a tab with no menu row');

    // Opening into a panel is what the empty-menu bug was: `body.ai-disabled` hides
    // `#tab4` and `#tablink-ai` with `!important`, and Notes -- the row that used to be
    // visible either way -- is gone, so the menu opened as a 214x48 empty box.
    // Measured in the browser before the list existed. No `openTab` call may run on
    // open, conditional or not.
    //
    // Reachable after the reader switches AI features off, not on a first load: an
    // unset flag means on. Three comments and a commit message on this branch said
    // the opposite, all of them derived from each other rather than from the getter,
    // which is why the default is pinned here.
    assert.match(read('js/globals.js'),
        /get enabled\(\)\{ return localStorage\.getItem\(AiFeatures\.#key\) !== 'false' \}/,
        'AI features no longer default to on, so the note above is stale');

    const onOpen = dropdownJs.slice(dropdownJs.indexOf("dropdownContent.classList.contains(\"open\")"));
    const iEndOfHandler = onOpen.indexOf('On.mousedown');
    assert.ok(iEndOfHandler > 0, 'the menu-open handler was not found');
    assert.doesNotMatch(onOpen.slice(0, iEndOfHandler), /openTab\(/,
        'opening the menu opens a panel again; a hidden one leaves the menu empty');
    assert.match(dropdownJs, /if \(dropdownContent\.classList\.contains\("open"\)\) \{[\s\S]*?MainMenu\.showList\(\)/,
        'opening the menu does not go to the list');

    // Leaving the Ai panel when AI features are switched off. Back to the list: every
    // other panel would be a guess, and `#tab1` has no row to mark active.
    assert.match(dropdownJs,
        /if \(!AiFeatures\.enabled && aiTabContent\.style\.display === 'block'\) MainMenu\.showList\(\)/,
        'switching AI features off leaves the Ai panel showing');

    // Two views, one class. `openTab` has to switch to the panel it just showed, or
    // every row would look dead; and the heading has to come from the row itself.
    assert.match(dropdownJs, /MainMenu\.showDetail\(element\)/,
        'openTab shows a panel without switching to the panel view');
    assert.match(dropdownJs, /classList\.remove\('detail-open'\)/, 'showList shows no list');
    assert.match(dropdownJs, /classList\.add\('detail-open'\)/, 'showDetail shows no panel');
    assert.match(dropdownJs, /On\.click\(Elem\.byId\('menuBackButton'\), MainMenu\.showList\)/,
        'the back button is not bound, so the panel view has no way out');
    for (const id of ['menuList', 'menuDetail', 'menuBackButton', 'menuDetailTitle']) {
        assert.match(dropdownHtml, new RegExp('id="' + id + '"'), id + ' is missing from the menu');
    }
    // `Menu` is the right-click menu (`customcontextmenu.js`), and these files share
    // one global scope, so reusing the name would replace it.
    assert.doesNotMatch(dropdownJs, /^const Menu\b/m, 'this file redeclares the context menu');

    // The loop that used to run here hid `tabcontent[i]` for each tablink index. There
    // are five tablinks and six tab divs now, so it would have left one shown, and it
    // also cleared `active` where `openTab` writes `activeTab`.
    //
    // Comments stripped: the one that replaced the loop describes it, and the question
    // is what the file does rather than what it says about itself.
    const code = dropdownJs.replace(/^\s*\/\/.*$/gm, '');
    assert.equal((code.match(/tabcontent\[i\]/g) || []).length, 1,
        'tab divs are indexed in more than one place');
    assert.match(code, /for \(i = 0; i < tabcontent\.length; i\+\+\) \{\s*tabcontent\[i\]\.style\.display = 'none';/,
        'a loop pairs tab divs with tablinks by index again; the counts differ');
    assert.doesNotMatch(code, /classList\.remove\("active"\)/,
        'a loop clears a class nothing adds');
});
