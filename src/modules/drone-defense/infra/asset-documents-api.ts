import { buildApiV1Url, deleteApiJson, FortisApiError, FortisProtocolError, getApiJson, isRecord, readJson } from "@/shared/lib/api-client";
import { sessionGeneration } from "@/shared/lib/session-state";

export type AssetDocument = {
  id: string;
  assetId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  revision: string;
  checksum: string | null;
  status: "legacy_unavailable" | "quarantined" | "ready" | "rejected";
  commercial: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CreateAssetDocumentInput = { assetId: string; file: File; commercial?: boolean };
export type AssetDocumentPage = { items: AssetDocument[]; totalItems: number };
const documentsPath = "/assets/documents";
const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
const maxBytes = 10 * 1024 * 1024;

export function validateAssetDocumentFile(file: File): string | null {
  if (file.size > maxBytes) return "Размер файла не должен превышать 10 МиБ.";
  if (file.size === 0) return "Нельзя загрузить пустой файл.";
  if (!allowedTypes.has(file.type)) return "Выберите файл PDF, PNG, JPEG или TXT.";
  return null;
}

function readDocument(value: unknown, assetId: string): AssetDocument {
  if (!isRecord(value) || ["id", "assetId", "name", "mimeType", "revision", "createdAt", "updatedAt"].some(key => typeof value[key] !== "string" || !value[key]) ||
    value.assetId !== assetId || typeof value.commercial !== "boolean" ||
    !Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes as number) < 0 ||
    !["legacy_unavailable", "quarantined", "ready", "rejected"].includes(value.status as string) ||
    !(value.checksum === null || (typeof value.checksum === "string" && /^[a-f0-9]{64}$/.test(value.checksum))) ||
    (value.status === "ready" && (!value.checksum || !allowedTypes.has(value.mimeType as string)))) throw new FortisProtocolError();
  // Do not carry storage keys or server-provided URLs across the boundary.
  return { id: value.id, assetId: value.assetId, name: value.name, mimeType: value.mimeType, sizeBytes: value.sizeBytes, revision: value.revision, checksum: value.checksum, status: value.status, commercial: value.commercial, createdAt: value.createdAt, updatedAt: value.updatedAt } as AssetDocument;
}

export function buildAssetDocumentsListUrl(assetId: string) {
  return buildApiV1Url(`${documentsPath}/list`, { assetId });
}
export function buildAssetDocumentDownloadUrl(id: string, assetId?: string) {
  return buildApiV1Url(`${documentsPath}/download`, { id, assetId });
}
export async function listAssetDocuments(assetId: string, options: { offset?: number; signal?: AbortSignal } = {}): Promise<AssetDocumentPage> {
  const value = await getApiJson<unknown>(`${documentsPath}/list`, { query: { assetId, limit: 50, offset: options.offset ?? 0 }, signal: options.signal, cache: "no-store" });
  if (!isRecord(value) || !Array.isArray(value.items) || !Number.isSafeInteger(value.totalItems) || (value.totalItems as number) < value.items.length) throw new FortisProtocolError();
  return { items: value.items.map(item => readDocument(item, assetId)), totalItems: value.totalItems as number };
}
export async function createAssetDocument(input: CreateAssetDocumentInput, signal?: AbortSignal): Promise<AssetDocument> {
  const error = validateAssetDocumentFile(input.file);
  if (error) throw new Error(error);
  const body = new FormData();
  body.append("assetId", input.assetId);
  body.append("file", input.file);
  body.append("commercial", String(input.commercial ?? true));
  return readDocument(await readJson<unknown>(buildApiV1Url(documentsPath), { method: "POST", body, signal, credentials: "same-origin" }), input.assetId);
}
export async function downloadAssetDocument(document: AssetDocument, signal?: AbortSignal): Promise<Blob> {
  if (document.status !== "ready") throw new Error("Документ недоступен для скачивания.");
  const generation = sessionGeneration();
  const url = buildAssetDocumentDownloadUrl(document.id, document.assetId);
  let response: Response;
  try { response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store", signal }); }
  catch (error) { if (signal?.aborted) throw error; throw new FortisApiError(new Response(null, { status: 502 })); }
  if (generation !== sessionGeneration()) throw new DOMException("Identity changed", "AbortError");
  // Reuse the authenticated error boundary, but never decode file bytes as JSON.
  if (!response.ok) await readJson(url, { fetcher: async () => response, signal });
  const blob = await response.blob();
  if (generation !== sessionGeneration()) throw new DOMException("Identity changed", "AbortError");
  const mimeType = blob.type.split(";", 1)[0].trim().toLowerCase();
  if (!allowedTypes.has(mimeType) || mimeType !== document.mimeType || blob.size !== document.sizeBytes || blob.size > maxBytes) throw new FortisProtocolError(response.headers.get("x-request-id") ?? undefined);
  return blob;
}
export async function deleteAssetDocument(id: string, signal?: AbortSignal) {
  const value = await deleteApiJson<unknown>(`${documentsPath}/delete`, { query: { id }, signal });
  if (!isRecord(value) || value.status !== "ok") throw new FortisProtocolError();
}
