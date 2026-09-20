export type DataQuality = "confirmed" | "estimated" | "demo";
export type Money = { currency: "RUB"; minor: string };
export type ProjectRef = { projectId: string; projectVersion: number };
export type CalculationIdentity = ProjectRef & {
  calculationVersion: string;
  inputDataVersions: Record<string, string>;
  snapshotDigest: string;
};
export type DataProvenance = {
  sourceLabel: string;
  sourceDocumentId: string | null;
  sourceDocumentRevision?: string | null;
  sourceDocumentChecksum?: string | null;
  sourceUrl: string | null;
  sourceDate: string | null;
  recordedAt: string;
  recordedBy: string;
  quality: DataQuality;
  revision: string;
};
export type Issue = {
  code: string;
  severity: "info" | "warning" | "error";
  objectIds: string[];
  message: string;
};
export type FinancialLine = {
  objectId: string;
  assetId: string;
  layerId: string;
  category: string;
  name: string;
  quantity: number;
  unitPriceMinor: string | null;
  lineTotalMinor: string | null;
  priceSource: "instance_override" | "components" | "template" | "unknown";
  provenance: DataProvenance | null;
};
export type CostGroup = {
  id: string;
  name: string;
  objectCount: number;
  unitCount: number;
  knownSubtotalMinor: string;
  totalMinor: string | null;
};
export type CostProjection = {
  identity: CalculationIdentity;
  currency: "RUB";
  lines: FinancialLine[];
  byLayer: CostGroup[];
  byType: CostGroup[];
  knownSubtotalMinor: string;
  totalMinor: string | null;
  isComplete: boolean;
  unknownPriceObjectIds: string[];
  warnings: Issue[];
};

// A local preview has no authoritative calculation identity or server digest.
export type DraftCostProjection = Omit<CostProjection, "identity"> & {
  kind: "draft";
  basedOn: ProjectRef | null;
};
export type PriceComponent = {
  id?: string;
  name: string;
  quantity: number;
  unitPriceMinor: string | null;
};
