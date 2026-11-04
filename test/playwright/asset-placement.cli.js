// Run with: playwright-cli run-code --filename=test/playwright/asset-placement.cli.js
/* eslint-disable @typescript-eslint/no-unused-vars -- Invoked by playwright-cli. */
async function checkAssetPlacement(page) {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 972 } });
  try {
    await context.addInitScript(() => localStorage.setItem("fortis-map-view", JSON.stringify({ currentBaseMapSourceId: "internal-basemap" })));
    const p = await context.newPage();
    const errors = [], writes = [];
    p.on("pageerror", e => errors.push(e.message));
    await context.route("**/api/**", route => {
      if (!["GET", "HEAD"].includes(route.request().method())) { writes.push(route.request().method()); return route.abort(); }
      return route.continue();
    });
    await p.goto("http://localhost:3000/prototype?view=gis");
    const card = p.locator('[data-testid^="defense-tool-card-"]').first();
    await card.waitFor();
    await card.click();
    await p.getByRole("heading", { name: "Создание эшелона", exact: true }).waitFor();
    if (await card.getAttribute("aria-pressed") !== "true") throw Error("Mouse click cleared asset selection");
    await p.getByRole("button", {name: "Создать", exact: true}).click();
    await p.getByRole("heading", { name: "Создание эшелона", exact: true }).waitFor({state:"hidden"});
    await p.getByRole("button", {name:"К объекту",exact:true}).click();
    await p.getByLabel("Масштаб 1:100",{exact:true}).waitFor();
    // Wait for the camera transition, then target distinct points away from the object marker.
    await p.waitForTimeout(800);
    const board = p.locator("section").filter({has:p.locator("[data-map-zoom]")});
    const box = await board.boundingBox();
    const x = box.x + box.width / 2 + 90, y = box.y + box.height / 2 + 70;
    const markers = p.locator('[data-testid^="map-object-marker-"]');
    const count = async n => {
      try { await p.waitForFunction(n => document.querySelectorAll('[data-testid^="map-object-marker-"]').length === n, n, {timeout:10000}); }
      catch { throw Error(`Expected ${n} markers, got ${await markers.count()}. ${await p.getByLabel("Выбрать объект защиты").locator("..").innerText()}`); }
    };
    await p.mouse.click(x,y);
    await count(1);
    // A normal click must also deselect and reselect reliably.
    await card.click();
    if (await card.getAttribute("aria-pressed") !== "false") throw Error("Cannot deselect asset");
    await card.focus(); await p.keyboard.press("Enter");
    if (await card.getAttribute("aria-pressed") !== "true") throw Error("Keyboard selection failed");
    // Real native drag, not a synthetic drop: the marker must match the release pixel.
    const source = await card.boundingBox();
    await p.mouse.move(source.x+30,source.y+40); await p.mouse.down();
    await p.mouse.move(source.x+50,source.y+40,{steps:5});
    await p.mouse.move(x+75,y+25,{steps:20}); await p.mouse.up();
    await count(2);
    const last = await markers.last().boundingBox();
    if (Math.abs(last.x+last.width/2-(x+75))>3 || Math.abs(last.y+last.height/2-(y+25))>3) throw Error("Drop snapped away from release coordinate");
    // Pointer-only drag models touch/stylus fallback without a native HTML drag event.
    const source2 = await card.boundingBox();
    await card.dispatchEvent("pointerdown",{pointerId:7,pointerType:"touch",button:0,clientX:source2.x+20,clientY:source2.y+20});
    await p.evaluate(({x,y}) => window.dispatchEvent(new PointerEvent("pointermove",{pointerId:7,pointerType:"touch",clientX:x,clientY:y})),{x:x+140,y:y+50});
    await board.dispatchEvent("pointerup",{pointerId:7,pointerType:"touch",button:0,clientX:x+140,clientY:y+50});
    await count(3);
    // Cancelled gestures must not place or leave the pointer-drag ghost behind.
    await card.dispatchEvent("pointerdown",{pointerId:8,pointerType:"touch",button:0,clientX:source2.x+20,clientY:source2.y+20});
    await p.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel",{pointerId:8})));
    await board.dispatchEvent("pointerup",{pointerId:8,clientX:x+200,clientY:y+50});
    if (await markers.count() !== 3) throw Error("Cancelled drag placed an asset");
    if (writes.length || errors.length) throw Error(JSON.stringify({writes,errors}));
    await p.screenshot({path:"output/playwright/asset-placement.png"});
    return {status:"PASS",checks:"first echelon, click/keyboard, native drop coordinate, pointer drag and cancel",placed:3};
  } finally { await context.close(); }
}
