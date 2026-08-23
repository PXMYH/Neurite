class ZetPath {
    constructor(options) {
        this.options = options;
        this.path = [];
    }
    static newOption(sliderId, funcParse){
        return {sliderId, funcParse}
    }

    generatePath() {
        // To be implemented by subclasses
    }
    generateRadialNodes(numNodes, nodeSpacing, scale, startNodeIndex) {
        const radialNodes = [];
        for (let i = 0; i < numNodes; i++) {
            const angle = (2 * Math.PI * i) / numNodes;
            radialNodes.push({
                x: Math.cos(angle) * nodeSpacing,
                y: Math.sin(angle) * nodeSpacing,
                scale,
                startNodeIndex,
                startFromBeginning: true,
            });
        }
        return radialNodes;
    }
}

ZetPath.Spiral = class extends ZetPath {
    constructor(options) {
        super(options);
        this.options = {...options};
    }
    generatePath() {
        Logger.debug("Generating spiral path...");
        const path = this.path = [];
        let angle = 0;
        const options = this.options;
        let radius = options.pathDistance * options.scale;
        const curl = options.curl;

        let angleIncrement = 0.1 + Math.abs(curl) * 0.3;
        let radiusIncrement = 0.1 + Math.abs(curl) * 0.3;
        for (let i = 0; i < options.pathLength; i++) {
            // Calculate the position of the current node
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            // Add the current node to the path
            path.push({ x, y, scale: options.scale });
            // Increment the angle and radius for the next node based on the curl value
            angle += angleIncrement * Math.sign(curl);
            radius += radiusIncrement;
            // Adjust the radius based on the desired node spacing
            const targetDistance = options.pathDistance * options.scale;
            const currentDistance = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
            const distanceRatio = targetDistance / currentDistance;
            radius *= distanceRatio;
        }
        Logger.debug("Spiral path generated:", path);
    }
}

ZetPath.Branching = class extends ZetPath {
    generatePath() {
        Logger.debug("Generating branching path...");
        const path = this.path = [];
        const options = this.options;
        const branchingFactor = options.factor;
        const nodeSpacing = options.pathDistance;
        const scale = options.scale;
        const branchingInterval = 2; // Determines how often branches occur
        const totalDepth = Math.floor(Math.log(options.pathLength) / Math.log(branchingFactor));
        const angleDelta = (2 * Math.PI) / branchingFactor;

        const generateBranch = (depth, parentNodeIndex, angle, currentInterval) => {
            if (depth === 0 || currentInterval < branchingInterval) return;

            for (let i = 0; i < branchingFactor; i++) {
                const branchAngle = angle + (i - (branchingFactor - 1) / 2) * angleDelta;
                const radius = nodeSpacing * (totalDepth - depth + 1);
                path.push({
                    x: Math.cos(branchAngle) * radius,
                    y: Math.sin(branchAngle) * radius,
                    scale: Math.pow(scale, totalDepth - depth + 1),
                    startNodeIndex: parentNodeIndex,
                    startFromBeginning: false,
                });

                // Reset the interval every time a branch is created
                generateBranch(depth - 1, path.length - 1, branchAngle, branchingInterval);
            }
        };

        // Start with the branching interval at its max to place the first branch correctly
        generateBranch(totalDepth, 0, 0, branchingInterval);

        Logger.debug("Updated Branching Path:", path);
        return path;
    }
}

ZetPath.Radial = class extends ZetPath {
    generatePath() {
        const path = this.path = [];
        const options = this.options;
        const numBranches = Math.min(Math.floor(options.depth), 8);
        const nodesPerBranch = Math.min(Math.floor(options.pathLength / numBranches), 50);
        const nodeSpacing = Math.max(options.pathDistance, 1);
        const maxPathLength = options.pathLength * numBranches; // Set a limit to the path length
        let currentScale = options.scale;
        let currentLayerNodes = [0]; // Start with the initial parent node as the first layer
        // Generate branches for each subsequent layer
        for (let i = 0; i < numBranches - 1 && path.length < maxPathLength; i++) {
            const nextLayerNodes = [];
            // Decrease the scale for the current layer
            currentScale = Math.max(currentScale * options.scale, 0.1);
            // Generate child nodes for each parent node in the current layer
            for (let j = 0; j < currentLayerNodes.length && path.length < maxPathLength; j++) {
                const parentNodeIndex = currentLayerNodes[j];
                const childNodes = this.generateRadialNodes(nodesPerBranch, nodeSpacing, currentScale, parentNodeIndex);
                path.push(...childNodes.slice(0, maxPathLength - path.length)); // Limit the number of child nodes added
                nextLayerNodes.push(...childNodes.map((_, index) => path.length - childNodes.length + index));
            }
            currentLayerNodes = nextLayerNodes;
        }
        return path;
    }
}

ZetPath.Empty = class extends ZetPath {
    generatePath() {
        Logger.debug("Generating radial path...");
        this.path = [];
        Logger.debug("Updated Radial Path:", this.path);
        return this.path;
    }
}

ZetPath.create = function(styleName, options){
    let zetPath;
    const zetPlacementOverride = (styleName === 'Random');

    if (styleName === 'Random') {
        zetPath = new ZetPath.Empty();
    } else {
        const styleOptions = options[styleName];
        if (!styleOptions) throw new Error("Invalid ZetPath style: " + styleName);

        zetPath = new ZetPath[styleName](styleOptions);
    }

    return { zetPath, zetPlacementOverride };
}

ZetPath.options = {
    default: {
        // Shared Defaults
        pathLength: 64, // Default for "Number of Nodes" slider
        scale: 0.8, // Default for "Node Size" slider
        nodeSpacing: 1,

        Branching: {
            factor: 4,
            pathDistance: 1,
            pathLength: 64,
            scale: 0.98
        },
        Radial: {
            depth: 8,
            pathDistance: 5,
            pathLength: 64,
            scale: 0.8
        },
        Spiral: {
            curl: 0.2,
            pathDistance: 1,
            pathLength: 64,
            scale: 1
        }
    },
    Branching: {
        factor: ZetPath.newOption("branchingFactorSlider", parseInt),
        pathDistance: ZetPath.newOption("branchingPathDistanceSlider", parseFloat),
        pathLength: ZetPath.newOption("branchingPathLengthSlider", parseInt),
        scale: ZetPath.newOption("branchingScaleSlider", parseFloat)
    },
    Radial: {
        depth: ZetPath.newOption("radialDepthSlider", parseFloat),
        pathDistance: ZetPath.newOption("radialPathDistanceSlider", parseFloat),
        pathLength: ZetPath.newOption("radialPathLengthSlider", parseInt),
        scale: ZetPath.newOption("radialScaleSlider", parseFloat)
    },
    Spiral: {
        curl: ZetPath.newOption("curlSlider", parseFloat),
        pathDistance: ZetPath.newOption("spiralPathDistanceSlider", parseFloat),
        pathLength: ZetPath.newOption("spiralPathLengthSlider", parseInt),
        scale: ZetPath.newOption("spiralScaleSlider", parseFloat)
    }
}

ZetPath.updateOptions = function(targetProcessor = null){
    Logger.debug("Updating path options...");
    const styleName = Modal.inputValues.zetPathTypeDropdown || 'Radial';
    const options = {
        zetPlacementOverride: (styleName === 'Random')
    };

    function updateStyle(styleName){
        const pathOptions = options[styleName] = {};
        const defaultOptions = ZetPath.options.default[styleName];
        const style = ZetPath.options[styleName];
        for (const optionName in style) {
            const option = style[optionName];
            const value = option.funcParse(Modal.inputValues[option.sliderId]);
            pathOptions[optionName] = (isNaN(value) ? defaultOptions[optionName] : value);
        }
    }
    ['Branching', 'Radial', 'Spiral'].forEach(updateStyle);

    const pathObject = ZetPath.create(styleName, options);
    pathObject.zetPath.generatePath();
    const updateForThisPath = ZettelkastenProcessor.updateForThisPath;
    if (targetProcessor) updateForThisPath.call(pathObject, targetProcessor)
    else window.zetPaneList.forEach((pane)=>updateForThisPath.call(pathObject, pane.processor))

    Logger.debug("Updated path options:", pathObject.zetPath.options);

    adjustSliderVisibilityBasedOnPathType(styleName);
}

function adjustSliderVisibilityBasedOnPathType(styleName) {
    // Scoped to the one section these sliders live in. `document.querySelectorAll`
    // reached all thirty-five elements that carry `.settingsSlider` -- sixteen in the
    // Fractal tab, twelve here, four in the Ai tab, three in the modals -- so changing
    // the placement style wrote `display: block` inline on every one of them.
    //
    // The harm is the layout, not the visibility. `.settingsSlider` is
    // `display: flex; flex-direction: column` (styles.css:3575), which `display: block`
    // inline overrides, so a label and its slider stop stacking. Nothing became
    // visible: all sixteen in the Fractal tab sit inside `.fractal-settings-panel` or
    // `.color-settings-panel`, both `.hidden`, which is `display: none` -- an inline
    // `display: block` on a descendant of a hidden ancestor shows nothing. It waits
    // instead: `togglepanel.js` opens a panel by removing `.hidden` and sizing it from
    // `scrollHeight`, so the reader meets the broken stack, measured at the wrong
    // height, the next time they expand either one.
    //
    // The line that showed "general sliders (without any specific class)" is gone with
    // it. Its selector was `.settingsSlider:not(.spiral-slider):not(.branching-slider)`,
    // which does not exclude `.radial-slider` -- so it re-showed this section's four
    // radial sliders one line after they were hidden, along with everything above.
    // All twelve sliders here carry a style class and nothing hides a class-less one,
    // so there is nothing left for it to re-show.
    const section = Elem.byId('zetPlacementSettings');

    section.querySelectorAll('.spiral-slider, .branching-slider, .radial-slider')
    .forEach(Elem.hide); // prevent overlap in visibility settings

    // Show the group this style names. `Random` names none, and it has to return
    // here rather than fall through: an empty string is not a selector, so
    // `querySelectorAll('')` throws a DOMException and took the rest of
    // `updateOptions`' caller with it. Random places nodes with no sliders at all,
    // so all three groups hidden is the right end state.
    const sliderClass = (styleName === 'Branching') ? '.branching-slider'
                      : (styleName === 'Spiral') ? '.spiral-slider'
                      : (styleName === 'Radial') ? '.radial-slider' : ''
    if (sliderClass) section.querySelectorAll(sliderClass).forEach(Elem.displayBlock);
}

ZetPath.init = function(){
    function setDefaultValue(styleName){
        const defaultOptions = ZetPath.options.default[styleName];
        const style = ZetPath.options[styleName];
        for (const optionName in style) {
            Elem.byId(style[optionName].sliderId).value = defaultOptions[optionName];
        }
    }
    ['Branching', 'Radial', 'Spiral'].forEach(setDefaultValue);

    // These controls used to be cloned into the modal body every time the
    // Zettelkasten gear was opened, which is what bound them. They live in the
    // Settings tab now, built once with the page, so they are bound once here --
    // after the defaults above, because the stored value has to win over them.
    // Still the `noteModal` store: that is where `updateOptions` reads from, and
    // what makes a change to any of these re-place the nodes. Unguarded, like the
    // loop above -- if the tab did not load, that threw first and said so.
    Modal.wireControls(Elem.byId('zetPlacementSettings'), Modals.noteModal);

    ZetPath.updateOptions();
}
