import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import "@/shared/lib/identity";
import { createRingLayer, createWorkspaceDefenseProject } from "@/shared/lib/defense-project";
import { draftStorageKey, type ProjectDraft } from "@/shared/lib/project-draft-storage";
import { setAuthenticatedIdentity, useSessionStore } from "@/shared/lib/session-state";
import { useDefenseProjectStore as projects } from "@/shared/lib/use-defense-project-store";
import { shouldLoadBackendProject, useDefenseVariantsStore as variants } from "./use-defense-variants-store";
import { saveBeforeLogout } from "@/shared/lib/identity";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => { globalThis.fetch = originalFetch; setAuthenticatedIdentity(null); if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });
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

for (const edit of ["visibility", "lock"] as const) test(`persisted layer ${edit} during PUT keeps the newer business revision dirty`, async () => {
  const initial = savedFixture();
  const project = { ...initial, layers: [createRingLayer(initial, { id: "L1", isVisible: true, isLocked: false })] };
  projects.getState().acceptServerProject(project);
  projects.getState().replaceProject({ ...project, projectName: "sent edit" });
  const sentRevision = projects.getState().businessRevision;
  let finish!: (response: Response) => void;
  globalThis.fetch = async (_input, init) => init?.method === "PUT"
    ? new Promise(resolve => { finish = resolve; })
    : Response.json({ items: [], totalItems: 0 });
  const pending = variants.getState().overwriteActiveVariant();
  if (edit === "visibility") projects.getState().setLayerVisibility("L1", false);
  else projects.getState().setLayerLocked("L1", true);
  assert.equal(projects.getState().businessRevision, sentRevision + 1);
  finish(Response.json({ projectId: "P", enterpriseId: "E", version: 8, name: "P" }));
  await pending;
  assert.equal(projects.getState().project.version, 8);
  assert.equal(projects.getState().syncStatus, "dirty");
  assert.equal(projects.getState().project.layers[0][edit === "visibility" ? "isVisible" : "isLocked"], edit !== "visibility");
  assert.equal(projects.getState().savedProject?.layers[0][edit === "visibility" ? "isVisible" : "isLocked"], edit === "visibility");
});

test("unchanged server revision permits only an explicit retry of the frozen update after another verification", async () => {
  const server = savedFixture();
  projects.getState().replaceProject({ ...server, projectName: "sent edit" });
  const requests: { method: string; url: string; body?: string }[] = [];
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    requests.push({ method, url: String(input), ...(init?.body ? { body: String(init.body) } : {}) });
    if (method === "PUT") return ++writes === 1
      ? new Response(null, { status: 504, headers: { "x-request-id": "lost-update" } })
      : Response.json({ projectId: "P", enterpriseId: "E", version: 8, name: "P" });
    return Response.json(String(input) === "/api/defense/projects/P" ? server : { items: [], totalItems: 0 });
  };
  await variants.getState().overwriteActiveVariant();
  assert.deepEqual(requests.map(({ method }) => method), ["PUT", "GET"]);
  assert.equal(variants.getState().saveStatus, "error");
  assert.equal(variants.getState().requestId, "lost-update");
  assert.equal(variants.getState().conflictState, null);
  assert.equal(projects.getState().project.version, 7);
  projects.getState().replaceProject({ ...projects.getState().project, projectName: "newer edit" });
  await variants.getState().overwriteActiveVariant();
  assert.deepEqual(requests.map(({ method }) => method), ["PUT", "GET", "GET", "PUT", "GET"]);
  assert.equal(requests[0].body, requests[3].body);
  assert.equal(projects.getState().project.projectName, "newer edit");
  assert.equal(projects.getState().savedProject?.projectName, "sent edit");
  assert.equal(projects.getState().project.version, 8);
  assert.equal(projects.getState().syncStatus, "dirty");
});

for (const difference of ["content", "project", "enterprise"] as const) test(`ambiguous update with divergent server ${difference} blocks another write`, async () => {
  const sent = savedFixture();
  const remote = {
    ...sent, version: 8,
    ...(difference === "content" ? { projectName: "another writer" } : difference === "project" ? { projectId: "other" } : { enterpriseId: "other" }),
  };
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return init?.method === "PUT" ? new Response(null, { status: 503 }) : Response.json(remote);
  };
  await variants.getState().overwriteActiveVariant();
  assert.equal(variants.getState().conflictState?.projectId, "P");
  assert.deepEqual(projects.getState().project, sent);
  await variants.getState().overwriteActiveVariant();
  assert.deepEqual(methods, ["PUT", "GET", "GET"]);
  assert.equal(variants.getState().conflictState?.projectId, "P");
  assert.deepEqual(projects.getState().project, sent);
});

test("409 preserves the local draft and a new variant never writes the conflicted project", async () => {
  const sent = savedFixture();
  const writes: { method: string; url: string }[] = [];
  globalThis.fetch = async (input, init) => {
    if (init?.method) writes.push({ method: init.method, url: String(input) });
    if (init?.method === "PUT") return new Response(null, { status: 409 });
    if (init?.method === "POST") return Response.json({ projectId: "copy", enterpriseId: "E", version: 1, name: "copy" });
    return Response.json({ items: [], totalItems: 0 });
  };
  await variants.getState().overwriteActiveVariant();
  assert.equal(variants.getState().conflictState?.projectId, "P");
  assert.deepEqual(projects.getState().project, sent);
  await variants.getState().saveAsNewVariant("copy");
  assert.deepEqual(writes, [{ method: "PUT", url: "/api/defense/projects/P" }, { method: "POST", url: "/api/defense/projects" }]);
  assert.equal(projects.getState().project.projectId, "copy");
  assert.equal(projects.getState().project.version, 1);
  assert.equal(projects.getState().project.projectName, sent.projectName);
  assert.equal(projects.getState().syncStatus, "saved");
});

for (const status of [401, 403, 404]) test(`${status} after a real dirty save does not retry or verify and blocks further writes`, async () => {
  setAuthenticatedIdentity("A");
  const baseline = savedFixture();
  projects.setState({ identityId: "A" });
  const sent = { ...baseline, projectName: "unsaved business edit" };
  projects.getState().replaceProject(sent);
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return new Response(null, { status });
  };
  await variants.getState().overwriteActiveVariant();
  assert.deepEqual(methods, ["PUT"]);
  assert.notEqual(projects.getState().syncStatus, "saved");
  if (status === 401) {
    assert.equal(useSessionStore.getState().userId, null);
    assert.notEqual(projects.getState().project.projectId, sent.projectId);
  } else {
    assert.deepEqual(projects.getState().project, sent);
    assert.ok(projects.getState().accessError);
    await variants.getState().overwriteActiveVariant();
    await variants.getState().saveAsNewVariant("blocked copy");
    assert.deepEqual(methods, ["PUT"]);
  }
});

function recoveryFixture() {
  setAuthenticatedIdentity("A");
  const server = savedFixture();
  projects.setState({ identityId: "A", localDraftsEnabled: true, syncStatus: "saved" });
  const record: ProjectDraft = { schemaVersion: 1, userId: "A", enterpriseId: "E", projectId: "P", draft: { ...server, projectName: "recovered work" }, savedProject: server, businessRevision: 1, savedAt: "2026-09-20T00:00:00Z" };
  const map = new Map<string, string>([[draftStorageKey(record), JSON.stringify(record)]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  } });
  return { server, record, map };
}

test("workspace startup and authorized recovery discovery leave the server project active until explicit restore", async () => {
  const { server } = recoveryFixture();
  projects.getState().restoreProjectFromLocalStorage();
  assert.equal(projects.getState().project.projectName, server.projectName);
  globalThis.fetch = async () => Response.json(server);
  await variants.getState().checkRecoveryDraft();
  assert.equal(projects.getState().project.projectName, server.projectName);
  assert.equal(projects.getState().syncStatus, "saved");
  const candidate = variants.getState().recoveryDraft;
  assert.ok(candidate);
  projects.getState().restoreVerifiedDraft(candidate);
  assert.equal(projects.getState().project.projectName, "recovered work");
  assert.equal(projects.getState().project.projectId, "P");
  assert.equal(projects.getState().project.version, 7);
  assert.equal(projects.getState().syncStatus, "dirty");
});

for (const status of [403, 404, 503]) test(`stored recovery with fresh ${status} cannot replace the active server project`, async () => {
  const { server, map } = recoveryFixture();
  const before = [...map];
  globalThis.fetch = async () => new Response(null, { status });
  await variants.getState().checkRecoveryDraft();
  assert.equal(variants.getState().recoveryDraft, null);
  assert.equal(variants.getState().recoveryStatus, "error");
  assert.ok(variants.getState().recoveryError);
  assert.deepEqual(projects.getState().project, server);
  assert.deepEqual([...map], before);
  if (status !== 503) assert.equal(projects.getState().syncStatus, "unverified");
});

test("the next identity cannot discover or apply the previous identity recovery candidate", async () => {
  const { server, record } = recoveryFixture();
  setAuthenticatedIdentity("B");
  projects.getState().acceptServerProject(server);
  variants.setState({ activeVariantId: "P" });
  globalThis.fetch = async () => Response.json(server);
  await variants.getState().checkRecoveryDraft();
  assert.equal(variants.getState().recoveryDraft, null);
  projects.getState().restoreVerifiedDraft(record);
  assert.equal(projects.getState().project.projectName, server.projectName);
  assert.equal(projects.getState().identityId, "B");
});

test("an already discovered draft cannot bypass a subsequently revoked project access", async () => {
  const { server } = recoveryFixture();
  globalThis.fetch = async () => Response.json(server);
  await variants.getState().checkRecoveryDraft();
  const candidate = variants.getState().recoveryDraft;
  assert.ok(candidate);
  projects.setState({ syncStatus: "unverified", accessError: "Access revoked" });
  projects.getState().restoreVerifiedDraft(candidate);
  assert.deepEqual(projects.getState().project, server);
  assert.equal(projects.getState().syncStatus, "unverified");
  assert.equal(projects.getState().accessError, "Access revoked");
});

test("UI selection after server load cannot overwrite an undiscovered recovery draft", async () => {
  const { map } = recoveryFixture();
  const before = [...map];
  projects.getState().selectAsset("selection-only");
  projects.getState().selectLayer("selection-only");
  projects.getState().selectObject(null);
  assert.deepEqual([...map], before);
  projects.getState().replaceProject({ ...projects.getState().project });
  assert.deepEqual([...map], before);
});

test("access revalidation on return to the same project cannot implicitly replace unsaved business content", () => {
  const server = savedFixture();
  projects.getState().replaceProject({ ...server, projectName: "work after baseline" });
  projects.setState({ syncStatus: "unverified", accessError: "Access revoked" });
  assert.equal(shouldLoadBackendProject(server.projectId), false);
  assert.equal(shouldLoadBackendProject("different-project"), true);
});

test("memory-only discard works when persistent drafts are disabled and storage is forbidden", () => {
  const server = savedFixture();
  projects.setState({ identityId: "A", localDraftsEnabled: false });
  projects.getState().replaceProject({ ...server, projectName: "memory edit" });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
  assert.equal(projects.getState().discardLocalChanges(), true);
  assert.equal(projects.getState().project.projectName, server.projectName);
  assert.equal(projects.getState().syncStatus, "saved");
});

test("a malformed save acknowledgement cannot move a project to another enterprise", async () => {
  const sent = savedFixture();
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return init?.method === "PUT"
      ? Response.json({ projectId: "P", enterpriseId: "foreign", version: 8, name: "P" })
      : Response.json(sent);
  };
  await variants.getState().overwriteActiveVariant();
  assert.equal(projects.getState().project.enterpriseId, "E");
  assert.equal(projects.getState().project.version, 7);
  assert.equal(projects.getState().syncStatus, "dirty");
  assert.deepEqual(methods, ["PUT", "GET"]);
});

test("a confirmed save permits leaving even when the subsequent project list refresh fails", async () => {
  savedFixture();
  let writes = 0;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "PUT") { writes++; return Response.json({ projectId: "P", enterpriseId: "E", version: 8, name: "P" }); }
    return new Response(null, { status: 503 });
  };
  assert.equal(await saveBeforeLogout("P"), true);
  assert.equal(projects.getState().project.version, 8);
  assert.equal(await saveBeforeLogout("P"), true);
  assert.equal(writes, 1);
});

for (const scope of ["project", "enterprise"] as const) test(`a stale recovery candidate cannot replace another current ${scope}`, () => {
  const { server, record } = recoveryFixture();
  const current = { ...server, ...(scope === "project" ? { projectId: "Q" } : { enterpriseId: "F" }) };
  projects.getState().acceptServerProject(current);
  projects.getState().restoreVerifiedDraft(record);
  assert.deepEqual(projects.getState().project, current);
  assert.equal(projects.getState().syncStatus, "saved");
});

test("late ambiguous-save verification cannot restore the identity of a project that was left", async () => {
  const sent = savedFixture();
  let finish!: (response: Response) => void;
  let started!: () => void;
  const verifying = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (input, init) => {
    if (init?.method === "PUT") return new Response(null, { status: 504 });
    if (String(input) === "/api/defense/projects/P") {
      started();
      return new Promise(resolve => { finish = resolve; });
    }
    return Response.json({ items: [], totalItems: 0 });
  };
  const pending = variants.getState().overwriteActiveVariant();
  await verifying;
  const current = { ...sent, projectId: "Q", projectName: "current project", version: 2 };
  projects.getState().acceptServerProject(current);
  variants.setState({ activeVariantId: "Q", activeVariantName: "Q" });
  finish(Response.json({ ...sent, version: 8 }));
  await pending;
  assert.deepEqual(projects.getState().project, current);
  assert.equal(projects.getState().savedProject?.projectId, "Q");
  assert.equal(variants.getState().activeVariantId, "Q");
});
