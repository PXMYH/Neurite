const updateSliderValue = (slider, value) => {
    value.value = slider.value;
};

const updateValueSlider = (value, slider) => {
    const step = parseFloat(slider.step);
    const minValue = parseFloat(slider.min);
    const maxValue = parseFloat(slider.max);
    let newValue = parseFloat(value.value);

    if (isNaN(newValue)) return; // Ignore invalid input

    // Clamp to min/max
    newValue = Math.max(minValue, Math.min(maxValue, newValue));

    // Optional: round to nearest step
    const precision = (step < 1) ? step.toString().split('.')[1]?.length || 2 : 0;
    newValue = parseFloat(newValue.toFixed(precision));

    value.value = newValue;
    slider.value = newValue;
    setSliderBackground(slider);
}

const aiTab = new AiTab();
const editTab = new EditTab(settings);





// Function to save the value of a specific slider or color picker
function saveInputValue(input) {
    const savedValues = localStorage.getItem('inputValues');
    const inputValues = savedValues ? JSON.parse(savedValues) : {};

    inputValues[input.id] = input.value;
    localStorage.setItem('inputValues', JSON.stringify(inputValues));
}

const debouncedSaveInputValue = debounce(function (input) {
    saveInputValue(input);
    Logger.debug("saved");
}, 300);

document.querySelectorAll('#tab2 input[type="range"], .color-picker-container input[type="color"]').forEach(function (input) {
    On.input(input, (e)=>debouncedSaveInputValue(input) )
});

function restoreInputValues() {
    const savedValues = localStorage.getItem('inputValues');
    if (savedValues) {
        const inputValues = JSON.parse(savedValues);
        document.querySelectorAll('#tab2 input[type="range"], .color-picker-container input[type="color"]').forEach(input => {
            if (input.id in inputValues) {
                input.value = inputValues[input.id];
                // Trigger the input event for both sliders and color pickers
                const cb = input.dispatchEvent.bind(input, new Event('input'));
                Promise.delay(100).then(cb);
            }
        });
    }
}

restoreInputValues();

//disable ctl +/- zoom on browser
On.keydown(document, (e)=>{
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
    }
});
On.wheel(document, (e)=>{
    if (e.ctrlKey) e.preventDefault();
}, {
    passive: false
});

document.body.style.transform = "scale(1)";
document.body.style.transformOrigin = "0 0";

function openTab(tabId, element) {
    var i, tabcontent, tablinks;

    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = 'none';
    }

    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("activeTab");
    }

    Elem.byId(tabId).style.display = 'block';
    element.classList.add("activeTab");

    window.currentActiveZettelkastenMirror.refresh();
}

// Get the menu button and dropdown content elements
const dropdownDiv = Elem.byId('dropdowndiv');
const menuButton = document.querySelector(".menu-button");
const dropdownContent = document.querySelector(".dropdown-content");
const nodePanel = document.querySelector(".node-panel");

// Get the first tabcontent element
const firstTab = document.querySelector(".tabcontent");

On.paste(dropdownContent, (e)=>{
});
On.wheel(dropdownContent, Event.stopPropagation);
On.dblclick(dropdownContent, Event.stopPropagation);

On.click(menuButton, (e)=>{
    e.stopPropagation();

    // Toggle the "open" class on the menu button and dropdown content.
    // The node panel is deliberately not in here: it is always on screen, so
    // hiding it with the dropdown made every way to create a note vanish.
    menuButton.classList.toggle("open");
    dropdownContent.classList.toggle("open");

    // If the dropdown is opened, manually set the first tab to active and display its content
    if (dropdownContent.classList.contains("open")) {
        // Ai, the first tablink, when AI features are on; Fractal, the second, when
        // they are off. `body.ai-disabled` hides `#tab4` and `#tablink-ai` with
        // `!important`, so landing on Ai there opens the menu on an empty box -- and
        // AI features are off until switched on. Notes used to be the landing tab and
        // was always visible; it has no tablink now -- issue #65.
        //
        // A hidden tablink still holds its place in the collection, so the indices are
        // the ones in the markup either way.
        //
        // The loop that stood here removed a class nobody adds (`active`, where `openTab`
        // writes `activeTab`) and hid `tabcontent[i]` for as many i as there are
        // tablinks -- one short of the tabs, now that one tab has no link. `openTab`
        // hides every `.tabcontent` and clears every `activeTab` itself.
        const iLanding = AiFeatures.enabled ? 0 : 1;
        openTab(AiFeatures.enabled ? 'tab4' : 'tab2',
                document.getElementsByClassName('tablink')[iLanding]);

        // If there's any selected text, deselect it
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        } else if (document.selection) {
            document.selection.empty();
        }
    }
});

On.mousedown(dropdownContent, Event.stopPropagation);

// Every gesture over a piece of chrome is aimed at the chrome, not at the graph
// behind it: without this, dragging an island pans the canvas and scrolling over
// one zooms it. The root itself is `pointer-events: none`, so this only ever sees
// what bubbled up out of an island.
['mousedown', 'wheel', 'dblclick']
.forEach(Event.stopPropagationByNameForThis, dropdownDiv);


// The tools. `handledrop.js` owns what each one does -- it binds click and
// drag-out-to-place by the `.panel-icon` class -- so all that is left here is
// reaching them from the keyboard, which no version of this palette has offered.
const toolBar = document.querySelector('.tool-bar');

// The tools are divs, because a `draggable` <button> does not fire `dragstart`
// in every browser and drag-out-to-place is the point of them. That costs the
// activation a real button would have given for free.
On.keydown(toolBar, (e)=>{
    if (e.key !== 'Enter' && e.key !== ' ') return;

    const item = e.target.closest('.node-add-item');
    if (!item) return;

    e.preventDefault(); // Space scrolls otherwise
    item.click();
});

// 1-4, in the order the tools sit in the pill. The tooltips name the digit, so
// these have to work.
const toolShortcuts = {
    '1': 'note-icon',
    '2': 'link-icon',
    '3': 'edges-icon',
    '4': 'ai-icon'
};

On.keydown(document, (e)=>{
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const iconClass = toolShortcuts[e.key];
    if (!iconClass) return;

    // A digit is text before it is a shortcut. CodeMirror types into a hidden
    // textarea, so editors are covered by the tag check.
    const focused = document.activeElement;
    if (focused && (focused.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName))) return;

    const tool = toolBar.querySelector('.' + iconClass);
    // `offsetParent` is null while AI features are off, which hides the AI tool.
    if (!tool || !tool.offsetParent) return;

    tool.click();
});


// AI switch. Off hides every AI prompt surface through `body.ai-disabled`; the
// two paths CSS cannot reach are guarded where they are called, in
// `createnodes.js` and `customcontextmenu.js`.
const aiFeaturesCheckbox = Elem.byId('ai-features-enabled');
aiFeaturesCheckbox.checked = AiFeatures.enabled;

On.change(aiFeaturesCheckbox, (e)=>{
    AiFeatures.enabled = aiFeaturesCheckbox.checked;

    // `openTab` writes an inline `display: block` on the tab it opens, so the Ai
    // tab has to be left rather than merely restyled if it is the one showing.
    // Fractal, the second tablink: the Ai tab is the first one, and it is the tab
    // being left. Notes was the old landing place and has no tablink now.
    const aiTabContent = Elem.byId('tab4');
    if (!AiFeatures.enabled && aiTabContent.style.display === 'block') {
        openTab('tab2', document.getElementsByClassName('tablink')[1]);
    }
});
