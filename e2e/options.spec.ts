import { expect, test as base, type Page } from '@playwright/test';
import { serveOptionsBuild } from '../tests/options/server';
import { PARAM_DEFS } from '../src/tuning/schema';

const test = base.extend<
  { optionsPage: Page },
  { optionsBuild: Awaited<ReturnType<typeof serveOptionsBuild>> }
>({
  optionsBuild: [
    // eslint-disable-next-line no-empty-pattern -- Playwright parses this dependency list.
    async ({}, use) => {
      const server = await serveOptionsBuild();
      try {
        await use(server);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker' },
  ],
  optionsPage: async ({ page, optionsBuild }, use) => {
    await page.goto(optionsBuild.url);
    await page.waitForFunction(() => Boolean(window.__optionsTest));
    await use(page);
  },
});

test('schema controls update in place, preserve typed precision, validate, reset, and search advanced fields', async ({
  optionsPage: page,
}) => {
  await page.getByRole('button', { name: '⚙ Options' }).click();
  await expect(page.locator('.sl-field')).toHaveCount(PARAM_DEFS.length + 14);
  await expect(page.locator('.sl-options__quick .sl-field')).toHaveCount(14);
  await expect(page.locator('.sl-options__groups .sl-field')).toHaveCount(
    PARAM_DEFS.length,
  );
  // Modules can be reachable while a new schema group is absent from the panel.
  // Derive both levels from the schema so future audio/music/map rows cannot hide.
  const renderedGroups = await page
    .locator('.sl-options__groups > .sl-group[data-group]')
    .evaluateAll((groups) =>
      groups.map((group) => ({
        name: group.getAttribute('data-group'),
        keys: [...group.querySelectorAll('.sl-field')].map((field) =>
          field.getAttribute('data-key'),
        ),
      })),
    );
  expect(renderedGroups.map((group) => group.name).sort()).toEqual(
    [...new Set(PARAM_DEFS.map((definition) => definition.group))].sort(),
  );
  for (const definition of PARAM_DEFS)
    expect(
      renderedGroups.find((group) => group.name === definition.group)?.keys,
      definition.key + ' must be reachable in ' + definition.group,
    ).toContain(definition.key);

  expect(
    await page
      .locator('[id]')
      .evaluateAll(
        (nodes) => new Set(nodes.map((node) => node.id)).size === nodes.length,
      ),
  ).toBe(true);
  await page.getByRole('searchbox').fill('gravity');
  const number = page.locator('#group-gravity-number');
  const original = await number.elementHandle();
  const text = await page
    .locator('#group-gravity-number')
    .evaluateHandle(
      (node) => node.closest('.sl-field')?.querySelector('label')?.firstChild,
    );
  await number.fill('23.123456');
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(23.123456);
  await expect(
    page.locator('.sl-field[data-key=gravity]').first(),
  ).toHaveAttribute('data-edited', 'true');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await expect(
    page.locator('.sl-field[data-key=gravity]').first(),
  ).toHaveAttribute('data-edited', 'true');
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await text.evaluate((node) => node?.isConnected)).toBe(true);
  await number.fill('999');
  await expect(number).toHaveValue('40');
  await number.fill('');
  await expect(number).toHaveAttribute('aria-invalid', 'true');
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(40);
  await number.press('Tab');
  await expect(number).toHaveValue('40');
  await page
    .locator('.sl-options__groups')
    .getByRole('button', { name: 'Reset Gravity', exact: true })
    .click();
  await expect(number).toHaveValue('20');
  await page.getByRole('searchbox').fill('physicsHz');
  await expect(page.locator('#group-physicsHz-number')).toBeVisible();
  await expect(page.locator('#group-physicsHz-range')).toHaveAttribute(
    'max',
    '4',
  );
  await page.getByRole('searchbox').fill('not a tuning parameter');
  await expect(page.getByText('No matching controls')).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await expect(page.getByText('No matching controls')).toBeHidden();
});

test('game Tab swaps slots, panel Tab navigates, pointer sliders return driving focus, and editing does not steer', async ({
  optionsPage: page,
}) => {
  const canvas = page.getByLabel('Driving view');
  await canvas.focus();
  await page.keyboard.press('KeyO');
  await expect(page.locator('.sl-options')).toHaveAttribute(
    'data-open',
    'true',
  );
  await page.evaluate(() => window.__optionsTest.store.set('gravity', 22));
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Activate slot B' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toBeFocused();
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(20);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Activate slot A' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(22);
  await page.getByRole('searchbox').fill('gravity');
  const range = page.locator('#group-gravity-range');
  await range.focus();
  await range.press('ArrowRight');
  await expect(range).toBeFocused();
  expect(
    await page.evaluate(() => window.__optionsTest.input.state.steer),
  ).toBe(0);
  await range.press('Tab');
  expect(
    await page.evaluate(() => window.__optionsTest.panel.session.activeSlot),
  ).toBe('A');
  await range.click();
  await expect(canvas).toBeFocused();
  await page.keyboard.down('KeyW');
  await expect
    .poll(() => page.evaluate(() => window.__optionsTest.input.state.throttle))
    .toBe(1);
  const number = page.locator('#group-gravity-number');
  await number.focus();
  await expect
    .poll(() => page.evaluate(() => window.__optionsTest.input.state.throttle))
    .toBe(0);
  await number.press('ArrowLeft');
  expect(
    await page.evaluate(() => window.__optionsTest.input.state.steer),
  ).toBe(0);
  await page.keyboard.up('KeyW');
  await page.getByRole('checkbox', { name: 'Pause while open' }).check();
  expect(await page.evaluate(() => window.__optionsTest.state.paused)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('timeScale')),
  ).toBe(1);
  await page.getByRole('button', { name: 'Close Options' }).click();
  expect(await page.evaluate(() => window.__optionsTest.state.paused)).toBe(
    false,
  );
  await expect(canvas).toBeFocused();
  await expect(page.locator('.sl-options')).toHaveAttribute('inert', '');
});

test('presets, JSON, share links, autosave and reset preserve named tunes and complete change history', async ({
  optionsPage: page,
}) => {
  await page.getByRole('button', { name: '⚙ Options' }).click();
  await page
    .getByRole('combobox', { name: 'Preset', exact: true })
    .selectOption('builtin:Drifty');
  expect(
    await page.evaluate(() => window.__optionsTest.panel.session.modified),
  ).toBe(false);
  await page.evaluate(() => window.__optionsTest.store.set('gravity', 26.1234));
  page.once('dialog', (dialog) => {
    void dialog.accept('Corner tune');
  });
  await page.getByRole('button', { name: 'Save as…' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__optionsTest));
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(26.1234);
  await page.getByRole('button', { name: '⚙ Options' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Preset', exact: true }),
  ).toHaveValue('user:Corner tune');
  await page.locator('input[type=file]').setInputFiles({
    name: 'future.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 9,
        name: 'Future tune',
        values: { gravity: 24.25, unknownKey: 10 },
      }),
    ),
  });
  await expect
    .poll(() => page.evaluate(() => window.__optionsTest.store.get('gravity')))
    .toBe(24.25);
  await expect(page.getByRole('status')).toContainText('unknownKey');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString()) as {
    values: Record<string, number>;
    changeLog: unknown[];
  };
  expect(Object.keys(exported.values)).toHaveLength(PARAM_DEFS.length);
  expect(exported.values.gravity).toBe(24.25);
  expect(exported.changeLog.length).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Share link', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Share link', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#[A-Za-z0-9_-]+$/);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__optionsTest));
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(24.25);
  await page.getByRole('button', { name: '⚙ Options' }).click();
  await page.getByRole('button', { name: 'Reset everything' }).click();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__optionsTest));
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(20);
  await page.getByRole('button', { name: '⚙ Options' }).click();
  await page
    .getByRole('combobox', { name: 'Preset', exact: true })
    .selectOption('user:Corner tune');
  expect(
    await page.evaluate(() => window.__optionsTest.store.get('gravity')),
  ).toBe(26.1234);
  await page.getByText('Change log', { exact: true }).click();
  await expect(page.getByText(/export includes all/)).toBeVisible();
});

test('plot reads are gated before telemetry access, track axle points, and hide airborne data', async ({
  optionsPage: page,
}) => {
  const result = await page.evaluate(() => {
    const test = window.__optionsTest;
    test.setAutomaticUpdates(false);
    test.panel.update(1000); // closed: no getter call
    const closed = test.state.telemetryReads;
    const feedbackBefore = test.state.rebuildReads;
    test.panel.setOpen(true);
    test.state.telemetry = {
      wheels: [
        { Fz: 1000, alpha: Math.PI / 18, gripUsage: 0.8 },
        { Fz: 1000, alpha: Math.PI / 9, gripUsage: 1.2 },
        { Fz: 1000, alpha: 0, gripUsage: 0.3 },
        { Fz: 0, alpha: 2, gripUsage: 1.5 },
      ],
    };
    for (let ms = 1000; ms < 2000; ms++) test.panel.update(ms);
    return {
      closed,
      reads: test.state.telemetryReads,
      feedbackReads: test.state.rebuildReads - feedbackBefore,
    };
  });
  expect(result.closed).toBe(0);
  expect(result.reads).toBe(30);
  expect(result.feedbackReads).toBe(30);
  await expect(page.locator('.sl-graph__legend')).toContainText(
    'F 15.0° / 1.00 · R 0.0° / 0.30',
  );
  const before = await page
    .locator('.sl-graph__canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await page.evaluate(() => {
    const test = window.__optionsTest;
    test.state.telemetry = {
      wheels: [{ Fz: 1000, alpha: Math.PI / 4, gripUsage: 0.5 }],
    };
    test.panel.update(2100);
  });
  const after = await page
    .locator('.sl-graph__canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  expect(after).not.toBe(before);
  await expect(page.locator('.sl-graph__legend')).toContainText(
    'F 45.0° / 0.50 · R AIR',
  );
  await page.evaluate(() => {
    window.__optionsTest.state.telemetry = undefined;
    window.__optionsTest.panel.update(2200);
  });
  await expect(page.locator('.sl-graph__legend')).toContainText(
    'No grounded wheel readings',
  );
});

test('external rebuild feedback is displayed, helpers stay keyboard accessible, and the panel fits a narrow viewport', async ({
  optionsPage: page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByRole('button', { name: '⚙ Options' }).click();
  await page.getByRole('searchbox').fill('mass');
  await page.evaluate(() => {
    const store = window.__optionsTest.store;
    store.set('mass', 1600);
    store.set('mass', 1700);
    store.set('mass', 1800);
  });
  const field = page.locator('.sl-options__groups .sl-field[data-key=mass]');
  await expect(field.locator('.sl-badge')).toBeHidden();
  await page.evaluate(() => {
    window.__optionsTest.state.rebuild.status = 'pending';
  });
  await expect(field.locator('.sl-badge')).toHaveText('Applying…');
  await page.evaluate(() => {
    window.__optionsTest.state.rebuild.status = 'error';
    window.__optionsTest.state.rebuild.error = 'Mass adapter failed';
  });
  await expect(field.locator('.sl-badge')).toHaveText('Update failed');
  await expect(page.getByRole('status')).toHaveText('Mass adapter failed');
  await page.evaluate(() => {
    window.__optionsTest.state.rebuild.status = 'idle';
    window.__optionsTest.state.rebuild.error = null;
  });
  await expect(field.locator('.sl-badge')).toBeHidden();
  await expect(page.getByRole('status')).toBeEmpty();
  const help = field.getByRole('button', { name: 'Help for Mass' });
  await help.focus();
  await expect(field.locator('.sl-tooltip')).toBeVisible();
  await help.press('Escape');
  await expect(field.locator('.sl-tooltip')).toBeHidden();
  await expect(page.locator('.sl-options')).toHaveAttribute(
    'data-open',
    'true',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const bounds = await page.locator('.sl-options').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('options-narrow.png') });
  await page.getByRole('searchbox').fill('');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath('options-desktop.png') });
});

test('controller adjustments use schema units for numeric, log and discrete controls', async ({
  optionsPage: page,
}) => {
  await page.getByRole('button', { name: '⚙ Options' }).click();
  const values = await page.evaluate(() => {
    const panel = window.__optionsTest;
    const adjust = (id: string, direction: number, coarse: boolean) => {
      document.getElementById(id)!.dispatchEvent(
        new CustomEvent('sl-tune-step', {
          bubbles: true,
          cancelable: true,
          detail: { direction, coarse },
        }),
      );
    };
    adjust('group-gripRear-number', 1, false);
    const fine = panel.store.get('gripRear');
    adjust('group-gripRear-number', 1, true);
    const coarse = panel.store.get('gripRear');
    adjust('group-mass-range', 1, false);
    const mass = panel.store.get('mass');
    adjust('group-physicsHz-range', 1, true);
    const discrete = panel.store.get('physicsHz');
    adjust('group-physicsHz-number', -1, false);
    return { fine, coarse, mass, discrete, back: panel.store.get('physicsHz') };
  });
  expect(values).toEqual({
    fine: 1.51,
    coarse: 1.61,
    mass: 1310,
    discrete: 180,
    back: 120,
  });
});
