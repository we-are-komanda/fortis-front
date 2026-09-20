import { readDataProvenance } from "@/shared/lib/data-provenance";
import type { CostProjection } from "@/shared/types/finance";
import { FortisProtocolError, isRecord, getApiJson, postApiJson, putApiJson } from "@/shared/lib/api-client";

export type BackendEstimateLine = {
  objectId: string;
  assetId: string;
  assetName: string;
  echelonId: string;
  echelonName: string;
  typeId: string;
  typeName: string;
  quantity: number;
  unitPriceMln: number;
  lineTotalMln: number;
};

export type BackendCostCalculation = {
  totalMln: number;
  byEchelon: Array<{ echelonId: string; echelonName: string; lines: BackendEstimateLine[]; echelonTotalMln: number }>;
  byType: Array<{ typeId: string; typeName: string; lines: BackendEstimateLine[]; typeTotalMln: number }>;
  byObject: BackendEstimateLine[];
};

export type BackendBudgetConfig = {
  budgetMode: "limited" | "unlimited";
  budgetAmountMln: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};

export type BackendBudgetCheck = {
  fits: boolean;
  remainingMln: number;
  requiredMln: number;
  budgetMode: "limited" | "unlimited";
};

export type BackendProjectReport = {
  projectId: string;
  projectName: string;
  baseObject: unknown;
  layers: unknown[];
  placedObjects: unknown[];
  estimate: BackendCostCalculation;
  structuralProfile: unknown;
  hideCost: boolean;
};

export type BackendProjectCompare = {
  projectA: unknown;
  projectB: unknown;
  diff: {
    objectCountDelta: number;
    unitCountDelta: number;
    echelonCountDelta: number;
    categoryCountDelta: number;
    conflictCountDelta: number;
    coveredObjCountDelta: number;
    costDeltaMln: number;
    byEchelon: unknown[];
  };
};

export function getBackendBudgetConfig(projectId: string) {
  return getApiJson<BackendBudgetConfig>("/projects/budget", { query: { id: projectId } });
}

export function updateBackendBudgetConfig(projectId: string, body: Pick<BackendBudgetConfig, "budgetMode" | "budgetAmountMln">) {
  return putApiJson<BackendBudgetConfig>("/projects/budget", { query: { id: projectId }, body });
}

export async function getBackendProjectCost(projectId: string, projectVersion: number, signal?: AbortSignal): Promise<CostProjection> {
  if (!Number.isSafeInteger(projectVersion) || projectVersion < 1) throw new FortisProtocolError();
  const value = await getApiJson<unknown>("/projects/cost", { query: { projectId, projectVersion }, signal });
  if (!isRecord(value) || !isRecord(value.identity) || value.identity.projectId !== projectId || value.identity.projectVersion !== projectVersion ||
      typeof value.identity.calculationVersion !== "string" || !value.identity.calculationVersion ||
      typeof value.identity.snapshotDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.identity.snapshotDigest) ||
      !isRecord(value.identity.inputDataVersions) || !Object.values(value.identity.inputDataVersions).every(v => typeof v === "string") ||
      value.currency !== "RUB" || !Array.isArray(value.lines) || !Array.isArray(value.byLayer) || !Array.isArray(value.byType) ||
      !Array.isArray(value.unknownPriceObjectIds) || !Array.isArray(value.warnings)) throw new FortisProtocolError();
  const amount = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
  const optionalAmount = (v: unknown) => v === null || amount(v);
  if (!amount(value.knownSubtotalMinor) || !optionalAmount(value.totalMinor)) throw new FortisProtocolError();
  let known = BigInt(0);
  const unknownIds: string[] = [];
  const objectIds = new Set<string>();
  for (const line of value.lines) {
    if (!isRecord(line) || ![line.objectId,line.assetId,line.layerId,line.category,line.name].every(v=>typeof v === "string") ||
        !Number.isSafeInteger(line.quantity) || Number(line.quantity)<1 || Number(line.quantity)>1_000_000 ||
        !optionalAmount(line.unitPriceMinor) || !optionalAmount(line.lineTotalMinor) ||
        !["instance_override","components","template","unknown"].includes(String(line.priceSource)) ||
        !(line.provenance === null || isRecord(line.provenance)) || objectIds.has(String(line.objectId))) throw new FortisProtocolError();
    readDataProvenance(line.provenance);
    objectIds.add(String(line.objectId));
    if (line.unitPriceMinor === null) {
      if (line.lineTotalMinor !== null) throw new FortisProtocolError();
      unknownIds.push(String(line.objectId));
    } else {
      const unit = BigInt(line.unitPriceMinor as string);
      if (unit > BigInt("1000000000000000") || line.lineTotalMinor !== String(unit * BigInt(line.quantity as number))) throw new FortisProtocolError();
      known += BigInt(line.lineTotalMinor as string);
    }
  }
  if (value.knownSubtotalMinor !== String(known) || value.totalMinor !== (unknownIds.length ? null : String(known)) ||
      value.isComplete !== (unknownIds.length === 0) || JSON.stringify(value.unknownPriceObjectIds) !== JSON.stringify(unknownIds)) throw new FortisProtocolError();
  for (const [groups,key] of [[value.byLayer,"layerId"],[value.byType,"category"]] as const) {
    const expected = new Map<string, {count:number; units:number; known:bigint; unknown:boolean}>();
    for (const line of value.lines) {
      const id = line[key] as string;
      const group = expected.get(id) ?? {count:0,units:0,known:BigInt(0),unknown:false};
      group.count++; group.units+=line.quantity;
      if (line.lineTotalMinor===null) group.unknown=true; else group.known+=BigInt(line.lineTotalMinor);
      expected.set(id,group);
    }
    if (groups.length !== expected.size) throw new FortisProtocolError();
    for (const group of groups) {
      if (!isRecord(group) || typeof group.id!=="string" || typeof group.name!=="string") throw new FortisProtocolError();
      const check = expected.get(group.id);
      if (!check || group.objectCount!==check.count || group.unitCount!==check.units || group.knownSubtotalMinor!==String(check.known) ||
          group.totalMinor!==(check.unknown ? null : String(check.known))) throw new FortisProtocolError();
      expected.delete(group.id);
    }
  }
  if (!value.warnings.every(issue => isRecord(issue) && typeof issue.code === "string" && typeof issue.message === "string" &&
      ["info","warning","error"].includes(String(issue.severity)) && Array.isArray(issue.objectIds) && issue.objectIds.every(id=>typeof id === "string"))) throw new FortisProtocolError();
  return value as CostProjection;
}

export function checkBackendProjectBudget(
  projectId: string,
  body: { assetId: string; quantity: number; echelonId: string },
) {
  return postApiJson<BackendBudgetCheck>("/projects/budget/check", { query: { id: projectId }, body });
}

export function getBackendProjectReport(projectId: string, options: { hideCost?: boolean } = {}) {
  return getApiJson<BackendProjectReport>("/projects/report", {
    query: { id: projectId, hideCost: options.hideCost },
  });
}

export function compareBackendProjects(projectId1: string, projectId2: string) {
  return getApiJson<BackendProjectCompare>("/projects/compare", {
    query: { id1: projectId1, id2: projectId2 },
  });
}
