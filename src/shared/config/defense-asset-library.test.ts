import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { defenseAssetLibrary } from "./defense-asset-library";
import { createDefaultDefenseProject, exportDefenseProjectJson, importDefenseProjectJson } from "@/shared/lib/defense-project";
import { buildPublicAssetSeedPayloads } from "@/modules/drone-defense/infra/seed-backend-asset-library";
import { normalizeDefenseAssetPayload } from "@/modules/drone-defense/infra/asset-library-api";

assert.deepEqual(defenseAssetLibrary.map(asset => asset.name), [
  "ЗУ-23М1", "Анклав", "ЗПК-ЯкБ", "ТПУ-12,7 мм", "Бекас", "ЗУ-23М-1М на базе УРАЛ 4320",
]);
assert.equal(new Set(defenseAssetLibrary.map(asset => asset.id)).size, 6);
for (const asset of defenseAssetLibrary) {
  assert.equal(asset.pricePerUnitMln, null);
  assert.equal(asset.unitPriceMinor, null);
  assert.equal(asset.provenance?.quality, "estimated");
  assert.equal(asset.provenance?.sourceDate, null, "The undated PDF must not acquire an invented publication date");
  assert.match(asset.provenance!.sourceLabel, /Презентация ЗПК АО ССТ\.pdf.*с\./);
  assert.ok(existsSync(`public${asset.iconUrl}`));
  assert.equal(asset.coverageType, "none", "A supplier specification is not a computed coverage zone");
  assert.equal(asset.coverageRadius, undefined);
  assert.equal(asset.score, undefined);
}
const imported = importDefenseProjectJson(exportDefenseProjectJson(createDefaultDefenseProject()));
assert.deepEqual(imported.assetLibrary, defenseAssetLibrary);
const payloads = buildPublicAssetSeedPayloads();
assert.equal(payloads.length, 6);
payloads.forEach((payload, i) => {
  const restored = normalizeDefenseAssetPayload({ ...payload, id: defenseAssetLibrary[i].id });
  assert.equal(restored.provenance?.quality, "estimated", "Source-based cards must not be relabelled demo");
  assert.equal(restored.description, defenseAssetLibrary[i].description);
  assert.equal(restored.unitPriceMinor, null);
});
console.log("SST library: six sourced cards, unknown prices, images and import/seed roundtrip passed");
