import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";
import { buildProjectScenario, projectLocalPoint } from "./project-scenario";
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
