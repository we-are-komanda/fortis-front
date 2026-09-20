import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Page, type Route } from "@playwright/test";
import type { DefenseAsset } from "@/shared/types/defense-project";

const enabled = process.env.FRC09_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;
const enterpriseId = "enterprise-synthetic";
const source = { quality: "confirmed" as const, sourceLabel: "Customer source", sourceDocumentId: null, sourceDate: "2026-09-20", sourceUrl: null, recordedAt: "2026-09-20T00:00:00Z", recordedBy: "synthetic-user", revision: "1" };
const asset: DefenseAsset = { id: "asset-1", name: "Original card", category: "detection", roles: ["detect"], pricePerUnitMln: 0.125, unitPriceMinor: "12500000", currency: "RUB", unitLabel: "шт", coverageType: "circle", deploymentType: "static", placementType: "map-object", enterpriseId, isPublic: false };
const document = { id: "document-1", assetId: asset.id, name: "Customer-price.txt", mimeType: "text/plain", sizeBytes: 9, revision: "3", checksum: "a".repeat(64), status: "ready", commercial: true, createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" };

before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const result = await build({
    stdin: { contents: `
      import {createElement,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {AssetLibraryManager} from './src/modules/drone-defense/ui/asset-library-manager';
      import {useDefenseProjectStore as store} from './src/shared/lib/use-defense-project-store';
      import {createWorkspaceDefenseProject} from './src/shared/lib/defense-project';
      const initial=window.frc09Initial;
      const project={...createWorkspaceDefenseProject(),projectId:'project-1',version:7,source:'backend',enterpriseId:initial.enterpriseId,assetLibrary:initial.assets,placedObjects:[{id:'object-1',assetId:'asset-1',layerId:'layer-1',quantity:2,customPriceMinor:'99',status:'planned',coordinates:{lat:0,lng:0},createdAt:'2026-09-20T00:00:00Z',updatedAt:'2026-09-20T00:00:00Z'}]};
      store.setState({project,runtimeMode:'workspace',syncStatus:'saved',hydrated:true,accessError:null,assetLibraryPreview:null});
      window.frc09Manager={snapshot(){const s=store.getState();return {project:s.project,syncStatus:s.syncStatus,preview:s.assetLibraryPreview?.assets??null};}};
      function Harness(){const state=store();const [selected,setSelected]=useState('asset-1');const [message,setMessage]=useState('');return createElement('div',null,
        createElement(AssetLibraryManager,{assets:state.project.assetLibrary,enterpriseId:state.project.enterpriseId,previewAssets:state.assetLibraryPreview?.baseProject===state.project ? state.assetLibraryPreview.assets:null,onApplyPreview:state.applyAssetLibraryPreview,onDiscardPreview:state.discardAssetLibraryPreview,placedObjects:state.project.placedObjects,selectedAssetId:selected,loading:state.assetLibraryLoading,error:state.assetLibraryError,onRefresh:()=>state.refreshAssetLibrary({isPublic:true,limit:100}),onSelectAsset:setSelected,onAssetSaved:state.upsertAssetInLibrary,onAssetDeleted:state.removeAssetFromLibrary,onMessage:setMessage}),createElement('p',{'data-testid':'last-message'},message));}
      createRoot(document.getElementById('root')).render(createElement(Harness));`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty", ".module.css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

async function fixture(handler: (route: Route) => Promise<void>, assets: DefenseAsset[] = [asset]) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, "https://fortis.test", "source URLs must not be fetched");
    if (url.pathname.startsWith("/api/")) await handler(route);
    else await route.fulfill({ contentType: "text/html", body: '<html lang="ru"><body><div id="root"></div></body></html>' });
  });
  await page.goto("https://fortis.test/library/");
  await page.evaluate(initial => Object.assign(window, { frc09Initial: initial }), { assets, enterpriseId });
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}
async function snapshot(page: Page) {
  return page.evaluate(() => (window as unknown as { frc09Manager: { snapshot: () => { project: { assetLibrary: DefenseAsset[]; version: number; placedObjects: { customPriceMinor: string }[] }; syncStatus: string; preview: DefenseAsset[] | null } } }).frc09Manager.snapshot());
}
async function emptyDocuments(route: Route) { await route.fulfill({ json: { items: [], totalItems: 0 } }); }

test("new private card inherits enterprise, validates source before write and renders supplied HTML as text", { skip: !enabled }, async () => {
  const writes: Record<string, unknown>[] = [];
  const html = '<img src=x onerror="window.injected=1">';
  const { page, errors } = await fixture(async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); writes.push(body);
      await route.fulfill({ status: 201, json: { ...body, id: "created-1", provenance: { ...body.provenance, recordedAt: source.recordedAt, recordedBy: source.recordedBy, revision: "1" } } });
    } else await emptyDocuments(route);
  });
  try {
    await expect(page.getByTestId("asset-provenance")).toContainText("Источник не указан");
    await page.getByRole("button", { name: "Создать средство защиты", exact: true }).click();
    await expect(page.getByLabel("Общий каталог")).not.toBeChecked();
    await expect(page.getByLabel("enterpriseId", { exact: true })).toHaveValue(enterpriseId);
    await expect(page.getByRole("region", { name: "Документы карточки" })).toHaveCount(0);
    await page.getByLabel("Название", { exact: true }).fill(html);
    await page.getByLabel("Описание", { exact: true }).fill(html);
    await page.getByLabel("млн ₽", { exact: true }).fill("0,125");
    await page.getByLabel("Качество данных", { exact: true }).selectOption("confirmed");
    await page.getByRole("button", { name: /Сохранить/ }).click();
    await expect(page.getByText("Для подтверждения укажите источник и его дату.", { exact: true })).toBeVisible();
    assert.equal(writes.length, 0);
    await page.getByLabel("Описание источника", { exact: true }).fill("Customer quotation");
    await page.getByLabel("Дата источника", { exact: true }).fill("2026-09-20");
    await page.getByLabel("Ссылка на источник", { exact: true }).fill("javascript:alert(1)");
    await page.getByRole("button", { name: /Сохранить/ }).click();
    await expect(page.getByText("Укажите ссылку на источник с http или https.", { exact: true })).toBeVisible();
    assert.equal(writes.length, 0);
    await page.getByLabel("Ссылка на источник", { exact: true }).fill("https://source.invalid/customer");
    await page.getByRole("button", { name: /Сохранить/ }).click();
    await expect(page.getByTestId("last-message")).toContainText(html);
    assert.equal(writes[0].unitPriceMinor, "12500000");
    assert.equal(writes[0].enterpriseId, enterpriseId); assert.equal(writes[0].isPublic, false);
    assert.equal(writes[0].name, html); assert.equal(writes[0].description, html);
    const state = await snapshot(page);
    assert.equal(state.project.assetLibrary.length, 1); assert.equal(state.syncStatus, "saved");
    assert.equal(state.preview?.find(item => item.id === "created-1")?.name, html);
    await expect(page.locator("img")).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("price edit downgrades confirmed source and selecting unknown clears both price provenance fields", { skip: !enabled }, async () => {
  const writes: Record<string, unknown>[] = [];
  const confirmed = { ...asset, provenance: source, fieldProvenance: { unitPriceMinor: source, pricePerUnitMln: source, coverageRadius: source } };
  const { page } = await fixture(async route => {
    if (route.request().method() === "PUT") { const body = route.request().postDataJSON(); writes.push(body); await route.fulfill({ json: { ...body, id: asset.id } }); }
    else await emptyDocuments(route);
  }, [confirmed]);
  try {
    await expect(page.getByTestId("asset-provenance")).toContainText("Источник подтверждён пользователем");
    await page.getByRole("button", { name: "Редактировать выбранное средство", exact: true }).click();
    await expect(page.getByLabel("Качество данных", { exact: true })).toHaveValue("confirmed");
    await page.getByLabel("млн ₽", { exact: true }).fill("0.475");
    await expect(page.getByLabel("Качество данных", { exact: true })).toHaveValue("estimated");
    await page.getByLabel("Качество данных", { exact: true }).selectOption("unknown");
    await page.getByRole("button", { name: /Сохранить/ }).click();
    await expect(page.getByTestId("last-message")).toContainText("сохранено в библиотеке");
    assert.equal(writes[0].unitPriceMinor, "47500000"); assert.equal(writes[0].provenance, null);
    assert.deepEqual(writes[0].fieldProvenance, { coverageRadius: source });
  } finally { await page.close(); }
});

test("ready document callback fills source, server-stamped immutable revision enters preview", { skip: !enabled }, async () => {
  const writes: Record<string, unknown>[] = [];
  const { page } = await fixture(async route => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON(); writes.push(body);
      const provenance = { ...body.provenance, recordedAt: source.recordedAt, recordedBy: source.recordedBy, revision: "2", sourceDocumentRevision: document.revision, sourceDocumentChecksum: document.checksum };
      await route.fulfill({ json: { ...body, id: asset.id, provenance, fieldProvenance: { unitPriceMinor: provenance } } });
    } else await route.fulfill({ json: { items: [document], totalItems: 1 } });
  });
  try {
    await page.getByRole("button", { name: "Редактировать выбранное средство", exact: true }).click();
    await page.getByRole("button", { name: "Использовать как источник", exact: true }).click();
    await expect(page.getByLabel("Описание источника", { exact: true })).toHaveValue(document.name);
    await expect(page.getByText(`Документ: ${document.id}`, { exact: false })).toBeVisible();
    await page.getByLabel("Качество данных", { exact: true }).selectOption("confirmed");
    await page.getByLabel("Дата источника", { exact: true }).fill("2026-09-20");
    await page.getByRole("button", { name: /Сохранить/ }).click();
    await expect(page.getByTestId("last-message")).toContainText("сохранено в библиотеке");
    assert.equal((writes[0].provenance as { sourceDocumentId: string }).sourceDocumentId, document.id);
    const savedSource = (await snapshot(page)).preview?.[0].provenance;
    assert.equal(savedSource?.sourceDocumentRevision, "3"); assert.equal(savedSource?.sourceDocumentChecksum, document.checksum);
  } finally { await page.close(); }
});

test("catalogue preview cancel leaves saved project intact; explicit apply makes one draft preserving instance price", { skip: !enabled }, async () => {
  const updated = { ...asset, name: "Refreshed card", unitPriceMinor: "47500000", pricePerUnitMln: 0.475, provenance: source };
  const { page } = await fixture(async route => { await route.fulfill({ json: { items: [updated], totalItems: 1 } }); });
  try {
    const initial = await snapshot(page);
    await page.getByRole("button", { name: "Обновить каталог с сервера", exact: true }).click();
    await expect(page.getByRole("region", { name: "Просмотр изменений каталога" })).toBeVisible();
    const pending = await snapshot(page);
    assert.deepEqual(pending.project, initial.project); assert.equal(pending.syncStatus, "saved");
    await page.getByRole("button", { name: "Отменить обновление", exact: true }).click();
    await expect(page.getByRole("region", { name: "Просмотр изменений каталога" })).toHaveCount(0);
    assert.deepEqual((await snapshot(page)).project, initial.project);
    await page.getByRole("button", { name: "Обновить каталог с сервера", exact: true }).click();
    await page.getByRole("button", { name: "Применить к черновику", exact: true }).click();
    await expect(page.getByRole("region", { name: "Просмотр изменений каталога" })).toHaveCount(0);
    const applied = await snapshot(page);
    assert.equal(applied.project.assetLibrary[0].unitPriceMinor, "47500000");
    assert.equal(applied.project.placedObjects[0].customPriceMinor, "99");
    assert.equal(applied.project.version, 7); assert.equal(applied.syncStatus, "dirty");
  } finally { await page.close(); }
});

test("using a ready document as source cannot silently discard selection under default quality", { skip: !enabled }, async () => {
  const writes: Record<string, unknown>[] = [];
  const { page } = await fixture(async route => {
    if (route.request().method() === "PUT") { const body = route.request().postDataJSON(); writes.push(body); await route.fulfill({ json: { ...body, id: asset.id } }); }
    else await route.fulfill({ json: { items: [document], totalItems: 1 } });
  });
  try {
    await page.getByRole("button", { name: "Редактировать выбранное средство", exact: true }).click();
    await page.getByRole("button", { name: "Использовать как источник", exact: true }).click();
    await expect(page.getByLabel("Описание источника", { exact: true })).toHaveValue(document.name);
    await page.getByRole("button", { name: /Сохранить/ }).click();
    await expect(page.getByTestId("last-message")).toContainText("сохранено в библиотеке");
    assert.equal((writes[0].provenance as { sourceDocumentId?: string } | null)?.sourceDocumentId, document.id);
    assert.equal((writes[0].provenance as { quality?: string } | null)?.quality, "estimated");
  } finally { await page.close(); }
});

test("invalid imported price stays editable and cannot silently save until explicitly corrected",{skip:!enabled},async()=>{
 const writes:Record<string,unknown>[]=[];
 const {page,errors}=await fixture(async route=>{
  if(route.request().method()==="PUT"){const body=route.request().postDataJSON();writes.push(body);await route.fulfill({json:{...body,id:asset.id}});}
  else await emptyDocuments(route);
 },[{...asset,unitPriceMinor:"bad"}]);
 try{
  await expect(page.getByTestId("asset-provenance")).toContainText("Некорректная цена");
  await page.getByRole("button",{name:"Редактировать выбранное средство",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Некорректная цена");
  await page.getByLabel("Название",{exact:true}).fill("Renamed only");
  await page.getByRole("button",{name:/Сохранить/}).click();
  assert.equal(writes.length,0);
  await page.getByLabel("млн ₽",{exact:true}).fill("0.125");
  await page.getByRole("button",{name:/Сохранить/}).click();
  await expect(page.getByTestId("last-message")).toContainText("сохранено в библиотеке");
  assert.equal(writes[0].unitPriceMinor,"12500000");
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
