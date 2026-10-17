// How the page gets a Google Drive access token (docs/cloud-sync.md). In the Mac app the main
// process signs in and keeps the refresh token (desktop/drive-auth.cjs); the page asks it for an
// access token each time one runs out. In a browser there is nowhere safe to keep a refresh token,
// so Google Identity Services' token model gives an access token for an hour, held in memory only:
// after that, or a reload, Sync asks to be connected again.
//
// Both answer the same four calls: `status()`, `connect()` (from a click), `token({fresh})`, and
// `disconnect()`.
class DesktopDriveAuth {
    constructor(bridge){ this.bridge = bridge }
    get kind(){ return 'desktop' }
    async status(){
        const s = await this.bridge.status();
        return {configured: Boolean(s?.configured), connected: Boolean(s?.connected), needsClick: false};
    }
    connect(){ return this.bridge.connect() }
    token(options){ return this.bridge.accessToken(options) }
    disconnect(){ return this.bridge.disconnect() }
}

class WebDriveAuth {
    static GIS = 'https://accounts.google.com/gsi/client';
    static SCOPE = 'https://www.googleapis.com/auth/drive.file';
    #token = null;
    #expires = 0;
    #client = null;
    #loading = null;
    #answer = null;
    get kind(){ return 'web' }
    get configured(){ return Boolean(DriveConfig.webClientId) }

    #valid(){ return Boolean(this.#token) && this.#expires > Date.now() }
    async status(){
        return {configured: this.configured, connected: this.#valid(), needsClick: this.configured && !this.#valid()};
    }

    // Loaded before the click that needs it: a popup opens only in the click's own turn, and
    // Safari's rule for that is strict, so a click that had to wait for a script lost its popup.
    prepare(){
        if (!this.configured) return Promise.resolve(false);
        this.#loading ??= new Promise( (resolve, reject)=>{
            if (globalThis.google?.accounts?.oauth2) return resolve();
            const script = document.createElement('script');
            script.src = WebDriveAuth.GIS;
            script.async = true;
            script.onload = ()=>resolve();
            script.onerror = ()=>{ this.#loading = null; reject(new Error("Google's sign-in could not be loaded.")) };
            document.head.appendChild(script);
        }).then( ()=>{ this.#client ??= this.#makeClient(); return true } );
        return this.#loading;
    }
    #makeClient(){
        return google.accounts.oauth2.initTokenClient({
            client_id: DriveConfig.webClientId,
            scope: WebDriveAuth.SCOPE,
            callback: (res)=>this.#settle(res),
            error_callback: (err)=>this.#settle({error: err?.type || 'failed'})
        });
    }
    #settle(res){
        const answer = this.#answer;
        this.#answer = null;
        if (res?.access_token && google.accounts.oauth2.hasGrantedAllScopes?.(res, WebDriveAuth.SCOPE) !== false) {
            this.#token = res.access_token;
            // A minute early, so a push that starts on the token finishes on it.
            this.#expires = Date.now() + (Number(res.expires_in) || 3600) * 1000 - 60000;
            return answer?.({connected: true});
        }
        answer?.({connected: false, error: res?.error || 'not-granted'});
    }
    // From a click, in its own turn when Google's script is already here.
    connect(){
        if (!this.configured) return Promise.resolve({connected: false, error: 'not-configured'});
        if (!this.#client) return this.prepare().then( ()=>({connected: false, error: 'click-again'}) );
        return new Promise( (resolve)=>{
            this.#answer?.({connected: false, error: 'superseded'});
            this.#answer = resolve;
            this.#client.requestAccessToken();
        });
    }
    // No refresh here: a new token needs a click, so an old one is the end of it.
    token({fresh = false} = {}){
        if (fresh) this.#token = null;
        return Promise.resolve(this.#valid() ? this.#token : null);
    }
    disconnect(){
        const token = this.#token;
        this.#token = null;
        this.#expires = 0;
        if (token) globalThis.google?.accounts?.oauth2?.revoke?.(token, Function.nop);
        return Promise.resolve({connected: false});
    }
}

const DriveAuth = {
    // The Mac app's sign-in where its bridge is, the browser's anywhere else.
    make(){
        const bridge = globalThis.window?.neuriteDesktop?.drive;
        return bridge ? new DesktopDriveAuth(bridge) : new WebDriveAuth();
    }
};
