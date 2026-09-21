import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { compareBackendProjects } from "./backend-project-api";
import { FortisProtocolError } from "@/shared/lib/api-client";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
function side(projectId: string, projectVersion: number, price: string | null) {
  const identity = { projectId, projectVersion, calculationVersion: "cost-rub-v1", snapshotDigest: "a".repeat(64), inputDataVersions: {} };
  const line = { objectId: "O", assetId: "asset", layerId: "layer", category: "type", name: "Position", quantity: 1, unitPriceMinor: price, lineTotalMinor: price, priceSource: price === null ? "unknown" : "template", provenance: null };
  const group = { id: "layer", name: "Layer", objectCount: 1, unitCount: 1, knownSubtotalMinor: price ?? "0", totalMinor: price };
  return { identity, name: projectId, updatedAt: "2026-09-21T00:00:00Z", cost: { identity, currency: "RUB", lines: [line], byLayer: [group], byType: [{ ...group, id: "type", name: "Type" }], knownSubtotalMinor: price ?? "0", totalMinor: price, isComplete: price !== null, unknownPriceObjectIds: price === null ? ["O"] : [], warnings: [] }, budget: { identity, config: { budgetMode: "unlimited", budgetLimitMinor: null }, spentMinor: price, remainingMinor: null, status: price === null ? "indeterminate" : "unlimited" } };
}
const a = { projectId: "A", projectVersion: 7 }, b = { projectId: "B", projectVersion: 3 };
const result = { enterpriseId: "E", a: side("A", 7, "47500000"), b: side("B", 3, "55000000"), differenceMinor: "7500000", differencePercent: "15.79", warnings: [] };

test("comparison pins both complete server references and validates the two projections", async () => {
  let url = "";
  globalThis.fetch = async input => { url = String(input); return Response.json(result); };
  assert.deepEqual(await compareBackendProjects(a, b, "E"), result);
  assert.equal(url, "/api/v1/projects/compare?projectIdA=A&projectVersionA=7&projectIdB=B&projectVersionB=3");
});
test("comparison rejects wrong side, tenant, money and mismatched nested snapshot authority", async () => {
  for (const value of [
    { ...result, enterpriseId: "F" },
    { ...result, b: side("B", 4, "55000000") },
    { ...result, differenceMinor: "-7500000" },
    { ...result, differencePercent: "Infinity" },
    { ...result, a: { ...result.a, cost: { ...result.a.cost, totalMinor: 47500000 } } },
    { ...result, a: { ...result.a, budget: { ...result.a.budget, identity: { ...result.a.identity, snapshotDigest: "b".repeat(64) } } } },
  ]) {
    globalThis.fetch = async () => Response.json(value);
    await assert.rejects(compareBackendProjects(a, b, "E"), FortisProtocolError);
  }
});
test("zero denominator and incomplete comparison preserve explicit null semantics", async () => {
  for (const value of [
    { ...result, a: side("A", 7, "0"), differenceMinor: "55000000", differencePercent: null },
    { ...result, b: side("B", 3, null), differenceMinor: null, differencePercent: null },
  ]) {
    globalThis.fetch = async () => Response.json(value);
    assert.deepEqual(await compareBackendProjects(a, b, "E"), value);
    globalThis.fetch = async () => Response.json({ ...value, differencePercent: "0.00" });
    await assert.rejects(compareBackendProjects(a, b, "E"), FortisProtocolError);
  }
});
test("comparison rejects invalid versions before requesting and permits one project at two revisions", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ...result, a: side("A", 7, "47500000"), b: side("A", 8, "55000000") }); };
  for (const version of [0, -1, 1.5, NaN]) await assert.rejects(compareBackendProjects({ ...a, projectVersion: version }, b, "E"));
  await assert.rejects(compareBackendProjects(a, a, "E"));
  assert.equal(calls, 0);
  await compareBackendProjects(a, { projectId: "A", projectVersion: 8 }, "E");
  assert.equal(calls, 1);
});

test("percentage validation keeps exact half rounding and canonical rounded zero", async () => {
  for (const [left,right,difference,percent] of [["20000","20001","1","0.01"],["20000","19999","-1","-0.01"],["1000000000000000","999999999999999","-1","0.00"]]) {
    const value = { ...result, a: side("A",7,left), b: side("B",3,right), differenceMinor: difference, differencePercent: percent };
    globalThis.fetch = async () => Response.json(value);
    assert.deepEqual(await compareBackendProjects(a,b,"E"), value);
    globalThis.fetch = async () => Response.json({ ...value, differencePercent: percent === "0.00" ? "-0.00" : "0.00" });
    await assert.rejects(compareBackendProjects(a,b,"E"), FortisProtocolError);
  }
});
