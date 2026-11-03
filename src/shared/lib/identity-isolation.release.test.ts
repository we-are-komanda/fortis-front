import "./identity";
import assert from "node:assert/strict";
import { test } from "node:test";
import { useDefenseProjectStore as projects } from "./use-defense-project-store";
import { createWorkspaceDefenseProject, createDefaultDefenseProject } from "./defense-project";
import { draftStorageKey } from "./project-draft-storage";

test("workspace recovery cannot cross authenticated identities", () => {
  const data = new Map<string, string>();
  const storage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
  try {
    projects.setState({ identityId: "A", runtimeMode: "workspace" } as Parameters<typeof projects.setState>[0]);
    projects.getState().replaceProject({ ...createWorkspaceDefenseProject(), projectId: "private-A", projectName: "Secret A", source: "backend" });
    projects.setState({ identityId: "B", project: createWorkspaceDefenseProject(), hydrated: false } as Parameters<typeof projects.setState>[0]);
    projects.getState().restoreProjectFromLocalStorage();
    assert.notEqual(projects.getState().project.projectId, "private-A");
  } finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage }); }
});

import { beginSessionVerification, setAuthenticatedIdentity, useSessionStore } from "./session-state";
import { useDefenseVariantsStore as variants } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { useDefenseStudioStore as studio } from "@/modules/drone-defense/domain/use-defense-studio-store";

test("successful authentication clears the previous identity and permits a fresh verification", () => {
 setAuthenticatedIdentity("previous-user");
 projects.getState().replaceProject({ ...createWorkspaceDefenseProject(), projectId: "private-previous", projectName: "Private previous project" });
 variants.setState({ activeVariantId: "private-previous", activeVariantName: "Private previous project" });
 const generation = useSessionStore.getState().generation;
 beginSessionVerification();
 assert.equal(useSessionStore.getState().userId, null);
 assert.equal(useSessionStore.getState().invalid, false);
 assert.equal(useSessionStore.getState().generation, generation + 1);
 assert.notEqual(projects.getState().project.projectId, "private-previous");
 assert.equal(variants.getState().activeVariantId, null);
 setAuthenticatedIdentity(null);
 beginSessionVerification();
 assert.equal(useSessionStore.getState().invalid, false);
});

test("account switch resets all stores and drops an in-flight A list", async () => {
 const original = globalThis.fetch;
 let resolve!: (response: Response) => void;
 try {
  setAuthenticatedIdentity("A");
  projects.getState().replaceProject({ ...createWorkspaceDefenseProject(), projectId: "private-A", source: "backend", assetLibrary: [{ ...createDefaultDefenseProject().assetLibrary[0], name: "Private A" }] });
  projects.setState({ selectedObjectId: "object-A", protectedObjects: [{ id: "enterprise-A", enterpriseId: "enterprise-A", name: "A", center: { lat: 0, lng: 0 }, source: "backend" }] });
  variants.setState({ activeVariantId: "private-A", activeVariantName: "A", variants: [{ projectId: "private-A" } as never] });
  studio.setState({ selectedPlacementId: "placement-A" });
  globalThis.fetch = () => new Promise<Response>((done) => { resolve = done; });
  const pending = variants.getState().fetchVariants();
  setAuthenticatedIdentity("B");
  resolve(Response.json({ items: [{ projectId: "private-A" }], totalItems: 1 }));
  await pending;
  assert.notEqual(projects.getState().project.projectId, "private-A");
  assert.deepEqual(projects.getState().protectedObjects, []);
  assert.deepEqual(projects.getState().project.assetLibrary, []);
  assert.equal(projects.getState().selectedObjectId, undefined);
  assert.equal(variants.getState().activeVariantId, null);
  assert.deepEqual(variants.getState().variants, []);
  assert.equal(studio.getState().selectedPlacementId, null);
 } finally { globalThis.fetch = original; }
});

test("401 preserves the draft; 403/404 block saving without retries or false saved state", async () => {
 const original = globalThis.fetch;
 try {
  for (const status of [403, 404, 401]) {
   setAuthenticatedIdentity("A");
   const project = { ...createWorkspaceDefenseProject(), projectId: "private-A", enterpriseId: "E", version: 7, source: "backend" as const };
   projects.setState({ ...projects.getInitialState(), identityId: "A", project, syncStatus: "dirty", hydrated: true }, true);
   variants.setState({ ...variants.getInitialState(), activeVariantId: "private-A" }, true);
   let writes = 0;
   globalThis.fetch = async () => { writes++; return new Response(null, { status }); };
   await variants.getState().overwriteActiveVariant();
   assert.notEqual(projects.getState().syncStatus, "saved");
   if (status === 401) {
    assert.equal(useSessionStore.getState().userId, "A");
    assert.equal(projects.getState().project, project);
   } else {
    assert.equal(projects.getState().project, project);
    assert.ok(projects.getState().accessError);
    await variants.getState().overwriteActiveVariant();
    assert.equal(writes, 1);
   }
  }
 } finally { globalThis.fetch = original; }
});



test("late project access failures cannot invalidate another current project", async (t) => {
 const original = globalThis.fetch;
 try {
  for (const operation of ["load", "overwrite", "create", "delete", "list"] as const) {
   await t.test(operation, async () => {
    setAuthenticatedIdentity("race-user");
    projects.setState({ ...projects.getInitialState(), identityId: "race-user", project: { ...createWorkspaceDefenseProject(), projectId: "old", enterpriseId: "E", version: 7, source: "backend" }, syncStatus: "dirty", hydrated: true }, true);
    variants.setState({ ...variants.getInitialState(), activeVariantId: "old" }, true);
    let finish!: (response: Response) => void;
    globalThis.fetch = (input) => String(input).endsWith("/new")
     ? Promise.resolve(Response.json({ ...createWorkspaceDefenseProject(), projectId: "new", enterpriseId: "E", version: 8, source: "backend" }))
     : new Promise<Response>((resolve) => { finish = resolve; });
    const store = variants.getState();
    const pending = operation === "load" ? store.loadVariant("old") : operation === "overwrite" ? store.overwriteActiveVariant() : operation === "create" ? store.saveAsNewVariant("copy") : operation === "delete" ? store.deleteVariant("old") : store.fetchVariants();
    await store.loadVariant("new");
    assert.equal(projects.getState().project.projectId, "new");
    finish(new Response(null, { status: 404 }));
    await pending;
    assert.equal(projects.getState().syncStatus, "saved");
    assert.equal(projects.getState().accessError, null);
   });
  }
 } finally { globalThis.fetch = original; }
});
