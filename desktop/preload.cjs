// The page's one way into the main process: the app's own updates (#76, updater.cjs). Nothing
// else crosses -- no `electronAPI`, no `startedViaElectron` -- so link nodes and the rest of the
// page still run as they do in a browser tab, and in a browser tab `neuriteDesktop` is absent.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neuriteDesktop', {
    update: {
        state: () => ipcRenderer.invoke('update:state'),
        check: () => ipcRenderer.invoke('update:check'),
        install: (choice) => ipcRenderer.invoke('update:install', choice),
        onState: (callback) => { ipcRenderer.on('update:state', (_, state) => callback(state)) },
    },
});
