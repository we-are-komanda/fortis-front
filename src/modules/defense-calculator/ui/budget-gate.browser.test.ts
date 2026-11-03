import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Page, type Route } from "@playwright/test";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";
import { buildDraftCostProjection } from "@/shared/lib/cost-projection";
import type { DefenseProject } from "@/shared/types/defense-project";
import type { BudgetConfig, BudgetProjection } from "@/shared/types/finance";

const enabled = process.env.FRC07_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;

before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {CalculatorPage} from './src/modules/defense-calculator/ui/calculator-page';
      import {RuntimeProvider} from './src/shared/ui/runtime-provider';
      import {useDefenseProjectStore as projects} from './src/shared/lib/use-defense-project-store';
      import {useDefenseVariantsStore as variants} from './src/modules/drone-defense/domain/use-defense-variants-store';
      import {setAuthenticatedIdentity} from './src/shared/lib/session-state';
      import './src/shared/lib/identity';
      function load(project, budget) {
        projects.getState().acceptServerProject(project);
        if(budget) projects.setState({budgetProjection:budget});
        variants.setState({activeVariantId:project.projectId,activeVariantName:project.projectName});
      }
      setAuthenticatedIdentity('budget-A'); load(window.fixture.project, window.fixture.seedBudget);
      window.frc07={
        state:()=>({project:projects.getState().project,saved:projects.getState().savedProject,
          syncStatus:projects.getState().syncStatus,attempt:projects.getState().saveAttempt,
          budget:projects.getState().budgetProjection,error:projects.getState().budgetError}),
        load, identity:(id,project)=>{setAuthenticatedIdentity(id);load(project);},
        edit:name=>projects.getState().replaceProject({...projects.getState().project,projectName:name}),
        price:value=>projects.getState().updatePlacedObject('O',{customPriceMinor:value}),
        visibility:visible=>projects.getState().setPlacedObjectMapVisibility('O',visible),
        recoverBudget:config=>{
          const s=projects.getState(); s.setLocalDraftsEnabled(true);
          s.restoreVerifiedDraft({schemaVersion:1,userId:s.identityId,enterpriseId:s.project.enterpriseId,
            projectId:s.project.projectId,draft:s.project,savedProject:s.savedProject,businessRevision:s.businessRevision,
            savedAt:new Date().toISOString(),attempt:{kind:'budget',project:s.savedProject,name:s.savedProject.projectName,
              body:JSON.stringify({version:s.savedProject.version,...config}),businessRevision:s.businessRevision,
              startedAt:new Date().toISOString(),verificationRequired:false}});
        }
      };
      function Harness(){
        const p=projects(s=>s.project); const error=projects(s=>s.budgetError);
        return <><output aria-label="Тест: текущий проект">{p.projectId}</output>
          <output aria-label="Тест: цена объекта">{p.placedObjects[0]?.customPriceMinor ?? 'unknown'}</output>
          {error && <p aria-label="Тест: ошибка изменения">{error}</p>}
          <CalculatorPage/></>;
      }
      createRoot(document.getElementById('root')).render(<RuntimeProvider><Harness/></RuntimeProvider>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "budget-next-fixture", setup(build: { onResolve: (o: { filter: RegExp }, cb: () => unknown) => void; onLoad: (o: { filter: RegExp; namespace: string }, cb: () => unknown) => void }) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'import React from "react"; export default function Link({href,children,...props}){return React.createElement("a",{...props,href},children)}', loader: "js", resolveDir: process.cwd() }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

function project(price: string | null = "47500000", id = "P"): DefenseProject {
  const initial = createDefaultDefenseProject();
  return { ...initial, projectId: id, enterpriseId: "E", projectName: `Synthetic ${id}`, version: 7, source: "backend",
    assetLibrary: [{ ...initial.assetLibrary[0], currency: "RUB", unitPriceMinor: price, pricePerUnitMln: null }],
    placedObjects: [{ ...initial.placedObjects[0], id: "O", assetId: initial.assetLibrary[0].id, layerId: initial.layers[0].id, quantity: 1, customPriceMinor: price }],
  };
}
function budget(value: DefenseProject, config: BudgetConfig = { budgetMode: "limited", budgetLimitMinor: "50000000" }): BudgetProjection {
  const spentMinor = buildDraftCostProjection(value).totalMinor;
  const remainingMinor = spentMinor === null || config.budgetMode === "unlimited" ? null : String(BigInt(config.budgetLimitMinor) - BigInt(spentMinor));
  return { identity: { projectId: value.projectId, projectVersion: value.version!, calculationVersion: "finance-v1", inputDataVersions: {}, snapshotDigest: "a".repeat(64) }, config, spentMinor, remainingMinor,
    status: spentMinor === null ? "indeterminate" : config.budgetMode === "unlimited" ? "unlimited" : BigInt(remainingMinor!) < 0 ? "exceeded" : "within_limit" };
}
type RequestLog = { method: string; path: string; query: string; body: string | null };
async function fixture(value = project(), config: BudgetConfig = { budgetMode: "limited", budgetLimitMinor: "50000000" }, options: { seedBudget?: boolean; read?: (route: Route) => Promise<void>; write?: (route: Route) => Promise<void>; check?: (route: Route) => Promise<void> } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  const unexpected: string[] = [];
  const requests: RequestLog[] = [];
  const server = { project: value, config };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fortis.test/**", async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) requests.push({ method: req.method(), path: url.pathname, query: url.search, body: req.postData() });
    if (url.pathname === "/api/runtime") return route.fulfill({ json: { mode: "workspace", localDraftsEnabled: false } });
    if (url.pathname === "/api/v1/projects/cost") {
      const projection = buildDraftCostProjection(server.project);
      const { kind, basedOn, ...cost } = projection; void kind; void basedOn;
      return route.fulfill({ json: { ...cost, identity: budget(server.project, server.config).identity } });
    }
    if (url.pathname === "/api/v1/projects/budget" && req.method() === "GET") {
      if (options.read) return options.read(route);
      return route.fulfill({ json: budget(server.project, server.config) });
    }
    if (url.pathname === "/api/v1/projects/budget" && req.method() === "PUT") {
      if (options.write) return options.write(route);
      const body = req.postDataJSON();
      server.config = body.budgetMode === "unlimited" ? { budgetMode: "unlimited", budgetLimitMinor: null } : { budgetMode: "limited", budgetLimitMinor: body.budgetLimitMinor };
      server.project = { ...server.project, version: server.project.version! + 1 };
      return route.fulfill({ json: { ...server.project, snapshot: { project: server.project }, budget: budget(server.project, server.config) } });
    }
    if (url.pathname === "/api/v1/projects/budget/check" && options.check) return options.check(route);
    if (url.pathname.startsWith("/api/defense/projects/") && req.method() === "GET") return route.fulfill({ json: server.project });
    if (url.pathname === "/api/defense/projects" && req.method() === "GET") return route.fulfill({ json: { items: [], totalItems: 0 } });
    if (url.pathname.startsWith("/api/")) { unexpected.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 500, json: { message: "Unexpected test request" } }); }
    return route.fulfill({ contentType: "text/html", body: '<html lang="ru"><body><div id="root"></div></body></html>' });
  });
  await page.goto("https://fortis.test/calculator/");
  await page.evaluate(initial => Object.assign(window, { fixture: initial }), { project: value, seedBudget: options.seedBudget ? budget(value, config) : null });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("heading", { name: "Стоимость конфигурации", exact: true })).toBeVisible();
  return { page, server, requests, errors, unexpected };
}
async function price(page: Page, value: string | null) {
  return page.evaluate(value => (window as unknown as { frc07: { price: (value: string | null) => boolean } }).frc07.price(value), value);
}
async function state(page: Page) {
  return page.evaluate(() => (window as unknown as { frc07: { state: () => { project: DefenseProject; saved: DefenseProject; syncStatus: string; attempt: unknown; budget: BudgetProjection | null; error: string | null } } }).frc07.state());
}

test("rendered shared edit gate preserves current content on one-minor excess and accepts exact equality", { skip: !enabled }, async () => {
  const f = await fixture(project(), undefined, { seedBudget: true });
  try {
    assert.equal(await price(f.page, "50000001"), false);
    await expect(f.page.getByLabel("Тест: цена объекта")).toHaveText("47500000");
    await expect(f.page.getByLabel("Тест: ошибка изменения")).toContainText("−0,01 ₽");
    assert.equal((await state(f.page)).syncStatus, "saved");
    assert.equal(await price(f.page, "50000000"), true);
    await expect(f.page.getByLabel("Тест: цена объекта")).toHaveText("50000000");
    assert.equal((await state(f.page)).syncStatus, "dirty");
    assert.equal(f.requests.filter(r => r.method === "PUT").length, 0);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("overage edits compare with the saved baseline and allow undo of an unsaved reduction", { skip: !enabled }, async () => {
  const f = await fixture(project("55000000"), undefined, { seedBudget: true });
  try {
    assert.equal(await price(f.page, "52000000"), true);
    assert.equal(await price(f.page, "54000000"), true);
    await expect(f.page.getByLabel("Тест: цена объекта")).toHaveText("54000000");
    assert.equal(await price(f.page, "56000000"), false);
    await expect(f.page.getByLabel("Тест: цена объекта")).toHaveText("54000000");
    assert.equal((await state(f.page)).saved.placedObjects[0].customPriceMinor, "55000000");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("pending budget GET is visibly unverified and a pinned response supplies exact money", { skip: !enabled }, async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const value = project();
  const f = await fixture(value, undefined, { read: async route => { await hold; await route.fulfill({ json: budget(value) }); } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await expect(panel).toContainText("Бюджет не проверен");
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveCount(0);
    await expect(panel).not.toContainText("Расход проекта: 0,00");
    release();
    await expect(panel).toContainText(/Лимит сохранённой версии 7: 500\s*000,00 ₽/);
    await expect(panel).toContainText(/Остаток: 25\s*000,00 ₽/);
    const request = f.requests.find(r => r.path === "/api/v1/projects/budget")!;
    assert.equal(new URLSearchParams(request.query).get("projectId"), "P");
    assert.equal(new URLSearchParams(request.query).get("projectVersion"), "7");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { release(); await f.page.close(); }
});

test("lowering the limit below saved spend commits a new version and exposes the overage", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await panel.getByLabel("Лимит бюджета, ₽").fill("400000.00");
    await panel.getByRole("button", { name: "Сохранить бюджет", exact: true }).click();
    await expect(panel).toContainText(/Лимит сохранённой версии 8: 400\s*000,00 ₽/);
    await expect(panel).toContainText(/Остаток: −75\s*000,00 ₽/);
    await expect(panel).toContainText("Допустимы изменения без увеличения этого расхода");
    assert.equal((await state(f.page)).syncStatus, "saved");
    const writes = f.requests.filter(r => r.method === "PUT");
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0].body!), { version: 7, budgetMode: "limited", budgetLimitMinor: "40000000" });
    assert.equal(await price(f.page, "45000000"), true);
    assert.equal(await price(f.page, "47500001"), false);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("limited zero is submitted exactly and blocks a one-minor paid edit", { skip: !enabled }, async () => {
  const f = await fixture(project("0"), { budgetMode: "unlimited", budgetLimitMinor: null });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await panel.getByLabel("Режим бюджета").selectOption("limited");
    await panel.getByLabel("Лимит бюджета, ₽").fill("0");
    await panel.getByRole("button", { name: "Сохранить бюджет", exact: true }).click();
    await expect(panel).toContainText("Лимит сохранённой версии 8: 0,00 ₽");
    assert.deepEqual(JSON.parse(f.requests.find(r => r.method === "PUT")!.body!), { version: 7, budgetMode: "limited", budgetLimitMinor: "0" });
    assert.equal(await price(f.page, "1"), false);
    await expect(f.page.getByLabel("Тест: цена объекта")).toHaveText("0");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("unknown spend remains incomplete when explicitly switching to unlimited", { skip: !enabled }, async () => {
  const f = await fixture(project(null));
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await expect(panel).toContainText("Итог неполный: часть цен неизвестна");
    await panel.getByLabel("Режим бюджета").selectOption("unlimited");
    await panel.getByRole("button", { name: "Снять ограничение бюджета", exact: true }).click();
    await expect(panel).toContainText("Лимит сохранённой версии 8: без ограничения");
    await expect(panel).toContainText("Расход проекта: Итог неполный");
    await expect(panel).not.toContainText("Расход проекта: 0,00");
    assert.deepEqual(JSON.parse(f.requests.find(r => r.method === "PUT")!.body!), { version: 7, budgetMode: "unlimited", budgetLimitMinor: null });
    assert.equal((await state(f.page)).budget?.spentMinor, null);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("GET failure offers explicit retry without displaying a fabricated budget", { skip: !enabled }, async () => {
  const value = project(); let reads = 0;
  const f = await fixture(value, undefined, { read: async route => { reads++; await route.fulfill(reads === 1 ? { status: 503, json: { error: { code: "unavailable", message: "Synthetic budget unavailable" } } } : { json: budget(value) }); } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveCount(0);
    assert.equal(reads, 1);
    await panel.getByRole("button", { name: "Обновить бюджет", exact: true }).click();
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("500000.00");
    assert.equal(reads, 2);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("rejected budget PUT preserves entered money and unrelated unsaved project edits", { skip: !enabled }, async () => {
  const f = await fixture(project(), undefined, { write: async route => { await route.fulfill({ status: 422, json: { error: { code: "invalid_budget", message: "Synthetic rejected update" } } }); } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await panel.getByLabel("Лимит бюджета, ₽").fill("123456.78");
    await f.page.evaluate(() => (window as unknown as { frc07: { edit: (name: string) => void } }).frc07.edit("Unsaved private name"));
    await panel.getByRole("button", { name: "Сохранить бюджет", exact: true }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("123456.78");
    const current = await state(f.page);
    assert.equal(current.project.projectName, "Unsaved private name");
    assert.equal(current.project.version, 7); assert.equal(current.syncStatus, "dirty");
    assert.equal(f.requests.filter(r => r.method === "PUT").length, 1);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("late successful budget PUT advances the baseline without overwriting a newer edit", { skip: !enabled }, async () => {
  const value = project();
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void; const started = new Promise<void>(resolve => { arrived = resolve; });
  const config: BudgetConfig = { budgetMode: "limited", budgetLimitMinor: "60000000" };
  const saved = { ...value, version: 8 };
  const f = await fixture(value, undefined, { write: async route => { arrived(); await hold; await route.fulfill({ json: { ...saved, snapshot: { project: saved }, budget: budget(saved, config) } }); } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await panel.getByLabel("Лимит бюджета, ₽").fill("600000");
    await panel.getByRole("button", { name: "Сохранить бюджет", exact: true }).click(); await started;
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toBeDisabled();
    await f.page.evaluate(() => (window as unknown as { frc07: { edit: (name: string) => void } }).frc07.edit("Edited while saving"));
    release();
    await expect(panel).toContainText("Лимит сохранённой версии 8");
    const current = await state(f.page);
    assert.equal(current.project.projectName, "Edited while saving");
    assert.equal(current.saved.projectName, value.projectName);
    assert.equal(current.project.version, 8); assert.equal(current.syncStatus, "dirty");
    assert.equal(current.attempt, null);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { release(); await f.page.close(); }
});

test("full-candidate preflight carries all local changes and does not save or reserve budget", { skip: !enabled }, async () => {
  const f = await fixture(project(), undefined, { check: async route => { await route.fulfill({ json: { basedOn: { projectId: "P", projectVersion: 7 }, status: "allowed", reasonCode: "within_budget", projectedSpentMinor: "50000000", projectedRemainingMinor: "0" } }); } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toBeVisible();
    await price(f.page, "50000000");
    await panel.getByRole("button", { name: "Проверить текущий проект", exact: true }).click();
    await expect(panel).toContainText("Проверка не сохраняет проект и не резервирует бюджет");
    const request = f.requests.find(r => r.path === "/api/v1/projects/budget/check")!;
    const body = JSON.parse(request.body!);
    assert.equal(body.version, 7);
    assert.equal(JSON.parse(body.projectJson).placedObjects[0].customPriceMinor, "50000000");
    assert.equal(f.requests.filter(r => r.method === "PUT").length, 0);
    assert.equal((await state(f.page)).project.version, 7);
    assert.equal((await state(f.page)).syncStatus, "dirty");
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

for (const transition of ["project", "version", "identity"] as const) {
  test(`late budget response cannot replace a newly selected ${transition} context`, { skip: !enabled }, async () => {
    const first = project(); const next = project("100", transition === "project" ? "Q" : "P");
    if (transition === "version") next.version = 8;
    const config: BudgetConfig = { budgetMode: "limited", budgetLimitMinor: "70000000" };
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void; const started = new Promise<void>(resolve => { arrived = resolve; });
    let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; });
    let reads = 0;
    const f = await fixture(first, undefined, { read: async route => {
      if (++reads === 1) { arrived(); await hold; try { await route.fulfill({ json: budget(first) }); } finally { finish(); } }
      else await route.fulfill({ json: budget(next, config) });
    } });
    try {
      await started;
      f.server.project = next; f.server.config = config;
      await f.page.evaluate(({ next, transition }) => {
        const api = (window as unknown as { frc07: { identity: (id: string, project: DefenseProject) => void; load: (project: DefenseProject) => void } }).frc07;
        if (transition === "identity") api.identity("budget-B", next); else api.load(next);
      }, { next, transition });
      const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
      await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("700000.00");
      release(); await finished;
      await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("700000.00");
      assert.equal((await state(f.page)).budget?.config.budgetLimitMinor, "70000000");
      assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
    } finally { release(); await f.page.close(); }
  });
}

test("wrong-version budget acknowledgement is rejected without a local-money fallback", { skip: !enabled }, async () => {
  const value = project(); const response = budget(value); response.identity.projectVersion = 8;
  const f = await fixture(value, undefined, { read: async route => { await route.fulfill({ json: response }); } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveCount(0);
    await expect(panel).toContainText("Бюджет не проверен");
    assert.equal((await state(f.page)).budget, null);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("a pending check for the previous project does not disable checking the newly opened project", { skip: !enabled }, async () => {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void; const started = new Promise<void>(resolve => { arrived = resolve; });
  const f = await fixture(project(), undefined, { check: async route => {
    const id = new URL(route.request().url()).searchParams.get("projectId")!;
    if (id === "P") { arrived(); await hold; }
    await route.fulfill({ json: { basedOn: { projectId: id, projectVersion: 7 }, status: "allowed", reasonCode: "within_budget", projectedSpentMinor: "47500000", projectedRemainingMinor: "2500000" } });
  } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await panel.getByRole("button", { name: "Проверить текущий проект", exact: true }).click(); await started;
    const next = project("47500000", "Q"); f.server.project = next;
    await f.page.evaluate(next => (window as unknown as { frc07: { load: (project: DefenseProject) => void } }).frc07.load(next), next);
    await expect(f.page.getByLabel("Тест: текущий проект")).toHaveText("Q");
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Проверить текущий проект", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Проверить текущий проект", exact: true }).click();
    await expect(panel).toContainText("Проверка не сохраняет проект и не резервирует бюджет");
    assert.equal(f.requests.filter(r => r.path.endsWith("/budget/check")).length, 2);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { release(); await f.page.close(); }
});

test("recovering an uncertain budget update displays its frozen requested money before retry", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("500000.00");
    await f.page.evaluate(() => (window as unknown as { frc07: { recoverBudget: (config: BudgetConfig) => void } }).frc07.recoverBudget({ budgetMode: "limited", budgetLimitMinor: "60000001" }));
    await expect(panel.getByRole("button", { name: "Повторить сохранение бюджета", exact: true })).toBeVisible();
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("600000.01");
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toBeDisabled();
    assert.equal(f.requests.filter(r => r.method === "PUT").length, 0);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});

test("a conflict after retrying a recovered budget intent retains its requested value", { skip: !enabled }, async () => {
  const f = await fixture(project(), undefined, { write: async route => { await route.fulfill({ status: 409, json: { error: { code: "version_conflict", message: "Synthetic concurrent save after verification" } } }); } });
  try {
    const panel = f.page.getByRole("region", { name: "Бюджет проекта", exact: true });
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("500000.00");
    await f.page.evaluate(() => (window as unknown as { frc07: { recoverBudget: (config: BudgetConfig) => void } }).frc07.recoverBudget({ budgetMode: "limited", budgetLimitMinor: "60000001" }));
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("600000.01");
    await panel.getByRole("button", { name: "Повторить сохранение бюджета", exact: true }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toBeEnabled();
    await expect(panel.getByLabel("Лимит бюджета, ₽")).toHaveValue("600000.01");
    assert.equal(f.requests.filter(r => r.method === "PUT").length, 1);
    assert.equal((await state(f.page)).project.version, 7);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
  } finally { await f.page.close(); }
});
