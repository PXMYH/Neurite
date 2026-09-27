// Every reply carries the id of the request that asked for it. Without one there is
// nothing to match a reply to a caller, and the page had no choice but to guess: it
// attached one listener per request to this single Worker, so the first result was
// delivered to every waiting caller and results two onward were dropped with no
// listener left to hear them. Measured before the fix -- four distinct vectors sent
// back, one vector cached against all three Nodes.
//
// `id` is last and optional so `post('ready', …)` and an error raised before any
// request exists still work; those are broadcasts and belong to no caller.
function post(type, res, id){ self.postMessage({ type, res, id }) }
post.error = post.bind(self, 'error');

class Model {
    urlTransformers = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js';
    // Where the library comes from, as a seam: a test swaps it for a fake.
    static load = (url)=>import(url);

    // Two promises, not one (#75). The pipeline is loaded once and shared; the queue runs
    // one extraction at a time. They were a single chain in which each request resolved
    // to the extractor for the next, so one failed extraction handed `undefined` to the
    // request after it, which threw, which handed `undefined` on again -- every later
    // request in the session failed. A pipeline that failed to load was never retried
    // either. Now a failed load is forgotten and tried again on the next request, and a
    // link in the queue always settles, whatever its request did.
    #extractor = null;
    #queue = Promise.resolve();
    constructor(apiName, pipelineName){
        this.apiName = apiName;
        this.pipelineName = pipelineName;
    }

    initialize(){
        this.#extractor ??= Model.load(this.urlTransformers)
            .then(this.#getExtractor.bind(this))
            .then(this.#postReady.bind(this))
            .catch(this.#onInitError);
        return this.#extractor;
    }
    #getExtractor(transformers){
        const { pipeline, env } = transformers;

        // Ensure models are fetched from the remote source
        env.allowLocalModels = false;
        env.useBrowserCache = true;

        const modelName = this.pipelineName;
        console.log("Loading model: " + modelName);
        return pipeline('feature-extraction', modelName, {
            dtype: 'fp32'  // You can also try 'fp16' if supported by your device
        });
    }
    #postReady(extractor){
        console.log("Model loaded successfully: " + this.pipelineName);
        post('ready', this.apiName);
        return extractor;
    }
    #onInitError = (err)=>{
        console.error("Error initializing embeddings:", err);
        this.#extractor = null;
        return Promise.reject(err);
    }

    // `id` is carried the whole way down to the reply rather than held in a field: the
    // requests queue behind one another, so several are in flight at once and a single
    // "current id" would be overwritten by the next message long before this one
    // finished extracting.
    generate(text, id){
        if (typeof text !== 'string') {
            post.error("Input must be a string", id);
            return Promise.resolve();
        }

        const run = ()=>this.initialize()
            .then( (extractor)=>extractor(text, {pooling: 'mean', normalize: true}) )
            .then(this.#postResult.bind(this, id), this.#postError.bind(this, id));
        return this.#queue = this.#queue.then(run);
    }
    #postResult(id, output){ post('result', Array.from(output.data), id) }
    #postError = (id, err)=>{ post.error(err.message, id) }
}

const models = {
    'local-embeddings-gte-small': new Model('local-embeddings-gte-small', 'Supabase/gte-small'),
    'local-embeddings-all-MiniLM-L6-v2': new Model('local-embeddings-all-MiniLM-L6-v2', 'Xenova/all-MiniLM-L6-v2')
}

self.onmessage = function(e){
    const { verb, modelName, input, id } = e.data;

    const model = models[modelName];
    if (!model) return post.error("Unknown model: " + modelName, id);
    // `type` was undefined here and threw a ReferenceError instead of reporting the bad
    // verb -- and because the throw escaped before any reply was posted, the caller's
    // promise never settled either way.
    if (!model[verb]) return post.error("Unknown message type: " + verb, id);

    model[verb](input, id).catch( (err)=>{
        console.error('Worker: Error processing message:', err);
        post.error(err.message, id);
    });
}
