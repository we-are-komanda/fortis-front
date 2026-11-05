/* eslint-disable @typescript-eslint/no-require-imports -- Browser regression gate for the synthetic game model. */
require('tsx/cjs');
const { chromium, expect: baseExpect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { defaultGameSettings } = require('../../src/shared/lib/game-settings.ts');
const { createDefaultDefenseProject } = require('../../src/shared/lib/defense-project.ts');
const expect = baseExpect.configure({ timeout: 30000 });
const base = process.env.SCN01_URL || 'http://localhost:3000';
const output = 'output/playwright/mc-regressions';
const fixture = createDefaultDefenseProject();
fixture.projectId = 'mc-effectiveness-test';
fixture.enterpriseId = 'modeling-object-a';
fixture.version = 1;
fixture.baseObject = { id: fixture.enterpriseId, name: 'Объект — проверка эффективности', center: { lat: 55.75, lng: 37.62 } };
fixture.source = 'backend';
fixture.layers = [ { ...fixture.layers[0], id: 'local-layer', name: 'Площадка', code: 'ПЛ', geometryType: 'circle', geometry: {type: 'circle', center: fixture.baseObject.center, radiusM: 1000}, isActive: true } ];
fixture.activeLayerId = fixture.layers[0].id;
// Two covered placements near the centre; their conditional zones cover every approach ray.
fixture.placedObjects = fixture.assetLibrary.slice(0, 2).map((asset, i) => ({id: `covered-${i}`, assetId: asset.id, layerId: fixture.activeLayerId, quantity: 2, status: 'active', customCoverageRadius: 3000, coordinates: {lat: 55.75 + (i ? -.0005 : .0005), lng: 37.62 + (i ? -.001 : .001)}, createdAt: fixture.updatedAt, updatedAt: fixture.updatedAt}));
(async () => {
  const browser = await chromium.launch();
  try {
    fs.mkdirSync(output, {recursive: true});
    const page = await browser.newPage({viewport: {width: 1440, height: 972}});
    const errors = [], writes = [], consoleErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', request => { if (request.url().includes('/api/') && !['GET','HEAD'].includes(request.method())) writes.push(request.url()); });
    await page.route('**/api/runtime', route => route.fulfill({json: {mode: 'workspace'}}));
    await page.route('**/api/v1/assets?**', route => route.fulfill({json: {items: fixture.assetLibrary, totalItems: fixture.assetLibrary.length}}));
    await page.route('**/api/defense/projects/mc-effectiveness-test', route => route.fulfill({json: fixture}));
    await page.route('**/api/v1/enterprises?**', route => route.fulfill({json: {items: [
      {id: fixture.enterpriseId, name: fixture.baseObject.name, latitude: 55.75, longitude: 37.62}
    ], totalItems: 1}}));
    await page.goto(base + '/prototype?view=scenario-modeling&projectId=mc-effectiveness-test');
    const root = page.locator('[data-mass-workspace]');
    await expect(root).toHaveAttribute('data-base-object-id', fixture.enterpriseId);
    await expect(root.getByRole('button', {name: 'Пуск', exact: true})).toBeEnabled();
    await expect(root.locator('[data-view]')).toHaveAttribute('data-view', '3d');
    await expect(root.locator('canvas')).toBeVisible();
    // Sidebar: both covered placements flagged as participating; editing radius flips the flag.
    const rows = root.locator('[data-coverage-row]');
    await expect(rows).toHaveCount(2);
    await expect(root.locator('[data-coverage-participates="true"]')).toHaveCount(2);
    const radiusInput = rows.first().locator('[data-coverage-radius]');
    await radiusInput.fill('3500');
    // 2D scene draws conditional coverage zones for participating placements.
    await root.getByRole('button', {name:'2D', exact:true}).click();
    await expect(root.locator('[data-coverage-zones] g')).toHaveCount(2);
    // Countdown row carries the neutralization counter.
    await expect(root.locator('[data-neutralized]')).toBeVisible();
    // Four independent units have 240 charges in total: at most 80% of 300 targets.
    const batchButton = root.getByRole('button', {name:'Рассчитать пакет', exact:true});
    await batchButton.click();
    await expect(root.locator('[data-batch-neutralized]')).toBeVisible();
    const neutralText = await root.locator('[data-batch-neutralized]').textContent();
    const median = Number(neutralText.match(/медиана ([\d.]+)%/)[1]);
    assert.ok(median > 0 && median <= 80, neutralText);
    // Camera, view and selection must preserve a completed batch.
    await root.getByRole('button', {name: 'Приблизить к объекту', exact: true}).click();
    await root.getByRole('button', {name: `Средство: ${fixture.assetLibrary[0].name}, 2 шт.`, exact: true}).click();
    await expect(root.locator('[data-batch-neutralized]')).toHaveText(neutralText);
    // Play through: seek inside the run window; intercept journal must carry entries with source names.
    await page.locator('[aria-label="Время сценария"]').fill('3600000');
    const neutralizedText = Number(await root.locator('[data-neutralized]').textContent());
    assert.ok(neutralizedText > 0, `data-neutralized should exceed zero, got ${neutralizedText}`);
    await root.getByLabel('Время сценария', {exact: true}).fill('1800000');
    const active = await root.getAttribute('data-active');
    await root.getByRole('button', {name: '3D', exact: true}).click();
    await expect(root.getByRole('button', {name: 'Пуск', exact: true})).toBeEnabled();
    await expect(root).toHaveAttribute('data-time-ms', '1800000');
    await expect(root).toHaveAttribute('data-active', active);
    await root.getByRole('button', {name: 'Пуск', exact: true}).click();
    await expect.poll(async () => Number(await root.getAttribute('data-time-ms'))).toBeGreaterThan(1800000);
    await root.getByRole('button', {name: 'Пауза', exact: true}).click();
    await expect(root).toHaveAttribute('data-status', 'paused');
    await root.getByRole('button', {name: '2D', exact: true}).click();
    await root.getByLabel('Время сценария', {exact: true}).fill('3600000');
    await root.getByRole('button', {name:'Справочная информация', exact:true}).click();
    const modal = page.locator('.ant-modal');
    await expect(modal.getByText('Журнал нейтрализаций')).toBeVisible();
    await expect(modal.getByText(/Коэффициенты — настройки игры/)).toBeVisible();
    const intercepts = modal.locator('[data-intercept-event]');
    await expect(intercepts.first()).toBeVisible();
    await intercepts.first().getByRole('button').click();
    await expect(modal.getByText('Журнал нейтрализаций')).toHaveCount(0);
    await rows.first().getByText('Игровые параметры', {exact: true}).click();
    const setting = key => rows.first().locator(`[data-game-setting="${key}"]`);
    await expect(setting('intervalMs')).toHaveValue('5');
    await expect(setting('ammunition')).toHaveValue('60');
    await setting('intervalMs').fill('0');
    await setting('intervalMs').blur();
    await expect(setting('intervalMs')).toHaveAttribute('aria-invalid', 'true');
    await expect(root.locator('[data-batch-result]')).toBeVisible(); // invalid draft is not committed
    await setting('intervalMs').fill('8');
    await setting('intervalMs').blur();
    await expect(root.locator('[data-batch-result]')).toHaveCount(0);
    await expect(root).toHaveAttribute('data-time-ms', '0');
    for (const [key, value] of Object.entries({reactionMs: '3', magazineSize: '4', ammunition: '9', reloadMs: '12', maxTargets: '2'})) {
      await setting(key).fill(value); await setting(key).blur(); await expect(setting(key)).toHaveValue(value);
    }
    await rows.first().getByRole('button', {name: 'Общие игровые значения', exact: true}).click();
    await expect(setting('intervalMs')).toHaveValue('5');
    await expect(setting('ammunition')).toHaveValue('60');
    assert.equal(await root.locator('aside').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({path: output + '/desktop.png'});

    // Both completed and in-flight batches become invalid when placement inputs change.
    await radiusInput.fill('');
    await expect(root.locator('[data-batch-result]')).toHaveCount(0);
    await expect(root).toHaveAttribute('data-time-ms', '0');
    await rows.nth(1).locator('[data-coverage-radius]').fill('');
    await batchButton.click();
    await expect(root.locator('[data-batch-neutralized]')).toContainText('медиана 0.0%');
    await radiusInput.fill('3500');
    await expect(root.locator('[data-batch-result]')).toHaveCount(0);
    await root.getByLabel('Размер пакета', {exact: true}).selectOption('500');
    // Hold the cooperative batch yield until the input change commits: no timing race with the host.
    await page.evaluate(() => {
      const original = window.setTimeout;
      window.__mcYieldRelease = [];
      window.setTimeout = function (callback, delay, ...args) {
        if (delay === 0 && typeof callback === 'function' && callback.toString().includes('[native code]')) {
          window.__mcYieldRelease.push(() => callback(...args));
          return -1;
        }
        return original.call(this, callback, delay, ...args);
      };
      window.__restoreMcTimer = () => { window.setTimeout = original; };
    });
    await batchButton.click();
    await expect(root.getByRole('progressbar')).toHaveAttribute('value', '10');
    await setting('ammunition').fill('0');
    await setting('ammunition').blur();
    await expect(root.getByRole('progressbar')).toHaveCount(0);
    await page.evaluate(async () => {
      window.__restoreMcTimer();
      window.__mcYieldRelease.forEach(release => release());
      await new Promise(resolve => setTimeout(resolve, 0));
      delete window.__mcYieldRelease;
      delete window.__restoreMcTimer;
    });
    await expect(root.locator('[data-batch-result]')).toHaveCount(0);
    await expect(batchButton).toBeEnabled();
    await batchButton.click();
    await expect(root.locator('[data-batch-neutralized]')).toContainText('медиана 0.0%');
    await expect(root.getByLabel('Номер прогона').locator('option')).toHaveCount(500);

    // Native cancellation still works after the input-triggered cancellation.
    await page.evaluate(() => {
      const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
      button('Рассчитать пакет').click();
      setTimeout(() => button('Отменить')?.click(), 0);
    });
    await expect(root.getByText('Расчёт отменён. Частичные результаты не сохранены.', {exact: true})).toBeVisible();

    await page.setViewportSize({width: 390, height: 844});
    await root.getByRole('button', {name: 'Параметры и результаты Монте-Карло', exact: true}).click();
    await expect(radiusInput).toBeVisible();
    await radiusInput.fill('20000');
    await expect(setting('reloadMs')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await rows.first().locator('details').evaluate(el => el.scrollIntoView({block: 'start'}));
    await page.screenshot({path: output + '/mobile-settings.png'});
    await root.getByRole('button', {name: 'Скрыть настройки · к сцене', exact: true}).click();
    await expect(root.getByRole('button', {name: 'Пуск', exact: true})).toBeEnabled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({path: output + '/mobile.png'});

    // With every object removed immediately, there are no boundary events to seek to.
    const allRemoved = structuredClone(fixture);
    allRemoved.placedObjects.forEach(object => { object.quantity = 100; object.customCoverageRadius = 20000; object.gameSettings = {...defaultGameSettings, reactionMs: 0}; });
    await page.route('**/api/defense/projects/mc-effectiveness-test', route => route.fulfill({json: allRemoved}));
    await page.reload();
    await expect(root.getByRole('button', {name: 'К следующему срабатыванию', exact: true})).toBeDisabled();
    await expect(root.getByRole('img', {name: 'Активные объекты во времени: пик 0, среднее 0.0', exact: true})).toBeVisible();
    await root.getByLabel('Время сценария', {exact: true}).fill('3600000');
    await expect(root.locator('[data-neutralized]')).toHaveText('300');
    await expect(root.locator('[data-finished]')).toHaveText('0');

    await root.getByRole('button', {name: 'Параметры и результаты Монте-Карло', exact: true}).click();
    await rows.first().getByText('Игровые параметры', {exact: true}).click();
    await expect(setting('reactionMs')).toHaveValue('0'); // settings hydrated from the saved document

    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    console.log('PASS: game resources, editable settings, saved settings hydration, reference dialog, 2D, batch invalidation/cancellation/restart, selection, mobile, zero activity and no phantom events; no writes or browser errors');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
