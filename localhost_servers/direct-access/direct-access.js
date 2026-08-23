// The DirectAccess server: the file tree in the browser reads the real filesystem
// through these two endpoints.
//
// Both are confined to one root. `file-access.js` owns that decision -- see the
// note at the top of it for why the request path is read as relative to the root
// and why containment is decided after `realpath`. Set DIRECTACCESS_ROOT to
// choose the folder; the default is the home directory.

const express = require('express');
const { createFileAccess } = require('./file-access');

const app = express();
const fileAccess = createFileAccess();

// Said out loud at startup, because "the file tree shows the wrong folder" is
// otherwise indistinguishable from "the file tree is broken".
console.log(`DirectAccess is confined to ${fileAccess.root} (set DIRECTACCESS_ROOT to change it)`);

// API to navigate directories and get file structure
app.get('/navigate', fileAccess.navigate);

// API to stream file content (supports both text and binary files)
app.get('/read-file', fileAccess.readFile);

module.exports = app;
