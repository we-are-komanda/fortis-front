import "./identity";
import assert from "node:assert/strict";
import { test } from "node:test";
import { useDefenseProjectStore as projects } from "./use-defense-project-store";
import { createWorkspaceDefenseProject, createDefaultDefenseProject } from "./defense-project";

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

import { setAuthenticatedIdentity, useSessionStore } from "./session-state";
import { useDefenseVariantsStore as variants } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { useDefenseStudioStore as studio } from "@/modules/drone-defense/domain/use-defense-studio-store";

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

test("401 invalidates identity; 403/404 block saving without retries or false saved state", async () => {
 const original = globalThis.fetch;
 try {
  for (const status of [403, 404, 401]) {
   setAuthenticatedIdentity("A");
   const project = { ...createWorkspaceDefenseProject(), projectId: "private-A", source: "backend" as const };
   projects.setState({ project, syncStatus: "saved", accessError: null });
   variants.setState({ activeVariantId: "private-A" });
   let writes = 0;
   globalThis.fetch = async () => { writes++; return new Response(null, { status }); };
   await variants.getState().overwriteActiveVariant();
   assert.notEqual(projects.getState().syncStatus, "saved");
   if (status === 401) {
    assert.equal(useSessionStore.getState().userId, null);
    assert.notEqual(projects.getState().project.projectId, "private-A");
   } else {
    assert.equal(projects.getState().project, project);
    assert.ok(projects.getState().accessError);
    await variants.getState().overwriteActiveVariant();
    assert.equal(writes, 1);
   }
  }
 } finally { globalThis.fetch = original; }
});

import { logout } from "./identity";

test("late project access failures cannot invalidate another current project", async (t) => {
 const original = globalThis.fetch;
 try {
  for (const operation of ["load", "overwrite", "create", "delete", "list"] as const) {
   await t.test(operation, async () => {
    setAuthenticatedIdentity("race-user");
    projects.setState({ project: { ...createWorkspaceDefenseProject(), projectId: "old", source: "backend" }, syncStatus: "saved", accessError: null });
    variants.setState({ activeVariantId: "old" });
    let finish!: (response: Response) => void;
    globalThis.fetch = (input) => String(input).endsWith("/new")
     ? Promise.resolve(Response.json({ ...createWorkspaceDefenseProject(), projectId: "new", source: "backend" }))
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

test("logout clears active memory but preserves only the owner recovery key", async () => {
 const original = globalThis.fetch; const storage = globalThis.localStorage;
 const data = new Map<string,string>();
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)}});
 try {
  setAuthenticatedIdentity("A");
  projects.getState().replaceProject({ ...createWorkspaceDefenseProject(), projectId: "private-A", source: "backend" });
  globalThis.fetch = async (url, init) => { assert.equal(url,"/api/auth/logout"); assert.equal(init?.method,"POST"); return Response.json({status:"ok"}); };
  await logout();
  assert.equal(useSessionStore.getState().userId,null);
  assert.notEqual(projects.getState().project.projectId,"private-A");
  projects.getState().restoreProjectFromLocalStorage();
  assert.notEqual(projects.getState().project.projectId,"private-A");
  setAuthenticatedIdentity("B");projects.getState().restoreProjectFromLocalStorage();
  assert.notEqual(projects.getState().project.projectId,"private-A");
  setAuthenticatedIdentity("A");projects.getState().restoreProjectFromLocalStorage();
  assert.equal(projects.getState().project.projectId,"private-A");
  assert.equal(projects.getState().syncStatus,"unverified");
  assert.equal(data.has("fortis-defense-project"),false);
 } finally {globalThis.fetch=original;Object.defineProperty(globalThis,"localStorage",{configurable:true,value:storage});}
});
