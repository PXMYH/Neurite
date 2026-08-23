import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, symlinkSync } from 'node:fs';
import path from 'node:path';

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

function git(...args) {
    try {
        return execFileSync('git', args, {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
    } catch {
        fail('Unable to locate this Git checkout. Run npm start from the repository.');
    }
}

function hasPathEntry(candidate) {
    try {
        lstatSync(candidate);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function hasVite(nodeModules) {
    const bin = path.join(nodeModules, '.bin');
    return existsSync(path.join(bin, 'vite')) || existsSync(path.join(bin, 'vite.cmd'));
}

const checkoutRoot = path.resolve(git('rev-parse', '--show-toplevel').trim());
const nodeModules = path.join(checkoutRoot, 'node_modules');

if (hasVite(nodeModules)) process.exit(0);

if (hasPathEntry(nodeModules)) {
    fail(`Dependencies at ${nodeModules} are incomplete. Run npm install in this checkout.`);
}

const worktrees = git('worktree', 'list', '--porcelain', '-z');
const firstField = worktrees.split('\0', 1)[0];
const primaryRoot = path.resolve(firstField.slice('worktree '.length));
const primaryNodeModules = path.join(primaryRoot, 'node_modules');

if (primaryRoot === checkoutRoot || !hasVite(primaryNodeModules)) {
    fail(`Run npm install in the primary checkout (${primaryRoot}), then run npm start again.`);
}

symlinkSync(
    primaryNodeModules,
    nodeModules,
    process.platform === 'win32' ? 'junction' : 'dir'
);
process.stdout.write(`Using dependencies from the primary checkout at ${primaryRoot}.\n`);
