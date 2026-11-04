import type { PlacedDefenseCompoundProfile } from "@/shared/types/defense-configuration";
import type { Coordinates } from "@/shared/types/defense-project";

export type DefenseLayerId =
  | "layer_01_external_warning"
  | "layer_02_detection"
  | "layer_03_identification"
  | "layer_04_suppression"
  | "layer_05_mid_range_kinetic"
  | "layer_06_last_line_kinetic"
  | "layer_07_accuracy_disruption"
  | "layer_08_passive_protection"
  | "layer_09_hardening";

export type ThreatTypeId = "fixedWing" | "fpv" | "loitering" | "swarm";
export type DefenseScenarioId = "baseline" | "balanced" | "reinforced";

export type GeoPoint = { lon: number; lat: number };

export type DefenseAssetKind =
  | "operator_substation"
  | "scaffolding"
  | "fbs_enclosure"
  | "perimeter_barrier"
  | "cable_mesh";

export type Facility = {
  id: string;
  name: string;
  region: string;
  center: GeoPoint;
  priorityWeight: number;
  status: "active" | "configuring" | "offline";
};

export type DefenseLayer = {
  id: DefenseLayerId;
  order: number;
  name: string;
  shortName: string;
  defaultWeight: number;
  color?: string;
  opacity?: number;
  distanceBandM: {
    min: number;
    max: number;
    label: string;
  };
  geometry?: {
    type: "polygon";
    coordinates: Coordinates[];
    isClosed?: boolean;
  };
};

export type ThreatType = {
  id: ThreatTypeId;
  label: string;
  weight: number;
  color: string;
};

export type DefenseAsset = {
  id: string;
  kind: DefenseAssetKind;
  name: string;
  layerIds: DefenseLayerId[];
  placementMode: "anchor-or-sector" | "site-point";
  scope: "regional" | "facility";
  coverageRadiusM: number;
  suitability: {
    effEnv: number;
    availability: number;
    governance: number;
    deploySpeed: number;
    costScore: number;
  };
  threatCoefficients: Record<ThreatTypeId, number>;
  cost: {
    capexRub: number;
    opexRubYear: number;
  };
};

export type ThreatRoute = {
  id: string;
  facilityId: string;
  threatType: ThreatTypeId;
  probability: number;
  path: GeoPoint[];
};

export type HexCell = {
  id: string;
  scheme: "h3";
  resolution: number;
  center: GeoPoint;
  polygon: GeoPoint[];
  facilityId: string;
  priorityWeight: number;
  baseRisk: Record<ThreatTypeId, number>;
};

export type Placement = {
  id: string;
  assetId: string;
  facilityId: string;
  scenarioId: DefenseScenarioId;
  layerId?: DefenseLayerId;
  catalogGroupId?: string;
  catalogGroupName?: string;
  iconUrl?: string;
  markerCategory?: string;
  markerAssetId?: string;
  slotId?: string;
  mapRef?: GeoPoint;
  qty: number;
  readiness: number;
  layerGapBoost: number;
  criticalityBoost: number;
  feasibility: number;
  environmentModifier: number;
  isSelected?: boolean;
  isConflict?: boolean;
  compoundProfile?: PlacedDefenseCompoundProfile;
  sceneRef?: {
    x: number;
    z: number;
  };
};

export type Configuration = {
  facilityId: string;
  scenarioId: DefenseScenarioId;
  placements: Placement[];
};

export type KpiResult = {
  facilityId: string;
  scenarioId: DefenseScenarioId;
  capexRub: number;
  opexRubYear: number;
  tco3yRub: number;
  baselineRisk: number;
  residualRisk: number;
  riskReductionPct: number;
  protectedAssetsPct: number;
  perimeterCoveredPct: number;
  layerReadinessPct: number;
  layerCoverage: Array<{
    layerId: DefenseLayerId;
    coveredPct: number;
    distanceBandM: {
      min: number;
      max: number;
      label: string;
    };
  }>;
  costPerRiskPointRub: number;
  valuePerRuble: number;
};

export type Recommendation = {
  candidateAssetId: string;
  candidateAssetName: string;
  affectedLayerIds: DefenseLayerId[];
  reason: string;
  deltaRisk: number;
  deltaResidualRiskPct: number;
  deltaTco: number;
  score: number;
};

export type DefenseCatalogResponse = {
  layers: DefenseLayer[];
  assets: DefenseAsset[];
  threatTypes: ThreatType[];
  matrix: Record<ThreatTypeId, Record<DefenseLayerId, number>>;
};

export type DefenseLayersResponse = {
  facilityId: string;
  scenarioId: DefenseScenarioId;
  layerCoverage: Array<{
    layerId: DefenseLayerId;
    coveredPct: number;
    distanceBandM: {
      min: number;
      max: number;
      label: string;
    };
  }>;
};

export type EvaluateRequest = {
  configuration: Configuration;
  scope: "regional" | "facility";
};

export type RecommendRequest = {
  configuration: Configuration;
  budgetRub: number;
  limit?: number;
};
