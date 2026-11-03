/* eslint-disable @typescript-eslint/no-require-imports -- This opt-in Node harness runs as CommonJS. */
// Opt-in only: disposable FRC03 browser backend + actual local operator executable.
const { chromium, expect: browserExpect } = require('../../node_modules/@playwright/test');
const expect = browserExpect.configure({ timeout: 30000 });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const base = process.env.FRC03_BROWSER_BASE_URL || 'http://127.0.0.1:3111';
const backend = process.env.FRC03_BACKEND_URL || 'http://127.0.0.1:8092';
const out = process.env.FRC03_BROWSER_OUTPUT || '/private/tmp/frc03-live';
const checks = [], consoleRecords = [], pageErrors = [];
let phase = 'startup';

(async () => {
  assert.ok(process.env.FRC03_OPERATOR_BINARY, 'Set the built operator executable');
  assert.ok(process.env.FRC03_OPERATOR_ENV_FILE, 'Set the private synthetic database environment JSON file');
  const operatorEnv = JSON.parse(fs.readFileSync(process.env.FRC03_OPERATOR_ENV_FILE, 'utf8'));
  assert.equal(operatorEnv.APP_DB_HOST, '127.0.0.1');
  assert.equal(String(operatorEnv.APP_DB_PORT), '55434');
  assert.match(operatorEnv.APP_DB_DBNAME, /^frc03_[a-z0-9_]+$/);
  fs.mkdirSync(out, { recursive: true });
  const fixtureResponse = await fetch(backend + '/__fixture');
  assert.equal(fixtureResponse.status, 200);
  const fixture = await fixtureResponse.json();
  assert.equal(fixture.database.dbname, operatorEnv.APP_DB_DBNAME, 'CLI and browser must use the same disposable database');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleRecords.push({ type: message.type(), message: message.text() }); });
  page.on('dialog', dialog => dialog.accept());
  const record = (name, detail = {}) => { const check = { name, ...detail }; checks.push(check); console.log(JSON.stringify(check)); };
  const screenshot = name => page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  async function login(email) {
    await page.goto(base + '/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/workspace');
  }
  async function readProject(id) {
    const response = await page.request.get(base + '/api/defense/projects/' + id);
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  }
  function provision(name) {
    const output = execFileSync(process.env.FRC03_OPERATOR_BINARY, [
      '-enterprise-id', crypto.randomUUID(), '-user-id', fixture.a.userId, '-name', name, '-address', 'Synthetic test address',
      '-latitude', '55.75', '-longitude', '37.62',
    ], { cwd: path.resolve('..', 'backend'), env: { ...process.env, ...operatorEnv, ENVIRONMENT: 'dev', APP_WORK_MODE: 'enterprise-provision' }, encoding: 'utf8' });
    const result = JSON.parse(output.trim());
    assert.equal(result.userId, fixture.a.userId);
    assert.ok(result.enterpriseId);
    return result;
  }
  try {
    phase = 'honest empty workspace';
    await login(fixture.a.email);
    await expect(page.getByText('Нет доступных предприятий.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeDisabled();
    const before = await page.request.get(base + '/api/v1/enterprises?limit=100&offset=0');
    assert.equal(before.status(), 200);
    assert.deepEqual((await before.json()).items, []);
    await screenshot('01-no-memberships');
    record('No membership shows empty state and disabled creation');

    phase = 'trusted local operator provisioning';
    const name = 'Synthetic FRC03 enterprise ' + crypto.randomUUID().slice(0, 8);
    const provisioning = provision(name);
    const enterpriseId = provisioning.enterpriseId;
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeEnabled();
    const enterprises = await (await page.request.get(base + '/api/v1/enterprises?limit=100&offset=0')).json();
    assert.deepEqual(enterprises.items.map(item => item.id), [enterpriseId]);
    assert.equal(enterprises.items[0].latitude, 55.75);
    assert.equal(enterprises.items[0].longitude, 37.62);
    await screenshot('02-after-operator-refresh');
    record('Operator CLI created enterprise and membership; Refresh reads actual scoped access', { enterpriseId, userId: fixture.a.userId });

    phase = 'first project via normal UI';
    const projectName = 'Synthetic first configuration';
    await page.getByRole('textbox', { name: 'Название конфигурации', exact: true }).fill(projectName);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/prototype' && Boolean(url.searchParams.get('projectId')));
    const projectId = new URL(page.url()).searchParams.get('projectId');
    assert.ok(projectId);
    const created = await readProject(projectId);
    assert.equal(created.enterpriseId, enterpriseId);
    assert.equal(created.version, 1);
    assert.equal(created.projectName, projectName);
    assert.equal(created.baseObject.id, enterpriseId);
    assert.deepEqual(created.layers, []);
    assert.deepEqual(created.placedObjects, []);
    assert.deepEqual(created.assetLibrary, []);
    await expect(page.getByText('Смета сохранённой версии 1', { exact: true })).toBeVisible();
    record('Normal workspace Create opens authoritative empty project', { projectId, enterpriseId, version: 1 });

    phase = 'real map business edit and explicit save';
    await page.getByRole('button', { name: /Добавить эшелон$/ }).click();
    await expect(page.getByRole('heading', { name: 'Создание эшелона', exact: true })).toBeVisible();
    await page.getByLabel('Код', { exact: true }).fill('L1');
    await page.getByLabel('Название', { exact: true }).fill('Synthetic UI layer');
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(page.getByTitle('Открыть варианты конфигурации').filter({ visible: true })).toContainText(/есть несохранённые изменения/i);
    assert.equal((await readProject(projectId)).version, 1, 'UI edit must not autosave');
    const save = page.getByRole('button', { name: 'Сохранить текущий вариант', exact: true });
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname.replace(/\/$/, '') === '/api/defense/projects/' + projectId),
      save.focus().then(() => save.press('Enter')),
    ]);
    assert.equal(response.status(), 200, await response.text());
    assert.equal((await response.json()).version, 2);
    const saved = await readProject(projectId);
    assert.equal(saved.version, 2);
    assert.equal(saved.layers.length, 1);
    assert.equal(saved.layers[0].name, 'Synthetic UI layer');
    const savedHash = crypto.createHash('sha256').update(JSON.stringify(saved)).digest('hex');
    await page.reload();
    await expect(page.getByText('Смета сохранённой версии 2', { exact: true })).toBeVisible();
    await expect(page.getByTitle('L1 · Synthetic UI layer', { exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('projectId'), projectId);
    assert.deepEqual(await readProject(projectId), saved, 'Canonical server project must remain exactly the saved configuration');
    await screenshot('03-saved-project-reloaded');
    record('UI business edit saved v2 and reload preserves ID/version/canonical content', { projectId, version: 2, savedHash, layerId: saved.layers[0].id });

    phase = 'logout login continuity';
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/login');
    await login(fixture.a.email);
    await page.getByRole('button').filter({ hasText: projectName }).click();
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/prototype' && url.searchParams.get('projectId') === projectId);
    await expect(page.getByText('Смета сохранённой версии 2', { exact: true })).toBeVisible();
    assert.deepEqual(await readProject(projectId), saved);
    record('Logout and login return to the same saved project', { projectId, version: 2 });

    phase = 'real server pagination and empty second enterprise';
    // Only after the normal UI vertical gate: create disposable pagination fixtures through the authorized API.
    for (let index = 0; index < 120; index++) {
      const fixtureName = 'Pagination fixture ' + String(index).padStart(3, '0');
      const project = { ...created, projectId: 'current', version: undefined, source: 'custom', projectName: fixtureName };
      const seeded = await page.request.post(base + '/api/defense/projects', {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        data: { name: fixtureName, enterpriseId, projectJson: JSON.stringify(project) },
      });
      assert.equal(seeded.status(), 200, await seeded.text());
    }
    await page.goto(base + '/workspace');
    await expect(page.getByText('Всего: 121', { exact: true })).toBeVisible();
    await expect(page.getByText('1–50 из 121', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByText('51–100 из 121', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await expect(page.getByText('101–121 из 121', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Следующая страница', exact: true })).toBeDisabled();
    await expect(page.getByRole('button').filter({ hasText: /^Pagination fixture/ })).toHaveCount(20);
    await expect(page.getByRole('button').filter({ hasText: projectName })).toHaveCount(1);
    await screenshot('04-real-pagination-121');
    const emptyName = 'Synthetic empty FRC03 enterprise';
    const emptyEnterprise = provision(emptyName);
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(emptyName) }).click();
    await expect(page.getByText('Всего: 0', { exact: true })).toBeVisible();
    await expect(page.getByRole('button').filter({ hasText: /^Pagination fixture/ })).toHaveCount(0);
    await expect(page.getByRole('button').filter({ hasText: projectName })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeEnabled();
    const emptyList = await (await page.request.get(base + '/api/defense/projects?enterpriseId=' + emptyEnterprise.enterpriseId + '&limit=50&offset=0')).json();
    assert.equal(emptyList.totalItems, 0);
    assert.deepEqual(emptyList.items, []);
    await screenshot('05-empty-second-enterprise');
    await page.setViewportSize({ width: 375, height: 960 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Workspace must fit mobile viewport');
    await screenshot('05-empty-second-enterprise-mobile');
    await page.setViewportSize({ width: 1440, height: 960 });
    record('Real filtered pagination reaches all 121 projects; empty enterprise has no fallback', { totalItems: 121, pages: ['1–50', '51–100', '101–121'], emptyEnterpriseId: emptyEnterprise.enterpriseId });

    phase = 'second user isolation';
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/login');
    await login(fixture.b.email);
    await expect(page.getByText('Нет доступных предприятий.', { exact: true })).toBeVisible();
    const foreign = await page.request.get(base + '/api/defense/projects/' + projectId);
    assert.equal(foreign.status(), 404);
    const secondEnterprises = await (await page.request.get(base + '/api/v1/enterprises?limit=100&offset=0')).json();
    const secondProjects = await (await page.request.get(base + '/api/defense/projects?limit=100&offset=0')).json();
    assert.deepEqual(secondEnterprises.items, []);
    assert.deepEqual(secondProjects.items, []);
    await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeDisabled();
    await screenshot('06-second-user-isolated');
    record('Second identity cannot list or read first user enterprise/project', { foreignStatus: 404 });
    assert.deepEqual(pageErrors, []);
    const unexpected = consoleRecords.filter(item => item.type === 'error');
    assert.deepEqual(unexpected, []);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: 'PASS', checks, pageErrors, consoleRecords }, null, 2));
  } catch (error) {
    await screenshot('failure').catch(() => {});
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ phase, message: String(error), checks, pageErrors, consoleRecords }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
