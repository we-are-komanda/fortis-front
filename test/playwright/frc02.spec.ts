import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, name: "A" | "B") {
 await page.goto("/login");
 await page.getByLabel("Email", { exact: true }).fill(`${name}@example.test`);
 await page.getByLabel("Password", { exact: true }).fill("fixture-password-only");
 await page.getByRole("button", { name: "Sign in", exact: true }).click();
 await expect(page).toHaveURL(/\/workspace\/?$/);
 await expect(page.getByRole("button", { name: `Enterprise ${name}`, exact: true })).toBeVisible();
}

test("H: real login A → project A → logout → B; recovery and UI stay isolated", async ({ page, request }) => {
 const { a } = await (await request.get("http://127.0.0.1:8092/__fixture")).json();
 await login(page, "A");
 await page.getByRole("button", { name: /Config A.*Project A/ }).click();
 await expect(page).toHaveURL(new RegExp(`projectId=${a.projectId}`));
 await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), `fortis-defense-project:user:${a.userId}`)).toContain(a.projectId);
 const report = page.waitForResponse((response) => response.url().includes(`/projects/report?id=${a.projectId}`) && response.status() === 200);
 await page.getByRole("link", { name: "calculator Расчёт", exact: true }).click();
 expect((await report).status()).toBe(200);
 await expect(page.getByRole("button", { name: /PDF-отчёт/ })).toBeVisible();
 await page.getByRole("button", { name: "Выйти", exact: true }).click();
 await expect(page).toHaveURL(/\/login/);
 await login(page, "B");
 await expect(page.getByText("Enterprise A", { exact: true })).toHaveCount(0);
 await expect(page.getByText("Config A", { exact: true })).toHaveCount(0);
 await page.goto("/calculator");
 await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
 await expect(page.getByText("Project A", { exact: true })).toHaveCount(0);
 await expect(page.getByText("Private A", { exact: true })).toHaveCount(0);
 const forbidden = await page.request.get(`/api/defense/projects/${a.projectId}`);
 expect(forbidden.status()).toBe(404);
 await page.screenshot({ path: "output/playwright/frc02/account-B.png", fullPage: true });
});

test("I: same browser cookie loses resource access immediately after fixture revocation", async ({ page, request }) => {
 const { a } = await (await request.get("http://127.0.0.1:8092/__fixture")).json();
 await login(page, "A");
 await page.getByRole("button", { name: /Config A.*Project A/ }).click();
 await expect(page).toHaveURL(new RegExp(`projectId=${a.projectId}`));
 const before = (await page.context().cookies()).find((c) => c.name === "access-token")?.value;
 expect((await page.request.get(`/api/defense/projects/${a.projectId}`)).status()).toBe(200);
 expect((await request.post("http://127.0.0.1:8092/__revoke")).ok()).toBeTruthy();
 const failedSave = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(`/projects/${a.projectId}`));
 await page.getByRole("button", { name: "Сохранить текущий вариант", exact: true }).click();
 expect((await failedSave).status()).toBe(404);
 await expect(page.getByRole("alert").filter({ hasText: /проект больше недоступен/ })).toBeVisible();
 await expect(page.getByRole("button", { name: "Сохранить текущий вариант", exact: true })).toBeDisabled();
 expect((await page.context().cookies()).find((c) => c.name === "access-token")?.value).toBe(before);
 expect((await page.request.get(`/api/defense/projects/${a.projectId}`)).status()).toBe(404);
 await page.screenshot({ path: "output/playwright/frc02/revoked.png", fullPage: true });
});

test("protected workspace stays usable at mobile and desktop widths", async ({ page }) => {
 await login(page, "B");
 for (const width of [375, 414, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enterprise B", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
 }
});
