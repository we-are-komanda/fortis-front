import assert from "node:assert/strict";
import { test } from "node:test";
import { createRingLayer, createWorkspaceDefenseProject } from "./defense-project";
import { businessContent, classifySaveVerification, savedProjectRef } from "./project-save-state";
import type { PlacedDefenseObject } from "@/shared/types/defense-project";

const project = () => ({ ...createWorkspaceDefenseProject(), projectId: "P", enterpriseId: "E", version: 7, source: "backend" as const });
test("selection and transport changes are not business changes", () => {
  const value = project();
  const next = { ...value, selectedAssetId: "A", selectedObjectId: "O", activeLayerId: "L", mode: "measure" as const, version: 8, updatedAt: "later", layers: value.layers.map(layer => ({ ...layer, isActive: !layer.isActive })) };
  assert.equal(businessContent(next), businessContent(value));
  assert.notEqual(businessContent({ ...value, projectName: "edited" }), businessContent(value));
});
test("persisted layer visibility and lock state are business changes", () => {
  const value = project();
  const layer = createRingLayer(value, { id: "L1", isActive: false });
  const withLayer = { ...value, layers: [layer] };
  assert.notEqual(businessContent({ ...withLayer, layers: [{ ...layer, isVisible: false }] }), businessContent(withLayer));
  assert.notEqual(businessContent({ ...withLayer, layers: [{ ...layer, isLocked: true }] }), businessContent(withLayer));
});
test("placed-object map visibility is a persisted business change", () => {
  const value = project();
  const object: PlacedDefenseObject = {
    id: "O1", assetId: "A1", layerId: "L1", coordinates: { lat: 0, lng: 0 }, quantity: 1,
    status: "planned", isVisibleOnMap: true, createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z",
  };
  const withObject = { ...value, placedObjects: [object] };
  assert.notEqual(businessContent(withObject), businessContent({ ...withObject, placedObjects: [{ ...object, isVisibleOnMap: false }] }));
});
test("business comparison preserves unknown fields and array ordering", () => {
  const value = project();
  assert.notEqual(businessContent({ ...value, extension: { quote: "new" } } as typeof value), businessContent(value));
  assert.equal(businessContent({ ...value, extension: { a: 1, b: 2 } } as typeof value), businessContent({ ...value, extension: { b: 2, a: 1 } } as typeof value));
  assert.notEqual(businessContent({ ...value, extension: ["first", "second"] } as typeof value), businessContent({ ...value, extension: ["second", "first"] } as typeof value));
});
test("verification rejects another enterprise and invalid or regressed server revisions", () => {
  const sent = project();
  for (const current of [
    { ...sent, enterpriseId: "other", version: 8 },
    { ...sent, version: 6 },
    { ...sent, version: 0 },
    { ...sent, version: 7.5 },
    { ...sent, version: undefined },
    { ...sent, version: 8, source: "custom" as const },
  ]) assert.equal(classifySaveVerification(sent, current), "conflict");
});
test("verification needs matching identity and sent content, not a higher revision alone", () => {
  const sent = { ...project(), projectName: "sent" };
  assert.equal(classifySaveVerification(sent, { ...sent, version: 8 }), "saved");
  assert.equal(classifySaveVerification(sent, { ...sent, version: 7 }), "retry");
  assert.equal(classifySaveVerification(sent, { ...sent, projectName: "other writer", version: 8 }), "conflict");
  assert.equal(classifySaveVerification(sent, { ...sent, projectId: "other", version: 8 }), "conflict");
});
test("only positive integral saved backend identity can authorize a last-saved action", () => {
  assert.deepEqual(savedProjectRef(project()), { projectId: "P", projectVersion: 7 });
  assert.equal(savedProjectRef({ ...project(), version: 0 }), null);
  assert.equal(savedProjectRef({ ...project(), source: "custom" }), null);
});

test("unchanged version permits retry only when the server still matches the saved baseline", () => {
  const baseline = project();
  const sent = { ...baseline, projectName: "local edit" };
  assert.equal(classifySaveVerification(sent, baseline, baseline), "retry");
  assert.equal(classifySaveVerification(sent, { ...baseline, projectName: "unexpected server content" }, baseline), "conflict");
});
