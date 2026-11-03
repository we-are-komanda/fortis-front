import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getBackendProjectReport } from "../infra/backend-project-api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("official report requests an explicit saved revision and rejects a legacy unversioned payload", async () => {
  let url = "";
  globalThis.fetch = async input => {
    url = String(input);
    return Response.json({ projectId: "P", projectName: "Old report", layers: [], placedObjects: [], hideCost: true });
  };
  await assert.rejects(getBackendProjectReport("P", { projectVersion: 7, hideCost: true, mapView: "all" }));
  assert.equal(url, "/api/v1/projects/report?id=P&projectVersion=7&hideCost=true&mapView=all");
});

function report(hideCost: boolean) {
  const identity = { projectId: "P", projectVersion: 7, calculationVersion: "cost-rub-v1", snapshotDigest: "a".repeat(64), inputDataVersions: {} };
  return {
    reportId: "issued-1", reportSchemaVersion: "report-v1", identity, generatedAt: "2026-11-03T00:00:00Z", title: "Saved variant",
    enterprise: { id: "E", name: null }, hideCost,
    mapSnapshotData: { baseObject: { id: "B", name: "Site", center: { lat: 55, lng: 40 } }, layers: [], objects: [] },
    mapVisibility: { mode: "all", layerIds: [], objectIds: [], showCoverage: false }, objects: [], warnings: [], limitations: [],
    ...(!hideCost ? {
      cost: { identity, currency: "RUB", lines: [], byLayer: [], byType: [], knownSubtotalMinor: "0", totalMinor: "0", isComplete: true, unknownPriceObjectIds: [], warnings: [] },
      budget: { identity, config: { budgetMode: "unlimited", budgetLimitMinor: null }, spentMinor: "0", remainingMinor: null, status: "unlimited" }, sources: [],
    } : {}),
  };
}

for (const hideCost of [true, false]) {
  test(`accepts pinned report envelope, hideCost=${hideCost}`, async () => {
    const payload = report(hideCost);
    globalThis.fetch = async () => Response.json(payload);
    assert.deepEqual(await getBackendProjectReport("P", { projectVersion: 7, hideCost }), payload);
  });
}

test("rejects mismatched revisions, mode, identity and hidden financial fields", async () => {
  const valid = report(false);
  const invalid = [
    { ...valid, identity: { ...valid.identity, projectVersion: 8 } },
    { ...valid, mapVisibility: { ...valid.mapVisibility, mode: "saved" } },
    { ...valid, cost: { ...valid.cost, identity: { ...valid.identity, snapshotDigest: "b".repeat(64) } } },
    { ...valid, budget: { ...valid.budget, spentMinor: "1" } },
    { ...valid, reportSchemaVersion: "legacy" },
  ];
  for (const payload of invalid) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(getBackendProjectReport("P", { projectVersion: 7, hideCost: false }));
  }
  globalThis.fetch = async () => Response.json({ ...report(true), cost: valid.cost });
  await assert.rejects(getBackendProjectReport("P", { projectVersion: 7, hideCost: true }));
});

test("rejects invalid versions before any request", async () => {
  globalThis.fetch = async () => { assert.fail("invalid version must not reach backend"); };
  for (const projectVersion of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(getBackendProjectReport("P", { projectVersion, hideCost: true }));
  }
});
