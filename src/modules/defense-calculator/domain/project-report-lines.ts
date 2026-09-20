import { buildDraftCostProjection } from "@/shared/lib/cost-projection";
import {
  getMogWeaponCoverageSettings,
  getVisibleMogCoverageWeaponIds,
} from "@/shared/lib/defense-project";
import { getPolygonArea, getPolygonCoordinates } from "@/shared/lib/defense-layer-geometry";
import type { DefenseProject } from "@/shared/types/defense-project";
import type { PlacedDefenseCompoundProfile } from "@/shared/types/defense-configuration";

export type ProjectObjectReportLine = {
  objectId: string;
  layerId: string;
  layerCode: string;
  layerName: string;
  layerGeometryLabel: string;
  layerAreaHa?: number;
  assetId: string;
  assetName: string;
  quantity: number;
  unitPriceMln: number | null;
  lineTotalMln: number | null;
  unitPriceMinor: string | null;
  lineTotalMinor: string | null;
  protectionType: string;
  isCompoundPost: boolean;
  compositionSummary?: string;
  weaponSummary?: string;
  azimuthSectorSummary?: string;
};

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() ?? "—";
}

function buildCompoundCompositionSummary(profile: PlacedDefenseCompoundProfile) {
  const equipment = profile.equipment
    ?.filter((item) => Number(item.quantity) > 0)
    .map((item) => `${item.label}: ${item.quantity}`)
    .join(", ");
  return `Пост: ${normalizeOptionalText(profile.postType)} · Л/с: ${normalizeOptionalText(profile.personnelCount)} · Подотчётность: ${normalizeOptionalText(profile.accountability)} · Оснащение: ${equipment || "—"}`;
}

function buildCompoundWeaponSummary(profile: PlacedDefenseCompoundProfile) {
  const weapons = profile.weapons
    ?.filter((item) => Number(item.quantity) > 0)
    .map((item) => `${item.label}: ${item.quantity}`)
    .join(", ");
  if (weapons) return `Оружие: ${weapons}`;
  return `Оружие: ${normalizeOptionalText(profile.armament)} · Ед.: ${normalizeOptionalText(profile.weaponUnits)}`;
}

function buildCompoundAzimuthSummary(profile: PlacedDefenseCompoundProfile) {
  const azimuth = Number.isFinite(profile.azimuth) ? `${profile.azimuth}°` : "—";
  const visibleCoverageIds = new Set(getVisibleMogCoverageWeaponIds(profile));
  const visibleCoverageWeapons = profile.weapons
    ?.filter((item) => visibleCoverageIds.has(item.id) && Number(item.quantity) > 0)
    .map((item) => {
      const coverageSettings = getMogWeaponCoverageSettings(profile, item.id);
      return `${item.label} (${coverageSettings.azimuth}°/${coverageSettings.sectorWidthDeg}°)`;
    })
    .join(", ");
  const coverageWeaponLabel = visibleCoverageWeapons ? ` · На карте: ${visibleCoverageWeapons}` : "";
  return `Азимут: ${azimuth} · Дальность/сектор: ${normalizeOptionalText(profile.sectorOrRange)}${coverageWeaponLabel}`;
}

function roundAreaHa(areaM2: number) {
  return Math.round((areaM2 / 10_000) * 10) / 10;
}

function getLayerGeometryReportMeta(layer: DefenseProject["layers"][number] | undefined) {
  if (!layer) return { layerGeometryLabel: "—" };
  if (layer.geometry.type === "polygon") {
    const areaHa = roundAreaHa(getPolygonArea(getPolygonCoordinates(layer.geometry)));
    return {
      layerGeometryLabel: "произвольный контур",
      ...(areaHa > 0 ? { layerAreaHa: areaHa } : {}),
    };
  }
  return { layerGeometryLabel: "круг" };
}

export function buildProjectReportObjectLines(project: DefenseProject): ProjectObjectReportLine[] {
  const layersById = new Map(project.layers.map((layer) => [layer.id, layer]));
  const assetsById = new Map(project.assetLibrary.map((asset) => [asset.id, asset]));

  const costs = new Map(buildDraftCostProjection(project).lines.map(line => [line.objectId,line]));
  return project.placedObjects.map((object) => {
    const layer = layersById.get(object.layerId);
    const asset = assetsById.get(object.assetId);
    const cost = costs.get(object.id)!;
    const isCompoundPost = object.compoundProfile?.kind === "compound-post";
    const compoundProfile = object.compoundProfile;
    const geometryMeta = getLayerGeometryReportMeta(layer);

    return {
      objectId: object.id,
      layerId: object.layerId,
      layerCode: layer?.code ?? "—",
      layerName: layer?.name ?? "—",
      ...geometryMeta,
      assetId: object.assetId,
      assetName: object.name ?? asset?.name ?? object.assetId,
      quantity: object.quantity,
      unitPriceMln: cost.unitPriceMinor === null ? null : Number(cost.unitPriceMinor) / 100_000_000,
      lineTotalMln: cost.lineTotalMinor === null ? null : Number(cost.lineTotalMinor) / 100_000_000,
      unitPriceMinor: cost.unitPriceMinor,
      lineTotalMinor: cost.lineTotalMinor,
      protectionType: asset?.protectionType ?? "—",
      isCompoundPost,
      ...(isCompoundPost && compoundProfile
        ? {
            compositionSummary: buildCompoundCompositionSummary(compoundProfile),
            weaponSummary: buildCompoundWeaponSummary(compoundProfile),
            azimuthSectorSummary: buildCompoundAzimuthSummary(compoundProfile),
          }
        : {}),
    };
  });
}
