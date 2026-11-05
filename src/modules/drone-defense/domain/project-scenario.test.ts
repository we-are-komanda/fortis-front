import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";
import { buildProjectScenario, effectivePlacementCoverage, projectLocalPoint } from "./project-scenario";
import { buildMapScaleBar, buildProtectedObjectWorkingViewState } from "./echelon-map-model";
import { defaultMotionConfig, generateRun, protectionRule, summarizeRun } from "./mass-motion";
import type { Library } from "./scenario-playback";
import libraryData from "../infra/data/scenario/library-v1.json";

const library = libraryData as Library;
test("GIS working camera centers the selected object at nominal 1:100", () => {
  for (const lat of [0, 55.75, 75]) {
    const camera = buildProtectedObjectWorkingViewState({ center: {lat, lon: 37.62} } as Parameters<typeof buildProtectedObjectWorkingViewState>[0]);
    assert.equal(camera.longitude, 37.62);
    assert.equal(camera.latitude, lat);
    assert.equal(camera.pitch, 0);
    const metersPerPixel = 40_075_016.686 * Math.cos(lat * Math.PI / 180) / (512 * 2 ** camera.zoom);
    assert.ok(Math.abs(metersPerPixel / (.0254 / 96) - 100) < .00001);
    const bar = buildMapScaleBar({latitude: lat, zoom: camera.zoom});
    assert.ok(Math.abs(bar.distanceM / bar.widthPx - metersPerPixel) < .0001);
  }
});

test("project scene preserves placement IDs, quantities and relative coordinates across all layers without changing the project", () => {
  const project = createDefaultDefenseProject();
  project.baseObject = {id: "site", name: "Выбранный объект", center: {lat: 55, lng: 37}};
  project.placedObjects = [{id: "one", assetId: project.assetLibrary[0].id, layerId: project.layers[0].id, quantity: 3, status: "planned", coordinates: {lat: 55 + 100 / 111320, lng: 37 + 200 / (111320 * Math.cos(55 * Math.PI / 180))}, createdAt: "", updatedAt: ""},
    {id: "two", assetId: "archived-asset", layerId: "hidden-layer", name: "Сохранённое средство", quantity: 2, status: "inactive", isVisibleOnMap: false, coordinates: {lat: 55, lng: 37}, createdAt: "", updatedAt: ""}];
  const before = JSON.stringify(project);
  const scene = buildProjectScenario(project);
  assert.equal(scene.objectId, "site");
  assert.equal(scene.name, "Выбранный объект");
  assert.deepEqual(scene.placements.map(p => [p.id, p.quantity]), [["one", 3], ["two", 2]]);
  assert.ok(Math.abs(scene.placements[0].xM - 200) < .00001);
  assert.ok(Math.abs(scene.placements[0].yM - 100) < .00001);
  assert.equal(scene.placements[1].name, "Сохранённое средство");
  assert.equal(scene.perimeter.length, 4);
  assert.ok(scene.perimeter.every(p => Math.hypot(p.xM, p.yM) < scene.protectionRadiusM));
  assert.equal(JSON.stringify(project), before);
  const changed = buildProjectScenario({...project, placedObjects: []});
  assert.equal(changed.placements.length, 0);
});

test("local coordinates wrap across the antimeridian", () => {
  assert.ok(Math.abs(projectLocalPoint({lat: 0, lng: 179.999}, {lat: 0, lng: -179.999}).xM - 222.64) < .00001);
});

test("project boundary is used by Monte Carlo paths while seeded timing stays reproducible", () => {
  const run = generateRun(defaultMotionConfig, library, 1, 600);
  assert.ok(run.objects.every(p => Math.abs(Math.hypot(p.end.xM, p.end.yM) - 600) < .00001));
  assert.deepEqual(summarizeRun(run), summarizeRun(generateRun(defaultMotionConfig, library, 1, protectionRule.radiusM)));
  assert.throws(() => generateRun(defaultMotionConfig, library, 0, NaN));
  assert.throws(() => generateRun(defaultMotionConfig, library, 0, 10000));
});
test("Monte Carlo consumes placed configuration: local units carry effective conditional coverage", () => {
  const project = createDefaultDefenseProject();
  project.baseObject = {id: "site", name: "Выбранный объект", center: {lat: 55, lng: 37}};
  const layerId = project.layers[0].id;
  project.placedObjects = [
    {id: "u1", assetId: "", layerId, quantity: 2, status: "active", customCoverageRadius: 2500, customCoverageAngle: 90, coordinates: {lat: 55.0001, lng: 37}, createdAt: "", updatedAt: ""},
    {id: "u2", assetId: "", layerId, quantity: 1, status: "maintenance", customCoverageRadius: 2500, coordinates: {lat: 55.0002, lng: 37}, createdAt: "", updatedAt: ""},
    {id: "u3", assetId: "", layerId, quantity: 1, status: "planned", customCoverageRadius: 0, coordinates: {lat: 55.0003, lng: 37}, createdAt: "", updatedAt: ""}];
  const scene = buildProjectScenario(project);
  assert.deepEqual(scene.defenseUnits.map(unit => [unit.id, unit.radiusM, unit.angleDeg, unit.quantity]), [["u1", 2500, 90, 2]]);
  assert.deepEqual(scene.placements.map(placement => placement.participates), [true, false, false]);
  const first = summarizeRun(generateRun(defaultMotionConfig, library, 4, scene.protectionRadiusM, scene.defenseUnits));
  assert.equal(first.neutralized, summarizeRun(generateRun(defaultMotionConfig, library, 4, scene.protectionRadiusM, scene.defenseUnits)).neutralized);
  assert.ok(first.neutralizedRate >= 0 && first.neutralizedRate <= 1);
  assert.equal(summarizeRun(generateRun(defaultMotionConfig, library, 4, scene.protectionRadiusM)).neutralized, 0);
});
test("effective coverage falls back to catalog values, manual overrides win, odd types stay excluded", () => {
  const circle = { coverageType: "circle", coverageRadius: 1500 } as Parameters<typeof effectivePlacementCoverage>[1];
  const placed = { status: "active" } as Parameters<typeof effectivePlacementCoverage>[0];
  assert.deepEqual(effectivePlacementCoverage(placed, circle), { coverageRadiusM: 1500, coverageAngleDeg: 360, participates: true });
  const sector = { coverageType: "sector", coverageRadius: 1500, coverageAngle: 120 } as Parameters<typeof effectivePlacementCoverage>[1];
  assert.deepEqual(effectivePlacementCoverage(placed, sector), { coverageRadiusM: 1500, coverageAngleDeg: 120, participates: true });
  const none = { coverageType: "none" } as Parameters<typeof effectivePlacementCoverage>[1];
  assert.deepEqual(effectivePlacementCoverage(placed, none), { coverageRadiusM: null, coverageAngleDeg: 360, participates: false });
  assert.deepEqual(effectivePlacementCoverage({ status: "active", customCoverageRadius: 800 } as Parameters<typeof effectivePlacementCoverage>[0], none), { coverageRadiusM: 800, coverageAngleDeg: 360, participates: true });
  assert.deepEqual(effectivePlacementCoverage({ status: "inactive", customCoverageRadius: 800 } as Parameters<typeof effectivePlacementCoverage>[0], circle), { coverageRadiusM: 800, coverageAngleDeg: 360, participates: false });
});

test("backend UUIDs and renamed assets preserve the canonical game coefficient key", () => {
  const project = createDefaultDefenseProject();
  const asset = project.assetLibrary[0];
  const originalKey = asset.legacyItemId ?? asset.id;
  asset.legacyItemId = originalKey;
  asset.id = "76e24ede-a0d6-49fc-afae-ea30b4cfb0b3";
  asset.name = "Игровой юнит";
  project.placedObjects = [{ id: "instance", assetId: asset.id, layerId: project.layers[0].id,
    coordinates: project.baseObject.center, status: "active", quantity: 1, customCoverageRadius: 2000, createdAt: "", updatedAt: "" }];
  const scene = buildProjectScenario(project);
  assert.equal(scene.defenseUnits[0].assetKey, originalKey);
  assert.equal(scene.defenseUnits[0].id, "instance");
});
