const Select = {};

Select.deselect = function(select){
    const optionsReplacer = select.parentNode.querySelector('.options-replacer');
    Elem.forEachChild(optionsReplacer,
        (child)=>{
            child.classList.remove('selected');
            child.setAttribute('aria-selected', 'false');
        }
    );
}
Select.selectOption = function(select, option){
    Select.deselect(select);

    // Set this option as the selected one
    select.parentNode.querySelector(`[data-value="${option.value}"]`).classList.add('selected');
    select.value = option.value;
    Select.updateSelectedOption(select);

    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

// `selectId` is the id of the global dropdown this one mirrors, so the per-node id
// is that plus the index. `wrapperName` has to be the provider id lowercased:
// setModelSelectorsVisibility lowercases the chosen id and matches the wrapper by
// prefix, which is the only reason the wrapper carries a name at all.
function createSelectWithWrapper(selectId, wrapperName, nodeIndex) {
    const select = Html.make.select('model-selector custom-select ignoreSetup');
    select.id = selectId + '-' + nodeIndex;

    const container = Html.make.div('dropdown-container');
    container.appendChild(select);

    const wrapper = Html.make.div('dropdown-wrapper');
    wrapper.id = `wrapper-${wrapperName}-${nodeIndex}`;
    wrapper.appendChild(container);
    return wrapper;
}

const CustomDropdown = {
    model: {selectId: 'custom-model-select', storageId: 'customModelDropdown'}
};
CustomDropdown.setup = function(select, delayListeners = false){
    const selectReplacer = Html.make.div('select-replacer closed');

    const selectedDiv = Html.make.div('selected-text');

    // Safeguard against empty select or invalid selectedIndex
    if (select.options.length > 0 && select.selectedIndex >= 0 && select.selectedIndex < select.options.length) {
        selectedDiv.innerText = select.options[select.selectedIndex].innerText;
    }
    selectReplacer.appendChild(selectedDiv);

    const optionsReplacer = Html.make.div('options-replacer custom-scrollbar');
    selectReplacer.appendChild(optionsReplacer);

    // Replace the original select with the custom dropdown
    const container = Html.make.div('select-container');
    select.parentNode.insertBefore(container, select);
    container.appendChild(selectReplacer);
    container.appendChild(select);
    select.style.display = 'none'; // Hide the original select

    CustomDropdown.carryAccessibility(select, selectReplacer, optionsReplacer);

    CustomDropdown.populateOptions(select, optionsReplacer, selectedDiv);

    if (!delayListeners) CustomDropdown.addEventListeners(select);
}

// `display: none` on the select takes it out of the accessibility tree and out of
// the tab order, and the replacer that stands in for it is a plain div: no name, no
// role, no way to reach it with a keyboard. So a `title` or an `aria-describedby`
// written on the select in the markup describes an element nobody can get to. These
// are the things the select was carrying and the replacer was not; the keys a select
// answers are wired in `addKeyListeners`.
CustomDropdown.carryAccessibility = function(select, selectReplacer, optionsReplacer){
    selectReplacer.setAttribute('role', 'combobox');
    selectReplacer.setAttribute('aria-haspopup', 'listbox');
    selectReplacer.setAttribute('aria-expanded', 'false');
    selectReplacer.setAttribute('tabindex', '0');
    optionsReplacer.setAttribute('role', 'listbox');

    if (select.id) {
        optionsReplacer.id = select.id + '-options';
        selectReplacer.setAttribute('aria-controls', optionsReplacer.id);
    }
    // The name and the description stay written on the select in the markup, next
    // to the control they belong to, and are copied here rather than duplicated.
    for (const name of ['aria-label', 'aria-describedby', 'title']) {
        const value = select.getAttribute(name);
        if (value) selectReplacer.setAttribute(name, value);
    }
}

CustomDropdown.open = function(selectReplacer, optionsReplacer){
    optionsReplacer.classList.add('show');
    selectReplacer.classList.remove('closed');
    selectReplacer.setAttribute('aria-expanded', 'true');
}
CustomDropdown.close = function(selectReplacer, optionsReplacer){
    optionsReplacer.classList.remove('show');
    selectReplacer.classList.add('closed');
    selectReplacer.setAttribute('aria-expanded', 'false');
}

CustomDropdown.populateOptions = function(select, optionsReplacer, selectedDiv){
    const create = CustomDropdown.createOptionDiv.bind(CustomDropdown, select, optionsReplacer, selectedDiv);
    Array.from(select.options).forEach(create);
}
CustomDropdown.createOptionDiv = function(select, optionsReplacer, selectedDiv, option){
    const optionDiv = Html.make.div('dropdown-option');
    optionDiv.dataset.value = option.value;
    optionDiv.innerText = option.innerText;
    optionDiv.setAttribute('role', 'option');
    optionDiv.setAttribute('aria-selected', option.selected ? 'true' : 'false');

    if (option.selected) optionDiv.classList.add('selected');

    On.click(optionDiv, (e)=>{
        e.stopPropagation();

        Select.deselect(select);

        // Set this option as the selected one
        optionDiv.classList.add('selected');
        optionDiv.setAttribute('aria-selected', 'true');
        select.value = option.value;
        selectedDiv.innerText = option.innerText;

        // Dispatch a change event to the original select element
        select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    });

    optionsReplacer.appendChild(optionDiv);
}

CustomDropdown.addOption = function(select, text, value, key){
    const option = new Option(text, value);
    option.dataset.key = key;
    select.appendChild(option);

    const optionsReplacer = select.parentNode.querySelector('.options-replacer');
    if (optionsReplacer) {
        const selectedDiv = select.parentNode.querySelector('.select-replacer > div');
        CustomDropdown.createOptionDiv(select, optionsReplacer, selectedDiv, option);
    }
}

CustomDropdown.addEventListeners = function(select){
    const container = select.parentNode;
    const selectReplacer = container.querySelector('.select-replacer');
    const optionsReplacer = selectReplacer.querySelector('.options-replacer');
    const selectedDiv = selectReplacer.querySelector('.selected-text');

    // Clear existing options to avoid duplicates
    optionsReplacer.innerHTML = '';

    CustomDropdown.populateOptions(select, optionsReplacer, selectedDiv);

    let isPendingFrame = false;
    On.click(selectReplacer, (e)=>{
        if (optionsReplacer.classList.contains('show')) {
            // Dropdown is open, so close it
            window.requestAnimationFrame(() => {
                CustomDropdown.close(selectReplacer, optionsReplacer);
                container.style.zIndex = "20"; // Reset the z-index of the parent container
                isPendingFrame = false;
            });
            isPendingFrame = true;
        } else {
            // Close all other dropdowns
            document.querySelectorAll('.options-replacer.show').forEach(el => {
                CustomDropdown.close(el.parentElement, el);
                el.parentElement.parentElement.style.zIndex = "20"; // Reset the z-index of other dropdowns
            });

            // Dropdown is closed, so open it
            container.style.zIndex = "30"; // Increase the z-index of the parent container
            if (!isPendingFrame) {
                window.requestAnimationFrame(() => {
                    CustomDropdown.open(selectReplacer, optionsReplacer);
                    isPendingFrame = false;
                });
                isPendingFrame = true;
            }
        }
    });

    CustomDropdown.addKeyListeners(select, selectReplacer, optionsReplacer, container);

    // Close dropdown when clicking outside
    On.mousedown(document, (e)=>{
        if (!container.contains(e.target)) {
            container.dataset.outsideClick = 'true'
        }
    });
    On.mouseup(document, (e)=>{
        if (container.dataset.outsideClick === 'true' && !container.contains(e.target)) {
            CustomDropdown.close(selectReplacer, optionsReplacer);
            container.style.zIndex = "20"; // Reset the z-index of the parent container
        }
        container.removeAttribute('data-outside-click');
    });
}

// The keys a native select answers, on the div that replaced it: Enter and Space
// open and close the list, Escape closes it, and the arrows move the selection the
// way a closed select does. Without these, `tabindex` would only put focus
// somewhere it cannot act.
CustomDropdown.addKeyListeners = function(select, selectReplacer, optionsReplacer, container){
    On.keydown(selectReplacer, (e)=>{
        const isOpen = optionsReplacer.classList.contains('show');
        switch (e.key) {
            case 'Enter':
            case ' ':
                if (isOpen) CustomDropdown.close(selectReplacer, optionsReplacer);
                else CustomDropdown.open(selectReplacer, optionsReplacer);
                container.style.zIndex = (isOpen ? "20" : "30");
                break;
            case 'Escape':
                if (!isOpen) return;
                CustomDropdown.close(selectReplacer, optionsReplacer);
                container.style.zIndex = "20";
                break;
            case 'ArrowDown':
            case 'ArrowRight':
                CustomDropdown.stepSelection(select, 1);
                break;
            case 'ArrowUp':
            case 'ArrowLeft':
                CustomDropdown.stepSelection(select, -1);
                break;
            default: return;
        }
        // The arrows move selected Nodes and Space is a Node Mode key, both bound on
        // `window`. A key answered here is not also a command to the Graph.
        e.preventDefault();
        e.stopPropagation();
    });
}

// Moves the selection one option, as a focused select does with its list closed.
// The `change` event is what every reader of these dropdowns is bound to, so it is
// dispatched here exactly as a click on an option does.
CustomDropdown.stepSelection = function(select, step){
    const count = select.options.length;
    if (count < 1) return;

    const next = Math.min(Math.max(select.selectedIndex + step, 0), count - 1);
    if (next === select.selectedIndex) return;

    select.selectedIndex = next;
    Select.updateSelectedOption(select);
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

CustomDropdown.setupModelSelect = function(selectElement){
    CustomDropdown.setup(selectElement);

    const storedValue = localStorage.getItem(selectElement.id);
    if (storedValue) {
        selectElement.value = storedValue;
        Select.updateSelectedOption(selectElement);
    }

    On.change(selectElement, (e)=>{
        localStorage.setItem(selectElement.id, selectElement.value);
        Select.updateSelectedOption(selectElement);
    });
}

CustomDropdown.initializeCustomSelects = function(){
    const selects = document.querySelectorAll('select.custom-select:not(.ignoreSetup)');
    selects.forEach(CustomDropdown.setupModelSelect);
}

Select.updateSelectedOption = function(selectElement){
    Select.updateSelectedOptionDisplay(selectElement);
    Select.updateSelectedOptionHighlighting(selectElement);
}
Select.updateSelectedOptionDisplay = function(selectElement){ // to show the selected value
    const selectedDiv = selectElement.parentNode.querySelector('.select-replacer > div');
    if (!selectedDiv) return;

    const selectedOption = selectElement.options[selectElement.selectedIndex];
    if (selectedOption) selectedDiv.innerText = selectedOption.innerText;
}
Select.updateSelectedOptionHighlighting = function(selectElement){
    const optionsReplacer = selectElement.parentNode.querySelector('.options-replacer');
    if (!optionsReplacer) return;

    const selectedValue = selectElement.value;
    optionsReplacer.querySelectorAll('div').forEach( (div)=>{
        const isSelected = div.dataset.value === selectedValue;
        div.classList.toggle('selected', isSelected);
        div.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
}

CustomDropdown.initializeCustomSelects();

CustomDropdown.refreshDisplay = function(select){
    const optionsReplacer = select.parentNode.querySelector('.options-replacer');
    // Clear existing custom dropdown options
    while (optionsReplacer.firstChild) {
        optionsReplacer.removeChild(optionsReplacer.firstChild);
    }

    const selectedDiv = select.parentNode.querySelector('.select-replacer > div');
    CustomDropdown.populateOptions(select, optionsReplacer, selectedDiv);
}

CustomDropdown.restoreState = function(dropdown){
    const customDropdown = dropdown.parentNode.querySelector('.select-replacer');
    if (!customDropdown) return;

    const selectedText = customDropdown.querySelector('.selected-text').textContent.trim();
    const options = dropdown.options;
    for (let i = 0; i < options.length; i++) {
        if (options[i].textContent.trim() !== selectedText) continue;

        dropdown.selectedIndex = i;
        // Optionally, trigger a change event if needed
        dropdown.dispatchEvent(new Event('change'));
        break;
    }
}

CustomDropdown.addModel = function(dropdown, selectData){
    const select = Elem.byId(dropdown.selectId);
    if (select.options[0].value === 'none') select.remove(0);

    const uniqueId = Date.now().toString(); // Simple unique ID generation
    const option = new Option(selectData.modelName, uniqueId);
    option.dataset.endpoint = selectData.endpoint;
    option.dataset.key = selectData.key;
    select.appendChild(option);

    CustomDropdown.updateLocalStorage(select, dropdown.storageId);
    Select.updateSelectedOption(select);
    CustomDropdown.refreshDisplay(select);
}
CustomDropdown.updateLocalStorage = function(select, storageId){
    const options = Array.from(select.options)
        .filter(option => option.value !== 'default')
        .map(CustomDropdown.plainOption);
    localStorage.setItem(storageId, JSON.stringify(options));
    localStorage.setItem(storageId + '_selected', select.value);
}
CustomDropdown.plainOption = function(option){
    return {
        value: option.value,
        text: option.textContent,
        key: option.dataset.key,
        endpoint: option.dataset.endpoint
    }
}

CustomDropdown.loadFromLocalStorage = function(select, storageId){
    const storedOptions = JSON.parse(localStorage.getItem(storageId));
    if (!storedOptions) return;

    // Remove existing non-default options
    Array.from(select.options).forEach(option => {
        if (option.value !== 'default') select.removeChild(option);
    });

    storedOptions.forEach(optionData => {
        const option = new Option(optionData.text, optionData.value);
        option.dataset.key = optionData.key;
        option.dataset.endpoint = optionData.endpoint;
        select.appendChild(option);
    });

    // Ensure the select displays the correct selected value from storage
    select.value = localStorage.getItem(storageId + '_selected') || 'default';
    Select.updateSelectedOption(select);
}

CustomDropdown.deleteSelectedOption = function(dropdown){
    const select = Elem.byId(dropdown.selectId);
    const selectedIndex = select.selectedIndex;
    if (selectedIndex < 0 || select.options[selectedIndex].value === 'none') return;

    select.remove(selectedIndex);

    if (select.options.length > 0) {
        select.selectedIndex = Math.max(0, selectedIndex - 1);
    } else {
        const noneOption = new Option('none', 'none');
        select.appendChild(noneOption);
        select.selectedIndex = 0;
    }

    CustomDropdown.updateLocalStorage(select, dropdown.storageId);
    Select.updateSelectedOption(select);
    CustomDropdown.refreshDisplay(select);
}



Select.storeSelectedValue = function(selectId){
    const select = Elem.byId(selectId);
    if (select) localStorage.setItem(selectId, select.value);
}
Select.restoreSelectedValue = function(select){
    const storedValue = localStorage.getItem(select.id);
    if (!storedValue) return;

    const optionExists = Array.from(select.options).some(option => option.value === storedValue);
    if (optionExists) select.value = storedValue;
}



function updateOptionTitle(selectElement, optionValue, newTitle) {
    const option = Array.from(selectElement.options).find(opt => opt.value === optionValue);
    if (!option) return;

    option.innerText = newTitle;
    const optionDiv = selectElement.parentNode.querySelector(`.dropdown-option[data-value="${optionValue}"] .option-input`);
    if (optionDiv) optionDiv.innerText = newTitle;
    if (option.selected) Select.updateSelectedOption(selectElement);
}

CustomDropdown.addHtmlOption = function(select, optionData, createOptionContent){
    const option = new Option(optionData.text, optionData.value);
    option.dataset.key = optionData.key;
    select.appendChild(option);

    const optionsReplacer = select.parentNode.querySelector('.options-replacer');
    if (optionsReplacer) {
        const selectedDiv = select.parentNode.querySelector('.select-replacer > div');
        CustomDropdown.createHtmlOptionDiv(select, optionsReplacer, selectedDiv, createOptionContent, option);
    }
}

CustomDropdown.setupHtmlOptions = function(select, createOptionContent, delayListeners = false){
    // Create the main custom dropdown container
    const selectReplacer = Html.make.div('select-replacer closed');

    // Create the currently selected value container
    const selectedDiv = Html.make.div('selected-text');

    // Safeguard against empty select or invalid selectedIndex
    if (select.options.length > 0 && select.selectedIndex >= 0 && select.selectedIndex < select.options.length) {
        selectedDiv.innerText = select.options[select.selectedIndex].innerText;
    }
    selectReplacer.appendChild(selectedDiv);

    // Create the dropdown options container
    const optionsReplacer = Html.make.div('options-replacer custom-scrollbar');

    // Append the options container to the main dropdown container
    selectReplacer.appendChild(optionsReplacer);

    // Replace the original select with the custom dropdown
    const container = Html.make.div('select-container');
    select.parentNode.insertBefore(container, select);
    container.appendChild(selectReplacer);
    container.appendChild(select);
    select.style.display = 'none'; // Hide the original select

    CustomDropdown.populateHtmlOptions(select, optionsReplacer, selectedDiv, createOptionContent);

    if (!delayListeners) CustomDropdown.addEventListeners(select);
}

CustomDropdown.populateHtmlOptions = function(select, optionsReplacer, selectedDiv, createOptionContent){
    const create = CustomDropdown.createHtmlOptionDiv.bind(CustomDropdown, select, optionsReplacer, selectedDiv, createOptionContent);
    Array.from(select.options).forEach(create);
}
CustomDropdown.createHtmlOptionDiv = function(select, optionsReplacer, selectedDiv, createOptionContent, option){
    const optionDiv = Html.make.div('dropdown-option');
    optionDiv.dataset.value = option.value;

    const optionContent = createOptionContent(option);
    optionDiv.appendChild(optionContent);

    if (option.selected) optionDiv.classList.add('selected');

    On.click(optionDiv, (e)=>{
        e.stopPropagation();
        Select.selectOption(select, option);
    });

    optionsReplacer.appendChild(optionDiv);
}

// `createZetContainerDropdown` was here. It rendered one Archive dropdown option as a
// contentEditable div, so typing in it renamed the Archive -- the only rename this app
// ever had, reachable only by noticing that an option in a dropdown took a caret. The
// dropdown is gone with the rest of the Notes pane header, so this had no caller left.
// Issue #64 covers a rename with a name on it; the version removed here is in the
// history if it is wanted as a starting point.

function refreshHtmlDropdownDisplay(select, createOptionContent) {
    const optionsReplacer = select.parentNode.querySelector('.options-replacer');
    const selectedDiv = select.parentNode.querySelector('.select-replacer > div');

    // Clear existing custom dropdown options
    while (optionsReplacer.firstChild) {
        optionsReplacer.removeChild(optionsReplacer.firstChild);
    }

    CustomDropdown.populateHtmlOptions(select, optionsReplacer, selectedDiv, createOptionContent);

    Select.updateSelectedOption(select);
}
