import type { Coordinates, DefenseProject, DefenseAsset, PlacedDefenseObject } from "@/shared/types/defense-project";
import { getDefenseAssetSymbolId } from "@/shared/config/defense-asset-symbols";
import { buildProtectedObjectPerimeter } from "./echelon-map-model";

// Same local metre approximation as the GIS perimeter and placement helpers.
export function projectLocalPoint(center: Coordinates, point: Coordinates) {
  const longitudeDelta = ((point.lng - center.lng + 540) % 360) - 180;
  return { xM: longitudeDelta * 111_320 * Math.cos(center.lat * Math.PI / 180), yM: (point.lat - center.lat) * 111_320 };
}

// Effective conditional coverage of a placed instance: manual override first (ADR-0009),
// then the catalog value. Assets without any radius (e.g. the SST catalog) stay out of the model.
export function effectivePlacementCoverage(object: PlacedDefenseObject, asset?: DefenseAsset) {
  const catalogRadius = asset && asset.coverageType !== "none" && asset.coverageType !== "polygon" && asset.coverageType !== "line" ? asset.coverageRadius : undefined;
  const coverageRadiusM = object.customCoverageRadius ?? catalogRadius ?? null;
  const catalogAngle = asset?.coverageType === "sector" ? asset.coverageAngle ?? 360 : 360;
  const coverageAngleDeg = object.customCoverageAngle ?? catalogAngle;
  // Only working and planned placements participate; archived/off-maintenance ones do not.
  const participates = (object.status === "active" || object.status === "planned") && coverageRadiusM !== null && coverageRadiusM > 0;
  return { coverageRadiusM, coverageAngleDeg, participates };
}

export function buildProjectScenario(project: DefenseProject) {
  const center = project.baseObject.center;
  const assets = new Map(project.assetLibrary.map(asset => [asset.id, asset]));
  const layers = new Map(project.layers.map(layer => [layer.id, layer]));
  const perimeter = buildProtectedObjectPerimeter({ center: { lon: center.lng, lat: center.lat } }).polygon
    .map(([lng, lat]) => projectLocalPoint(center, { lng, lat }));
  const placements = project.placedObjects.map(object => {
    const asset = assets.get(object.assetId);
    const color = layers.get(object.layerId)?.color;
    const coverage = effectivePlacementCoverage(object, asset);
    return { id: object.id, assetId: object.assetId, assetKey: asset?.legacyItemId ?? asset?.id ?? object.assetId, name: object.name || asset?.name || object.assetId,
      symbolId: getDefenseAssetSymbolId(asset?.legacyItemId ?? asset?.id ?? object.assetId),
      quantity: object.quantity, status: object.status, rotation: object.rotation ?? 0,
      color: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#2563eb",
      ...coverage, ...projectLocalPoint(center, object.coordinates) };
  });
  const defenseUnits = placements.flatMap(placement =>
    placement.participates && placement.coverageRadiusM ? [{ id: placement.id, assetKey: placement.assetKey, xM: placement.xM, yM: placement.yM,
      radiusM: placement.coverageRadiusM, angleDeg: placement.coverageAngleDeg, rotationDeg: placement.rotation, quantity: placement.quantity }] : []);
  const protectionRadiusM = Math.ceil((Math.max(...perimeter.map(point => Math.hypot(point.xM, point.yM))) + 50) / 50) * 50;
  const extentM = Math.max(650, ...placements.map(point => Math.max(Math.abs(point.xM), Math.abs(point.yM))));
  return { projectId: project.projectId, objectId: project.baseObject.id, name: project.baseObject.name,
    center, placements, defenseUnits, perimeter, protectionRadiusM, workingZoom: Math.min(12, 8000 / extentM) };
}
export type ProjectScenario = ReturnType<typeof buildProjectScenario>;
