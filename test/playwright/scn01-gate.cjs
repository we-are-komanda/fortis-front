/* eslint-disable @typescript-eslint/no-require-imports -- Runnable browser acceptance check. */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const base = process.env.SCN01_URL || 'http://localhost:3000';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
    });
    const runtime = await (await page.request.get(base + '/api/runtime')).json();
    assert.equal(runtime.mode, 'workspace');
    for (const entry of ['/', '/workspace', '/prototype', '/prototype?view=scenario-modeling']) {
      await page.goto(base + entry);
      await expect(page.locator('[data-scenario-workspace]')).toBeVisible();
      await expect(page.locator('[data-scenario-workspace] canvas')).toBeVisible();
      await expect(page.getByText('Предприятие и конфигурация', { exact: true })).toHaveCount(0);
    }
    const workspace = page.locator('[data-scenario-workspace]');
    await expect(workspace).toHaveAttribute('data-zoom', '24');
    await page.getByRole('button', { name: 'Начать просмотр', exact: true }).click();
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-zoom', '24');
    await page.getByRole('button', { name: 'Маршруты 10 км', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-zoom', '1.1');
    await page.getByRole('button', { name: 'Приблизить предприятие', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-zoom', '48');
    await page.getByRole('button', { name: 'Рабочий вид', exact: true }).click();
    const canvas = await workspace.locator('canvas').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.wheel(0, -150);
    await expect.poll(async () => Number(await workspace.getAttribute('data-zoom'))).toBeGreaterThan(24);
    const wheelZoom = Number(await workspace.getAttribute('data-zoom'));
    await page.getByRole('button', { name: 'Приблизить', exact: true }).click();
    await expect.poll(async () => Number(await workspace.getAttribute('data-zoom'))).toBeCloseTo(wheelZoom * 1.4);
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'Маршруты 10 км', exact: true }).click();
    await page.getByRole('button', { name: 'Приблизить предприятие', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-zoom', '48');
    fs.mkdirSync('output/playwright/chemical-pilot', { recursive: true });
    await page.screenshot({ path: 'output/playwright/chemical-pilot/scale-gate.png' });
    await page.goto(base + '/prototype?view=3d');
    await expect(page.locator('[data-factory-bim]')).toBeVisible();
    await expect(page.locator('[data-factory-bim] canvas')).toBeVisible();
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: workspace runtime, main entries open scene, standalone Factory BIM opens, camera presets and playback scale preserved, no project writes/page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
