/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in disposable real report/PDF acceptance. */
const { chromium, expect: browserExpect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const finance = require('../fixtures/finance-v1.json');
const expect = browserExpect.configure({ timeout: 60000 });
const base = 'http://127.0.0.1:3111', backend = 'http://127.0.0.1:8092';
const out = process.env.FRC10_BROWSER_OUTPUT || '/private/tmp/frc10-live';

(async () => {
  const fixture = await (await fetch(backend + '/__fixture')).json();
  assert.equal(fixture.database.host, '127.0.0.1');
  assert.equal(fixture.database.port, 55434);
  assert.match(fixture.database.dbname, /^frc03_browser_[a-f0-9]+$/);
  const env = JSON.parse(fs.readFileSync(process.env.FRC03_OPERATOR_ENV_FILE, 'utf8'));
  assert.equal(env.APP_DB_DBNAME, fixture.database.dbname);
  const provisioned = JSON.parse(execFileSync(process.env.FRC03_OPERATOR_BINARY, [
    '-enterprise-id', crypto.randomUUID(), '-user-id', fixture.a.userId,
    '-name', 'Synthetic FRC10 ' + crypto.randomUUID().slice(0, 8),
    '-address', 'Synthetic report fixture', '-latitude', '55.75', '-longitude', '37.62',
  ], { cwd: path.resolve('..', 'backend'), env: { ...process.env, ...env, ENVIRONMENT: 'dev', APP_WORK_MODE: 'enterprise-provision' }, encoding: 'utf8' }));
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const checks = [], consoleErrors = [], pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  const record = (name, detail = {}) => { checks.push({ name, ...detail }); console.log(JSON.stringify(checks.at(-1))); };
  const body = async (response, expected = 200) => { assert.equal(response.status(), expected, await response.text()); return response.json(); };
  const read = id => page.request.get(base + '/api/defense/projects/' + id).then(response => body(response));
  async function create(value) {
    const result = await body(await page.request.post(base + '/api/defense/projects', { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { name: value.projectName, enterpriseId: provisioned.enterpriseId, projectJson: JSON.stringify(value) } }));
    return read(result.projectId);
  }
  async function update(value) {
    await body(await page.request.put(base + '/api/defense/projects/' + value.projectId, { data: { name: value.projectName, enterpriseId: value.enterpriseId, version: value.version, projectJson: JSON.stringify(value) } }));
    return read(value.projectId);
  }
  const issue = (project, hideCost = false, mapView = 'all') => page.request.get(base + '/api/v1/projects/report?' + new URLSearchParams({ id: project.projectId, projectVersion: String(project.version), hideCost: String(hideCost), mapView })).then(response => body(response));
  const reopen = (id, request = page.request, expected = 200) => request.get(base + '/api/v1/projects/report?reportId=' + id).then(response => body(response, expected));
  const manualReview = 'Я проверил описания и примечания на суммы и коммерческие сведения';
  async function printReport(report, filename) {
    await page.goto(base + '/reports/' + report.reportId);
    const region = page.getByRole('region', { name: 'Официальный отчёт', exact: true });
    await expect(region).toBeVisible();
    await expect(page.getByRole('img', { name: 'Схема размещения', exact: true })).toBeVisible();
    if (report.hideCost) {
      await expect(page.getByRole('button', { name: 'Печать / PDF', exact: true })).toBeDisabled();
      await page.getByLabel(manualReview, { exact: true }).check();
    }
    await expect(page.getByRole('button', { name: 'Печать / PDF', exact: true })).toBeEnabled();
    await page.screenshot({ path: out + '/' + filename + '.png', fullPage: true });
    await page.emulateMedia({ media: 'print' });
    const html = await page.content();
    fs.writeFileSync(out + '/' + filename + '.print.html', html);
    await page.pdf({ path: out + '/' + filename + '.pdf', printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });
    fs.writeFileSync(out + '/' + filename + '.json', JSON.stringify(report, null, 2));
    return html;
  }
  function project(name) {
    const center = { lat: 55.75, lng: 37.62 };
    const provenance = { sourceLabel: 'SYNTHETIC_PRICE_SOURCE_SENTINEL', sourceDocumentId: null, sourceUrl: 'https://example.invalid/PRIVATE_PRICE_SENTINEL', sourceDate: '2026-09-20', recordedAt: '2026-09-20T00:00:00Z', recordedBy: fixture.a.userId, quality: 'estimated', revision: '1' };
    return { schemaVersion: 1, projectId: 'current', projectName: name, enterpriseId: provisioned.enterpriseId, baseObject: { id: provisioned.enterpriseId, name: 'Synthetic protected object', center }, mode: 'view', source: 'custom', updatedAt: '2026-09-20T00:00:00Z',
      layers: finance.layers.map((layer, order) => ({ ...layer, code: 'SAME', order, geometryType: 'ring', geometry: { type: 'ring', center, minRadiusM: order * 500, maxRadiusM: (order + 1) * 500 }, isActive: true, isVisible: order === 0 })),
      assetLibrary: [...finance.assets.map(asset => ({ ...asset, provenance, description: 'Synthetic nonfinancial equipment description', pricePerUnitMln: null, currency: 'RUB', category: 'infrastructure', roles: [], unitLabel: 'шт.', coverageType: 'none', deploymentType: 'static', placementType: 'map-object' })),
        { id: 'unused-private-template', name: 'Unused private template', unitPriceMinor: '9876543210987654321', pricePerUnitMln: null, provenance, currency: 'RUB', category: 'infrastructure', roles: [], unitLabel: 'шт.', coverageType: 'none', deploymentType: 'static', placementType: 'map-object' }],
      placedObjects: finance.variantA.objects.map((object, index) => ({ ...object, coordinates: { lat: 55.751 + index * 0.001, lng: 37.621 }, status: 'planned', notes: 'Synthetic operator note', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z' })),
    };
  }
  function assertUnpriced(value) {
    const forbidden = new Set(['cost', 'budget', 'unitPriceMinor', 'unitPriceMln', 'pricePerUnitMln', 'customPriceMinor', 'customPricePerUnitMln', 'knownSubtotalMinor', 'totalMinor', 'spentMinor', 'remainingMinor', 'differenceMinor', 'budgetLimitMinor', 'sourceUrl', 'sourceDocumentId', 'metadata', 'assetLibrary', 'projectJson']);
    function inspect(node) {
      if (!node || typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node)) { assert.equal(forbidden.has(key), false, 'Unpriced financial key: ' + key); inspect(child); }
    }
    inspect(value);
    const text = JSON.stringify(value);
    for (const sentinel of ['9876543210987654321', 'PRIVATE_PRICE_SENTINEL', 'SYNTHETIC_PRICE_SOURCE_SENTINEL', '12500000', '47500000', '50000000']) assert.equal(text.includes(sentinel), false, sentinel);
  }
  let phase = 'login and pinned A7 accounting fixture';
  try {
    await page.goto(base + '/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.a.email);
    await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/workspace');
    let a = await create(project('Synthetic report A'));
    await body(await page.request.put(base + '/api/v1/projects/budget?projectId=' + a.projectId, { data: { version: a.version, budgetMode: 'limited', budgetLimitMinor: '50000000' } }));
    a = await read(a.projectId);
    while (a.version < 7) a = await update(a);
    const priced = await issue(a);
    assert.equal(priced.identity.projectId, a.projectId);
    assert.equal(priced.identity.projectVersion, 7);
    assert.equal(priced.cost.totalMinor, '47500000');
    assert.equal(priced.budget.remainingMinor, '2500000');
    assert.equal(priced.enterprise.name, null);
    assert.equal(priced.objects.length, 3);
    assert.equal(priced.mapVisibility.objectIds.length, 3);
    await printReport(priced, '01-priced-a7');
    await expect(page.getByRole('region', { name: 'Официальный отчёт', exact: true })).toContainText(/475\s*000/);
    record('Actual saved A7 report has frozen cost, budget, full hidden inventory and a ready printable map', { identity: priced.identity, reportId: priced.reportId });

    phase = 'issued report remains immutable after A8';
    const a8 = structuredClone(a);
    a8.placedObjects[2].customPriceMinor = '5000000';
    const current = await update(a8);
    assert.equal(current.version, 8);
    assert.deepEqual(await reopen(priced.reportId), priced);
    assert.deepEqual(await issue(a), priced);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Официальный отчёт', exact: true })).toContainText(/475\s*000/);
    record('Existing reportId and repeated A7 issuance retain byte-equivalent JSON after A8', { currentVersion: current.version, reportId: priced.reportId });

    phase = 'server unpriced projection and isolated print document';
    const unpriced = await issue(a, true);
    assert.notEqual(unpriced.reportId, priced.reportId);
    assertUnpriced(unpriced);
    const html = await printReport(unpriced, '02-unpriced-a7');
    for (const sentinel of ['PRIVATE_PRICE_SENTINEL', 'SYNTHETIC_PRICE_SOURCE_SENTINEL', '9876543210987654321', '47500000', '12500000']) assert.equal(html.includes(sentinel), false, sentinel);
    assert.doesNotMatch(await page.locator('body').innerText(), /475\s*000|500\s*000|125\s*000/);
    record('Unpriced JSON, live DOM and print HTML exclude financial fields and private template/provenance sentinels');

    phase = 'selective saved map keeps full inventory';
    const selective = await issue(a, false, 'saved');
    assert.notEqual(selective.reportId, priced.reportId);
    assert.equal(selective.objects.length, 3);
    assert.equal(selective.cost.totalMinor, '47500000');
    assert.deepEqual(selective.mapVisibility.objectIds, ['obj-1']);
    await printReport(selective, '03-selective-a7');
    await expect(page.getByRole('region', { name: 'Официальный отчёт', exact: true })).toContainText(/Выборочн/i);
    record('Explicit saved selective map is labeled while full composition and cost remain unchanged');

    phase = 'unknown and empty reports';
    const unknownInput = project('Synthetic report unknown');
    unknownInput.assetLibrary[1].unitPriceMinor = null;
    const unknown = await issue(await create(unknownInput));
    assert.equal(unknown.cost.totalMinor, null);
    await printReport(unknown, '04-unknown');
    await expect(page.getByRole('region', { name: 'Официальный отчёт', exact: true })).toContainText(/Предварительная оценка/);
    const empty = await issue(await create({ ...project('Synthetic empty report'), placedObjects: [] }));
    assert.equal(empty.objects.length, 0);
    assert.equal(empty.cost.totalMinor, '0');
    await printReport(empty, '05-empty');
    record('Unknown total stays null/preliminary; zero placements give a real empty report and zero total');

    phase = 'long 100-row multi-page report';
    const longInput = project('Synthetic long report');
    longInput.placedObjects = Array.from({ length: 100 }, (_, index) => ({ ...longInput.placedObjects[0], id: 'long-object-' + index, name: `Позиция ${String(index + 1).padStart(3, '0')}: длинное проверочное название синтетического оборудования для переноса текста в таблице отчёта`, quantity: 1, coordinates: { lat: 55.75 + (index % 10) * 0.0002, lng: 37.62 + Math.floor(index / 10) * 0.0002 } }));
    const longReport = await issue(await create(longInput));
    assert.equal(longReport.objects.length, 100);
    assert.equal(longReport.cost.totalMinor, '1250000000');
    await printReport(longReport, '06-long-100');
    record('100 long-named saved objects rendered and printed; PDF text/layout inspection remains separate', { reportId: longReport.reportId, objectCount: 100 });

    phase = 'second identity and exclusive reportId query';
    const foreign = await browser.newContext();
    await body(await foreign.request.post(base + '/api/auth/login', { data: { email: fixture.b.email, password: 'fixture-password-only' } }));
    const denied = await reopen(priced.reportId, foreign.request, 404);
    assert.equal('cost' in denied, false);
    assert.equal('objects' in denied, false);
    await body(await page.request.get(base + '/api/v1/projects/report?reportId=' + unpriced.reportId + '&hideCost=false'), 400);
    await foreign.close();
    record('Foreign identity cannot reopen report; query overrides cannot turn an issued unpriced report into priced');
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(out + '/result.json', JSON.stringify({ status: 'PASS', database: fixture.database.dbname, checks, consoleErrors, pageErrors, pdfInspection: 'PENDING independent text and visual review' }, null, 2));
  } catch (error) {
    await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {});
    fs.writeFileSync(out + '/failure.json', JSON.stringify({ phase, message: String(error), checks, consoleErrors, pageErrors }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
