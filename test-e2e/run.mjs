// Runner for the browser eval suite. There is no test-runner dependency here on
// purpose (see CLAUDE.md: "node --test and nothing else"), so this file owns the
// one thing `node --test` will not do for a browser test -- stand a server up
// before the tests and take it down after -- and then hands off to `node --test`.
//
// It serves the *worktree's own* copy on a scratch port, never the reader's 8999
// dev server, so running the evals cannot reload the page someone is using. The
// port is strict: if it is taken, Vite exits and this fails loudly rather than
// photographing whatever else is on that port.
//
// Specs are named `*.e2e.mjs`, not `*.test.js`, so a bare `npm test` (which
// auto-discovers `**/*.test.js`) never launches a browser. They run only through
// here, one at a time -- headless Chromium is heavy and serial is the reliable
// default for an eval you want to trust.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);                       // the worktree/checkout root
const port = Number(process.env.NEURITE_E2E_PORT) || 9123;
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}/`;
const viteBin = join(root, 'node_modules', '.bin', 'vite');

const specDir = join(here, 'specs');
const specs = readdirSync(specDir)
    .filter(f => f.endsWith('.e2e.mjs'))
    .sort()
    .map(f => join(specDir, f));

if (specs.length === 0) {
    console.error('No specs found in test-e2e/specs/*.e2e.mjs');
    process.exit(1);
}

let viteOutput = '';
function startVite() {
    const vite = spawn(viteBin, ['--port', String(port), '--strictPort', '--host', host], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const capture = (d) => { viteOutput += d.toString(); };
    vite.stdout.on('data', capture);
    vite.stderr.on('data', capture);
    return vite;
}

async function waitForServer(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return true;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

const vite = startVite();
let viteDown = false;
vite.on('exit', () => { viteDown = true; });

function stopVite() {
    if (!vite.killed) vite.kill('SIGTERM');
}
process.on('SIGINT', () => { stopVite(); process.exit(130); });
process.on('SIGTERM', () => { stopVite(); process.exit(143); });

console.log(`[e2e] starting Vite on ${baseUrl}`);
const ready = await waitForServer();
if (!ready || viteDown) {
    stopVite();
    console.error(`[e2e] server never came up on ${baseUrl} (port taken, or Vite failed to start).`);
    console.error(viteOutput.trim() || '(no Vite output)');
    process.exit(1);
}
console.log(`[e2e] server up; running ${specs.length} spec file(s) serially`);

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...specs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NEURITE_E2E_URL: baseUrl },
});

child.on('exit', (code, signal) => {
    stopVite();
    process.exit(signal ? 1 : (code ?? 1));
});
