import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

test('app signals ready and exposes its core globals', async () => {
    const shape = await page.evaluate(() => ({
        ready: window.appReady === true,
        hasGraph: typeof Graph !== 'undefined',
        hasApp: typeof App !== 'undefined',
        hasNodeView: typeof NodeView !== 'undefined',
        nodesIsObject: typeof Graph === 'object' || (typeof Graph !== 'undefined' && typeof Graph.nodes === 'object'),
    }));
    assert.equal(shape.ready, true, 'appReady is true');
    assert.equal(shape.hasGraph, true, 'Graph global exists');
    assert.equal(shape.hasApp, true, 'App global exists');
    assert.equal(shape.hasNodeView, true, 'NodeView global exists');

    const nodesType = await page.evaluate(() => typeof Graph.nodes);
    assert.equal(nodesType, 'object', 'Graph.nodes is the node map');
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
