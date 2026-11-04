/* eslint-disable @typescript-eslint/no-require-imports -- Runnable browser acceptance check. */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const base = process.env.SCN01_URL || 'http://localhost:3000';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 972 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
    });
    for (const entry of ['/', '/workspace', '/prototype', '/prototype?view=scenario-modeling']) {
      await page.goto(base + entry);
      await expect(page.locator('[data-mass-workspace]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeEnabled({timeout: 30000});
      await expect(page.getByRole('button', {name: /^(Подготовка|Просмотр|Сравнение|AI-черновик|Начать просмотр)$/})).toHaveCount(0);
    }
    const menu = page.getByRole('navigation', { name: 'Режим моделирования' });
    await expect(menu.getByRole('button')).toHaveCount(2);
    await expect(menu.getByRole('button', {name: 'Монте-Карло', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', {name: 'Рассчитать пакет', exact: true}).click();
    await expect(page.locator('[data-batch-result]')).toBeVisible();
    await expect(page.getByLabel('Номер прогона').locator('option')).toHaveCount(100);
    await page.getByLabel('Номер прогона').selectOption('1');
    await expect(page.locator('[data-mass-workspace]')).toHaveAttribute('data-run', '1');
    await page.getByRole('button', {name: '2D', exact: true}).click();
    await expect(page.locator('[data-mass-workspace] [data-view]')).toHaveAttribute('data-view', '2d');
    await page.getByRole('button', {name: 'К следующему срабатыванию', exact: true}).click();
    const eventTime = await page.locator('[data-mass-workspace]').getAttribute('data-time-ms');
    await page.getByRole('button', {name: 'Справочная информация', exact: true}).click();
    const eventDialog = page.getByRole('dialog', {name: 'Справочная информация', exact: true});
    await expect(eventDialog.locator('[data-protection-event]')).toHaveCount(1);
    await eventDialog.getByRole('button', {name: /^Показать срабатывание объекта /}).click();
    await expect(eventDialog).toBeHidden();
    await expect(page.locator('[data-mass-workspace]')).toHaveAttribute('data-time-ms', eventTime);
    fs.mkdirSync('output/playwright/monte-carlo-only', {recursive: true});
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({width, height: 972});
      if (width < 1024) {
        await expect(menu).toBeHidden();
        await page.getByRole('button', {name: 'Меню моделирования', exact: true}).click();
      }
      await menu.getByRole('button', {name: 'Предприятие', exact: true}).click();
      await expect(page.locator('[data-factory-bim], [data-project-overview]')).toBeVisible();
      if (width < 1024) await page.getByRole('button', {name: 'Меню моделирования', exact: true}).click();
      await menu.getByRole('button', {name: 'Монте-Карло', exact: true}).click();
      await expect(page.getByRole('button', {name: 'Пуск', exact: true})).toBeEnabled({timeout: 30000});
      const referenceButton = page.getByRole('button', {name: 'Справочная информация', exact: true});
      await referenceButton.click();
      const reference = page.getByRole('dialog', {name: 'Справочная информация', exact: true});
      await expect(reference).toBeVisible();
      await reference.getByRole('button', {name: 'Закрыть справку', exact: true}).click({trial: true});
      await expect(reference.getByText('Условная зона защиты', {exact: true})).toBeVisible();
      await expect(reference.getByText('Откуда появляются · 360°', {exact: true})).toBeVisible();
      await expect(page.locator('#mass-settings').getByText(/Достижение зелёной границы/)).toHaveCount(0);
      await expect(page.locator('#mass-settings').getByRole('region', {name: /^(Журнал условных срабатываний|Направления входа)$/})).toHaveCount(0);
      await expect(reference.getByRole('region', {name: 'Журнал условных срабатываний', exact: true})).toBeVisible();
      await expect(reference.locator('[data-sector]')).toHaveCount(8);
      const bounds = await reference.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Modal fits ${width}px`);
      if ([375, 1440].includes(width)) await page.screenshot({animations: 'disabled', path: `output/playwright/monte-carlo-only/reference-${width}.png`});
      await page.keyboard.press('Escape');
      await expect(reference).toBeHidden();
      await expect(referenceButton).toBeFocused();
      await referenceButton.click();
      await reference.getByRole('button', {name: 'Закрыть справку', exact: true}).click();
      await expect(reference).toBeHidden();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}px`);
      if ([375, 1440].includes(width)) await page.screenshot({path: `output/playwright/monte-carlo-only/${width}.png`});
    }
    await expect(page.getByRole('button', {name: 'К карте', exact: true})).toHaveCount(0);
    await page.getByTitle('Карта', {exact: true}).click();
    await expect(page.locator('[data-scenario-workspace]')).toHaveCount(0);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: Monte Carlo on all entry routes, no training UI, batch of 100, run selection, 2D, enterprise navigation, responsive layout, reference modal and keyboard focus, exit, no writes/errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
