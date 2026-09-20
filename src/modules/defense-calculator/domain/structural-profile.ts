// Structural profile of the live map (item 8). Pure — no JSX, no fetch.
// Replaces money-first comparison with structural metrics; cost is one optional field.

import {
  calculateLayerSummaries,
  calculateProjectTotalCost,
  calculateProjectTotalObjects,
  calculateProjectTotalUnits,
} from "@/shared/lib/defense-project";
import type { DefenseProject } from "@/shared/types/defense-project";

export type StructuralEchelonProfile = {
  layerId: string;
  layerCode: string;
  layerName: string;
  objectCount: number;
  unitCount: number;
  categoryCount: number;
  conflictCount: number;
  coveredObjectCount: number;
};

export type StructuralProfile = {
  objectCount: number;
  unitCount: number;
  echelonCount: number;
  categoryCount: number;
  conflictCount: number;
  coveredObjectCount: number;
  totalMln: number | null; // cost is optional as a metric — no longer the headline
  byEchelon: StructuralEchelonProfile[];
};

export function buildStructuralProfile(project: DefenseProject): StructuralProfile {
  const assetsById = new Map(project.assetLibrary.map((asset) => [asset.id, asset]));
  const summaries = calculateLayerSummaries(project);

  const categories = new Set<string>();
  let coveredObjectCount = 0;
  for (const object of project.placedObjects) {
    const asset = assetsById.get(object.assetId);
    if (!asset) continue;
    categories.add(asset.category);
    if (asset.coverageType !== "none") coveredObjectCount += 1;
  }

  const objectsByLayer = new Map<string, typeof project.placedObjects>();
  for (const object of project.placedObjects) {
    const list = objectsByLayer.get(object.layerId) ?? [];
    list.push(object);
    objectsByLayer.set(object.layerId, list);
  }

  const byEchelon: StructuralEchelonProfile[] = summaries
    .filter((summary) => summary.objectCount > 0)
    .map((summary) => {
      const objects = objectsByLayer.get(summary.layerId) ?? [];
      const layerCategories = new Set<string>();
      let layerCoveredObjects = 0;
      for (const object of objects) {
        const asset = assetsById.get(object.assetId);
        if (!asset) continue;
        layerCategories.add(asset.category);
        if (asset.coverageType !== "none") layerCoveredObjects += 1;
      }
      return {
        layerId: summary.layerId,
        layerCode: summary.layerCode,
        layerName: summary.layerName,
        objectCount: objects.length,
        unitCount: objects.reduce((acc, object) => acc + object.quantity, 0),
        categoryCount: layerCategories.size,
        conflictCount: summary.conflictCount,
        coveredObjectCount: layerCoveredObjects,
      };
    });

  return {
    objectCount: calculateProjectTotalObjects(project),
    unitCount: calculateProjectTotalUnits(project),
    echelonCount: byEchelon.length,
    categoryCount: categories.size,
    conflictCount: summaries.reduce((acc, summary) => acc + summary.conflictCount, 0),
    coveredObjectCount,
    totalMln: calculateProjectTotalCost(project),
    byEchelon,
  };
}
