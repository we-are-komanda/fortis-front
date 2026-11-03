/* eslint-disable @typescript-eslint/no-require-imports -- Runnable local browser acceptance check. */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.SCN01_URL || 'http://localhost:3000';
const output = 'output/playwright/chemical-pilot';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', r => { if (r.url().includes('/api/') && !['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
    await page.addInitScript(() => {
      window.__instanceDraws = [];
      const original = WebGL2RenderingContext.prototype.drawElementsInstanced;
      WebGL2RenderingContext.prototype.drawElementsInstanced = function (...args) {
        if (args[4] === 1000) window.__instanceDraws.push(performance.now());
        return original.apply(this, args);
      };
    });
    const open = async () => {
      await page.goto(base + '/prototype?view=scenario-modeling');
      await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeEnabled();
    };
    await open();
    const root = page.locator('[data-mass-workspace]');
    await expect(page.getByRole('slider', { name: 'Разброс времени' })).toHaveCount(0);
    await page.getByRole('slider', { name: 'Длительность', exact: true }).fill('37');
    await page.getByRole('slider', { name: 'Всего объектов', exact: true }).fill('237');
    await expect(page.getByLabel('Время массового прогона')).toHaveText('00:00 / 37:00');
    await page.getByRole('checkbox', { name: 'Неравномерно по времени', exact: true }).uncheck();
    await expect(page.getByText('Объекты появляются через равные интервалы.', { exact: false })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Неравномерно по времени', exact: true }).check();
    await expect(root).toHaveAttribute('data-time-ms', '0');
    await page.getByRole('button', { name: 'К следующему срабатыванию', exact: true }).click();
    await expect(page.locator('[data-finished]')).toHaveText('1');
    await page.getByRole('button', { name: 'Справочная информация', exact: true }).click();
    await expect(page.locator('[data-protection-event]')).toHaveCount(1);
    const firstEventTime = await root.getAttribute('data-time-ms');
    const firstEventId = await page.locator('[data-protection-event]').getAttribute('data-protection-event');
    await page.getByRole('button', { name: 'Закрыть справку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Справочная информация', exact: true })).toBeHidden();
    await expect(page.locator('[data-protection-notice]')).toBeVisible();
    await page.screenshot({ path: output + '/mass-protection-3d.png' });
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await expect(root).toHaveAttribute('data-time-ms', firstEventTime);
    await expect(page.locator('[data-protection-zone] circle')).toHaveAttribute('r', await root.getAttribute('data-base-object-id') ? '600' : '320');
    await expect(page.locator('[data-protection-signal]')).toHaveCount(1);
    await expect(page.locator('[data-protection-signal]')).toHaveAttribute('data-protection-signal', firstEventId);
    await page.screenshot({ path: output + '/mass-protection-2d.png' });
    await page.getByRole('button', { name: 'В начало', exact: true }).click();
    await page.getByRole('button', { name: 'Справочная информация', exact: true }).click();
    await expect(page.locator('[data-protection-event]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Закрыть справку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Справочная информация', exact: true })).toBeHidden();

    await expect(page.locator('[data-protection-signal]')).toHaveCount(0);
    await page.getByRole('button', { name: 'К следующему срабатыванию', exact: true }).click();
    await expect(root).toHaveAttribute('data-time-ms', firstEventTime);
    await page.getByRole('button', { name: 'Справочная информация', exact: true }).click();
    await expect(page.locator('[data-protection-event]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Закрыть справку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Справочная информация', exact: true })).toBeHidden();

    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.getByRole('button', { name: 'Вписать обзор 360°', exact: true }).click();
    for (const count of [100, 300, 500]) {
      await page.getByLabel('Всего объектов', { exact: true }).fill(String(count));
      await page.getByLabel('Длительность', { exact: true }).fill('90');
      await page.getByLabel('Время сценария', { exact: true }).fill('2700000');
      const total = Number(await root.getAttribute('data-active')) + Number(await page.locator('[data-waiting]').innerText()) + Number(await page.locator('[data-finished]').innerText());
      assert.equal(total, count);
      await page.getByLabel('Время сценария', { exact: true }).fill('5400000');
      await expect(page.locator('[data-finished]')).toHaveText(String(count));
      await expect(root).toHaveAttribute('data-status', 'ended');
      await expect(page.getByLabel('Время массового прогона')).toHaveText('90:00 / 90:00');
    }
    await page.getByLabel('Время сценария', { exact: true }).fill('2700000');
    const originalFrame = await root.getAttribute('data-active');
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await expect(root).toHaveAttribute('data-time-ms', '2700000');
    await expect(root).toHaveAttribute('data-active', originalFrame);
    await expect(page.locator('[data-motion-marker]')).toHaveCount(Number(originalFrame));
    const sectors = await page.locator('[data-motion-marker]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('data-sector')))]);
    assert.ok(sectors.length >= 5, `Only ${sectors.length} directions in visible frame`);
    await expect(page.getByText('А', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Справочная информация', exact: true }).click();
    await expect(page.locator('[data-sector]').filter({ has: page.locator('dt') })).toHaveCount(8);
    await page.getByRole('button', { name: 'Закрыть справку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Справочная информация', exact: true })).toBeHidden();

    await page.getByRole('checkbox', { name: /^(Предприятие|Объект и средства)$/ }).uncheck();
    await expect(page.getByRole('button', { name: 'Приблизить предприятие', exact: true })).toHaveCount(0);
    for (let step = 0; step < 7; step++) await page.getByRole('button', { name: 'Приблизить', exact: true }).click();
    await expect(page.getByText('Дальние объекты вне кадра.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Вписать обзор 360°', exact: true }).click();
    await page.getByRole('checkbox', { name: /^(Предприятие|Объект и средства)$/ }).check();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeEnabled();
    await expect(root).toHaveAttribute('data-time-ms', '2700000');
    const start = Date.now();
    await page.getByRole('button', { name: 'Рассчитать пакет', exact: true }).click();
    await expect(page.locator('[data-batch-result]')).toBeVisible({ timeout: 20000 });
    const batchMs = Date.now() - start;
    const result = await page.locator('[data-batch-result]').innerText();
    await page.getByRole('button', { name: 'Рассчитать пакет', exact: true }).click();
    await expect(page.locator('[data-batch-result]')).toHaveText(result, { useInnerText: true });
    await page.getByLabel('Номер прогона').selectOption('17');
    await expect(root).toHaveAttribute('data-run', '17');
    await page.getByLabel('Время сценария', { exact: true }).fill('2700000');
    const replay = [await root.getAttribute('data-active'), await root.getAttribute('data-seed')];
    await page.getByLabel('Номер прогона').selectOption('0');
    await page.getByLabel('Номер прогона').selectOption('17');
    await page.getByLabel('Время сценария', { exact: true }).fill('2700000');
    assert.deepEqual([await root.getAttribute('data-active'), await root.getAttribute('data-seed')], replay);
    await page.getByRole('button', { name: 'Справочная информация', exact: true }).click();
    await expect(page.getByText('p90 активных:', { exact: false })).toHaveCount(8);
    await page.getByRole('button', { name: 'Закрыть справку', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Справочная информация', exact: true })).toBeHidden();
    await page.screenshot({ path: output + '/mass-360-desktop.png' });
    await page.getByRole('checkbox', { name: 'Неравномерно по времени', exact: true }).uncheck();
    await expect(page.locator('[data-batch-result]')).toHaveCount(0);
    await expect(root).toHaveAttribute('data-time-ms', '0');
    await page.getByRole('checkbox', { name: 'Неравномерно по времени', exact: true }).check();
    await page.getByLabel('Размер пакета', { exact: true }).selectOption('500');
    await expect(page.locator('[data-batch-result]')).toHaveCount(0);
    await expect(root).toHaveAttribute('data-run', '0');
    // One event loop turn guarantees cancellation reaches a live batch, independent of host speed.
    await page.evaluate(() => {
      const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
      button('Рассчитать пакет').click();
      setTimeout(() => button('Отменить')?.click(), 0);
    });
    await expect(page.getByText('Расчёт отменён. Частичные результаты не сохранены.', { exact: true })).toBeVisible();
    await expect(page.locator('[data-batch-result]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Рассчитать пакет', exact: true }).click();
    await expect(page.locator('[data-batch-result]')).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel('Номер прогона').locator('option')).toHaveCount(500);
    await page.getByLabel('Seed', { exact: true }).fill('43');
    await expect(page.locator('[data-batch-result]')).toHaveCount(0);
    await expect(root).toHaveAttribute('data-time-ms', '0');
    await page.getByLabel('Seed', { exact: true }).fill('invalid');
    await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeDisabled();
    await page.getByLabel('Seed', { exact: true }).fill('42');
    await page.getByLabel('Время сценария', { exact: true }).fill('2700000');
    await page.getByRole('button', { name: 'Пуск', exact: true }).click();
    await expect.poll(async () => Number(await root.getAttribute('data-time-ms'))).toBeGreaterThan(2700000);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(root).toHaveAttribute('data-status', 'paused');
    await page.evaluate(() => { delete document.hidden; });
    const beforeLoss = await root.getAttribute('data-time-ms');
    await root.locator('canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(root).toHaveAttribute('data-time-ms', beforeLoss);
    await open();
    // Test-only fixture: replace the generated run through React's dev fiber, without shipping a debug API.
    // All 1000 intervals overlap; this exercises frameAt -> React -> InstancedMesh, not just total N.
    await root.evaluate(el => {
      let fiber = el[Object.keys(el).find(key => key.startsWith('__reactFiber'))];
      while (fiber && fiber.type?.name !== 'MassScenarioWorkspace') fiber = fiber.return;
      for (let hook = fiber?.memoizedState; hook; hook = hook.next) {
        const run = hook.memoizedState?.[0];
        if (run?.objects && 'durationMs' in run) {
          run.objects = Array.from({ length: 1000 }, (_, id) => ({ ...run.objects[id % run.objects.length], id, startMs: id % 100 * 1000, durationMs: 240000, endMs: id % 100 * 1000 + 240000 }));
          return;
        }
      }
      throw new Error('Dev fixture could not locate generated run');
    });
    await page.getByLabel('Время сценария', { exact: true }).fill('120000');
    await expect(root).toHaveAttribute('data-active', '1000');
    await expect.poll(() => page.evaluate(() => window.__instanceDraws.length)).toBeGreaterThan(0);
    await page.getByLabel('Скорость просмотра').selectOption('1');
    await page.getByRole('button', { name: 'Пуск', exact: true }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    const stressDraws = await page.evaluate(() => window.__instanceDraws.length);
    assert.ok(stressDraws > 10, `Only ${stressDraws} actual draws`);
    await page.screenshot({ path: output + '/mass-360-stress-1000.png' });
    await open();
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'К следующему срабатыванию', exact: true }).click();
    for (const width of [788, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
      await expect(page.getByRole('button', { name: 'Параметры и результаты Монте-Карло', exact: true })).toBeVisible();
      await page.screenshot({ path: `${output}/mass-360-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Параметры и результаты Монте-Карло', exact: true }).click();
      await expect(page.getByLabel('Всего объектов', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Скрыть настройки · к сцене', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Меню моделирования', exact: true }).click();
    await page.getByRole('button', { name: 'Предприятие', exact: true }).click();
    await expect(page.locator('[data-factory-bim], [data-project-overview]')).toBeVisible();
    await page.getByRole('button', { name: 'Меню моделирования', exact: true }).click();
    await page.getByRole('button', { name: 'Монте-Карло', exact: true }).click();
    await expect(root).toHaveAttribute('data-time-ms', '0');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log(JSON.stringify({ status: 'PASS', batch100x500Ms: batchMs, actual1000InstanceDrawsDuring2s: stressDraws, checks: 'conditional boundary signal/journal/seek/reset/replay, 100/300/500, 90min, exact counters, complete/cancel/invalidated batches, 2D/3D, hidden pause, context loss, 1000 concurrent render, 390/788/1440 layout, no API writes/errors' }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
