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
