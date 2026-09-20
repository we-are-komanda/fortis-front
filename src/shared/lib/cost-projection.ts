import { readDataProvenance } from "./data-provenance";
import type { DefenseAsset, DefenseProject, PlacedDefenseObject } from "@/shared/types/defense-project";
import type { CostGroup, DataProvenance, DraftCostProjection, FinancialLine, Issue } from "@/shared/types/finance";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const MAX_UNIT_MINOR = BigInt("1000000000000000");
const rubleFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export type CostInputIssue = { code: string; field: string; objectIds: string[]; message: string };
export class CostProjectionInputError extends Error {
  constructor(readonly issues: CostInputIssue[]) {
    super("Invalid cost inputs");
    this.name = "CostProjectionInputError";
  }
}

function fail(code: string, field: string, objectIds: string[], message: string): never {
  throw new CostProjectionInputError([{ code, field, objectIds, message }]);
}

function validateQuantity(quantity: number, field: string, objectIds: string[]) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
    fail("invalid_quantity", field, objectIds, "Quantity must be an integer from 1 to 1000000");
  }
}

function unitMinor(value: unknown, field: string, objectIds: string[]): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    fail("invalid_price", field, objectIds, "Price must be a non-negative decimal integer string");
  }
  const normalized = value.replace(/^0+/, "") || "0";
  if (normalized.length > 16) fail("invalid_price", field, objectIds, "Unit price exceeds 1000000000000000 minor units");
  const result = BigInt(normalized);
  if (result > MAX_UNIT_MINOR) fail("invalid_price", field, objectIds, "Unit price exceeds 1000000000000000 minor units");
  return result;
}

function legacyPrice(value: string | number, field: string, objectIds: string[]) {
  if (typeof value !== "string" && typeof value !== "number") {
    fail("invalid_price", field, objectIds, "Legacy price must be a non-negative finite decimal");
  }
  const text = String(value);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || (typeof value === "number" && !Number.isFinite(value))) {
    fail("invalid_price", field, objectIds, "Legacy price must be a non-negative finite decimal");
  }
  const fraction = match[2] ?? "";
  const digits = (match[1] + fraction).replace(/^0+/, "") || "0";
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent)) fail("invalid_price", field, objectIds, "Legacy price exponent is invalid");
  const shift = exponent + 8 - fraction.length;
  let minor = ZERO;
  let rounded = false;
  if (digits !== "0") {
    if (shift >= 0) {
      if (digits.length + shift > 16) fail("invalid_price", field, objectIds, "Unit price exceeds 1000000000000000 minor units");
      minor = BigInt(digits) * BigInt(10) ** BigInt(shift);
    } else {
      const cut = digits.length + shift;
      if (cut > 16) fail("invalid_price", field, objectIds, "Unit price exceeds 1000000000000000 minor units");
      minor = BigInt(cut > 0 ? digits.slice(0, cut) : "0");
      if (cut >= 0 && digits[cut] >= "5") minor += ONE;
      rounded = /[1-9]/.test(digits.slice(Math.max(0, cut)));
    }
  }
  if (minor > MAX_UNIT_MINOR) fail("invalid_price", field, objectIds, "Unit price exceeds 1000000000000000 minor units");
  return { minor, rounded };
}

/** Convert the available decimal spelling once; multiplication and aggregation use minor units. */
export function legacyMlnToMinor(value: string | number): string {
  return legacyPrice(value, "pricePerUnitMln", []).minor.toString();
}

export function formatMinorRub(minor: string | null): string {
  if (minor === null) return "Итог неполный";
  if (!/^\d+$/.test(minor)) fail("invalid_price", "minor", [], "Amount must be a non-negative decimal integer string");
  const amount = BigInt(minor);
  return `${rubleFormatter.format(amount / BigInt(100))},${(amount % BigInt(100)).toString().padStart(2, "0")} ₽`;
}

type SelectedPrice = { minor: bigint | null; source: FinancialLine["priceSource"]; provenance: DataProvenance | null };

export function getAssetUnitPriceMinor(asset: DefenseAsset): string | null {
  return selectPrice(asset, { id: asset.id }, []).minor?.toString() ?? null;
}

function selectPrice(asset: DefenseAsset | undefined, object: Pick<PlacedDefenseObject, "id" | "customPriceMinor" | "customPricePerUnitMln" | "fieldProvenance">, warnings: Issue[]): SelectedPrice {
  const objectIds = [object.id];
  const warning = (code: string, message: string) => warnings.push({ code, severity: "warning", objectIds, message });
  const fromLegacy = (value: number | null | undefined, field: string) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number") fail("invalid_price", field, objectIds, "Legacy price field must be a number");
    const converted = legacyPrice(value, field, objectIds);
    warning("legacy_price_converted", "Legacy numeric price converted from its available decimal representation");
    if (converted.rounded) warning("legacy_price_rounded", "Legacy unit price rounded half-up to one minor unit");
    return converted.minor;
  };
  if (asset && asset.currency !== "RUB") fail("invalid_currency", `assetLibrary.${asset.id}.currency`, objectIds, "Only RUB is supported");

  if (object.customPriceMinor !== undefined) {
    return { minor: unitMinor(object.customPriceMinor, `placedObjects.${object.id}.customPriceMinor`, objectIds), source: "instance_override", provenance: object.fieldProvenance?.customPriceMinor ?? null };
  }
  if (object.customPricePerUnitMln !== undefined) {
    return { minor: fromLegacy(object.customPricePerUnitMln, `placedObjects.${object.id}.customPricePerUnitMln`), source: "instance_override", provenance: object.fieldProvenance?.customPricePerUnitMln ?? null };
  }
  if (!asset) return { minor: null, source: "unknown", provenance: null };
  if (asset.pricingMode !== undefined && asset.pricingMode !== "bundle" && asset.pricingMode !== "components") {
    fail("invalid_pricing_mode", `assetLibrary.${asset.id}.pricingMode`, objectIds, "Pricing mode must be bundle or components");
  }
  if (asset.pricingMode === "components") {
    if (asset.components == null || (Array.isArray(asset.components) && asset.components.length === 0)) {
      warning("missing_components", "Explicit component pricing has no priced components");
      return { minor: null, source: "unknown", provenance: asset.fieldProvenance?.components ?? asset.provenance ?? null };
    }
    if (!Array.isArray(asset.components)) fail("invalid_price", `assetLibrary.${asset.id}.components`, objectIds, "Components must be an array");
    let sum = ZERO;
    let complete = true;
    asset.components.forEach((component, index) => {
      const field = `assetLibrary.${asset.id}.components.${index}`;
      if (!component || typeof component !== "object") fail("invalid_price", field, objectIds, "Component must be an object");
      validateQuantity(component.quantity, `${field}.quantity`, objectIds);
      const price = unitMinor(component.unitPriceMinor, `${field}.unitPriceMinor`, objectIds);
      if (price === null) complete = false;
      else sum += price * BigInt(component.quantity);
    });
    if (sum > MAX_UNIT_MINOR) fail("invalid_price", `assetLibrary.${asset.id}.components`, objectIds, "Component unit price exceeds 1000000000000000 minor units");
    return { minor: complete ? sum : null, source: "components", provenance: asset.fieldProvenance?.components ?? asset.provenance ?? null };
  }
  const canonical = asset.unitPriceMinor !== undefined;
  return {
    minor: canonical ? unitMinor(asset.unitPriceMinor, `assetLibrary.${asset.id}.unitPriceMinor`, objectIds) : fromLegacy(asset.pricePerUnitMln, `assetLibrary.${asset.id}.pricePerUnitMln`),
    source: "template",
    provenance: asset.fieldProvenance?.[canonical ? "unitPriceMinor" : "pricePerUnitMln"] ?? asset.provenance ?? null,
  };
}

function addToGroup(groups: Map<string, CostGroup>, id: string, name: string, line: FinancialLine) {
  let group = groups.get(id);
  if (!group) {
    group = { id, name, objectCount: 0, unitCount: 0, knownSubtotalMinor: "0", totalMinor: "0" };
    groups.set(id, group);
  }
  group.objectCount += 1;
  group.unitCount += line.quantity;
  if (line.lineTotalMinor === null) group.totalMinor = null;
  else {
    group.knownSubtotalMinor = (BigInt(group.knownSubtotalMinor) + BigInt(line.lineTotalMinor)).toString();
    if (group.totalMinor !== null) group.totalMinor = group.knownSubtotalMinor;
  }
}

export function buildDraftCostProjection(project: DefenseProject): DraftCostProjection {
  const assets = new Map(project.assetLibrary.map((asset) => [asset.id, asset]));
  const layers = new Map(project.layers.map((layer) => [layer.id, layer]));
  const byLayer = new Map<string, CostGroup>();
  const byType = new Map<string, CostGroup>();
  const warnings: Issue[] = [];
  const unknownPriceObjectIds: string[] = [];
  let knownSubtotal = ZERO;
  const lines = project.placedObjects.map((object): FinancialLine => {
    validateQuantity(object.quantity, `placedObjects.${object.id}.quantity`, [object.id]);
    const asset = assets.get(object.assetId);
    const layer = layers.get(object.layerId);
    if (!asset) warnings.push({ code: "missing_asset", severity: "warning", objectIds: [object.id], message: "Placed object template is missing" });
    if (!layer) warnings.push({ code: "missing_layer", severity: "warning", objectIds: [object.id], message: "Placed object layer is missing" });
    const selected = selectPrice(asset, object, warnings);
    try { selected.provenance = readDataProvenance(selected.provenance); }
    catch {
      fail("invalid_provenance", selected.source === "instance_override"
        ? `placedObjects.${object.id}.fieldProvenance` : `assetLibrary.${object.assetId}.provenance`,
      [object.id], "Price source metadata is invalid");
    }
    const total = selected.minor === null ? null : selected.minor * BigInt(object.quantity);
    if (total === null) {
      unknownPriceObjectIds.push(object.id);
      warnings.push({ code: "missing_price", severity: "warning", objectIds: [object.id], message: "Placed object price is unknown" });
    } else knownSubtotal += total;
    const line: FinancialLine = {
      objectId: object.id, assetId: object.assetId, layerId: object.layerId,
      category: asset?.category || "unknown", name: object.name || asset?.name || object.assetId,
      quantity: object.quantity, unitPriceMinor: selected.minor?.toString() ?? null, lineTotalMinor: total?.toString() ?? null,
      priceSource: selected.minor === null ? "unknown" : selected.source,
      provenance: selected.provenance ? { ...selected.provenance } : null,
    };
    addToGroup(byLayer, object.layerId, layer?.name ?? object.layerId, line);
    addToGroup(byType, line.category, line.category, line);
    return line;
  });
  const isComplete = unknownPriceObjectIds.length === 0;
  return {
    kind: "draft",
    basedOn: project.source === "backend" && Number.isSafeInteger(project.version) && project.version! > 0
      ? { projectId: project.projectId, projectVersion: project.version! } : null,
    currency: "RUB", lines, byLayer: [...byLayer.values()], byType: [...byType.values()],
    knownSubtotalMinor: knownSubtotal.toString(), totalMinor: isComplete ? knownSubtotal.toString() : null,
    isComplete, unknownPriceObjectIds, warnings,
  };
}
