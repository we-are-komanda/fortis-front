import type { Coordinates, DefenseProject } from "@/shared/types/defense-project";
import { getDefenseAssetSymbolId } from "@/shared/config/defense-asset-symbols";
import { buildProtectedObjectPerimeter } from "./echelon-map-model";

// Same local metre approximation as the GIS perimeter and placement helpers.
export function projectLocalPoint(center: Coordinates, point: Coordinates) {
  const longitudeDelta = ((point.lng - center.lng + 540) % 360) - 180;
  return { xM: longitudeDelta * 111_320 * Math.cos(center.lat * Math.PI / 180), yM: (point.lat - center.lat) * 111_320 };
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
    return { id: object.id, assetId: object.assetId, name: object.name || asset?.name || object.assetId,
      symbolId: getDefenseAssetSymbolId(asset?.legacyItemId ?? asset?.id ?? object.assetId),
      quantity: object.quantity, status: object.status, rotation: object.rotation ?? 0,
      color: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#2563eb",
      ...projectLocalPoint(center, object.coordinates) };
  });
  const protectionRadiusM = Math.ceil((Math.max(...perimeter.map(point => Math.hypot(point.xM, point.yM))) + 50) / 50) * 50;
  const extentM = Math.max(650, ...placements.map(point => Math.max(Math.abs(point.xM), Math.abs(point.yM))));
  return { projectId: project.projectId, objectId: project.baseObject.id, name: project.baseObject.name,
    center, perimeter, placements, protectionRadiusM, workingZoom: Math.min(12, 8000 / extentM) };
}
export type ProjectScenario = ReturnType<typeof buildProjectScenario>;
