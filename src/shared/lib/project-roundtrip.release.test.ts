import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceDefenseProject, exportDefenseProjectJson, importDefenseProjectJson } from "./defense-project";
import type { DefenseProject } from "@/shared/types/defense-project";
import { readFileSync } from "node:fs";

test("project import preserves existing geometry fields and safe extensions", () => {
  const coordinates = [{ lat: 10, lng: 20, altitude: 2 }, { lat: 11, lng: 21 }, { lat: 12, lng: 20 }];
  const geometries = [
    { type: "polygon", coordinates, points: coordinates, isClosed: true, surveyNote: "synthetic polygon" },
    { type: "circle", center: coordinates[0], radiusM: 240, innerRadiusM: 30, outerRadiusM: 240, widthM: 210, surveyNote: "synthetic circle" },
    { type: "ring", center: coordinates[0], minRadiusM: 30, maxRadiusM: 240, surveyNote: "synthetic ring" },
    { type: "freeform", points: coordinates, surveyNote: "synthetic freeform" },
  ];
  const project = {
    ...createWorkspaceDefenseProject(),
    projectName: "Synthetic round trip",
    enterpriseId: "11111111-1111-4111-8111-111111111111",
    version: 7,
    customMetadata: { note: "preserve without granting authority" },
    layers: geometries.map((geometry, index) => ({
      id: `custom-layer-${index}`, name: `Layer ${index}`, code: `CUSTOM${index}`, order: index,
      geometryType: geometry.type, geometry, isActive: index === 0, isVisible: false,
      isLocked: true, description: "Synthetic note", customMetadata: { index },
    })),
  } as DefenseProject;
  const restored = importDefenseProjectJson(exportDefenseProjectJson(project));
  for (let index = 0; index < geometries.length; index++) {
    assert.deepEqual(restored.layers[index].geometry, geometries[index]);
    assert.equal(restored.layers[index].isVisible, false);
    assert.equal(restored.layers[index].isLocked, true);
  }
  assert.deepEqual((restored as typeof project & { customMetadata: unknown }).customMetadata, { note: "preserve without granting authority" });
  assert.equal(restored.version, 7);
  assert.equal(restored.enterpriseId, project.enterpriseId);
  assert.deepEqual(restored.assetLibrary, []);
});

test("complete synthetic project fixture survives frontend export and import", () => {
  const project = JSON.parse(readFileSync(new URL("../../../test/fixtures/frc04-project.json", import.meta.url), "utf8")) as DefenseProject;
  const restored = importDefenseProjectJson(exportDefenseProjectJson(project));
  assert.deepEqual({ ...restored, updatedAt: project.updatedAt }, project);
});

test("real PostgreSQL export retains every frontend business field", { skip: !process.env.FORTIS_FRC04_EXPORT_FILE }, () => {
  const original = JSON.parse(readFileSync(new URL("../../../test/fixtures/frc04-project.json", import.meta.url), "utf8"));
  const raw = JSON.parse(readFileSync(process.env.FORTIS_FRC04_EXPORT_FILE!, "utf8"));
  const restored = importDefenseProjectJson(JSON.stringify(raw));
  for (const field of ["projectId", "enterpriseId", "version"]) assert.equal(restored[field as keyof DefenseProject], raw[field]);
  assert.equal(raw.name, "Frontend fixture");
  for (const [field, value] of Object.entries(original)) {
    if (["projectId", "enterpriseId", "version", "createdAt", "updatedAt", "source", "isDirty"].includes(field)) continue;
    assert.deepEqual(restored[field as keyof DefenseProject], value, field);
  }
});
