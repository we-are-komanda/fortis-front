// Run with: playwright-cli run-code --filename=test/playwright/tactical-symbols.cli.js
/* eslint-disable @typescript-eslint/no-unused-vars -- Invoked by playwright-cli. */
async function checkTacticalSymbols(page) {
  const context = await page.context().browser().newContext({viewport:{width:1440,height:972}});
  try {
    await context.addInitScript(() => localStorage.setItem("fortis-map-view", JSON.stringify({currentBaseMapSourceId:"internal-basemap"})));
    const p = await context.newPage(), errors = [], writes = [];
    p.on("pageerror", e => errors.push(e.message));
    await context.route("**/api/**", route => {
      if (!["GET","HEAD"].includes(route.request().method())) {writes.push(route.request().method());return route.abort();}
      return route.continue();
    });
    await p.goto("http://localhost:3000/prototype?view=gis");
    const cards = p.locator('[data-testid^="defense-tool-card-"]');
    await cards.first().click();
    await p.getByRole("button",{name:"Создать",exact:true}).click();
    await p.getByRole("button",{name:"К объекту",exact:true}).click();
    await p.getByLabel("Масштаб 1:100",{exact:true}).waitFor();
    await p.waitForTimeout(800);
    if (await p.getByRole("button",{name:"Закрыть уведомление о карте",exact:true}).isVisible()) await p.getByRole("button",{name:"Закрыть уведомление о карте",exact:true}).click();
    const board = p.locator("section").filter({has:p.locator("[data-map-zoom]")});
    const box = await board.boundingBox();
    const expected = ["aa-self-propelled","air-surveillance-radar","aa-machine-gun","aa-machine-gun","aa-machine-gun","aa-gun"];
    for (let i=0;i<6;i++) {
      const card=cards.nth(i);
      if (await card.getAttribute("aria-pressed")!=="true") await card.click();
      await p.mouse.click(box.x+box.width/2-160+(i%3)*160,box.y+box.height/2-120+Math.floor(i/3)*170);
      await p.waitForFunction(n => document.querySelectorAll('[data-testid^="map-object-marker-"]').length===n,i+1);
      const marker=p.locator('[data-testid^="map-object-marker-"]').nth(i);
      const actual=await marker.locator("svg").getAttribute("data-tactical-symbol");
      if (actual!==expected[i]) throw Error(`Card ${i}: ${actual}, expected ${expected[i]}`);
      if (await marker.locator("svg").evaluate(el => getComputedStyle(el).color) !== "rgb(0, 0, 0)") throw Error("Symbols must be black");
    }
    await p.screenshot({path:"output/playwright/tactical-symbols.png"});
    for (const width of [375,768]) {
      await p.setViewportSize({width,height:972});
      const size=await p.locator('[data-testid^="map-object-marker-"]').first().boundingBox();
      if (!size || size.width<44 || size.height<44) throw Error("Marker target smaller than 44 px");
    }
    if (errors.length || writes.length) throw Error(JSON.stringify({errors,writes}));
    return {status:"PASS",symbols:expected,checks:"six real catalog assets, black strokes, 44px targets, no backend writes"};
  } finally {await context.close();}
}
