import { createLegacyDefenseProject as createDefaultDefenseProject } from "../../../test/fixtures/legacy-defense-project";
// Run: npx tsx src/shared/lib/defense-project.test.ts

import {
  calculateProjectTotalCost,
  calculateProjectTotalUnits,
  calculateLayerSummaries,
  calculateLayerConflicts,
  calculateProjectTotalObjects,
  calculateCostByLayer,
  canEditLayer,
  createRingLayer,
  createPlacedObject,
  deleteLayerFromProject,
  duplicatePlacedObjectInProject,
  exportDefenseProjectJson,
  importDefenseProjectJson,
  movePlacedObjectInProject,
  transferPlacedObjectToLayerInProject,
  placeObjectInProject,
  deletePlacedObjectInProject,
  updatePlacedObjectInProject,
  applyAssetQuantityDraftsToProject,
  getPlacedObjectConflictFlags,
  syncPlacedObjectConflictFlags,
  projectToCalculatorConfiguration,
  setAssetQuantityInProject,
  updateLayerOrder,
  updateLayerGeometryFromRadii,
  getLayerRadii,
  findLayerInsertOptions,
  getAssetCatalogItems,
  validateLayerDraft,
  validateLayerGeometry,
  validateObjectPlacement,
} from "@/shared/lib/defense-project";
import type { DefenseAsset } from "@/shared/types/defense-project";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const project = createDefaultDefenseProject();
const canonicalAssetContract: DefenseAsset = project.assetLibrary[0];
assert(canonicalAssetContract.id, "project.assetLibrary must expose canonical DefenseAsset items");
assert(project.layers.length === 9, "default project must keep L1-L9 as editable layers");
assert(project.assetLibrary.some((asset) => asset.id === "mobile-radar"), "asset library must include mobile-radar");
assert(project.assetLibrary.every((asset) => asset.coverageType), "canonical asset library must expose coverageType for every item");
assert(
  project.assetLibrary.every((asset) => asset.coverageType !== "none" || asset.coverageRadius === undefined),
  "non-physical canonical assets must not expose map coverage radius",
);
assert(project.placedObjects.length === 0, "default project starts without placed objects");
assert(project.layers.every((layer) => layer.geometry.type === "ring"), "default project layers must be editable rings");

const l2 = project.layers.find((layer) => layer.code === "L2");
assert(l2, "default project must include L2");
assert(l2.geometry.type === "ring" && l2.geometry.minRadiusM === 30000 && l2.geometry.maxRadiusM === 60000, "L2 must use configured inner and outer ring radii");

const l2CatalogItems = getAssetCatalogItems(project, "L2", project.placedObjects);
assert(l2CatalogItems.some((item) => item.assetId === "mobile-radar"), "shared asset catalog must include all defense assets");
assert(l2CatalogItems.some((item) => item.assetId === "laser"), "shared asset catalog must include assets from other echelons");
assert(
  l2CatalogItems.every((item) => item.canPlaceInActiveLayer),
  "shared asset catalog must allow every asset in the active layer",
);
assert(
  l2CatalogItems.every((item) => !item.compatibilityLabel),
  "shared asset catalog must not expose user-facing recommendation or compatibility labels",
);
assert(
  project.assetLibrary.find((asset) => asset.id === "mobile-radar")?.recommendedLayerCodes?.includes("L3"),
  "canonical asset library must support multi-layer recommendations",
);
assert(
  project.assetLibrary.find((asset) => asset.id === "mobile-radar")?.compatibleLayerCodes?.includes("L3"),
  "canonical asset library must expose compatible layer codes separately from legacy layerId",
);
const radarInL3 = getAssetCatalogItems(project, "L3", project.placedObjects).find((item) => item.assetId === "mobile-radar");
assert(
  !radarInL3?.compatibilityLabel && radarInL3?.canPlaceInActiveLayer,
  "active-layer catalog must allow formerly recommended assets without recommendation copy",
);
const ewOnL2 = l2CatalogItems.find((item) => item.assetId === "ew-narrowband");
assert(
  ewOnL2?.compatibilityStatus === "compatible" && ewOnL2.canPlaceInActiveLayer,
  "active-layer catalog must allow formerly warning-compatible assets",
);
const laserOnL2 = l2CatalogItems.find((item) => item.assetId === "laser");
assert(
  laserOnL2?.compatibilityStatus === "compatible" && laserOnL2.canPlaceInActiveLayer,
  "active-layer catalog must allow formerly incompatible assets",
);
assert(
  typeof radarInL3?.categoryLabel === "string" &&
    typeof radarInL3.rangeLabel === "string" &&
    typeof radarInL3.priceLabel === "string" &&
    typeof radarInL3.coverageLabel === "string",
  "catalog items must expose display metadata for category, range, price and coverage",
);
const aircraftCatalogItem = l2CatalogItems.find((item) => item.assetId === "aircraft");
assert(aircraftCatalogItem?.imageUrl, "assets without map catalog groups must receive fallback visual metadata");

const inside = { lat: 55.44, lng: 37.1 };
const insideTooClose = { lat: 55.2, lng: 37.1 };
const outside = { lat: 55.9, lng: 38.2 };
const okValidation = validateObjectPlacement(project, "mobile-radar", l2.id, inside);
assert(okValidation.isValid, "mobile-radar should be placeable inside L2");

const tooCloseValidation = validateObjectPlacement(project, "mobile-radar", l2.id, insideTooClose);
assert(tooCloseValidation.isValid, "placement must not reject points inside the ring inner radius");

const badValidation = validateObjectPlacement(project, "mobile-radar", l2.id, outside);
assert(badValidation.isValid, "placement must not reject points outside active layer geometry");

const customLayer = createRingLayer(project, {
  name: "Пользовательский рубеж",
  code: "LX",
  innerRadiusM: 5000,
  widthM: 10000,
});
assert(customLayer.geometry.type === "ring" && customLayer.geometry.minRadiusM === 5000 && customLayer.geometry.maxRadiusM === 15000, "createRingLayer must persist inner radius and width as ring geometry");
const customLayerRadii = getLayerRadii(customLayer);
assert(customLayerRadii.innerRadiusM === 5000 && customLayerRadii.widthM === 10000 && customLayerRadii.outerRadiusM === 15000, "getLayerRadii must expose inner, width and outer ring values");

const touchingLayer = createRingLayer(project, {
  id: "touch-l2-l3",
  name: "Касание",
  code: "LT",
  innerRadiusM: 120000,
  widthM: 5000,
});
const touchingValidation = validateLayerGeometry(project, touchingLayer);
assert(touchingValidation.isValid, "validateLayerGeometry must allow touching layer boundaries");

const overlappingLayer = createRingLayer(project, {
  id: "overlap-l2",
  name: "Пересечение",
  code: "LO",
  innerRadiusM: 59000,
  widthM: 3000,
});
const overlapValidation = validateLayerGeometry(project, overlappingLayer);
assert(!overlapValidation.isValid && overlapValidation.level === "error", "validateLayerGeometry must reject overlaps");
assert(overlapValidation.conflicts?.some((item) => item.layerId === l2.id), "overlap validation must return conflicting layer ids");

const zeroWidthLayer = {
  ...customLayer,
  id: "zero-width",
  geometry: { type: "ring" as const, center: project.baseObject.center, minRadiusM: 125000, maxRadiusM: 125000 },
};
const zeroWidthValidation = validateLayerGeometry(project, zeroWidthLayer);
assert(!zeroWidthValidation.isValid && zeroWidthValidation.message?.toLowerCase().includes("ширина"), "validateLayerGeometry must reject width 0");

const negativeInnerLayer = {
  ...customLayer,
  id: "negative-inner",
  geometry: { type: "ring" as const, center: project.baseObject.center, minRadiusM: -1, maxRadiusM: 1000 },
};
const negativeInnerValidation = validateLayerGeometry(project, negativeInnerLayer);
assert(!negativeInnerValidation.isValid && negativeInnerValidation.message?.toLowerCase().includes("внутренний"), "validateLayerGeometry must reject negative inner radius");

const emptyDraftValidation = validateLayerDraft(project, {
  name: "   ",
  code: "   ",
  innerRadiusM: 120000,
  widthM: 5000,
});
assert(!emptyDraftValidation.isValid, "validateLayerDraft must reject blank name/code");
assert(emptyDraftValidation.fieldErrors?.name, "validateLayerDraft must explain blank name inline");
assert(emptyDraftValidation.fieldErrors?.code, "validateLayerDraft must explain blank code inline");

const duplicateDraftValidation = validateLayerDraft(project, {
  name: "Дубль L2",
  code: "L2",
  innerRadiusM: 120000,
  widthM: 5000,
});
assert(!duplicateDraftValidation.isValid, "validateLayerDraft must reject duplicate layer code");
assert(duplicateDraftValidation.fieldErrors?.code?.toLowerCase().includes("уник"), "duplicate layer code must mention uniqueness");

const editDraftValidation = validateLayerDraft(
  project,
  {
    name: l2.name,
    code: l2.code,
    innerRadiusM: 30000,
    widthM: 30000,
  },
  l2.id,
);
assert(editDraftValidation.isValid, "validateLayerDraft must allow the current layer to keep its own code");

const editValidation = validateLayerGeometry(project, updateLayerGeometryFromRadii(l2, { innerRadiusM: 30000, widthM: 30000 }), l2.id);
assert(editValidation.isValid, "validateLayerGeometry must ignore the current layer while editing");

const insertOptions = findLayerInsertOptions(project);
assert(insertOptions.some((option) => option.kind === "outside" && option.availableWidthM > 0), "findLayerInsertOptions must expose outside space");
assert(insertOptions.some((option) => option.kind === "inside" && option.availableWidthM === 0), "findLayerInsertOptions must expose occupied inside range as unavailable");
assert(
  insertOptions.some((option) => option.kind === "between" && option.beforeLayerId === l2.id && option.afterLayerId === project.layers.find((layer) => layer.code === "L3")?.id && option.availableWidthM === 0),
  "findLayerInsertOptions must mark L2/L3 touching boundary as no-gap",
);

const tightenedLayer = updateLayerGeometryFromRadii(customLayer, { innerRadiusM: 10000, widthM: 2000 });
assert(tightenedLayer.geometry.type === "ring" && tightenedLayer.geometry.minRadiusM === 10000 && tightenedLayer.geometry.maxRadiusM === 12000, "updateLayerGeometryFromRadii must recompute outer radius");

const withRadar = placeObjectInProject(project, "mobile-radar", l2.id, inside);
assert(withRadar.placedObjects.length === 1, "placing object must append to placedObjects");
assert(withRadar.placedObjects[0].assetId === "mobile-radar", "manual placement must persist assetId");
assert(withRadar.placedObjects[0].layerId === l2.id, "manual placement must persist layerId");
assert(withRadar.placedObjects[0].coordinates.lat === inside.lat, "manual placement must persist coordinates");
assert(withRadar.placedObjects[0].quantity === 1, "manual placement must create a single object unit");
assert(withRadar.placedObjects[0].status === "planned", "manual placement must default to planned status");
assert(withRadar.placedObjects[0].createdAt && withRadar.placedObjects[0].updatedAt, "manual placement must persist timestamps");
assert(withRadar.placedObjects[0].hasGeometryConflict === false, "manual placement must snapshot geometry conflict status");

const l5 = project.layers.find((layer) => layer.code === "L5");
assert(l5, "default project must include L5");
const withMog = placeObjectInProject(project, "l5-mobile-fire", l5.id, inside);
assert(withMog.placedObjects[0].compoundProfile?.kind === "compound-post", "placement must include compound profile for МОГ");
assert(withMog.placedObjects[0].compoundProfile?.postType === "МОГ", "МОГ profile must have default post type");
assert(withMog.placedObjects[0].compoundProfile?.equipment?.some((item) => item.id === "binoculars"), "МОГ profile must include equipment rows");
assert(withMog.placedObjects[0].compoundProfile?.weapons?.some((item) => item.id === "firearms"), "МОГ profile must include weapon rows");
assert(withMog.placedObjects[0].compoundProfile?.visibleCoverageWeaponIds?.includes("firearms"), "МОГ profile must expose default visible coverage ids");
const updatedMog = updatePlacedObjectInProject(withMog, withMog.placedObjects[0].id, {
  compoundProfile: {
    ...withMog.placedObjects[0].compoundProfile,
    azimuth: 180,
    weaponUnits: "6",
    visibleCoverageWeaponIds: ["firearms", "antiDroneRifles"],
    weapons: withMog.placedObjects[0].compoundProfile?.weapons?.map((item) =>
      item.id === "firearms" ? { ...item, quantity: "6" } : item,
    ),
  },
});
assert(updatedMog.placedObjects[0].compoundProfile?.azimuth === 180, "editor update must persist MOГ azimuth");
assert(updatedMog.placedObjects[0].compoundProfile?.weaponUnits === "6", "editor update must persist legacy weapons count");
assert(updatedMog.placedObjects[0].compoundProfile?.weapons?.find((item) => item.id === "firearms")?.quantity === "6", "editor update must persist МОГ weapon rows");
assert(updatedMog.placedObjects[0].compoundProfile?.visibleCoverageWeaponIds?.length === 2, "editor update must persist multiple visible coverage ids");

const coordinatePlaced = placeObjectInProject(project, "mobile-radar", l2.id, { ...inside, altitude: 120 }, { notes: "координатный ввод" });
assert(coordinatePlaced.placedObjects[0].coordinates.altitude === 120, "coordinate placement must persist altitude");
assert(coordinatePlaced.placedObjects[0].notes === "координатный ввод", "coordinate placement must persist notes");
const catalogAfterPlacement = getAssetCatalogItems(withRadar, "L2", withRadar.placedObjects);
assert(
  catalogAfterPlacement.find((item) => item.assetId === "mobile-radar")?.placedCount === 1,
  "shared asset catalog must expose placed count by asset",
);
assert(calculateProjectTotalObjects(withRadar) === 1, "object count must reflect placedObjects");
assert(calculateProjectTotalUnits(withRadar) === 1, "unit count must reflect placed object quantity");
assert(calculateProjectTotalCost(withRadar) === 20, "mobile-radar placed object must cost 20 mln");

const withSecondRadar = placeObjectInProject(withRadar, "mobile-radar", l2.id, { lat: 55.45, lng: 37.1 });
const calculatorConfig = projectToCalculatorConfiguration(withSecondRadar);
const radarLine = calculatorConfig.lines.find((line) => line.assetId === "mobile-radar");
assert(radarLine?.quantity === 2, "calculator config must aggregate placed objects of same asset");
const afterDeletingOneRadar = deletePlacedObjectInProject(withSecondRadar, withSecondRadar.placedObjects[0].id);
assert(
  projectToCalculatorConfiguration(afterDeletingOneRadar).lines.find((line) => line.assetId === "mobile-radar")?.quantity === 1,
  "deleting a placed object must remove its quantity from calculator config",
);

const draftImported = applyAssetQuantityDraftsToProject(project, [{ assetId: "mobile-radar", quantity: 4 }]);
const draftRadar = draftImported.placedObjects.find((object) => object.assetId === "mobile-radar");
assert(draftImported.placedObjects.length === 1, "aggregate draft import must create one placed object per asset");
assert(draftRadar?.quantity === 4 && draftRadar.status === "planned", "aggregate draft import must preserve quantity on planned object");
assert(
  projectToCalculatorConfiguration(draftImported).lines.find((line) => line.assetId === "mobile-radar")?.quantity === 4,
  "calculator config must read aggregate draft quantity from placedObjects",
);
assert(
  draftRadar && draftRadar.coordinates.lat !== project.baseObject.center.lat,
  "aggregate draft import must assign deterministic map coordinates inside the selected layer",
);

const adjustedRadar = setAssetQuantityInProject(withSecondRadar, "mobile-radar", 4);
assert(projectToCalculatorConfiguration(adjustedRadar).lines.find((line) => line.assetId === "mobile-radar")?.quantity === 4, "setAssetQuantity must create placed objects up to requested quantity");
const reducedRadar = setAssetQuantityInProject(adjustedRadar, "mobile-radar", 1);
assert(reducedRadar.placedObjects.filter((object) => object.assetId === "mobile-radar").length === 1, "setAssetQuantity must remove surplus placed objects");

const costByLayer = calculateCostByLayer(withSecondRadar);
assert(costByLayer.find((item) => item.layerId === l2.id)?.totalMln === 40, "layer cost must sum placed objects");

const summaries = calculateLayerSummaries(withSecondRadar);
const l2Summary = summaries.find((item) => item.layerId === l2.id);
assert(l2Summary?.objectCount === 2 && l2Summary.unitCount === 2 && l2Summary.totalMln === 40, "layer summaries must count objects, units and cost by layer");
assert(l2Summary.conflictCount === 0, "layer summaries must expose zero conflicts for valid objects");

const tightenedProject = {
  ...withSecondRadar,
  layers: withSecondRadar.layers.map((layer) =>
    layer.id === l2.id ? updateLayerGeometryFromRadii(layer, { innerRadiusM: 50000, widthM: 5000 }) : layer,
  ),
};
const conflicts = calculateLayerConflicts(tightenedProject, l2.id);
assert(conflicts.length === 0, "calculateLayerConflicts must stay empty after edited ring bounds");
const conflictFlags = getPlacedObjectConflictFlags(tightenedProject, tightenedProject.placedObjects[0]);
assert(!conflictFlags.hasGeometryConflict, "conflict flags must not derive geometry conflicts from current layer geometry");
const syncedConflictProject = syncPlacedObjectConflictFlags(tightenedProject);
assert(
  syncedConflictProject.placedObjects.every((object) => !object.hasGeometryConflict && !object.hasCoverageConflict && !object.hasTerrainConflict),
  "syncPlacedObjectConflictFlags must keep diagnostic conflict snapshots clear",
);
const conflictSummary = calculateLayerSummaries(tightenedProject).find((item) => item.layerId === l2.id);
assert(conflictSummary?.conflictCount === 0, "layer summaries must keep conflictCount at zero");

const reordered = updateLayerOrder(project, l2.id, "up");
assert(reordered.layers[0].id === l2.id && reordered.layers[0].order === 1, "updateLayerOrder must move layer up and normalize order");

const lockedProject = {
  ...project,
  layers: project.layers.map((layer) => (layer.id === l2.id ? { ...layer, isLocked: true } : layer)),
};
assert(!canEditLayer(lockedProject, l2.id), "canEditLayer must return false for locked layers");
const lockedPlacementValidation = validateObjectPlacement(lockedProject, "mobile-radar", l2.id, inside);
assert(lockedPlacementValidation.isValid, "locked layers must still allow new placements");

const blockedDeletion = deleteLayerFromProject(withSecondRadar, l2.id);
assert(!blockedDeletion.ok && blockedDeletion.reason === "layer-has-objects", "deleteLayerFromProject must block deleting layers with placed objects");

const lockedDeletion = deleteLayerFromProject(lockedProject, l2.id);
assert(!lockedDeletion.ok && lockedDeletion.reason === "layer-locked", "deleteLayerFromProject must block deleting locked layers");

const emptyLayerId = withSecondRadar.layers.find((layer) => layer.code === "L3")?.id;
assert(emptyLayerId, "project must include an empty L3 layer");
const deletedEmptyLayer = deleteLayerFromProject(withSecondRadar, emptyLayerId);
assert(deletedEmptyLayer.ok && deletedEmptyLayer.project.layers.every((layer) => layer.id !== emptyLayerId), "deleteLayerFromProject must delete empty layers");

const moved = movePlacedObjectInProject(withSecondRadar, withSecondRadar.placedObjects[0].id, { lat: 55.46, lng: 37.1 });
assert(moved.placedObjects[0].coordinates.lat === 55.46, "moving inside layer must update coordinates");

const mirrorLayer = createRingLayer(withSecondRadar, {
  id: "layer-transfer-mirror",
  code: "LM",
  name: "Transfer mirror",
  innerRadiusM: 30000,
  widthM: 30000,
});
const transferProject = { ...withSecondRadar, layers: [...withSecondRadar.layers, mirrorLayer] };
const transferOk = transferPlacedObjectToLayerInProject(transferProject, transferProject.placedObjects[0].id, mirrorLayer.id);
assert(transferOk.validation.isValid, "transfer to a layer containing current coordinates must be valid");
assert(
  transferOk.project.placedObjects[0].layerId === mirrorLayer.id,
  "valid transfer must update placed object layerId",
);
assert(transferOk.project.selectedObjectId === transferProject.placedObjects[0].id, "valid transfer must select transferred object");

const l3 = project.layers.find((layer) => layer.code === "L3");
assert(l3, "default project must include L3");
const transferAcrossGeometry = transferPlacedObjectToLayerInProject(withSecondRadar, withSecondRadar.placedObjects[0].id, l3.id);
assert(transferAcrossGeometry.validation.isValid, "transfer outside target layer geometry must be allowed");
assert(
  transferAcrossGeometry.project.placedObjects[0].layerId === l3.id,
  "transfer outside target layer geometry must still update layerId",
);

const duplicate = duplicatePlacedObjectInProject(withRadar, withRadar.placedObjects[0].id);
assert(duplicate.placedObjects.length === 2, "duplicating object must create a second placed object");

const customObject = createPlacedObject(project, "mobile-radar", l2.id, inside, { quantity: 3, customPricePerUnitMln: 25 });
assert(customObject.quantity === 3 && customObject.customPricePerUnitMln === 25, "placed object must accept custom quantity and price");

const exported = exportDefenseProjectJson(withRadar);
const imported = importDefenseProjectJson(exported);
assert(imported.placedObjects.length === 1, "project JSON import must restore placed objects");
assert(imported.schemaVersion === withRadar.schemaVersion, "project JSON import must preserve schema version");
const legacyExportWithoutConflictFlags = JSON.stringify({
  ...withRadar,
  placedObjects: withRadar.placedObjects.map(
    ({ hasGeometryConflict, hasCoverageConflict, hasTerrainConflict, ...object }) => {
      void hasGeometryConflict;
      void hasCoverageConflict;
      void hasTerrainConflict;
      return object;
    },
  ),
});
const importedLegacySnapshot = importDefenseProjectJson(legacyExportWithoutConflictFlags);
assert(
  importedLegacySnapshot.placedObjects[0].hasGeometryConflict === false,
  "project JSON import must backfill missing conflict snapshots",
);
const legacyExportWithoutAssetDisplayFields = JSON.stringify({
  ...withRadar,
  assetLibrary: withRadar.assetLibrary.map(
    ({ coverageType, compatibleLayerCodes, ...asset }) => {
      void coverageType;
      void compatibleLayerCodes;
      return asset.id === "l1-osint" ? { ...asset, coverageRadius: 1200 } : asset;
    },
  ),
});
const importedLegacyAssets = importDefenseProjectJson(legacyExportWithoutAssetDisplayFields);
assert(
  importedLegacyAssets.assetLibrary.every((asset) => asset.coverageType),
  "project JSON import must backfill canonical asset display fields",
);
assert(
  importedLegacyAssets.assetLibrary.every((asset) => asset.coverageType === "none") &&
    importedLegacyAssets.assetLibrary.find((asset) => asset.id === "l1-osint")?.coverageRadius === 1200,
  "project JSON import must preserve stored values without inferring coverage from the current catalog",
);

console.log("defense-project.test.ts: project domain contracts passed");
