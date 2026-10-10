// The Mac app's updater (#76), the parts with no Electron in them (desktop/update-core.cjs): which
// release is newer, which asset is installed, where the running bundle is, and the script that
// swaps the bundle once the app has quit -- run here for real, on folders in a temp dir, because a
// swap that loses the old app when the new one cannot be moved in is the failure that matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { constants as fsConstants, copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const core = require('../desktop/update-core.cjs');

test('a release is newer by number, and only a plain x.y.z counts', () => {
    assert.equal(core.isNewer('1.10.0', '1.9.9'), true, 'compared as text, 1.10 is older than 1.9');
    assert.equal(core.isNewer('v1.6.1', '1.6.0'), true);
    assert.equal(core.isNewer('2.0.0', '1.99.99'), true);
    assert.equal(core.isNewer('1.6.0', '1.6.0'), false);
    assert.equal(core.isNewer('1.5.9', '1.6.0'), false);
    assert.equal(core.isNewer('1.7.0-beta.1', '1.6.0'), false, 'a pre-release tag is not an update');
    assert.equal(core.isNewer('latest', '1.6.0'), false);
    assert.deepEqual(core.parseVersion(' v1.6.0 '), [1, 6, 0]);
});

const release = (tag, assets, extra = {}) => ({
    tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/PXMYH/Neurite/releases/tag/${tag}`,
    assets, ...extra,
});
const dmg = (version, digest = 'sha256:' + 'ab'.repeat(32)) => ({
    name: `Neurite-${version}-arm64.dmg`, size: 144670150, digest,
    browser_download_url: `https://github.com/PXMYH/Neurite/releases/download/v${version}/Neurite-${version}-arm64.dmg`,
});

test('the update is the newer release\'s DMG, with the hash GitHub took of it', () => {
    const got = core.pickUpdate(release('v1.7.0', [{ name: 'shot.png', digest: 'sha256:' + '00'.repeat(32) }, dmg('1.7.0')]), '1.6.0');
    assert.deepEqual(got, {
        version: '1.7.0',
        page: 'https://github.com/PXMYH/Neurite/releases/tag/v1.7.0',
        asset: { url: 'https://github.com/PXMYH/Neurite/releases/download/v1.7.0/Neurite-1.7.0-arm64.dmg', size: 144670150, sha256: 'ab'.repeat(32) },
    });
    assert.equal(core.pickUpdate(release('v1.6.0', [dmg('1.6.0')]), '1.6.0'), null, 'the same version');
    assert.equal(core.pickUpdate(release('v1.5.2', [dmg('1.5.2')]), '1.6.0'), null, 'an older one');
    assert.equal(core.pickUpdate(release('v1.7.0', [dmg('1.7.0')], { draft: true }), '1.6.0'), null);
    assert.equal(core.pickUpdate(release('v1.7.0', [dmg('1.7.0')], { prerelease: true }), '1.6.0'), null);
    assert.equal(core.pickUpdate(null, '1.6.0'), null);
});

test('a newer release with nothing to check a download against is offered as a page, never installed', () => {
    assert.equal(core.pickUpdate(release('v1.7.0', [dmg('1.6.0')]), '1.6.0').asset, null, 'another version\'s DMG');
    assert.equal(core.pickUpdate(release('v1.7.0', []), '1.6.0').asset, null);
    assert.equal(core.pickUpdate(release('v1.7.0', [dmg('1.7.0', null)]), '1.6.0').asset.sha256, null, 'no digest');
    assert.equal(core.pickUpdate(release('v1.7.0', [dmg('1.7.0', 'md5:abc')]), '1.6.0').asset.sha256, null);
});

test('the bundle is found from the executable, and a translocated copy is named as one', () => {
    assert.equal(core.bundleOf('/Applications/Neurite.app/Contents/MacOS/Neurite'), '/Applications/Neurite.app');
    assert.equal(core.bundleOf('/Users/a/My Apps/Neurite 2.app/Contents/MacOS/Neurite'), '/Users/a/My Apps/Neurite 2.app');
    assert.equal(core.bundleOf('/opt/homebrew/bin/electron'), null);
    assert.equal(core.placeProblem(null), 'not-bundled');
    assert.equal(core.placeProblem('/private/var/folders/x/T/AppTranslocation/1234/d/Neurite.app'), 'translocated');
    assert.equal(core.placeProblem('/Applications/Neurite.app'), null);
    assert.equal(core.stagedName('Neurite.app', '1.7.0'), '.Neurite-1.7.0-update.app');
    // A profile inside the bundle would be moved aside with the old app and deleted with it.
    assert.equal(core.profileInside('/Applications/Neurite.app/profile', '/Applications/Neurite.app'), true);
    assert.equal(core.profileInside('/Users/a/Library/Application Support/Neurite', '/Applications/Neurite.app'), false);
    assert.equal(core.profileInside('/Applications/Neurite.app.profile', '/Applications/Neurite.app'), false);
});

// The stages cleared at launch are this bundle's own and nothing else (an adversarial review:
// any `.x-1.2.3-update.app` beside it went, another app's included, and a bundle renamed to
// that shape would have deleted itself).
test('only this bundle\'s own stages are taken for stages', () => {
    assert.equal(core.isStagedFor('.Neurite-1.7.0-update.app', 'Neurite.app'), true);
    assert.equal(core.isStagedFor('.Neurite 2-1.7.0-update.app', 'Neurite 2.app'), true);
    assert.equal(core.isStagedFor('.Unrelated-2.3.4-update.app', 'Neurite.app'), false);
    assert.equal(core.isStagedFor('.Neurite-1.7.0-update.app', '.Neurite-1.7.0-update.app'), false, 'the running bundle');
    assert.equal(core.isStagedFor('Neurite.app', 'Neurite.app'), false);
    assert.equal(core.isStagedFor('.Neurite-latest-update.app', 'Neurite.app'), false);
});

// A folder standing for each bundle, with a file saying which version it is; the marker the
// app leaves; and an opener standing for /usr/bin/open, which writes down what it was asked to
// open and, when the new copy "starts", removes the marker as the real one does.
function bundles() {
    const dir = mkdtempSync(path.join(tmpdir(), 'neurite-swap-'));
    const apps = path.join(dir, 'Applications');
    mkdirSync(apps);
    const app = path.join(apps, 'Neurite.app');
    const staged = path.join(apps, core.stagedName('Neurite.app', '1.7.0'));
    mkdirSync(app);
    writeFileSync(path.join(app, 'version'), '1.6.0');
    mkdirSync(staged);
    writeFileSync(path.join(staged, 'version'), '1.7.0');
    const marker = path.join(dir, 'update-pending.json');
    writeFileSync(marker, '{"version":"1.7.0","from":"1.6.0"}');
    const opener = path.join(dir, 'open');
    writeFileSync(opener, '#!/bin/sh\necho "$@" >> "$OPENED"\nif [ "$STARTS" = 1 ]; then /bin/cat "$2/version" >> "$OPENED"; /bin/rm -f "$MARKER"; fi\n', { mode: 0o755 });
    return { dir, apps, app, staged, marker, opener, log: path.join(dir, 'update.log'), opened: path.join(dir, 'opened') };
}
const exited = () => spawnSync('/usr/bin/true').pid;
const swapArgs = (b, pid) => ['-c', core.SWAP_SCRIPT, 'neurite-update', String(pid), b.app, b.staged, b.marker, b.log,
                              'Neurite', b.opener, '--user-data-dir=/tmp/x y'];
const swapEnv = (b, starts) => ({ ...process.env, PATH: '/usr/bin', OPENED: b.opened, MARKER: b.marker, STARTS: starts ? '1' : '0',
                                  NEURITE_SWAP_START_TICKS: '10' });
const swap = (b, { pid = exited(), starts = true } = {}) => spawnSync('/bin/sh', swapArgs(b, pid), { env: swapEnv(b, starts) });
const text = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

test('the swap puts the new bundle where the old one was, opens it, and leaves nothing beside it', () => {
    const b = bundles();
    try {
        assert.equal(swap(b).status, 0);
        assert.equal(readFileSync(path.join(b.app, 'version'), 'utf8'), '1.7.0');
        assert.deepEqual(readdirSync(b.apps), ['Neurite.app']);
        // With the profile it ran with, and the new version is what opened. PATH is /usr/bin,
        // as an app's can be: the script names its tools.
        assert.equal(text(b.opened), `-n ${b.app} --args --user-data-dir=/tmp/x y\n1.7.0`);
        assert.match(text(b.log), /updated\n$/);
    } finally { rmSync(b.dir, { recursive: true, force: true }) }
});

// The app took the update back -- its last save failed, or its quit was cancelled -- and removed
// the stage; the quit the script then sees is the reader's own, whenever it comes.
test('a stage that is gone when the app has quit is an update called off, and nothing is touched', () => {
    const b = bundles();
    try {
        rmSync(b.staged, { recursive: true });
        assert.equal(swap(b).status, 0);
        assert.equal(readFileSync(path.join(b.app, 'version'), 'utf8'), '1.6.0');
        assert.deepEqual(readdirSync(b.apps), ['Neurite.app']);
        assert.equal(text(b.opened), '', 'it opened an app the reader had just quit');
        assert.match(text(b.log), /the update was called off; nothing was changed/);
    } finally { rmSync(b.dir, { recursive: true, force: true }) }
});

// An adversarial review: the old bundle was deleted before the new one had shown it could start,
// so a release that hashed right and would not open left nothing that would.
test('a new bundle that does not start is taken out, and the old one put back and opened', () => {
    const b = bundles();
    try {
        assert.equal(swap(b, { starts: false }).status, 1);
        assert.equal(readFileSync(path.join(b.app, 'version'), 'utf8'), '1.6.0');
        assert.equal(readFileSync(path.join(b.staged, 'version'), 'utf8'), '1.7.0', 'the new one is left as a stage, to be cleared');
        assert.equal(text(b.opened).match(/^-n /gm).length, 2, 'opened the new copy, then the old one');
        assert.ok(existsSync(b.marker), 'the old copy needs the marker to say the update did not install');
        assert.match(text(b.log), /the new app did not start within a minute; the old one is back/);
    } finally { rmSync(b.dir, { recursive: true, force: true }) }
});

// A second review: the way back said "the old one is back" before either rename and reopened
// whatever was at the bundle's path -- the copy that would not start, if the folder had become
// read-only in the meantime.
test('a way back that cannot be taken says where the old bundle is, and reopens nothing', () => {
    const b = bundles();
    try {
        // The opener stands for the new copy: it does not start, and the folder goes read-only.
        writeFileSync(b.opener, `#!/bin/sh\necho "$@" >> "$OPENED"\n/bin/chmod 0555 "${b.apps}"\n`, { mode: 0o755 });
        assert.equal(swap(b, { starts: false }).status, 1);
        assert.equal(readFileSync(path.join(b.app, 'version'), 'utf8'), '1.7.0', 'the new copy is still in place');
        assert.equal(text(b.opened).match(/^-n /gm).length, 1, 'the copy that would not start was opened again');
        assert.match(text(b.log), /could not be moved aside: the old one is at .*Neurite\.app\.replaced-\d+\n$/);
    } finally {
        spawnSync('/bin/chmod', ['0755', b.apps]);
        rmSync(b.dir, { recursive: true, force: true });
    }
});

// A third review: one TERM and a second's wait, and a copy that ignored the TERM kept the
// profile's single-instance lock, so the old copy opened beside it quit at once. The stand-in for
// the stuck app is a clone of node at the bundle's executable path, deaf to TERM.
test('a new copy that ignores TERM is killed before the old one is opened', () => {
    const b = bundles();
    try {
        const macos = path.join(b.staged, 'Contents', 'MacOS');
        mkdirSync(macos, { recursive: true });
        copyFileSync(process.execPath, path.join(macos, 'Neurite'), fsConstants.COPYFILE_FICLONE);
        writeFileSync(b.opener, '#!/bin/sh\necho "$@" >> "$OPENED"\n'
            + `"$2/Contents/MacOS/Neurite" -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)" > /dev/null 2>&1 &\n`,
            { mode: 0o755 });
        const started = Date.now();
        assert.equal(swap(b, { starts: false }).status, 1);
        assert.ok(Date.now() - started < 15000, 'the kill did not come');
        const left = spawnSync('/bin/ps', ['-axo', 'comm=']).stdout.toString().split('\n')
            .filter((c) => c === path.join(b.app, 'Contents', 'MacOS', 'Neurite') || c === path.join(b.staged, 'Contents', 'MacOS', 'Neurite'));
        assert.deepEqual(left, [], 'the stuck copy is still running');
        assert.equal(readFileSync(path.join(b.app, 'version'), 'utf8'), '1.6.0');
        assert.match(text(b.log), /the old one is back/);
    } finally { rmSync(b.dir, { recursive: true, force: true }) }
});

test('the swap waits for the app to quit before it touches the bundle', async () => {
    const b = bundles();
    const running = spawn('/bin/sleep', ['1']);
    try {
        const script = spawn('/bin/sh', swapArgs(b, running.pid), { env: swapEnv(b, true) });
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.equal(readFileSync(path.join(b.app, 'version'), 'utf8'), '1.6.0', 'swapped while the app still ran');
        assert.ok(existsSync(b.staged));
        await new Promise((resolve) => script.on('exit', resolve));
        assert.equal(readFileSync(path.join(b.app, 'version'), 'utf8'), '1.7.0');
    } finally {
        running.kill();
        rmSync(b.dir, { recursive: true, force: true });
    }
});
