// The icon sprite is an interface: markup and scripts refer to its ids, while
// the artwork behind those ids should stay in one visual language. These checks
// pin both halves so replacing an icon cannot silently make a control blank or
// reintroduce one-off artwork.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path)=> readFileSync(new URL(path, root), 'utf8');
const sprite = read('resources/svg/icons.html');

const EXPECTED = {
    'note-icon-symbol': 'sticky-note',
    'link-icon-symbol': 'link-2',
    'edges-icon-symbol': 'folder-tree',
    'ai-icon-symbol': 'bot',
    'searchSVG': 'search',
    'plus-icon': 'plus',
    'delete-icon': 'trash-2',
    'gear-icon': 'settings',
    'fractal-icon': 'orbit',
    'question-mark': 'circle-question-mark',
    'play-icon': 'send',
    'refresh-icon': 'rotate-cw',
    'pause-icon': 'pause',
    'function-button': 'chevrons-up-down',
    'eyeball-symbol': 'eye',
    'crossed-eyeball-symbol': 'eye-off',
    'folder-icon': 'folder',
    'folder-open-icon': 'folder-open',
    'folder-plus-icon': 'folder-plus',
    'file-text-icon': 'file-text',
    'file-image-icon': 'file-image',
    'file-code-icon': 'file-code',
    'file-csv-icon': 'file-spreadsheet',
    'file-pdf-icon': 'file-text',
    'file-audio-icon': 'file-music',
    'file-video-icon': 'file-video-camera',
    'file-zip-icon': 'file-archive',
    'file-exe-icon': 'file-terminal',
    'caret-left-icon': 'chevron-left',
    'caret-right-icon': 'chevron-right',
    'refresh-button': 'rotate-cw',
    'chevron-down-icon': 'chevron-down',
    'copy-icon-template': 'copy',
    'download-icon': 'download',
    'aiNodeSettingsIcon': 'sliders-horizontal',
    'funcErrorIcon': 'circle-alert',
    'expand-icon': 'maximize-2',
    'button-collapse': 'minimize-2',
    'button-fullscreen': 'maximize',
    'button-delete': 'x',
};

const DEAD = [
    'code-icon-symbol',
    'minus-icon',
    'trash-bin',
    'floppy-disk-save',
    'icon-plus',
    'icon-minus',
    'copy-icon',
];

function iconDefinitions(){
    const definitions = {};
    for (const match of sprite.matchAll(/<(?:symbol|svg|g)\b[^>]*>/g)) {
        const tag = match[0];
        const id = tag.match(/\bid="([^"]+)"/)?.[1];
        const lucide = tag.match(/\bdata-lucide="([^"]+)"/)?.[1];
        if (id && lucide) definitions[id] = {lucide, tag};
    }
    return definitions;
}

test('every shipped icon id maps to its chosen Lucide source', ()=>{
    const definitions = iconDefinitions();
    assert.ok(Object.keys(definitions).length > 30,
        `parsed only ${Object.keys(definitions).length} Lucide icon definitions`);
    assert.deepEqual(
        Object.fromEntries(Object.entries(definitions).map(([id, value])=> [id, value.lucide])),
        EXPECTED
    );
});

test('every icon definition uses the shared stroke language', ()=>{
    const definitions = iconDefinitions();
    assert.equal(Object.keys(definitions).length, Object.keys(EXPECTED).length,
        'the style scan must reach every expected icon');

    const inconsistent = Object.entries(definitions).flatMap(([id, {tag}])=> {
        const required = [
            'fill="none"',
            'stroke-width="2"',
            'stroke-linecap="round"',
            'stroke-linejoin="round"',
        ];
        return required.filter((attribute)=> !tag.includes(attribute))
            .map((attribute)=> `${id} is missing ${attribute}`);
    });
    assert.deepEqual(inconsistent, []);
});

test('retired artwork is absent from the sprite', ()=>{
    for (const id of DEAD) {
        assert.equal(new RegExp(`\\bid="${id}"`).test(sprite), false, `${id} should be removed`);
    }
    assert.equal(sprite.includes('bi-sliders2'), false, 'the unnamed Bootstrap sliders should be removed');
});

test('every panel toggle uses the same Lucide chevron', ()=>{
    const files = [
        'resources/html/tabs/fractaltab.html',
        'resources/html/tabs/aitab.html',
        'resources/html/tabs/functioncallingpanel.html',
    ];
    const markup = files.map(read).join('\n');
    const chevrons = markup.match(/<use\b[^>]*(?:href|xlink:href)="#chevron-down-icon"/g) || [];

    assert.equal(chevrons.length, 6, 'all six panel toggles should use chevron-down-icon');
    assert.doesNotMatch(markup, /<\/svg>\s*<path\b/,
        'a path after </svg> cannot render inside that SVG');
});

// The sprite holds two kinds of artwork that read alike in the file and behave
// nothing alike in the page: `symbol`s inside `defs`, which exist to be pointed
// at, and hidden `svg` templates, which exist to be cloned in script. Pointing a
// `use` at a template clones its `display: none` too, so the control renders
// blank -- with no error, no failing typecheck, and no sign of it in the markup.
test('every `use` in the app points at a symbol, not a hidden template', ()=>{
    const files = readdirSync(new URL('resources/html/', root), {recursive: true})
        .filter( (name)=> name.endsWith('.html') )
        .map( (name)=> 'resources/html/' + name )
        .concat('index.html', 'js/globals.js',
                'js/interface/dropdown/customui/record/record.js');

    const symbols = new Set(
        [...sprite.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)].map( (match)=> match[1] )
    );
    const templates = new Set(
        [...sprite.matchAll(/<svg\b[^>]*\bid="([^"]+)"[^>]*display:\s*none/g)]
            .map( (match)=> match[1] )
    );
    assert.ok(templates.size > 0, 'the scan must find the hidden templates to reject');

    const references = files.flatMap( (path)=>
        [...read(path).matchAll(/<use\b[^>]*(?:xlink:)?href="#([^"]+)"/g)]
            .map( (match)=> [path, match[1]] )
    );
    assert.ok(references.length > 20,
        `parsed only ${references.length} icon references`);

    const broken = references
        .filter( ([, id])=> !symbols.has(id) )
        .map( ([path, id])=> path + ' points at #' + id
            + (templates.has(id) ? ', a hidden template' : ', which the sprite lacks') );
    assert.deepEqual([...new Set(broken)], []);
});

test('the File tree tool describes and depicts a file tree only', ()=>{
    const dropdown = read('resources/html/tabs/dropdown.html');
    const start = dropdown.indexOf('class="panel-icon edges-icon');
    assert.notEqual(start, -1, 'the File tree tool was not found');
    const tool = dropdown.slice(start, dropdown.indexOf('</div>', start));

    assert.match(tool, /xlink:href="#edges-icon-symbol"/);
    assert.doesNotMatch(tool, /\b(?:freeze|connect|Edge)\b/i);
});
