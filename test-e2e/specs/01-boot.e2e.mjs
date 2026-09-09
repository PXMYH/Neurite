import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

test('app signals ready and exposes its core globals', async () => {
    const shape = await page.evaluate(() => ({
        ready: window.appReady === true,
        hasGraph: typeof Graph !== 'undefined',
        hasApp: typeof App !== 'undefined',
        hasNodeView: typeof NodeView !== 'undefined',
        nodesType: typeof Graph.nodes,
    }));
    assert.equal(shape.ready, true, 'appReady is true');
    assert.equal(shape.hasGraph, true, 'Graph global exists');
    assert.equal(shape.hasApp, true, 'App global exists');
    assert.equal(shape.hasNodeView, true, 'NodeView global exists');
    assert.equal(shape.nodesType, 'object', 'Graph.nodes is the node map');
});

// The load path is ~80 plain <script src> files in a hand-ordered array
// (PageLoad.scripts), so a file listed in the wrong position throws at load time
// while the rest of the sequence carries on -- appReady can still flip true over a
// half-initialised app. An uncaught exception is the signal that catches it, and
// there are none in a healthy boot.
test('boot raises no uncaught exceptions', async () => {
    // Wait for the render loop's first output rather than sleeping blind, then
    // give the tail of the boot a moment to throw if it is going to.
    await page.waitForFunction(
        () => document.querySelectorAll('#svg_bg #bg path').length > 0,
        undefined,
        { timeout: 10000 }
    );
    await page.waitForTimeout(500);
    assert.deepEqual(errors, [], `uncaught page errors during boot:\n${errors.join('\n')}`);
});

test('the fractal renders as SVG paths', async () => {
    // The renderer draws into svg#svg_bg > g#bg as <path> hairs, not a <canvas>.
    // A count > 0 proves the render loop ran; 0 would mean a dead renderer.
    await page.waitForFunction(
        () => document.querySelectorAll('#svg_bg #bg path').length > 0,
        undefined,
        { timeout: 10000 }
    );
    const paths = await page.evaluate(() => document.querySelectorAll('#svg_bg #bg path').length);
    assert.ok(paths > 0, `expected fractal paths, got ${paths}`);
});
