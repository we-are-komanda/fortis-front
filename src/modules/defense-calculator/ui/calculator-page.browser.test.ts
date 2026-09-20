import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Page, type Route } from "@playwright/test";
import fixtureData from "../../../../test/fixtures/finance-v1.json";
import { buildDraftCostProjection } from "@/shared/lib/cost-projection";
import type { DefenseAsset, DefenseProject, PlacedDefenseObject } from "@/shared/types/defense-project";
import type { CostProjection } from "@/shared/types/finance";

const enabled = process.env.FRC05_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;

before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const result = await build({
    stdin: {
      contents: `
        import {createElement} from "react";
        import {createRoot} from "react-dom/client";
        import {CalculatorPage} from "./src/modules/defense-calculator/ui/calculator-page";
        import {RuntimeProvider} from "./src/shared/ui/runtime-provider";
        import {useDefenseProjectStore} from "./src/shared/lib/use-defense-project-store";
        import {EchelonObjectsList} from "./src/modules/drone-defense/ui/echelon-objects-list";
        import {placedObjectsToMapPlacements} from "./src/modules/drone-defense/domain/project-map-adapter";
        import {buildDraftCostProjection} from "./src/shared/lib/cost-projection";
        const root = createRoot(document.getElementById("root"));
        window.frc05 = {
          setProject(project, syncStatus) { useDefenseProjectStore.setState({ project, syncStatus, hydrated:true, accessError:null }); },
          renderMapList(project) {
            const placements = placedObjectsToMapPlacements({project,facilityId:"synthetic",scenarioId:"baseline"});
            root.render(createElement(EchelonObjectsList,{
              layerId:project.layers[0].id, placements, costLines:buildDraftCostProjection(project).lines,
              catalog:{assets:[{id:placements[0].assetId,name:"Legacy map template",cost:{capexRub:125000}}]},
              layers:project.layers.map(layer=>({id:layer.id,name:layer.name,shortName:layer.code})),
              hiddenPlacementIds:new Set(),selectedPlacementId:null,onSelect(){},onLocate(){},onToggleVisibility(){},onRemove(){}
            }));
          }
        };
        window.frc05.setProject(window.frc05Initial.project, window.frc05Initial.syncStatus);
        root.render(createElement(RuntimeProvider,null,createElement(CalculatorPage)));
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser",
    loader: { ".css": "empty", ".module.css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "test-next-link",
      setup(build: { onResolve: (options: { filter: RegExp }, callback: () => unknown) => void; onLoad: (options: { filter: RegExp; namespace: string }, callback: () => unknown) => void }) {
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "test-next" }));
        build.onLoad({ filter: /.*/, namespace: "test-next" }, () => ({ contents: 'import {createElement} from "react"; export default function Link({href,children,...props}) { return createElement("a",{...props,href},children); }', loader: "js", resolveDir: process.cwd() }));
      },
    }],
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

function project(): DefenseProject {
  return {
    schemaVersion: 1, projectId: fixtureData.variantA.projectId, projectName: "Synthetic accounting", version: 7,
    source: "backend", mode: "view", updatedAt: "2026-09-20T00:00:00Z",
    baseObject: { id: "base", name: "Synthetic site", center: { lat: 0, lng: 0 } },
    layers: fixtureData.layers.map((layer, order) => ({ ...layer, code: `CUSTOM-${order}`, order, geometryType: "circle", geometry: { type: "circle", center: { lat: 0, lng: 0 } }, isActive: true })),
    assetLibrary: fixtureData.assets.map((asset): DefenseAsset => ({ ...asset, pricePerUnitMln: null, currency: "RUB", category: "infrastructure", roles: [], unitLabel: "unit", coverageType: "none", deploymentType: "static", placementType: "map-object" })),
    placedObjects: fixtureData.variantA.objects.map((object): PlacedDefenseObject => ({ ...object, coordinates: { lat: 0, lng: 0 }, status: "planned", createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" })),
  };
}

function serverCost(value: DefenseProject): CostProjection {
  const { kind, basedOn, ...amounts } = buildDraftCostProjection(value);
  void kind; void basedOn;
  return { ...amounts, identity: { projectId: value.projectId, projectVersion: value.version!, calculationVersion: "finance-v1", inputDataVersions: {}, snapshotDigest: "a".repeat(64) } };
}

async function pageFixture(value: DefenseProject, syncStatus: "saved" | "dirty" | "unverified", cost?: (route: Route) => Promise<void>) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fortis.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/runtime") await route.fulfill({ json: { mode: "workspace" } });
    else if (url.pathname === "/api/v1/projects/cost") {
      if (!cost) throw new Error("A draft must not request a saved cost projection");
      await cost(route);
    } else await route.fulfill({ contentType: "text/html", body: '<html lang="ru"><body><div id="root"></div></body></html>' });
  });
  await page.goto("https://fortis.test/calculator/");
  await page.evaluate(initial => Object.assign(window, { frc05Initial: initial }), { project: value, syncStatus });
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}

async function setProject(page: Page, value: DefenseProject, syncStatus: "saved" | "dirty" | "unverified") {
  await page.evaluate(({ value, syncStatus }) => {
    const harness = (window as unknown as { frc05: { setProject: (project: DefenseProject, status: string) => void } }).frc05;
    harness.setProject(value, syncStatus);
  }, { value, syncStatus });
}

for (const transition of ["version", "project"] as const) {
  test(`late saved ${transition} response cannot replace the newly selected projection`, { skip: !enabled }, async () => {
    const first = project();
    const next = structuredClone(first);
    if (transition === "version") next.version = 8;
    else next.projectId = "fixture-project-next";
    next.placedObjects[0].customPriceMinor = "0";
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void;
    const requestStarted = new Promise<void>(resolve => { arrived = resolve; });
    let finished!: () => void;
    const oldFinished = new Promise<void>(resolve => { finished = resolve; });
    const { page, errors } = await pageFixture(first, "saved", async route => {
      const url = new URL(route.request().url());
      const old = url.searchParams.get("projectId") === first.projectId && url.searchParams.get("projectVersion") === String(first.version);
      if (old) {
        arrived();
        await hold;
        try { await route.fulfill({ json: serverCost(first) }); } finally { finished(); }
      } else await route.fulfill({ json: serverCost(next) });
    });
    try {
      await requestStarted;
      await setProject(page, next, "saved");
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(/225\s*000,00 ₽/);
      await expect(page.getByText(`Сохранённая версия ${next.version}`, { exact: true })).toBeVisible();
      release();
      await oldFinished;
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(/225\s*000,00 ₽/);
      assert.deepEqual(errors, []);
    } finally { release(); await page.close(); }
  });
}

test("saved rows and totals come from one server projection; dirty edits replace all of it", { skip: !enabled }, async () => {
  const savedProject = project();
  savedProject.placedObjects[0].name = "Saved row";
  const local = project();
  local.placedObjects[0].name = "Local unsaved row";
  let requests = 0;
  const { page, errors } = await pageFixture(local, "saved", async route => { requests++; await route.fulfill({ json: serverCost(savedProject) }); });
  try {
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(/475\s*000,00 ₽/);
    await expect(page.getByRole("heading", { name: "Saved row", exact: true })).toBeVisible();
    await expect(page.getByText("Local unsaved row", { exact: true })).toHaveCount(0);
    local.placedObjects[0].quantity = 4;
    await setProject(page, local, "dirty");
    await expect(page.getByText("Черновой расчёт — изменения не сохранены", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(/725\s*000,00 ₽/);
    await expect(page.getByRole("heading", { name: "Local unsaved row", exact: true })).toBeVisible();
    await expect(page.getByText("Saved row", { exact: true })).toHaveCount(0);
    assert.equal(requests, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("unknown prices stay incomplete while explicit zero remains a known price", { skip: !enabled }, async () => {
  const value = project();
  value.placedObjects = value.placedObjects.slice(0, 2);
  value.placedObjects[0].customPriceMinor = "0";
  value.assetLibrary[1].unitPriceMinor = null;
  const { page, errors } = await pageFixture(value, "dirty");
  try {
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Итог неполный");
    await expect(page.getByText("Стоимость неизвестна", { exact: true })).toBeVisible();
    await expect(page.getByText(/Известная часть: 0,00 ₽/)).toBeVisible();
    value.placedObjects = value.placedObjects.slice(0, 1);
    await setProject(page, value, "dirty");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("0,00 ₽");
    await expect(page.getByText("Стоимость неизвестна", { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("empty project has zero total and no catalogue or recommended rows", { skip: !enabled }, async () => {
  const value = project();
  value.placedObjects = [];
  const { page, errors } = await pageFixture(value, "dirty");
  try {
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("0,00 ₽");
    await expect(page.getByText("0 позиций · 0 единиц", { exact: true })).toBeVisible();
    await expect(page.getByText(/В проекте пока нет размещённых объектов/)).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("saved 503 shows a retryable error with request ID and never falls back to local money", { skip: !enabled }, async () => {
  const value = project();
  let calls = 0;
  const { page, errors } = await pageFixture(value, "saved", async route => {
    calls++;
    if (calls === 1) await route.fulfill({ status: 503, headers: { "x-request-id": "synthetic-cost-unavailable" }, json: { error: { code: "unavailable" } } });
    else await route.fulfill({ json: serverCost(value) });
  });
  try {
    await expect(page.getByRole("alert")).toContainText("synthetic-cost-unavailable");
    await expect(page.getByRole("region", { name: "Смета размещённых объектов" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(/475\s*000,00 ₽/);
    assert.equal(calls, 2);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("saved names and source labels render as escaped text", { skip: !enabled }, async () => {
  const value = project();
  const malicious = '<img src=x onerror="window.frc05Injected=true">';
  value.placedObjects[0].name = malicious;
  value.layers[0].name = malicious;
  value.assetLibrary[0].provenance = { sourceLabel: malicious, sourceDocumentId: null, sourceUrl: null, sourceDate: null, recordedAt: "2026-09-20T00:00:00Z", recordedBy: "synthetic", quality: "estimated", revision: "1" };
  const { page, errors } = await pageFixture(value, "saved", async route => { await route.fulfill({ json: serverCost(value) }); });
  try {
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(/475\s*000,00 ₽/);
    await expect(page.getByText(malicious, { exact: true })).toHaveCount(3);
    await expect(page.locator("img")).toHaveCount(0);
    assert.equal(await page.evaluate(() => "frc05Injected" in window), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("malformed provenance fails as a protocol error before it reaches React rendering", { skip: !enabled }, async () => {
  const value = project();
  const payload = serverCost(value);
  payload.lines[0].provenance = { sourceLabel: { malformed: true }, quality: "estimated" } as unknown as NonNullable<CostProjection["lines"][number]["provenance"]>;
  const { page, errors } = await pageFixture(value, "saved", async route => { await route.fulfill({ json: payload }); });
  try {
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("map object list uses real object financial lines, including zero and unknown", { skip: !enabled }, async () => {
  const value = project();
  value.placedObjects = value.placedObjects.slice(0, 2);
  Object.assign(value.placedObjects[0], { customPriceMinor: "0", name: "Zero line" });
  Object.assign(value.placedObjects[1], { customPriceMinor: null, name: "Unknown line", layerId: value.layers[0].id });
  const { page, errors } = await pageFixture(value, "dirty");
  try {
    await page.evaluate(value => {
      (window as unknown as { frc05: { renderMapList: (value: DefenseProject) => void } }).frc05.renderMapList(value);
    }, value);
    await expect(page.getByRole("button", { name: /Zero line/ })).toContainText("0,00 ₽");
    await expect(page.getByRole("button", { name: /Unknown line/ })).toContainText("Итог неполный");
    await expect(page.getByText(/млн ₽/)).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("malformed draft source shows an input error without crashing React",{skip:!enabled},async()=>{
 const value=project();
 value.assetLibrary[0].provenance={sourceLabel:{bad:"child"},quality:"estimated"} as unknown as NonNullable<DefenseAsset["provenance"]>;
 const {page,errors}=await pageFixture(value,"dirty");
 try {
  await expect(page.getByRole("alert")).toContainText("источники");
  await expect(page.getByRole("region",{name:"Смета размещённых объектов"})).toHaveCount(0);
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
