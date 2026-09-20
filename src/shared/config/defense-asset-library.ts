import { defenseItems } from "@/shared/config/defense-catalog";
import type {
  DefenseAsset,
  DefenseAssetCategory,
  DefenseAssetCoverageType,
  DefenseAssetRole,
} from "@/shared/types/defense-project";

function categoryForItem(itemId: string): DefenseAssetCategory {
  if (itemId.startsWith("l1-")) return "early-warning";
  if (itemId.includes("radar") || itemId.startsWith("l2-")) return "detection";
  if (itemId.includes("classification")) return "classification";
  if (itemId.includes("ew") || itemId.includes("spoof") || itemId.includes("microwave")) return "jamming";
  if (itemId.includes("interceptor")) return "interceptor";
  if (
    itemId.includes("turret") ||
    itemId.includes("barrel") ||
    itemId.includes("zrpk") ||
    itemId.includes("pzrk") ||
    itemId.includes("laser") ||
    itemId.includes("aircraft") ||
    itemId.includes("armored") ||
    itemId.startsWith("l5-") ||
    itemId.startsWith("l6-")
  ) return "kinetic";
  if (itemId.includes("passive") || itemId.startsWith("l8-")) return "passive-protection";
  if (itemId.includes("atz") || itemId.includes("armoring") || itemId.startsWith("l9-")) return "engineering-protection";
  if (itemId.includes("command")) return "command-center";
  return "infrastructure";
}

function rolesForCategory(category: DefenseAssetCategory): DefenseAssetRole[] {
  switch (category) {
    case "early-warning":
      return ["alert", "monitor"];
    case "detection":
      return ["detect", "track"];
    case "classification":
      return ["classify"];
    case "jamming":
    case "spoofing":
      return ["suppress"];
    case "kinetic":
    case "interceptor":
      return ["destroy"];
    case "passive-protection":
    case "engineering-protection":
      return ["protect", "delay"];
    case "command-center":
      return ["coordinate", "monitor"];
    default:
      return ["monitor"];
  }
}

function layerCodeFromLayerId(layerId?: string): string | undefined {
  const match = layerId?.match(/^layer_(\d+)/);
  return match ? `L${Number(match[1])}` : undefined;
}

const allLayerCodes = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9"];

function uniq(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function recommendedLayerCodesForItem(itemId: string, category: DefenseAssetCategory, seedCode?: string) {
  if (category === "detection") return uniq([seedCode, "L2", "L3"]);
  if (category === "classification" || category === "software") return uniq([seedCode, "L2", "L3"]);
  if (category === "jamming" || category === "spoofing") return uniq([seedCode, "L4"]);
  if (category === "kinetic" || category === "interceptor") return uniq([seedCode, "L5", "L6"]);
  if (category === "passive-protection" || category === "engineering-protection") return uniq([seedCode, "L8", "L9"]);
  if (category === "command-center" || category === "external-service" || category === "early-warning") return uniq([seedCode, "L1"]);
  return seedCode ? [seedCode] : [];
}

function compatibleLayerCodesForCategory(category: DefenseAssetCategory) {
  switch (category) {
    case "detection":
      return ["L1", "L2", "L3"];
    case "classification":
    case "software":
      return ["L2", "L3"];
    case "jamming":
    case "spoofing":
      return ["L3", "L4", "L7"];
    case "kinetic":
    case "interceptor":
      return ["L5", "L6"];
    case "passive-protection":
    case "engineering-protection":
      return ["L7", "L8", "L9"];
    case "early-warning":
    case "command-center":
    case "external-service":
      return ["L1", "L2"];
    default:
      return allLayerCodes;
  }
}

function incompatibleLayerCodesForCategory(category: DefenseAssetCategory) {
  switch (category) {
    case "kinetic":
    case "interceptor":
      return ["L1", "L2"];
    case "jamming":
    case "spoofing":
      return ["L8", "L9"];
    default:
      return [];
  }
}

function coverageTypeForCategory(category: DefenseAssetCategory, isNonPhysical: boolean): DefenseAssetCoverageType {
  if (isNonPhysical) return "none";
  if (category === "jamming" || category === "spoofing") return "sector";
  if (category === "passive-protection" || category === "engineering-protection" || category === "infrastructure") return "polygon";
  return "circle";
}

function parseRangeLabel(rangeLabel?: string) {
  if (!rangeLabel) return {};
  const normalized = rangeLabel.replace(",", ".").toLowerCase();
  const numbers = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const multiplier = normalized.includes("км") ? 1000 : 1;
  if (normalized.includes("до") && numbers[0] !== undefined) {
    return { maxEffectiveDistance: Math.round(numbers[0] * multiplier) };
  }
  if (numbers.length >= 2) {
    return {
      minEffectiveDistance: Math.round(numbers[0] * multiplier),
      maxEffectiveDistance: Math.round(numbers[1] * multiplier),
    };
  }
  return {};
}

const assetIconUrlByItemId: Partial<Record<string, string>> = {
  "l2-optical": "/drone-defense/assets/optical-detection.avif",
  "l2-acoustic": "/drone-defense/assets/acoustic-detection.avif",
  "l2-rf-passive": "/drone-defense/assets/rf-detection.avif",
  "l4-gps-spoof": "/drone-defense/assets/spoofers.avif",
  "l4-microwave": "/drone-defense/assets/microwave-weapon.avif",
  "l5-mobile-fire": "/drone-defense/assets/mog-mobile-fire-group.avif",
  "l5-bars": "/drone-defense/assets/bars.avif",
  "l6-pzrk": "/drone-defense/assets/pzrk.avif",
  "l7-camouflage": "/drone-defense/assets/camouflage-nets.avif",
  "l7-smoke": "/drone-defense/assets/smoke-generation.avif",
  "l7-thermal-decoy": "/drone-defense/assets/thermal-decoys.avif",
  "l7-decoys": "/drone-defense/assets/decoys.avif",
  "l7-contrast": "/drone-defense/assets/contrast-reduction.avif",
  "l8-domes": "/drone-defense/assets/domes-aerostats.avif",
  "mobile-radar": "/drone-defense/assets/radar.avif",
  "ew-narrowband": "/drone-defense/assets/jamming-generator.avif",
  "ew-broadband": "/drone-defense/assets/jamming-generator.avif",
  "interceptor-drones": "/drone-defense/assets/interceptor-drones.avif",
  aircraft: "/drone-defense/assets/aircraft.avif",
  "turret-complex": "/drone-defense/assets/mog-mounted-system.avif",
  "armored-vehicle": "/drone-defense/assets/armored-vehicle.avif",
  laser: "/drone-defense/assets/laser.avif",
  "barrel-aa": "/drone-defense/assets/zak.avif",
  "pantsir-zrpk": "/drone-defense/assets/zrpk.avif",
  "passive-itz-bundle": "/drone-defense/assets/passive-itz-bundle.avif",
  "atz-bundle": "/drone-defense/assets/atz-personnel-protection.avif",
};

type MockAssetTtx = Partial<
  Pick<
    DefenseAsset,
    | "minEffectiveDistance"
    | "maxEffectiveDistance"
    | "coverageType"
    | "coverageRadius"
    | "coverageAngle"
    | "deploymentType"
    | "placementType"
    | "weaponSpec"
    | "detectionSpec"
    | "ewSpec"
  >
>;

const mockTtxByItemId: Record<string, MockAssetTtx> = {
  "l2-optical": {
    maxEffectiveDistance: 12000,
    coverageType: "sector",
    coverageRadius: 12000,
    coverageAngle: 70,
    detectionSpec: {
      mock: true,
      type: "optical",
      mode: "static-sector",
      detectionRangeM: 12000,
      fieldOfViewDeg: 70,
      thermalImager: false,
      azimuthDeg: 0,
    },
  },
  "l2-thermal": {
    maxEffectiveDistance: 9000,
    coverageType: "sector",
    coverageRadius: 9000,
    coverageAngle: 60,
    detectionSpec: {
      mock: true,
      type: "thermal-optical",
      mode: "static-sector",
      detectionRangeM: 9000,
      fieldOfViewDeg: 60,
      thermalImager: true,
      azimuthDeg: 0,
    },
  },
  "l2-acoustic": {
    maxEffectiveDistance: 4500,
    coverageType: "circle",
    coverageRadius: 4500,
    detectionSpec: {
      mock: true,
      type: "ground-acoustic-array",
      detectionRangeM: 4500,
      fieldOfViewDeg: 360,
      azimuthDeg: 0,
    },
  },
  "l2-rf-passive": {
    maxEffectiveDistance: 18000,
    coverageType: "sector",
    coverageRadius: 18000,
    coverageAngle: 120,
    detectionSpec: {
      mock: true,
      type: "passive-rf",
      frequencyBands: ["400-900 MHz", "1.2-2.4 GHz", "5.8 GHz"],
      detectionRangeM: 18000,
      fieldOfViewDeg: 120,
      azimuthDeg: 0,
    },
  },
  "mobile-radar": {
    minEffectiveDistance: 5000,
    maxEffectiveDistance: 75000,
    coverageType: "circle",
    coverageRadius: 75000,
    detectionSpec: {
      mock: true,
      type: "active-radar",
      frequencyBands: ["S-band", "X-band"],
      detectionRangeM: 75000,
      rotationPeriodSec: 6,
      fieldOfViewDeg: 360,
      azimuthDeg: 0,
      thermalImager: false,
    },
  },
  "l4-gps-spoof": {
    maxEffectiveDistance: 6000,
    coverageType: "sector",
    coverageRadius: 6000,
    coverageAngle: 120,
    ewSpec: {
      mock: true,
      type: "spoofing",
      frequencyBands: ["GNSS L1", "GNSS L2"],
      actionRangeM: 6000,
      azimuthDeg: 0,
      sectorWidthDeg: 120,
    },
  },
  "l4-microwave": {
    maxEffectiveDistance: 2500,
    coverageType: "sector",
    coverageRadius: 2500,
    coverageAngle: 45,
    ewSpec: {
      mock: true,
      type: "directed-microwave",
      frequencyBands: ["demo microwave band"],
      actionRangeM: 2500,
      azimuthDeg: 0,
      sectorWidthDeg: 45,
    },
  },
  "ew-narrowband": {
    minEffectiveDistance: 2000,
    maxEffectiveDistance: 10000,
    coverageType: "sector",
    coverageRadius: 10000,
    coverageAngle: 100,
    ewSpec: {
      mock: true,
      type: "narrowband-jammer",
      frequencyBands: ["GNSS L1/L2"],
      actionRangeM: 10000,
      azimuthDeg: 0,
      sectorWidthDeg: 100,
    },
  },
  "ew-broadband": {
    minEffectiveDistance: 2000,
    maxEffectiveDistance: 10000,
    coverageType: "sector",
    coverageRadius: 10000,
    coverageAngle: 120,
    ewSpec: {
      mock: true,
      type: "broadband-jammer",
      frequencyBands: ["433 MHz", "868/915 MHz", "2.4 GHz", "5.8 GHz"],
      actionRangeM: 10000,
      azimuthDeg: 0,
      sectorWidthDeg: 120,
    },
  },
  "l5-mobile-fire": {
    maxEffectiveDistance: 8000,
    coverageType: "sector",
    coverageRadius: 8000,
    coverageAngle: 90,
    deploymentType: "mobile",
    weaponSpec: {
      mock: true,
      weaponClass: "compound-post",
      operationMode: "manual",
      engagementRangeM: 8000,
      sectorWidthDeg: 90,
      modulesPerUnit: 2,
      ammunition: "mixed-demo",
    },
  },
  "l5-bars": {
    maxEffectiveDistance: 3000,
    coverageType: "sector",
    coverageRadius: 3000,
    coverageAngle: 100,
    deploymentType: "mobile",
    weaponSpec: {
      mock: true,
      weaponClass: "mobile-fire-post",
      operationMode: "manual",
      engagementRangeM: 3000,
      sectorWidthDeg: 100,
      modulesPerUnit: 1,
    },
  },
  "l6-pzrk": {
    maxEffectiveDistance: 6000,
    coverageType: "sector",
    coverageRadius: 6000,
    coverageAngle: 80,
    deploymentType: "mobile",
    weaponSpec: {
      mock: true,
      weaponClass: "manpads",
      operationMode: "manual",
      engagementRangeM: 6000,
      sectorWidthDeg: 80,
      ammunition: "missile-demo",
    },
  },
  "interceptor-drones": {
    minEffectiveDistance: 1000,
    maxEffectiveDistance: 12000,
    coverageType: "circle",
    coverageRadius: 12000,
    deploymentType: "mobile",
    weaponSpec: {
      mock: true,
      weaponClass: "interceptor-drone",
      operationMode: "automatic",
      engagementRangeM: 12000,
      modulesPerUnit: 4,
    },
  },
  aircraft: {
    minEffectiveDistance: 1000,
    maxEffectiveDistance: 20000,
    coverageType: "circle",
    coverageRadius: 20000,
    deploymentType: "mobile",
    weaponSpec: {
      mock: true,
      weaponClass: "air-patrol",
      operationMode: "manual",
      engagementRangeM: 20000,
      modulesPerUnit: 1,
    },
  },
  "turret-complex": {
    minEffectiveDistance: 500,
    maxEffectiveDistance: 5000,
    coverageType: "sector",
    coverageRadius: 5000,
    coverageAngle: 120,
    weaponSpec: {
      mock: true,
      weaponClass: "turret",
      caliberMm: 12.7,
      operationMode: "automatic",
      engagementRangeM: 5000,
      sectorWidthDeg: 120,
      modulesPerUnit: 1,
    },
  },
  "armored-vehicle": {
    minEffectiveDistance: 500,
    maxEffectiveDistance: 4000,
    coverageType: "sector",
    coverageRadius: 4000,
    coverageAngle: 110,
    deploymentType: "mobile",
    weaponSpec: {
      mock: true,
      weaponClass: "mobile-weapon-platform",
      operationMode: "manual",
      engagementRangeM: 4000,
      sectorWidthDeg: 110,
      modulesPerUnit: 1,
    },
  },
  laser: {
    maxEffectiveDistance: 1500,
    coverageType: "sector",
    coverageRadius: 1500,
    coverageAngle: 30,
    weaponSpec: {
      mock: true,
      weaponClass: "directed-energy",
      operationMode: "automatic",
      engagementRangeM: 1500,
      sectorWidthDeg: 30,
      modulesPerUnit: 1,
    },
  },
  "barrel-aa": {
    maxEffectiveDistance: 3500,
    coverageType: "sector",
    coverageRadius: 3500,
    coverageAngle: 120,
    weaponSpec: {
      mock: true,
      weaponClass: "barrel-aa",
      caliberMm: 30,
      operationMode: "automatic",
      engagementRangeM: 3500,
      sectorWidthDeg: 120,
      modulesPerUnit: 2,
    },
  },
  "pantsir-zrpk": {
    maxEffectiveDistance: 20000,
    coverageType: "circle",
    coverageRadius: 20000,
    weaponSpec: {
      mock: true,
      weaponClass: "zrpk",
      operationMode: "automatic",
      engagementRangeM: 20000,
      missileRangeM: 20000,
      gunRangeM: 4000,
      modulesPerUnit: 2,
    },
  },
};

export const defenseAssetLibrary: DefenseAsset[] = defenseItems.map((item) => {
  const category = categoryForItem(item.id);
  const seedLayerCode = layerCodeFromLayerId(item.layerId);
  const isNonPhysical = item.id.includes("osint") || item.id.includes("command") || item.id.startsWith("l1-");
  const coverageType = coverageTypeForCategory(category, isNonPhysical);
  const mockTtx = mockTtxByItemId[item.id];
  const effectiveCoverageType = mockTtx?.coverageType ?? coverageType;
  const placementType = isNonPhysical
    ? "non-physical"
    : effectiveCoverageType === "line" || effectiveCoverageType === "polygon"
      ? "zone-object"
      : "map-object";
  const range = parseRangeLabel(item.rangeLabel);
  return {
    id: item.id,
    name: item.title,
    shortName: item.shortTitle,
    category,
    roles: rolesForCategory(category),
    protectionType: item.protectionType,
    pricePerUnitMln: item.pricePerUnitMln,
    provenance: {
      sourceLabel: "Демонстрационный каталог Fortis",
      sourceDocumentId: null, sourceUrl: null, sourceDate: null,
      recordedAt: "2026-09-20T00:00:00Z", recordedBy: "bundled-demo",
      quality: "demo", revision: "demo-catalog-v1",
    },
    currency: item.currency,
    unitLabel: item.unitLabel,
    compatibleLayerTypes: ["circle", "ring", "polygon", "freeform"],
    recommendedLayerCodes: recommendedLayerCodesForItem(item.id, category, seedLayerCode),
    compatibleLayerCodes: compatibleLayerCodesForCategory(category),
    incompatibleLayerCodes: incompatibleLayerCodesForCategory(category),
    minEffectiveDistance: mockTtx?.minEffectiveDistance ?? range.minEffectiveDistance,
    maxEffectiveDistance: mockTtx?.maxEffectiveDistance ?? range.maxEffectiveDistance,
    coverageType: effectiveCoverageType,
    coverageRadius: isNonPhysical
      ? undefined
      : (mockTtx?.coverageRadius ?? range.maxEffectiveDistance ?? (item.coverageWeight ? item.coverageWeight * 100 : undefined)),
    coverageAngle: mockTtx?.coverageAngle ?? (category === "jamming" || category === "spoofing" ? 90 : undefined),
    deploymentType: mockTtx?.deploymentType ?? (isNonPhysical ? "external" : "static"),
    placementType: mockTtx?.placementType ?? placementType,
    iconUrl: assetIconUrlByItemId[item.id],
    score: item.score,
    priority: item.priority,
    compoundProfile: item.compoundProfile,
    weaponSpec: mockTtx?.weaponSpec,
    detectionSpec: mockTtx?.detectionSpec,
    ewSpec: mockTtx?.ewSpec,
    tags: item.mapCatalogGroupIds,
    legacyItemId: item.id,
    calculatorAssetId: item.calculatorAssetId,
    mapCatalogGroupIds: item.mapCatalogGroupIds,
  };
});

export function getDefenseAssetById(assetId: string): DefenseAsset | undefined {
  return defenseAssetLibrary.find((item) => item.id === assetId);
}
