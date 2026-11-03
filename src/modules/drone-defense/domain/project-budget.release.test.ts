import "@/shared/lib/identity";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setAuthenticatedIdentity, sessionGeneration } from "@/shared/lib/session-state";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";
import { useDefenseProjectStore as projects } from "@/shared/lib/use-defense-project-store";
import { useDefenseVariantsStore as variants } from "./use-defense-variants-store";
import type { BudgetProjection } from "@/shared/types/finance";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; setAuthenticatedIdentity(null); });
function fixture() {
  setAuthenticatedIdentity("budget-user");
  const initial = createDefaultDefenseProject();
  const project = { ...initial, projectId: "P", enterpriseId: "E", projectName: "Saved", source: "backend" as const, version: 7,
    assetLibrary: [{ ...initial.assetLibrary[0], currency: "RUB" as const, unitPriceMinor: "47500000" }],
    placedObjects: [{ ...initial.placedObjects[0], id: "O", assetId: initial.assetLibrary[0].id, layerId: initial.layers[0].id, quantity: 1, customPriceMinor: "47500000" }] };
  const budget: BudgetProjection = { identity: { projectId: "P", projectVersion: 7, calculationVersion: "cost-v1", snapshotDigest: "a".repeat(64), inputDataVersions: {} }, config: { budgetMode: "limited", budgetLimitMinor: "50000000" }, spentMinor: "47500000", remainingMinor: "2500000", status: "within_limit" };
  projects.getState().acceptServerProject(project);
  projects.setState({ budgetProjection: budget });
  variants.setState({ activeVariantId: "P", activeVariantName: "Saved" });
  return { project, budget };
}
test("common local mutation boundary blocks known excess without losing current content", () => {
  const { project } = fixture();
  projects.getState().updatePlacedObject("O", { customPriceMinor: "50000001" });
  assert.equal(projects.getState().project, project);
  assert.ok(projects.getState().budgetError);
  projects.getState().updatePlacedObject("O", { customPriceMinor: "50000000" });
  assert.equal(projects.getState().project.placedObjects[0].customPriceMinor, "50000000");
  assert.equal(projects.getState().syncStatus, "dirty");
});
test("a blocked catalogue preview remains pending and cannot report that it was applied", () => {
  const { project } = fixture();
  const current = { ...project, placedObjects: project.placedObjects.map(({ customPriceMinor, ...object }) => { void customPriceMinor; return object; }) };
  projects.setState({ project: current, savedProject: current });
  const preview = { baseProject: current, assets: [{ ...current.assetLibrary[0], unitPriceMinor: "50000001" }], generation: sessionGeneration() };
  projects.setState({ assetLibraryPreview: preview });
  assert.equal(projects.getState().applyAssetLibraryPreview(), false);
  assert.equal(projects.getState().assetLibraryPreview, preview);
  assert.equal(projects.getState().project, current);
});

test("a blocked catalogue removal reports failure without changing the unknown-price project", () => {
  const { project, budget } = fixture();
  const current = { ...project, assetLibrary: [{ ...project.assetLibrary[0], unitPriceMinor: null }, { ...project.assetLibrary[0], id: "unused" }], placedObjects: [{ ...project.placedObjects[0], customPriceMinor: null }] };
  projects.setState({ project: current, savedProject: current, budgetProjection: { ...budget, spentMinor: null, remainingMinor: null, status: "indeterminate" } });
  const result = projects.getState().removeAssetFromLibrary("unused");
  assert.equal(result.ok, false);
  assert.equal(projects.getState().project, current);
});
test("budget acknowledgement advances the saved baseline without losing a concurrent local edit", async () => {
  const { project, budget } = fixture();
  let finish!: (response: Response) => void;
  globalThis.fetch = (_input, init) => init?.method === "PUT" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json({ items: [], totalItems: 0 }));
  const pending = variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "60000000" });
  projects.getState().replaceProject({ ...project, projectName: "Edit while budget saves" });
  finish(Response.json({ projectId: "P", enterpriseId: "E", version: 8, snapshot: { project: { ...project, version: 8 } }, budget: { ...budget, identity: { ...budget.identity, projectVersion: 8 }, config: { budgetMode: "limited", budgetLimitMinor: "60000000" }, remainingMinor: "12500000" } }));
  assert.equal(await pending, true);
  assert.equal(projects.getState().project.version, 8);
  assert.equal(projects.getState().project.projectName, "Edit while budget saves");
  assert.equal(projects.getState().savedProject?.projectName, "Saved");
  assert.equal(projects.getState().syncStatus, "dirty");
});
test("budget 422 preserves the form intent and draft without an automatic retry", async () => {
  const { project } = fixture();
  projects.getState().replaceProject({ ...project, projectName: "Local edit" });
  let writes = 0;
  globalThis.fetch = async () => { writes++; return Response.json({ error: { code: "price_unknown", message: "Unknown prices", details: { projectedSpentMinor: null, projectedRemainingMinor: null } } }, { status: 422 }); };
  assert.equal(await variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "0" }), false);
  assert.equal(writes, 1);
  assert.equal(projects.getState().project.projectName, "Local edit");
  assert.equal(projects.getState().project.version, 7);
  assert.equal(projects.getState().syncStatus, "dirty");
});
test("ambiguous budget PUT verifies before an explicit retry and never writes automatically", async () => {
  const { project, budget } = fixture();
  const calls: string[] = [];
  let allowWrite = false;
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    if (init?.method === "PUT") return allowWrite
      ? Response.json({ projectId: "P", enterpriseId: "E", version: 8, snapshot: { project: { ...project, version: 8 } }, budget: { ...budget, identity: { ...budget.identity, projectVersion: 8 }, config: { budgetMode: "limited", budgetLimitMinor: "60000000" }, remainingMinor: "12500000" } })
      : new Response(null, { status: 503 });
    return String(input).includes("/budget") ? Response.json(budget) : Response.json(project);
  };
  assert.equal(await variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "60000000" }), false);
  assert.equal(calls.filter(call => call.startsWith("PUT")).length, 1);
  assert.equal(projects.getState().saveAttempt?.kind, "budget");
  allowWrite = true;
  assert.equal(await variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "60000000" }), true);
  assert.equal(calls.filter(call => call.startsWith("PUT")).length, 2);
  assert.ok(calls.slice(1, -1).some(call => call.startsWith("GET")));
  assert.equal(projects.getState().project.version, 8);
});

test("a lost committed budget receipt is verified without a second write and keeps later edits", async () => {
  const { project, budget } = fixture();
  const next = { ...project, version: 8 };
  const updatedBudget = { ...budget, identity: { ...budget.identity, projectVersion: 8 }, config: { budgetMode: "limited", budgetLimitMinor: "60000000" }, remainingMinor: "12500000" };
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    if (init?.method === "PUT") { writes++; return new Response(null, { status: 503 }); }
    return Response.json(String(input).includes("/budget") ? updatedBudget : next);
  };
  assert.equal(await variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "60000000" }), false);
  projects.getState().replaceProject({ ...project, projectName: "Edit after lost reply" });
  assert.equal(await variants.getState().updateBudget(), true);
  assert.equal(writes, 1);
  assert.equal(projects.getState().savedProject?.version, 8);
  assert.equal(projects.getState().project.projectName, "Edit after lost reply");
  assert.equal(projects.getState().syncStatus, "dirty");
  assert.equal(projects.getState().saveAttempt, null);
});

test("a divergent budget verification retains the draft and never retries the write", async () => {
  const { project, budget } = fixture();
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    if (init?.method === "PUT") { writes++; return new Response(null, { status: 503 }); }
    return Response.json(String(input).includes("/budget") ? { ...budget, identity: { ...budget.identity, projectVersion: 8 } } : { ...project, projectName: "Other editor", version: 8 });
  };
  assert.equal(await variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "60000000" }), false);
  assert.equal(await variants.getState().updateBudget(), false);
  assert.equal(writes, 1);
  assert.equal(projects.getState().project, project);
  assert.ok(variants.getState().conflictState);
  assert.equal(projects.getState().saveAttempt?.verificationRequired, true);
});

test("a late budget receipt cannot restore the previous identity", async () => {
  const { project, budget } = fixture();
  let finish!: (response: Response) => void;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "60000000" });
  setAuthenticatedIdentity("other-user");
  const otherProject = projects.getState().project;
  finish(Response.json({ projectId: "P", enterpriseId: "E", version: 8, snapshot: { project: { ...project, version: 8 } }, budget: { ...budget, identity: { ...budget.identity, projectVersion: 8 }, config: { budgetMode: "limited", budgetLimitMinor: "60000000" }, remainingMinor: "12500000" } }));
  assert.equal(await pending, false);
  assert.equal(projects.getState().project, otherProject);
  assert.equal(projects.getState().budgetProjection, null);
});

test("copy retries retain the explicit saved budget source, body and idempotency key", async () => {
  const { project } = fixture();
  const requests: Array<{ body: string; key: string | null }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push({ body: String(init?.body), key: new Headers(init?.headers).get("Idempotency-Key") });
    return new Response(null, { status: 503 });
  };
  await variants.getState().saveAsNewVariant("Copy");
  projects.getState().replaceProject({ ...project, projectName: "Newer edit" });
  await variants.getState().saveAsNewVariant("Changed retry name");
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].body).budgetSource, { projectId: "P", projectVersion: 7 });
  assert.ok(requests[0].key);
  assert.deepEqual(requests[1], requests[0]);
});

test("workspace new projects have no inherited budget source despite an active saved project", async () => {
  const { project } = fixture();
  let body = "";
  globalThis.fetch = async (_input, init) => { body = String(init?.body); return new Response(null, { status: 503 }); };
  await variants.getState().saveAsNewVariant("New", { ...project, projectId: "New local", source: "custom", version: undefined });
  assert.equal(JSON.parse(body).budgetSource, undefined);
  assert.equal(projects.getState().project, project);
});

test("a pending budget update cannot be replaced by a create attempt", async () => {
  fixture();
  let writes = 0;
  globalThis.fetch = async () => { writes++; return new Response(null, { status: 503 }); };
  await variants.getState().updateBudget({ budgetMode: "limited", budgetLimitMinor: "60000000" });
  const attempt = projects.getState().saveAttempt;
  assert.equal(await variants.getState().saveAsNewVariant("Copy"), null);
  assert.equal(writes, 1);
  assert.equal(projects.getState().saveAttempt, attempt);
});

test("restoring a budget write interrupted before its response requires verification", () => {
  const { project } = fixture();
  projects.getState().setLocalDraftsEnabled(true);
  projects.getState().restoreVerifiedDraft({ schemaVersion: 1, userId: "budget-user", enterpriseId: "E", projectId: "P", savedProject: project, draft: project, businessRevision: 0, savedAt: new Date().toISOString(),
    attempt: { kind: "budget", name: "Saved", project, businessRevision: 0, startedAt: new Date().toISOString(), verificationRequired: false, body: JSON.stringify({ version: 7, budgetMode: "limited", budgetLimitMinor: "60000000" }) } });
  assert.equal(projects.getState().saveAttempt?.verificationRequired, true);
});
