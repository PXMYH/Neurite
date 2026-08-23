direct-access.js

This Server uses node.js and fs to enable a basic filetree system within Neurite.

Confinement
-----------

Both endpoints (/navigate and /read-file) only ever read inside one root
directory:

    DIRECTACCESS_ROOT=/path/to/folder npm run start    # from localhost_servers/

With DIRECTACCESS_ROOT unset the root is the home directory. The server prints
the root it is using when it starts.

A request path is read as a location *under* the root, so "/" is the root rather
than the disk's root, and the file tree's own paths ("/", then "/Documents", ...)
keep working unchanged. Anything that resolves outside the root -- "..", a
percent-encoded "..", an absolute path from before this change, a symlink inside
the root that points out of it -- is answered with 403 and nothing else. A saved
File Tree Node holding an absolute path from an older version will therefore fail
to load until its path is re-entered relative to the root.

Refusals say only that the request was refused; the reason goes to the server's
log, not to the browser.
