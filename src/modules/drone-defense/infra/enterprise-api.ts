import { isRecord, FortisProtocolError, requireListItems, buildApiV1Url, getApiJson } from "@/shared/lib/api-client";
import type { EnterpriseStatus, ProtectedObjectOption } from "@/shared/types/defense-project";

export type FetchEnterprisesOptions = {
  limit?: number;
  offset?: number;
};

type BackendEnterprisePayload = Record<string, unknown>;

type BackendEnterpriseListResponse = {
  items?: BackendEnterprisePayload[];
  totalItems?: number;
};

const enterprisesPath = "/enterprises";

function valueOf(payload: BackendEnterprisePayload, key: string) {
  return payload[key];
}

function stringValue(payload: BackendEnterprisePayload, key: string) {
  const value = valueOf(payload, key);
  return typeof value === "string" ? value : undefined;
}

function numberValue(payload: BackendEnterprisePayload, key: string) {
  const value = valueOf(payload, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanString(value: string | undefined) {
  return value?.trim() || undefined;
}

function normalizeEnterpriseStatus(value: string | undefined): EnterpriseStatus | undefined {
  if (value === "active" || value === "configuring" || value === "offline") return value;
  return undefined;
}

export function buildEnterpriseListUrl(options: FetchEnterprisesOptions = {}) {
  return buildApiV1Url(enterprisesPath, {
    limit: options.limit,
    offset: options.offset,
  });
}

export function buildEnterpriseGetUrl(id: string) {
  return buildApiV1Url(enterprisesPath, { id });
}

export function normalizeEnterprisePayload(payload: BackendEnterprisePayload): ProtectedObjectOption {
  if (!isRecord(payload) || typeof payload.id !== "string" || !payload.id.trim() || typeof payload.name !== "string" || !payload.name.trim()) throw new FortisProtocolError();
  const id = cleanString(stringValue(payload, "id")) ?? crypto.randomUUID();
  const name = cleanString(stringValue(payload, "name")) ?? "Объект защиты";

  return {
    id,
    enterpriseId: id,
    name,
    center: {
      lat: numberValue(payload, "latitude") ?? 0,
      lng: numberValue(payload, "longitude") ?? 0,
    },
    address: cleanString(stringValue(payload, "address")),
    status: normalizeEnterpriseStatus(stringValue(payload, "status")),
    source: "backend",
  };
}

export async function fetchEnterprises(options: FetchEnterprisesOptions = {}) {
  const response = await getApiJson<BackendEnterpriseListResponse | BackendEnterprisePayload[]>(enterprisesPath, {
    query: {
      limit: options.limit,
      offset: options.offset,
    },
  });
  const items = requireListItems<Record<string, unknown>>(response);
  return items.map(normalizeEnterprisePayload);
}

export async function getEnterprise(id: string) {
  const response = await getApiJson<BackendEnterprisePayload>(enterprisesPath, {
    query: { id },
  });
  return normalizeEnterprisePayload(response);
}
