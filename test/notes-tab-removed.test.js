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

// Every tablink, as [tabId, label] in DOM order. The order is load-bearing:
// `dropdown.js` reaches the menu's landing tab by index.
const tablinks = [...dropdownHtml.matchAll(/<button class="tablink"[^>]*onclick="openTab\('(\w+)', this\)"[^>]*>([^<]+)</g)]
    .map( (m)=> [m[1], m[2].trim()] );

test('no tablink opens the Notes tab, and the ones left are in a known order', ()=>{
    assert.deepEqual(tablinks, [
        ['tab4', 'Ai'],
        ['tab2', 'Fractal'],
        ['tab6', 'Saves'],
        ['tab5', 'Settings'],
        ['tab3', '?'],
    ], 'the tab strip changed; the index reads in dropdown.js point at the wrong tabs');

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
    assert.match(read('resources/styles/styles.css'),
        /body\.ai-disabled #prompt-form,/,
        'the prompt is no longer hidden when AI features are off');
});

test('the menu lands on the Ai tab, and nothing opens tab1 by hand', ()=>{
    assert.doesNotMatch(dropdownJs, /openTab\('tab1'/,
        'something still opens a tab with no tablink');
    // The landing tab is conditional, and the condition is not cosmetic: AI features
    // are off until switched on, and `body.ai-disabled` hides `#tab4` and
    // `#tablink-ai` with `!important`, so an unconditional land on Ai opens the menu
    // on a 214x48 empty box. Measured in the browser before this branch was fixed.
    assert.match(dropdownJs, /AiFeatures\.enabled \? 'tab4' : 'tab2'/,
        'the menu lands on the same tab whether or not AI features are on');
    assert.match(dropdownJs, /const iLanding = AiFeatures\.enabled \? 0 : 1;/,
        'the tablink to mark active is not chosen alongside the tab');
    // Leaving the Ai tab when AI features are switched off. It cannot go to tab4 (the
    // tab being left) and it cannot go to tab1 (no tablink to mark active).
    assert.match(dropdownJs, /openTab\('tab2', document\.getElementsByClassName\('tablink'\)\[1\]\)/,
        'switching AI features off leaves the Ai tab open or lands on a tab with no link');

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
