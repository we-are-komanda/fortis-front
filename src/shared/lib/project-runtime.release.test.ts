import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { useDefenseProjectStore as projects, projectStorageKey } from "./use-defense-project-store";
import { useDefenseVariantsStore as variants } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { createDefaultDefenseProject, exportDefenseProjectJson, importDefenseProjectJson } from "./defense-project";
import * as projectFunctions from "./defense-project";
import * as variantFunctions from "@/modules/drone-defense/domain/use-defense-variants-store";

test("failed and empty library refresh never inject bundled data into a backend project", async () => {
  const project = { ...createDefaultDefenseProject(), source: "backend" as const, version: 3, projectId: "synthetic", assetLibrary: [] };
  projects.setState({ project });
  await projects.getState().refreshAssetLibrary({ loader: async () => { throw new Error("offline"); } });
  assert.equal(projects.getState().project, project);
  assert.ok(projects.getState().assetLibraryError);
  await projects.getState().refreshAssetLibrary({ loader: async () => [] });
  assert.equal(projects.getState().project.assetLibrary.length, 0);
  assert.equal(projects.getState().assetLibraryError, null);
});
test("empty enterprises stays empty instead of adding a local object", async () => {
  await projects.getState().refreshProtectedObjects({ loader: async () => [] });
  assert.deepEqual(projects.getState().protectedObjects, []);
});
test("failed load and save preserve current project; no automatic retry after any error", async () => {
  let status = 503; let writes = 0;
  const server = createServer((req, res) => { if (req.method === "PUT") writes++; res.writeHead(status); res.end("synthetic error"); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => originalFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, init);
  const project = { ...createDefaultDefenseProject(), source: "backend" as const, projectId: "synthetic", version: 3 };
  projects.setState({ project }); variants.setState({ activeVariantId: project.projectId });
  try {
    await variants.getState().loadVariant("another-project");
    assert.equal(projects.getState().project, project);
    assert.equal(variants.getState().loadStatus, "error");
    for (status of [409, 500, 502, 504]) {
      const before = writes;
      await variants.getState().overwriteActiveVariant();
      assert.equal(projects.getState().project, project);
      assert.equal(variants.getState().saveStatus, "error");
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(writes, before + 1, "manual save must not schedule retries");
    }
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("recovery does not overwrite an open project and is not server verification", () => {
  const data = new Map<string, string>();
  const storage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
  try {
    const project = { ...createDefaultDefenseProject(), source: "backend" as const, version: 3 };
    data.set(projectStorageKey("recovery-owner"), exportDefenseProjectJson(project));
    projects.setState({ identityId: "recovery-owner", project: projectFunctions.createWorkspaceDefenseProject(), hydrated: false });
    projects.getState().restoreProjectFromLocalStorage();
    assert.equal(projects.getState().syncStatus, "unverified");
    assert.equal(projects.getState().project.source, "backend");
    const opened = { ...project, projectName: "already open" };
    projects.getState().replaceProject(opened);
    projects.getState().restoreProjectFromLocalStorage();
    assert.equal(projects.getState().project, opened);
  } finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage }); }
});

test("recovery preserves empty catalogs and user asset values without bundled expansion", () => {
  const project = { ...createDefaultDefenseProject(), source: "backend" as const, assetLibrary: [] };
  assert.equal(importDefenseProjectJson(exportDefenseProjectJson(project)).assetLibrary.length, 0);
  const asset = { ...createDefaultDefenseProject().assetLibrary[0], name: "User value", pricePerUnitMln: 123 };
  const restored = importDefenseProjectJson(exportDefenseProjectJson({ ...project, assetLibrary: [asset] }));
  assert.equal(restored.assetLibrary.length, 1);
  assert.equal(restored.assetLibrary[0].name, "User value");
  assert.equal(restored.assetLibrary[0].pricePerUnitMln, 123);
});

test("workspace creation is empty; remount does not reload a hydrated dirty project", () => {
  assert.equal(typeof projectFunctions.createWorkspaceDefenseProject, "function");
  const project = projectFunctions.createWorkspaceDefenseProject();
  assert.deepEqual(project.assetLibrary, []); assert.deepEqual(project.layers, []);
  assert.equal(typeof variantFunctions.shouldLoadBackendProject, "function");
  projects.setState({ project: { ...project, projectId: "open", source: "backend" }, hydrated: true, syncStatus: "dirty" });
  assert.equal(variantFunctions.shouldLoadBackendProject("open"), false);
  assert.equal(variantFunctions.shouldLoadBackendProject("other"), true);
  projects.setState({ syncStatus: "unverified" });
  assert.equal(variantFunctions.shouldLoadBackendProject("open"), true);
});

test("pending load cannot replace newer user edits or a cancelled navigation", async () => {
  const originalFetch = globalThis.fetch;
  const responseProject = { ...createDefaultDefenseProject(), projectId: "new", source: "backend" as const };
  const server = createServer((_req, res) => setTimeout(() => { res.end(JSON.stringify(responseProject)); }, 40));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = (input, init) => originalFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, init);
  try {
    const pending = variants.getState().loadVariant("new");
    const edited = { ...projects.getState().project, projectName: "Edited while loading" };
    projects.getState().replaceProject(edited);
    await pending;
    assert.equal(projects.getState().project, edited);
    const controller = new AbortController();
    const cancelled = variants.getState().loadVariant("new", controller.signal);
    controller.abort();
    await cancelled;
    assert.equal(projects.getState().project, edited);
  } finally {
    globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
