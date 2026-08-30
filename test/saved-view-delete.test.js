// Delete View removed the wrong Saved View, and it did it silently.
//
// The strip on screen is the current Fractal's views followed by `savedViews.all`, so a
// position in it belongs to neither list. `deleteSavedView` took that position and spliced
// the per-Fractal list with it: clicking `// Reset View`, which is the only view in `all`,
// deleted whichever Mandelbrot view sat at that index -- index 7 of a 7-long list on the
// defaults, which fell through the guard and deleted nothing, and a real deletion as soon
// as the reader stored one of their own. Nothing on screen said which view had gone.
//
// So this drives the real functions rather than reading the source: `displaysavedcoords.js`
// exports nothing and touches the DOM as it loads, which is the `node:vm` route CLAUDE.md
// describes. The stubs are the smallest set the file touches while being parsed into
// existence, plus what one render and one delete need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const PATH = 'js/interface/dropdown/customui/displaysavedcoords.js';
const src = readFileSync(new URL('../' + PATH, import.meta.url), 'utf8');

// The one element the file reads a value out of, and the one it fills.
function makeSandbox(fractalType){
    const clicks = {};
    const container = {children: [], innerHTML: '', appendChild(el){ this.children.push(el) }};
    const alerts = [];
    const elems = {
        'fractal-select': {value: fractalType},
        'savedCoordinatesContainer': container,
        'saveCoordinatesBtn': {textContent: 'Store View'},
        'deleteCoordinatesBtn': {}
    };
    const store = {};
    const sandbox = createContext({
        // `On.click` is how the file binds; capturing the callbacks is how this test
        // presses the button rather than calling the handler it hopes is bound.
        On: {
            // Every element's own handler, chips included. Reaching a chip's callback is
            // what lets a test click what a reader clicks: the view a chip carries is the
            // object the delete has to find, and it was a *copy* of one until
            // `displaySavedCoordinates` stopped re-parsing the cache. A test that hands
            // `deleteSavedView` a view straight out of `savedViews` never sees that.
            click(elem, cb){
                elem.onClick = cb;
                if (elem === elems['deleteCoordinatesBtn']) clicks.delete = cb;
                if (elem === elems['saveCoordinatesBtn']) clicks.store = cb;
            },
            change(){},
            mouseleave(){}
        },
        Elem: {byId: (id)=> elems[id] ?? null},
        Html: {make: {div: ()=>({classList: {add(){}, remove(){}}, style: {}, textContent: '', onClick: null})}},
        localStorage: {
            getItem: (k)=> store[k] ?? null,
            setItem: (k, v)=>{ store[k] = v }
        },
        document: {querySelectorAll: ()=>[]},
        alert: (msg)=>alerts.push(msg),
        Logger: {info(){}, debug(){}, warn(){}, err(){}},
        Animation: {goToCoords(){}},
        Graph: {getCoords: ()=>({zoom: '1', pan: '0+i0'})},
        Promise
    });
    // `savedViews` is a `let` that `initializeSavedViews` reassigns, so it is exported as a
    // function. Capturing the value would hand every test below a reference to whatever
    // object existed at load time -- stale the moment the file re-reads its cache.
    const names = ['defaultSavedViews', 'Coordinate', 'displaySavedCoordinates',
                   'deleteSavedView', 'listHoldingView'];
    runInContext(src + '\n;globalThis.exported = {' + names.join(', ')
        + ', views: ()=>savedViews};', sandbox, { filename: PATH });

    // What a running app has already done by the time a reader clicks anything: `App.init`
    // calls `updateSavedViewsCache`, and the next page load parses it back. Until that has
    // happened `getSavedViewsFromCache` answers `{...defaultSavedViews}` -- a *shallow*
    // copy, so every list inside is still the same array the module holds and identity
    // holds by accident. A sandbox with an empty localStorage therefore passes with the
    // copy bug in place, which is the one state this must not test in.
    runInContext('updateSavedViewsCache(); initializeSavedViews();', sandbox, { filename: PATH });

    const api = {...sandbox.exported, clicks, container, alerts, store, sandbox};
    Object.defineProperty(api, 'savedViews', {get: ()=> sandbox.exported.views()});
    return api;
}

// Spread first: these arrays are created inside the vm's realm, so their prototype is
// not this realm's `Array` and `assert.deepEqual` compares prototypes. Copying into a
// plain array here keeps every comparison below about the titles.
const titles = (views)=> [...views].map( (v)=> v.title );

test('the defaults are the list this test reasons about', ()=>{
    const { savedViews } = makeSandbox('mandelbrot');
    // Not decoration: every assertion below depends on `all` being shorter than the
    // Mandelbrot list and on the strip being the two of them end to end.
    assert.equal(savedViews.mandelbrot.length, 7, 'the Mandelbrot defaults changed');
    assert.deepEqual(titles(savedViews.all), ['// Reset View'],
        'the `all` list is no longer just Reset View');
});

test('deleting the view from `all` takes that one and no other', ()=>{
    const { savedViews, Coordinate, deleteSavedView } = makeSandbox('mandelbrot');
    const before = titles(savedViews.mandelbrot);
    const resetView = savedViews.all[0];

    Coordinate.selectedView = resetView;
    deleteSavedView(resetView);

    assert.equal(savedViews.all.length, 0, 'Reset View survived its own deletion');
    assert.deepEqual(titles(savedViews.mandelbrot), before,
        'deleting a view from `all` reached into the Mandelbrot list');
    assert.equal(Coordinate.selectedView, null, 'the deleted view is still selected');
});

test('deleting a view from the current fractal takes the one clicked', ()=>{
    const { savedViews, Coordinate, deleteSavedView } = makeSandbox('mandelbrot');
    // Third of seven, so a fencepost error in either direction shows up as a neighbour
    // going instead. Reaching it by identity is the point: its position in the list on
    // screen and its position in `savedViews.mandelbrot` are the same here only because
    // `all` is appended after, and that is the coincidence the bug lived in.
    const target = savedViews.mandelbrot[2];
    assert.equal(target.title, '// Quad Spiral Valley');

    Coordinate.selectedView = target;
    deleteSavedView(target);

    assert.equal(savedViews.mandelbrot.length, 6);
    assert.deepEqual(titles(savedViews.mandelbrot), [
        '// Seahorse Valley West', '// Double Scepter Valley', '// North Radical',
        '// Shepherds Crook', '// South Radical', '// Triple Spiral Valley'
    ], 'a neighbour went instead of the view that was clicked');
    assert.deepEqual(titles(savedViews.all), ['// Reset View'], '`all` was touched');
});

test('a view belonging to another fractal is still found in its own list', ()=>{
    // The lists a reader can see are filtered by `fractal-select`, but nothing stops a
    // stale selection from outliving a change of equation, and splicing the *displayed*
    // list would then delete a Julia view out of the Mandelbrot one.
    const { savedViews, deleteSavedView, listHoldingView } = makeSandbox('mandelbrot');
    const julia = savedViews.julia[1];

    assert.equal(listHoldingView(julia), savedViews.julia, 'the view was found in the wrong list');
    deleteSavedView(julia);
    assert.equal(savedViews.julia.length, 3, 'the Julia view was not deleted');
    assert.equal(savedViews.mandelbrot.length, 7, 'the Mandelbrot list lost one instead');
});

test('Delete View with nothing selected says so and deletes nothing', ()=>{
    const { savedViews, Coordinate, clicks, alerts } = makeSandbox('mandelbrot');
    assert.ok(clicks.delete, 'Delete View is no longer bound by On.click');

    Coordinate.selectedView = null;
    clicks.delete({});

    assert.equal(alerts.length, 1, 'a click with nothing selected passed in silence');
    assert.match(alerts[0], /view/i, 'the message no longer names what is missing: ' + alerts[0]);
    assert.equal(savedViews.mandelbrot.length, 7);
    assert.equal(savedViews.all.length, 1);
});

test('the whole route works: render, click a view, click Delete', ()=>{
    // The one test that presses what a reader presses. `displaySavedCoordinates` built its
    // chips out of `getSavedViewsFromCache()`, which parses JSON afresh on every call, so
    // the view on a chip was a copy and `listHoldingView` could not find it in any list:
    // Delete logged an error and removed nothing, with the strip unchanged on screen.
    // Every other test here passes with that bug in place, because they take their view
    // out of `savedViews` directly.
    const { savedViews, container, clicks, displaySavedCoordinates } = makeSandbox('mandelbrot');

    displaySavedCoordinates();
    assert.equal(container.children.length, 8, 'the strip is not 7 mandelbrot + 1 all');

    const chip = container.children.find( (el)=> el.textContent === '// Reset View' );
    assert.ok(chip, 'Reset View is not on the strip');
    assert.ok(chip.onClick, 'a chip has no click handler, so a view cannot be selected');

    chip.onClick({});
    chip.__clicked = true;
    clicks.delete({});

    assert.equal(savedViews.all.length, 0,
        'clicking a view and then Delete removed nothing -- the chip is holding a copy');
    assert.equal(savedViews.mandelbrot.length, 7, 'the mandelbrot list lost one instead');
});

test('a delete is written through to the cache, not just to memory', ()=>{
    // Without this the view returns on the next load, which reads back as a delete that
    // did nothing rather than as a delete that was not saved.
    const { savedViews, deleteSavedView, store } = makeSandbox('mandelbrot');
    deleteSavedView(savedViews.all[0]);

    assert.ok(store.savedViews, 'nothing was written to localStorage');
    assert.deepEqual(JSON.parse(store.savedViews).all, [],
        'the cache still holds the deleted view');
});
