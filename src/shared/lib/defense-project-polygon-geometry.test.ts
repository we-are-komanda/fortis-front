import { createLegacyDefenseProject as createDefaultDefenseProject } from "../../../test/fixtures/legacy-defense-project";
// Run: npx tsx src/shared/lib/defense-project-polygon-geometry.test.ts

import {
  importDefenseProjectJson,
  placeObjectInProject,
  validateLayerGeometry,
  validateObjectPlacement,
} from "@/shared/lib/defense-project";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const project = createDefaultDefenseProject();
const l2 = project.layers.find((layer) => layer.code === "L2");
assert(l2, "default project must include L2");

const polygonLayer = {
  ...l2,
  id: "polygon-layer",
  code: "LP",
  name: "Произвольный контур",
  geometryType: "polygon" as const,
  geometry: {
    type: "polygon" as const,
    coordinates: [
      { lat: 55.43, lng: 37.09 },
      { lat: 55.43, lng: 37.11 },
      { lat: 55.45, lng: 37.11 },
      { lat: 55.45, lng: 37.09 },
    ],
    isClosed: true,
  },
};
const polygonProject = { ...project, layers: [...project.layers, polygonLayer] };

assert(validateLayerGeometry(project, polygonLayer).isValid, "closed polygon layer must pass geometry validation");
assert(
  validateObjectPlacement(polygonProject, "mobile-radar", polygonLayer.id, { lat: 55.44, lng: 37.1 }).isValid,
  "placement inside polygon layer must be valid",
);
const outsidePolygonValidation = validateObjectPlacement(polygonProject, "mobile-radar", polygonLayer.id, { lat: 55.46, lng: 37.1 });
assert(!outsidePolygonValidation.isValid, "placement outside polygon layer must be rejected");
assert(
  outsidePolygonValidation.message === "Нельзя разместить средство вне выбранного эшелона. Выберите точку внутри контура или измените границы эшелона.",
  "polygon placement error must use the agreed user-facing copy",
);
const rejectedPolygonPlacement = placeObjectInProject(polygonProject, "mobile-radar", polygonLayer.id, { lat: 55.46, lng: 37.1 });
assert(rejectedPolygonPlacement.placedObjects.length === 0, "invalid polygon placement must not append placedObjects");

const openPolygonValidation = validateLayerGeometry(project, {
  ...polygonLayer,
  id: "open-polygon-layer",
  geometry: { ...polygonLayer.geometry, isClosed: false },
});
assert(!openPolygonValidation.isValid && openPolygonValidation.message?.toLowerCase().includes("замк"), "open polygon layer must be rejected");

const legacyLayerWithoutGeometry = {
  ...l2,
  id: "legacy-no-geometry",
  geometry: undefined,
  geometryType: undefined,
} as unknown as typeof l2;
const legacyJson = JSON.stringify({
  ...project,
  layers: [legacyLayerWithoutGeometry],
});
const importedLegacyLayerProject = importDefenseProjectJson(legacyJson);
const importedLegacyLayer = importedLegacyLayerProject.layers[0];
assert(
  importedLegacyLayer.geometry.type === "ring" &&
    importedLegacyLayer.geometry.minRadiusM === l2.distanceFromObjectMin &&
    importedLegacyLayer.geometry.maxRadiusM === l2.distanceFromObjectMax,
  "project JSON import must backfill missing legacy layer geometry from radius fields",
);

console.log("defense-project-polygon-geometry.test.ts: OK");
