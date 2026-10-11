// Function for custom slider background
function setSliderBackground(slider) {
    const min = slider.min ? parseFloat(slider.min) : 0;
    const max = slider.max ? parseFloat(slider.max) : 100;
    const value = slider.value ? parseFloat(slider.value) : 0;
    const percentage = (value - min) / (max - min) * 100;
    // Fill colour comes from the --ui-accent token so the slider matches the
    // selection ring instead of being a third, separate blue.
    slider.style.background = `linear-gradient(to right, var(--ui-accent) 0%, var(--ui-accent) ${percentage}%, #18181c ${percentage}%, #18181c 100%)`;
}

document.querySelectorAll('input[type=range]:not(#customModal input[type=range])')
.forEach( (slider)=>{
    setSliderBackground(slider);
    On.input(slider, setSliderBackground.bind(null, slider));
});

// The value beside each slider of the menu's panels that has no number box of its own (#80): a
// slider says where it is only by its thumb, and the controls in Apple's and Material's settings
// both carry the number. The Ai panel's four write theirs into their own labels already.
function sliderValueText(slider){
    const decimals = (slider.step.split('.')[1] ?? '').length;
    return Number(slider.value).toFixed(decimals);
}
document.querySelectorAll('.menu-detail .settingsSlider').forEach( (box)=>{
    const slider = box.querySelector('input[type=range]');
    if (!slider || box.querySelector('.number-input') || box.closest('#aiParameterGrid')) return;

    const value = Html.create('output');
    value.className = 'slider-value';
    value.setAttribute('for', slider.id);
    slider.after(value);
    const write = ()=>{ value.textContent = sliderValueText(slider) };
    On.input(slider, write);
    write();
});

// What a panel shows of its sliders, again as they are: their fill and their value follow `input`,
// and a few are set without one -- the placement sliders' stored values, by `ZetPath.init`. Asked
// by `openTab` each time a panel opens.
function refreshSliders(root){
    for (const slider of root.querySelectorAll('input[type=range]')) setSliderBackground(slider);
    for (const value of root.querySelectorAll('output.slider-value')) {
        const slider = Elem.byId(value.getAttribute('for'));
        if (slider) value.textContent = sliderValueText(slider);
    }
}
