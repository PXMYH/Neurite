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
const css = read('resources/styles/styles.css');

// The two view switchers, each sliced out at its definition. Anchored on the newline and
// the four-space indent of the object literal, not on the bare name: `showList` appears at
// three call sites as well, and `indexOf('showList(')` would read whichever came first.
// Ending the second slice at a brace in column 0 works because `showDetail` is last.
const iShowList = dropdownJs.indexOf('\n    showList(');
const iShowDetail = dropdownJs.indexOf('\n    showDetail(');
const listBody = dropdownJs.slice(iShowList, iShowDetail);
const detailBody = dropdownJs.slice(iShowDetail, dropdownJs.indexOf('\n}', iShowDetail));
// Code only, for anything that reads statement order. `showList` carries a long comment
// that names both statements it is about, so leaving comments in lets the order be faked:
// move the class removal below the guard, mention it in a comment above the guard, and an
// `indexOf` comparison still sees the earlier position. Over-stripping is safe here --
// nothing in this function is a string holding `//`, and if that changed the patterns
// below would stop matching and fail rather than pass.
const listCode = listBody.replace(/\/\/[^\n]*/g, '');
const assertViewsFound = ()=> assert.ok(iShowList > 0 && iShowDetail > iShowList,
    'the two menu views are no longer showList then showDetail; this test reads nothing');

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

test('the closed menu is out of the keyboard\'s reach, not merely off screen', ()=>{
    // A transformed box is still a rendered box, so translating the panel off screen left
    // every control in it focusable. Measured with real Tab presses on a fresh load, menu
    // closed: stop 7 was `#open-file-button` at y = -354, where Space opens a file
    // dialog; stop 9 was Screenshot; stop 10 was Record, which starts a screen recording
    // with no visible control to stop it. `#open-file-input` was reachable too.
    //
    // `visibility` is the fix and `display` is not: the panel holds the function-calling
    // console, whose CodeMirror measures itself at construction and never recovers a zero
    // width. `visibility: hidden` drops the subtree from the focus order and keeps the
    // box, so both hold at once -- verified after the fix: all four unfocusable while
    // closed, all nine rows 286x34 when open, and the console's `div.CodeMirror` still
    // 302x320 with the menu closed. That element and not `#neurite-function-cm`, which
    // an earlier note named: that is the textarea CodeMirror hides behind itself, and it
    // is `display: none` and 0x0 whether this works or not.
    //
    // Every rule that can reach this element, not the first thing that looks like one.
    // This reads two rules out of the middle of a 4,000-line stylesheet, and the cascade
    // is the part source text cannot see. A count anchored to column 0 with a slice taken
    // by plain `indexOf` was worse than no count at all, because the two could disagree:
    // an indented decoy above the real rule --
    //     .menu-panel, .dropdown-content { visibility: hidden; }
    // -- left the count at 1 and moved every assertion below onto the decoy, after which
    // the real rule could say `visibility: visible` or `display: none` and stay green.
    // `.dropdown-content[class~="open"] { display: none; }` slipped past both counts and
    // both slices, and gives a 0x0 panel with the menu open.
    //
    // So: list the selectors that name this element and require exactly the two that
    // should exist. One assertion refuses the indented duplicate, a grouped selector, a
    // copy inside `@media`, a higher-specificity `#dropdowndiv .dropdown-content`, and
    // the attribute spelling of `.open`. Comments are stripped first, or the prose above
    // `z-index` that mentions the class would count as a rule.
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...cssCode.matchAll(/([^{}]+)\{/g)].map( (m)=> m[1].trim() )
        .filter( (s)=> s.includes('dropdown-content') ).sort();
    assert.deepEqual(selectors, ['.dropdown-content', '.dropdown-content.open'],
        'another rule reaches the menu panel, and it can undo the visibility read below');

    // The same anchored selector both times, so the slice cannot read a rule the check
    // above did not see.
    const ruleFor = (selector)=> {
        const i = cssCode.indexOf(selector + ' {');
        assert.notEqual(i, -1, selector + ' is gone; this test reads nothing');
        return cssCode.slice(i, cssCode.indexOf('}', i));
    };

    const closed = ruleFor('.dropdown-content');
    assert.match(closed, /visibility:\s*hidden/,
        'the closed menu is only translated away, so its commands still take Tab and Space');
    assert.doesNotMatch(closed, /display:\s*none/,
        'display:none gives the function console a zero-width CodeMirror it never recovers from');

    const open = ruleFor('.dropdown-content.open');
    assert.match(open, /visibility:\s*visible/,
        'the menu opens without restoring visibility, so it can never be reached at all');
    // The open state as well as the closed one. `display: none` here is the same zero-width
    // console, and it reaches it by the state a reader is least likely to check: the menu
    // that works is the closed one.
    assert.doesNotMatch(open, /display:\s*none/,
        'the open menu is display:none, which is where the zero-width console comes from');
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
    // The same slice as the assertion above, and for the same reason. Anchoring on the
    // `if` and reaching forward with `[\s\S]*?` looks bounded and is not: lazy stops at
    // the first match, but nothing stops it leaving the handler, so deleting this very
    // call let the pattern run 80 lines on to the `MainMenu.showList()` in the
    // AI-features handler and pass. Measured: with the call gone -- the defect this line
    // names -- 4 of 4 tests passed. Worse, the assertion 5 lines below pins that other
    // call by name, so one call satisfied both and either could vanish unnoticed.
    assert.match(onOpen.slice(0, iEndOfHandler), /MainMenu\.showList\(\)/,
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
    // Each call inside the function that should hold it, and the other call ruled out of
    // it. Both were bare presence checks against the whole file, which two lines 6 apart
    // satisfy in either arrangement: swapping the bodies, so that showList opens a panel
    // and showDetail closes one, left every row of the menu doing the opposite of its
    // name and both assertions green.
    assertViewsFound();
    assert.match(listBody, /classList\.remove\('detail-open'\)/, 'showList shows no list');
    assert.doesNotMatch(listBody, /classList\.add\('detail-open'\)/,
        'showList opens a panel instead of closing one');
    assert.match(detailBody, /classList\.add\('detail-open'\)/, 'showDetail shows no panel');
    assert.doesNotMatch(detailBody, /classList\.remove\('detail-open'\)/,
        'showDetail closes the panel it just opened');
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

test('switching menu view carries focus with it, rather than dropping it on the document', ()=>{
    // The control that switches the view is inside the view that goes `display: none`,
    // and the browser resets focus to `<body>` when that happens. Measured two frames
    // after the click, because the reset is not synchronous and a same-tick read still
    // names the button: clicking a row left focus on BODY, and so did clicking Back --
    // from where the panel that had just opened was seven Tabs away, at the top of the
    // document, past the whole tool bar.
    //
    // Measure it with real clicks and a frame in between, or the probe fails on its own.
    // Opening the menu and clicking a row in one tick leaves focus on BODY even with the
    // fix in: the panel is still `visibility: hidden` at that instant, and `.focus()` on
    // a hidden element does nothing. A frame later the same click focuses the back
    // button, which is every path a hand can take -- `openTab` only runs from a row, and
    // a row can only be clicked once the menu is on screen.
    assertViewsFound();

    assert.match(detailBody, /Elem\.byId\('menuBackButton'\)\.focus\(\)/,
        'opening a panel leaves focus on a row that is now display:none, so it falls to <body>');

    // Back goes to the row `openTab` marked, not to the top of the column: the reader
    // returns to the row they left. This is the only thing that reads `activeTab` for
    // that, which is what the note above `.tablink.activeTab` in styles.css claims.
    // One statement, whole. A `?? querySelector('.menu-row')` fallback read here for a
    // first open, which cannot happen -- every route into the panel view runs `openTab`
    // and `openTab` writes `activeTab` -- and resolved to `#open-file-button`, where
    // Space opens a file dialog. Counting `querySelector` reads is not enough to keep it
    // out, because the defect can come back spelled another way: `?? Elem.byId(
    // 'open-file-button')` restores exactly the old behaviour with one `querySelector`
    // still in the file, and `Elem.byId` is this codebase's own convention, so it is the
    // likely rewrite rather than a contrived one. So: the statement is matched entire,
    // one focus call is allowed, and a defaulting operator is refused outright.
    assert.match(listCode, /MainMenu\.div\.querySelector\('\.menu-row\.activeTab'\)\?\.focus\(\);/,
        'going back does not return focus to the row whose panel was open');
    assert.equal((listCode.match(/\.focus\(/g) || []).length, 1,
        'showList moves focus twice; the second one decides, and it is not the marked row');
    assert.doesNotMatch(listCode, /\?\?|\|\|/,
        'showList falls back to another element when no row is marked; that case cannot happen, '
        + 'and the fallback it had focused #open-file-button, where Space opens a file dialog');

    // And not for the two callers that pass no event. Without the guard, opening the
    // menu pulls focus off the menu button on every click, and switching AI features off
    // pulls it off the checkbox that did it -- a checkbox outside the menu entirely.
    const iGuard = listCode.search(/if \(!e\) return|if \(arguments\.length === 0\) return/);
    assert.notEqual(iGuard, -1,
        'showList moves focus even when no click brought it there, so opening the menu steals it');

    // Order, because the guard returning early is only safe once the view has switched.
    // Moving the guard above the class removal is a two-line edit that leaves every
    // assertion above matching, and it stops the menu-open path closing the panel view:
    // the menu then reopens showing the last panel, and with AI features off that panel
    // is hidden and the menu is an empty box -- the bug this file is named for. Measured:
    // with the two lines swapped, 116 of 116 passed.
    //
    // Comparing two `indexOf`s is only as good as its inputs, so three things hold it up:
    // comments are stripped, or naming the statement in the prose above the guard fakes
    // the position; the quotes are either kind, or `remove("detail-open")` matches
    // nothing; and exactly one `return` may exist, or the removal can move into a helper
    // that is called after a guard which still reads first.
    assert.equal((listCode.match(/\breturn\b/g) || []).length, 1,
        'showList has a second exit; the order checked below is not the order it runs in');
    const iRemove = listCode.search(/classList\.remove\(["']detail-open["']\)/);
    assert.notEqual(iRemove, -1, 'showList shows the row list without closing the panel view');
    assert.ok(iRemove < iGuard,
        'showList returns before it closes the panel view, so opening the menu keeps showing a panel');
});

test('every menu row describes what it does, and the heading is not overridden', ()=>{
    // The five panel rows carried a `title` as chips and got nothing in exchange when
    // they became rows, leaving one or two words as the whole description of a panel --
    // while the four command rows directly above them kept theirs. So this reads all
    // nine: a hover that works on four rows out of nine is the shape the gap had.
    const iList = dropdownHtml.indexOf('class="menu-list"');
    const iDetail = dropdownHtml.indexOf('id="menuDetail"');
    assert.ok(iList > 0 && iDetail > iList, 'the list and the panel are no longer in that order');
    const rows = [...dropdownHtml.slice(iList, iDetail)
        .matchAll(/<button[^>]*class="menu-row[^"]*"[^>]*>/g)].map( (m)=> m[0] );
    assert.equal(rows.length, 9, 'the menu no longer has nine rows; check what this is reading');

    for (const row of rows) {
        // Save to… is the one exception, and it is written at runtime: what that row
        // does depends on whether the browser can hold a file open.
        if (row.includes('id="disk-file-button"')) continue;
        assert.match(row, /\stitle="[^"]{16,}"/,
            'a menu row says nothing on hover: ' + row.replace(/\s+/g, ' ').slice(0, 70));
    }
    // Each panel row's title tied to the panel it opens, not merely to being long
    // enough. Length alone is satisfied by any five sentences in any order: swapping the
    // Settings and Help titles left every row describing a different panel from the one
    // it opens, and 116 of 116 passed.
    //
    // Three things make the tie hold, each closing a way the first version could pass on
    // a wrong title:
    //
    // - The word has to be *exclusive* to its own panel's text. `fractal` for tab2 and
    //   `control` for tab3 were not: the Help panel says both, so those two titles could
    //   be swapped and both halves still passed. Measured over all five files, the words
    //   below are each in one panel and no other, and every current title already
    //   contains its own -- so this pins the titles rather than rewriting them.
    // - The word is read out of *visible text*, not out of the file. Markup carries the
    //   vocabulary in ids and comments: rename every "Coordinates" a reader can see in
    //   networkstab.html and `id="savedCoordinatesContainer"` alone keeps the old check
    //   green, with the row now describing a panel that no longer says it.
    // - A title may not contain another panel's word, or one sentence can name two
    //   panels and pass as both -- "Adjust how the fractal is drawn: every control for
    //   it, in one list." reads like the Fractal panel and was on the Help row.
    const PANELS = {
        tab4: ['aitab.html', 'API'],
        tab2: ['fractaltab.html', 'drawn'],
        tab6: ['networkstab.html', 'coordinates'],
        tab5: ['settingstab.html', 'placement'],
        tab3: ['helptab.html', 'mouse'],
    };
    // What a reader sees: comments and scripts out, then tags, so ids and attributes go
    // with them.
    const visibleText = (file)=> read('resources/html/tabs/' + file)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
        .replace(/<[^>]*>/g, ' ');
    const seen = Object.fromEntries(Object.values(PANELS).map( ([f])=> [f, visibleText(f)] ));

    for (const [tab, [file, word]] of Object.entries(PANELS)) {
        const re = new RegExp(word, 'i');
        const row = rows.find( (r)=> r.includes("openTab('" + tab + "'") );
        assert.ok(row, 'no menu row opens ' + tab + ' any more; check this table');
        const title = row.match(/\stitle="([^"]*)"/);
        assert.ok(title, 'the row for ' + tab + ' says nothing on hover');
        assert.match(title[1], re,
            'the row for ' + tab + ' no longer describes that panel: ' + title[1]);
        assert.match(seen[file], re,
            file + ' no longer shows the word "' + word + '", so the title above describes '
            + 'something the panel does not say');

        for (const [other, [otherFile, otherWord]] of Object.entries(PANELS)) {
            if (other === tab) continue;
            assert.doesNotMatch(seen[otherFile], re,
                '"' + word + '" is in ' + otherFile + ' too, so the titles for ' + tab
                + ' and ' + other + ' can be swapped and both still pass');
            assert.doesNotMatch(title[1], new RegExp(otherWord, 'i'),
                'the title on the row for ' + tab + ' also names the panel ' + other
                + ' opens, so it reads as a description of that one: ' + title[1]);
        }
    }

    const savenetJs = read('js/interface/dropdown/savenet.js');
    const iUpdate = savenetJs.indexOf('#updateDiskFileButton = ()=>{');
    assert.ok(iUpdate > 0, 'nothing updates the Save to… row any more; check this test');
    assert.match(savenetJs.slice(iUpdate, savenetJs.indexOf('\n    }', iUpdate)), /btn\.title = /,
        'nothing writes the Save to… title, so that row says nothing on hover either');

    // The back button takes its name from its own contents, so the name carries the open
    // panel's. An `aria-label` here overrode that subtree, and the subtree is the only
    // place the panel is ever named: a screen reader was read "Back to the menu, button"
    // over a panel of fractal sliders, with nothing anywhere saying Fractal.
    const iBack = dropdownHtml.indexOf('id="menuBackButton"');
    assert.ok(iBack > 0, 'the back button is gone');
    const back = dropdownHtml.slice(dropdownHtml.lastIndexOf('<button', iBack),
                                   dropdownHtml.indexOf('</button>', iBack));
    // Both attributes: `aria-labelledby="menuDetailTitle"` overrides the subtree exactly
    // as `aria-label` did, points at the title, and so silently drops the "Back to" the
    // line below is checking for -- with the name still reading "Fractal", which looks
    // right until the reader tries to work out what the button does.
    assert.doesNotMatch(back, /aria-label(ledby)?=/,
        'the back button declares its own name again, which hides the panel it heads');
    assert.match(back, /class="visually-hidden">Back to<\/span>[\s\S]*?id="menuDetailTitle"/,
        'the back button no longer reads as going back, or says so after the panel name');
    // The span whole, because the line above anchors on `class="..."` and attributes have
    // no order: `<span aria-hidden="true" class="visually-hidden">Back to</span>` matches
    // it and takes the words straight back out of the name, leaving "Fractal, button".
    const span = back.match(/<span[^>]*>Back to<\/span>/);
    assert.ok(span, 'the "Back to" wrapper is no longer one span; this check reads nothing');
    assert.doesNotMatch(span[0], /aria-hidden/,
        'the words "Back to" are hidden from the name they exist to build');
});
