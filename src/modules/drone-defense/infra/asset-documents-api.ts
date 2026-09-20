import { requireListItems, buildApiV1Url, deleteApiJson, getApiJson, postApiJson } from "@/shared/lib/api-client";

export type AssetDocument = {
  id: string;
  assetId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl?: string;
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAssetDocumentInput = {
  assetId: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageKey: string;
  downloadUrl?: string;
};

type AssetDocumentListResponse = {
  items?: AssetDocument[];
  totalItems?: number;
};

const documentsPath = "/assets/documents";

export function buildAssetDocumentsListUrl(assetId: string) {
  return buildApiV1Url(`${documentsPath}/list`, { assetId });
}

export function buildAssetDocumentDownloadUrl(id: string) {
  return buildApiV1Url(`${documentsPath}/download`, { id });
}

export async function listAssetDocuments(assetId: string) {
  const response = await getApiJson<AssetDocumentListResponse>(`${documentsPath}/list`, {
    query: { assetId },
  });
  return requireListItems<AssetDocument>(response);
}

export function createAssetDocument(input: CreateAssetDocumentInput) {
  return postApiJson<AssetDocument>(documentsPath, {
    body: {
      assetId: input.assetId,
      name: input.name,
      mimeType: input.mimeType ?? "application/octet-stream",
      sizeBytes: input.sizeBytes ?? 0,
      storageKey: input.storageKey,
      downloadUrl: input.downloadUrl,
    },
  });
}

export async function deleteAssetDocument(id: string) {
  await deleteApiJson<{ status: string }>(`${documentsPath}/delete`, {
    query: { id },
  });
}
