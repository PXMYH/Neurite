// One unreadable card must cost that card, not the graph.
//
// `#loadGraph` builds every saved card in two unguarded loops, so anything that threw for
// one of them came out of the loop and abandoned every card after it. The case that found
// this was markup saved without its `.window` div: `Node.Extensions.window` set
// `view.div` from a `querySelector` that missed, `initCollapsed` then read
// `this.div.classList`, and the TypeError travelled out of `new Node` and emptied the
// graph. A graph is the reader's work; losing the rest of it to one bad note is the worst
// outcome available.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p)=> readFileSync(new URL(p, root), 'utf8');

const nodeclass = read('js/nodes/nodeclass.js');
const savenet = read('js/interface/dropdown/savenet.js');

test('a card with no window markup is left flat instead of throwing', ()=>{
    const ext = nodeclass.match(/"window": \(node, a\)=>\{[\s\S]*?\n {4}\},/);
    assert.ok(ext, 'the `window` extension is gone or was reshaped');

    // The guard has to sit after `view.div` is read and before anything uses it.
    const iRead = ext[0].indexOf("view.div = odiv.querySelector('.window')");
    const iGuard = ext[0].indexOf('if (!view.div)');
    const iUse = ext[0].indexOf('view.rewindowify()');
    assert.ok(iRead > -1, 'view.div is no longer read from the markup');
    assert.ok(iGuard > iRead, 'nothing checks whether the window markup was found');
    assert.ok(iUse > iGuard,
        'rewindowify runs before the guard, so a card with no window still throws');

    assert.match(ext[0], /Logger\.warn/,
        'the card is skipped silently, so a flat card looks like a rendering bug rather '
        + 'than a damaged save');
});

test('neither load loop can lose the cards after a bad one', ()=>{
    const fn = savenet.match(/const skipped = \[\][\s\S]*?skipped\.length > 0[\s\S]*?\}/);
    assert.ok(fn, 'the per-card containment in #loadGraph is gone');

    // Both loops. The first builds Nodes, the second initialises them, and either can
    // throw for a single card.
    const builds = savenet.match(/for \(const child of div\.children\) \{([\s\S]*?)\n {8}\}/);
    assert.ok(builds, 'the build loop was reshaped');
    assert.match(builds[1], /try \{[\s\S]*?catch/,
        'the loop that calls `new Node` is unguarded again, so one unreadable card '
        + 'abandons every card after it');

    const inits = savenet.match(/for \(const node of newNodes\) \{([\s\S]*?)\n {8}\}/);
    assert.ok(inits, 'the init loop was reshaped');
    assert.match(inits[1], /try \{[\s\S]*?catch/,
        'the loop that calls `node.init()` is unguarded again');

    // Counted, not swallowed. A graph quieter than the one that was saved has to say so.
    assert.match(savenet, /skipped\.length, "of", div\.children\.length/,
        'the number of cards that failed is no longer reported, so a graph can come back '
        + 'smaller than it was saved with nothing to say it did');
});
