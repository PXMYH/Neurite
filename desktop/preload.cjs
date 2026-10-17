// The page's ways into the main process: the app's own updates (#76, updater.cjs) and its Google
// Drive sign-in (drive-auth.cjs), which hands the page access tokens and keeps the rest. Nothing
// else crosses -- no `electronAPI`, no `startedViaElectron` -- so link nodes and the rest of the
// page still run as they do in a browser tab, and in a browser tab `neuriteDesktop` is absent.
const { contextBridge, ipcRenderer } = require('electron');

// An update this copy is, not yet confirmed (updater.cjs): its page saves nothing until it is,
// so a copy the update will take back cannot write over the graph the old copy kept. Asked of the
// main process at each load, a reload's too: the window's flag is the one it opened with.
let probation = process.argv.includes('--neurite-update-probation')
    && ipcRenderer.sendSync('update:probation') === true;
ipcRenderer.on('update:state', (_, state) => {
    if (state?.confirmed) probation = false;
});

contextBridge.exposeInMainWorld('neuriteDesktop', {
    update: {
        onProbation: () => probation,
        state: () => ipcRenderer.invoke('update:state'),
        check: () => ipcRenderer.invoke('update:check'),
        install: (choice) => ipcRenderer.invoke('update:install', choice),
        onState: (callback) => { ipcRenderer.on('update:state', (_, state) => callback(state)) },
    },
    drive: {
        status: () => ipcRenderer.invoke('drive:status'),
        connect: () => ipcRenderer.invoke('drive:connect'),
        disconnect: () => ipcRenderer.invoke('drive:disconnect'),
        accessToken: (options) => ipcRenderer.invoke('drive:token', options),
    },
});
