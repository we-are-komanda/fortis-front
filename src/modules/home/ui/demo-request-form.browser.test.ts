import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { chromium, expect, type Browser, type Page, type Route } from "@playwright/test";

const enabled = process.env.FRC12_BROWSER_TESTS === "true";
let browser: Browser;
let bundle: string;
const configuration = { enabled: true, consentVersion: "synthetic-ui-v1", consentText: "Synthetic fixture consent text <b>plain text</b>; not publication policy." };
before(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx"))("esbuild");
  const output = await build({
    stdin: { contents: 'import {createElement} from "react"; import {createRoot} from "react-dom/client"; import {DemoRequestForm} from "./src/modules/home/ui/demo-request-form"; createRoot(document.getElementById("root")).render(createElement(DemoRequestForm));', resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"production"' },
  });
  bundle = output.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

async function fixture(config: unknown, submit?: (route: Route) => Promise<void>) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.route("https://fortis.test/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/public/demo-requests") {
      if (route.request().method() === "GET") await route.fulfill({ json: config });
      else if (submit) await submit(route);
      else throw new Error("Unexpected submission");
    } else await route.fulfill({ contentType: "text/html", body: '<html lang="ru"><body><div id="root"></div></body></html>' });
  });
  await page.goto("https://fortis.test/");
  await page.addScriptTag({ content: bundle });
  return page;
}

async function fill(page: Page) {
  await page.getByLabel("Имя", { exact: true }).fill(" Synthetic Person ");
  await page.getByLabel("Организация", { exact: true }).fill(" Test organization ");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByLabel("Комментарий", { exact: true }).fill("Original input");
  await page.getByRole("checkbox").check();
}

test("disabled collection never mounts personal-data fields or a success state", { skip: !enabled }, async () => {
  const page = await fixture({ enabled: false });
  try {
    await expect(page.getByRole("status")).toContainText("Приём заявок сейчас недоступен");
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByText("Заявка получена", { exact: false })).toHaveCount(0);
  } finally { await page.close(); }
});

test("required fields and server-provided consent are validated before sending", { skip: !enabled }, async () => {
  let calls = 0;
  const page = await fixture(configuration, async (route) => { calls++; await route.fulfill({ status: 500 }); });
  try {
    await expect(page.getByRole("checkbox")).toBeVisible();
    await expect(page.getByText(configuration.consentText, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Запросить демонстрацию", exact: true }).click();
    await expect(page.getByLabel("Имя", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Имя", { exact: true })).toBeFocused();
    await expect(page.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
    assert.equal(calls, 0);
  } finally { await page.close(); }
});

test("configuration failure remains closed and allows an explicit reload", { skip: !enabled }, async () => {
  const page = await browser.newPage();
  let gets = 0;
  await page.route("https://fortis.test/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/public/demo-requests") {
      gets++;
      if (gets === 1) await route.fulfill({ status: 503, headers: { "x-request-id": "config-failure" }, json: { error: { code: "unavailable" } } });
      else await route.fulfill({ json: configuration });
    } else await route.fulfill({ contentType: "text/html", body: '<html lang="ru"><body><div id="root"></div></body></html>' });
  });
  try {
    await page.goto("https://fortis.test/");
    await page.addScriptTag({ content: bundle });
    await expect(page.getByRole("alert")).toContainText("config-failure");
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Проверить ещё раз", exact: true }).click();
    await expect(page.getByRole("checkbox")).toBeVisible();
    assert.equal(gets, 2);
  } finally { await page.close(); }
});

test("changed consent requires the server text to be reloaded and explicitly accepted", { skip: !enabled }, async () => {
  const seen: { body: Record<string, unknown>; key: string | undefined }[] = [];
  const config = { ...configuration };
  const page = await fixture(config, async (route) => {
    seen.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (seen.length === 1) {
      config.consentVersion = "synthetic-ui-v2";
      config.consentText = "Updated synthetic consent fixture; not publication policy.";
      await route.fulfill({ status: 400, json: { error: { code: "validation_error", details: { fields: { consentVersion: "unknown consent version" } } } } });
    } else await route.fulfill({ status: 201, json: { requestId: "updated-consent-receipt", status: "received" } });
  });
  try {
    await fill(page);
    await page.getByRole("button", { name: "Запросить демонстрацию", exact: true }).click();
    await expect(page.getByRole("button", { name: "Повторить отправку", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Обновить текст согласия", exact: true }).click();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(page.getByText(config.consentText, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Комментарий", { exact: true })).toHaveValue("Original input");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Запросить демонстрацию", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("updated-consent-receipt");
    assert.equal(seen[1].body.consentVersion, "synthetic-ui-v2");
    assert.notEqual(seen[0].key, seen[1].key);
  } finally { await page.close(); }
});

test("double submit sends once; failed manual retry retains values and key; changed body gets a new key", { skip: !enabled }, async () => {
  const seen: { body: Record<string, unknown>; key: string | undefined }[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const page = await fixture(configuration, async (route) => {
    seen.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (seen.length === 1) { await hold; await route.fulfill({ status: 503, headers: { "x-request-id": "synthetic-unavailable" }, json: { error: { code: "unavailable" } } }); }
    else if (seen.length === 2) await route.fulfill({ status: 429, headers: { "retry-after": "60", "x-request-id": "synthetic-rate" }, json: { error: { code: "rate_limited" } } });
    else await route.fulfill({ status: 201, json: { requestId: "synthetic-receipt", status: "received" } });
  });
  try {
    await fill(page);
    await page.locator("form").evaluate((form) => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await expect(page.getByRole("button", { name: "Отправляем…", exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole("alert")).toContainText("synthetic-unavailable");
    assert.equal(seen.length, 1);
    await expect(page.getByLabel("Комментарий", { exact: true })).toHaveValue("Original input");
    await expect(page.getByLabel("Имя", { exact: true })).toHaveValue(" Synthetic Person ");
    await page.getByRole("button", { name: "Повторить отправку", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("60");
    await expect(page.getByRole("alert")).toContainText("synthetic-rate");
    assert.equal(seen[1].key, seen[0].key);
    assert.deepEqual(seen[1].body, seen[0].body);
    assert.equal(seen[0].body.consentVersion, configuration.consentVersion);
    await page.getByLabel("Комментарий", { exact: true }).fill("Changed input");
    await page.getByRole("button", { name: "Повторить отправку", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Заявка получена. Номер: synthetic-receipt");
    assert.notEqual(seen[2].key, seen[0].key);
    assert.equal(seen.length, 3);
  } finally { release(); await page.close(); }
});

test("server field validation and malformed success keep input without false receipt", { skip: !enabled }, async () => {
  let calls = 0;
  const page = await fixture(configuration, async (route) => {
    calls++;
    if (calls === 1) await route.fulfill({ status: 400, json: { error: { code: "validation_error", details: { fields: { email: "invalid email" } } } } });
    else await route.fulfill({ status: 201, json: { status: "ok" } });
  });
  try {
    await fill(page);
    await page.getByRole("button", { name: "Запросить демонстрацию", exact: true }).click();
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("synthetic@example.test");
    await page.getByRole("button", { name: "Повторить отправку", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Не удалось подтвердить получение заявки");
    await expect(page.getByText("Заявка получена", { exact: false })).toHaveCount(0);
    await expect(page.getByLabel("Комментарий", { exact: true })).toHaveValue("Original input");
  } finally { await page.close(); }
});
