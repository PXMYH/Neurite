// The parts of the Mac app's updater (#76) that need no Electron, so the root `npm test` can run
// them: which release is newer, which of its assets is the app, where the running bundle is and
// whether anything in its path rules out replacing it, and the script that swaps it once the app
// has quit. `updater.cjs` does the rest.
//
// Not Squirrel.Mac -- Electron's `autoUpdater`, and electron-updater on a Mac -- because it takes
// an update only if the new bundle satisfies the running one's designated requirement, and an
// ad-hoc signature's requirement is its own cdhash (`codesign -d -r-` on 1.6.0: `designated =>
// cdhash H"51558a7a..."`), which no other build can satisfy.
'use strict';

const RELEASES = 'https://api.github.com/repos/PXMYH/Neurite/releases/latest';

// "v1.6.0" or "1.6.0" -> [1, 6, 0]; anything else, a pre-release suffix included, -> null.
function parseVersion(text) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? '').trim());
    return m ? m.slice(1).map(Number) : null;
}

// By number, not by text: "1.10.0" is newer than "1.9.9".
function isNewer(candidate, current) {
    const a = parseVersion(candidate);
    const b = parseVersion(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
}

// What a release from the feed offers this copy: null when it is not newer, else its version,
// its page, and the DMG with the hash GitHub took when it was uploaded (`digest`). The asset is
// null when the release has no DMG for this app, and its `sha256` null when GitHub gave no
// digest: either way there is nothing to check a download against, so it is offered as a page
// to visit rather than installed.
function pickUpdate(release, current) {
    if (!release || release.draft || release.prerelease) return null;
    const parts = parseVersion(release.tag_name);
    if (!parts) return null;
    const version = parts.join('.');
    if (!isNewer(version, current)) return null;

    const name = `Neurite-${version}-arm64.dmg`;
    const asset = (release.assets ?? []).find((a) => a.name === name);
    const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset?.digest ?? '')?.[1] ?? null;
    return {
        version,
        page: release.html_url,
        asset: asset ? { url: asset.browser_download_url, size: asset.size, sha256 } : null,
    };
}

// The bundle the running executable sits in: `<bundle>.app/Contents/MacOS/<name>`.
function bundleOf(exePath) {
    const m = /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath ?? '');
    return m ? m[1] : null;
}

// A profile kept inside the bundle (`--user-data-dir=<bundle>/...`) goes wherever the bundle
// goes: the swap would move it aside with the old app and delete it with it.
function profileInside(userData, bundle) {
    return Boolean(bundle && userData && (userData === bundle || userData.startsWith(bundle + '/')));
}

// What in the bundle's path rules out replacing it, or null. A quarantined app opened where it
// was downloaded runs from a random read-only mount (App Translocation), and a copy run from a
// checkout has no bundle at all. A disk image or a folder the user cannot write to shows only
// when it is tried, so `updater.cjs` asks the file system about those.
function placeProblem(bundle) {
    if (!bundle) return 'not-bundled';
    if (bundle.includes('/AppTranslocation/')) return 'translocated';
    return null;
}

// Run as `/bin/sh -c SWAP_SCRIPT neurite-update <pid> <bundle> <staged> <marker> <started>
// <version> <log> <exe> <opener> [args...]`, detached, by the app just before it quits. It waits up to a minute for
// that process to end, moves the old bundle aside and the new one in -- or the old one back, if
// that fails -- and opens whichever is in place with the arguments the app ran with. `<opener>`
// is /usr/bin/open, and `-n` because macOS would otherwise bring forward any running copy with
// the same bundle id rather than open this one. A marker or a stage that is gone by then means the
// app took the update back -- its quit failed or was cancelled -- and a later quit, the reader's
// own, is not the update's: nothing is touched. The marker goes first, being one unlink.
//
// The old bundle is kept until the new one has started: the new copy writes its version to
// `<started>` once its page is up and its graph back (`updater.cjs`, `confirmStarted`) -- the
// marker going was the signal once, and an older copy opened on the same profile took it away
// too. One that has not within a minute -- it
// crashed, hung, or its page never came up -- is stopped (TERM, then KILL three seconds on: it
// holds the profile's single-instance lock, and the old copy opened beside it would quit at
// once) and the old bundle put back and opened,
// which then reads the marker and says the update did not install. A release that hashes right
// and will not start costs a minute or two, not the app; a rename that fails on the way back is
// said in the log, with where the old bundle is, and never reopens the copy that would not
// start. Every tool is named by its path: started from an app, PATH is whatever launchd gave
// it, and a `sleep` not found turned the minute's wait into 0.4 seconds. The tests shorten the
// minute with NEURITE_SWAP_START_TICKS (tenths of a second).
const SWAP_SCRIPT = `
pid=$1; app=$2; staged=$3; marker=$4; started=$5; version=$6; log=$7; exe=$8; opener=$9
shift 9
say() { printf '%s %s\\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$log"; }
reopen() { if [ -d "$app" ]; then "$opener" -n "$app" --args "$@"; fi; }
i=0
while kill -0 "$pid" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 600 ]; then say "Neurite did not quit within a minute; nothing was changed"; exit 1; fi
    /bin/sleep 0.1
done
if [ ! -e "$marker" ] || [ ! -d "$staged" ]; then say "the update was called off; nothing was changed"; exit 0; fi
old="$app.replaced-$$"
if ! /bin/mv "$app" "$old"; then
    say "the installed app could not be moved aside; nothing was changed"
    reopen "$@"
    exit 1
fi
if ! /bin/mv "$staged" "$app"; then
    if /bin/mv "$old" "$app"; then
        say "the new app could not be moved in; the old one is back"
        reopen "$@"
    else
        say "the new app could not be moved in, and the old one could not be put back: it is at $old"
    fi
    exit 1
fi
reopen "$@"
i=0
while [ "$(/bin/cat "$started" 2>/dev/null)" != "$version" ]; do
    i=$((i + 1))
    if [ "$i" -gt "\${NEURITE_SWAP_START_TICKS:-600}" ]; then
        /bin/ps -axo pid=,comm= | while read -r p c; do
            if [ "$c" = "$app/Contents/MacOS/$exe" ]; then
                kill "$p" 2>/dev/null
                j=0
                while kill -0 "$p" 2>/dev/null && [ "$j" -lt 30 ]; do j=$((j + 1)); /bin/sleep 0.1; done
                kill -9 "$p" 2>/dev/null
            fi
        done
        if ! /bin/mv "$app" "$staged"; then
            say "the new app did not start within a minute, and could not be moved aside: the old one is at $old"
        elif ! /bin/mv "$old" "$app"; then
            say "the new app did not start within a minute, and the old one could not be put back: it is at $old"
        else
            say "the new app did not start within a minute; the old one is back"
            reopen "$@"
        fi
        exit 1
    fi
    /bin/sleep 0.1
done
/bin/rm -rf "$old"
/bin/rm -f "$started"
say "updated"
`;

// The copy staged beside the bundle until the swap, named after that bundle so Finder hides it
// and nothing but this app's own stages is ever taken for one -- not another app's, and not the
// running bundle, whatever it is called.
const stagedName = (bundleName, version) => `.${bundleName.replace(/\.app$/, '')}-${version}-update.app`;
// The old bundle the swap moved aside, left there if the swap was stopped half way (a reboot):
// the copy that starts cleanly clears it.
function isReplacedFor(name, bundleName) {
    return name.startsWith(`${bundleName}.replaced-`) && /^\d+$/.test(name.slice(bundleName.length + '.replaced-'.length));
}

function isStagedFor(name, bundleName) {
    const base = bundleName.replace(/\.app$/, '');
    if (name === bundleName || !name.startsWith(`.${base}-`)) return false;
    return /^\d+\.\d+\.\d+-update\.app$/.test(name.slice(base.length + 2));
}

// What a copy opened after an update says about it. The app wrote down the version it went for
// before it quit, so the copy that opens next either is that version or the swap did not happen.
function afterUpdate(marker, current) {
    if (!marker?.version) return null;
    return (marker.version === current)
        ? { phase: 'updated', from: marker.from }
        : { phase: 'failed', error: `${marker.version} did not install. Neurite ${current} is unchanged.` };
}

module.exports = {
    RELEASES, parseVersion, isNewer, pickUpdate, bundleOf, placeProblem, profileInside, SWAP_SCRIPT, stagedName,
    isStagedFor, isReplacedFor, afterUpdate,
};
