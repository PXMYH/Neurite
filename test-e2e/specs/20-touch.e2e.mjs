import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
afterEach(async () => { await context?.close(); });

// A card by touch (#57): a finger on the header moves it, a finger on the grip resizes it, and
// a tap is still the click it was. Before, a touch drag on the header was taken by the browser
// as a pan and cancelled, so the card never moved; the grip was 15px for a finger; and a tap on
// a tool showed its tooltip, which on iOS holds the tap's click back for a second tap.
//
// In Chromium the fingers are real touches (CDP), which is what exercises `touch-action`. Mobile
// WebKit takes no scripted multi-point input, so there a drag is synthetic Pointer Events, and
// a tap is Playwright's own.

async function twoNotes(page) {
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\nFirst.\n\n## Beta\nSecond.\n'));
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 2, undefined, { timeout: 5000 });
    await page.evaluate(() => Hud.fitAll());
    await page.waitForTimeout(900);
}
// The card's box, a point on its header clear of the buttons, and its grip's centre.
const card = (page, title) => page.evaluate((t) => {
    const n = Object.values(Graph.nodes).find((x) => x.getTitle() === t);
    const r = n.view.div.getBoundingClientRect();
    const h = n.view.titleInput.getBoundingClientRect();
    const g = n.view.resizeHandle.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom,
        head: { x: h.left + 6, y: h.top + h.height / 2 },
        grip: { x: g.left + g.width / 2, y: g.top + g.height / 2 } };
}, title);

// One finger from `a` to `b`.
async function touchDrag(page, a, b) {
    if (!isIPad) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
        for (let k = 1; k <= 10; k++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
                touchPoints: [{ x: a.x + (b.x - a.x) * k / 10, y: a.y + (b.y - a.y) * k / 10, id: 1 }] });
            await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
        await page.evaluate(async ([a, b]) => {
            const target = document.elementFromPoint(a.x, a.y);
            const fire = (type, x, y) => target.dispatchEvent(new PointerEvent(type, {
                pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
                buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
            fire('pointerdown', a.x, a.y);
            for (let k = 1; k <= 10; k++) {
                fire('pointermove', a.x + (b.x - a.x) * k / 10, a.y + (b.y - a.y) * k / 10);
                await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 10)));
            }
            fire('pointerup', b.x, b.y);
        }, [a, b]);
    }
    await page.waitForTimeout(300);
}

test('a finger on the header drags the card with it', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const a = await card(page, 'Alpha');
    await touchDrag(page, a.head, { x: a.head.x + 120, y: a.head.y + 80 });
    const b = await card(page, 'Alpha');
    assert.ok(Math.abs(b.x - a.x - 120) <= 2 && Math.abs(b.y - a.y - 80) <= 2,
        `the card should move (120, 80) with the finger; it moved (${b.x - a.x}, ${b.y - a.y})`);
    assert.equal(await page.evaluate(() => Object.values(Graph.nodes).some((n) => n.followingMouse)), false,
        'the card is still following after the finger lifted');
});

test('a tap on the header puts the caret in the Title and moves nothing', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const a = await card(page, 'Alpha');
    await page.touchscreen.tap(a.head.x, a.head.y);
    await page.waitForTimeout(400);
    const b = await card(page, 'Alpha');
    assert.deepEqual([b.x - a.x, b.y - a.y], [0, 0]);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('title-input')), true);
});

test('a finger that starts on a header button does not drag the card', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const a = await card(page, 'Alpha');
    const btn = await page.evaluate(() => {
        const n = Object.values(Graph.nodes).find((x) => x.getTitle() === 'Alpha');
        const r = n.view.div.querySelector('#button-collapse').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await touchDrag(page, btn, { x: btn.x + 120, y: btn.y + 80 });
    const b = await card(page, 'Alpha');
    assert.deepEqual([Math.round(b.x - a.x), Math.round(b.y - a.y)], [0, 0]);
});

test('a finger on the grip resizes the card, and the grip is a finger\'s target', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    // 29px of the card's own pixels, centred on the 15px glyph, so 7px of it past the corner:
    // a finger that lands just outside the card still takes the grip.
    const grip = await page.evaluate(() => {
        const n = Object.values(Graph.nodes).find((x) => x.getTitle() === 'Alpha');
        const s = getComputedStyle(n.view.resizeHandle);
        const r = n.view.div.getBoundingClientRect();
        return { size: [s.width, s.height, s.right, s.bottom],
            outside: document.elementFromPoint(r.right + 2, r.bottom + 2) === n.view.resizeHandle };
    });
    assert.deepEqual(grip.size, ['29px', '29px', '-7px', '-7px']);
    assert.equal(grip.outside, true, 'a finger just past the card\'s corner misses the grip');
    const a = await card(page, 'Alpha');

    await touchDrag(page, a.grip, { x: a.grip.x + 60, y: a.grip.y + 40 });
    const b = await card(page, 'Alpha');
    // The card grows about its centre, so its corner follows the finger.
    assert.ok(Math.abs(b.right - a.right - 60) <= 4 && Math.abs(b.bottom - a.bottom - 40) <= 4,
        `the corner should follow the finger by (60, 40); it moved (${b.right - a.right}, ${b.bottom - a.bottom})`);
    assert.equal(await page.evaluate(() => Boolean(OverlayHelper.overlay)), false, 'the resize overlay was left up');
});

test('a tap on a tool shows no tooltip', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    const tool = await page.evaluate(() => {
        const r = Elem.byId('connectTool').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.evaluate(() => {
        window.tooltipSeen = false;
        new MutationObserver(() => {
            if (document.querySelector('.ui-tooltip-visible')) window.tooltipSeen = true;
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    });
    await page.touchscreen.tap(tool.x, tool.y);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => Elem.byId('connectTool').getAttribute('aria-pressed')), 'true',
        'the tap did not reach the tool');
    assert.equal(await page.evaluate(() => window.tooltipSeen), false, 'a tap made the tooltip visible');
});

test('a mouse still gets the tooltip', { skip: isIPad && 'the iPad has no mouse' }, async () => {
    ({ context, page } = await openNeurite(browser));
    const tool = await page.evaluate(() => {
        const r = Elem.byId('connectTool').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(tool.x, tool.y);
    await page.waitForFunction(() => document.querySelector('.ui-tooltip-visible')?.textContent.length > 0, undefined, { timeout: 2000 });
});

test('the Title is typed as it is spelled', async () => {
    // Every [[Ref]] to a Title has to spell it exactly. On a card restored from a Saved Graph
    // too, whose markup is what was saved.
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const attrs = () => page.evaluate(() => Object.values(Graph.nodes).map((n) =>
        [n.view.titleInput.getAttribute('autocorrect'), n.view.titleInput.getAttribute('autocapitalize')]));
    assert.deepEqual(await attrs(), [['off', 'off'], ['off', 'off']]);

    // Saved as a card from before this change was: without either attribute.
    await page.evaluate(() => {
        for (const n of Object.values(Graph.nodes)) {
            n.view.titleInput.removeAttribute('autocorrect');
            n.view.titleInput.removeAttribute('autocapitalize');
        }
        return App.viewGraphs.saveNow();
    });
    assert.equal((await page.evaluate(() => Elem.byId('nodes').innerHTML)).includes('autocapitalize'), false,
        'the markup about to be saved still carries the attribute, so the restore proves nothing');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.appReady === true, undefined, { timeout: 30000 });
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 2, undefined, { timeout: 15000 });
    assert.deepEqual(await attrs(), [['off', 'off'], ['off', 'off']]);
});

// An Edge by touch (#58). NodeMode was a key, so the click-click gesture needed a keyboard and
// the Edge menu a right-click. The Connect tool in the bar is the mode without the key (#50),
// and a tap arrives as the click the gesture reads, on a card's Title or its body.
const tapOn = async (page, fn, arg) => {
    const p = await page.evaluate(fn, arg);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(300);
};
const refsIn = (page) => page.evaluate(() => (window.currentActiveZettelkastenMirror.getValue().match(/\[\[[^\]]+\]\]/g) ?? []).sort());

test('the Connect tool, a tap on one note and a tap on another, is an Edge', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await page.evaluate(() => window.currentActiveZettelkastenMirror.setValue('## Alpha\nFirst.\n\n## Beta\nSecond.\n\n## Gamma\nThird.\n'));
    await page.waitForFunction(() => Object.keys(Graph.nodes).length === 3, undefined, { timeout: 5000 });
    await page.evaluate(() => Hud.fitAll());
    await page.waitForTimeout(900);
    const part = ([title, sel]) => {
        const n = Object.values(Graph.nodes).find((x) => x.getTitle() === title);
        const r = n.view.div.querySelector(sel).getBoundingClientRect();
        return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 };
    };

    await tapOn(page, () => { const r = Elem.byId('connectTool').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await tapOn(page, part, ['Alpha', '.title-input']);
    assert.equal(await page.evaluate(() => Node.prev?.getTitle()), 'Alpha', 'the tap on the Title did not arm a link');
    assert.notEqual(await page.evaluate(() => document.activeElement?.className), 'title-input',
        'the tap that armed the link also opened the keyboard on the Title');
    await tapOn(page, part, ['Beta', '.title-input']);
    assert.deepEqual(await refsIn(page), ['[[Alpha]]', '[[Beta]]']);

    // By their bodies, which are most of a card.
    await tapOn(page, part, ['Gamma', '.editable-div']);
    await tapOn(page, part, ['Alpha', '.editable-div']);
    assert.deepEqual(await refsIn(page), ['[[Alpha]]', '[[Alpha]]', '[[Beta]]', '[[Gamma]]']);
});

test('"+ link" and the chip\'s × make and cut an Edge by touch', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const onAlpha = (sel) => {
        const n = Object.values(Graph.nodes).find((x) => x.getTitle() === 'Alpha');
        const r = n.view.div.querySelector(sel).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    await tapOn(page, onAlpha, '.link-add');
    await page.waitForFunction(() => Boolean(Modal.current), undefined, { timeout: 3000 });
    await tapOn(page, () => {
        const li = [...document.querySelectorAll('.modal-content li')].find((x) => x.textContent.includes('Beta'));
        const r = li.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    assert.deepEqual(await refsIn(page), ['[[Alpha]]', '[[Beta]]']);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !Modal.current, undefined, { timeout: 3000 });
    await tapOn(page, onAlpha, '.link-chip-cut');
    await page.waitForTimeout(400);
    assert.deepEqual(await refsIn(page), []);
});

// A note by touch (#56): the Note tool makes a note that follows the pointer until a click puts
// it down. A tap sends its mousemove and its mouseup with no frame between them, so the note
// followed nowhere and landed under the tool bar.
test('a tap on the Note tool, then a tap on the fractal, puts a note there', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    const tool = await page.evaluate(() => {
        const r = document.querySelector('.panel-icon.note-icon').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.touchscreen.tap(tool.x, tool.y);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => Object.values(Graph.nodes).filter((n) => n.followingMouse).length), 1,
        'the tap on the tool made no note to place');
    await page.touchscreen.tap(400, 600);
    await page.waitForTimeout(500);
    const landed = await page.evaluate(() => Object.values(Graph.nodes).map((n) => {
        const r = n.view.div.getBoundingClientRect();
        return { following: n.followingMouse, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }));
    assert.equal(landed.length, 1);
    assert.equal(landed[0].following, 0, 'the note is still following');
    assert.ok(Math.hypot(landed[0].x - 400, landed[0].y - 600) < 3,
        `the note landed at (${Math.round(landed[0].x)}, ${Math.round(landed[0].y)}), not where the tap put it down`);
});

// The on-screen keyboard (#56). It covers the page rather than resizing it, so `dvh` does not
// move, and a Pane as tall as the window kept its last lines -- and the caret typing them --
// under the keys. The keyboard is simulated the way iOS reports it: `visualViewport.height`
// shrinks and the visual viewport sends a resize.
const keyboardUpTo = (page, height) => page.evaluate((h) => {
    if (h === null) delete visualViewport.height;
    else Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => h });
    visualViewport.dispatchEvent(new Event('resize'));
}, height);

test('the Pane, the menu and the caret stay above an on-screen keyboard', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await page.evaluate(async () => {
        window.currentActiveZettelkastenMirror.setValue(
            Array.from({ length: 40 }, (_, i) => `## Note ${i + 1}\nLine ${i + 1}.\n`).join('\n'));
        await new Promise((r) => setTimeout(r, 1500));
        Hud.openNotes();
        await new Promise((r) => setTimeout(r, 600));
        const cm = window.currentActiveZettelkastenMirror;
        cm.focus();
        cm.setCursor(cm.lastLine(), 0);
    });
    const bottoms = () => page.evaluate(() => ({
        pane: App.zetPanes.container.getBoundingClientRect().bottom,
        menu: document.querySelector('.dropdown-content').getBoundingClientRect().bottom,
        caret: window.currentActiveZettelkastenMirror.cursorCoords(null, 'window').bottom,
    }));
    const open = await bottoms();
    const keys = Math.round(open.pane - 150);   // a keyboard's top edge, 150px above the Pane's bottom
    assert.ok(open.caret > keys, 'the caret is not where the keyboard will be, so this proves nothing');

    await keyboardUpTo(page, keys);
    await page.waitForTimeout(300);
    const up = await bottoms();
    for (const [what, y] of Object.entries(up)) {
        assert.ok(y <= keys, `the ${what} ends at ${Math.round(y)}, under a keyboard whose top is at ${keys}`);
    }

    await keyboardUpTo(page, null);
    await page.waitForTimeout(300);
    assert.equal(Math.round((await bottoms()).pane), Math.round(open.pane), 'the Pane did not come back when the keyboard went');
});

test('a dialog stays above an on-screen keyboard', async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    await page.evaluate(() => {
        const n = Object.values(Graph.nodes).find((x) => x.getTitle() === 'Alpha');
        n.view.div.querySelector('.link-add').click();
    });
    await page.waitForFunction(() => Boolean(Modal.current), undefined, { timeout: 3000 });
    const open = await page.evaluate(() => document.querySelector('.modal-content').getBoundingClientRect().bottom);
    const keys = Math.round(open - 100);
    await keyboardUpTo(page, keys);
    await page.waitForTimeout(300);
    const bottom = await page.evaluate(() => document.querySelector('.modal-content').getBoundingClientRect().bottom);
    assert.ok(bottom <= keys, `the dialog ends at ${Math.round(bottom)}, under a keyboard whose top is at ${keys}`);
});
