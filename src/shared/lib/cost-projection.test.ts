import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../../../test/fixtures/finance-v1.json";
import { buildDraftCostProjection, CostProjectionInputError, formatMinorRub, getAssetUnitPriceMinor, legacyMlnToMinor } from "./cost-projection";
import type { DefenseAsset, DefenseProject, PlacedDefenseObject } from "@/shared/types/defense-project";
import type { DataProvenance } from "@/shared/types/finance";

function project(variant: "variantA" | "variantB" = "variantA"): DefenseProject {
  const input = fixture[variant];
  return {
    schemaVersion: 1, projectId: input.projectId, projectName: "Synthetic accounting", version: input.projectVersion,
    source: "backend", mode: "view", updatedAt: "2026-09-20T00:00:00Z",
    baseObject: { id: "base", name: "Synthetic site", center: { lat: 0, lng: 0 } },
    layers: fixture.layers.map((layer, order) => ({ ...layer, code: `CUSTOM-${order}`, order, geometryType: "circle", geometry: { type: "circle", center: { lat: 0, lng: 0 } }, isActive: true })),
    assetLibrary: fixture.assets.map((asset): DefenseAsset => ({ ...asset, pricePerUnitMln: null, currency: "RUB", category: "infrastructure", roles: [], unitLabel: "unit", coverageType: "none", deploymentType: "static", placementType: "map-object" })),
    placedObjects: input.objects.map((object): PlacedDefenseObject => ({ ...object, coordinates: { lat: 0, lng: 0 }, status: "planned", createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" })),
  };
}

function oneObject(): DefenseProject {
  const value = project();
  value.placedObjects = [value.placedObjects[0]];
  return value;
}

function invalid(run: () => unknown, code: string, field: string) {
  assert.throws(run, (error) => error instanceof CostProjectionInputError && error.issues.some((issue) => issue.code === code && issue.field === field));
}

for (const variant of ["variantA", "variantB"] as const) {
  test(`finance-v1 ${variant}: exact placed rows, real layer IDs and reconciled groups`, () => {
    const result = buildDraftCostProjection(project(variant));
    assert.equal(result.totalMinor, fixture[variant].expectedTotalMinor);
    assert.equal(result.knownSubtotalMinor, result.totalMinor);
    assert.equal(result.isComplete, true);
    assert.deepEqual(Object.fromEntries(result.byLayer.map((group) => [group.id, group.totalMinor])), fixture[variant].expectedByLayer);
    assert.equal(result.lines.length, 3);
    assert.equal(result.lines.reduce((sum, line) => sum + BigInt(line.lineTotalMinor!), BigInt(0)).toString(), result.totalMinor);
    assert.equal(result.byType.reduce((sum, group) => sum + BigInt(group.totalMinor!), BigInt(0)).toString(), result.totalMinor);
    assert.deepEqual(result.lines.map((line) => line.priceSource), ["template", "template", "instance_override"]);
    assert.equal(result.byLayer.reduce((sum, group) => sum + group.objectCount, 0), 3);
    assert.equal(result.byLayer.reduce((sum, group) => sum + group.unitCount, 0), 6);
  });
}

test("hidden/inactive/maintenance objects and hidden layers remain in the estimate", () => {
  const value = project();
  value.layers.forEach((layer) => { layer.isVisible = false; layer.isActive = false; });
  value.placedObjects.forEach((object, index) => { object.isVisibleOnMap = false; object.status = index % 2 ? "inactive" : "maintenance"; });
  assert.equal(buildDraftCostProjection(value).totalMinor, fixture.variantA.expectedTotalMinor);
});

test("custom layer rename preserves grouping and a missing layer never drops a line", () => {
  const value = project();
  value.layers[0].name = "Renamed custom layer";
  assert.equal(buildDraftCostProjection(value).byLayer[0].name, "Renamed custom layer");
  value.layers = value.layers.slice(1);
  const result = buildDraftCostProjection(value);
  assert.equal(result.totalMinor, fixture.variantA.expectedTotalMinor);
  assert.deepEqual(result.byLayer.map((group) => group.id), ["layer-custom-a", "layer-custom-b"]);
  assert.equal(result.byLayer[0].name, "layer-custom-a");
  assert.ok(result.warnings.some((issue) => issue.code === "missing_layer" && issue.objectIds.includes("obj-1")));
});

test("explicit zero override wins; explicit null override is unknown and blocks all fallbacks", () => {
  const value = oneObject();
  value.placedObjects[0].customPriceMinor = "0";
  value.placedObjects[0].customPricePerUnitMln = 9;
  assert.equal(buildDraftCostProjection(value).totalMinor, "0");
  value.placedObjects[0].customPriceMinor = null;
  const result = buildDraftCostProjection(value);
  assert.equal(result.totalMinor, null);
  assert.equal(result.lines[0].priceSource, "unknown");
  assert.equal(result.knownSubtotalMinor, "0");
});

test("components mode counts the explicit financial components once and ignores bundle price", () => {
  const value = oneObject();
  Object.assign(value.assetLibrary[0], { pricingMode: "components", components: fixture.compound.components, unitPriceMinor: fixture.compound.ignoredBundlePriceMinor });
  value.placedObjects[0].quantity = fixture.compound.quantity;
  let result = buildDraftCostProjection(value);
  assert.equal(result.lines[0].unitPriceMinor, fixture.compound.expectedUnitMinor);
  assert.equal(result.totalMinor, fixture.compound.expectedTotalMinor);
  assert.equal(result.lines[0].priceSource, "components");
  value.placedObjects[0].customPriceMinor = "1";
  assert.equal(buildDraftCostProjection(value).totalMinor, "2");
  delete value.placedObjects[0].customPriceMinor;
  value.assetLibrary[0].pricingMode = "bundle";
  result = buildDraftCostProjection(value);
  assert.equal(result.totalMinor, "18000000");
  assert.equal(result.lines[0].priceSource, "template");
});

test("catalogue unit prices reuse canonical bundle/components/unknown/legacy selection", () => {
  const asset = project().assetLibrary[0];
  assert.equal(getAssetUnitPriceMinor(asset), "12500000");
  asset.unitPriceMinor = null;
  asset.pricePerUnitMln = 99;
  assert.equal(getAssetUnitPriceMinor(asset), null);
  asset.unitPriceMinor = "0";
  assert.equal(getAssetUnitPriceMinor(asset), "0");
  asset.pricingMode = "components";
  asset.components = fixture.compound.components;
  assert.equal(getAssetUnitPriceMinor(asset), fixture.compound.expectedUnitMinor);
  asset.pricingMode = "bundle";
  delete asset.unitPriceMinor;
  asset.pricePerUnitMln = 0.000000005;
  assert.equal(getAssetUnitPriceMinor(asset), "1");
});

test("empty, absent or unknown components cannot imply a free bundle; explicit zero can", () => {
  const value = oneObject();
  value.assetLibrary[0].pricingMode = "components";
  for (const components of [undefined, []]) {
    value.assetLibrary[0].components = components;
    const result = buildDraftCostProjection(value);
    assert.equal(result.totalMinor, null);
    assert.ok(result.warnings.some((issue) => issue.code === "missing_components"));
  }
  value.assetLibrary[0].components = [{ name: "unknown", quantity: 1, unitPriceMinor: null }, { name: "known", quantity: 1, unitPriceMinor: "10" }];
  assert.equal(buildDraftCostProjection(value).knownSubtotalMinor, "0", "subtotal includes known lines, not a fraction of an unknown bundle");
  value.assetLibrary[0].components = [{ name: "free", quantity: 1, unitPriceMinor: "0" }];
  assert.equal(buildDraftCostProjection(value).totalMinor, "0");
});

test("unknown template or missing asset retains rows and the known subtotal", () => {
  const value = project();
  value.assetLibrary[1].unitPriceMinor = null;
  value.assetLibrary[1].pricePerUnitMln = 99;
  let result = buildDraftCostProjection(value);
  assert.equal(result.totalMinor, null);
  assert.equal(result.isComplete, false);
  assert.equal(result.knownSubtotalMinor, "32500000");
  assert.deepEqual(result.unknownPriceObjectIds, ["obj-2"]);
  assert.equal(result.byLayer[1].totalMinor, null);
  assert.equal(result.byLayer[1].knownSubtotalMinor, "7500000");
  value.assetLibrary = value.assetLibrary.slice(0, 1);
  result = buildDraftCostProjection(value);
  assert.equal(result.lines[1].category, "unknown");
  assert.equal(result.lines[1].name, "asset-b");
  assert.ok(result.warnings.some((issue) => issue.code === "missing_asset"));
});

test("a missing template retains an explicit RUB override and warns about the missing reference", () => {
  const value = oneObject();
  value.assetLibrary = [];
  value.placedObjects[0].customPriceMinor = "00025";
  const result = buildDraftCostProjection(value);
  assert.equal(result.totalMinor, "50");
  assert.equal(result.lines[0].unitPriceMinor, "25");
  assert.equal(result.lines[0].priceSource, "instance_override");
  assert.deepEqual(result.warnings.map((issue) => issue.code), ["missing_asset"]);
});

test("empty placedObjects yields no financial rows or groups despite a populated catalogue", () => {
  const value = project();
  value.placedObjects = [];
  const result = buildDraftCostProjection(value);
  assert.equal(result.totalMinor, "0");
  assert.equal(result.isComplete, true);
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.byLayer, []);
  assert.deepEqual(result.byType, []);
  assert.deepEqual(result.warnings, []);
});

test("legacy decimal conversion is exact half-up per unit and warns only on the selected legacy path", () => {
  for (const input of fixture.boundaryTests.filter((item) => "priceMlnText" in item)) {
    assert.equal(legacyMlnToMinor(input.priceMlnText!), input.expectedUnitMinor);
  }
  assert.equal(legacyMlnToMinor("4.999999999999999999999e-9"), "0");
  assert.equal(legacyMlnToMinor("5e-9"), "1");
  assert.equal(legacyMlnToMinor("1.000000000"), "100000000");
  const value = oneObject();
  delete value.assetLibrary[0].unitPriceMinor;
  value.assetLibrary[0].pricePerUnitMln = 0.000000005;
  const result = buildDraftCostProjection(value);
  assert.equal(result.totalMinor, "2", "round unit once, then multiply by quantity");
  assert.deepEqual(result.warnings.map((issue) => issue.code), ["legacy_price_converted", "legacy_price_rounded"]);
  value.assetLibrary[0].unitPriceMinor = "10";
  value.assetLibrary[0].pricePerUnitMln = Number.NaN;
  assert.equal(buildDraftCostProjection(value).totalMinor, "20");
  assert.deepEqual(buildDraftCostProjection(value).warnings, []);
});

test("large sums and formatting retain every kopeck beyond Number.MAX_SAFE_INTEGER", () => {
  const value = oneObject();
  value.assetLibrary[0].unitPriceMinor = "1000000000000000";
  value.placedObjects[0].quantity = 1_000_000;
  assert.equal(buildDraftCostProjection(value).totalMinor, "1000000000000000000000");
  assert.equal(formatMinorRub("900719925474099301").replace(/[\s\u00a0\u202f]/g, ""), "9007199254740993,01₽");
  assert.equal(formatMinorRub("0").replace(/[\s\u00a0\u202f]/g, ""), "0,00₽");
  assert.equal(formatMinorRub(null), "Итог неполный");
});

test("invalid placement/component quantities fail with field feedback instead of rounding", () => {
  for (const quantity of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001]) {
    const value = oneObject();
    value.placedObjects[0].quantity = quantity;
    invalid(() => buildDraftCostProjection(value), "invalid_quantity", "placedObjects.obj-1.quantity");
    value.placedObjects[0].quantity = 1;
    Object.assign(value.assetLibrary[0], { pricingMode: "components", components: [{ name: "part", quantity, unitPriceMinor: "1" }] });
    invalid(() => buildDraftCostProjection(value), "invalid_quantity", "assetLibrary.asset-a.components.0.quantity");
  }
});

test("invalid selected prices, component unit overflow, currency and mode fail closed", () => {
  for (const price of ["-1", "1.5", "NaN", "1e3", "", " 1", "1000000000000001", 1]) {
    const value = oneObject();
    value.assetLibrary[0].unitPriceMinor = price as string;
    invalid(() => buildDraftCostProjection(value), "invalid_price", "assetLibrary.asset-a.unitPriceMinor");
  }
  const value = oneObject();
  Object.assign(value.assetLibrary[0], { pricingMode: "components", components: [{ name: "part", quantity: 2, unitPriceMinor: "1000000000000000" }] });
  invalid(() => buildDraftCostProjection(value), "invalid_price", "assetLibrary.asset-a.components");
  value.assetLibrary[0].currency = "USD" as "RUB";
  value.placedObjects[0].customPriceMinor = "0";
  invalid(() => buildDraftCostProjection(value), "invalid_currency", "assetLibrary.asset-a.currency");
  value.assetLibrary[0].currency = "RUB";
  delete value.placedObjects[0].customPriceMinor;
  value.assetLibrary[0].pricingMode = "invalid" as "bundle";
  invalid(() => buildDraftCostProjection(value), "invalid_pricing_mode", "assetLibrary.asset-a.pricingMode");
  for (const input of ["-0.1", "NaN", "Infinity", "1e100000", "10000000.00000001", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => legacyMlnToMinor(input), CostProjectionInputError);
  }
});

test("malformed legacy values cannot be coerced into prices", () => {
  const value = oneObject();
  delete value.assetLibrary[0].unitPriceMinor;
  for (const bad of [[1], "0.125"]) {
    value.assetLibrary[0].pricePerUnitMln = bad as unknown as number;
    invalid(() => buildDraftCostProjection(value), "invalid_price", "assetLibrary.asset-a.pricePerUnitMln");
  }
  assert.throws(() => legacyMlnToMinor([0] as unknown as number), CostProjectionInputError);
});

test("empty optional object names fall back to the template label", () => {
  const value = oneObject();
  value.placedObjects[0].name = "";
  assert.equal(buildDraftCostProjection(value).lines[0].name, value.assetLibrary[0].name);
});

test("financial provenance follows the selected price and descriptive compound data creates no charge", () => {
  const value = oneObject();
  const provenance: DataProvenance = { sourceLabel: "Synthetic source", sourceDocumentId: null, sourceUrl: null, sourceDate: null, recordedAt: "2026-09-20T00:00:00Z", recordedBy: "fixture", quality: "estimated", revision: "1" };
  value.assetLibrary[0].provenance = provenance;
  assert.deepEqual(buildDraftCostProjection(value).lines[0].provenance, provenance);
  value.placedObjects[0].customPriceMinor = "1";
  assert.equal(buildDraftCostProjection(value).lines[0].provenance, null);
  value.placedObjects[0].fieldProvenance = { customPriceMinor: { ...provenance, revision: "override" } };
  assert.equal(buildDraftCostProjection(value).lines[0].provenance?.revision, "override");
  delete value.placedObjects[0].customPriceMinor;
  value.placedObjects[0].compoundProfile = { kind: "compound-post", postType: "synthetic", personnelCount: "99", accountability: "", armament: "", weaponUnits: "", sectorOrRange: "", azimuth: 0 };
  assert.equal(buildDraftCostProjection(value).totalMinor, "25000000");
  value.assetLibrary[0].pricingMode = "components";
  value.assetLibrary[0].components = [];
  assert.deepEqual(buildDraftCostProjection(value).lines[0].provenance, provenance, "An unknown component total retains its stated source");
});

test("projection is pure and draft identity never invents a server digest", () => {
  const value = project();
  const before = structuredClone(value);
  const first = buildDraftCostProjection(value);
  assert.deepEqual(value, before);
  assert.deepEqual(buildDraftCostProjection(value), first);
  assert.equal(first.kind, "draft");
  assert.deepEqual(first.basedOn, { projectId: fixture.variantA.projectId, projectVersion: fixture.variantA.projectVersion });
  assert.equal("identity" in first, false);
  value.source = "custom";
  assert.equal(buildDraftCostProjection(value).basedOn, null);
});

test("malformed draft source is an input issue tied to the affected object",()=>{
 const value=oneObject();
 value.assetLibrary[0].provenance={sourceLabel:{bad:"child"},quality:"estimated"} as unknown as DataProvenance;
 assert.throws(()=>buildDraftCostProjection(value),error=>error instanceof CostProjectionInputError && error.issues.some(issue=>issue.code==="invalid_provenance" && issue.objectIds[0]==="obj-1"));
 const source={sourceLabel:"Source",sourceDocumentId:null,sourceUrl:null,sourceDate:null,recordedAt:"2026-09-20T00:00:00Z",recordedBy:"fixture",quality:"estimated" as const,revision:"1"};
 value.assetLibrary[0].provenance=source;
 assert.deepEqual(buildDraftCostProjection(value).lines[0].provenance,source);
 value.placedObjects[0].customPriceMinor="0";
 value.placedObjects[0].fieldProvenance={customPriceMinor:{...source,sourceLabel:{bad:"override"}} as unknown as DataProvenance};
 assert.throws(()=>buildDraftCostProjection(value),error=>error instanceof CostProjectionInputError && error.issues.some(issue=>issue.code==="invalid_provenance" && issue.objectIds[0]==="obj-1"));
});
