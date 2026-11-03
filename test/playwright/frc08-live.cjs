/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in real local comparison gate. */
const { chromium, expect: browserExpect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const finance = require('../fixtures/finance-v1.json');
const expect = browserExpect.configure({ timeout: 60000 });
const base = 'http://127.0.0.1:3111', backend = 'http://127.0.0.1:8092';
const out = process.env.FRC08_BROWSER_OUTPUT || '/private/tmp/frc08-live';

(async () => {
  const fixture = await (await fetch(backend + '/__fixture')).json();
  assert.equal(fixture.database.host, '127.0.0.1');
  assert.equal(fixture.database.port, 55434);
  assert.match(fixture.database.dbname, /^frc03_browser_[a-f0-9]+$/);
  const env = JSON.parse(fs.readFileSync(process.env.FRC03_OPERATOR_ENV_FILE, 'utf8'));
  assert.equal(env.APP_DB_DBNAME, fixture.database.dbname);
  const enterpriseName = 'Synthetic FRC08 ' + crypto.randomUUID().slice(0, 8);
  const provisioned = JSON.parse(execFileSync(process.env.FRC03_OPERATOR_BINARY, [
    '-enterprise-id', crypto.randomUUID(), '-user-id', fixture.a.userId, '-name', enterpriseName,
    '-address', 'Synthetic comparison fixture', '-latitude', '55.75', '-longitude', '37.62',
  ], { cwd: path.resolve('..', 'backend'), env: { ...process.env, ...env, ENVIRONMENT: 'dev', APP_WORK_MODE: 'enterprise-provision' }, encoding: 'utf8' }));
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(30000);
  const checks = [], consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  const record = (name, detail = {}) => { checks.push({ name, ...detail }); console.log(JSON.stringify(checks.at(-1))); };
  const body = async (r, expected = 200) => { assert.equal(r.status(), expected, await r.text()); return r.json(); };
  const read = id => page.request.get(base + '/api/defense/projects/' + id).then(r => body(r));
  function project(variant, name) {
    const center = { lat: 55.75, lng: 37.62 };
    const provenance = { sourceLabel: 'Synthetic accounting fixture', sourceDocumentId: null, sourceUrl: null, sourceDate: '2026-09-20', recordedAt: '2026-09-20T00:00:00Z', recordedBy: fixture.a.userId, quality: 'estimated', revision: '1' };
    return { schemaVersion: 1, projectId: 'current', projectName: name, enterpriseId: provisioned.enterpriseId, baseObject: { id: provisioned.enterpriseId, name: enterpriseName, center }, mode: 'view', source: 'custom', updatedAt: '2026-09-20T00:00:00Z',
      layers: finance.layers.map((layer, order) => ({ ...layer, code: `CUSTOM-${order}`, order, geometryType: 'ring', geometry: { type: 'ring', center, minRadiusM: order * 500, maxRadiusM: (order + 1) * 500 }, isActive: true, isVisible: true })),
      assetLibrary: finance.assets.map(asset => ({ ...asset, provenance, pricePerUnitMln: null, currency: 'RUB', category: 'infrastructure', roles: [], unitLabel: 'шт.', coverageType: 'none', deploymentType: 'static', placementType: 'map-object' })),
      placedObjects: variant.objects.map((object, index) => ({ ...object, coordinates: { lat: 55.751 + index * 0.001, lng: 37.621 }, status: 'planned', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z' })),
    };
  }
  async function create(value) {
    const result = await body(await page.request.post(base + '/api/defense/projects', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { name: value.projectName, enterpriseId: provisioned.enterpriseId, projectJson: JSON.stringify(value) } }));
    return read(result.projectId);
  }
  async function update(value) {
    await body(await page.request.put(base + '/api/defense/projects/' + value.projectId, { data: { name: value.projectName, enterpriseId: value.enterpriseId, version: value.version, projectJson: JSON.stringify(value) } }));
    return read(value.projectId);
  }
  const compare = (a, b, expected = 200, request = page.request) => request.get(base + '/api/v1/projects/compare?' + new URLSearchParams({ projectIdA: a.projectId, projectVersionA: String(a.version), projectIdB: b.projectId, projectVersionB: String(b.version) })).then(r => body(r, expected));
  let phase = 'login and synthetic revision fixtures';
  try {
    await page.goto(base + '/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.a.email);
    await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(u => u.pathname.replace(/\/$/, '') === '/workspace');
    let a = await create(project(finance.variantA, 'Synthetic comparison A'));
    let b = await create(project(finance.variantB, 'Synthetic comparison B'));
    await body(await page.request.put(base + '/api/v1/projects/budget?projectId=' + a.projectId, { data: { version: a.version, budgetMode: 'limited', budgetLimitMinor: '50000000' } }));
    a = await read(a.projectId);
    while (a.version < 7) a = await update({ ...a, projectName: 'Synthetic comparison A' });
    while (b.version < 3) b = await update({ ...b, projectName: 'Synthetic comparison B' });
    const result = await compare(a, b);
    assert.equal(result.a.identity.projectVersion, 7);
    assert.equal(result.b.identity.projectVersion, 3);
    assert.equal(result.a.cost.totalMinor, '47500000');
    assert.equal(result.b.cost.totalMinor, '55000000');
    assert.equal(result.differenceMinor, '7500000');
    assert.equal(result.differencePercent, '15.79');
    assert.equal(result.a.budget.remainingMinor, '2500000');
    assert.equal(result.b.budget.config.budgetMode, 'unlimited');
    fs.writeFileSync(out + '/comparison-a7-b3.json', JSON.stringify(result, null, 2));
    record('Real immutable A7/B3 gives475000/550000 RUB and75000/15.79% difference', { a: result.a.identity, b: result.b.identity });

    phase = 'ordinary workspace comparison';
    await page.reload();
    await page.getByRole('button', { name: new RegExp(enterpriseName) }).click();
    await page.getByLabel('Первая конфигурация', { exact: true }).selectOption(a.projectId);
    await page.getByLabel('Вторая конфигурация', { exact: true }).selectOption(b.projectId);
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.replace(/\/$/, '') === '/api/v1/projects/compare'),
      page.getByRole('button', { name: 'Сравнить', exact: true }).click(),
    ]);
    assert.deepEqual(await body(response), result);
    const region = page.getByRole('region', { name: 'Результат сравнения', exact: true });
    await expect(region).toBeVisible();
    await expect(region.getByRole('region', { name: 'Вариант A', exact: true })).toContainText(/475\s*000/);
    await expect(region.getByRole('region', { name: 'Вариант B', exact: true })).toContainText(/550\s*000/);
    await expect(region).toContainText('15,79');
    await region.screenshot({ path: out + '/01-comparison-a7-b3.png' });
    record('Ordinary workspace controls request explicit versions and render authoritative comparison');

    phase = 'current update cannot move pinned comparison';
    const changed = structuredClone(a);
    changed.placedObjects[2].customPriceMinor = '5000000';
    const a8 = await update(changed);
    assert.equal(a8.version, 8);
    assert.deepEqual(await compare(a, b), result);
    await expect(region).toContainText('15,79');
    record('Current A8 does not mutate issued A7/B3 comparison', { currentA: a8.version, pinnedA: a.version });

    phase = 'zero unknown same-project and foreign revisions';
    const zero = await create({ ...project(finance.variantA, 'Synthetic zero'), placedObjects: [] });
    const zeroResult = await compare(zero, b);
    assert.equal(zeroResult.differenceMinor, '55000000');
    assert.equal(zeroResult.differencePercent, null);
    const unknownInput = project(finance.variantB, 'Synthetic unknown');
    unknownInput.assetLibrary[1].unitPriceMinor = null;
    const unknown = await create(unknownInput);
    const unknownResult = await compare(a, unknown);
    assert.equal(unknownResult.b.cost.totalMinor, null);
    assert.equal(unknownResult.differenceMinor, null);
    assert.equal(unknownResult.differencePercent, null);
    const sameProject = await compare(a, a8);
    assert.equal(sameProject.differenceMinor, '-2500000');
    await compare(a, a, 400);
    const foreign = await browser.newContext();
    await body(await foreign.request.post(base + '/api/auth/login', { data: { email: fixture.b.email, password: 'fixture-password-only' } }));
    const denied = await compare(a, b, 404, foreign.request);
    assert.equal('a' in denied, false);
    assert.equal('b' in denied, false);
    await foreign.close();
    record('Zero/unknown preserve null semantics; same-project historical comparison works; foreign has no partial prices');
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(out + '/result.json', JSON.stringify({ status: 'PASS', database: fixture.database.dbname, checks, consoleErrors, pageErrors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {});
    fs.writeFileSync(out + '/failure.json', JSON.stringify({ phase, message: String(error), checks, consoleErrors, pageErrors }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
