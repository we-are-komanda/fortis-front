import { readDataProvenance } from "@/shared/lib/data-provenance";
import type { CompareResult, CostProjection, ProjectRef } from "@/shared/types/finance";
import { readBudgetProjection, readBudgetCheck } from "@/shared/lib/budget-projection";
import { FortisProtocolError, isRecord, getApiJson, postApiJson } from "@/shared/lib/api-client";

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

// Map and inventory remain untrusted until the standalone report renderer validates them.
export type BackendProjectReport = {
  reportId: string;
  reportSchemaVersion: "report-v1";
  identity: CostProjection["identity"];
  generatedAt: string;
  title: string;
  enterprise: { id: string; name: string | null };
  mapSnapshotData: unknown;
  mapVisibility: { mode: "all" | "saved"; layerIds: string[]; objectIds: string[]; showCoverage: false };
  objects: unknown[];
  warnings: unknown[];
  limitations: string[];
} & ({ hideCost: true } | { hideCost: false; cost: CostProjection; budget: ReturnType<typeof readBudgetProjection>; sources: unknown[] });

export async function getBackendBudgetConfig(projectId: string, projectVersion: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(projectVersion) || projectVersion < 1) throw new FortisProtocolError();
  return readBudgetProjection(await getApiJson<unknown>("/projects/budget", { query: { projectId, projectVersion }, signal }), projectId, projectVersion);
}

export async function getBackendProjectCost(projectId: string, projectVersion: number, signal?: AbortSignal): Promise<CostProjection> {
  if (!Number.isSafeInteger(projectVersion) || projectVersion < 1) throw new FortisProtocolError();
  const value = await getApiJson<unknown>("/projects/cost", { query: { projectId, projectVersion }, signal });
  return readCostProjection(value, projectId, projectVersion);
}

function readCostProjection(value: unknown, projectId: string, projectVersion: number): CostProjection {
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

export async function checkBackendProjectBudget(
  projectId: string,
  body: { version: number; projectJson: string },
) {
  return readBudgetCheck(await postApiJson<unknown>("/projects/budget/check", { query: { projectId }, body }), projectId, body.version);
}

export async function getBackendProjectReport(projectId: string, options: { projectVersion: number; hideCost: boolean; mapView?: "all" | "saved" }) {
  const { projectVersion, hideCost, mapView = "all" } = options;
  if (!projectId.trim() || !Number.isSafeInteger(projectVersion) || projectVersion < 1 ||
      typeof hideCost !== "boolean" || !["all", "saved"].includes(mapView)) throw new FortisProtocolError();
  const value = await getApiJson<unknown>("/projects/report", {
    query: { id: projectId, projectVersion, hideCost, mapView },
  });
  if (!isRecord(value) || typeof value.reportId !== "string" || !value.reportId || value.reportSchemaVersion !== "report-v1" ||
      !isRecord(value.identity) || value.identity.projectId !== projectId || value.identity.projectVersion !== projectVersion ||
      typeof value.identity.calculationVersion !== "string" || !value.identity.calculationVersion ||
      typeof value.identity.snapshotDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.identity.snapshotDigest) ||
      !isRecord(value.identity.inputDataVersions) || !Object.values(value.identity.inputDataVersions).every(v => typeof v === "string") ||
      value.hideCost !== hideCost || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt)) ||
      typeof value.title !== "string" || !isRecord(value.enterprise) || typeof value.enterprise.id !== "string" ||
      !(value.enterprise.name === null || typeof value.enterprise.name === "string") ||
      !isRecord(value.mapSnapshotData) || !isRecord(value.mapVisibility) || value.mapVisibility.mode !== mapView ||
      value.mapVisibility.showCoverage !== false ||
      ![value.mapVisibility.layerIds, value.mapVisibility.objectIds, value.limitations].every(v => Array.isArray(v) && v.every(x => typeof x === "string")) ||
      !Array.isArray(value.objects) || !Array.isArray(value.warnings)) throw new FortisProtocolError();
  if (hideCost) {
    if (["cost", "budget", "sources", "estimate"].some(key => key in value)) throw new FortisProtocolError();
  } else {
    const cost = readCostProjection(value.cost, projectId, projectVersion);
    const budget = readBudgetProjection(value.budget, projectId, projectVersion);
    const identityKey = (v: CostProjection["identity"]) => JSON.stringify([
      v.projectId, v.projectVersion, v.calculationVersion, v.snapshotDigest, Object.entries(v.inputDataVersions).sort(),
    ]);
    const expected = identityKey(value.identity as CostProjection["identity"]);
    if (identityKey(cost.identity) !== expected || identityKey(budget.identity) !== expected ||
        cost.totalMinor !== budget.spentMinor || !Array.isArray(value.sources)) throw new FortisProtocolError();
    value.sources.forEach(readDataProvenance);
  }
  return value as BackendProjectReport;
}

export async function compareBackendProjects(a: ProjectRef, b: ProjectRef, enterpriseId: string, signal?: AbortSignal): Promise<CompareResult> {
  if (![a,b].every(ref => typeof ref.projectId === "string" && ref.projectId.trim() && Number.isSafeInteger(ref.projectVersion) && ref.projectVersion > 0) ||
      a.projectId === b.projectId && a.projectVersion === b.projectVersion || !enterpriseId.trim()) throw new FortisProtocolError();
  const value = await getApiJson<unknown>("/projects/compare", { query: { projectIdA: a.projectId, projectVersionA: a.projectVersion, projectIdB: b.projectId, projectVersionB: b.projectVersion }, signal });
  if (!isRecord(value) || value.enterpriseId !== enterpriseId || !Array.isArray(value.warnings)) throw new FortisProtocolError();
  for (const [side,ref] of [[value.a,a],[value.b,b]] as const) {
    if (!isRecord(side) || !isRecord(side.identity) || typeof side.name !== "string" || !side.name.trim() || typeof side.updatedAt !== "string" || !Number.isFinite(Date.parse(side.updatedAt))) throw new FortisProtocolError();
    const cost = readCostProjection(side.cost, ref.projectId, ref.projectVersion);
    const budget = readBudgetProjection(side.budget, ref.projectId, ref.projectVersion);
    const identity = (v: unknown) => {
      if (!isRecord(v) || !isRecord(v.inputDataVersions)) throw new FortisProtocolError();
      return JSON.stringify([v.projectId,v.projectVersion,v.calculationVersion,v.snapshotDigest,Object.entries(v.inputDataVersions).sort(([x],[y]) => x.localeCompare(y))]);
    };
    if (identity(side.identity) !== identity(cost.identity) || identity(cost.identity) !== identity(budget.identity) || cost.totalMinor !== budget.spentMinor) throw new FortisProtocolError();
  }
  const result = value as CompareResult;
  const totalA = result.a.cost.totalMinor, totalB = result.b.cost.totalMinor;
  const difference = totalA === null || totalB === null ? null : BigInt(totalB) - BigInt(totalA);
  let percent: string | null = null;
  if (difference !== null && totalA !== null && BigInt(totalA) > BigInt(0)) {
    const numerator = (difference < BigInt(0) ? -difference : difference) * BigInt(10000), denominator = BigInt(totalA);
    const rounded = numerator / denominator + (numerator % denominator * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
    percent = `${difference < BigInt(0) && rounded !== BigInt(0) ? "-" : ""}${rounded / BigInt(100)}.${String(rounded % BigInt(100)).padStart(2,"0")}`;
  }
  if (result.differenceMinor !== (difference === null ? null : String(difference)) || result.differencePercent !== percent ||
      !result.warnings.every(issue => isRecord(issue) && typeof issue.code === "string" && typeof issue.message === "string" && ["info","warning","error"].includes(String(issue.severity)) && Array.isArray(issue.objectIds) && issue.objectIds.every(id=>typeof id === "string"))) throw new FortisProtocolError();
  return result;
}
