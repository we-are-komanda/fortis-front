// Run with playwright-cli -s=fortis-desktop run-code --filename=desktop/check-map-fallback.js
async (page) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("http://127.0.0.1:43178/prototype?view=gis");
  await page.evaluate(() => localStorage.setItem("fortis-map-view", JSON.stringify({ currentBaseMapSourceId: "openfreemap-bright" })));
  const localTiles = [];
  const localErrors = [];
  const responses = response => {
    if (response.url().includes("/maps/demo-region/")) {
      if (response.status() !== 200) localErrors.push(response.url());
      if (response.url().includes("/tiles/") && response.status() === 200) localTiles.push(response.url());
    }
  };
  page.on("response", responses);
  await page.route("https://**/*", route => route.abort());
  try {
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "Не удалось загрузить онлайн-карту" }).waitFor({ timeout: 25_000 });
    await page.waitForFunction(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("/maps/demo-region/tiles/")));
    await page.waitForTimeout(1000);
    if (!localTiles.length || localErrors.length) throw new Error(`Local map: ${localTiles.length} tiles; errors: ${localErrors.join(", ")}`);
    const preference = await page.evaluate(() => JSON.parse(localStorage.getItem("fortis-map-view")).currentBaseMapSourceId);
    if (preference !== "openfreemap-bright") throw new Error("Automatic fallback overwrote the online preference");
    await page.screenshot({ path: "output/playwright/desktop-map-offline.png" });
    await page.unroute("https://**/*");
    const onlineResponse = page.waitForResponse(response => response.url().includes("tiles.openfreemap.org/styles/bright") && response.status() === 200);
    await page.getByRole("button", { name: "Повторить загрузку онлайн-карты" }).click();
    await onlineResponse;
    await page.getByRole("alert").filter({ hasText: "Не удалось загрузить онлайн-карту" }).waitFor({ state: "hidden" });
    await page.screenshot({ path: "output/playwright/desktop-map-online.png" });
    console.log(`PASS: ${localTiles.length} local tiles, online preference preserved, online retry succeeded`);
  } finally {
    await page.unroute("https://**/*");
    page.off("response", responses);
  }
}
