/* eslint-disable @typescript-eslint/no-require-imports -- Runnable local UI check. */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1068, height: 977 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
    await page.goto(process.env.SIDEBAR_URL || 'http://localhost:3000/prototype?projectId=4af1deb7-79ff-4cd2-ae31-c31dcc6a28a2');
    const panel = page.locator('#fortis-gis-library-panel');
    const close = page.getByRole('button', { name: 'Свернуть боковую панель', exact: true });
    const open = page.getByRole('button', { name: 'Развернуть боковую панель', exact: true });
    const search = page.getByPlaceholder('Найти средство...');
    await expect(page.getByRole('link', { name: 'Factory BIM · 3D-модель', exact: true })).toHaveCount(0);
    fs.mkdirSync('output/playwright/sidebar-collapse', { recursive: true });
    for (const width of [1068, 390]) {
      await page.setViewportSize({ width, height: 977 });
      await expect(close).toBeVisible();
      await expect(panel.getByRole('button', { name: '3D-модель', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Моделирование', exact: true })).toBeVisible();
      await search.fill('РЛС');
      await close.click();
      await expect(panel).toHaveAttribute('data-sidebar-state', 'closed');
      await expect(panel).toHaveAttribute('inert', '');
      await expect(open).toBeFocused();
      await expect.poll(async () => {
        const box = await panel.boundingBox();
        return width >= 1024 ? box.width : box.height;
      }).toBeLessThan(3);
      await page.screenshot({ path: `output/playwright/sidebar-collapse/closed-${width}.png` });
      await open.press('Enter');
      await expect(panel).toHaveAttribute('data-sidebar-state', 'open');
      await expect(close).toBeFocused();
      await expect(search).toHaveValue('РЛС');
      await search.fill('');
      await expect.poll(async () => (await panel.boundingBox()).height).toBeGreaterThan(300);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
      await page.screenshot({ path: `output/playwright/sidebar-collapse/open-${width}.png` });
    }
    await page.getByRole('link', { name: 'Моделирование', exact: true }).click();
    const scenario = page.locator('[data-scenario-workspace]');
    await expect(scenario).toBeVisible();
    await expect(scenario.getByRole('button', { name: 'Осмотреть объект', exact: true })).toHaveCount(0);
    await expect(scenario.getByRole('heading', { name: 'Подготовленные записи', exact: true })).toHaveCount(0);
    await expect(scenario.getByRole('heading', { name: 'Площадка сценария', exact: true })).toHaveCount(0);
    await expect(scenario.getByRole('combobox', { name: 'Объект предприятия', exact: true })).toHaveCount(0);
    await expect(scenario.getByRole('checkbox', { name: 'Рельеф', exact: true })).toBeVisible();
    await page.screenshot({ path: 'output/playwright/sidebar-collapse/scenario-cleanup-mobile.png' });
    await expect(page.getByRole('link', { name: 'Сценарии', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-factory-bim]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Моделирование', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.setViewportSize({ width: 1068, height: 977 });
    await expect(page.getByRole('link', { name: 'Моделирование', exact: true })).toHaveAttribute('aria-current', 'page');
    assert.equal(new URL(page.url()).searchParams.get('view'), 'scenario-modeling');
    assert.equal(new URL(page.url()).searchParams.get('projectId'), new URL(process.env.SIDEBAR_URL || 'http://localhost:3000/prototype?projectId=4af1deb7-79ff-4cd2-ae31-c31dcc6a28a2').searchParams.get('projectId'));
    await page.screenshot({ path: 'output/playwright/sidebar-collapse/scenario-modeling-navigation.png' });
    await scenario.getByRole('button', { name: 'Сравнение', exact: true }).click();
    await expect(scenario.getByRole('combobox', { name: 'Левая запись', exact: true })).toBeVisible();
    await expect(scenario.getByRole('combobox', { name: 'Правая запись', exact: true })).toBeVisible();
    await scenario.getByRole('button', { name: 'Массовый прогон', exact: true }).click();
    await expect(page.locator('[data-mass-workspace]')).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log('PASS: header collapse, map reopen, keyboard focus, preserved search, inert hidden content, 1068/390 layouts, Modeling navigation opens scenario workspace and preserves projectId, no API writes/page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
