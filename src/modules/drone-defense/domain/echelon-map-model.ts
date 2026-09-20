import type { MapViewState } from "@deck.gl/core";
import type {
  Configuration,
  DefenseAsset,
  DefenseCatalogResponse,
  DefenseLayer,
  DefenseLayerId,
  DefenseLayersResponse,
  Facility,
  GeoPoint,
  Placement,
} from "@/shared/types/drone-defense";

export type EchelonZone = {
  layerId: DefenseLayerId;
  shortName: string;
  name: string;
  distanceLabel: string;
  coveragePct: number;
  placedCount: number;
  polygon: Array<Array<[number, number]>>;
  geometryType: "ring" | "polygon";
  fillColor: [number, number, number, number];
  lineColor: [number, number, number, number];
};

export type EchelonMapPlacement = {
  id: string;
  sourcePlacementId: string;
  layerId: DefenseLayerId;
  label: string;
  position: [number, number];
  color: [number, number, number, number];
  isCatalogPlacement: boolean;
  isSelected?: boolean;
  isConflict?: boolean;
  slotId?: string;
  catalogGroupId?: string;
  iconUrl?: string;
  markerCategory?: string;
  qty: number;
};

export type EchelonMapSlot = {
  id: string;
  layerId: DefenseLayerId;
  slotIndex: number;
  label: string;
  position: [number, number];
  status: "empty" | "selected" | "occupied";
  placementId?: string;
  catalogGroupId?: string;
  color: [number, number, number, number];
};

export type LayerFocusViewState = MapViewState;

export type MapScaleBar = {
  distanceM: number;
  label: string;
  widthPx: number;
};

export type ProtectedObjectPerimeter = {
  center: [number, number];
  polygon: Array<[number, number]>;
};

export type EchelonBuildCatalogGroup = {
  id: string;
  layerId: DefenseLayerId;
  name: string;
};

export type SlotBuildProfile = {
  glyph: string;
  title: string;
};

const layerColors: Record<DefenseLayerId, [number, number, number]> = {
  layer_01_external_warning: [37, 99, 235],
  layer_02_detection: [6, 182, 212],
  layer_03_identification: [20, 184, 166],
  layer_04_suppression: [34, 197, 94],
  layer_05_mid_range_kinetic: [132, 204, 22],
  layer_06_last_line_kinetic: [245, 158, 11],
  layer_07_accuracy_disruption: [249, 115, 22],
  layer_08_passive_protection: [239, 68, 68],
  layer_09_hardening: [168, 85, 247],
};

const fallbackLayerColors: Array<[number, number, number]> = [
  [37, 99, 235],
  [6, 182, 212],
  [20, 184, 166],
  [34, 197, 94],
  [132, 204, 22],
  [245, 158, 11],
  [249, 115, 22],
  [239, 68, 68],
  [168, 85, 247],
];

const layerOrderFactor = 37;
const slotCountByLayer: Record<DefenseLayerId, number> = {
  layer_01_external_warning: 5,
  layer_02_detection: 5,
  layer_03_identification: 3,
  layer_04_suppression: 5,
  layer_05_mid_range_kinetic: 4,
  layer_06_last_line_kinetic: 3,
  layer_07_accuracy_disruption: 5,
  layer_08_passive_protection: 3,
  layer_09_hardening: 2,
};

const slotBuildProfiles: Record<DefenseLayerId, SlotBuildProfile> = {
  layer_01_external_warning: { glyph: "RAD", title: "Построить внешний сенсор" },
  layer_02_detection: { glyph: "EYE", title: "Построить узел обнаружения" },
  layer_03_identification: { glyph: "ID", title: "Построить узел идентификации" },
  layer_04_suppression: { glyph: "EW", title: "Построить средство подавления" },
  layer_05_mid_range_kinetic: { glyph: "INT", title: "Построить перехватчик среднего рубежа" },
  layer_06_last_line_kinetic: { glyph: "AA", title: "Построить последний рубеж ПВО" },
  layer_07_accuracy_disruption: { glyph: "CAM", title: "Построить средство срыва точности" },
  layer_08_passive_protection: { glyph: "NET", title: "Построить пассивную защиту" },
  layer_09_hardening: { glyph: "ENG", title: "Построить инженерное усиление" },
};

const earthCircumferenceM = 40_075_016.686;
const webMercatorTileSizePx = 512;
const targetLayerDiameterPx = 640;
const targetProtectedObjectDiameterPx = 640;
const minLayerFocusZoom = 6;
const maxLayerFocusZoom = 18;
const protectedObjectContextMinRadiusM = 4_500;
const protectedObjectContextMaxRadiusM = 6_000;
const placementFocusMinZoom = 12.8;
const placementFocusZoomStep = 2.4;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getSlotBuildProfile(layerId: DefenseLayerId) {
  return slotBuildProfiles[layerId] ?? { glyph: "SZ", title: "Построить средство защиты" };
}

function layerColor(layer: DefenseLayer): [number, number, number] {
  if (layer.color && /^#[0-9a-fA-F]{6}$/.test(layer.color)) {
    return [
      parseInt(layer.color.slice(1, 3), 16),
      parseInt(layer.color.slice(3, 5), 16),
      parseInt(layer.color.slice(5, 7), 16),
    ];
  }
  return layerColors[layer.id] ?? fallbackLayerColors[Math.max(0, layer.order - 1) % fallbackLayerColors.length];
}

export function findNextBuildableCatalogGroupForLayer({
  layerId,
  catalogGroups,
  placements,
}: {
  layerId: DefenseLayerId;
  catalogGroups: EchelonBuildCatalogGroup[];
  placements: Configuration["placements"];
}) {
  const placedCatalogGroupIds = new Set(placements.map((placement) => placement.catalogGroupId).filter(Boolean));
  return catalogGroups.find((group) => group.layerId === layerId && !placedCatalogGroupIds.has(group.id)) ?? null;
}

function projectMeters(center: GeoPoint, eastM: number, northM: number): [number, number] {
  const lat = center.lat + northM / 111_320;
  const lon = center.lon + eastM / (111_320 * Math.cos(center.lat * (Math.PI / 180)));
  return [lon, lat];
}

function circleRing(center: GeoPoint, radiusM: number, segments: number) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return projectMeters(center, Math.sin(angle) * radiusM, Math.cos(angle) * radiusM);
  });
}

export function buildEchelonPolygon(center: GeoPoint, layer: DefenseLayer, segments = 96) {
  if (layer.geometry?.type === "polygon") {
    const ring = layer.geometry.coordinates.map((point) => [point.lng, point.lat] as [number, number]);
    return ring.length >= 3 ? [ring] : [];
  }

  const outerRadius = Math.max(layer.distanceBandM.max, 120);
  const outer = circleRing(center, outerRadius, segments);

  if (layer.distanceBandM.min <= 0) {
    return [outer];
  }

  const inner = circleRing(center, layer.distanceBandM.min, segments).reverse();
  return [outer, inner];
}

export function buildLayerFocusViewState({
  facility,
  layer,
  transition,
}: {
  facility: Facility;
  layer: DefenseLayer;
  transition?: {
    durationMs?: LayerFocusViewState["transitionDuration"];
    easing?: LayerFocusViewState["transitionEasing"];
    interpolator?: LayerFocusViewState["transitionInterpolator"];
    interruption?: LayerFocusViewState["transitionInterruption"];
  };
}): LayerFocusViewState {
  const layerRadiusM = Math.max(layer.distanceBandM.max, 100);
  const layerDiameterM = layerRadiusM * 2;
  const metersPerPixel = layerDiameterM / targetLayerDiameterPx;
  const latitudeScale = Math.max(0.2, Math.cos(facility.center.lat * (Math.PI / 180)));
  const rawZoom = Math.log2((earthCircumferenceM * latitudeScale) / (metersPerPixel * webMercatorTileSizePx));
  const focusState: LayerFocusViewState = {
    longitude: facility.center.lon,
    latitude: facility.center.lat,
    zoom: Number(clamp(rawZoom, minLayerFocusZoom, maxLayerFocusZoom).toFixed(2)),
    pitch: 28,
    bearing: 0,
  };

  if (!transition) {
    return focusState;
  }

  return {
    ...focusState,
    transitionDuration: transition.durationMs ?? 650,
    transitionEasing: transition.easing,
    transitionInterpolator: transition.interpolator,
    transitionInterruption: transition.interruption,
  };
}

function zoomForRadius({ latitude, radiusM, targetDiameterPx }: { latitude: number; radiusM: number; targetDiameterPx: number }) {
  const diameterM = Math.max(radiusM, 100) * 2;
  const metersPerPixel = diameterM / targetDiameterPx;
  const latitudeScale = Math.max(0.2, Math.cos(latitude * (Math.PI / 180)));
  return Math.log2((earthCircumferenceM * latitudeScale) / (metersPerPixel * webMercatorTileSizePx));
}

export function buildProtectedObjectInitialViewState({
  facility,
  layers,
}: {
  facility: Facility;
  layers: DefenseLayer[];
}): LayerFocusViewState {
  const nearLayerRadiusM =
    layers
      .map((layer) => layer.distanceBandM.max)
      .filter((radiusM) => radiusM >= 1_500 && radiusM <= protectedObjectContextMaxRadiusM)
      .sort((a, b) => b - a)[0] ?? protectedObjectContextMinRadiusM;
  const contextRadiusM = clamp(
    Math.max(nearLayerRadiusM, protectedObjectContextMinRadiusM),
    protectedObjectContextMinRadiusM,
    protectedObjectContextMaxRadiusM,
  );
  const rawZoom = zoomForRadius({
    latitude: facility.center.lat,
    radiusM: contextRadiusM,
    targetDiameterPx: targetProtectedObjectDiameterPx,
  });

  return {
    longitude: facility.center.lon,
    latitude: facility.center.lat,
    zoom: Number(clamp(rawZoom, minLayerFocusZoom, maxLayerFocusZoom).toFixed(2)),
    pitch: 28,
    bearing: 0,
  };
}

function formatScaleDistance(distanceM: number) {
  if (distanceM >= 1000) {
    return `${(distanceM / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`;
  }
  return `${Math.round(distanceM).toLocaleString("ru-RU")} м`;
}

function niceScaleDistance(distanceM: number) {
  if (distanceM <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(distanceM));
  const normalized = distanceM / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

export function buildMapScaleBar({
  latitude,
  zoom,
  maxWidthPx = 108,
}: {
  latitude: number;
  zoom: number | undefined;
  maxWidthPx?: number;
}): MapScaleBar {
  const latitudeScale = Math.max(0.2, Math.cos(latitude * (Math.PI / 180)));
  const normalizedZoom = clamp(zoom ?? minLayerFocusZoom, minLayerFocusZoom, maxLayerFocusZoom);
  const metersPerPixel = (earthCircumferenceM * latitudeScale) / (2 ** normalizedZoom * webMercatorTileSizePx);
  const distanceM = niceScaleDistance(metersPerPixel * maxWidthPx);
  const widthPx = clamp(distanceM / metersPerPixel, 44, maxWidthPx);

  return {
    distanceM,
    label: formatScaleDistance(distanceM),
    widthPx: Number(widthPx.toFixed(1)),
  };
}

export function buildProtectedObjectPerimeter({
  center,
  widthM = 900,
  depthM = 620,
}: {
  center: GeoPoint;
  widthM?: number;
  depthM?: number;
}): ProtectedObjectPerimeter {
  const halfWidthM = widthM / 2;
  const halfDepthM = depthM / 2;

  return {
    center: [center.lon, center.lat],
    polygon: [
      projectMeters(center, -halfWidthM, -halfDepthM),
      projectMeters(center, halfWidthM, -halfDepthM),
      projectMeters(center, halfWidthM, halfDepthM),
      projectMeters(center, -halfWidthM, halfDepthM),
    ],
  };
}

export function buildPlacementFocusViewState({
  currentViewState,
  placementPosition,
}: {
  currentViewState: LayerFocusViewState;
  placementPosition: [number, number];
}): LayerFocusViewState {
  const currentZoom = currentViewState.zoom ?? minLayerFocusZoom;
  const nextZoom = clamp(
    Math.max(currentZoom + placementFocusZoomStep, placementFocusMinZoom),
    minLayerFocusZoom,
    maxLayerFocusZoom,
  );

  return {
    ...currentViewState,
    longitude: placementPosition[0],
    latitude: placementPosition[1],
    zoom: Number(nextZoom.toFixed(2)),
  };
}

function placementLayerIds(placement: Placement, assetsById: Map<string, DefenseAsset>) {
  if (placement.layerId) return [placement.layerId];
  return assetsById.get(placement.assetId)?.layerIds ?? [];
}

function placementPosition(center: GeoPoint, layer: DefenseLayer, placementIndex: number) {
  const min = layer.distanceBandM.min;
  const max = layer.distanceBandM.max;
  const radius = min === 0 ? Math.max(60, max * 0.55) : min + (max - min) * 0.55;
  const angle = ((placementIndex + 1) * layerOrderFactor + layer.order * 19) * (Math.PI / 180);
  return projectMeters(center, Math.sin(angle) * radius, Math.cos(angle) * radius);
}

function slotPosition(center: GeoPoint, layer: DefenseLayer, slotIndex: number, slotCount: number) {
  const min = layer.distanceBandM.min;
  const max = layer.distanceBandM.max;
  const radius = min === 0 ? Math.max(80, max * 0.62) : min + (max - min) * 0.58;
  const angleOffset = (layer.order % 2) * 18;
  const angle = ((slotIndex / slotCount) * 360 + angleOffset) * (Math.PI / 180);
  return projectMeters(center, Math.sin(angle) * radius, Math.cos(angle) * radius);
}

export function buildEchelonMapModel({
  facility,
  layers,
  layerCoverage,
  configuration,
  catalog,
  selectedLayerId,
  selectedSlotId,
}: {
  facility: Facility | null;
  layers: DefenseLayer[];
  layerCoverage: DefenseLayersResponse | null;
  configuration: Configuration;
  catalog: DefenseCatalogResponse | null;
  selectedLayerId?: DefenseLayerId;
  selectedSlotId?: string | null;
}) {
  const assetsById = new Map((catalog?.assets ?? []).map((asset) => [asset.id, asset]));
  const coverageByLayer = new Map(layerCoverage?.layerCoverage.map((item) => [item.layerId, item.coveredPct]) ?? []);
  const placementLayers = configuration.placements.flatMap((placement) =>
    placementLayerIds(placement, assetsById).map((layerId) => ({ placement, layerId })),
  );

  const zones: EchelonZone[] = facility
    ? layers.map((layer) => {
        const color = layerColor(layer);
        const coveragePct = coverageByLayer.get(layer.id) ?? 0;
        const placedCount = placementLayers.filter((item) => item.layerId === layer.id).length;
        return {
          layerId: layer.id,
          shortName: layer.shortName,
          name: layer.name,
          distanceLabel: layer.distanceBandM.label,
          coveragePct,
          placedCount,
          polygon: buildEchelonPolygon(facility.center, layer),
          geometryType: layer.geometry?.type === "polygon" ? "polygon" : "ring",
          fillColor: [...color, Math.round((layer.opacity ?? 0.16) * 255)] as [number, number, number, number],
          lineColor: [...color, 220] as [number, number, number, number],
        };
      })
    : [];

  const slots: EchelonMapSlot[] = facility
    ? layers.flatMap((layer) => {
        const color = layerColor(layer);
        const count = slotCountByLayer[layer.id] ?? 4;
        return Array.from({ length: count }, (_, index) => {
          const slotId = `${layer.id}-slot-${String(index + 1).padStart(2, "0")}`;
          const slotPlacement = configuration.placements.find((placement) => placement.slotId === slotId);
          const isSelected = selectedSlotId === slotId || (!selectedSlotId && selectedLayerId === layer.id && index === 0);
          const status = slotPlacement ? "occupied" : isSelected ? "selected" : "empty";
          return {
            id: slotId,
            layerId: layer.id,
            slotIndex: index + 1,
            label: `S${index + 1}`,
            position: slotPlacement?.mapRef
              ? [slotPlacement.mapRef.lon, slotPlacement.mapRef.lat]
              : slotPosition(facility.center, layer, index, count),
            status,
            placementId: slotPlacement?.id,
            catalogGroupId: slotPlacement?.catalogGroupId,
            color:
              status === "occupied"
                ? ([color[0], color[1], color[2], 255] as [number, number, number, number])
                : status === "selected"
                  ? ([15, 23, 42, 255] as [number, number, number, number])
                  : ([255, 255, 255, 235] as [number, number, number, number]),
          };
        });
      })
    : [];

  const placements: EchelonMapPlacement[] = facility
    ? placementLayers.map(({ placement, layerId }, index) => {
        const layer = layers.find((item) => item.id === layerId) ?? layers[0];
        const asset = assetsById.get(placement.assetId);
        const color = layer ? layerColor(layer) : fallbackLayerColors[index % fallbackLayerColors.length];
        const slot = placement.slotId ? slots.find((item) => item.id === placement.slotId) : null;
        const position = placement.mapRef
          ? ([placement.mapRef.lon, placement.mapRef.lat] as [number, number])
          : slot?.position ?? placementPosition(facility.center, layer, index);
        return {
          id: placement.slotId ? `${placement.id}:${placement.slotId}:${layerId}` : `${placement.id}:${layerId}`,
          sourcePlacementId: placement.id,
          layerId,
          label: placement.catalogGroupName ?? asset?.name ?? placement.assetId,
          position,
          color: [...color, 245] as [number, number, number, number],
          isCatalogPlacement: Boolean(placement.catalogGroupId),
          isSelected: placement.isSelected,
          isConflict: placement.isConflict,
          slotId: placement.slotId,
          catalogGroupId: placement.catalogGroupId,
          iconUrl: placement.iconUrl,
          markerCategory: placement.markerCategory,
          qty: placement.qty,
        };
      })
    : [];

  return { zones, slots, placements };
}
