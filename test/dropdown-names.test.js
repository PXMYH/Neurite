// Every custom dropdown has an accessible name (#66).
//
// `CustomDropdown.setup` hides the real <select> (`display: none`) and puts a div in its
// place. A `<label for>` names only the element with that id, so each label was naming a
// node no reader could reach, and 9 of the 10 replacers in the panels were announced as
// "combobox, collapsed" with nothing to say which setting they were. The name is now
// carried across with the rest of what the select holds.
//
// The source is run in a node:vm context, the way the rest of this suite reaches js/:
// nothing there exports anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const DROPDOWN = 'js/interface/dropdown/customui/customdropdown.js';

// Just enough element for the functions under test: attributes, a class list, children,
// and `labels` the way a real <select> exposes them.
function makeElement(tag, className = '', labels = []){
    return {
        tagName: tag.toUpperCase(), id: '', className, children: [], attributes: {}, style: {},
        labels,
        setAttribute(name, value){ this.attributes[name] = String(value) },
        getAttribute(name){ return this.attributes[name] ?? null },
        hasAttribute(name){ return name in this.attributes },
        appendChild(child){ this.children.push(child); return child },
    };
}

function load(byId = ()=> null){
    const sandbox = createContext({
        document: {querySelectorAll: ()=> []},
        window: {},
        localStorage: {getItem: ()=> null, setItem(){}},
        Elem: {byId},
        Html: {make: {div: (cls)=> makeElement('div', cls), select: (cls)=> makeElement('select', cls)}},
        On: new Proxy({}, {get: ()=> ()=>{}}),
        Logger: {info(){}, debug(){}, warn(){}, err(){}},
    });
    runInContext(readFileSync(DROPDOWN, 'utf8')
        + '\n;globalThis.exported = {CustomDropdown, createSelectWithWrapper};', sandbox);
    return sandbox.exported;
}

const labelled = (text)=> makeElement('select', '', [{textContent: text}]);

test('a replacer and its listbox take the name of the label that points at the select', ()=>{
    const {CustomDropdown} = load();
    const select = labelled('  Inference\n  ');
    const replacer = makeElement('div'), listbox = makeElement('div');
    CustomDropdown.carryAccessibility(select, replacer, listbox);

    assert.equal(replacer.getAttribute('aria-label'), 'Inference');
    assert.equal(listbox.getAttribute('aria-label'), 'Inference');
    assert.equal(replacer.getAttribute('role'), 'combobox');
});

test('a deliberate aria-label on the select beats the label text', ()=>{
    const {CustomDropdown} = load();
    const select = labelled('+ Ollama');
    select.setAttribute('aria-label', 'Ollama');
    const replacer = makeElement('div'), listbox = makeElement('div');
    CustomDropdown.carryAccessibility(select, replacer, listbox);

    assert.equal(replacer.getAttribute('aria-label'), 'Ollama');
});

test('a select with no name leaves the replacer unnamed rather than inventing one', ()=>{
    const {CustomDropdown} = load();
    const replacer = makeElement('div'), listbox = makeElement('div');
    CustomDropdown.carryAccessibility(makeElement('select'), replacer, listbox);

    assert.equal(replacer.getAttribute('aria-label'), null);
});

test("an AI Node's own dropdown is named after the global one it mirrors", ()=>{
    const globalTwin = labelled('Claude');
    const {createSelectWithWrapper} = load( (id)=> (id === 'anthropic-select') ? globalTwin : null );
    const wrapper = createSelectWithWrapper('anthropic-select', 'anthropic', 3);
    const select = wrapper.children[0].children[0];

    assert.equal(select.id, 'anthropic-select-3');
    assert.equal(select.getAttribute('aria-label'), 'Claude');
});

// The markup side: every <select> the app loads either carries its own aria-label or has a
// <label for> whose content is text. A label that wraps a button ("+ Ollama") names the
// control after an action, and is invalid content for a label besides. Seven selects
// failed this before #66.
test('every select in the loaded markup has a usable name', ()=>{
    const files = [
        ...readdirSync('resources/html/tabs').filter( (f)=> f.endsWith('.html') )
            .map( (f)=> 'resources/html/tabs/' + f ),
        'resources/html/modals.html',
    ];
    const unnamed = [];
    for (const file of files) {
        const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        for (const [tag, id] of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
            if (/\baria-label="[^"]+"/.test(tag)) continue;
            const label = html.match(new RegExp(`<label[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)</label>`));
            if (label && !/<button/i.test(label[1]) && label[1].replace(/<[^>]+>/g, '').trim()) continue;
            unnamed.push(`${file}#${id}`);
        }
    }
    assert.deepEqual(unnamed, []);
});
