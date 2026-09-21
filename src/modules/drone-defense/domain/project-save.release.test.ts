import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createWorkspaceDefenseProject } from "@/shared/lib/defense-project";
import { draftStorageKey } from "@/shared/lib/project-draft-storage";
import { useDefenseProjectStore as projects } from "@/shared/lib/use-defense-project-store";
import { useDefenseVariantsStore as variants } from "./use-defense-variants-store";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => { globalThis.fetch = originalFetch; if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });
test("authoritative GET version cannot be replaced by an older cached list summary", async () => {
  projects.setState({ ...projects.getInitialState(), hydrated: true }, true);
  variants.setState({ ...variants.getInitialState(), variants: [{ projectId: "P", name: "old-list", projectName: "old", version: 7, updatedAt: "2026-09-20T00:00:00Z", enterpriseId: "stale-enterprise" }] }, true);
  globalThis.fetch = async () => Response.json({ ...createWorkspaceDefenseProject(), projectId: "P", projectName: "server-v8", version: 8, enterpriseId: "authoritative-enterprise" });
  await variants.getState().loadVariant("P");
  assert.equal(projects.getState().project.version, 8);
  assert.equal(projects.getState().project.enterpriseId, "authoritative-enterprise");
  assert.equal(projects.getState().project.projectName, "server-v8");
});

test("quota does not discard an edit in memory and exposes recovery failure", () => {
  const project = { ...createWorkspaceDefenseProject(), projectId: "P", enterpriseId: "E", source: "backend" as const, version: 7 };
  projects.setState({ ...projects.getInitialState(), project, hydrated: true, identityId: "A", localDraftsEnabled: true, savedProject: project, syncStatus: "saved" }, true);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem() { throw new DOMException("full", "QuotaExceededError"); } } });
  assert.doesNotThrow(() => projects.getState().replaceProject({ ...project, projectName: "edit survives" }));
  assert.equal(projects.getState().project.projectName, "edit survives");
  assert.equal(projects.getState().syncStatus, "dirty");
  assert.ok(projects.getState().draftStorageError);
});

test("business revision changes for edits but not UI selection; a reverted edit returns to baseline", () => {
  const project = { ...createWorkspaceDefenseProject(), projectId: "P", source: "backend" as const, version: 7 };
  projects.setState({ ...projects.getInitialState(), project, savedProject: project, hydrated: true, syncStatus: "saved" }, true);
  projects.getState().selectAsset("selected");
  assert.equal(projects.getState().businessRevision, 0);
  projects.getState().replaceProject({ ...projects.getState().project, projectName: "edit" });
  assert.equal(projects.getState().businessRevision, 1);
  projects.getState().replaceProject({ ...projects.getState().project, projectName: project.projectName });
  assert.equal(projects.getState().businessRevision, 2);
  assert.equal(projects.getState().syncStatus, "saved");
});

function savedFixture() {
  const project = { ...createWorkspaceDefenseProject(), projectId: "P", enterpriseId: "E", source: "backend" as const, version: 7, projectName: "edit1" };
  projects.setState({ ...projects.getInitialState(), project, savedProject: project, hydrated: true, syncStatus: "dirty" }, true);
  variants.setState({ ...variants.getInitialState(), activeVariantId: "P", activeVariantName: "P" }, true);
  return project;
}
for (const businessEdit of [true, false]) test(`pending save preserves ${businessEdit ? "business edit as dirty" : "UI selection as saved"}`, async () => {
  savedFixture();
  let finish!: (response: Response) => void;
  globalThis.fetch = async (_url, init) => init?.method === "PUT" ? new Promise(resolve => { finish = resolve; }) : Response.json({ items: [], totalItems: 0 });
  const pending = variants.getState().overwriteActiveVariant();
  if (businessEdit) projects.getState().replaceProject({ ...projects.getState().project, projectName: "edit2" });
  else projects.getState().selectAsset("UI-only");
  finish(Response.json({ projectId: "P", enterpriseId: "E", version: 8, name: "P" }));
  await pending;
  assert.equal(projects.getState().project.version, 8);
  assert.equal(projects.getState().project.projectName, businessEdit ? "edit2" : "edit1");
  assert.equal(projects.getState().syncStatus, businessEdit ? "dirty" : "saved");
  assert.equal(projects.getState().savedProject?.projectName, "edit1");
  if (!businessEdit) assert.equal(projects.getState().project.selectedAssetId, "UI-only");
});
test("lost update response verifies current server identity before any second write", async () => {
  const project = savedFixture();
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"}:${input}`);
    if (init?.method === "PUT") return Response.json({ code: "timeout" }, { status: 504, headers: { "x-request-id": "lost-response" } });
    return Response.json({ ...project, version: 8 });
  };
  await variants.getState().overwriteActiveVariant();
  assert.equal(calls.filter(call => call.startsWith("PUT")).length, 1);
  assert.ok(calls.includes("GET:/api/defense/projects/P"));
  assert.equal(projects.getState().project.version, 8);
  assert.equal(projects.getState().syncStatus, "saved");
});
test("create manual retry preserves exact body and idempotency key", async () => {
  savedFixture();
  const requests: { body: string; key: string | null }[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      requests.push({ body: String(init.body), key: new Headers(init.headers).get("Idempotency-Key") });
      return requests.length === 1 ? new Response(null, { status: 503 }) : Response.json({ projectId: "copy", enterpriseId: "E", version: 1, name: "copy" });
    }
    return Response.json({ items: [], totalItems: 0 });
  };
  await variants.getState().saveAsNewVariant("copy");
  await new Promise(resolve => setTimeout(resolve, 5));
  await variants.getState().saveAsNewVariant("copy");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(projects.getState().project.projectId, "copy");
});
test("create retry replays the frozen attempt even after a newer local edit", async () => {
  const project = savedFixture();
  const requests: { body: string; key: string | null }[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      requests.push({ body: String(init.body), key: new Headers(init.headers).get("Idempotency-Key") });
      return requests.length === 1 ? new Response(null, { status: 503 }) : Response.json({ projectId: "copy", enterpriseId: "E", version: 1, name: "copy" });
    }
    return Response.json({ items: [], totalItems: 0 });
  };
  await variants.getState().saveAsNewVariant("copy");
  projects.getState().replaceProject({ ...projects.getState().project, projectName: "newer edit" });
  await variants.getState().saveAsNewVariant("copy");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(projects.getState().project.projectName, "newer edit");
  assert.equal(projects.getState().syncStatus, "dirty");
  assert.equal(projects.getState().savedProject?.projectName, project.projectName);
});
test("recovery candidate is exposed only after a fresh authorized project read", async () => {
  const server = savedFixture();
  projects.setState({ ...projects.getState(), identityId: "A", localDraftsEnabled: true }, true);
  const local = { ...server, projectName: "recovered work" };
  const record = { schemaVersion: 1 as const, userId: "A", enterpriseId: "E", projectId: "P", draft: local, savedProject: server, businessRevision: 1, savedAt: "2026-09-20T00:00:00Z" };
  const map = new Map<string, string>([[draftStorageKey({ userId: "A", enterpriseId: "E", projectId: "P" }), JSON.stringify(record)]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value) } });
  const calls: string[] = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); return Response.json({ ...server, version: 7 }); };
  await variants.getState().checkRecoveryDraft();
  assert.deepEqual(calls, ["/api/defense/projects/P"]);
  assert.equal(variants.getState().recoveryDraft?.draft.projectName, "recovered work");
});
test("recovery is hidden when fresh project authorization fails", async () => {
  savedFixture();
  projects.setState({ ...projects.getState(), identityId: "A", localDraftsEnabled: true }, true);
  globalThis.fetch = async () => Response.json({ error: { code: "forbidden", message: "denied" } }, { status: 403 });
  await variants.getState().checkRecoveryDraft();
  assert.equal(variants.getState().recoveryDraft, null);
  assert.equal(projects.getState().syncStatus, "unverified");
});
