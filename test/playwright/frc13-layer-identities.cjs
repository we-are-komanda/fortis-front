/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in CommonJS browser regression. */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Synthetic fixture only; this never uses the user's development DB or credentials.
const base = 'http://127.0.0.1:3111';
const backend = 'http://127.0.0.1:8092';
const out = process.env.FRC13_LAYER_OUTPUT || '/private/tmp/frc13-layer-identities';

(async () => {
  assert.ok(process.env.FRC13_SEED_PROJECT, 'Provide a project from the disposable FRC03 fixture');
  const fixture = await (await fetch(backend + '/__fixture')).json();
  assert.equal(fixture.database.host, '127.0.0.1');
  assert.equal(fixture.database.port, 55434);
  assert.match(fixture.database.dbname, /^frc03_browser_[a-f0-9]+$/);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [], pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  let projectId;
  try {
    const login = await page.request.post(base + '/api/auth/login', { data: { email: fixture.a.email, password: 'fixture-password-only' } });
    assert.equal(login.status(), 200);
    const seedResponse = await page.request.get(base + '/api/defense/projects/' + process.env.FRC13_SEED_PROJECT);
    assert.equal(seedResponse.status(), 200);
    const seed = await seedResponse.json();
    assert.ok(seed.layers.length);
    const layers = ['alpha', 'beta'].map((suffix, index) => ({
      ...seed.layers[0], id: 'synthetic-layer-' + suffix, code: 'SAME', name: 'Synthetic ' + suffix,
      distanceBandM: { min: index * 1000, max: (index + 1) * 1000 },
    }));
    const project = { ...seed, projectId: 'current', version: undefined, projectName: 'Synthetic duplicate human codes', source: 'custom', layers, assetLibrary: [], placedObjects: [] };
    const created = await page.request.post(base + '/api/defense/projects', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      data: { name: project.projectName, enterpriseId: seed.enterpriseId, projectJson: JSON.stringify(project) },
    });
    assert.equal(created.status(), 200, await created.text());
    projectId = (await created.json()).projectId;
    await page.goto(base + '/prototype?projectId=' + projectId);
    await expect(page.getByText('Смета сохранённой версии 1', { exact: true })).toBeVisible({ timeout: 30000 });
    for (const layer of layers) {
      const selector = page.getByTitle(layer.code + ' · ' + layer.name, { exact: true });
      await expect(selector).toBeVisible();
      await selector.click();
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: out + '/map.png', fullPage: true });
    const saved = await (await page.request.get(base + '/api/defense/projects/' + projectId)).json();
    assert.deepEqual(saved.layers.map(layer => layer.id), layers.map(layer => layer.id));
    assert.deepEqual(saved.layers.map(layer => layer.code), ['SAME', 'SAME']);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    fs.writeFileSync(out + '/result.json', JSON.stringify({ status: 'PASS', projectId, layerIds: layers.map(layer => layer.id), codes: ['SAME', 'SAME'], consoleErrors, pageErrors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {});
    fs.writeFileSync(out + '/failure.json', JSON.stringify({ projectId, message: String(error), consoleErrors, pageErrors }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
