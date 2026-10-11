import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openNeurite, isIPad } from './helpers.mjs';

let browser, context, page, errors;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { ({ context, page, errors } = await openNeurite(browser)); });
afterEach(async () => { await context?.close(); });

// The menu's panels as one design system, and the chrome as glass (#80, panels.css): a section
// is a heading over a group of rows, a row is its label on the left and its control on the
// right, sliders carry their values, and on or off is a switch.

async function openPanel(page, id) {
    await page.click('.menu-button');
    await page.waitForTimeout(300);
    await page.click(id);
    await page.waitForTimeout(250);
}

test('a section is a heading at the left over a group of rows', async () => {
    await openPanel(page, '#tablink-settings');
    const s = await page.evaluate(() => {
        const heading = document.querySelector('#zetTagSettings > .settings-heading');
        const group = document.querySelector('#zetTagSettings > .settings-group');
        const row = group.querySelector('.settings-row');
        const h = heading.getBoundingClientRect(), g = group.getBoundingClientRect(), r = row.getBoundingClientRect();
        const label = row.querySelector('label').getBoundingClientRect(), field = row.querySelector('input').getBoundingClientRect();
        return {
            // The words start where the group does; the rules each side are gone.
            headingLeft: Math.round(h.left + parseFloat(getComputedStyle(heading).paddingLeft) - g.left),
            rule: getComputedStyle(heading, '::before').display,
            fill: getComputedStyle(group).backgroundColor, radius: getComputedStyle(group).borderTopLeftRadius,
            rowHeight: Math.round(r.height),
            // The label at the left, the field at the right edge.
            labelLeft: Math.round(label.left - r.left), fieldRight: Math.round(r.right - field.right),
        };
    });
    assert.ok(Math.abs(s.headingLeft) <= 4, `the heading starts ${s.headingLeft}px from its group`);
    assert.equal(s.rule, 'none', 'the heading still draws a rule');
    assert.match(s.fill, /rgba\(255, 255, 255, 0\.0[3-5]/, `the group has no fill of its own: ${s.fill}`);
    assert.equal(s.radius, '8px');
    assert.ok(s.rowHeight >= 36, `a row is ${s.rowHeight}px tall`);
    assert.ok(s.labelLeft <= 13 && s.fieldRight <= 13, `the row is not label-left, field-right: ${JSON.stringify(s)}`);
    assert.deepEqual(errors, []);
});

test('every slider in Settings is one row, and says its value', async () => {
    await openPanel(page, '#tablink-settings');
    await page.evaluate(() => document.querySelectorAll('#tab5 details').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#tab5 .settingsSlider')]
        .filter((row) => row.getClientRects().length)
        .map((row) => {
            const slider = row.querySelector('input[type="range"]');
            const shown = row.querySelector('.number-input, .slider-value');
            const r = row.getBoundingClientRect();
            const sameLine = [row.querySelector('label'), slider, shown].every((el) => {
                const b = el.getBoundingClientRect();
                return b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
            });
            return { id: slider.id, value: slider.value, shown: shown ? (shown.value ?? shown.textContent) : null,
                     height: Math.round(r.height), sameLine };
        }));
    assert.ok(rows.length >= 20, `only ${rows.length} slider rows were found`);
    for (const row of rows) {
        assert.ok(row.shown !== null, `${row.id} says nothing of its value`);
        assert.equal(Number(row.shown), Number(row.value), `${row.id} shows ${row.shown} for ${row.value}`);
        assert.ok(row.sameLine && row.height < 48, `${row.id} is not one row: ${JSON.stringify(row)}`);
    }

    // A value with no box of its own follows the slider.
    await page.evaluate(() => {
        const s = document.getElementById('hue-rotation-slider');
        s.value = '120';
        s.dispatchEvent(new Event('input'));
    });
    assert.equal(await page.textContent('output.slider-value[for="hue-rotation-slider"]'), '120');
    await page.evaluate(() => {
        const s = document.getElementById('hue-rotation-slider');
        s.value = '0';
        s.dispatchEvent(new Event('input'));
    });
});

test('on and off is a switch, and the row turns it', async () => {
    await openPanel(page, '#tablink-ai');
    const state = () => page.evaluate(() => ({
        on: document.getElementById('code-checkbox').checked,
        track: getComputedStyle(document.querySelector('label[for="code-checkbox"]'), '::before').backgroundColor,
    }));
    const off = await state();
    assert.equal(off.on, false);
    await page.click('label[for="code-checkbox"]');
    // Past the track's colour transition.
    await page.waitForTimeout(300);
    const on = await state();
    assert.equal(on.on, true, 'a click on the row did not turn it on');
    assert.notEqual(on.track, off.track, 'the switch looks the same on as off');
    await page.click('label[for="code-checkbox"]');
    assert.equal((await state()).on, false);
});

test('the placement style is one row of segments that sets the select and shows its sliders', async () => {
    await openPanel(page, '#tablink-settings');
    const segments = await page.evaluate(() => [...document.querySelectorAll('#zetPlacementSettings .segmented-option')]
        .map((o) => o.textContent.trim()));
    assert.deepEqual(segments, ['Radial', 'Spiral', 'Branching', 'Random']);
    assert.equal(await page.evaluate(() => document.querySelector('#zetPlacementSettings .segmented').getAttribute('aria-labelledby')),
        'placementHeading', 'the segments are not named by their heading');

    await page.click('#zetPlacementSettings .segmented-option:has-text("Spiral")');
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => ({
        select: document.getElementById('zetPathTypeDropdown').value,
        stored: Modal.inputValues.zetPathTypeDropdown,
        shown: [...document.querySelectorAll('#zetPlacementSettings .settingsSlider')]
            .filter((r) => r.getClientRects().length).map((r) => r.querySelector('label').textContent),
        display: getComputedStyle(document.querySelector('#zetPlacementSettings .spiral-slider')).display,
    }));
    assert.deepEqual([s.select, s.stored], ['Spiral', 'Spiral']);
    assert.deepEqual(s.shown, ['Nodes', 'Spacing', 'Size', 'Curl']);
    // Shown by the stylesheet's display, which is the row's grid -- not an inline `block`.
    assert.equal(s.display, 'grid');

    if (!isIPad) {
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.getElementById('zetPathTypeDropdown').value), 'Branching',
            'an arrow key did not choose the next style');
    }
});

test('the tool pill and the islands are glass, and their glyphs are legible on it', async () => {
    const s = await page.evaluate(() => {
        const bar = getComputedStyle(document.querySelector('.tool-bar'));
        const alpha = (c) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(c)?.[1] ?? 1);
        return {
            bar: alpha(bar.backgroundColor), blur: bar.backdropFilter || bar.webkitBackdropFilter,
            hud: alpha(getComputedStyle(document.querySelector('.hud-panel')).backgroundColor),
            panel: alpha(getComputedStyle(document.querySelector('.dropdown-content')).backgroundColor),
            glyph: getComputedStyle(document.querySelector('#clear-button svg')).color,
        };
    });
    assert.ok(s.bar < 1 && s.hud < 1, `the islands are opaque: ${JSON.stringify(s)}`);
    assert.match(s.blur, /blur\(/, 'nothing behind the glass is blurred');
    assert.ok(s.panel < 1 && s.panel > s.bar, 'the panel is not glass, or not nearer opaque than the pill');
    // The universal `* { color }` held every glyph at #9d9d9d whatever its tool said.
    assert.equal(s.glyph, 'rgb(221, 221, 221)');
});

test('what cannot be undone is red, and still asks', async () => {
    await openPanel(page, '#tablink-settings');
    const colour = await page.evaluate(() => getComputedStyle(document.getElementById('clearLocalStorage')).color);
    const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-danger').trim());
    assert.equal(colour, await page.evaluate((hex) => {
        const probe = document.createElement('i');
        probe.style.color = hex;
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    }, danger));
    await page.click('#clearLocalStorage');
    await page.waitForFunction(() => Modal.current?.id === 'confirmModal', undefined, { timeout: 5000 });
    await page.click('#customModal .modal-cancel');
});
