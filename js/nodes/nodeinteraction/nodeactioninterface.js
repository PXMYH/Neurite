const NodeActions = {};

NodeActions.forNode = function(node){
    // There are more node types than there are action classes -- an image node's
    // actions are the base ones. Fall back rather than throw, so naming a type in
    // Node.typeByFlag does not oblige anyone to write an actions class for it.
    const Actions = NodeActions[Node.getType(node)] || NodeActions.base;
    return new Actions(node);
}

// Define action parameter types
const actionParameterTypes = {
    'moveNode': ['float', 'float'] // Assumes moveNode expects two floats: angle, forceMagnitude
};

function executeNodeMethod(nodeActions, methodName) {
    Logger.info("Executing node method:", methodName);
    const methodPattern = /(\w+)(\(.*\))?/;
    const match = methodName.match(methodPattern);
    if (!match) {
        Logger.err("Invalid method format:", methodName);
        return;
    }

    const actionName = match[1];
    const rawParams = match[2] ? match[2].slice(1, -1).split(',') : [];
    let params = rawParams;

    // Convert parameters based on their expected types
    if (actionParameterTypes[actionName]) {
        params = rawParams.map((param, index) => {
            const type = actionParameterTypes[actionName][index];
            if (type === 'float') return parseFloat(param);
            if (type === 'int') return parseInt(param, 10);
            return param; // string
        });
    }

    if (typeof nodeActions[actionName] === 'function') {
        nodeActions[actionName](...params);
        App.recentSuggestions.add(methodName);
    } else {
        Logger.err("Invalid method for node:", actionName)
    }
}

// By what the menu calls an action as well as by its method name and keywords.
function getSuggestionsFromMethods(input, methodsWithKeywords, nodeActions) {
    const lowerCaseInput = input.trim().toLowerCase();
    const matches = [];
    const label = (method)=>nodeActions.label(method).toLowerCase();

    // Iterate over each action and its keywords
    for (const [method, keywords] of Object.entries(methodsWithKeywords)) {
        if (method.toLowerCase().includes(lowerCaseInput) || label(method).includes(lowerCaseInput)
            || keywords.some(keyword => keyword.toLowerCase().includes(lowerCaseInput))) {
            matches.push(method);
        }
    }

    // Sort matches by relevance (exact matches first)
    matches.sort((a, b) => {
        const aExactMatch = label(a).startsWith(lowerCaseInput) || a.toLowerCase().startsWith(lowerCaseInput);
        const bExactMatch = label(b).startsWith(lowerCaseInput) || b.toLowerCase().startsWith(lowerCaseInput);
        return bExactMatch - aExactMatch;
    });

    return matches;
}

function getNodeMethodSuggestions(value, node) {
    const nodeActions = NodeActions.forNode(node);
    const validActionsWithKeywords = nodeActions.getActions();

    if (value.trim() !== '') {
        return getSuggestionsFromMethods(value, validActionsWithKeywords, nodeActions);
    }

    // The recent ones first, and only those this Node has: the list is shared by every
    // Node Type, so an AI Node's `sendMessage` was offered on a note, where it did nothing.
    const recentSuggestions = App.recentSuggestions.get()
        .filter(action => action in validActionsWithKeywords);
    const allValidActions = Object.keys(validActionsWithKeywords);
    const allValidActionsExcludingRecent = allValidActions.filter(action => !recentSuggestions.includes(action));
    return [...recentSuggestions, ...allValidActionsExcludingRecent];
}

// What the menu calls each action (#50). It showed the method names -- `toggleSelect`,
// `spawnNode`, `zoomTo` -- as they are written in code. A toggle is named for what it
// will do now, in `label` below.
NodeActions.labels = {
    zoomTo: "Zoom to it",
    follow: "Follow it",
    delete: "Delete",
    toggleAutomata: "Start or stop cellular automata",
    spawnNode: "New note beside it",
    connect: "Link to another node…",
    sendMessage: "Send the prompt",
    settings: "Settings",
    halt: "Stop the answer",
    refreshResponse: "Answer again",
    toggleLink: "Show or hide the page",
    extractText: "Add the page to the vector database",
    importText: "Import the page text into the notes"
};

NodeActions.base = class BaseNodeActions {
    applyActionToSelectedNodes(action){
        if (!App.selectedNodes.hasNode(this.node)) action(this.node)
        else App.selectedNodes.forEach(action)
    }

    constructor(node){ this.node = node }

    getActions() {
        return {
            //'updateSensor': ["refresh", "renew", "sensor update"],
            'zoomTo': ["focus on", "center on", "highlight", "zoom in", "go to"],
            'follow': ["focus on", "center on", "highlight", "zoom in", "go to", "track"],
            'delete': ["remove", "erase", "discard", "delete node"],
            'toggleSelect': ["select", "choose", "highlight", "deselect"],
            'toggleCollapse': ["collapse", "fold", "minimize", "expand", "unfold", "maximize"],
            'toggleAutomata': ["automata"],
            'spawnNode': ["automata", "birth", "create"],
            'connect': ["edge", "link"],
            //'moveNode': ["move", "shift", "translate"],
            //'moveTo': ["move", "shift", "translate"]
        };
    }

    label(action) {
        switch (action) {
            case 'toggleSelect':
                return (App.selectedNodes.hasNode(this.node) ? "Deselect" : "Select");
            case 'toggleCollapse':
                return (this.node.view.div.classList.contains('collapsed') ? "Expand" : "Collapse");
            default:
                return NodeActions.labels[action] ?? action;
        }
    }

    // Common methods for all nodes
    updateSensor() { this.node.updateSensor(); }
    zoomTo() { Animation.zoomToNodeTitle(this.node); }
    follow() {
        Autopilot.setNode(this.node).start();
        App.menuContext.hide();
    }
    connect() {
        new Modal.Connect(this.node);
        App.menuContext.hide();
    }
    toggleSelect() {
        this.applyActionToSelectedNodes(SelectedNodes.toggleNode)
    }

    toggleCollapse() {
        this.applyActionToSelectedNodes(Node.toggleCollapse)
    }
    toggleAutomata(){ App.cellularAutomata.toggle() }
    // Asked first, as the card's own × asks: there is no undo, and on a selected Node this
    // deletes the whole selection -- measured, two Nodes gone from one click, unasked.
    async delete() {
        App.menuContext.hide();
        const count = (App.selectedNodes.hasNode(this.node) ? App.selectedNodes.uuids.size : 1);
        const named = this.node.getTitle()?.trim();
        const question = (count > 1) ? `Delete the ${count} selected nodes?`
                       : `Delete ${named ? `"${named}"` : 'this note'}?`;
        if (!await window.confirm(question)) return;

        this.applyActionToSelectedNodes(deleteNodeAndItsZetText);
    }
    spawnNode(){ spawnZettelkastenNode(this.node) }
    moveNode(directionOrAngle, forceMagnitude = 0.01) {
        // Ensure this.node is the node class instance with the updated moveNode method
        this.node.moveNode(directionOrAngle, forceMagnitude);
    }
    moveTo(x, y, tolerance = null, onComplete = () => { }) {
        this.node.moveTo(x, y, tolerance, onComplete);
    }
}

NodeActions.text = class TextNodeActions extends NodeActions.base {
    getActions() {
        return {
            ...super.getActions(),
            'toggleCode': ["show code", "hide code", "run code", "toggle script", "show text", "display text", "display code", "view text"],
            //'testNodeText': ["test text", "check text", "text testing"]
        };
    }

    label(action) {
        if (action !== 'toggleCode') return super.label(action);
        return (this.node.codeEditingState === 'code' ? "Show its text" : "Run its code");
    }

    toggleCode() { handleCodeExecution(this.node) }
    testNodeText() { testNodeText(this.node.getTitle()) }
    // No delete() override: the base one deletes the node and its pane section
    // together for every node type. This class used to delete the text only and
    // leave the node to the next sync pass, which did nothing at all when the title
    // was not in the pane's map.
}

NodeActions.llm = class LLMNodeActions extends NodeActions.base {
    getActions() {
        return {
            ...super.getActions(),
            'sendMessage': ["send", "transmit", "dispatch", "send message"],
            'settings': ["preferences", "options", "configuration", "setup"],
            'halt': ["stop", "pause", "interrupt", "cease"],
            'refreshResponse': ["update response", "reload", "refresh"]
        }
    }

    sendMessage() {
        const promptTextarea = this.node.promptTextArea;
        // Check if the prompt textarea is empty
        if (!promptTextarea.value.trim()) {
            window.prompt("Please enter your prompt:", '', 'Prompt the Model')
                .then( (userInput)=>{
                    if (userInput === null || userInput.trim() === '') {
                        return Logger.info("No prompt entered")
                    }

                    promptTextarea.value = userInput;
                })
                .catch(Logger.err.bind(Logger, "Failed to get prompt input:"))
        }

        this.simulateClick(this.node.sendButton, "Send");
    }
    halt(){
        this.simulateClick(this.node.regenerateButton, "Halt")
    }
    refreshResponse(){
        this.simulateClick(this.node.regenerateButton, "Regenerate")
    }
    settings(){
        const settingsButton = this.node.content.querySelector('#aiNodeSettingsButton');
        this.simulateClick(settingsButton, "Settings");
    }
    simulateClick(button, name){
        if (button instanceof HTMLElement) {
            button.click()
        } else {
            Logger.err(name, "button not found or is not a valid element")
        }
    }
}

NodeActions.link = class LinkNodeActions extends NodeActions.base {
    getActions() {
        return {
            ...super.getActions(),
            //'displayIframe': ["show iframe", "iframe view", "embed", "display frame"],
            'toggleLink': ["show", "iframe", "embed", "web", "website", "webpage"],
            'extractText': ["text", "copy", "", "webpage", "scrape", "vector", "db", "database"],
            //'toggleProxy': ["webpage text", "proxy"],
            'importText': ["webpage", "import", "text", "notes"]

        };
    }
    toggleLink() {
        this.node.typeNode.toggleViewer();
    }
    //displayIframe() {
    //    this.node.typeNode.handleIframe()
    //}
    //toggleProxy() {
    //    this.node.typeNode.handleProxyDisplay()
    //}
    extractText() {
        extractAndStoreLinkContent(this.node.linkUrl, this.node.view.titleInput.value);
    }
    importText() {
        importLinkNodeTextToZettelkasten(this.node.linkUrl);
        App.menuContext.hide();
    }
}
