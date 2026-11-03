import { defenseItems } from "@/shared/config/defense-catalog";
import { FortisProtocolError, isRecord } from "./api-client";
import type { DataProvenance } from "@/shared/types/finance";

export function readDataProvenance(value: unknown): DataProvenance | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !["confirmed","estimated","demo"].includes(String(value.quality)) ||
      ![value.sourceLabel,value.recordedAt,value.recordedBy,value.revision].every(field => typeof field === "string") ||
      ![value.sourceDocumentId,value.sourceUrl,value.sourceDate].every(field => field === null || typeof field === "string") ||
      ![value.sourceDocumentRevision,value.sourceDocumentChecksum].every(field => field === undefined || field === null || typeof field === "string")) throw new FortisProtocolError();
  if (value.sourceUrl) {
    try { const url = new URL(value.sourceUrl as string); if (!["http:","https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { throw new FortisProtocolError(); }
  }
  return value as DataProvenance;
}

export const dataQualityLabel = { confirmed: "Источник подтверждён пользователем", estimated: "Оценка", demo: "Демонстрационные данные" };
export function provenanceLabel(provenance: DataProvenance | null | undefined) {
  return provenance ? dataQualityLabel[provenance.quality] : "Источник не указан";
}

/** Known bundled identities keep demo lineage when copied into a customer catalog. */
export function preserveDemoAssetSources(asset: {
  id: string;
  legacyItemId?: string;
  provenance?: DataProvenance | null;
  fieldProvenance?: Record<string, DataProvenance>;
}): { provenance?: DataProvenance | null; fieldProvenance?: Record<string, DataProvenance> } {
  const isLegacyDemo = defenseItems.some(item => item.id === asset.id || item.id === asset.legacyItemId);
  if (!isLegacyDemo) return {
    ...("provenance" in asset ? { provenance: asset.provenance } : {}),
    ...("fieldProvenance" in asset ? { fieldProvenance: asset.fieldProvenance } : {}),
  };
  return {
    provenance: {...(asset.provenance ?? {
      sourceLabel: "Демонстрационный каталог Fortis",
      sourceDocumentId: null, sourceUrl: null, sourceDate: null,
      recordedAt: "2026-09-20T00:00:00Z", recordedBy: "bundled-demo",
      revision: "demo-catalog-v1",
    }), quality: "demo"},
    fieldProvenance: asset.fieldProvenance && Object.fromEntries(Object.entries(asset.fieldProvenance)
      .map(([field, source]) => [field, {...source, quality: "demo"}])),
  };
}
