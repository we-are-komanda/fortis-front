import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Route } from "@playwright/test";

const enabled = process.env.FRC09_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;
const document = { id: "document-1", assetId: "asset-1", name: "source.txt", mimeType: "text/plain", sizeBytes: 9, revision: "1", checksum: "a".repeat(64), status: "ready", commercial: true, createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" };
before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const result = await build({
    stdin: { contents: `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import {AssetDocumentsPanel} from './src/modules/drone-defense/ui/asset-documents-panel'; import {setAuthenticatedIdentity} from './src/shared/lib/session-state'; const root=createRoot(document.getElementById('root')); window.frc09={render(assetId='asset-1',callback=true){root.render(createElement(AssetDocumentsPanel,{assetId,onSourceSelected:callback ? document=>window.selectedSource=document : undefined}));},identity:setAuthenticatedIdentity};window.frc09.render();`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty", ".module.css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

async function fixture(handler: (route: Route) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fortis.test/**", async route => {
    if (new URL(route.request().url()).pathname.startsWith("/api/")) await handler(route);
    else await route.fulfill({ contentType: "text/html", body: '<html lang="ru"><body><div id="root"></div></body></html>' });
  });
  await page.goto("https://fortis.test/documents/");
  await page.addScriptTag({ content: bundle });
  return { page, errors };
}
test("lists all statuses safely and only ready source callback exposes immutable metadata", { skip: !enabled }, async () => {
  const name = '<img src=x onerror="window.injected=1">';
  const items = ["ready", "quarantined", "rejected", "legacy_unavailable"].map((status, index) => ({ ...document, id: `doc-${index}`, status, name: index ? status : name, checksum: status === "legacy_unavailable" ? null : document.checksum }));
  const { page, errors } = await fixture(async route => { await route.fulfill({ json: { items, totalItems: 4 } }); });
  try {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    for (const status of ["Готов к скачиванию", "На проверке — скачивание недоступно", "Отклонён проверкой", "Старый файл недоступен"]) await expect(page.getByText(status, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Скачать", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Использовать как источник" })).toHaveCount(1);
    await page.getByRole("button", { name: "Использовать как источник" }).click();
    assert.deepEqual(await page.evaluate(() => (window as unknown as { selectedSource: unknown }).selectedSource), items[0]);
    await expect(page.locator("img")).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test("scanner503 preserves selected file, refreshes quarantine and succeeds only after a real retry", { skip: !enabled }, async () => {
  let writes = 0;
  const { page, errors } = await fixture(async route => {
    if (route.request().method() === "POST") {
      writes++;
      assert.match(route.request().headers()["content-type"], /^multipart\/form-data; boundary=/);
      assert.match(route.request().postData()!, /Synthetic/);
      await route.fulfill(writes === 1 ? { status: 503, json: { code: "document_unavailable" }, headers: { "x-request-id": "scanner-off" } } : { status: 201, json: document });
    } else await route.fulfill({ json: { items: writes ? [{ ...document, status: writes === 1 ? "quarantined" : "ready" }] : [], totalItems: writes ? 1 : 0 } });
  });
  try {
    const input = page.getByLabel("Файл документа");
    await input.setInputFiles({ name: "source.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic") });
    await page.getByRole("button", { name: "Загрузить файл", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Проверка файлов или хранилище недоступны");
    await expect(page.getByRole("alert")).toContainText("scanner-off");
    assert.equal(await input.evaluate((element: HTMLInputElement) => element.files?.[0]?.name), "source.txt");
    await expect(page.getByText("На проверке — скачивание недоступно", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Скачать", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Загрузить файл", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Файл загружен и проверен");
    await expect(page.getByRole("button", { name: "Скачать", exact: true })).toBeVisible();
    assert.equal(await input.evaluate((element: HTMLInputElement) => element.files?.length), 0);
    assert.equal(writes, 2); assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test("invalid file is blocked locally with accessible feedback", { skip: !enabled }, async () => {
  let writes = 0;
  const { page } = await fixture(async route => { if (route.request().method() === "POST") writes++; await route.fulfill({ json: { items: [], totalItems: 0 } }); });
  try {
    await page.getByLabel("Файл документа").setInputFiles({ name: "bad.html", mimeType: "text/html", buffer: Buffer.from("<html/>") });
    await expect(page.getByRole("alert")).toContainText("PDF, PNG, JPEG или TXT");
    await expect(page.getByLabel("Файл документа")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Загрузить файл", exact: true })).toBeDisabled();
    assert.equal(writes, 0);
  } finally { await page.close(); }
});
test("download uses authenticated blob attachment and deletion refreshes the list", { skip: !enabled }, async () => {
  let removed = false;
  const { page } = await fixture(async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/download")) { assert.equal(url.searchParams.get("assetId"), "asset-1"); await route.fulfill({ contentType: "text/plain", body: "Synthetic" }); }
    else if (route.request().method() === "DELETE") { removed = true; await route.fulfill({ json: { status: "ok" } }); }
    else await route.fulfill({ json: { items: removed ? [] : [document], totalItems: removed ? 0 : 1 } });
  });
  try {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать", exact: true }).click();
    const download = await downloaded;
    assert.match(download.url(), /^blob:https:\/\/fortis.test\//);
    assert.equal(download.suggestedFilename(), "source.txt");
    await page.getByRole("button", { name: "Удалить документ", exact: true }).click();
    await expect(page.getByText("Документы пока не загружены.", { exact: true })).toBeVisible();
    assert.equal(removed, true);
  } finally { await page.close(); }
});
test("changing selected card suppresses a delayed old list and optional source controls", { skip: !enabled }, async () => {
  let release!: () => void; let arrived!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { arrived = resolve; });
  const { page, errors } = await fixture(async route => {
    if (new URL(route.request().url()).searchParams.get("assetId") === "asset-1") { arrived(); await hold; await route.fulfill({ json: { items: [document], totalItems: 1 } }).catch(() => {}); }
    else await route.fulfill({ json: { items: [{ ...document, id: "doc-B", assetId: "asset-2", name: "B.txt" }], totalItems: 1 } });
  });
  try {
    await started;
    await page.evaluate(() => (window as unknown as { frc09: { render: (id: string, callback: boolean) => void } }).frc09.render("asset-2", false));
    await expect(page.getByText("B.txt", { exact: true })).toBeVisible();
    release();
    await expect(page.getByText("source.txt", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Использовать как источник" })).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { release(); await page.close(); }
});

test("account switch removes document metadata and selected file immediately", { skip: !enabled }, async () => {
  let lists = 0;
  const { page } = await fixture(async route => { lists++; await route.fulfill({ json: { items: lists === 1 ? [document] : [], totalItems: lists === 1 ? 1 : 0 } }); });
  try {
    await expect(page.getByText("source.txt", { exact: true })).toBeVisible();
    await page.getByLabel("Файл документа").setInputFiles({ name: "A-private.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic") });
    await page.evaluate(() => (window as unknown as { frc09: { identity: (id: string) => void } }).frc09.identity("new-identity"));
    await expect(page.getByText("Документы пока не загружены.", { exact: true })).toBeVisible();
    await expect(page.getByText("source.txt", { exact: true })).toHaveCount(0);
    assert.equal(await page.getByLabel("Файл документа").evaluate((input: HTMLInputElement) => input.files?.length), 0);
  } finally { await page.close(); }
});

test("revoked download closes stale ready actions and metadata until list is verified again", { skip: !enabled }, async () => {
  const { page } = await fixture(async route => {
    if (new URL(route.request().url()).pathname.endsWith("/download")) await route.fulfill({ status: 404, json: { code: "document_unavailable" } });
    else await route.fulfill({ json: { items: [document], totalItems: 1 } });
  });
  try {
    await page.getByRole("button", { name: "Скачать", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("недоступны");
    await expect(page.getByRole("button", { name: "Использовать как источник" })).toHaveCount(0);
    await expect(page.getByText("source.txt", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Обновить документы" })).toBeEnabled();
  } finally { await page.close(); }
});
