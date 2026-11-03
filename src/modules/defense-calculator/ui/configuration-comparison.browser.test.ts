import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Page, type Route } from "@playwright/test";
import finance from "../../../../test/fixtures/finance-v1.json";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";
import { buildDraftCostProjection } from "@/shared/lib/cost-projection";
import type { DefenseProject, VariantSummary } from "@/shared/types/defense-project";
import type { CompareResult, CompareSide } from "@/shared/types/finance";

const enabled = process.env.FRC08_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;
before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const output = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ConfigurationComparison} from './src/modules/defense-calculator/ui/configuration-comparison';
      import {useDefenseProjectStore as projects} from './src/shared/lib/use-defense-project-store';
      import {useDefenseVariantsStore as variants} from './src/modules/drone-defense/domain/use-defense-variants-store';
      import {setAuthenticatedIdentity} from './src/shared/lib/session-state';
      import {markProjectInaccessible} from './src/shared/lib/identity';
      setAuthenticatedIdentity('compare-A');
      projects.getState().acceptServerProject(window.fixture.current);
      variants.setState({activeVariantId:window.fixture.current.projectId,activeVariantName:window.fixture.current.projectName});
      let props=window.fixture.props;
      const root=createRoot(document.getElementById('root'));
      function Harness({context}){const p=projects(s=>s.project);return <><output aria-label="Тест: активный проект">{p.projectName}</output><ConfigurationComparison {...context}/></>}
      const render=()=>root.render(<Harness context={props}/>);
      window.frc08={
        state:()=>({project:projects.getState().project,saved:projects.getState().savedProject,status:projects.getState().syncStatus}),
        props:next=>{props={...props,...next};render();},
        edit:name=>projects.getState().replaceProject({...projects.getState().project,projectName:name}),
        background:server=>projects.getState().recordSavedProject(projects.getState().savedProject,server),
        deny:()=>markProjectInaccessible(404),
        identity:(id,next)=>{setAuthenticatedIdentity(id);props=next;render();}
      };render();
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  bundle = output.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

function project(which: "A" | "B" = "A", version = which === "A" ? 7 : 3): DefenseProject {
  const base = createDefaultDefenseProject(); const value = which === "A" ? finance.variantA : finance.variantB;
  return { ...base, projectId: which, projectName: `Synthetic ${which}`, enterpriseId: "E", version, source: "backend", updatedAt: "2026-09-21T10:00:00Z",
    layers: finance.layers.map((layer, order) => ({ ...base.layers[0], ...layer, code: `CUSTOM-${order}`, order })),
    assetLibrary: finance.assets.map(asset => ({ ...base.assetLibrary[0], ...asset, pricePerUnitMln: null, currency: "RUB" })),
    placedObjects: value.objects.map(object => ({ ...base.placedObjects[0], ...object, customPriceMinor: "customPriceMinor" in object ? object.customPriceMinor : undefined })),
  };
}
function summary(value: DefenseProject): VariantSummary {
  return { projectId: value.projectId, name: value.projectName, projectName: value.projectName, enterpriseId: value.enterpriseId, version: value.version!, updatedAt: value.updatedAt };
}
function side(value: DefenseProject): CompareSide {
  const { kind, basedOn, ...cost } = buildDraftCostProjection(value); void kind; void basedOn;
  const identity = { projectId: value.projectId, projectVersion: value.version!, calculationVersion: "cost-rub-v1", inputDataVersions: {}, snapshotDigest: "a".repeat(64) };
  const config = value.projectId === "A" ? { budgetMode: "limited" as const, budgetLimitMinor: "50000000" } : { budgetMode: "unlimited" as const, budgetLimitMinor: null };
  const remainingMinor = config.budgetLimitMinor === null || cost.totalMinor === null ? null : String(BigInt(config.budgetLimitMinor) - BigInt(cost.totalMinor));
  return { identity, name: value.projectName, updatedAt: value.updatedAt, cost: { ...cost, identity }, budget: { identity, config, spentMinor: cost.totalMinor, remainingMinor,
    status: cost.totalMinor === null ? "indeterminate" : config.budgetMode === "unlimited" ? "unlimited" : BigInt(remainingMinor!) < 0 ? "exceeded" : "within_limit" } };
}
function comparison(a = project("A"), b = project("B"), differencePercent: string | null = "15.79"): CompareResult {
  const left = side(a), right = side(b);
  const differenceMinor = left.cost.totalMinor === null || right.cost.totalMinor === null ? null : String(BigInt(right.cost.totalMinor) - BigInt(left.cost.totalMinor));
  return { enterpriseId: "E", a: left, b: right, differenceMinor, differencePercent: differenceMinor === null || left.cost.totalMinor === "0" ? null : differencePercent, warnings: [] };
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
type RequestLog = { method: string; path: string; query: string; body: string | null };
async function fixture(options: { response?: CompareResult; compare?: (route: Route) => Promise<void>; save?: (route: Route) => Promise<void>; projects?: VariantSummary[]; active?: DefenseProject } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); page.setDefaultTimeout(5000);
  const server = new Map([options.active ?? project("A"), project("B")].map(value => [value.projectId, value]));
  const requests: RequestLog[] = [], errors: string[] = [], unexpected: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fortis.test/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) requests.push({ method: req.method(), path: url.pathname, query: url.search, body: req.postData() });
    if (url.pathname === "/api/v1/projects/compare") {
      if (options.compare) return options.compare(route);
      return route.fulfill({ json: options.response ?? comparison() });
    }
    if (url.pathname.startsWith("/api/defense/projects/") && req.method() === "PUT") {
      if (options.save) return options.save(route);
      const id = url.pathname.split("/").pop()!; const body = req.postDataJSON();
      const current = server.get(id)!;
      const saved = { ...JSON.parse(body.projectJson), projectId: id, enterpriseId: "E", version: current.version! + 1, source: "backend" };
      server.set(id, saved); return route.fulfill({ json: { ...saved, name: body.name } });
    }
    if (url.pathname.startsWith("/api/defense/projects/") && req.method() === "GET") return route.fulfill({ json: server.get(url.pathname.split("/").pop()!) });
    if (url.pathname === "/api/defense/projects") return route.fulfill({ json: { items: [...server.values()].map(summary), totalItems: server.size } });
    if (url.pathname.startsWith("/api/")) { unexpected.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 500, json: { message: "Unexpected test request" } }); }
    return route.fulfill({ contentType: "text/html", body: '<html lang="ru"><body><div id="root"></div></body></html>' });
  });
  await page.goto("https://fortis.test/comparison-fixture");
  await page.evaluate(value => Object.assign(window, { fixture: value }), { current: options.active ?? project(), props: { enterpriseId: "E", projects: options.projects ?? [...server.values()].map(summary) } });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByLabel("Первая конфигурация", { exact: true })).toBeVisible();
  return { page, server, requests, errors, unexpected };
}
async function select(page: Page, a = "A", b = "B", aVersion = "7", bVersion = "3") {
  await page.getByLabel("Первая конфигурация", { exact: true }).selectOption(a);
  await page.getByLabel("Вторая конфигурация", { exact: true }).selectOption(b);
  await page.getByLabel("Версия A", { exact: true }).fill(aVersion);
  await page.getByLabel("Версия B", { exact: true }).fill(bVersion);
}
async function compare(page: Page) { await page.getByRole("button", { name: "Сравнить", exact: true }).click(); }
async function dirty(page: Page) { await page.evaluate(() => (window as unknown as { frc08: { edit: (name: string) => void } }).frc08.edit("Unsaved private edit")); }
async function current(page: Page) { return page.evaluate(() => (window as unknown as { frc08: { state: () => { project: DefenseProject; saved: DefenseProject; status: string } } }).frc08.state()); }

test("finance A7/B3 comparison requests both pinned references and displays exact positive difference", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await select(f.page); await compare(f.page);
    const result = f.page.getByRole("region", { name: "Результат сравнения", exact: true });
    await expect(result).toContainText(/475\s*000,00 ₽/);
    await expect(result).toContainText(/550\s*000,00 ₽/);
    await expect(result).toContainText(/75\s*000,00 ₽/);
    await expect(result).toContainText(/15[.,]79/);
    const query = new URLSearchParams(f.requests.find(r => r.path.endsWith("/compare"))!.query);
    assert.deepEqual(Object.fromEntries(query), { projectIdA: "A", projectVersionA: "7", projectIdB: "B", projectVersionB: "3" });
    assert.equal(f.requests.filter(r => r.method !== "GET").length, 0);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("zero baseline shows an exact absolute difference and no percentage", { skip: !enabled }, async () => {
  const a = project(); a.placedObjects = a.placedObjects.map(object => ({ ...object, customPriceMinor: "0" }));
  const f = await fixture({ response: comparison(a, project("B"), null) });
  try {
    await select(f.page); await compare(f.page);
    const result = f.page.getByRole("region", { name: "Результат сравнения", exact: true });
    await expect(result).toContainText(/550\s*000,00 ₽/);
    await expect(result).toContainText(/Не рассчитывается/i);
    await expect(result).not.toContainText(/Infinity|NaN/);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("unknown total stays incomplete and prevents a numeric comparison delta", { skip: !enabled }, async () => {
  const b = project("B"); b.assetLibrary[0].unitPriceMinor = null;
  const response = comparison(project(), b, null);
  assert.equal(response.b.cost.totalMinor, null);
  const f = await fixture({ response });
  try {
    await select(f.page); await compare(f.page);
    const result = f.page.getByRole("region", { name: "Результат сравнения", exact: true });
    await expect(result.getByRole("region", { name: "Вариант B", exact: true })).toContainText(/неполн/i);
    await expect(result).toContainText(/Не рассчитывается/i);
    await expect(result).not.toContainText(/15[.,]79|дешевле|эффективнее|оптимальный|достаточная защита/i);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("the same project can be compared at different revisions but identical refs never request", { skip: !enabled }, async () => {
  const b = { ...project("B"), projectId: "A", version: 8 };
  const f = await fixture({ response: comparison(project(), b) });
  try {
    await select(f.page, "A", "A", "7", "7");
    await expect(f.page.getByRole("button", { name: "Сравнить", exact: true })).toBeDisabled();
    assert.equal(f.requests.filter(r => r.path.endsWith("/compare")).length, 0);
    await f.page.getByLabel("Версия B", { exact: true }).fill("8"); await compare(f.page);
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    const query = new URLSearchParams(f.requests.find(r => r.path.endsWith("/compare"))!.query);
    assert.deepEqual(Object.fromEntries(query), { projectIdA: "A", projectVersionA: "7", projectIdB: "A", projectVersionB: "8" });
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("background saves and refreshed project summaries never move a selected revision", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await select(f.page); await compare(f.page);
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    const next = project("A", 8);
    await f.page.evaluate(({ next, summaries }) => {
      const api = (window as unknown as { frc08: { background: (p: DefenseProject) => void; props: (p: { projects: VariantSummary[] }) => void } }).frc08;
      api.background(next); api.props({ projects: summaries });
    }, { next, summaries: [summary(next), summary(project("B"))] });
    await expect(f.page.getByLabel("Версия A", { exact: true })).toHaveValue("7");
    await compare(f.page);
    const requests = f.requests.filter(r => r.path.endsWith("/compare"));
    assert.ok(requests.length >= 1);
    assert.ok(requests.every(r => new URLSearchParams(r.query).get("projectVersionA") === "7"));
    assert.equal((await current(f.page)).project.version, 8);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("dirty comparison Cancel retains edits and performs neither save nor comparison", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await select(f.page); await dirty(f.page); await compare(f.page);
    await f.page.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal((await current(f.page)).project.projectName, "Unsaved private edit");
    assert.equal((await current(f.page)).status, "dirty");
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("explicit last-saved comparison preserves all unsaved edits and selected refs", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await select(f.page); await dirty(f.page); await compare(f.page);
    await f.page.getByRole("button", { name: "Сравнить последние сохранённые", exact: true }).click();
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    assert.equal((await current(f.page)).project.projectName, "Unsaved private edit");
    assert.equal((await current(f.page)).status, "dirty");
    assert.equal(f.requests.filter(r => r.method === "PUT").length, 0);
    assert.equal(new URLSearchParams(f.requests.find(r => r.path.endsWith("/compare"))!.query).get("projectVersionA"), "7");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("Save-and-compare waits for the confirmed save then pins the acknowledged version", { skip: !enabled }, async () => {
  const hold = deferred(), arrived = deferred();
  const f = await fixture({
    save: async route => {
      arrived.release(); await hold.promise;
      const body = route.request().postDataJSON();
      const saved = { ...JSON.parse(body.projectJson), projectId: "A", enterpriseId: "E", version: 8, source: "backend" };
      f.server.set("A", saved); await route.fulfill({ json: { ...saved, name: body.name } });
    },
    compare: async route => { await route.fulfill({ json: comparison(f.server.get("A")!, project("B")) }); },
  });
  try {
    await select(f.page); await dirty(f.page); await compare(f.page);
    await f.page.getByRole("button", { name: "Сохранить и сравнить", exact: true }).click(); await arrived.promise;
    assert.equal(f.requests.filter(r => r.path.endsWith("/compare")).length, 0);
    assert.equal((await current(f.page)).project.version, 7);
    hold.release();
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    await expect(f.page.getByLabel("Версия A", { exact: true })).toHaveValue("8");
    await expect(f.page.getByLabel("Версия B", { exact: true })).toHaveValue("3");
    assert.equal(new URLSearchParams(f.requests.find(r => r.path.endsWith("/compare"))!.query).get("projectVersionA"), "8");
    assert.equal((await current(f.page)).status, "saved");
    assert.equal(f.requests.filter(r => r.method === "PUT").length, 1);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { hold.release(); await f.page.close(); }
});

test("a failed Save-and-compare keeps edits and never compares an unconfirmed revision", { skip: !enabled }, async () => {
  const f = await fixture({ save: async route => { await route.fulfill({ status: 409, json: { error: { code: "version_conflict", message: "Synthetic concurrent writer" } } }); } });
  try {
    await select(f.page); await dirty(f.page); await compare(f.page);
    await f.page.getByRole("button", { name: "Сохранить и сравнить", exact: true }).click();
    await expect(f.page.getByRole("dialog").getByRole("alert")).toBeVisible();
    assert.equal((await current(f.page)).project.projectName, "Unsaved private edit");
    assert.equal((await current(f.page)).project.version, 7);
    assert.equal((await current(f.page)).status, "dirty");
    assert.equal(f.requests.filter(r => r.path.endsWith("/compare")).length, 0);
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toHaveCount(0);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("a revoked second side replaces prior success with an error and no partial prices", { skip: !enabled }, async () => {
  let denied = false;
  const f = await fixture({ compare: async route => { await route.fulfill(denied ? { status: 404, json: { error: { code: "not_found", message: "Resource not found" } } } : { json: comparison() }); } });
  try {
    await select(f.page); await compare(f.page);
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    denied = true; await compare(f.page);
    await expect(f.page.getByRole("alert")).toBeVisible();
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toHaveCount(0);
    await expect(f.page.locator("body")).not.toContainText(/475\s*000,00 ₽|550\s*000,00 ₽/);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("malformed nested snapshot identity fails closed before any comparison is shown", { skip: !enabled }, async () => {
  const response = comparison(); response.b.cost.identity = { ...response.b.identity, projectVersion: 4 };
  const f = await fixture({ response });
  try {
    await select(f.page); await compare(f.page);
    await expect(f.page.getByRole("alert")).toBeVisible();
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toHaveCount(0);
    await expect(f.page.locator("body")).not.toContainText(/475\s*000,00 ₽|550\s*000,00 ₽/);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("late response for the previous pair cannot replace a newly selected revision", { skip: !enabled }, async () => {
  const hold = deferred(), arrived = deferred(), finished = deferred();
  const next = project("A", 8);
  const f = await fixture({ compare: async route => {
    const version = new URL(route.request().url()).searchParams.get("projectVersionA");
    if (version === "7") { arrived.release(); await hold.promise; try { await route.fulfill({ json: comparison() }); } finally { finished.release(); } }
    else await route.fulfill({ json: comparison(next, project("B")) });
  } });
  try {
    await select(f.page); await compare(f.page); await arrived.promise;
    await f.page.getByLabel("Версия A", { exact: true }).fill("8");
    await expect(f.page.getByRole("button", { name: "Сравнить", exact: true })).toBeEnabled();
    await compare(f.page);
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    hold.release(); await finished.promise;
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(f.page.getByLabel("Версия A", { exact: true })).toHaveValue("8");
    const result = f.page.getByRole("region", { name: "Вариант A", exact: true });
    await expect(result).toContainText(/(?:Версия|версия)\s*8/);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { hold.release(); await f.page.close(); }
});

for (const transition of ["enterprise", "identity"] as const) {
  test(`switching ${transition} clears a pending comparison and permits a new pair immediately`, { skip: !enabled }, async () => {
    const hold = deferred(), arrived = deferred(), finished = deferred();
    const enterpriseId = transition === "enterprise" ? "F" : "E";
    const c = { ...project(), projectId: "C", projectName: "New C", enterpriseId };
    const d = { ...project(), projectId: "D", projectName: "New D", enterpriseId };
    c.placedObjects = c.placedObjects.map(object => ({ ...object, customPriceMinor: "0" }));
    d.placedObjects = d.placedObjects.map(object => ({ ...object, customPriceMinor: "0" }));
    const response = { ...comparison(c, d, null), enterpriseId };
    const f = await fixture({ compare: async route => {
      if (new URL(route.request().url()).searchParams.get("projectIdA") === "A") { arrived.release(); await hold.promise; try { await route.fulfill({ json: comparison() }); } finally { finished.release(); } }
      else await route.fulfill({ json: response });
    } });
    try {
      await select(f.page); await compare(f.page); await arrived.promise;
      await f.page.evaluate(({ transition, next }) => {
        const api = (window as unknown as { frc08: { props: (props: unknown) => void; identity: (id: string, props: unknown) => void } }).frc08;
        if (transition === "identity") api.identity("compare-B", next); else api.props(next);
      }, { transition, next: { enterpriseId, projects: [summary(c), summary(d)] } });
      await expect(f.page.getByLabel("Первая конфигурация", { exact: true })).toHaveValue("");
      await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toHaveCount(0);
      await select(f.page, "C", "D", "7", "7"); await compare(f.page);
      await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
      hold.release(); await finished.promise;
      await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const result = f.page.getByRole("region", { name: "Результат сравнения", exact: true });
      await expect(result).toContainText("New C");
      await expect(result).not.toContainText(/475\s*000,00 ₽|550\s*000,00 ₽/);
      assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
    } finally { hold.release(); await f.page.close(); }
  });
}

test("matching names with different layer and asset IDs remain separate with source warnings", { skip: !enabled }, async () => {
  const a = project(), b = project("B");
  b.layers[0].id = "independent-layer";
  b.assetLibrary[0].id = "independent-asset";
  b.placedObjects = b.placedObjects.map(object => ({ ...object,
    layerId: object.layerId === a.layers[0].id ? "independent-layer" : object.layerId,
    assetId: object.assetId === a.assetLibrary[0].id ? "independent-asset" : object.assetId,
  }));
  const response = comparison(a, b);
  response.warnings = [{ code: "price_source_mismatch", severity: "warning", objectIds: [], message: "Synthetic sources differ; compare their dates." }];
  const f = await fixture({ response });
  try {
    await select(f.page); await compare(f.page);
    const layers = f.page.getByRole("region", { name: "Сравнение по слоям", exact: true });
    await expect(layers).toContainText("ID: layer-custom-a");
    await expect(layers).toContainText("ID: independent-layer");
    await expect(layers.getByText(/Только в одной версии; сопоставления по имени нет/)).toHaveCount(2);
    const composition = f.page.getByRole("region", { name: "Состав и цены", exact: true });
    await expect(composition).toContainText("independent-asset");
    await expect(composition.getByText("Только в одной версии; разные идентификаторы не объединяются по имени", { exact: true })).toHaveCount(4);
    await expect(f.page.getByRole("region", { name: "Замечания к сравнению", exact: true })).toContainText("Synthetic sources differ; compare their dates.");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("a newer edit during Save-and-compare remains dirty until the user explicitly chooses saved versions", { skip: !enabled }, async () => {
  const hold = deferred(), arrived = deferred();
  const f = await fixture({ save: async route => {
    arrived.release(); await hold.promise;
    const body = route.request().postDataJSON();
    const saved = { ...JSON.parse(body.projectJson), projectId: "A", enterpriseId: "E", version: 8, source: "backend" };
    f.server.set("A", saved); await route.fulfill({ json: { ...saved, name: body.name } });
  } });
  try {
    await select(f.page); await dirty(f.page); await compare(f.page);
    await f.page.getByRole("button", { name: "Сохранить и сравнить", exact: true }).click(); await arrived.promise;
    await f.page.evaluate(() => (window as unknown as { frc08: { edit: (name: string) => void } }).frc08.edit("Newer edit during save"));
    hold.release();
    await expect(f.page.getByRole("dialog").getByRole("alert")).toContainText("ещё не полностью сохранены");
    assert.equal(f.requests.filter(r => r.path.endsWith("/compare")).length, 0);
    const state = await current(f.page);
    assert.equal(state.project.projectName, "Newer edit during save");
    assert.equal(state.saved.projectName, "Unsaved private edit");
    assert.equal(state.status, "dirty"); assert.equal(state.project.version, 8);
    await f.page.getByRole("button", { name: "Сравнить последние сохранённые", exact: true }).click();
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    assert.equal((await current(f.page)).project.projectName, "Newer edit during save");
    assert.equal(new URLSearchParams(f.requests.find(r => r.path.endsWith("/compare"))!.query).get("projectVersionA"), "7");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { hold.release(); await f.page.close(); }
});

test("saving the active revision repins only that operand and preserves a historical side of the same project", { skip: !enabled }, async () => {
  const active = { ...project("B"), projectId: "A", projectName: "Current A8", version: 8 };
  const f = await fixture({ active, projects: [summary(active)], compare: async route => { await route.fulfill({ json: comparison(project("A"), f.server.get("A")!) }); } });
  try {
    await select(f.page, "A", "A", "7", "8"); await dirty(f.page); await compare(f.page);
    await f.page.getByRole("button", { name: "Сохранить и сравнить", exact: true }).click();
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).toBeVisible();
    await expect(f.page.getByLabel("Версия A", { exact: true })).toHaveValue("7");
    await expect(f.page.getByLabel("Версия B", { exact: true })).toHaveValue("9");
    const query = new URLSearchParams(f.requests.find(r => r.path.endsWith("/compare"))!.query);
    assert.deepEqual(Object.fromEntries(query), { projectIdA: "A", projectVersionA: "7", projectIdB: "A", projectVersionB: "9" });
    assert.equal((await current(f.page)).project.version, 9);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("known denial of a selected project removes an already displayed comparison", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await select(f.page); await compare(f.page);
    const result = f.page.getByRole("region", { name: "Результат сравнения", exact: true });
    await expect(result).toBeVisible();
    await f.page.evaluate(() => (window as unknown as { frc08: { deny: () => void } }).frc08.deny());
    await expect(result).not.toBeVisible();
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("a pending comparison cannot reveal a selected project after another request confirms denial", { skip: !enabled }, async () => {
  const gate = deferred();
  const f = await fixture({ compare: async route => { await gate.promise; await route.fulfill({ json: comparison() }); } });
  try {
    await select(f.page); await compare(f.page);
    await expect.poll(() => f.requests.filter(request => request.path.endsWith("/compare")).length).toBe(1);
    await f.page.evaluate(() => (window as unknown as { frc08: { deny: () => void } }).frc08.deny());
    const response = f.page.waitForResponse(url => new URL(url.url()).pathname.endsWith("/compare"));
    gate.release(); await (await response).finished();
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(f.page.getByRole("region", { name: "Результат сравнения", exact: true })).not.toBeVisible();
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { gate.release(); await f.page.close(); }
});

test("denial of an unrelated active project does not suppress an authorized selected pair", { skip: !enabled }, async () => {
  const active = { ...project(), projectId: "C", projectName: "Unrelated C" };
  const f = await fixture({ active, projects: [summary(project()), summary(project("B"))] });
  try {
    await select(f.page); await compare(f.page);
    const result = f.page.getByRole("region", { name: "Результат сравнения", exact: true });
    await expect(result).toBeVisible();
    await f.page.evaluate(() => (window as unknown as { frc08: { deny: () => void } }).frc08.deny());
    await expect(result).toBeVisible();
    await expect(result).toContainText(/475\s*000,00 ₽/);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});
