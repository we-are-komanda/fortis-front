/* eslint-disable @typescript-eslint/no-require-imports -- Runnable local browser acceptance check for mass-motion@4 equipment effectiveness. */
require('tsx/cjs');
const { chromium, expect: baseExpect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createDefaultDefenseProject } = require('../../src/shared/lib/defense-project.ts');
const expect = baseExpect.configure({ timeout: 30000 });
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
    const page = await browser.newPage({viewport: {width: 1440, height: 972}});
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/') && !['GET','HEAD'].includes(request.method())) writes.push(request.url()); });
    await page.route('**/api/defense/projects/mc-effectiveness-test', route => route.fulfill({json: fixture}));
    await page.route('**/api/v1/enterprises?**', route => route.fulfill({json: {items: [
      {id: fixture.enterpriseId, name: fixture.baseObject.name, latitude: 55.75, longitude: 37.62}
    ], totalItems: 1}}));
    await page.goto('http://localhost:3000/prototype?view=gis&projectId=mc-effectiveness-test');
    await page.getByRole('button', {name: 'К Монте-Карло', exact: true}).click();
    const root = page.locator('[data-mass-workspace]');
    await expect(root).toHaveAttribute('data-base-object-id', fixture.enterpriseId);
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
    // Batch: k=4 covering units → P = 1 − 0.5^4 = 93.75%; median share lands within ±1.5 points.
    const batchButton = root.getByRole('button', {name:'Рассчитать пакет', exact:true});
    await batchButton.click();
    await expect(root.locator('[data-batch-neutralized]')).toBeVisible();
    const neutralText = await root.locator('[data-batch-neutralized]').textContent();
    assert.match(neutralText, /медиана (9[2-5]|\d0)\.\d%/, neutralText);
    fs.mkdirSync('output/playwright/map-modeling',{recursive:true});
    // Play through: seek inside the run window; intercept journal must carry entries with source names.
    await page.locator('[aria-label="Время сценария"]').fill('3600000');
    const neutralizedText = Number(await root.locator('[data-neutralized]').textContent());
    assert.ok(neutralizedText > 0, `data-neutralized should exceed zero, got ${neutralizedText}`);
    await root.getByRole('button', {name:'Справочная информация', exact:true}).click();
    const modal = page.locator('.ant-modal');
    await expect(modal.getByText('Журнал нейтрализаций')).toBeVisible();
    const intercepts = modal.locator('[data-intercept-event]');
    await expect(intercepts.first()).toBeVisible();
    await intercepts.first().getByRole('button').click();
    await expect(modal.getByText('Журнал нейтрализаций')).toHaveCount(0);
    await page.screenshot({path:'output/playwright/map-modeling/mc-effectiveness.png'});
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: placed conditional coverage feeds Monte Carlo — flags, zones, neutralization counters, batch share and intercept journal');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
