import { buildDraftCostProjection, CostProjectionInputError, formatMinorRub, getAssetUnitPriceMinor } from "@/shared/lib/cost-projection";
import { preserveDemoAssetSources } from "@/shared/lib/data-provenance";
import { defenseAssetLibrary } from "@/shared/config/defense-asset-library";
import { defaultDefenseProjectLayers, defaultProtectedObject } from "@/shared/config/default-defense-layers";
import {
  getPolygonCoordinates,
  getPolygonArea,
  isPointInPolygon,
  isPolygonClosed,
  isValidCoordinate,
  isValidPolygon,
} from "@/shared/lib/defense-layer-geometry";
import type {
  Coordinates,
  DefenseAssetCategory,
  DefenseAssetLibraryItem,
  DefenseProject,
  EditableDefenseLayer,
  DeleteLayerResult,
  LayerCost,
  LayerSummary,
  PlacedDefenseObject,
  PlacementValidationResult,
  ProjectCalculatorConfiguration,
} from "@/shared/types/defense-project";
import type {
  MogEquipmentItem,
  MogWeaponId,
  MogWeaponItem,
  PlacedDefenseCompoundProfile,
} from "@/shared/types/defense-configuration";
import type { SelectedConfiguration } from "@/shared/types/defense-configuration";

const PROJECT_SCHEMA_VERSION = 1;

const defaultMogEquipment: MogEquipmentItem[] = [
  { id: "binoculars", label: "Бинокль", quantity: "2" },
  { id: "nightVision", label: "Прибор ночного видения", quantity: "1" },
  { id: "vehicle", label: "Автомобиль", quantity: "1" },
  { id: "searchlight", label: "Прожектор", quantity: "1" },
  { id: "droneDetectors", label: "Детекторы дронов", quantity: "1" },
];

const defaultMogWeapons: MogWeaponItem[] = [
  { id: "firearms", label: "Огнестрел", quantity: "2", rangeM: 8000 },
  { id: "antiDroneRifles", label: "Антидроновые ружья", quantity: "1", rangeM: 2000 },
  { id: "interceptorDrones", label: "Дроны-перехватчики", quantity: "0", rangeM: 5000 },
];

const DEFAULT_MOG_COVERAGE_SECTOR_WIDTH_DEG = 90;

function mergeProfileRows<T extends { id: string }>(defaults: T[], rows: T[] | undefined): T[] {
  const rowsById = new Map((rows ?? []).map((row) => [row.id, row]));
  return defaults.map((row) => ({ ...row, ...rowsById.get(row.id) }));
}

function isMogWeaponId(value: string | undefined): value is MogWeaponId {
  return defaultMogWeapons.some((weapon) => weapon.id === value);
}

export function getVisibleMogCoverageWeaponIds(
  profile: Pick<PlacedDefenseCompoundProfile, "coverageWeaponId" | "visibleCoverageWeaponIds">,
): MogWeaponId[] {
  if (Array.isArray(profile.visibleCoverageWeaponIds)) {
    return profile.visibleCoverageWeaponIds.filter(isMogWeaponId);
  }
  return isMogWeaponId(profile.coverageWeaponId) ? [profile.coverageWeaponId] : [];
}

function normalizeMogCoverageAzimuth(value: number | undefined, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return 0;
  if (numeric > 359) return 359;
  return Math.trunc(numeric);
}

function normalizeMogCoverageSectorWidth(value: number | undefined, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 1) return 1;
  if (numeric > 360) return 360;
  return Math.trunc(numeric);
}

export function getMogWeaponCoverageSettings(
  profile: Pick<PlacedDefenseCompoundProfile, "azimuth" | "sectorWidthDeg"> & {
    weapons?: Array<Pick<MogWeaponItem, "id" | "coverageAzimuth" | "coverageSectorWidthDeg">>;
  },
  weaponId: MogWeaponId,
): { azimuth: number; sectorWidthDeg: number } {
  const fallbackAzimuth = normalizeMogCoverageAzimuth(profile.azimuth, 0);
  const fallbackSectorWidthDeg = normalizeMogCoverageSectorWidth(
    profile.sectorWidthDeg,
    DEFAULT_MOG_COVERAGE_SECTOR_WIDTH_DEG,
  );
  const weapon = profile.weapons?.find((item) => item.id === weaponId);
  return {
    azimuth: normalizeMogCoverageAzimuth(weapon?.coverageAzimuth, fallbackAzimuth),
    sectorWidthDeg: normalizeMogCoverageSectorWidth(
      weapon?.coverageSectorWidthDeg,
      fallbackSectorWidthDeg,
    ),
  };
}

export type LayerRadii = {
  innerRadiusM: number;
  widthM: number;
  outerRadiusM: number;
};

export type LayerGeometryValidationResult = {
  isValid: boolean;
  level: "success" | "warning" | "error";
  message?: string;
  fieldErrors?: Partial<Record<"name" | "code" | "innerRadiusM" | "widthM" | "geometry", string>>;
  conflicts?: Array<{
    layerId: string;
    layerCode: string;
    layerName: string;
    innerRadiusM: number;
    outerRadiusM: number;
  }>;
};

export type LayerInsertOption =
  | {
      kind: "outside";
      label: string;
      minInnerRadiusM: number;
      maxOuterRadiusM: null;
      availableWidthM: number;
    }
  | {
      kind: "between";
      label: string;
      beforeLayerId: string;
      afterLayerId: string;
      minInnerRadiusM: number;
      maxOuterRadiusM: number;
      availableWidthM: number;
    }
  | {
      kind: "inside";
      label: string;
      minInnerRadiusM: number;
      maxOuterRadiusM: number;
      availableWidthM: number;
    };

export type PlacedObjectConflictFlags = Pick<
  PlacedDefenseObject,
  "hasGeometryConflict" | "hasCoverageConflict" | "hasTerrainConflict"
>;

export type AssetCatalogItem = {
  assetId: string;
  title: string;
  subtitle: string;
  category: DefenseAssetCategory;
  categoryLabel: string;
  roles: DefenseAssetLibraryItem["roles"];
  pricePerUnitMln: number | null;
  priceLabel: string;
  rangeLabel: string;
  coverageType: DefenseAssetLibraryItem["coverageType"];
  coverageTypeLabel: string;
  coverageLabel: string;
  score: number;
  priority: DefenseAssetLibraryItem["priority"];
  imageUrl: string;
  protectionType?: string;
  isRecommendedForActiveLayer: boolean;
  compatibilityStatus: "recommended" | "compatible" | "warning" | "incompatible";
  compatibilityLabel: string;
  canPlaceInActiveLayer: boolean;
  placedCount: number;
  maxQuantity: number;
  placementType: DefenseAssetLibraryItem["placementType"];
  tags: string[];
  compoundProfile?: DefenseAssetLibraryItem["compoundProfile"];
};

function nowIso() {
  return new Date().toISOString();
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}


function isLayerVisible(layer: EditableDefenseLayer) {
  return layer.isVisible !== false;
}

function normalizeMeters(value: number | undefined, fallback: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? Number(value) : fallback));
}

const fallbackAssetImageByCategory: Record<DefenseAssetCategory, string> = {
  "early-warning": "/drone-defense/echelons/l1/regional-mchs-center.png",
  detection: "/drone-defense/echelons/l2/radar-station.png",
  classification: "/drone-defense/echelons/l2/target-classification-software.png",
  jamming: "/drone-defense/echelons/placeholders/l4.svg",
  spoofing: "/drone-defense/echelons/placeholders/l4.svg",
  kinetic: "/drone-defense/echelons/placeholders/l6.svg",
  interceptor: "/drone-defense/echelons/placeholders/l5.svg",
  "passive-protection": "/drone-defense/echelons/placeholders/l8.svg",
  "engineering-protection": "/drone-defense/echelons/placeholders/l9.svg",
  infrastructure: "/drone-defense/echelons/placeholders/l9.svg",
  software: "/drone-defense/echelons/l2/target-classification-software.png",
  "command-center": "/drone-defense/echelons/l1/regional-operations-hq-fsb-curator.png",
  "external-service": "/drone-defense/echelons/l1/osint-monitoring-workstation.png",
};

function assetSubtitle(asset: DefenseAssetLibraryItem) {
  const roles = asset.roles.join(", ");
  const price = assetPriceLabel(asset);
  return `${asset.shortName ?? asset.category} · ${roles} · ${price}`;
}

const categoryLabels: Record<DefenseAssetCategory, string> = {
  "early-warning": "Раннее предупреждение",
  detection: "Обнаружение",
  classification: "Классификация",
  jamming: "Подавление",
  spoofing: "Спуфинг",
  kinetic: "Поражение",
  interceptor: "Перехват",
  "passive-protection": "Пассивная защита",
  "engineering-protection": "Инженерная защита",
  infrastructure: "Инфраструктура",
  software: "ПО/аналитика",
  "command-center": "Командный центр",
  "external-service": "Внешний сервис",
};

const coverageTypeLabels: Record<DefenseAssetLibraryItem["coverageType"], string> = {
  circle: "Круговое покрытие",
  sector: "Секторное покрытие",
  line: "Линейное покрытие",
  polygon: "Зональное покрытие",
  none: "Без покрытия на карте",
};

const compoundCoverageTypeLabel = "Дальность/сектор";

function formatAssetDistance(meters: number | undefined) {
  if (meters === undefined) return null;
  if (meters >= 1000) return `${(meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`;
  return `${meters.toLocaleString("ru-RU")} м`;
}

function assetRangeLabel(asset: DefenseAssetLibraryItem) {
  const min = formatAssetDistance(asset.minEffectiveDistance);
  const max = formatAssetDistance(asset.maxEffectiveDistance ?? asset.coverageRadius);
  if (min && max) return `${min}-${max}`;
  if (max) return `до ${max}`;
  if (asset.placementType === "non-physical") return "точка на карте";
  return "зона задаётся на карте";
}

export function assetPriceLabel(asset: DefenseAssetLibraryItem) {
  try {
    const minor = getAssetUnitPriceMinor(asset);
    return minor === null ? "Цена не указана" : `${formatMinorRub(minor)}/${asset.unitLabel}`;
  } catch (error) {
    if (error instanceof CostProjectionInputError) return "Некорректная цена";
    throw error;
  }
}

function assetCoverageLabel(asset: DefenseAssetLibraryItem) {
  if (asset.compoundProfile?.kind === "compound-post" && asset.compoundProfile.sectorOrRange) {
    return `${compoundCoverageTypeLabel}: ${asset.compoundProfile.sectorOrRange}`;
  }
  const radius = formatAssetDistance(asset.coverageRadius);
  const typeLabel = coverageTypeLabels[asset.coverageType];
  if (radius && asset.coverageAngle) return `${typeLabel}: ${radius}, ${asset.coverageAngle}°`;
  if (radius) return `${typeLabel}: радиус ${radius}`;
  if (asset.placementType === "zone-object") return `${typeLabel}: зона`;
  if (asset.placementType === "non-physical") return typeLabel;
  return `${typeLabel}: точка`;
}

function assetCoverageTypeLabel(asset: DefenseAssetLibraryItem) {
  if (asset.compoundProfile?.kind === "compound-post") return compoundCoverageTypeLabel;
  return coverageTypeLabels[asset.coverageType];
}

function assetCompatibility(
  asset: DefenseAssetLibraryItem,
  activeLayerCode: string | undefined,
): Pick<AssetCatalogItem, "compatibilityStatus" | "compatibilityLabel" | "canPlaceInActiveLayer" | "isRecommendedForActiveLayer"> {
  const isRecommendedForActiveLayer = Boolean(activeLayerCode && asset.recommendedLayerCodes?.includes(activeLayerCode));

  return {
    compatibilityStatus: isRecommendedForActiveLayer ? "recommended" : "compatible",
    compatibilityLabel: "",
    canPlaceInActiveLayer: true,
    isRecommendedForActiveLayer,
  };
}

export function getAssetCatalogItems(
  project: DefenseProject,
  activeLayerCode: string | undefined,
  placedObjects: PlacedDefenseObject[] = project.placedObjects,
): AssetCatalogItem[] {
  return project.assetLibrary.map((asset) => {
    const placedCount = placedObjects
      .filter((object) => object.assetId === asset.id)
      .reduce((acc, object) => acc + object.quantity, 0);
    const compatibility = assetCompatibility(asset, activeLayerCode);
    return {
      assetId: asset.id,
      title: asset.name,
      protectionType: asset.protectionType,
      subtitle: assetSubtitle(asset),
      category: asset.category,
      categoryLabel: categoryLabels[asset.category],
      roles: asset.roles,
      pricePerUnitMln: asset.pricePerUnitMln,
      priceLabel: assetPriceLabel(asset),
      rangeLabel: assetRangeLabel(asset),
      coverageType: asset.coverageType,
      coverageTypeLabel: assetCoverageTypeLabel(asset),
      coverageLabel: assetCoverageLabel(asset),
      score: asset.score ?? 0,
      priority: asset.priority,
      imageUrl: asset.iconUrl ?? fallbackAssetImageByCategory[asset.category],
      ...compatibility,
      placedCount,
      maxQuantity: 0,
      placementType: asset.placementType,
      compoundProfile: asset.compoundProfile,
      tags: asset.tags ?? [],
    };
  });
}

export function getLayerRadii(layer: EditableDefenseLayer): LayerRadii {
  if (layer.geometry.type === "ring") {
    return {
      innerRadiusM: layer.geometry.minRadiusM,
      outerRadiusM: layer.geometry.maxRadiusM,
      widthM: Math.max(0, layer.geometry.maxRadiusM - layer.geometry.minRadiusM),
    };
  }
  if (layer.geometry.type === "circle") {
    const outerRadiusM = layer.geometry.outerRadiusM ?? layer.geometry.radiusM ?? 0;
    const innerRadiusM = layer.geometry.innerRadiusM ?? 0;
    return {
      innerRadiusM,
      outerRadiusM,
      widthM: layer.geometry.widthM ?? Math.max(0, outerRadiusM - innerRadiusM),
    };
  }
  return {
    innerRadiusM: layer.distanceFromObjectMin ?? 0,
    outerRadiusM: layer.distanceFromObjectMax ?? 0,
    widthM: Math.max(0, (layer.distanceFromObjectMax ?? 0) - (layer.distanceFromObjectMin ?? 0)),
  };
}

function layerRadii(layer: EditableDefenseLayer) {
  return getLayerRadii(layer);
}

function layersOverlap(first: LayerRadii, second: LayerRadii) {
  return first.innerRadiusM < second.outerRadiusM && first.outerRadiusM > second.innerRadiusM;
}

export function validateLayerDraft(
  project: DefenseProject,
  draft: { name: string; code: string; innerRadiusM: number; widthM: number; geometry?: EditableDefenseLayer["geometry"] },
  ignoredLayerId?: string,
): LayerGeometryValidationResult {
  const fieldErrors: Partial<Record<"name" | "code" | "innerRadiusM" | "widthM" | "geometry", string>> = {};
  const name = draft.name.trim();
  const code = draft.code.trim();

  if (!name) {
    fieldErrors.name = "Введите название эшелона.";
  }
  if (!code) {
    fieldErrors.code = "Введите код эшелона.";
  } else {
    const duplicate = project.layers.find(
      (layer) => layer.id !== ignoredLayerId && layer.code.trim().toLowerCase() === code.toLowerCase(),
    );
    if (duplicate) {
      fieldErrors.code = `Код ${code} уже используется. Код должен быть уникальным.`;
    }
  }
  const isPolygonDraft = draft.geometry?.type === "polygon";
  if (!isPolygonDraft) {
    if (!Number.isFinite(draft.innerRadiusM) || draft.innerRadiusM < 0) {
      fieldErrors.innerRadiusM = "Внутренний радиус должен быть больше или равен 0.";
    }
    if (!Number.isFinite(draft.widthM) || draft.widthM <= 0) {
      fieldErrors.widthM = "Ширина эшелона должна быть больше 0.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      isValid: false,
      level: "error",
      message:
        fieldErrors.name ??
        fieldErrors.code ??
        fieldErrors.innerRadiusM ??
        fieldErrors.widthM,
      fieldErrors,
    };
  }

  const candidateLayer = createRingLayer(project, {
    id: ignoredLayerId,
    name,
    code,
    innerRadiusM: draft.innerRadiusM,
    widthM: draft.widthM,
    geometry: draft.geometry,
    isActive: true,
  });
  const geometryValidation = validateLayerGeometry(project, candidateLayer, ignoredLayerId);
  if (!geometryValidation.isValid) {
    return {
      ...geometryValidation,
      fieldErrors: {
        ...(geometryValidation.fieldErrors ?? {}),
        geometry: geometryValidation.message ?? "Проверьте диапазон эшелона.",
      },
    };
  }

  return {
    isValid: true,
    level: "success",
    fieldErrors: {},
  };
}

export function validateLayerGeometry(
  project: DefenseProject,
  draftLayer: EditableDefenseLayer,
  ignoredLayerId?: string,
): LayerGeometryValidationResult {
  if (draftLayer.geometry.type === "polygon" || draftLayer.geometry.type === "freeform") {
    const points = getPolygonCoordinates(draftLayer.geometry);
    if (points.length < 3) {
      return {
        isValid: false,
        level: "error",
        message: "Контур эшелона должен содержать минимум 3 точки.",
      };
    }
    if (points.some((point) => !isValidCoordinate(point))) {
      return {
        isValid: false,
        level: "error",
        message: "Координаты контура отсутствуют или некорректны.",
      };
    }
    if (draftLayer.geometry.type === "polygon" && !isPolygonClosed(draftLayer.geometry)) {
      return {
        isValid: false,
        level: "error",
        message: "Замкните контур перед сохранением эшелона.",
      };
    }
    if (!isValidPolygon(points)) {
      return {
        isValid: false,
        level: "error",
        message: getPolygonArea(points) <= 0
          ? "Площадь контура должна быть больше 0."
          : "Контур эшелона не должен самопересекаться.",
      };
    }

    return { isValid: true, level: "success" };
  }

  const radii = getLayerRadii(draftLayer);
  if (radii.innerRadiusM < 0) {
    return {
      isValid: false,
      level: "error",
      message: "Внутренний радиус должен быть больше или равен 0.",
    };
  }
  if (radii.widthM <= 0 || radii.outerRadiusM <= radii.innerRadiusM) {
    return {
      isValid: false,
      level: "error",
      message: "Ширина эшелона должна быть больше 0.",
    };
  }

  const conflicts = project.layers
    .filter((layer) => layer.id !== ignoredLayerId && layer.id !== draftLayer.id)
    .map((layer) => ({ layer, radii: getLayerRadii(layer) }))
    .filter((item) => layersOverlap(radii, item.radii))
    .map((item) => ({
      layerId: item.layer.id,
      layerCode: item.layer.code,
      layerName: item.layer.name,
      innerRadiusM: item.radii.innerRadiusM,
      outerRadiusM: item.radii.outerRadiusM,
    }));

  if (conflicts.length > 0) {
    return {
      isValid: false,
      level: "error",
      message: `Диапазон пересекается с эшелоном ${conflicts.map((item) => item.layerCode).join(", ")}.`,
      conflicts,
    };
  }

  return { isValid: true, level: "success" };
}

export function findLayerInsertOptions(project: DefenseProject): LayerInsertOption[] {
  const ordered = [...project.layers]
    .map((layer) => ({ layer, radii: getLayerRadii(layer) }))
    .sort((a, b) => b.radii.outerRadiusM - a.radii.outerRadiusM);

  if (ordered.length === 0) {
    return [
      {
        kind: "outside",
        label: "Снаружи",
        minInnerRadiusM: 0,
        maxOuterRadiusM: null,
        availableWidthM: Number.POSITIVE_INFINITY,
      },
    ];
  }

  const outermost = ordered[0];
  const innermost = ordered.reduce((current, item) =>
    item.radii.innerRadiusM < current.radii.innerRadiusM ? item : current,
  );
  const options: LayerInsertOption[] = [
    {
      kind: "outside",
      label: `Снаружи ${outermost.layer.code}`,
      minInnerRadiusM: outermost.radii.outerRadiusM,
      maxOuterRadiusM: null,
      availableWidthM: Number.POSITIVE_INFINITY,
    },
  ];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const before = ordered[index];
    const after = ordered[index + 1];
    const minInnerRadiusM = after.radii.outerRadiusM;
    const maxOuterRadiusM = before.radii.innerRadiusM;
    options.push({
      kind: "between",
      label: `Между ${before.layer.code} и ${after.layer.code}`,
      beforeLayerId: before.layer.id,
      afterLayerId: after.layer.id,
      minInnerRadiusM,
      maxOuterRadiusM,
      availableWidthM: Math.max(0, maxOuterRadiusM - minInnerRadiusM),
    });
  }

  options.push({
    kind: "inside",
    label: `Внутри ${innermost.layer.code}`,
    minInnerRadiusM: 0,
    maxOuterRadiusM: innermost.radii.innerRadiusM,
    availableWidthM: Math.max(0, innermost.radii.innerRadiusM),
  });

  return options;
}

function distanceMeters(a: Coordinates, b: Coordinates): number {
  const earthRadiusM = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(haversine));
}

export function createDefaultDefenseProject(): DefenseProject {
  const activeLayerId = defaultDefenseProjectLayers.find((layer) => layer.isActive)?.id ?? defaultDefenseProjectLayers[0]?.id;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: "current",
    projectName: "Моя конфигурация",
    baseObject: defaultProtectedObject,
    layers: defaultDefenseProjectLayers.map((layer) => ({ ...layer, geometry: { ...layer.geometry } })),
    assetLibrary: defenseAssetLibrary,
    placedObjects: [],
    activeLayerId,
    mode: "view",
    source: "custom",
    updatedAt: nowIso(),
  };
}

export function createWorkspaceDefenseProject(): DefenseProject {
  const project = createDefaultDefenseProject();
  return { ...project, assetLibrary: [], layers: [], activeLayerId: undefined,
    baseObject: { ...project.baseObject, id: "local-draft", name: "Новый объект защиты" } };
}

export function recenterProject(project: DefenseProject, center: Coordinates): DefenseProject {
  const recenteredLayers = project.layers.map((layer) => {
    if (layer.geometry.type === "ring" || layer.geometry.type === "circle") {
      return {
        ...layer,
        geometry: {
          ...layer.geometry,
          center,
        },
      };
    }
    return layer;
  });

  return withUpdatedAt({
    ...project,
    baseObject: {
      ...project.baseObject,
      center,
    },
    layers: recenteredLayers,
  });
}

export function setProjectBaseObject(project: DefenseProject, baseObject: DefenseProject["baseObject"]): DefenseProject {
  const recenteredProject = recenterProject(project, baseObject.center);
  return withUpdatedAt({
    ...recenteredProject,
    baseObject: {
      ...baseObject,
    },
  });
}

export function updateLayerGeometryFromRadii(
  layer: EditableDefenseLayer,
  radii: { innerRadiusM?: number; widthM?: number; center?: Coordinates },
): EditableDefenseLayer {
  const current = layerRadii(layer);
  const innerRadiusM = normalizeMeters(radii.innerRadiusM, current.innerRadiusM);
  const widthM = Math.max(1, normalizeMeters(radii.widthM, current.widthM || 1000));
  const maxRadiusM = innerRadiusM + widthM;
  const center = radii.center ?? (layer.geometry.type === "ring" || layer.geometry.type === "circle" ? layer.geometry.center : undefined);

  return {
    ...layer,
    distanceFromObjectMin: innerRadiusM,
    distanceFromObjectMax: maxRadiusM,
    geometryType: "ring",
    geometry: {
      type: "ring",
      center: center ?? { lat: 0, lng: 0 },
      minRadiusM: innerRadiusM,
      maxRadiusM,
    },
  };
}

export function updateLayerGeometryFromPolygon(
  layer: EditableDefenseLayer,
  coordinates: Coordinates[],
  isClosed: boolean,
): EditableDefenseLayer {
  return {
    ...layer,
    geometryType: "polygon",
    geometry: {
      type: "polygon",
      coordinates: coordinates.map((point) => ({ ...point })),
      isClosed,
    },
  };
}

export function createRingLayer(
  project: DefenseProject,
  data: Partial<EditableDefenseLayer> & { innerRadiusM?: number; widthM?: number } = {},
): EditableDefenseLayer {
  const order = data.order ?? project.layers.length + 1;
  const innerRadiusM = normalizeMeters(data.innerRadiusM ?? data.distanceFromObjectMin, 1000 * order);
  const widthM = Math.max(1, normalizeMeters(data.widthM, 5000));
  const layer: EditableDefenseLayer = {
    id: data.id ?? uniqueId("layer"),
    name: data.name ?? "Новый эшелон",
    code: data.code ?? `L${order}`,
    description: data.description,
    order,
    distanceFromObjectMin: innerRadiusM,
    distanceFromObjectMax: innerRadiusM + widthM,
    geometryType: "ring",
    geometry: {
      type: "ring",
      center: project.baseObject.center,
      minRadiusM: innerRadiusM,
      maxRadiusM: innerRadiusM + widthM,
    },
    color: data.color ?? "#2563eb",
    opacity: data.opacity ?? 0.16,
    isActive: data.isActive ?? false,
    isVisible: data.isVisible ?? true,
    isLocked: data.isLocked ?? false,
  };

  if (data.geometry?.type === "ring") return { ...layer, geometry: data.geometry, geometryType: "ring" };
  if (data.geometry?.type === "polygon") {
    return {
      ...layer,
      distanceFromObjectMin: data.distanceFromObjectMin,
      distanceFromObjectMax: data.distanceFromObjectMax,
      geometry: data.geometry,
      geometryType: "polygon",
    };
  }
  return layer;
}

export function isPointInsideLayerGeometry(layer: EditableDefenseLayer, coordinates: Coordinates): boolean {
  const geometry = layer.geometry;
  if (geometry.type === "circle") {
    return distanceMeters(geometry.center, coordinates) <= (geometry.outerRadiusM ?? geometry.radiusM ?? 0);
  }
  if (geometry.type === "ring") {
    const distance = distanceMeters(geometry.center, coordinates);
    return distance >= geometry.minRadiusM && distance <= geometry.maxRadiusM;
  }
  if (geometry.type === "polygon" || geometry.type === "freeform") {
    const points = getPolygonCoordinates(geometry);
    return points.length >= 3 ? isPointInPolygon(coordinates, points) : false;
  }
  return false;
}

export function validateObjectPlacement(
  project: DefenseProject,
  assetId: string | undefined,
  layerId: string | undefined,
  coordinates: Coordinates,
): PlacementValidationResult {
  void coordinates;
  if (!layerId) return { isValid: false, level: "error", message: "Выберите эшелон" };
  if (!assetId) return { isValid: false, level: "error", message: "Выберите средство защиты" };

  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) return { isValid: false, level: "error", message: "Эшелон не найден" };
  const asset = project.assetLibrary.find((item) => item.id === assetId);
  if (!asset) return { isValid: false, level: "error", message: "Средство защиты не найдено" };

  if (layer.geometry.type === "polygon" && !isPointInsideLayerGeometry(layer, coordinates)) {
    return {
      isValid: false,
      level: "error",
      message: "Нельзя разместить средство вне выбранного эшелона. Выберите точку внутри контура или измените границы эшелона.",
    };
  }

  return { isValid: true, level: "success" };
}

export function createPlacedObject(
  project: DefenseProject,
  assetId: string,
  layerId: string,
  coordinates: Coordinates,
  patch: Partial<PlacedDefenseObject> = {},
): PlacedDefenseObject {
  const asset = project.assetLibrary.find((item) => item.id === assetId);
  const timestamp = nowIso();
  const compoundProfile = patch.compoundProfile ?? buildPlacedDefenseCompoundProfile(asset);
  return {
    id: patch.id ?? uniqueId("placed"),
    assetId,
    layerId,
    name: patch.name ?? asset?.name,
    coordinates,
    rotation: patch.rotation,
    scale: patch.scale,
    quantity: Math.max(1, Math.floor(patch.quantity ?? 1)),
    status: patch.status ?? "planned",
    isVisibleOnMap: patch.isVisibleOnMap ?? true,
    customPricePerUnitMln: patch.customPricePerUnitMln,
    customCoverageRadius: patch.customCoverageRadius,
    customCoverageAngle: patch.customCoverageAngle,
    compoundProfile,
    hasGeometryConflict: false,
    hasCoverageConflict: false,
    hasTerrainConflict: false,
    notes: patch.notes,
    createdAt: patch.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function withUpdatedAt(project: DefenseProject): DefenseProject {
  return { ...project, updatedAt: nowIso() };
}

export function placeObjectInProject(
  project: DefenseProject,
  assetId: string,
  layerId: string,
  coordinates: Coordinates,
  patch: Partial<PlacedDefenseObject> = {},
): DefenseProject {
  const validation = validateObjectPlacement(project, assetId, layerId, coordinates);
  if (!validation.isValid) return project;
  const object = createPlacedObject(project, assetId, layerId, coordinates, patch);
  return withUpdatedAt(syncPlacedObjectConflictFlags({
    ...project,
    placedObjects: [...project.placedObjects, object],
    selectedObjectId: object.id,
    selectedAssetId: assetId,
    activeLayerId: layerId,
    mode: "view",
    source: project.source === "preset" ? "custom" : project.source,
  }));
}

export function movePlacedObjectInProject(project: DefenseProject, objectId: string, coordinates: Coordinates): DefenseProject {
  const object = project.placedObjects.find((item) => item.id === objectId);
  if (!object) return project;
  const validation = validateObjectPlacement(project, object.assetId, object.layerId, coordinates);
  if (!validation.isValid) return project;
  return withUpdatedAt(syncPlacedObjectConflictFlags({
    ...project,
    placedObjects: project.placedObjects.map((item) =>
      item.id === objectId ? { ...item, coordinates, updatedAt: nowIso() } : item,
    ),
  }));
}

export function transferPlacedObjectToLayerInProject(
  project: DefenseProject,
  objectId: string,
  layerId: string,
): { project: DefenseProject; validation: PlacementValidationResult } {
  const object = project.placedObjects.find((item) => item.id === objectId);
  if (!object) {
    return {
      project,
      validation: { isValid: false, level: "error", message: "Объект не найден" },
    };
  }

  const validation = validateObjectPlacement(project, object.assetId, layerId, object.coordinates);
  if (!validation.isValid) return { project, validation };

  return {
    project: withUpdatedAt(syncPlacedObjectConflictFlags({
      ...project,
      activeLayerId: layerId,
      selectedObjectId: objectId,
      placedObjects: project.placedObjects.map((item) =>
        item.id === objectId ? { ...item, layerId, updatedAt: nowIso() } : item,
      ),
      source: project.source === "preset" ? "custom" : project.source,
    })),
    validation,
  };
}

export function updatePlacedObjectInProject(
  project: DefenseProject,
  objectId: string,
  patch: Partial<PlacedDefenseObject>,
): DefenseProject {
  const normalizedPatch = patch.compoundProfile
    ? { ...patch, compoundProfile: normalizePlacedDefenseCompoundProfile(patch.compoundProfile) }
    : patch;
  return withUpdatedAt(syncPlacedObjectConflictFlags({
    ...project,
    placedObjects: project.placedObjects.map((item) =>
      item.id === objectId
        ? {
            ...item,
            ...normalizedPatch,
            quantity: normalizedPatch.quantity === undefined ? item.quantity : Math.max(1, Math.floor(normalizedPatch.quantity)),
            updatedAt: nowIso(),
          }
        : item,
    ),
  }));
}

export function deletePlacedObjectInProject(project: DefenseProject, objectId: string): DefenseProject {
  return withUpdatedAt(syncPlacedObjectConflictFlags({
    ...project,
    placedObjects: project.placedObjects.filter((item) => item.id !== objectId),
    selectedObjectId: project.selectedObjectId === objectId ? undefined : project.selectedObjectId,
  }));
}

export function deleteLayerFromProject(project: DefenseProject, layerId: string): DeleteLayerResult {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) {
    return { ok: false, reason: "layer-not-found", message: "Эшелон не найден." };
  }
  if (project.layers.length <= 1) {
    return { ok: false, reason: "last-layer", message: "Нельзя удалить последний эшелон проекта." };
  }
  if (layer.isLocked) {
    return { ok: false, reason: "layer-locked", message: "Эшелон заблокирован. Сначала снимите блокировку." };
  }
  if (project.placedObjects.some((object) => object.layerId === layerId)) {
    return {
      ok: false,
      reason: "layer-has-objects",
      message: "В эшелоне есть размещённые объекты. Сначала удалите или перенесите их.",
    };
  }
  const layers = project.layers
    .filter((item) => item.id !== layerId)
    .map((item, index) => ({ ...item, order: index + 1, isActive: project.activeLayerId === layerId ? index === 0 : item.id === project.activeLayerId }));
  return {
    ok: true,
    project: withUpdatedAt({
      ...project,
      layers,
      activeLayerId: project.activeLayerId === layerId ? layers[0]?.id : project.activeLayerId,
    }),
  };
}

export function canEditLayer(project: DefenseProject, layerId: string): boolean {
  const layer = project.layers.find((item) => item.id === layerId);
  return Boolean(layer && !layer.isLocked);
}

export function updateLayerOrder(project: DefenseProject, layerId: string, direction: "up" | "down"): DefenseProject {
  const ordered = [...project.layers].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((layer) => layer.id === layerId);
  if (index < 0) return project;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return project;
  const next = [...ordered];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return withUpdatedAt({
    ...project,
    layers: next.map((layer, nextIndex) => ({ ...layer, order: nextIndex + 1 })),
  });
}

export function duplicatePlacedObjectInProject(project: DefenseProject, objectId: string): DefenseProject {
  const object = project.placedObjects.find((item) => item.id === objectId);
  if (!object) return project;
  const copy = {
    ...object,
    id: uniqueId("placed"),
    name: object.name ? `${object.name} копия` : undefined,
    coordinates: { ...object.coordinates, lat: object.coordinates.lat + 0.001, lng: object.coordinates.lng + 0.001 },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return withUpdatedAt(syncPlacedObjectConflictFlags({
    ...project,
    placedObjects: [...project.placedObjects, copy],
    selectedObjectId: copy.id,
  }));
}

function layerForAsset(project: DefenseProject, assetId: string): EditableDefenseLayer {
  const asset = project.assetLibrary.find((item) => item.id === assetId);
  return (
    project.layers.find((layer) => layer.code === asset?.recommendedLayerCodes?.[0]) ??
    project.layers.find((layer) => layer.code === asset?.compatibleLayerCodes?.[0]) ??
    project.layers[0]
  );
}

function coordinatesForDraftObject(project: DefenseProject, layer: EditableDefenseLayer, index: number): Coordinates {
  const center =
    layer.geometry.type === "ring" || layer.geometry.type === "circle"
      ? layer.geometry.center
      : project.baseObject.center;
  const radii = getLayerRadii(layer);
  const radiusM =
    radii.outerRadiusM > radii.innerRadiusM
      ? radii.innerRadiusM + Math.max(250, (radii.outerRadiusM - radii.innerRadiusM) / 2)
      : Math.max(500, radii.outerRadiusM || 1000);
  const angleRad = ((index * 47 + 23) * Math.PI) / 180;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = Math.max(1, metersPerDegreeLat * Math.cos((center.lat * Math.PI) / 180));
  return {
    lat: center.lat + (Math.sin(angleRad) * radiusM) / metersPerDegreeLat,
    lng: center.lng + (Math.cos(angleRad) * radiusM) / metersPerDegreeLng,
  };
}

function assetIdForProjectLine(project: DefenseProject, assetId: string) {
  return project.assetLibrary.find((asset) => asset.id === assetId || asset.calculatorAssetId === assetId)?.id ?? assetId;
}

export function getPlacedObjectConflictFlags(
  project: DefenseProject,
  object: PlacedDefenseObject,
): PlacedObjectConflictFlags {
  void project;
  void object;
  return {
    hasGeometryConflict: false,
    hasCoverageConflict: false,
    hasTerrainConflict: false,
  };
}

export function syncPlacedObjectConflictFlags(project: DefenseProject): DefenseProject {
  return {
    ...project,
    placedObjects: project.placedObjects.map((object) => ({
      ...object,
      ...getPlacedObjectConflictFlags(project, object),
    })),
  };
}

export function applyAssetQuantityDraftsToProject(
  project: DefenseProject,
  lines: Array<{ assetId: string; quantity: number }>,
): DefenseProject {
  const draftBase = { ...project, placedObjects: [] };
  const placedObjects: PlacedDefenseObject[] = [];
  lines.forEach((line, index) => {
    const normalizedQuantity = Math.max(0, Math.floor(Number.isFinite(line.quantity) ? line.quantity : 0));
    if (normalizedQuantity <= 0) return;
    const projectAssetId = assetIdForProjectLine(draftBase, line.assetId);
    const layer = layerForAsset(draftBase, projectAssetId);
    placedObjects.push(
      createPlacedObject(draftBase, projectAssetId, layer.id, coordinatesForDraftObject(draftBase, layer, index), {
        quantity: normalizedQuantity,
        status: "planned",
      }),
    );
  });

  return withUpdatedAt(syncPlacedObjectConflictFlags({
    ...draftBase,
    placedObjects,
    activeLayerId: placedObjects[0]?.layerId ?? draftBase.activeLayerId,
    selectedAssetId: placedObjects[0]?.assetId ?? draftBase.selectedAssetId,
    selectedObjectId: placedObjects[0]?.id,
    source: draftBase.source === "preset" ? "custom" : draftBase.source,
  }));
}

export function setAssetQuantityInProject(project: DefenseProject, assetId: string, quantity: number): DefenseProject {
  const normalized = Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0));
  const lineByAsset = new Map<string, number>();
  project.placedObjects
    .filter((object) => object.assetId !== assetId)
    .forEach((object) => lineByAsset.set(object.assetId, (lineByAsset.get(object.assetId) ?? 0) + object.quantity));
  if (normalized > 0) lineByAsset.set(assetId, normalized);
  return applyAssetQuantityDraftsToProject(
    project,
    [...lineByAsset.entries()].map(([lineAssetId, lineQuantity]) => ({ assetId: lineAssetId, quantity: lineQuantity })),
  );
}

// ponytail: numeric millions are compatibility display only; exact results use CostProjection.
function minorToMln(value: string | null): number | null {
  return value === null ? null : Number(value) / 100_000_000;
}

export function priceForPlacedObject(project: DefenseProject, object: PlacedDefenseObject): number | null {
  return minorToMln(buildDraftCostProjection({ ...project, placedObjects: [object] }).lines[0].unitPriceMinor);
}

export function calculateProjectTotalCost(project: DefenseProject): number | null {
  return minorToMln(buildDraftCostProjection(project).totalMinor);
}

export function calculateProjectTotalUnits(project: DefenseProject): number {
  return project.placedObjects.reduce((acc, object) => acc + object.quantity, 0);
}

export function calculateProjectTotalObjects(project: DefenseProject): number {
  return project.placedObjects.length;
}

export function calculateCostByLayer(project: DefenseProject, projection: Pick<import("@/shared/types/finance").CostProjection, "byLayer"> | null = buildDraftCostProjection(project)): LayerCost[] {
  const groups = new Map(projection?.byLayer.map(group => [group.id,group]) ?? []);
  return project.layers.map(layer => {
    const group = groups.get(layer.id);
    const totalMinor = projection === null ? null : group ? group.totalMinor : "0";
    return { layerId: layer.id, layerName: layer.name, totalMinor, knownSubtotalMinor: group?.knownSubtotalMinor ?? "0", totalMln: minorToMln(totalMinor) };
  });
}

export function calculateLayerConflicts(project: DefenseProject, layerId?: string): PlacedDefenseObject[] {
  void project;
  void layerId;
  return [];
}

export function calculateLayerSummaries(project: DefenseProject, projection?: Pick<import("@/shared/types/finance").CostProjection, "byLayer"> | null): LayerSummary[] {
  const costs = new Map(calculateCostByLayer(project, projection).map(group => [group.layerId,group]));
  return [...project.layers]
    .sort((a, b) => a.order - b.order)
    .map((layer) => {
      const objects = project.placedObjects.filter((object) => object.layerId === layer.id);
      const radii = layerRadii(layer);
      const conflictCount = calculateLayerConflicts(project, layer.id).length;
      return {
        layerCode: layer.code,
        objectCount: objects.length,
        unitCount: objects.reduce((acc, object) => acc + object.quantity, 0),
        ...costs.get(layer.id)!,
        coverageScore: Math.round(
          objects.reduce((acc, object) => {
            const asset = project.assetLibrary.find((item) => item.id === object.assetId);
            return acc + (asset?.score ?? 0) * object.quantity;
          }, 0),
        ),
        conflictCount,
        innerRadiusM: radii.innerRadiusM,
        widthM: radii.widthM,
        outerRadiusM: radii.outerRadiusM,
      };
    });
}

function assetToCalculatorAssetId(asset: DefenseAssetLibraryItem): string {
  return asset.calculatorAssetId ?? asset.id;
}

function normalizeProjectAssetLibrary(assetLibrary: DefenseProject["assetLibrary"]): DefenseProject["assetLibrary"] {
  if (!Array.isArray(assetLibrary)) throw new Error("Invalid project asset library");
  return assetLibrary.map((asset) => ({
    ...asset,
    ...preserveDemoAssetSources(asset),
    coverageType: asset.coverageType ?? "none",
    currency: asset.currency ?? "RUB",
    roles: asset.roles ?? [],
    pricePerUnitMln: asset.pricePerUnitMln ?? null,
    unitLabel: asset.unitLabel ?? "шт",
    deploymentType: asset.deploymentType ?? "external",
    placementType: asset.placementType ?? "non-physical",
  }));
}

function normalizeLayerGeometry(
  layer: EditableDefenseLayer,
  baseCenter: Coordinates,
): EditableDefenseLayer {
  const legacyLayer = layer as EditableDefenseLayer & {
    center?: Coordinates;
    innerRadiusM?: number;
    outerRadiusM?: number;
    widthM?: number;
  };
  const geometry = legacyLayer.geometry;
  if (!geometry) {
    const innerRadiusM = normalizeMeters(
      legacyLayer.innerRadiusM ?? layer.distanceFromObjectMin,
      layer.distanceFromObjectMin ?? 0,
    );
    const outerRadiusM = normalizeMeters(
      legacyLayer.outerRadiusM ?? layer.distanceFromObjectMax,
      layer.distanceFromObjectMax ?? innerRadiusM + normalizeMeters(legacyLayer.widthM, 1000),
    );
    return {
      ...layer,
      distanceFromObjectMin: innerRadiusM,
      distanceFromObjectMax: Math.max(innerRadiusM, outerRadiusM),
      geometryType: "ring",
      geometry: {
        type: "ring",
        center: legacyLayer.center ?? baseCenter,
        minRadiusM: innerRadiusM,
        maxRadiusM: Math.max(innerRadiusM, outerRadiusM),
      },
    };
  }

  if (geometry.type === "polygon") {
    return {
      ...layer,
      geometryType: "polygon",
      geometry: {
        ...geometry,
        type: "polygon",
        coordinates: getPolygonCoordinates(geometry),
        isClosed: geometry.isClosed === true,
      },
    };
  }

  if (geometry.type === "circle") {
    const innerRadiusM = geometry.innerRadiusM ?? 0;
    const outerRadiusM = geometry.outerRadiusM ?? geometry.radiusM ?? layer.distanceFromObjectMax ?? 0;
    return {
      ...layer,
      distanceFromObjectMin: innerRadiusM,
      distanceFromObjectMax: outerRadiusM,
      geometryType: "circle",
      geometry: {
        ...geometry,
        type: "circle",
        center: geometry.center ?? baseCenter,
        innerRadiusM,
        outerRadiusM,
        widthM: geometry.widthM ?? Math.max(0, outerRadiusM - innerRadiusM),
      },
    };
  }

  if (geometry.type === "ring") {
    return {
      ...layer,
      distanceFromObjectMin: geometry.minRadiusM,
      distanceFromObjectMax: geometry.maxRadiusM,
      geometryType: "ring",
      geometry: {
        ...geometry,
        center: geometry.center ?? baseCenter,
      },
    };
  }

  return layer;
}

export function buildPlacedDefenseCompoundProfile(
  asset: DefenseProject["assetLibrary"][number] | undefined,
): PlacedDefenseCompoundProfile | undefined {
  if (!asset?.compoundProfile) return undefined;
  return normalizePlacedDefenseCompoundProfile({
    ...asset.compoundProfile,
    azimuth: 0,
  });
}

export function normalizePlacedDefenseCompoundProfile(
  profile: PlacedDefenseCompoundProfile,
): PlacedDefenseCompoundProfile {
  const normalizedAzimuth = normalizeMogCoverageAzimuth(profile.azimuth, 0);
  const normalizedSectorWidthDeg = normalizeMogCoverageSectorWidth(
    profile.sectorWidthDeg,
    DEFAULT_MOG_COVERAGE_SECTOR_WIDTH_DEG,
  );
  const weapons = mergeProfileRows(defaultMogWeapons, profile.weapons).map((weapon) => ({
    ...weapon,
    coverageAzimuth: normalizeMogCoverageAzimuth(weapon.coverageAzimuth, normalizedAzimuth),
    coverageSectorWidthDeg: normalizeMogCoverageSectorWidth(
      weapon.coverageSectorWidthDeg,
      normalizedSectorWidthDeg,
    ),
  }));
  const firstAvailableCoverageWeaponId =
    weapons.find((weapon) => Number(weapon.quantity) > 0)?.id ?? defaultMogWeapons[0].id;
  const visibleCoverageWeaponIds = getVisibleMogCoverageWeaponIds(profile).filter((weaponId) => {
    const weapon = weapons.find((item) => item.id === weaponId);
    return Boolean(weapon && Number(weapon.quantity) > 0);
  });
  const normalizedLegacyCoverageWeaponId = isMogWeaponId(profile.coverageWeaponId)
    ? profile.coverageWeaponId
    : firstAvailableCoverageWeaponId;
  return {
    ...profile,
    azimuth: normalizedAzimuth,
    equipment: mergeProfileRows(defaultMogEquipment, profile.equipment),
    weapons,
    coverageWeaponId:
      visibleCoverageWeaponIds.at(-1) ?? normalizedLegacyCoverageWeaponId ?? firstAvailableCoverageWeaponId,
    visibleCoverageWeaponIds,
    sectorWidthDeg: normalizedSectorWidthDeg,
  };
}

export function projectToCalculatorConfiguration(project: DefenseProject): ProjectCalculatorConfiguration {
  const quantities = new Map<string, number>();
  project.placedObjects.forEach((object) => {
    const asset = project.assetLibrary.find((item) => item.id === object.assetId);
    if (!asset) return;
    const assetId = assetToCalculatorAssetId(asset);
    quantities.set(assetId, (quantities.get(assetId) ?? 0) + object.quantity);
  });
  return {
    id: project.projectId,
    name: project.projectName,
    lines: [...quantities.entries()].map(([assetId, quantity]) => ({ assetId, quantity })),
  };
}

export function legacySelectedConfigurationToProject(configuration: SelectedConfiguration): DefenseProject {
  let project = createDefaultDefenseProject();
  project = {
    ...project,
    projectName: configuration.name,
    source: "legacy-migration",
    basePresetId: configuration.basePresetId,
  };
  return applyAssetQuantityDraftsToProject(
    project,
    Object.entries(configuration.selectedItems).map(([assetId, quantity]) => ({ assetId, quantity })),
  );
}

export function exportDefenseProjectJson(project: DefenseProject): string {
  return JSON.stringify({ ...project, updatedAt: nowIso() }, null, 2);
}

function normalizePersistedConflictSnapshots(object: PlacedDefenseObject): PlacedDefenseObject {
  // Conflict flags are diagnostic snapshots supplied by persistence/backend data.
  // Hydration preserves explicit true values and only backfills missing legacy fields.
  return {
    ...object,
    hasGeometryConflict: object.hasGeometryConflict === true,
    hasCoverageConflict: object.hasCoverageConflict === true,
    hasTerrainConflict: object.hasTerrainConflict === true,
  };
}

export function importDefenseProjectJson(raw: string): DefenseProject {
  const parsed = JSON.parse(raw) as DefenseProject;
  if (parsed.schemaVersion !== PROJECT_SCHEMA_VERSION || !Array.isArray(parsed.layers) || !Array.isArray(parsed.placedObjects)) {
    throw new Error("Invalid defense project JSON");
  }
  return {
    ...parsed,
    assetLibrary: normalizeProjectAssetLibrary(parsed.assetLibrary),
    layers: parsed.layers.map((layer) =>
      normalizeLayerGeometry({ ...layer, isVisible: isLayerVisible(layer) }, parsed.baseObject.center),
    ),
    placedObjects: parsed.placedObjects.map(normalizePersistedConflictSnapshots),
  };
}
