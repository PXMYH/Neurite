import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const bootstrapScript = path.join(projectRoot, 'scripts', 'ensure-worktree-node-modules.js');

function git(cwd, ...args) {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepository({ dependencies = true } = {}) {
    const root = mkdtempSync(path.join(tmpdir(), 'neurite-worktree-start-'));
    const linked = path.join(root, 'linked');

    git(root, 'init', '--initial-branch=main');
    writeFileSync(path.join(root, 'tracked.txt'), 'seed\n');
    git(root, 'add', 'tracked.txt');
    git(root, '-c', 'user.name=Neurite Test', '-c', 'user.email=test@example.com',
        'commit', '-m', 'seed');

    if (dependencies) {
        const bin = path.join(root, 'node_modules', '.bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(path.join(bin, process.platform === 'win32' ? 'vite.cmd' : 'vite'), '');
    }
    git(root, 'worktree', 'add', '-b', 'test-worktree', linked, 'main');

    return { linked, root };
}

test('the start lifecycle bootstraps linked-checkout dependencies', () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts.prestart, 'node scripts/ensure-worktree-node-modules.js');
    assert.equal(packageJson.scripts['prestart:host'], 'node scripts/ensure-worktree-node-modules.js');
});

test('the shared dependency link stays out of Git status', () => {
    const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf8').split(/\r?\n/);
    assert.ok(gitignore.includes('node_modules'));
});

test('a linked checkout shares the primary checkout dependencies', (t) => {
    const { linked, root } = makeRepository();
    t.after(() => rmSync(root, { force: true, recursive: true }));

    const result = spawnSync(process.execPath, [bootstrapScript], {
        cwd: linked,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
        realpathSync(path.join(linked, 'node_modules')),
        realpathSync(path.join(root, 'node_modules'))
    );
});

test('a primary checkout without dependencies gives an actionable error', (t) => {
    const { root } = makeRepository({ dependencies: false });
    t.after(() => rmSync(root, { force: true, recursive: true }));

    const result = spawnSync(process.execPath, [bootstrapScript], {
        cwd: root,
        encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Run npm install in the primary checkout/);
});
