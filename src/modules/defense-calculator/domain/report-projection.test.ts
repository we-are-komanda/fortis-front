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
