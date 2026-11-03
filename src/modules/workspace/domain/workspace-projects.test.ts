import "@/shared/lib/identity";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createWorkspaceDefenseProject } from "@/shared/lib/defense-project";
import { setAuthenticatedIdentity } from "@/shared/lib/session-state";
import { useDefenseProjectStore as projects } from "@/shared/lib/use-defense-project-store";
import { useDefenseVariantsStore as variants } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { listVariants, loadVariant, prepareProjectSave } from "@/modules/drone-defense/infra/api-client";
import { normalizeEnterprisePayload } from "@/modules/drone-defense/infra/enterprise-api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setAuthenticatedIdentity(null); });
function fixture() {
  setAuthenticatedIdentity("workspace-user");
  const current = { ...createWorkspaceDefenseProject(), projectId: "P", enterpriseId: "E", projectName: "Existing project", version: 7, source: "backend" as const };
  projects.getState().acceptServerProject(current);
  variants.setState({ activeVariantId: "P", activeVariantName: "Existing project" });
  const proposed = { ...createWorkspaceDefenseProject(), enterpriseId: "F", projectName: "Новый проект" };
  return { current, proposed };
}

test("project page requests the server enterprise filter and keeps the filtered total", async () => {
  const urls: string[] = [];
  globalThis.fetch = async input => { urls.push(String(input)); return Response.json({ items: [], totalItems: 121 }); };
  const page = await listVariants({ enterpriseId: "E & F", limit: 50, offset: 100 });
  assert.deepEqual(urls, ["/api/defense/projects?enterpriseId=E+%26+F&limit=50&offset=100"]);
  assert.equal(page.totalItems, 121);
});

test("a late enterprise or previous page reply cannot replace the latest list", async () => {
  fixture();
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = () => new Promise(resolve => { replies.push(resolve); });
  const first = variants.getState().fetchVariants({ enterpriseId: "E", limit: 50, offset: 0 });
  const second = variants.getState().fetchVariants({ enterpriseId: "F", limit: 50, offset: 50 });
  replies[1](Response.json({ items: [{ projectId: "F51", enterpriseId: "F", name: "F51", projectName: "F51", version: 1, updatedAt: "2026-09-21T00:00:00Z" }], totalItems: 121 }));
  await second;
  replies[0](Response.json({ items: [{ projectId: "E1", enterpriseId: "E", name: "E1", projectName: "E1", version: 1, updatedAt: "2026-09-21T00:00:00Z" }], totalItems: 1 }));
  await first;
  assert.deepEqual(variants.getState().variants.map(item => item.projectId), ["F51"]);
  assert.equal(variants.getState().totalItems, 121);
});

test("pending or failed workspace create preserves the previous current context and retries the frozen request", async () => {
  const { current, proposed } = fixture();
  const writes: { body: string; key: string | null }[] = [];
  let finish!: (response: Response) => void;
  globalThis.fetch = async (_input, init) => {
    if (init?.method !== "POST") return Response.json({ items: [], totalItems: 0 });
    writes.push({ body: String(init.body), key: new Headers(init.headers).get("Idempotency-Key") });
    return new Promise(resolve => { finish = resolve; });
  };
  const first = variants.getState().saveAsNewVariant("Новый проект", proposed);
  assert.deepEqual(projects.getState().project, current);
  assert.equal(projects.getState().saveAttempt, null);
  finish(new Response(null, { status: 503 }));
  await first;
  assert.deepEqual(projects.getState().project, current);
  assert.equal(variants.getState().activeVariantId, "P");
  const retry = variants.getState().saveAsNewVariant("Новый проект", { ...proposed, updatedAt: "2026-09-21T12:00:00Z" });
  finish(Response.json({ projectId: "created", enterpriseId: "F", version: 1, name: "Новый проект" }));
  const summary = await retry;
  assert.equal(summary?.projectId, "created");
  assert.deepEqual(writes[0], writes[1]);
  assert.ok(writes[0].key);
  assert.equal(projects.getState().project.projectId, "created");
  assert.equal(projects.getState().project.enterpriseId, "F");
  assert.equal(projects.getState().project.projectName, "Новый проект");
  assert.equal(projects.getState().project.version, 1);
  assert.equal(projects.getState().syncStatus, "saved");
});

test("late workspace create acknowledgement cannot overwrite a newer current edit", async () => {
  const { current, proposed } = fixture();
  let finish!: (response: Response) => void;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = variants.getState().saveAsNewVariant("Новый проект", proposed);
  projects.getState().replaceProject({ ...current, projectName: "Later edit" });
  finish(Response.json({ projectId: "created", enterpriseId: "F", version: 1, name: "Новый проект" }));
  assert.equal(await pending, null);
  assert.equal(projects.getState().project.projectId, "P");
  assert.equal(projects.getState().project.projectName, "Later edit");
  assert.equal(projects.getState().syncStatus, "dirty");
});

test("create returns no navigation result after identity changes during its list refresh", async () => {
  const { proposed } = fixture();
  let finish!: (response: Response) => void;
  globalThis.fetch = async (_input, init) => init?.method === "POST"
    ? Response.json({ projectId: "created", enterpriseId: "F", version: 1, name: "Новый проект" })
    : new Promise(resolve => { finish = resolve; });
  const pending = variants.getState().saveAsNewVariant("Новый проект", proposed);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  setAuthenticatedIdentity("another-user");
  finish(Response.json({ items: [], totalItems: 0 }));
  assert.equal(await pending, null);
  assert.notEqual(projects.getState().project.projectId, "created");
});

test("workspace names reject whitespace and more than 120 Unicode code points before sending", async () => {
  const { proposed } = fixture();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(null, { status: 503 }); };
  for (const name of ["  \n  ", "я".repeat(121), "😀".repeat(121)]) {
    assert.equal(await variants.getState().saveAsNewVariant(name, proposed), null);
  }
  assert.equal(requests, 0);
  await variants.getState().saveAsNewVariant(" 😀 ", { ...proposed, projectName: "😀" });
  assert.equal(requests, 1);
});

test("project load rejects missing enterprise ownership instead of adopting baseObject identity", async () => {
  const { current } = fixture();
  const { enterpriseId, ...orphan } = current;
  void enterpriseId;
  globalThis.fetch = async () => Response.json(orphan);
  await assert.rejects(() => loadVariant("P"));
});

test("saving a legacy project cannot infer enterprise ownership from baseObject.id", async () => {
  const { current } = fixture();
  const orphan = { ...current, enterpriseId: undefined, baseObject: { ...current.baseObject, id: "accessible-enterprise" } };
  projects.getState().acceptServerProject(orphan);
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(null, { status: 503 }); };
  assert.equal(await variants.getState().saveAsNewVariant("New copy"), null);
  assert.equal(requests, 0);
  assert.throws(() => prepareProjectSave("create", "New copy", orphan, 0));
});

test("enterprise coordinates must be explicit finite valid GIS values; zero remains valid", () => {
  const enterprise = { id: "E", name: "Explicit zero", latitude: 0, longitude: 0 };
  assert.deepEqual(normalizeEnterprisePayload(enterprise).center, { lat: 0, lng: 0 });
  for (const invalid of [{ latitude: undefined }, { longitude: undefined }, { latitude: 91 }, { longitude: -181 }, { latitude: NaN }]) {
    assert.throws(() => normalizeEnterprisePayload({ ...enterprise, ...invalid }));
  }
});
