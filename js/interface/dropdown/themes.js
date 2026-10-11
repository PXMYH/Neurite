// Themes (#79): named looks for the page, as cards in Settings with a preview of each, the way
// most apps keep theirs -- a click applies one, and the one in use is marked.
//
// Asked of the Saved Views, "have each to be a theme". A theme here is only ever the look: the
// Fractal's line colours, the page's colour behind them, the universe, and the page's filters.
// A Saved View is a pan and a zoom on the Plane the notes are on, so a theme that went to one
// would carry the reader away from their own notes; and the equation is the terrain, which pulls
// every loose Node toward its boundary. Neither is a theme's to change.
//
// A theme sets the very controls the Customize group holds, through the events those controls
// already answer, so a theme is saved, restored and carried in a Saved Graph exactly as a colour
// set by hand is (`saveInputValue`, `#saved-input-values`, `localStorage.universe`). Which card is
// chosen is not stored at all: it is read off the controls, so a graph that opens with colours of
// its own marks the theme they are, or Custom.
const Themes = {
    // The controls a theme sets, by id, and the part of a look each one holds.
    controls: {
        rColor: 'r', gColor: 'g', bColor: 'b', colorPicker: 'page',
        cSlider: 'brightness', sSlider: 'saturation',
        'inversion-slider': 'inversion', 'hue-rotation-slider': 'hue',
    },
    // Each line's colour is three gains -- the red of the R picker, the green of G, the blue of
    // B -- times a wave set by brightness and saturation (`Color.rgbLerp`). Paper is the page
    // filters' inversion turned round by half the hue wheel, which keeps every Node's colour
    // its own while the page goes light.
    list: [
        {id: 'neurite', name: "Neurite", look: {r: '#ff0000', g: '#00ff00', b: '#0000ff', page: '#000000',
            brightness: 128, saturation: 127, universe: true, inversion: 0, hue: 0}},
        {id: 'ember', name: "Ember", look: {r: '#ff0000', g: '#008c00', b: '#000033', page: '#000000',
            brightness: 150, saturation: 105, universe: true, inversion: 0, hue: 0}},
        {id: 'aurora', name: "Aurora", look: {r: '#330000', g: '#00ff00', b: '#0000c0', page: '#000000',
            brightness: 140, saturation: 115, universe: true, inversion: 0, hue: 0}},
        {id: 'nebula', name: "Nebula", look: {r: '#d90000', g: '#004d00', b: '#0000ff', page: '#000000',
            brightness: 140, saturation: 115, universe: true, inversion: 0, hue: 0}},
        {id: 'ink', name: "Ink", look: {r: '#ff0000', g: '#00ff00', b: '#0000ff', page: '#0b0b0e',
            brightness: 190, saturation: 0, universe: false, inversion: 0, hue: 0}},
        {id: 'paper', name: "Paper", look: {r: '#ff0000', g: '#00ff00', b: '#0000ff', page: '#000000',
            brightness: 128, saturation: 127, universe: false, inversion: 100, hue: 180}},
    ],
    // The reader's own look, kept when a theme replaces it, so that Custom can bring it back.
    customKey: 'theme-custom',
    grid: Elem.byId('themeGrid'),
    universe: Elem.byId('universe-checkbox'),

    current(){
        const look = {universe: Themes.universe.checked};
        for (const [id, key] of Object.entries(Themes.controls)) {
            const value = Elem.byId(id).value;
            look[key] = (value.startsWith('#') ? value.toLowerCase() : Number(value));
        }
        // The slider runs to 360, which turns the page as far as 0 does.
        look.hue %= 360;
        return look;
    },
    same(a, b){ return Object.keys(Themes.list[0].look).every( (key)=>(a[key] === b[key]) ) },
    themeOf(look){ return Themes.list.find( (theme)=>Themes.same(theme.look, look) ) ?? null },

    // Read back with the same checks a look from the list passes: it is written into a preview's
    // markup, and storage is anyone's to write.
    savedCustom(){
        try {
            const look = JSON.parse(localStorage.getItem(Themes.customKey));
            return Themes.isLook(look) ? look : null;
        } catch {
            return null;
        }
    },
    isLook(look){
        if (!look || typeof look !== 'object') return false;
        const hex = /^#[0-9a-f]{6}$/;
        return ['r', 'g', 'b', 'page'].every( (key)=>hex.test(look[key]) )
            && ['brightness', 'saturation', 'inversion', 'hue'].every( (key)=>Number.isFinite(look[key]) )
            && typeof look.universe === 'boolean';
    },

    apply(look){
        // A look of the reader's own is kept before a theme replaces it.
        const now = Themes.current();
        if (!Themes.themeOf(now)) localStorage.setItem(Themes.customKey, JSON.stringify(now));

        for (const [id, key] of Object.entries(Themes.controls)) {
            const input = Elem.byId(id);
            input.value = look[key];
            // `input`, never `change`: a `change` of the page's colour is a reader choosing one of
            // their own, which turns the universe off (universe.ts).
            input.dispatchEvent(new Event('input'));
            // Saved here, not by the panel's own save, which is debounced and so keeps only the
            // last of a burst -- and a theme is a burst of eight.
            saveInputValue(input);
        }
        if (Themes.universe.checked !== look.universe) {
            Themes.universe.checked = look.universe;
            Themes.universe.dispatchEvent(new Event('change'));
        }
        // A line takes its colour when it is drawn, so the old palette stayed on screen until each
        // line was drawn again.
        Fractal.recolour();
        Themes.sync();
    },

    // One line's colour under a look: `Color.rgbLerp`, which reads the pickers on the page, taken
    // for a look that is not on them yet.
    lineColour(look, i){
        const gain = (hex, at)=>(parseInt(hex.slice(at, at + 2), 16) / 255);
        const c = look.brightness, s = look.saturation, cos = Math.cos;
        const rgb = [gain(look.r, 1) * (c - s * cos(i / 2 ** .9)),
                     gain(look.g, 3) * (c - s * cos(i / 3 ** .9)),
                     gain(look.b, 5) * (c - s * cos(i / 5 ** .9))];
        return 'rgb(' + rgb.map( (v)=>Math.round(Math.min(255, Math.max(0, v))) ).join(',') + ')';
    },
    filterOf(look){ return `invert(${look.inversion}%) hue-rotate(${look.hue}deg)` },

    // A card's picture: the page's colour, the universe when it is on, five of the Fractal's lines
    // in five of the look's colours, and a note on it. 160x90, as a screen is 16:9.
    preview(look){
        const lines = [
            'M-10 70C30 40 60 86 100 50S150 20 175 34',
            'M-10 57C35 30 70 70 110 40S152 12 175 22',
            'M-10 83C25 61 75 96 120 63S160 46 175 53',
            'M22 -5C32 20 14 36 40 56',
            'M131 96C124 76 146 66 139 44',
        ].map( (d, n)=>`<path d="${d}" fill="none" stroke="${Themes.lineColour(look, 4 + n * 6)}" `
                      + `stroke-width="${2.4 - n * 0.3}" stroke-linecap="round"/>` ).join('');
        const stars = [[12, 14], [34, 76], [58, 9], [83, 82], [97, 18], [121, 29], [146, 12], [152, 70],
                       [9, 44], [70, 30], [110, 76], [138, 50]]
            .map( ([x, y], n)=>`<circle cx="${x}" cy="${y}" r="${0.6 + (n % 3) * 0.3}" fill="${['#fff', '#9ff3e4', '#f6b8e8'][n % 3]}"/>` )
            .join('');
        const universe = look.universe
            ? '<ellipse cx="96" cy="60" rx="74" ry="13" fill="#2dd4bf" fill-opacity=".12" transform="rotate(-10 96 60)"/>'
            + '<ellipse cx="100" cy="58" rx="40" ry="7" fill="#f472b6" fill-opacity=".14" transform="rotate(-10 100 58)"/>'
            + '<ellipse cx="104" cy="57" rx="14" ry="4" fill="#fff7e6" fill-opacity=".5" transform="rotate(-10 104 57)"/>'
            + stars
            : '';
        const note = '<rect x="56" y="22" width="48" height="31" rx="3" fill="#161a2e" fill-opacity=".9" stroke="#2dd4bf"/>'
                   + '<rect x="62" y="29" width="22" height="3" rx="1.5" fill="#e8e8ea"/>'
                   + '<rect x="62" y="37" width="34" height="2.4" rx="1.2" fill="#8a8a90"/>'
                   + '<rect x="62" y="43" width="27" height="2.4" rx="1.2" fill="#8a8a90"/>';
        return `<rect width="160" height="90" fill="${look.page}"/>` + universe + lines + note;
    },

    // A radio in a label, so the group is one Tab stop and the arrow keys go from card to card,
    // applying each as they reach it -- the preview VS Code gives its list, for nothing. The look
    // is the card's own property, because Custom's changes under it.
    card(id, name, look){
        const label = Html.makeWithClass('label', 'theme-card');
        label.innerHTML = `<input type="radio" name="theme" value="${id}" class="visually-hidden">`
            // The frame carries the ring, and the picture the filters, which would turn a ring too.
            + '<span class="theme-frame"><svg class="theme-preview" viewBox="0 0 160 90" aria-hidden="true"></svg></span>'
            + `<span class="theme-name">${name}</span>`;
        Themes.draw(label, look);
        On.change(label.querySelector('input'), ()=>Themes.apply(label.look));
        return label;
    },
    draw(card, look){
        card.look = look;
        card.querySelector('svg').innerHTML = Themes.preview(look);
    },

    render(){
        Themes.grid.replaceChildren(...Themes.list.map( (t)=>Themes.card(t.id, t.name, t.look) ));
        Themes.sync();
    },

    // The page's filters undone, as nearly as a filter can: `invert(p)` is `contrast(1 - 2p)`
    // (it keeps 0.5 where it is and scales about it), so below 50% it is undone by the contrast
    // that scales back, and above it by inverting first. Exact at 0 and 100%, which are a theme's;
    // in between the page squeezes everything under it into a narrower band, and no picture under
    // the filter can show more of the band than it lets through. 50% the slider skips.
    undoFilter(look){
        const p = look.inversion / 100;
        const turn = `hue-rotate(${-look.hue}deg)`;
        if (p === 0) return turn;
        if (p === 1) return turn + ' invert(100%)';
        return (p < 0.5) ? `${turn} contrast(${1 / (1 - 2 * p)})`
                         : `${turn} invert(100%) contrast(${1 / (2 * p - 1)})`;
    },

    // The card the controls are, checked, and Custom drawn when they are no theme or the reader
    // has a look of their own to come back to. Each preview is shown as its look would make the
    // page: the page's own filters lie over the menu too (`#invert-filter`), so a preview takes
    // its look's filters and then undoes the page's (`undoFilter`).
    sync(){
        const now = Themes.current();
        const theme = Themes.themeOf(now);
        const custom = theme ? Themes.savedCustom() : now;

        // Redrawn in place rather than replaced: the card can have the focus, as it does when the
        // arrow keys have just chosen it.
        const customCard = Themes.grid.querySelector('input[value="custom"]')?.closest('label');
        if (custom && customCard) Themes.draw(customCard, custom);
        else if (custom) Themes.grid.append(Themes.card('custom', "Custom", custom));
        else customCard?.remove();

        const undo = Themes.undoFilter(now);
        for (const card of Themes.grid.children) {
            const input = card.querySelector('input');
            input.checked = (input.value === (theme?.id ?? 'custom'));
            card.querySelector('svg').style.filter = Themes.filterOf(card.look) + ' ' + undo;
        }
    },

    init(){
        if (!Themes.grid) return;

        Themes.render();
        // Whatever moves a control the theme is made of moves the mark: a hand on a slider, a
        // graph that opens with its own colours, Reset. Once a frame at most, as a drag sends
        // dozens of these.
        let queued = false;
        const later = ()=>{
            if (queued) return;
            queued = true;
            requestAnimationFrame( ()=>{ queued = false; Themes.sync() } );
        };
        for (const id of Object.keys(Themes.controls)) On.input(Elem.byId(id), later);
        On.change(Themes.universe, later);
    }
}

Themes.init();
