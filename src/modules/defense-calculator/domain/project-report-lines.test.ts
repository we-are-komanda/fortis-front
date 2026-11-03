import { createLegacyDefenseProject as createDefaultDefenseProject } from "../../../../test/fixtures/legacy-defense-project";
// Run: npx tsx src/modules/defense-calculator/domain/project-report-lines.test.ts

import {
  placeObjectInProject,
  updatePlacedObjectInProject,
} from "@/shared/lib/defense-project";
import { buildProjectReportObjectLines } from "@/modules/defense-calculator/domain/project-report-lines";
import type { PlacedDefenseObject } from "@/shared/types/defense-project";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function getMogLineByObjectId(lines: ReturnType<typeof buildProjectReportObjectLines>, objectId: string) {
  const line = lines.find((item) => item.objectId === objectId);
  assert(line, `expected report line for placed object ${objectId}`);
  return line;
}

// Empty project returns no object report lines.
{
  const project = createDefaultDefenseProject();
  const lines = buildProjectReportObjectLines(project);
  assert(lines.length === 0, `empty project must return no lines, got ${lines.length}`);
}

// МОГ in L5 creates a report line with compound summary.
{
  let project = createDefaultDefenseProject();
  const mogAsset = project.assetLibrary.find((asset) => asset.id === "l5-mobile-fire");
  assert(mogAsset, "fixture needs l5-mobile-fire asset");
  const l5Layer = project.layers.find((layer) => layer.code === "L5");
  assert(l5Layer, "fixture needs L5 layer");

  project = placeObjectInProject(project, mogAsset.id, l5Layer.id, project.baseObject.center, { quantity: 2 });
  const placed = project.placedObjects[0];
  assert(placed, "placing МОГ should add a placed object");

  const lines = buildProjectReportObjectLines(project);
  assert(lines.length === 1, `expected one report line, got ${lines.length}`);

  const line = getMogLineByObjectId(lines, placed.id);
  assert(line.objectId === placed.id, "line should reference original object id");
  assert(line.layerCode === "L5", `expected L5 layer code, got ${line.layerCode}`);
  assert(line.isCompoundPost, "МОГ line must be marked as compound");
  assert(line.protectionType === "МОГ", `expected protection type МОГ, got ${line.protectionType}`);
  assert(line.lineTotalMln === 70, `line total must use demo price × quantity (70), got ${line.lineTotalMln}`);
  assert(typeof line.compositionSummary === "string" && line.compositionSummary.includes("Пост: МОГ"), "compound summary must include post type");
  assert(typeof line.compositionSummary === "string" && line.compositionSummary.includes("Оснащение:"), "compound summary must include equipment label");
  assert(typeof line.weaponSummary === "string" && line.weaponSummary.includes("Оружие:"), "weapon summary must include label");
  assert(typeof line.azimuthSectorSummary === "string" && line.azimuthSectorSummary.includes("Азимут:"), "azimuth summary must include label");
}

// Updates of compound profile fields are reflected in helper output.
{
  let project = createDefaultDefenseProject();
  const mogAsset = project.assetLibrary.find((asset) => asset.id === "l5-mobile-fire");
  assert(mogAsset, "fixture needs l5-mobile-fire asset");
  const l5Layer = project.layers.find((layer) => layer.code === "L5");
  assert(l5Layer, "fixture needs L5 layer");

  project = placeObjectInProject(project, mogAsset.id, l5Layer.id, project.baseObject.center);
  const placed = project.placedObjects[0] as PlacedDefenseObject;
  assert(placed.compoundProfile, "placed МОГ must have compound profile");
  project = updatePlacedObjectInProject(project, placed.id, {
    compoundProfile: {
      ...placed.compoundProfile,
      azimuth: 180,
      weaponUnits: "6",
      armament: "Дроны-перехватчики",
      coverageWeaponId: "interceptorDrones",
      visibleCoverageWeaponIds: ["firearms", "interceptorDrones"],
      weapons: placed.compoundProfile.weapons?.map((item) =>
        item.id === "firearms"
          ? { ...item, coverageAzimuth: 15, coverageSectorWidthDeg: 120 }
          : item.id === "interceptorDrones"
            ? { ...item, quantity: "6", coverageAzimuth: 235, coverageSectorWidthDeg: 40 }
            : item,
      ),
    },
  });

  const updatedLines = buildProjectReportObjectLines(project);
  const updatedLine = getMogLineByObjectId(updatedLines, placed.id);
  assert(updatedLine.isCompoundPost, "updated object must remain compound");
  assert((updatedLine.weaponSummary ?? "").includes("Дроны-перехватчики: 6"), "updated weapon units must be reflected in weapon summary");
  assert((updatedLine.azimuthSectorSummary ?? "").includes("Огнестрел"), "multiple visible coverage weapons must be reflected in report line");
  assert((updatedLine.azimuthSectorSummary ?? "").includes("Дроны-перехватчики"), "multiple visible coverage weapons must be reflected in report line");
  assert((updatedLine.azimuthSectorSummary ?? "").includes("15°"), "firearms azimuth must be reflected in report line");
  assert((updatedLine.azimuthSectorSummary ?? "").includes("235°"), "interceptor azimuth must be reflected in report line");
  assert((updatedLine.azimuthSectorSummary ?? "").includes("120°"), "firearms sector must be reflected in report line");
  assert((updatedLine.azimuthSectorSummary ?? "").includes("40°"), "interceptor sector must be reflected in report line");
}

// Non-compound object should not receive compound summaries.
{
  let project = createDefaultDefenseProject();
  const kineticAsset = project.assetLibrary.find((asset) => asset.id === "mobile-radar");
  assert(kineticAsset, "fixture needs non-compound asset");
  project = placeObjectInProject(project, kineticAsset.id, project.layers[0]!.id, project.baseObject.center);

  const lines = buildProjectReportObjectLines(project);
  assert(lines.length === 1, `expected one report line, got ${lines.length}`);
  const line = lines[0];
  assert(!line.isCompoundPost, "non-compound object must not be marked compound");
  assert(line.compositionSummary === undefined, "non-compound object must not have composition summary");
  assert(line.azimuthSectorSummary === undefined, "non-compound object must not have azimuth-sector summary");
}

// Polygon layer metadata is visible in report helpers.
{
  let project = createDefaultDefenseProject();
  const polygonLayer = {
    ...project.layers[0]!,
    id: "polygon-report-layer",
    code: "LP",
    name: "Произвольный контур",
    geometryType: "polygon" as const,
    geometry: {
      type: "polygon" as const,
      coordinates: [
        { lat: 55, lng: 37 },
        { lat: 55, lng: 37.01 },
        { lat: 55.01, lng: 37.01 },
        { lat: 55.01, lng: 37 },
      ],
      isClosed: true,
    },
  };
  project = { ...project, layers: [polygonLayer, ...project.layers.slice(1)] };
  project = placeObjectInProject(project, "mobile-radar", polygonLayer.id, { lat: 55.005, lng: 37.005 });

  const lines = buildProjectReportObjectLines(project);
  assert(lines.length === 1, `expected one report line, got ${lines.length}`);
  assert(lines[0].layerGeometryLabel === "произвольный контур", "polygon layer report line must expose shape label");
  assert(
    typeof lines[0].layerAreaHa === "number" && lines[0].layerAreaHa > 0,
    "polygon layer report line must expose approximate area in hectares",
  );
}

console.log("project-report-lines: OK");
