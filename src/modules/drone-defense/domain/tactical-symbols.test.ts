import assert from "node:assert/strict";
import { defenseAssetLibrary } from "@/shared/config/defense-asset-library";
import { getDefenseAssetSymbolId } from "@/shared/config/defense-asset-symbols";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";
import { buildProjectScenario } from "./project-scenario";
import { placedObjectsToMapPlacements } from "./project-map-adapter";

assert.deepEqual(defenseAssetLibrary.map(asset => getDefenseAssetSymbolId(asset.id)), [
  "aa-gun", "aa-machine-gun", "aa-machine-gun", "aa-machine-gun", "air-surveillance-radar", "aa-self-propelled",
]);
assert.equal(getDefenseAssetSymbolId("unknown-id"), "unknown");
assert.equal(getDefenseAssetSymbolId(), "unknown");
// Backend UUIDs and user-renamed instances retain the original catalog symbol.
const project = createDefaultDefenseProject();
project.assetLibrary = defenseAssetLibrary.map((asset, i) => ({ ...asset, id: `backend-${i}` }));
project.placedObjects = project.assetLibrary.map((asset, i) => ({
  id: `placed-${i}`, name: "Переименованное средство", assetId: asset.id, layerId: "test-layer",
  coordinates: project.baseObject.center, quantity: 1, status: "planned", createdAt: project.updatedAt, updatedAt: project.updatedAt,
}));
const placements = placedObjectsToMapPlacements({project, facilityId: project.baseObject.id, scenarioId: "baseline"});
assert.deepEqual(placements.map(p => getDefenseAssetSymbolId(p.markerAssetId)), defenseAssetLibrary.map(a => getDefenseAssetSymbolId(a.id)));
console.log("PASS: six SST symbols, backend IDs, renamed objects and unknown fallback");

assert.deepEqual(buildProjectScenario(project).placements.map(p => p.symbolId), placements.map(p => getDefenseAssetSymbolId(p.markerAssetId)));
