// Run with: playwright-cli run-code --filename=test/playwright/map-notice.cli.js
/* eslint-disable @typescript-eslint/no-unused-vars -- Invoked by playwright-cli. */
async function checkMapNotice(page) {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 972 } });
  try {
    const testPage = await context.newPage();
    const errors = [];
    testPage.on("pageerror", error => errors.push(error.message));
    await context.addInitScript(() => localStorage.setItem("fortis-map-view", JSON.stringify({ currentBaseMapSourceId: "openfreemap-bright" })));
    await context.route(/https:\/\/.*(openfreemap|openstreetmap|cartocdn|arcgisonline)/, route => route.abort());
    await testPage.goto("http://localhost:3000/prototype?view=gis");
    const notice = testPage.getByRole("alert", { name: "Уведомление о карте" });
    await notice.waitFor({ state: "visible", timeout: 30000 });
    const details = notice.locator("#map-notice-details");
    const collapse = testPage.getByRole("button", { name: "Свернуть уведомление о карте", exact: true });
    await collapse.click();
    if (await details.isVisible()) throw Error("Details remain visible after collapse");
    await testPage.getByRole("button", { name: "Развернуть уведомление о карте", exact: true }).click();
    if (!await details.isVisible()) throw Error("Details did not expand");
    await notice.getByRole("button", { name: "Повторить загрузку онлайн-карты", exact: true }).click();
    await notice.getByRole("button", { name: "Повторить загрузку онлайн-карты", exact: true }).waitFor({ state: "visible", timeout: 30000 });
    if (!await details.isVisible()) throw Error("Retry did not expand the notice");
    await testPage.getByRole("button", { name: "Закрыть уведомление о карте", exact: true }).click();
    await notice.waitFor({ state: "hidden" });
    if (!await testPage.getByRole("button", { name: "Выбрать источник карты", exact: true }).evaluate(el => el === document.activeElement)) throw Error("Focus lost on close");
    await testPage.getByRole("button", { name: "Приблизить карту", exact: true }).click();
    if (await notice.isVisible()) throw Error("Dismissed notice reopened on map interaction");
    await testPage.getByRole("button", { name: "Выбрать источник карты", exact: true }).click();
    await testPage.getByRole("button", { name: /Локальная карта · 2 района/ }).click();
    await notice.waitFor({ state: "visible" });
    for (const width of [375, 768, 1440]) {
      await testPage.setViewportSize({ width, height: 972 });
      await collapse.click();
      await testPage.getByRole("button", { name: "Развернуть уведомление о карте", exact: true }).click();
      const bounds = await notice.boundingBox();
      if (!bounds || bounds.x < 0 || bounds.x + bounds.width > width) throw Error("Notice overflows at " + width);
    }
    await testPage.screenshot({ path: "output/playwright/map-notice.png" });
    if (errors.length) throw Error(errors.join("\n"));
    console.log("PASS: collapse/expand, close and focus, retry after failure, source change, mobile widths");
  } finally { await context.close(); }
}
