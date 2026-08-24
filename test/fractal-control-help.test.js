// The Fractal tab's controls each carry a `title`, which is hover-only: a keyboard
// user never sees it, a screen reader ignores it when the element has a name, and a
// touch device has no hover at all. So the four controls the reader is most likely
// to be puzzled by -- the exponent, the equation menu, the quality/frame-rate
// trade-off and the pointer's pull on line generation -- say the same thing again in
// the accessibility tree, through `aria-describedby` and a `.visually-hidden` block.
//
// Two halves to check, because the association is made in two places:
//
//   - the markup, read as text (`resources/html/tabs/fractaltab.html`), the way
//     settings-tab.test.js reads the tabs;
//   - the equation menu, which is a `select` that `CustomDropdown.setup` hides
//     behind a div, so its name and description have to be carried onto the div or
//     they describe an element no one can reach. That half runs the real function in
//     a `node:vm` sandbox against a small fake DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const TAB = 'resources/html/tabs/fractaltab.html';
const html = read(TAB);

// The four controls, the id of the help block each points at, and what the text has
// to say to be worth reading. `range` asks for the control's own min and max to
// appear in the words, so a slider whose range is changed without the sentence being
// changed fails here rather than misinforming a reader.
const CONTROLS = [
    {id: 'exponent', help: 'exponent-help', range: true, mentions: [/equation/i]},
    {id: 'fractal-select', help: 'fractal-select-help', range: false,
     mentions: [/equation/i, /Julia Set/]},
    {id: 'quality', help: 'quality-help', range: true, mentions: [/fps|frame rate/i]},
    {id: 'quality_value_number', help: 'quality-help', range: true, mentions: []},
    {id: 'flashlightStrength', help: 'flashlightStrength-help', range: true,
     mentions: [/pointer/i]},
    {id: 'flashlightStrength_value', help: 'flashlightStrength-help', range: true, mentions: []}
];

// The tag that carries an id, whichever attribute order it was written in.
function tagWithId(id){
    const match = html.match(new RegExp('<[a-z]+[^>]*\\sid="' + id + '"[^>]*>'));
    assert.ok(match, id + ' is not in ' + TAB);
    return match[0];
}
function attr(tag, name){
    const match = tag.match(new RegExp('\\s' + name + '="([^"]*)"'));
    return match ? match[1] : null;
}
// The text of a help block, tags stripped.
function helpText(id){
    const match = html.match(new RegExp('<p\\s[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</p>'));
    assert.ok(match, 'no <p> carries the id ' + id);
    return match[1].replace(/<[^>]+>/g, '').trim();
}

test('each control points at a help block that exists once and says something', ()=>{
    for (const control of CONTROLS) {
        const tag = tagWithId(control.id);
        assert.equal(attr(tag, 'aria-describedby'), control.help,
            control.id + ' does not point at its help text');

        const occurrences = [...html.matchAll(new RegExp('\\sid="' + control.help + '"', 'g'))];
        assert.equal(occurrences.length, 1,
            control.help + ' appears ' + occurrences.length + ' times; a duplicate id is read once');

        const text = helpText(control.help);
        assert.ok(text.length > 40, control.help + ' is too short to explain anything: ' + text);
        for (const pattern of control.mentions) {
            assert.match(text, pattern, control.help + ' does not mention ' + pattern);
        }
    }
});

test('a help block is hidden from the page but not from the accessibility tree', ()=>{
    // `.visually-hidden` is the project's existing way of doing this (the Open file
    // input in networkstab.html uses it).
    //
    // The reason to refuse `display: none` here is not the one this note used to give.
    // "It would take the text out of the accessibility tree as well" is false for these
    // four: name and description computation follows `aria-describedby` into a hidden
    // subtree by design, and measuring it confirms that -- with `.visually-hidden` set to
    // `display: none`, `#exponent` still reports "The power the equation raises z to, from
    // 1 to 8...". That is exactly why the pattern exists for a *describedby target*.
    //
    // The real cost is on the other user of this shared rule. The menu's back button
    // builds its own name out of a `.visually-hidden` span, and subtree text is not
    // exempt: `display: none` there turns "Back to Fractal" into "Fractal", a name that
    // reads as a heading rather than as a way out. So the assertion stays and the reason
    // moves -- a change made for the help blocks lands on the button.
    for (const id of new Set(CONTROLS.map( (c)=> c.help ))) {
        const tag = tagWithId(id);
        assert.match(attr(tag, 'class') || '', /\bvisually-hidden\b/,
            id + ' is not marked visually-hidden');
        assert.doesNotMatch(tag, /\shidden[\s>]|display:\s*none/,
            id + ' is hidden in a way that also hides it from a screen reader');
    }

    const css = read('resources/styles/styles.css');
    // The rule, found by its opening brace. Anchored on the bare class name, this took
    // the first *mention* anywhere in the file -- and a comment 130 lines above the rule
    // now names the class, explaining that `#open-file-input` inherits the menu's
    // `visibility` because this sets none. The slice became that comment, and all four
    // assertions below read a paragraph of English for CSS declarations.
    // And the selectors before the slice, or the slice can be aimed somewhere else: this
    // takes the first `indexOf`, which an indented `.foo, .visually-hidden {` above the
    // real rule satisfies, and every assertion below would then read that decoy while the
    // rule it is about says whatever it likes. Comments are stripped first because one 130
    // lines above the rule names the class in prose.
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.deepEqual([...cssCode.matchAll(/([^{}]+)\{/g)].map( (m)=> m[1].trim() )
        .filter( (s)=> s.includes('visually-hidden') ), ['.visually-hidden'],
        'a second rule reaches .visually-hidden. If it cannot change the clipping or the '
        + 'positioning read below, add its selector to this list; if it can, that is the bug');
    const iRule = cssCode.indexOf('.visually-hidden {');
    assert.notEqual(iRule, -1, 'the .visually-hidden rule is gone; this test is stale');
    const rule = cssCode.slice(iRule, cssCode.indexOf('}', iRule));
    assert.match(rule, /clip-path:\s*inset\(50%\)/, '.visually-hidden no longer clips its content');
    // Both spellings, for the reason set out at the top of this test: each one cuts
    // "Back to" out of the menu back button's name, leaving "Fractal".
    assert.doesNotMatch(rule, /display:\s*none/,
        '.visually-hidden cuts "Back to" out of the menu back button\'s name, which shares '
        + 'this rule and builds its name from its own subtree');
    assert.doesNotMatch(rule, /visibility:\s*hidden/,
        '.visually-hidden cuts "Back to" out of the menu back button\'s name, which shares '
        + 'this rule and builds its name from its own subtree');

    // Absolute with no offset means "stay where you would have been", and an
    // `overflow: hidden` ancestor only clips absolute descendants it is the containing
    // block for. These four sit in a collapsed panel that is not positioned, so
    // without an offset their boxes escaped its clip and the Fractal panel scrolled
    // 196px of nothing.
    //
    // `position` as well as the offset, because an offset on a static box is ignored
    // and this rule would then hide four boxes in the flow. And `top` only: a comment
    // here claimed `left` was what stopped the panel widening, which measuring one
    // declaration at a time in the browser refutes -- with both, the panel is 343px
    // wide and scrolls 0; dropping `left` leaves 343 and 0, moving the box from x=16 to
    // x=42 and changing nothing else; dropping `top` gives 196px of scroll and 358px of
    // width, where the extra 15px is the scrollbar that scroll opens rather than a
    // sideways spill (`scrollWidth` is 341 either way). So `left: 0` stays in the
    // stylesheet as part of the recipe and is not asserted: there is nothing it breaks.
    assert.match(rule, /position:\s*absolute/, '.visually-hidden ignores its offsets now, so the four boxes are back in the flow');
    assert.match(rule, /top:\s*0/, '.visually-hidden sits at its static position again, which a collapsed panel does not clip');
});

test('the help text states the range the control actually accepts', ()=>{
    for (const control of CONTROLS.filter( (c)=> c.range )) {
        const tag = tagWithId(control.id);
        const min = attr(tag, 'min');
        const max = attr(tag, 'max');
        assert.ok(min !== null && max !== null, control.id + ' has no min/max to describe');

        const text = helpText(control.help);
        assert.match(text, new RegExp('\\b' + min + '\\b'),
            control.help + ' does not name the minimum (' + min + ')');
        assert.match(text, new RegExp('\\b' + max + '\\b'),
            control.help + ' does not name the maximum (' + max + ')');
    }
});

test('the hover text is still there, and the existing names are untouched', ()=>{
    // The `title` attributes are what a mouse user has always had; the descriptions
    // are in addition to them, not instead of them.
    for (const title of ['Adjusts exponent of current fractal',
                         'Select the current fractal equation',
                         'Adjust smoothness of fractal lines. Lower to reduce lag',
                         "Adjusts cursor's control of line generation"]) {
        assert.ok(html.includes('title="' + title + '"'), 'the hover text is gone: ' + title);
    }

    // `#flashlightStrength` is named by a `<label for>`. An `aria-label` there would
    // replace that name rather than add to it, so it must not have one.
    assert.match(html, /<label for="flashlightStrength">Strength:<\/label>/);
    assert.equal(attr(tagWithId('flashlightStrength'), 'aria-label'), null,
        'an aria-label on #flashlightStrength overrides the label that names it');

    // The controls that had no name at all now have one; a description without a
    // name is announced as "slider, 2" and explains nothing.
    for (const [id, name] of [['exponent', 'Exponent'], ['fractal-select', 'Fractal equation'],
                              ['quality', 'Quality'], ['flashlightStrength_value', 'Strength']]) {
        assert.equal(attr(tagWithId(id), 'aria-label'), name, id + ' lost its name');
    }

    // Every `<label for>` in the tab still points at something in it.
    for (const match of html.matchAll(/<label for="([^"]+)"/g)) {
        assert.match(html, new RegExp('\\sid="' + match[1] + '"'),
            'a label points at ' + match[1] + ', which is not in the tab');
    }
});

test('the help ids are unique across every file the page loads', ()=>{
    // `aria-describedby` resolves by id against the whole document, and the tabs are
    // all injected into it. A second element with the same id wins or loses silently.
    const src = read('js/main.js');
    const resBlock = src.slice(src.indexOf('static resources = ['),
                               src.indexOf(']', src.indexOf('static resources = [')));
    const resources = [...resBlock.matchAll(/'([^']+)'/g)].map( (m)=> 'resources/' + m[1] + '.html' );
    const tabBlock = src.slice(src.indexOf('static tabs = {'),
                               src.indexOf('}', src.indexOf('static tabs = {')));
    const tabs = [...tabBlock.matchAll(/'[\w-]+'\s*:\s*'([^']+)'/g)]
        .map( (m)=> 'resources/html/tabs/' + m[1] );
    assert.ok(resources.length >= 4 && tabs.length >= 5, 'the PageLoad parse is stale');

    const files = ['index.html', ...resources.filter( (p)=> !p.includes('/svg/') ), ...tabs];
    for (const id of new Set(CONTROLS.map( (c)=> c.help ))) {
        const holders = files.filter( (file)=> read(file).includes('id="' + id + '"') );
        assert.deepEqual(holders, [TAB], id + ' is in more than one loaded file');
    }
});

// --- the equation menu, as the reader actually meets it -----------------------

const DROPDOWN = 'js/interface/dropdown/customui/customdropdown.js';

// Enough DOM for CustomDropdown.setup: class lists, a child list, attributes, and a
// querySelector that understands `.class`, `tag > tag` and `[data-value="x"]`.
function makeElement(tagName, className = ''){
    const el = {
        tagName: tagName.toUpperCase(),
        children: [],
        attributes: {},
        dataset: {},
        style: {},
        parentNode: null,
        listeners: {},
        innerText: '',
        get textContent(){ return this.innerText },
        set innerHTML(value){ if (value === '') this.children = [] },
        classList: {
            add(...names){ names.forEach( (n)=> el.classes.add(n) ) },
            remove(...names){ names.forEach( (n)=> el.classes.delete(n) ) },
            contains: (name)=> el.classes.has(name),
            toggle(name, on){ on ? el.classes.add(name) : el.classes.delete(name) }
        },
        classes: new Set(className.split(' ').filter(Boolean)),
        setAttribute(name, value){ this.attributes[name] = String(value) },
        getAttribute(name){ return this.attributes[name] ?? null },
        hasAttribute(name){ return name in this.attributes },
        removeAttribute(name){ delete this.attributes[name] },
        appendChild(child){
            if (child.parentNode) child.parentNode.children =
                child.parentNode.children.filter( (c)=> c !== child );
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        insertBefore(node, ref){
            node.parentNode = this;
            this.children.splice(this.children.indexOf(ref), 0, node);
            return node;
        },
        removeChild(child){ this.children = this.children.filter( (c)=> c !== child ) },
        get firstChild(){ return this.children[0] },
        contains(other){
            if (other === this) return true;
            return this.children.some( (child)=> child.contains(other) );
        },
        matches(selector){
            const m = selector.match(/^\[data-value="(.*)"\]$/);
            if (m) return this.dataset.value === m[1];
            if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
            return this.tagName === selector.toUpperCase();
        },
        querySelectorAll(selector){
            const parts = selector.split('>').map( (s)=> s.trim() );
            let found = this.descendants().filter( (el)=> el.matches(parts[0]) );
            for (const part of parts.slice(1)) {
                found = found.flatMap( (el)=> el.children ).filter( (el)=> el.matches(part) );
            }
            return found;
        },
        querySelector(selector){ return this.querySelectorAll(selector)[0] ?? null },
        descendants(){
            return this.children.flatMap( (child)=> [child, ...child.descendants()] );
        },
        dispatchEvent(event){
            (this.listeners[event.type] || []).forEach( (cb)=> cb(event) );
            return true;
        }
    };
    if (className) el.attributes.class = className;
    return el;
}

// The `<select id="fractal-select">` from the tab, with the attributes it carries in
// the markup, so what is checked below is the real association and not a fixture.
function makeFractalSelect(){
    const tag = tagWithId('fractal-select');
    const select = makeElement('select');
    for (const match of tag.matchAll(/\s([\w-]+)="([^"]*)"/g)) {
        if (match[1] === 'class') select.classes = new Set(match[2].split(' '));
        else select.attributes[match[1]] = match[2];
    }
    select.id = attr(tag, 'id');

    const optionBlock = html.slice(html.indexOf(tag) + tag.length, html.indexOf('</select>'));
    const options = [...optionBlock.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)]
        .map( (m, i)=> ({value: m[1], innerText: m[2], textContent: m[2], selected: i === 0, dataset: {}}) );
    assert.ok(options.length >= 5, 'the option list parse is stale');
    select.options = options;

    // A real select keeps `selectedIndex`, `value` and each option's `selected` in
    // step; code that moves one and reads another only works because of that.
    let index = 0;
    const setIndex = (next)=>{
        index = next;
        options.forEach( (option, i)=> { option.selected = (i === index) } );
    };
    Object.defineProperties(select, {
        selectedIndex: {get: ()=> index, set: setIndex},
        value: {
            get: ()=> options[index]?.value ?? '',
            set(next){
                const found = options.findIndex( (option)=> option.value === next );
                if (found >= 0) setIndex(found);
            }
        }
    });
    setIndex(0);
    return select;
}

function loadCustomDropdown(){
    const src = read(DROPDOWN);
    const changes = [];
    const document = makeElement('div');
    document.querySelectorAll = ()=> [];

    const sandbox = createContext({
        document,
        window: {requestAnimationFrame: (cb)=> cb()},
        localStorage: {getItem: ()=> null, setItem(){}},
        Event: class { constructor(type, opts = {}){ this.type = type; Object.assign(this, opts) } },
        Elem: {
            byId: ()=> null,
            forEachChild(elem, cb, ct){ Array.prototype.forEach.call(elem.children, cb, ct) }
        },
        Html: {make: {div: (cls)=> makeElement('div', cls), select: (cls)=> makeElement('select', cls)}},
        On: new Proxy({}, {get: (_t, type)=> (elem, cb)=> {
            (elem.listeners[type] ??= []).push(cb);
        }}),
        Logger: {info(){}, debug(){}, warn(){}, err(){}},
        Array, Object, JSON, Math, Date, Set, String, Number, Boolean
    });
    runInContext(src + '\n;globalThis.exported = {CustomDropdown, Select};',
        sandbox, {filename: DROPDOWN});
    return {...sandbox.exported, changes};
}

// One wired-up dropdown: the select in a container, run through the real setup.
function wireFractalDropdown(){
    const {CustomDropdown, Select} = loadCustomDropdown();
    const select = makeFractalSelect();
    const holder = makeElement('div', 'dropdown-container');
    holder.appendChild(select);

    const changes = [];
    (select.listeners.change ??= []).push( (e)=> changes.push(select.value) );

    CustomDropdown.setup(select);
    const container = select.parentNode;
    const replacer = container.querySelector('.select-replacer');
    return {CustomDropdown, Select, select, replacer,
            options: replacer.querySelector('.options-replacer'), changes};
}

test('the visible dropdown carries the name and description written on the select', ()=>{
    const {select, replacer, options} = wireFractalDropdown();

    // The select itself is out of the picture -- this is the failure the whole
    // exercise turns on.
    assert.equal(select.style.display, 'none');

    assert.equal(replacer.getAttribute('aria-describedby'), 'fractal-select-help',
        'the description was left on the hidden select');
    assert.equal(replacer.getAttribute('aria-label'), 'Fractal equation');
    assert.equal(replacer.getAttribute('role'), 'combobox');
    assert.equal(replacer.getAttribute('aria-haspopup'), 'listbox');
    assert.equal(replacer.getAttribute('aria-expanded'), 'false');
    assert.equal(replacer.getAttribute('tabindex'), '0', 'no keyboard can reach it');
    assert.equal(replacer.getAttribute('aria-controls'), 'fractal-select-options');
    assert.equal(options.getAttribute('role'), 'listbox');
    assert.equal(options.id, 'fractal-select-options');

    const optionDivs = options.children;
    assert.equal(optionDivs.length, select.options.length);
    assert.equal(optionDivs[0].getAttribute('role'), 'option');
    assert.deepEqual(optionDivs.map( (div)=> div.getAttribute('aria-selected') ),
        ['true', ...optionDivs.slice(1).map( ()=> 'false' )]);
});

test('the dropdown answers the keys a select answers', ()=>{
    const {select, replacer, options, changes} = wireFractalDropdown();
    const press = (key)=>{
        let defaultPrevented = false, propagationStopped = false;
        replacer.dispatchEvent({
            type: 'keydown', key,
            preventDefault(){ defaultPrevented = true },
            stopPropagation(){ propagationStopped = true }
        });
        return {defaultPrevented, propagationStopped};
    };

    // Enter opens the list and says so, Escape closes it.
    const opened = press('Enter');
    assert.equal(options.classList.contains('show'), true, 'Enter did not open the list');
    assert.equal(replacer.getAttribute('aria-expanded'), 'true');
    assert.equal(opened.defaultPrevented, true);
    // The arrows move selected Nodes and Space is a Node Mode key, both bound on
    // `window`: a key answered here must not also reach the Graph.
    assert.equal(opened.propagationStopped, true);

    press('Escape');
    assert.equal(options.classList.contains('show'), false, 'Escape did not close the list');
    assert.equal(replacer.getAttribute('aria-expanded'), 'false');

    // The arrows move the selection and fire the one event every reader is bound to.
    const second = select.options[1].value;
    press('ArrowDown');
    assert.equal(select.value, second);
    assert.deepEqual(changes, [second], 'no change event, so nothing downstream updated');
    assert.equal(options.children[1].getAttribute('aria-selected'), 'true');
    assert.equal(options.children[0].getAttribute('aria-selected'), 'false');
    assert.equal(replacer.querySelector('.selected-text').innerText, select.options[1].innerText);

    press('ArrowUp');
    assert.equal(select.value, select.options[0].value);

    // At the ends it stays put rather than wrapping, as a select does, and an
    // unhandled key is left to the app.
    press('ArrowUp');
    assert.equal(select.value, select.options[0].value);
    assert.equal(changes.length, 2, 'a no-op step still fired a change');
    assert.equal(press('a').defaultPrevented, false);
});
