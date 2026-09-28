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

// Two fingers, as a review drove them (rv14). Real touches need Chromium; WebKit gets the
// gesture-event checks, which are synthetic in both.
const cdpTouch = async (page, type, points) => {
    const cdp = page.cdp ??= await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) });
};
const viewNow = (page) => page.evaluate(() => ({ mag: Graph.zoom.mag(), arg: Math.atan2(Graph.zoom.y, Graph.zoom.x), pan: [Graph.pan.x, Graph.pan.y] }));
// A point on one of the Fractal's lines (a <path>, which the renderer removes as it redraws),
// with bare Fractal where a drag from it goes. The lines come and go, so asked for a while.
const bareFractal = (page) => page.evaluate(async () => {
    for (let tries = 0; tries < 25; tries++) {
        for (let y = 150; y < innerHeight - 150; y += 7) {
            for (let x = 150; x < innerWidth - 250; x += 7) {
                const el = document.elementFromPoint(x, y);
                if (el?.closest('#svg_bg') && el.tagName !== 'svg' && document.elementFromPoint(x + 80, y + 40)?.closest('#svg_bg')) return { x, y };
            }
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    return null;
});
// A point of bare Fractal, a line or not, with room around it.
const openFractal = (page) => page.evaluate(() => {
    const bare = (x, y) => document.elementFromPoint(x, y)?.closest('#svg_bg');
    for (let y = 150; y < innerHeight - 150; y += 13) {
        for (let x = 150; x < innerWidth - 150; x += 13) {
            if (bare(x, y) && bare(x - 70, y) && bare(x + 70, y) && bare(x + 70, y + 40)) return { x, y };
        }
    }
    return null;
});

test('a finger whose line of the Fractal is redrawn away still lifts', { skip: isIPad && 'needs real touches' }, async () => {
    // The finger was captured to the line it landed on; the renderer removed the line, the lift
    // went elsewhere, the finger stayed down, and the next one-finger drag zoomed and turned.
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const at = await bareFractal(page);
    assert.ok(at, 'no bare line of the Fractal to land on');
    await cdpTouch(page, 'touchStart', [[at.x, at.y]]);
    await page.evaluate(([x, y]) => document.elementFromPoint(x, y).remove(), [at.x, at.y]);
    await cdpTouch(page, 'touchEnd', []);
    assert.equal(await page.evaluate(() => TouchOnPlane.points.size), 0, 'the lifted finger is still down');

    const v0 = await viewNow(page);
    await cdpTouch(page, 'touchStart', [[at.x, at.y]]);
    for (let k = 1; k <= 8; k++) await cdpTouch(page, 'touchMove', [[at.x + 10 * k, at.y + 5 * k]]);
    await cdpTouch(page, 'touchEnd', []);
    const v1 = await viewNow(page);
    assert.ok(Math.abs(v1.mag / v0.mag - 1) < 1e-9 && Math.abs(v1.arg - v0.arg) < 1e-9, 'a one-finger drag zoomed or turned');
    assert.notDeepEqual(v1.pan, v0.pan, 'a one-finger drag did not pan');
});

test('a pinch that starts on a card leaves the page unzoomed', { skip: isIPad && 'needs real touches' }, async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const at = await page.evaluate(() => {
        const r = Object.values(Graph.nodes)[0].view.div.querySelector('.editable-div').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await cdpTouch(page, 'touchStart', [[at.x - 20, at.y], [at.x + 20, at.y]]);
    for (let k = 1; k <= 8; k++) await cdpTouch(page, 'touchMove', [[at.x - 20 - 10 * k, at.y], [at.x + 20 + 10 * k, at.y]]);
    await cdpTouch(page, 'touchEnd', []);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'the page itself zoomed, and the menu and tool bar with it');
});

test('a pinch turns the view only when the fingers turn on purpose', { skip: isIPad && 'needs real touches' }, async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    // Bare Fractal all round, so that both fingers land on it however they turn.
    const at = await page.evaluate(() => {
        const bare = (x, y) => document.elementFromPoint(x, y)?.closest('#svg_bg');
        for (let y = 150; y < innerHeight - 150; y += 13) {
            for (let x = 150; x < innerWidth - 150; x += 13) {
                if ([0, 1, 2, 3, 4, 5, 6, 7].every((k) => bare(x + 100 * Math.cos(k * Math.PI / 4), y + 100 * Math.sin(k * Math.PI / 4)))) return { x, y };
            }
        }
        return null;
    });
    assert.ok(at, 'no bare stretch of the Fractal to pinch on');
    const pinch = async (turnDeg, spreadBy) => {
        const v0 = await viewNow(page);
        const r0 = 60;
        await cdpTouch(page, 'touchStart', [[at.x - r0, at.y], [at.x + r0, at.y]]);
        for (let k = 1; k <= 12; k++) {
            const t = (turnDeg * Math.PI / 180) * k / 12, r = r0 * (1 + (spreadBy - 1) * k / 12);
            await cdpTouch(page, 'touchMove', [[at.x - r * Math.cos(t), at.y - r * Math.sin(t)], [at.x + r * Math.cos(t), at.y + r * Math.sin(t)]]);
        }
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const v1 = await viewNow(page);
        await cdpTouch(page, 'touchEnd', []);
        return { zoomIn: v0.mag / v1.mag, turnedDeg: (v1.arg - v0.arg) * 180 / Math.PI };
    };
    const slight = await pinch(5, 1.5);
    assert.ok(Math.abs(slight.zoomIn - 1.5) < 0.01, `a spread to 1.5x zoomed ${slight.zoomIn}x`);
    assert.ok(Math.abs(slight.turnedDeg) < 1e-6, `five degrees of wobble turned the view ${slight.turnedDeg} degrees`);
    const quarter = await pinch(90, 1);
    assert.ok(Math.abs(quarter.turnedDeg) > 60, `a quarter turn of the fingers turned the view only ${quarter.turnedDeg} degrees`);

    // And Home puts it upright again.
    await page.evaluate(() => Hud.home());
    const home = await viewNow(page);
    assert.deepEqual([home.mag, home.arg, ...home.pan], [1, 0, 0, 0]);
});

test("Safari's pinch events zoom for a trackpad, and stand aside for a finger", async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const result = await page.evaluate(() => {
        const gesture = (type, scale) => { const e = new Event(type, { cancelable: true }); Object.defineProperty(e, 'scale', { value: scale }); window.dispatchEvent(e); return e; };
        const pinchOnce = () => { gesture('gesturestart', 1); for (let k = 1; k <= 10; k++) gesture('gesturechange', 1 + k / 10); return gesture('gestureend', 2); };
        const out = {};
        // A finger down on a card, as a pinch over one is: the gesture is the touch's.
        const card = Object.values(Graph.nodes)[0].view.div.querySelector('.editable-div');
        const before = Graph.zoom.mag();
        card.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, composed: true }));
        out.prevented = pinchOnce().defaultPrevented;
        card.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', isPrimary: true, bubbles: true, composed: true }));
        out.withFinger = Graph.zoom.mag() / before;
        // No finger at all: a trackpad, zooming about the pointer.
        const z0 = Graph.zoom.mag(), at0 = Graph.vecToZ();
        pinchOnce();
        out.trackpad = z0 / Graph.zoom.mag();
        out.pointerMoved = Graph.vecToZ().minus(at0).mag();
        return out;
    });
    assert.equal(result.prevented, true, "Safari's own zoom was let through");
    assert.equal(result.withFinger, 1, "a finger's gesture moved the view beside the touch pinch");
    assert.ok(Math.abs(result.trackpad - 2) < 1e-9, `a trackpad spread to 2x zoomed ${result.trackpad}x`);
    assert.ok(result.pointerMoved < 1e-9, 'the point under the pointer moved');
});

// A second review's findings (rv14, rv15), each driven with real touches in Chromium.
const cardOf = (page, title) => page.evaluate((t) => {
    const n = Object.values(Graph.nodes).find((x) => x.getTitle() === t);
    const r = n.view.div.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}, title);
const fingerDrag = async (page, from, by, steps = 10) => {
    await cdpTouch(page, 'touchStart', [[from.x, from.y]]);
    for (let k = 1; k <= steps; k++) await cdpTouch(page, 'touchMove', [[from.x + by[0] * k / steps, from.y + by[1] * k / steps]]);
    await cdpTouch(page, 'touchEnd', []);
    await page.waitForTimeout(300);
};

test('a collapsed card moves under a finger', { skip: isIPad && 'needs real touches' }, async () => {
    // Its circle is outside the header, which was all a finger could take (rv14, rv15).
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    await page.evaluate(() => Object.values(Graph.nodes).find((n) => n.getTitle() === 'Alpha').view.toggleCollapse());
    await page.waitForTimeout(500);
    const before = await cardOf(page, 'Alpha');
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [before.cx, before.cy]);
    assert.match(String(hit), /collapsed-circle/, 'the finger does not land on the circle');
    await fingerDrag(page, { x: before.cx, y: before.cy }, [90, 60]);
    const after = await cardOf(page, 'Alpha');
    assert.ok(Math.abs(after.x - before.x - 90) <= 2 && Math.abs(after.y - before.y - 60) <= 2,
        `the collapsed card moved (${after.x - before.x}, ${after.y - before.y}), not (90, 60)`);
});

test('a short drag on a header moves the card and is not also a tap', { skip: isIPad && 'needs real touches' }, async () => {
    // Past the drag threshold and inside the browser's tap slop, the tap still arrived: the
    // Title took the caret, and with the Connect tool on the card was armed (rv14).
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const a = await card(page, 'Alpha');
    const before = await cardOf(page, 'Alpha');
    await fingerDrag(page, a.head, [12, 0], 4);
    const after = await cardOf(page, 'Alpha');
    assert.equal(Math.round(after.x - before.x), 12, 'the short drag did not move the card');
    assert.notEqual(await page.evaluate(() => document.activeElement?.className), 'title-input', 'the short drag was also a tap on the Title');
    // And a tap straight after still is one.
    await page.waitForTimeout(500);
    await page.touchscreen.tap(a.head.x + 12, a.head.y);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'title-input', 'the next tap was swallowed');
});

test('a second finger does not take over a resize', { skip: isIPad && 'needs real touches' }, async () => {
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const a = await card(page, 'Alpha');
    const size0 = await cardOf(page, 'Alpha');
    await cdpTouch(page, 'touchStart', [[a.grip.x, a.grip.y]]);
    await cdpTouch(page, 'touchMove', [[a.grip.x + 30, a.grip.y + 20]]);
    await page.waitForTimeout(50);
    const size1 = await cardOf(page, 'Alpha');
    // The second finger lands on the resize overlay and moves; the first stays put.
    await cdpTouch(page, 'touchMove', [[a.grip.x + 30, a.grip.y + 20], [200, 300]]);
    for (let k = 1; k <= 5; k++) await cdpTouch(page, 'touchMove', [[a.grip.x + 30, a.grip.y + 20], [200 + 40 * k, 300 + 30 * k]]);
    await page.waitForTimeout(50);
    const size2 = await cardOf(page, 'Alpha');
    await cdpTouch(page, 'touchEnd', []);
    assert.ok(size1.w > size0.w, 'the first finger did not resize');
    assert.deepEqual([Math.round(size2.w), Math.round(size2.h)], [Math.round(size1.w), Math.round(size1.h)],
        'the second finger resized the card');
});

test('two fingers that land on one point leave the view usable', { skip: isIPad && 'needs real touches' }, async () => {
    // With no span to scale from, the zoom went to 0 for good (rv14).
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const at = await openFractal(page);
    await cdpTouch(page, 'touchStart', [[at.x, at.y], [at.x, at.y]]);
    for (let k = 1; k <= 6; k++) await cdpTouch(page, 'touchMove', [[at.x - 5 * k, at.y], [at.x + 5 * k, at.y]]);
    await cdpTouch(page, 'touchEnd', []);
    const zoom = await page.evaluate(() => Graph.zoom.mag());
    assert.ok(Number.isFinite(zoom) && zoom > 1e-6, 'the zoom is ' + zoom);
});

test('a pen on the fractal pans it', async () => {
    // The touch events the Pointer Events path replaced were sent for an Apple Pencil too.
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const at = await openFractal(page);
    const moved = await page.evaluate(async ({ x, y }) => {
        const fire = (type, px, py) => svg.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'pen', isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true }));
        const pan0 = Graph.pan, zoom0 = Graph.zoom.mag();
        fire('pointerdown', x, y);
        for (let k = 1; k <= 6; k++) fire('pointermove', x + 10 * k, y + 5 * k);
        fire('pointerup', x + 60, y + 30);
        return { panned: Graph.pan.minus(pan0).mag() > 0, zoomKept: Graph.zoom.mag() === zoom0 };
    }, at);
    assert.deepEqual(moved, { panned: true, zoomKept: true });
});

test('a tap does not light the copy button; the Title being edited does', async () => {
    // It was shown on the compat mouseenter a tap sends, which is what iOS holds a tap's click
    // back for (rv15).
    ({ context, page } = await openNeurite(browser, { touch: true }));
    await twoNotes(page);
    const opacity = (title) => page.evaluate((t) => {
        const n = Object.values(Graph.nodes).find((x) => x.getTitle() === t);
        return getComputedStyle(n.view.div.querySelector('.copy-button')).opacity;
    }, title);
    const a = await card(page, 'Alpha'), b = await card(page, 'Beta');
    assert.equal(await opacity('Alpha'), '0');
    await page.touchscreen.tap(a.head.x, a.head.y);
    await page.waitForTimeout(300);
    assert.equal(await opacity('Alpha'), '1', 'the Title being edited does not show its copy button');
    await page.touchscreen.tap(b.head.x, b.head.y);
    await page.waitForTimeout(300);
    assert.deepEqual([await opacity('Alpha'), await opacity('Beta')], ['0', '1']);
});

test('a new card is drawn in its place from its first frame', async () => {
    // Measured before it was ever drawn, its box was taken for the drawn one: the first frame
    // put it up to a card's width off its place (rv15).
    ({ context, page } = await openNeurite(browser));
    const off = await page.evaluate(async () => {
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        await window.createNote('Placed', 'Its first frame.');
        const n = Object.values(Graph.nodes).find((x) => x.getTitle() === 'Placed');
        await frame();
        const r = n.content.getBoundingClientRect(), p = Hud.toScreen(n.pos);
        return Math.hypot(r.left + r.width / 2 - p.x, r.top + r.height / 2 - p.y);
    });
    // Main draws it 13 px off in Chromium and 22 px in WebKit, as the card's text settles; the
    // regression was 424–1096 px.
    assert.ok(off < 40, `the first frame drew the card ${Math.round(off)} px off its place`);
});

test("the Pane keeps where it was scrolled to through a window's resize", { skip: isIPad && 'the iPad window does not resize' }, async () => {
    // A resize brought the caret into sight whether or not a keyboard had come up (rv15).
    ({ context, page } = await openNeurite(browser));
    const top = await page.evaluate(async () => {
        window.currentActiveZettelkastenMirror.setValue(Array.from({ length: 80 }, (_, i) => `## Note ${i}\nLine ${i}.\n`).join('\n'));
        await new Promise((r) => setTimeout(r, 1500));
        Hud.openNotes();
        await new Promise((r) => setTimeout(r, 600));
        const cm = window.currentActiveZettelkastenMirror;
        cm.focus();
        cm.setCursor(0, 0);
        cm.scrollTo(null, 1200);
        await new Promise((r) => setTimeout(r, 200));
        return cm.getScrollInfo().top;
    });
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.currentActiveZettelkastenMirror.getScrollInfo().top);
    assert.ok(top > 500 && Math.abs(after - top) < 2, `the Pane went from ${top} to ${after}`);
});
