/* eslint-disable @typescript-eslint/no-require-imports -- Runnable browser regression check. */
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage({ viewport: {width:1440,height:960} });
  const tiles=[], errors=[];
  page.on("dialog", d=>d.accept());
  page.on("response", r=>{if(r.url().includes("/maps/demo-region/")){if(r.status()!==200) errors.push(r.url());else if(r.url().includes("/tiles/"))tiles.push(r.url());}});
  await page.addInitScript(()=>localStorage.setItem("fortis-map-view",JSON.stringify({currentBaseMapSourceId:"openfreemap-bright"})));
  await page.route("https://**/*", r=>r.abort());
  await page.goto(process.env.MAP_TEST_URL || "http://127.0.0.1:43178/prototype?view=gis");
  await expect(page.getByRole("alert").filter({hasText:"локальн"})).toContainText("Не удалось загрузить онлайн-карту",{timeout:25000});
  await expect.poll(()=>tiles.length,{timeout:20000}).toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  assert.deepEqual(errors,[]);
  await expect(page.getByRole("alert").filter({hasText:"локальн"})).not.toContainText("Не удалось загрузить локальную карту");
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("fortis-map-view")).currentBaseMapSourceId),"openfreemap-bright");
  await page.screenshot({path:process.env.MAP_SCREENSHOT || "output/playwright/desktop-map-offline.png"});
  if (!process.env.MAP_TEST_URL) {
    await page.unroute("https://**/*");
    // A deterministic healthy provider response avoids depending on public CDN speed.
    const style = JSON.parse(fs.readFileSync("public/maps/demo-region/style.json", "utf8"));
    const origin = new URL(page.url()).origin;
    style.sprite = origin + style.sprite;
    style.glyphs = origin + style.glyphs;
    style.sources.openmaptiles.tiles = style.sources.openmaptiles.tiles.map(url=>origin+url);
    await page.route("https://tiles.openfreemap.org/styles/bright", route=>route.fulfill({json:style}));
    const online = page.waitForResponse(r=>r.url().includes("tiles.openfreemap.org/styles/bright") && r.status()===200);
    await page.getByRole("button", {name:"Повторить загрузку онлайн-карты"}).click();
    await online;

    await expect(page.getByRole("alert").filter({hasText:"Не удалось загрузить онлайн-карту"})).toHaveCount(0);
    await page.waitForTimeout(16000);
    await expect(page.getByRole("alert").filter({hasText:"Не удалось загрузить онлайн-карту"})).toHaveCount(0);
  }
  console.log(`PASS: ${tiles.length} local tiles, zero local resource errors`);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
