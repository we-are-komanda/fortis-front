import { getAssetUnitPriceMinor, legacyMlnToMinor } from "@/shared/lib/cost-projection";
import type { DataProvenance } from "@/shared/types/finance";
import type { DefenseAsset, DefenseAssetCategory, DefenseAssetCoverageType } from "@/shared/types/defense-project";
import type { DefenseAssetMutationInput } from "../infra/asset-library-api";

export type AssetFormState = {
  original?: DefenseAsset;
  sourceQuality: "unknown" | DataProvenance["quality"];
  sourceLabel: string;
  sourceDate: string;
  sourceUrl: string;
  sourceDocumentId: string | null;
  id?: string;
  name: string;
  category: DefenseAssetCategory;
  protectionType: string;
  recommendedLayerCodes: string;
  pricePerUnitMln: string;
  priceError?: string;
  maxEffectiveDistanceKm: string;
  coverageRadiusKm: string;
  coverageType: DefenseAssetCoverageType;
  coverageAngle: string;
  description: string;
  isPublic: boolean;
  enterpriseId: string;
};


export function emptyForm(enterpriseId = ""): AssetFormState {
  return {
    sourceQuality: "unknown", sourceLabel: "", sourceDate: "", sourceUrl: "", sourceDocumentId: null,
    name: "",
    category: "detection",
    protectionType: "",
    recommendedLayerCodes: "L2",
    pricePerUnitMln: "",
    maxEffectiveDistanceKm: "",
    coverageRadiusKm: "",
    coverageType: "circle",
    coverageAngle: "",
    description: "",
    isPublic: false,
    enterpriseId,
  };
}

function kmToMeters(value: string) {
  const numeric = value.trim() ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric * 1000 : undefined;
}

function optionalNumber(value: string) {
  const numeric = value.trim() ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

export function formFromAsset(asset: DefenseAsset): AssetFormState {
  const provenance = asset.fieldProvenance?.unitPriceMinor ?? asset.fieldProvenance?.pricePerUnitMln ?? asset.provenance;
  let exactPrice = asset.unitPriceMinor == null ? "" : String(asset.unitPriceMinor);
  let priceError: string | undefined;
  try {
    const minor = getAssetUnitPriceMinor({...asset, pricingMode: "bundle"});
    if (asset.unitPriceMinor != null && minor !== null) exactPrice = `${BigInt(minor) / BigInt(100000000)}.${(BigInt(minor) % BigInt(100000000)).toString().padStart(8,"0")}`;
  } catch {
    priceError = "Некорректная цена. Укажите цену заново.";
  }
  return {
    original: asset,
    sourceQuality: provenance?.quality ?? "unknown",
    sourceLabel: provenance?.sourceLabel ?? "",
    sourceDate: provenance?.sourceDate ?? "",
    sourceUrl: provenance?.sourceUrl ?? "",
    sourceDocumentId: provenance?.sourceDocumentId ?? null,
    id: asset.id,
    name: asset.name,
    category: asset.category,
    protectionType: asset.protectionType ?? "",
    recommendedLayerCodes: asset.recommendedLayerCodes?.join(", ") ?? "",
    pricePerUnitMln: asset.unitPriceMinor !== undefined ? exactPrice : asset.pricePerUnitMln === null ? "" : String(asset.pricePerUnitMln),
    priceError,
    maxEffectiveDistanceKm: asset.maxEffectiveDistance !== undefined ? String(asset.maxEffectiveDistance / 1000) : "",
    coverageRadiusKm: asset.coverageRadius !== undefined ? String(asset.coverageRadius / 1000) : "",
    coverageType: asset.coverageType,
    coverageAngle: asset.coverageAngle !== undefined ? String(asset.coverageAngle) : "",
    description: asset.description ?? "",
    isPublic: asset.isPublic ?? true,
    enterpriseId: asset.enterpriseId ?? "",
  };
}

function rolesForCategory(category: DefenseAssetCategory): DefenseAsset["roles"] {
  switch (category) {
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
      return ["protect"];
    case "command-center":
      return ["coordinate"];
    case "early-warning":
      return ["alert", "monitor"];
    default:
      return ["monitor"];
  }
}

function placementTypeForCoverage(coverageType: DefenseAssetCoverageType): DefenseAsset["placementType"] {
  if (coverageType === "polygon" || coverageType === "line") return "zone-object";
  if (coverageType === "none") return "non-physical";
  return "map-object";
}

export function formToAssetInput(form: AssetFormState): DefenseAssetMutationInput {
  if (form.priceError) throw new Error(form.priceError);
  const unitPriceMinor = form.pricePerUnitMln.trim() ? legacyMlnToMinor(form.pricePerUnitMln.replace(",", ".")) : null;
  if (form.sourceQuality === "confirmed" && (!form.sourceDate || !(form.sourceLabel.trim() || form.sourceUrl.trim() || form.sourceDocumentId))) throw new Error("Для подтверждения укажите источник и его дату.");
  if (form.sourceUrl) {
    try { const url = new URL(form.sourceUrl); if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { throw new Error("Укажите ссылку на источник с http или https."); }
  }
  const provenance: DataProvenance | null = form.sourceQuality === "unknown" ? null : {
    sourceLabel:form.sourceLabel.trim(),sourceDocumentId:form.sourceDocumentId,sourceDate:form.sourceDate||null,sourceUrl:form.sourceUrl.trim()||null,
    recordedAt:"",recordedBy:"",revision:"",quality:form.original?.provenance?.quality === "demo" ? "demo" : form.sourceQuality,
  };
  const originalForm = form.original ? formFromAsset(form.original) : null;
  const sourceChanged = !originalForm || (["sourceQuality", "sourceLabel", "sourceDate", "sourceUrl", "sourceDocumentId"] as const)
    .some(field => form[field] !== originalForm[field]);
  const fieldProvenance = {...form.original?.fieldProvenance};
  if (sourceChanged) {
    delete fieldProvenance.pricePerUnitMln;
    if (provenance) fieldProvenance.unitPriceMinor = provenance;
    else delete fieldProvenance.unitPriceMinor;
  }
  const coverageRadius = kmToMeters(form.coverageRadiusKm);
  const maxEffectiveDistance = kmToMeters(form.maxEffectiveDistanceKm) ?? coverageRadius;
  const recommendedLayerCodes = form.recommendedLayerCodes
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  return {
    ...form.original,
    id: form.id,
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    category: form.category,
    roles: form.original?.category === form.category ? form.original.roles : rolesForCategory(form.category),
    protectionType: form.protectionType.trim() || undefined,
    pricePerUnitMln: unitPriceMinor === null ? null : Number(unitPriceMinor)/100000000,
    unitPriceMinor,
    provenance: sourceChanged ? provenance : form.original?.provenance ?? null,
    fieldProvenance,
    currency: "RUB",
    unitLabel: form.original?.unitLabel ?? "шт",
    recommendedLayerCodes,
    compatibleLayerCodes: form.original?.compatibleLayerCodes ?? recommendedLayerCodes,
    maxEffectiveDistance,
    coverageType: form.coverageType,
    coverageRadius,
    coverageAngle: optionalNumber(form.coverageAngle),
    deploymentType: form.original?.deploymentType ?? (form.coverageType === "none" ? "external" : "static"),
    placementType: form.original?.placementType ?? placementTypeForCoverage(form.coverageType),
    tags: form.original?.tags ?? recommendedLayerCodes,
    mapCatalogGroupIds: form.original?.mapCatalogGroupIds ?? [],
    isPublic: form.isPublic,
    enterpriseId: form.isPublic ? null : form.enterpriseId.trim() || null,
  };
}
