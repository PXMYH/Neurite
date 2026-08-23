// A Saved Graph stores each Node's HTML, including the SVG paths in its header.
// Rebinding listeners to that HTML is not enough after the sprite changes: an
// older Saved Graph otherwise keeps drawing the old controls forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(
    new URL('../js/nodes/createnodes/window.js', import.meta.url),
    'utf8'
);

function loadNodeView(){
    const start = source.indexOf('class NodeView {');
    const end = source.indexOf('\n}\n\nconst OverlayHelper', start);
    assert.notEqual(start, -1, 'NodeView class start was not found');
    assert.notEqual(end, -1, 'NodeView class end was not found');

    const sandbox = createContext({
        document: {
            querySelector: ()=>null,
            getElementsByClassName: ()=>[],
        },
        On: {mousedown(){}},
        Elem: {},
    });
    runInContext(
        source.slice(start, end + 2) + '\n;globalThis.exported = NodeView;',
        sandbox,
        {filename: 'js/nodes/createnodes/window.js'}
    );
    return {NodeView: sandbox.exported, sandbox};
}

function element(name, lucide){
    return {
        name,
        style: {display: 'none'},
        attributes: lucide ? {'data-lucide': lucide} : {},
        setAttribute(key, value){ this.attributes[key] = value },
        getAttribute(key){ return this.attributes[key] ?? null },
        cloneNode(){ return element(`${name} clone`, lucide) },
        replaceWith(replacement){ this.replacement = replacement },
    };
}

test('a persisted Node header takes fresh controls from the sprite', ()=>{
    const {NodeView, sandbox} = loadNodeView();
    const oldButtons = element('saved button row');
    const oldCopy = element('saved copy');
    const buttonTemplate = element('current button row');
    const copyTemplate = element('current copy', 'copy');

    const copyButton = {
        querySelector: (selector)=> selector === 'svg' ? oldCopy : null,
    };
    const header = {
        querySelector(selector){
            if (selector === '.button-container') return oldButtons;
            if (selector === '.copy-button') return copyButton;
            return null;
        },
    };
    const div = {
        querySelector: (selector)=> selector === '.header-container' ? header : null,
    };

    sandbox.Elem.byId = (id)=> id === 'elements'
        ? {children: [buttonTemplate]}
        : copyTemplate;
    sandbox.Elem.deepClone = (template)=> template.cloneNode(true);

    const view = new NodeView({});
    view.div = div;
    view.refreshControlIcons();

    assert.equal(oldButtons.replacement.name, 'current button row clone');
    assert.equal(oldButtons.replacement.attributes.class, 'button-container');
    assert.equal(oldCopy.replacement.name, 'current copy clone');
    assert.equal(oldCopy.replacement.attributes.class, 'copy-icon');
    assert.equal(oldCopy.replacement.style.display, '');
});

test('a Node refreshes persisted controls before binding their listeners', ()=>{
    const {NodeView} = loadNodeView();
    const view = new NodeView({});
    const order = [];

    view.refreshControlIcons = ()=> order.push('refresh');
    view.bindDOMRefs = ()=> order.push('bind');
    view.initCollapsed = ()=>{};
    view.setWindowDivListeners = ()=>{};
    view.setTitleInputListeners = ()=>{};
    view.setResizeEventListeners = ()=>{};
    view.observeContentResize = ()=>{};

    view.init();

    assert.deepEqual(order, ['refresh', 'bind']);
});
