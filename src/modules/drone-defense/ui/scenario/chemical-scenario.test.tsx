import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChemicalSitePlan } from "./chemical-site-plan";
import { chemicalObjects, chemicalSiteVersion } from "../../domain/chemical-site";

test("shared enterprise plan uses the same object IDs, dimensions and selection as the 3D model", () => {
  const selected = chemicalObjects.find(o=>o.id==="Z05-building-01")!;
  const markup = renderToStaticMarkup(createElement(ChemicalSitePlan, { selected:selected.id, onSelect:()=>{} }));
  assert.ok(markup.includes(`data-enterprise-model="${chemicalSiteVersion}"`));
  for(const o of chemicalObjects) {
    assert.equal(markup.includes(`data-object-id="${o.id}"`), !o.assetId, o.id);
  }
  const rect=markup.match(/<rect[^>]*data-object-id="Z05-building-01"[^>]*>/)?.[0];
  assert.ok(rect);
  assert.ok(rect.includes(`width="${selected.width}"`) && rect.includes(`height="${selected.depth}"`));
  assert.ok(rect.includes(`x="${selected.x-selected.width/2}"`) && rect.includes(`y="${-selected.y-selected.depth/2}"`));
  assert.ok(rect.includes('fill="var(--accent)"'));
});
