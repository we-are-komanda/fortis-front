import { exportDefenseProjectJson } from "@/shared/lib/defense-project";
import { readJson, isRecord, FortisProtocolError } from "@/shared/lib/api-client";
import type { DefenseProject, VariantListResponse, VariantSummary } from "@/shared/types/defense-project";
import type {
  Configuration,
  DefenseCatalogResponse,
  DefenseLayersResponse,
  EvaluateRequest,
  Facility,
  KpiResult,
  RecommendRequest,
  Recommendation,
} from "@/shared/types/drone-defense";

type LayersQuery = {
  facilityId: string;
  scenarioId: string;
};

async function readVariantJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const data = await readJson<T>(input, init);
  if (!isRecord(data)) throw new FortisProtocolError();
  return data;
}

export function validateProjectList(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.items) || typeof data.totalItems !== "number" ||
      !data.items.every((item) => isRecord(item) && typeof item.projectId === "string")) throw new FortisProtocolError();
}

export function validateProjectPayload(data: unknown) {
  if (!isRecord(data) || typeof data.projectId !== "string" || data.schemaVersion !== 1 ||
      !isRecord(data.baseObject) || !isRecord(data.baseObject.center) || !Array.isArray(data.layers) ||
      !Array.isArray(data.assetLibrary) || !Array.isArray(data.placedObjects)) throw new FortisProtocolError();
}

export function validateVariantSummary(data: unknown) {
  if (!isRecord(data) || typeof data.projectId !== "string" || typeof data.version !== "number") throw new FortisProtocolError();
}

export function fetchCatalog() {
  return readJson<DefenseCatalogResponse>("/api/defense/catalog");
}

export function fetchFacilities() {
  return readJson<Facility[]>("/api/defense/facilities");
}

export function fetchLayers(query: LayersQuery) {
  const params = new URLSearchParams({
    facilityId: query.facilityId,
    scenarioId: query.scenarioId,
  });
  return readJson<DefenseLayersResponse>(`/api/defense/layers?${params.toString()}`);
}

export function evaluateConfigurationRequest(configuration: Configuration, scope: "regional" | "facility") {
  const payload: EvaluateRequest = { configuration, scope };
  return readJson<KpiResult>("/api/defense/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function recommendConfigurationRequest(configuration: Configuration, budgetRub: number) {
  const payload: RecommendRequest = { configuration, budgetRub, limit: 3 };
  return readJson<Recommendation[]>("/api/defense/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listVariants(): Promise<VariantListResponse> {
  const data = await readVariantJson<VariantListResponse>("/api/defense/projects");
  validateProjectList(data);
  return data;
}

export async function loadVariant(id: string, signal?: AbortSignal): Promise<DefenseProject> {
  const data = await readVariantJson<DefenseProject>(`/api/defense/projects/${encodeURIComponent(id)}`, { signal });
  validateProjectPayload(data);
  return data;
}

function projectUpdatePayload(args: { name: string; project: DefenseProject }) {
  return {
    name: args.name,
    enterpriseId: args.project.enterpriseId ?? args.project.baseObject.id,
    projectJson: exportDefenseProjectJson(args.project),
    ...(typeof args.project.version === "number" ? { version: args.project.version } : {}),
  };
}

export function saveVariantAsNew(args: { name: string; project: DefenseProject }): Promise<VariantSummary> {
  return readVariantJson<VariantSummary>("/api/defense/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(projectUpdatePayload(args)),
  });
}

export function overwriteVariant(args: { id: string; name: string; project: DefenseProject }): Promise<VariantSummary> {
  return readVariantJson<VariantSummary>(`/api/defense/projects/${encodeURIComponent(args.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(projectUpdatePayload(args)),
  });
}

export function deleteVariant(id: string): Promise<{ status: string }> {
  return readVariantJson<{ status: string }>(`/api/defense/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export {
  buildAssetLibraryUrl,
  createDefenseAsset,
  deleteDefenseAsset,
  fetchAssetLibrary,
  getDefenseAsset,
  normalizeDefenseAssetPayload,
  updateDefenseAsset,
} from "@/modules/drone-defense/infra/asset-library-api";
