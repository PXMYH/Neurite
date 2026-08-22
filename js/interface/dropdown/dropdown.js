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
        var tablinks = document.getElementsByClassName("tablink");
        var tabcontent = document.getElementsByClassName("tabcontent");

        // Remove active class from all tablinks and hide all tabcontent
        for (var i = 0; i < tablinks.length; i++) {
            tablinks[i].classList.remove("active");
            tabcontent[i].style.display = "none";
        }

        // Open the first tab
        openTab('tab1', tablinks[0]);

        // If there's any selected text, deselect it
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        } else if (document.selection) {
            document.selection.empty();
        }
    }
});

On.mousedown(dropdownContent, Event.stopPropagation);


// Add-node menu. The rows keep their own click and drag handlers from
// `handledrop.js`; this only opens and closes the menu around them.
const nodeAddButton = Elem.byId('nodeAddButton');
const nodeAddMenu = Elem.byId('nodeAddMenu');

function setNodeAddMenuOpen(isOpen){
    nodeAddMenu.classList.toggle('open', isOpen);
    nodeAddButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

On.click(nodeAddButton, (e)=>{
    e.stopPropagation();
    setNodeAddMenuOpen(!nodeAddMenu.classList.contains('open'));
});

// A new note follows the mouse until it is placed, so the menu has to be out of
// the way the moment one is made. The drag guard is the same one the rows use:
// a drag out of the menu ends in a drop, not a click.
On.click(nodeAddMenu, (e)=>{ if (!Mouse.isDragging) setNodeAddMenuOpen(false) });
On.dragend(nodeAddMenu, (e)=>setNodeAddMenuOpen(false) );

// `.node-panel` stops `mousedown` propagating, so this only ever sees a press
// outside the palette.
On.mousedown(document, (e)=>setNodeAddMenuOpen(false) );
On.keydown(document, (e)=>{ if (e.key === 'Escape') setNodeAddMenuOpen(false) });


// AI switch. Off hides every AI prompt surface through `body.ai-disabled`; the
// two paths CSS cannot reach are guarded where they are called, in
// `createnodes.js` and `customcontextmenu.js`.
const aiFeaturesCheckbox = Elem.byId('ai-features-enabled');
aiFeaturesCheckbox.checked = AiFeatures.enabled;

On.change(aiFeaturesCheckbox, (e)=>{
    AiFeatures.enabled = aiFeaturesCheckbox.checked;

    // `openTab` writes an inline `display: block` on the tab it opens, so the Ai
    // tab has to be left rather than merely restyled if it is the one showing.
    const aiTabContent = Elem.byId('tab4');
    if (!AiFeatures.enabled && aiTabContent.style.display === 'block') {
        openTab('tab1', document.getElementsByClassName('tablink')[0]);
    }
});
