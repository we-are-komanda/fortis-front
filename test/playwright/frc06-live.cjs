// Opt-in: Next3111 + TestFRC02BrowserServer8092 + disposable PostgreSQL only.
// Browser plugin not available; use the repository's installed Playwright.
const { chromium, expect } = require('../../node_modules/@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const base = process.env.FRC06_BROWSER_BASE_URL || 'http://127.0.0.1:3111';
const out = process.env.FRC06_BROWSER_OUTPUT || '/private/tmp/frc06-live';
const layerId = 'frc06-layer-l1';
const layerName = 'Synthetic FRC06 layer';
const checks = [];
const errors = [];
const requests = [];
let phase = 'startup';

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push({ kind: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) errors.push({ kind: message.type(), message: message.text() });
  });
  page.on('dialog', dialog => dialog.accept());
  page.on('response', response => {
    if (response.url().startsWith(base + '/api/')) requests.push({ method: response.request().method(), url: new URL(response.url()).pathname, status: response.status() });
  });
  const record = (name, detail = {}) => { checks.push({ name, ...detail }); console.log(JSON.stringify(checks.at(-1))); };
  const screenshot = name => page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  const layer = project => project.layers.find(item => item.id === layerId);
  const layerCard = () => page.locator('[data-selected]').filter({ has: page.getByTitle('L1 · ' + layerName, { exact: true }) });
  const toggle = async name => {
    await expect(layerCard()).toHaveCount(1);
    await layerCard().getByRole('button', { name, exact: true }).click();
    await expect(page.getByTitle('Открыть варианты конфигурации').filter({ visible: true })).toContainText(/есть несохранённые изменения/i);
  };
  async function readProject(id) {
    const response = await page.request.get(base + '/api/defense/projects/' + id);
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  }
  async function save(id, version, visible) {
    const control = page.getByRole('button', { name: 'Сохранить текущий вариант', exact: true });
    console.log(JSON.stringify({ phase: 'save control', box: await control.boundingBox(), enabled: await control.isEnabled() }));
    const [response] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.replace(/\/$/, '') === '/api/defense/projects/' + id),
      control.focus().then(() => control.press("Enter")),
    ]);
    assert.equal(response.status(), 200, await response.text());
    const receipt = await response.json();
    assert.equal(receipt.projectId, id);
    assert.equal(receipt.version, version);
    const saved = await readProject(id);
    assert.equal(saved.projectId, id);
    assert.equal(saved.version, version);
    assert.equal(layer(saved).isVisible, visible);
    await expect(page.getByTitle('Открыть варианты конфигурации').filter({ visible: true })).not.toContainText(/есть несохранённые изменения/i);
    return saved;
  }

  try {
    phase = 'login and synthetic fixture';
    const fixtureResponse = await fetch('http://127.0.0.1:8092/__fixture');
    assert.equal(fixtureResponse.status, 200);
    const fixture = await fixtureResponse.json();
    const runtime = await (await page.request.get(base + '/api/runtime')).json();
    assert.equal(runtime.localDraftsEnabled, true, 'Recovery acceptance requires explicit FORTIS_LOCAL_DRAFTS_ENABLED=true');
    await page.goto(base + '/login');
    await page.getByLabel('Email', { exact: true }).fill('B@example.test');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/workspace');

    const project = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/frc04-project.json'), 'utf8'));
    project.projectName = 'Synthetic FRC06 browser ' + crypto.randomUUID().slice(0, 8);
    project.enterpriseId = fixture.b.enterpriseId;
    project.baseObject.id = fixture.b.enterpriseId;
    project.layers = [{ ...project.layers[1], id: layerId, code: 'L1', name: layerName, isVisible: true, isLocked: false, isActive: true }];
    project.activeLayerId = layerId;
    project.mode = 'edit';
    project.assetLibrary[0] = { ...project.assetLibrary[0], iconUrl: '/file.svg', unitPriceMinor: '12500000', pricePerUnitMln: 0.125, compoundProfile: undefined, weaponSpec: undefined, detectionSpec: undefined, ewSpec: undefined, compatibleLayerCodes: ['L1'], recommendedLayerCodes: ['L1'], enterpriseId: fixture.b.enterpriseId };
    project.placedObjects[0] = { ...project.placedObjects[0], layerId, customPricePerUnitMln: undefined, compoundProfile: undefined };
    delete project.selectedObjectId;
    const created = await page.request.post(base + '/api/defense/projects', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { name: project.projectName, enterpriseId: fixture.b.enterpriseId, projectJson: JSON.stringify(project) } });
    assert.equal(created.status(), 200, await created.text());
    const summary = await created.json();
    const id = summary.projectId;
    assert.ok(id);
    assert.equal(summary.version, 1);
    await page.goto(base + '/prototype?projectId=' + id);
    await expect(page.getByRole('button', { name: 'Сохранить текущий вариант', exact: true })).toBeVisible();
    await expect(page.getByText('Смета сохранённой версии 1', { exact: true })).toBeVisible();
    record('seeded real project', { projectId: id, enterpriseId: fixture.b.enterpriseId, version: 1 });

    phase = 'UI edit save and reload';
    await toggle('Скрыть эшелон');
    const unchanged = await readProject(id);
    assert.equal(unchanged.version, 1);
    assert.equal(layer(unchanged).isVisible, true);
    await save(id, 2, false);
    await page.reload();
    await expect(layerCard().getByRole('button', { name: 'Показать эшелон', exact: true })).toBeVisible();
    await expect(page.getByText('Смета сохранённой версии 2', { exact: true })).toBeVisible();
    await screenshot('01-saved-reloaded');
    record('UI visibility change saved and survived reload', { projectId: id, version: 2, visible: false });

    phase = 'map calculator dirty draft';
    await toggle('Показать эшелон');
    await page.getByTitle('Просчитать конфигурацию в калькуляторе').click();
    await expect(page.getByRole('heading', { name: 'Стоимость конфигурации', exact: true })).toBeVisible();
    await expect(page.getByText('Черновой расчёт — изменения не сохранены', { exact: true })).toBeVisible();
    await expect(page.getByText('1 позиций · 2 единиц', { exact: true })).toBeVisible();
    await screenshot('02-dirty-calculator');
    await page.getByRole('link', { name: '← Карта', exact: true }).click();
    await page.waitForURL('**/prototype?projectId=' + id);
    await expect(layerCard().getByRole('button', { name: 'Скрыть эшелон', exact: true })).toBeVisible();
    await expect(page.getByTitle('Открыть варианты конфигурации').filter({ visible: true })).toContainText(/есть несохранённые изменения/i);
    assert.equal((await readProject(id)).version, 2);
    record('map calculator map preserves unsaved visibility and identity', { projectId: id, serverVersion: 2 });

    phase = 'explicit recovery after reload';
    await expect.poll(() => page.evaluate(({ userId, enterpriseId, projectId, layerId }) => {
      const value = localStorage.getItem(['fortis:draft', userId, enterpriseId, projectId].map((part, index) => index ? encodeURIComponent(part) : part).join(':'));
      return value ? JSON.parse(value).draft?.layers?.find(item => item.id === layerId)?.isVisible : null;
    }, { userId: fixture.b.userId, enterpriseId: fixture.b.enterpriseId, projectId: id, layerId })).toBe(true);
    await page.reload();
    await expect(layerCard().getByRole('button', { name: 'Показать эшелон', exact: true })).toBeVisible();
    await page.getByTitle('Открыть варианты конфигурации').filter({ visible: true }).click();
    const modal = page.getByRole('dialog', { name: 'Варианты конфигурации', exact: true });
    await expect(modal.getByText('Найден локальный несохранённый черновик', { exact: true })).toBeVisible();
    await screenshot('03-recovery-offered');
    await modal.getByRole('button', { name: 'Восстановить', exact: true }).click();
    await expect(modal.getByText('Найден локальный несохранённый черновик', { exact: true })).toHaveCount(0);
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(layerCard().getByRole('button', { name: 'Скрыть эшелон', exact: true })).toBeVisible();
    assert.equal(layer(await readProject(id)).isVisible, false);
    await save(id, 3, true);
    record('recovery is explicit and only Save writes recovered content', { projectId: id, version: 3 });

    phase = 'real conflict and save as new';
    await toggle('Скрыть эшелон');
    const concurrent = await readProject(id);
    layer(concurrent).name = 'Concurrent saved layer';
    const advanced = await page.request.put(base + '/api/defense/projects/' + id, { data: { name: project.projectName, enterpriseId: fixture.b.enterpriseId, version: 3, projectJson: JSON.stringify(concurrent) } });
    assert.equal(advanced.status(), 200, await advanced.text());
    assert.equal((await advanced.json()).version, 4);
    const conflictControl = page.getByRole('button', { name: 'Сохранить текущий вариант', exact: true });
    const [conflictResponse] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/api/defense/projects/' + id)),
      conflictControl.focus().then(() => conflictControl.press('Enter')),
    ]);
    assert.equal(conflictResponse.status(), 409);
    await page.getByTitle('Открыть варианты конфигурации').filter({ visible: true }).click();
    await expect(modal.getByRole('button', { name: 'Перезагрузить актуальную версию', exact: true })).toBeVisible();
    await screenshot('04-conflict-retains-draft');
    const forkName = project.projectName + ' recovered copy';
    await modal.getByPlaceholder('Имя нового варианта…', { exact: true }).fill(forkName);
    const [forkResponse] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/defense/projects')),
      modal.getByRole('button', { name: 'Сохранить как новый', exact: true }).click(),
    ]);
    assert.equal(forkResponse.status(), 200, await forkResponse.text());
    const fork = await forkResponse.json();
    assert.notEqual(fork.projectId, id);
    assert.equal(fork.version, 1);
    const forkProject = await readProject(fork.projectId);
    assert.equal(layer(forkProject).isVisible, false);
    assert.equal(layer(forkProject).name, layerName);
    const original = await readProject(id);
    assert.equal(original.version, 4);
    assert.equal(layer(original).name, 'Concurrent saved layer');
    assert.equal(layer(original).isVisible, true);
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTitle('Открыть варианты конфигурации').filter({ visible: true })).toContainText(forkName);
    await screenshot('05-saved-as-new');
    record('409 retains draft; save-as-new creates independent version 1', { originalId: id, originalVersion: 4, newId: fork.projectId, version: 1, url: page.url() });
    phase = 'save as new reload identity';
    await expect.poll(() => new URL(page.url()).searchParams.get('projectId')).toBe(fork.projectId);
    await page.reload();
    await expect(page.getByText('Смета сохранённой версии 1', { exact: true })).toBeVisible();
    await expect(layerCard().getByRole('button', { name: 'Показать эшелон', exact: true })).toBeVisible();
    const reloaded = await readProject(new URL(page.url()).searchParams.get('projectId'));
    assert.equal(reloaded.projectId, fork.projectId);
    assert.equal(reloaded.version, 1);
    assert.equal(layer(reloaded).name, layerName);
    assert.equal(layer(reloaded).isVisible, false);
    await screenshot('06-saved-as-new-reloaded');
    record('saved-as-new identity survives reload', { projectId: reloaded.projectId, version: reloaded.version, variantLabel: await page.getByTitle('Открыть варианты конфигурации').filter({ visible: true }).innerText() });

    const knownDeckErrors = errors.filter(error => /duplicate.*(id|layer)|already exists|duplicate layer/i.test(error.message));
    const knownWarnings = errors.filter(error => /^Warning: \[antd: Alert\] `message` is deprecated/.test(error.message));
    const relevantErrors = errors.filter(error => !knownDeckErrors.includes(error) && !knownWarnings.includes(error) && !/Failed to load resource.*409/.test(error.message));
    assert.deepEqual(relevantErrors.filter(error => error.kind === 'pageerror' || error.kind === 'error'), []);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'PASS', checks, console: errors, knownDeckErrors, knownWarnings, requests, screenshots: out }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', checks: checks.length, pageErrors: relevantErrors.filter(error => error.kind === 'pageerror'), knownDeckErrors: knownDeckErrors.length, output: out }));
  } catch (error) {
    await screenshot('failure').catch(() => {});
    fs.writeFileSync(path.join(out, 'failure.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable'));
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'FAIL', phase, error: String(error), checks, console: errors, requests }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
