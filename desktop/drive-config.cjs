// Google's OAuth client for the Mac app's Google Drive sync (docs/cloud-sync.md, "Setting it up"):
// a client of type Desktop app, in the same Google Cloud project as the browser's
// (js/sync/driveconfig.js), so both see the files Neurite made. Google issues a secret with this
// type and says it is not treated as one: a desktop app cannot keep it, and PKCE is what protects
// the exchange. Empty until the project's owner creates the client; Sync then says it is not set
// up in this build.
module.exports = {
    clientId: '',
    clientSecret: '',
};
