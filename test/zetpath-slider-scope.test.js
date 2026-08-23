// `adjustSliderVisibilityBasedOnPathType` runs whenever the node placement style
// changes, and it used to reach the whole document for `.settingsSlider`. Sixteen
// controls in the Fractal tab carry that class, so picking a placement style set
// `display: block` on all of them -- including the two that tab hides on purpose.
// Nothing failed, nothing logged; a reader in the Notes settings broke a different
// tab and had no way to connect the two.
//
// A source-text check cannot see that, so this runs the real function against a
// fake DOM that holds both regions and answers `document.querySelectorAll` for
// both. A revert to the document-wide selector shows up as Fractal-tab elements
// with a display the placement styles have no business setting.
//
// Sliced into a `node:vm` context rather than imported: nothing under js/ exports,
// and this file is loaded as one of ~80 plain scripts sharing a global scope.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('js/zettelkasten/zetpath.js', root), 'utf8');

const NAME = 'adjustSliderVisibilityBasedOnPathType';

// The function, from its declaration to the first closing brace in column zero.
function slice(){
    const start = source.indexOf('function ' + NAME);
    assert.notEqual(start, -1, NAME + ' is gone from zetpath.js');
    const end = source.indexOf('\n}', start);
    assert.notEqual(end, -1, 'no closing brace at column zero after ' + NAME);
    return source.slice(start, end + 2);
}

// One element. `style.display` is what the function writes and all this asserts on.
function mkElem(id, classes){
    return {id, classes, style: {}};
}

// The sliders as they sit in the two tabs: twelve placement sliders in the Notes
// settings section, and the Fractal tab's own controls, which share the class the
// old selector matched. `settingsSlider` is on all of them -- that is the trap.
function mkDom(){
    const placement = [
        ...['radial-slider', 'spiral-slider', 'branching-slider'].flatMap( (cls)=>
            [1, 2, 3, 4].map( (n)=> mkElem(cls + '-' + n, ['settingsSlider', cls]) )
        ),
    ];
    const fractal = [
        mkElem('inversion-settings', ['settingsSlider']),
        mkElem('hue-rotation-settings', ['settingsSlider']),
        mkElem('fractal-line-length', ['settingsSlider']),
    ];

    // Enough of `querySelectorAll` for a comma-separated class list, and no more: an
    // edited selector this cannot parse has to fail loudly rather than match nothing
    // and report a pass.
    const query = (pool, selector)=> {
        assert.equal(typeof selector, 'string');
        // The DOM throws on an empty selector. Reproduce that, because the Random
        // placement style is the case that used to reach it.
        if (!selector.trim()) throw new Error('SyntaxError: not a valid selector: ""');
        const parts = selector.split(',').map( (part)=> part.trim() );
        for (const part of parts) {
            assert.match(part, /^\.[\w-]+$/,
                'this fake DOM cannot answer the selector ' + JSON.stringify(part));
        }
        const wanted = parts.map( (part)=> part.slice(1) );
        return pool.filter( (el)=> el.classes.some( (cls)=> wanted.includes(cls) ) );
    };

    const all = [...placement, ...fractal];
    const section = {
        id: 'zetPlacementSettings',
        querySelectorAll: (selector)=> query(placement, selector),
    };
    return {
        placement, fractal, section,
        document: {querySelectorAll: (selector)=> query(all, selector)},
    };
}

function run(styleName){
    const dom = mkDom();
    const context = createContext({
        document: dom.document,
        Elem: {
            byId: (id)=> {
                assert.equal(id, 'zetPlacementSettings',
                    'the function now reads a different section: ' + id);
                return dom.section;
            },
            hide: (el)=> { el.style.display = 'none' },
            displayBlock: (el)=> { el.style.display = 'block' },
        },
    });
    runInContext(slice() + ';globalThis.exported = ' + NAME + ';', context);
    context.exported(styleName);
    return dom;
}

const shown = (elements)=> elements.filter( (el)=> el.style.display === 'block' )
    .map( (el)=> el.id ).sort();

test('each placement style shows its own sliders and hides the other two', ()=>{
    for (const [styleName, cls] of [['Radial', 'radial-slider'],
                                    ['Spiral', 'spiral-slider'],
                                    ['Branching', 'branching-slider']]) {
        const dom = run(styleName);
        assert.deepEqual(shown(dom.placement),
            [1, 2, 3, 4].map( (n)=> cls + '-' + n ),
            styleName + ' does not show exactly its own group');
        assert.deepEqual(
            dom.placement.filter( (el)=> !el.classes.includes(cls) )
                .filter( (el)=> el.style.display !== 'none' ),
            [], styleName + ' leaves another style\'s sliders visible');
    }
});

test('Random hides all three groups instead of throwing', ()=>{
    // It has no sliders of its own, so the old code built an empty selector string
    // and `querySelectorAll('')` threw a DOMException -- out of this function, out of
    // `ZetPath.updateOptions`, and out of whatever asked for the placement change.
    const dom = run('Random');
    assert.deepEqual(shown(dom.placement), [], 'Random shows a slider group');
    assert.deepEqual(dom.placement.filter( (el)=> el.style.display !== 'none' ), [],
        'Random leaves a slider group in its previous state');
});

test('no placement style touches the Fractal tab', ()=>{
    // The bug, stated as a test: these three carry `.settingsSlider` and nothing else,
    // which is what the document-wide selector matched. `#inversion-settings` and
    // `#hue-rotation-settings` are hidden by their own tab, so a `display: block`
    // here made two unrelated controls appear.
    for (const styleName of ['Radial', 'Spiral', 'Branching', 'Random']) {
        const dom = run(styleName);
        assert.deepEqual(dom.fractal.filter( (el)=> el.style.display !== undefined ),
            [], styleName + ' reached the Fractal tab');
    }
});

test('the function asks the section, not the document', ()=>{
    // Belt to the behavioural braces above: a `document.querySelectorAll` that
    // happened to match nothing today would pass those and break on the next class
    // added to the Fractal tab.
    // Comments stripped: the ones in there name the selector they replaced, and the
    // question is what the function does rather than what it says about itself.
    const body = slice().replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(body, /document\.querySelectorAll/,
        'the selector is document-wide again');
    assert.match(body, /Elem\.byId\('zetPlacementSettings'\)/);
    assert.doesNotMatch(body, /\.settingsSlider/,
        'the class every tab shares is back in a selector here');
});
