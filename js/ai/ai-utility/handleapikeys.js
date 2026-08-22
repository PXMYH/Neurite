function setModelSelectorsVisibility(inferenceSelect) {
    const selectedValue = inferenceSelect.value.toLowerCase();
    const nodeIndex = inferenceSelect.id.split('-').pop(); // Extract the node index if present

    // Get the container of the inference select to scope the selection
    const container = inferenceSelect.closest('.local-llm-dropdown-container-' + nodeIndex) || Elem.byId('template-dropdowns');
    if (!container) {
        Logger.err("Container not found for inference select:", inferenceSelect);
        return;
    }

    // Hide all model selectors by default
    container.querySelectorAll('.dropdown-wrapper').forEach(wrapper => {
        if (!wrapper.id.startsWith('wrapper-inference')) { // Ensure the inference select wrapper is never hidden
            wrapper.style.display = 'none';
        }
    });

    // Show the relevant model selector based on the selected inference option
    const relevantWrapper = container.querySelector(`[id^="wrapper-${selectedValue}"]`);
    if (relevantWrapper) {
        relevantWrapper.style.display = 'flex';
    }
}

function setupInferenceDropdowns(container) {
    const inferenceSelect = container.querySelector('.model-selector.custom-select[id^="inference-select"]');

    // Set up initial visibility based on the selected inference option
    setModelSelectorsVisibility(inferenceSelect);

    On.change(inferenceSelect, (e)=>{
        setModelSelectorsVisibility(inferenceSelect);

        // Close the dropdown when an option is selected
        const selectReplacer = inferenceSelect.closest('.select-container').querySelector('.select-replacer');
        if (!selectReplacer) return;

        selectReplacer.classList.add('closed');
        const optionsReplacer = selectReplacer.querySelector('.options-replacer');
        if (optionsReplacer) optionsReplacer.classList.remove('show');
    });
}


setupInferenceDropdowns(Elem.byId('template-dropdowns'));



CustomDropdown.loadSelect = function(dropdown){
    const select = Elem.byId(dropdown.selectId);
    CustomDropdown.loadFromLocalStorage(select, dropdown.storageId);
    CustomDropdown.refreshDisplay(select);
}

CustomDropdown.loadSelect(CustomDropdown.model);


function saveApiConfig() {
    const endpoint = Elem.byId('apiEndpoint').value;
    const modelName = Elem.byId('apiModelName').value;
    if (!endpoint.trim() || !modelName.trim()) {
        alert("API Endpoint and Model Name are required.");
        return;
    }

    const selectData = {
        modelName,
        endpoint,
        key: Elem.byId('apiEndpointKey').value,
        value: Date.now().toString()
    };
    CustomDropdown.addModel(CustomDropdown.model, selectData);

    Modal.close();
}

function fetchCustomModelData(modelName) {
    let selectedOption = null;
    for (const option of Elem.byId('custom-model-select').options) {
        if (option.text === modelName) {
            selectedOption = option;
            break;
        }
    }
    if (!selectedOption) {
        Logger.err("No option found with model name:", modelName);
        return null;
    }

    const apiEndpoint = selectedOption.dataset.endpoint;
    const apiKey = selectedOption.dataset.key;

    if (!apiEndpoint) {
        Logger.err("Missing Custom Endpoint:", modelName);
        return null;
    }

    return {
        apiEndpoint: apiEndpoint,
        apiKey: apiKey
    };
}

function addApiConfigBtnListeners(){
    const onAdd = Modal.open.bind(Modal, 'apiConfigModalContent');
    On.click(Elem.byId('addApiConfigBtn'), onAdd);

    const onDelete = CustomDropdown.deleteSelectedOption.bind(CustomDropdown, CustomDropdown.model);
    On.click(Elem.byId('deleteApiConfigBtn'), onDelete);
}
addApiConfigBtnListeners()



//api keys

const LocalStorage = {};
LocalStorage.loadKey = function(inputId, storageId){
    Elem.byId(inputId).value = localStorage.getItem(storageId || inputId) || ''
}
LocalStorage.saveKey = function(inputId, storageId){
    localStorage.setItem(storageId || inputId, Elem.byId(inputId).value)
}
LocalStorage.loadKeys = function(){
    for (const providerId in Providers) {
        const provider = Providers[providerId]
        if (provider.inputId) this.loadKey(provider.inputId, provider.storageId)
    }
}
function saveKeys() {
    LocalStorage.saveKeys()
}
LocalStorage.saveKeys = function(){
    for (const providerId in Providers) {
        const provider = Providers[providerId]
        if (provider.inputId) this.saveKey(provider.inputId, provider.storageId)
    }
}
LocalStorage.loadKeys();

async function saveKeysToFile() {
    // Gather the keys
    const keys = {
        googleApiKey: Elem.byId('googleApiKey').value || '',
        googleSearchEngineId: Elem.byId('googleSearchEngineId').value || '',
        openaiApiKey: Elem.byId('api-key-input').value || '',
        wolframApiKey: Elem.byId('wolframApiKey').value || '',
        GROQApiKey: Elem.byId('GROQ-api-key-input').value || '',
        anthropicApiKey: Elem.byId('anthropic-api-key-input').value || '',
    };

    try {
        if ('showSaveFilePicker' in window) {
            const handle = await window.showSaveFilePicker({
                types: [
                    {
                        description: 'Text Files',
                        accept: {
                            'text/plain': ['.txt'],
                        },
                    },
                ],
            });
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(keys));
            await writable.close();
        } else {
            // Handle lack of support for showSaveFilePicker
            alert('Your browser does not support saving files.');
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            alert('An error occurred while saving: ' + error);
        }
    }
}

async function loadKeysFromFile() {
    try {
        if ('showOpenFilePicker' in window) {
            const [fileHandle] = await window.showOpenFilePicker();
            const file = await fileHandle.getFile();
            const contents = await file.text();

            const keys = JSON.parse(contents);
            for (providerId in Providers) {
                const provider = Providers[providerId];
                const inputId = provider.inputId;
                if (!inputId) continue;

                Elem.byId(inputId).value = keys[provider.storageId || inputId] || '';
            }
        } else {
            // Handle lack of support for showOpenFilePicker
            alert('Your browser does not support opening files.');
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            alert('An error occurred while loading: ' + error);
        }
    }
}

function clearKeys() {
    for (providerId in Providers) {
        const provider = Providers[providerId];
        const inputId = provider.inputId;
        if (!inputId) continue;

        localStorage.removeItem(provider.storageId || inputId);
        Elem.byId(inputId).value = '';
    }
}

Host.checkServer = async function(){
    useProxy = await Request.send(new Host.checkServer.ct());
    if (useProxy) {
        Ollama.library = await getOllamaLibrary();
    }
    Ollama.baseUrl = Ollama.getBaseUrl();
    await Ollama.selectOnPageLoad();
}
Host.checkServer.ct = class {
    url = Host.urlForPath('/check');
    onSuccess(){ return "Connected to Localhost Servers" }
    onFailure(){ return "Not connected to Localhost Servers" }
}

Host.provideAPIKeys = async function(){
    await Request.send(new Host.provideAPIKeys.ct())
}
Host.provideAPIKeys.ct = class {
    constructor() {
        this.url = Host.urlForPath('/aiproxy/api-keys');
        this.options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                openaiApiKey: Elem.byId('api-key-input').value,
                groqApiKey: Elem.byId('GROQ-api-key-input').value,
                anthropicApiKey: Elem.byId('anthropic-api-key-input').value,
                ollamaBaseUrl: Ollama.userBaseUrl()
            })
        };
    }
    onFailure() { return "Failed to provide API keys to the proxy server"; }
}

// How to reach each provider, in one table rather than two switches.
//
// `Providers` in aihelpers.js records where a provider's *widgets* live. This
// records how to *call* it, which is a different question, so it sits next to its
// only reader instead. The two are pinned together by a test, because a provider
// present in one and absent from the other used to be silent: both switches ended
// in `default:` -> OpenAI, so a forgotten provider sent its request to the OpenAI
// endpoint carrying the OpenAI key.
//
// - proxyOnly    the message to show when the direct route does not exist
// - keyless      needs no key from the user, so the missing-key alert is skipped
// - bearer       the direct route wants `Authorization: Bearer <key>`
// - fromModelData the endpoint and key come off the selected option's dataset
// - requestId    the body carries a request id, so the call can be cancelled
// - managed      neither route applies; handled before either one is chosen
const ProviderRoutes = {
    anthropic: {proxyPath: '/aiproxy/anthropic',
                proxyOnly: "Claude model can only be used with the AI proxy server. Please enable the proxy server and refresh the page."},
    GROQ:      {proxyPath: '/aiproxy/groq',        directUrl: 'https://api.groq.com/openai/v1/chat/completions', keyInputId: 'GROQ-api-key-input', bearer: true},
    ollama:    {proxyPath: '/aiproxy/ollama/chat', directUrl: 'http://127.0.0.1:11434/api/chat', keyless: true, requestId: true},
    OpenAi:    {proxyPath: '/aiproxy/openai',      directUrl: 'https://api.openai.com/v1/chat/completions', keyInputId: 'api-key-input', bearer: true},
    custom:    {proxyPath: '/aiproxy/custom',      fromModelData: true, keyless: true, requestId: true},
    neurite:   {managed: true, keyless: true}
}

function getAPIParams(messages, stream, customTemperature, inferenceOverride) {
    const { providerId, model } = inferenceOverride || Ai.determineModel();
    Logger.info("Selected Ai:", model);

    let API_KEY;
    let API_URL;
    let apiEndpoint;

    const route = ProviderRoutes[providerId];
    if (!route) {
        // This used to fall through to `default:` in both switches, which is
        // OpenAI, so an unrouted provider silently borrowed OpenAI's endpoint and
        // key. The caller turns null into a visible "Parameters are missing."
        Logger.err("No route for provider:", providerId);
        return null;
    }

    if (route.managed) {
        // Neurite provider setup with specific endpoint and credentials
        API_URL = null;
        const headers = new Headers();
        headers.append("Content-Type", "application/json");

        // Build the request body
        const body = JSON.stringify({
            temperature: customTemperature !== null ? customTemperature
                : parseFloat(document.getElementById('model-temperature').value),
            messages,
            model, // include the specific model selected for neurite
            stream
        });

        return {
            headers,
            body,
            API_URL,
            providerId
        };
    }

    if (useProxy) {
        // Use the AI proxy server
        if (route.fromModelData) {
            const apiDetails = fetchCustomModelData(model);
            // On failure API_URL is deliberately left unset, so the request is not
            // sent to a half-built target. Same as the old switch, which `break`ed
            // before assigning it.
            if (!apiDetails) {
                Logger.err("Failed to fetch API details for the model:", model);
            } else {
                API_URL = Host.urlForPath(route.proxyPath);
                apiEndpoint = apiDetails.apiEndpoint;
                API_KEY = apiDetails.apiKey;
            }
        } else {
            API_URL = Host.urlForPath(route.proxyPath);
        }
        Host.provideAPIKeys();
    } else {
        // Use the direct API endpoints
        if (route.proxyOnly) {
            alert(route.proxyOnly);
            return null;
        }
        if (route.fromModelData) {
            const apiDetails = fetchCustomModelData(model);
            API_URL = apiDetails.apiEndpoint;
            API_KEY = apiDetails.apiKey;
        } else {
            API_URL = route.directUrl;
            if (route.keyInputId) API_KEY = Elem.byId(route.keyInputId).value;
        }
    }

    if (!useProxy && !API_KEY && !route.keyless) {
        alert("Please enter your API key");
        return null;
    }

    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    if (!useProxy && route.bearer) {
        headers.append("Authorization", `Bearer ${API_KEY}`);
    }

    const max_tokens = parseInt(Elem.byId('max-tokens-slider').value);
    const temperature = customTemperature ?? parseFloat(Elem.byId('model-temperature').value);
    const body = {model, messages, max_tokens, temperature, stream };

    if (route.requestId) body.requestId = Date.now().toString();

    if (apiEndpoint) {
        body.apiEndpoint = apiEndpoint;
        body.apiKey = API_KEY;
    }

    return {headers, body, API_URL};
}
