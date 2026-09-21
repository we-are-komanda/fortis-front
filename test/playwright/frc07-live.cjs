/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in local integration harness. */
const { chromium, expect: playwrightExpect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const finance = require('../fixtures/finance-v1.json');
const expect = playwrightExpect.configure({ timeout: 60000 });
const base = 'http://127.0.0.1:3111', backend = 'http://127.0.0.1:8092';
const out = process.env.FRC07_BROWSER_OUTPUT || '/private/tmp/frc07-live';

(async () => {
  const fixture = await (await fetch(backend + '/__fixture')).json();
  assert.equal(fixture.database.host, '127.0.0.1');
  assert.equal(fixture.database.port, 55434);
  assert.match(fixture.database.dbname, /^frc03_browser_[a-f0-9]+$/);
  const env = JSON.parse(fs.readFileSync(process.env.FRC03_OPERATOR_ENV_FILE, 'utf8'));
  assert.equal(env.APP_DB_DBNAME, fixture.database.dbname);
  const enterpriseName = 'Synthetic FRC07 ' + crypto.randomUUID().slice(0, 8);
  const provisioned = JSON.parse(execFileSync(process.env.FRC03_OPERATOR_BINARY, [
    '-enterprise-id', crypto.randomUUID(), '-user-id', fixture.a.userId, '-name', enterpriseName,
    '-address', 'Synthetic budget fixture', '-latitude', '55.75', '-longitude', '37.62',
  ], { cwd: path.resolve('..', 'backend'), env: { ...process.env, ...env, ENVIRONMENT: 'dev', APP_WORK_MODE: 'enterprise-provision' }, encoding: 'utf8' }));
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const checks = [], consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  let phase = 'login and normal workspace creation', projectId, current;
  const record = (name, detail = {}) => { checks.push({ name, ...detail }); console.log(JSON.stringify(checks.at(-1))); };
  const body = async (response, status = 200) => { assert.equal(response.status(), status, await response.text()); return response.json(); };
  const read = id => page.request.get(base + '/api/defense/projects/' + id).then(r => body(r));
  const budget = (id, version) => page.request.get(base + `/api/v1/projects/budget?projectId=${id}&projectVersion=${version}`).then(r => body(r));
  const check = candidate => page.request.post(base + '/api/v1/projects/budget/check?projectId=' + projectId, { data: { version: current.version, projectJson: JSON.stringify(candidate) } }).then(r => body(r));
  const write = (candidate, status = 200) => page.request.put(base + '/api/defense/projects/' + projectId, { data: { name: candidate.projectName, enterpriseId: candidate.enterpriseId, version: current.version, projectJson: JSON.stringify(candidate) } }).then(r => body(r, status));
  async function commit(candidate, total) {
    const old = current.version;
    const result = await write(candidate);
    assert.equal(result.version, old + 1);
    current = await read(projectId);
    assert.equal((await budget(projectId, current.version)).spentMinor, total);
  }
  async function openMap() {
    await page.goto(base + '/prototype?projectId=' + projectId);
    await expect(page.getByText(`Смета сохранённой версии ${current.version}`, { exact: true })).toBeVisible();
    await page.getByText('Бюджет и расходы', { exact: true }).click();
    await expect(page.getByRole('region', { name: 'Бюджет проекта', exact: true }).getByText(new RegExp(`Лимит сохранённой версии ${current.version}:`))).toBeVisible();
  }
  async function setLimitInUI(rubles, minor) {
    const region = page.getByRole('region', { name: 'Бюджет проекта', exact: true });
    await region.getByLabel('Режим бюджета').selectOption('limited');
    await region.getByLabel('Лимит бюджета, ₽').fill(rubles);
    const old = current.version;
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/v1/projects/budget'),
      region.getByRole('button', { name: 'Сохранить бюджет', exact: true }).click(),
    ]);
    const saved = await body(response);
    assert.equal(saved.version, old + 1);
    assert.equal(saved.budget.config.budgetLimitMinor, minor);
    current = await read(projectId);
    await expect(region.getByText(new RegExp(`Лимит сохранённой версии ${current.version}:`))).toBeVisible();
  }
  try {
    await page.goto(base + '/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.a.email);
    await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(u => u.pathname.replace(/\/$/, '') === '/workspace');
    await page.getByRole('button', { name: new RegExp(enterpriseName) }).click();
    await page.getByRole('textbox', { name: 'Название конфигурации', exact: true }).fill('Synthetic budget integration');
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await page.waitForURL(u => u.pathname.replace(/\/$/, '') === '/prototype' && Boolean(u.searchParams.get('projectId')));
    projectId = new URL(page.url()).searchParams.get('projectId');
    current = await read(projectId);
    assert.equal(current.enterpriseId, provisioned.enterpriseId);
    assert.equal(current.version, 1);
    assert.equal((await budget(projectId, 1)).config.budgetMode, 'unlimited');
    record('Trusted CLI and ordinary UI create an unlimited server project', { projectId, enterpriseId: provisioned.enterpriseId });

    phase = 'authorized synthetic accounting input';
    const seeded = { ...current,
      layers: finance.layers.map((layer, order) => ({ ...layer, code: `CUSTOM-${order}`, order, geometryType: 'ring', geometry: { type: 'ring', center: current.baseObject.center, minRadiusM: order * 500, maxRadiusM: (order + 1) * 500 }, isActive: true, isVisible: true })),
      assetLibrary: finance.assets.map(asset => ({ ...asset, pricePerUnitMln: null, currency: 'RUB', category: 'infrastructure', roles: [], unitLabel: 'шт.', coverageType: 'none', deploymentType: 'static', placementType: 'map-object' })),
      placedObjects: finance.variantA.objects.map((object, index) => ({ ...object, coordinates: { lat: 55.751 + index * 0.001, lng: 37.621 }, status: 'planned', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z' })),
    };
    await commit(seeded, '47500000');
    await openMap();
    await setLimitInUI('500000', '50000000');
    const initialBudgetVersion = current.version;
    assert.equal((await budget(projectId, current.version)).remainingMinor, '2500000');
    const beforeCheck = await read(projectId);
    await page.getByRole('region', { name: 'Бюджет проекта', exact: true }).getByRole('button', { name: 'Проверить текущий проект', exact: true }).click();
    await expect(page.getByText(/Проверка не сохраняет проект и не резервирует бюджет/)).toBeVisible();
    assert.deepEqual(await read(projectId), beforeCheck);
    await page.screenshot({ path: out + '/01-budget-limit.png', fullPage: true });
    record('Actual budget UI sets 500000 RUB over exact saved 475000 RUB; check is read-only', { version: current.version });

    phase = 'one minor excess and equality';
    const candidate = structuredClone(current);
    candidate.placedObjects[2].customPriceMinor = '10000001';
    assert.equal((await check(candidate)).reasonCode, 'budget_exceeded');
    assert.equal((await write(candidate, 422)).error.code, 'budget_exceeded');
    assert.deepEqual(await read(projectId), current);
    candidate.placedObjects[2].customPriceMinor = '10000000';
    assert.equal((await check(candidate)).status, 'allowed');
    await commit(candidate, '50000000');
    assert.equal((await budget(projectId, current.version)).remainingMinor, '0');
    record('One kopeck excess is blocked without mutation; exact equality saves', { version: current.version });

    phase = 'lowering budget and non-increasing overage';
    await openMap();
    await setLimitInUI('400000', '40000000');
    assert.equal((await budget(projectId, current.version)).remainingMinor, '-10000000');
    assert.equal((await budget(projectId, initialBudgetVersion)).config.budgetLimitMinor, '50000000');
    await expect(page.getByText('Сохранённый расход превышает лимит. Допустимы изменения без увеличения этого расхода.', { exact: true })).toBeVisible();
    await page.screenshot({ path: out + '/02-lowered-limit-overage.png', fullPage: true });
    const flat = structuredClone(current);
    flat.placedObjects[0].isVisibleOnMap = false;
    assert.equal((await check(flat)).reasonCode, 'non_increasing_overage');
    await commit(flat, '50000000');
    const reduced = structuredClone(current);
    reduced.placedObjects[2].customPriceMinor = '2500000';
    await commit(reduced, '42500000');
    const increased = structuredClone(current);
    increased.placedObjects[2].customPriceMinor = '3000000';
    assert.equal((await write(increased, 422)).error.code, 'budget_exceeded');
    assert.deepEqual(await read(projectId), current);
    const atLimit = structuredClone(current);
    atLimit.placedObjects[2].customPriceMinor = '0';
    await commit(atLimit, '40000000');
    record('Lower limit creates a version; flat and reducing costs save; increasing overage is rejected', { version: current.version });

    phase = 'normal Save as new copies pinned budget independently';
    await openMap();
    await page.getByTitle('Открыть варианты конфигурации').filter({ visible: true }).click();
    const modal = page.getByRole('dialog', { name: 'Варианты конфигурации', exact: true });
    await modal.getByPlaceholder('Имя нового варианта…').fill('Synthetic independent budget clone');
    const [cloneResponse] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.replace(/\/$/, '') === '/api/defense/projects'),
      modal.getByRole('button', { name: 'Сохранить как новый', exact: true }).click(),
    ]);
    const clone = await body(cloneResponse);
    assert.deepEqual(cloneResponse.request().postDataJSON().budgetSource, { projectId, projectVersion: current.version });
    assert.equal((await budget(clone.projectId, 1)).config.budgetLimitMinor, '40000000');
    await page.waitForURL(u => u.searchParams.get('projectId') === clone.projectId);
    await body(await page.request.put(base + '/api/v1/projects/budget?projectId=' + projectId, { data: { version: current.version, budgetMode: 'limited', budgetLimitMinor: '60000000' } }));
    assert.equal((await budget(clone.projectId, 1)).config.budgetLimitMinor, '40000000');
    current = await read(projectId);
    record('Ordinary Save as new names an accessible pinned source; clone budget stays independent', { sourceProjectId: projectId, sourceVersion: current.version - 1, cloneProjectId: clone.projectId, cloneVersion: 1 });

    phase = 'import ignores embedded financial authority';
    const importedInput = { ...current, projectName: 'Synthetic import authority test', budget: { budgetMode: 'limited', budgetLimitMinor: '1' } };
    const imported = await body(await page.request.post(base + '/api/v1/projects/import', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { projectJson: JSON.stringify(importedInput) } }));
    assert.equal((await budget(imported.projectId, 1)).config.budgetMode, 'unlimited');
    const unknown = structuredClone(current);
    unknown.assetLibrary[1].unitPriceMinor = null;
    assert.equal((await write(unknown, 422)).error.code, 'price_unknown');
    await body(await page.request.put(base + '/api/v1/projects/budget?projectId=' + projectId, { data: { version: current.version, budgetMode: 'unlimited', budgetLimitMinor: null } }));
    current = await read(projectId);
    unknown.version = current.version;
    await commit(unknown, null);
    const incomplete = await budget(projectId, current.version);
    assert.equal(incomplete.status, 'indeterminate');
    assert.equal(incomplete.remainingMinor, null);
    await openMap();
    await expect(page.getByText('Итог неполный: часть цен неизвестна.', { exact: true })).toBeVisible();
    await page.getByTitle('Просчитать конфигурацию в калькуляторе', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Стоимость конфигурации', exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`Сохранённая версия ${current.version}`), { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Бюджет проекта', exact: true }).getByText('Итог неполный: часть цен неизвестна.', { exact: true })).toBeVisible();
    await page.screenshot({ path: out + '/03-unknown-price-unlimited-calculator.png', fullPage: true });
    record('Import is unlimited; limited unknown is rejected; unlimited unknown remains null in real calculator', { importedProjectId: imported.projectId, projectId, version: current.version });

    phase = 'unrelated identity cannot read or check budget';
    const second = await browser.newContext();
    await body(await second.request.post(base + '/api/auth/login', { data: { email: fixture.b.email, password: 'fixture-password-only' } }));
    await body(await second.request.get(base + `/api/v1/projects/budget?projectId=${projectId}&projectVersion=${current.version}`), 404);
    await body(await second.request.post(base + '/api/v1/projects/budget/check?projectId=' + projectId, { data: { version: current.version, projectJson: JSON.stringify(current) } }), 404);
    await second.close();
    record('Second identity cannot obtain budget or candidate price details', { status: 404 });
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(out + '/result.json', JSON.stringify({ status: 'PASS', database: fixture.database.dbname, checks, consoleErrors, pageErrors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {});
    fs.writeFileSync(out + '/failure.json', JSON.stringify({ phase, projectId, version: current?.version, message: String(error), checks, consoleErrors, pageErrors }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
