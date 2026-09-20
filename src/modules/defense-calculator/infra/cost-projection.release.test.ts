import assert from "node:assert/strict";
import { test } from "node:test";
import { getBackendProjectCost } from "./backend-project-api";
import { FortisProtocolError } from "@/shared/lib/api-client";

const projection = {
 identity: { projectId: "P", projectVersion: 7, calculationVersion: "cost-rub-v1", inputDataVersions: {}, snapshotDigest: "a".repeat(64) },
 currency: "RUB", lines: [], byLayer: [], byType: [], knownSubtotalMinor: "0", totalMinor: "0", isComplete: true, unknownPriceObjectIds: [], warnings: [],
};
test("cost request pins project/version and accepts only matching exact projection", async () => {
 const original = globalThis.fetch;
 try {
  const urls: string[] = [];
  globalThis.fetch = async input => { urls.push(String(input)); return Response.json(projection); };
  assert.deepEqual(await getBackendProjectCost("P", 7), projection);
  assert.equal(urls[0], "/api/v1/projects/cost?projectId=P&projectVersion=7");
  for (const bad of [
   {...projection, identity: {...projection.identity, projectVersion: 8}},
   {...projection, identity: {...projection.identity, projectId: "Q"}},
   {...projection, totalMinor: 0}, {...projection, totalMinor: "1"},
   {...projection, identity: {...projection.identity, snapshotDigest: ""}},
   {...projection, lines: [{objectId:"x"}]}, {totalMln:0},
  ]) {
   globalThis.fetch = async () => Response.json(bad);
   await assert.rejects(getBackendProjectCost("P",7), FortisProtocolError);
  }
 } finally { globalThis.fetch = original; }
});
test("cost request rejects non-positive/noninteger revision before network", async () => {
 const original = globalThis.fetch; let calls=0;
 try {
  globalThis.fetch = async () => { calls++; return Response.json(projection); };
  for (const version of [0,-1,1.5,NaN]) await assert.rejects(getBackendProjectCost("P",version));
  assert.equal(calls,0);
 } finally { globalThis.fetch=original; }
});

test("malformed provenance cannot enter rendered cost lines", async () => {
 const original=globalThis.fetch;
 const line={objectId:"x",assetId:"a",layerId:"l",category:"c",name:"Safe",quantity:1,unitPriceMinor:"0",lineTotalMinor:"0",priceSource:"template",provenance:{quality:"estimated",sourceLabel:{bad:"render-child"}}};
 const group={id:"l",name:"Layer",objectCount:1,unitCount:1,knownSubtotalMinor:"0",totalMinor:"0"};
 try {
  globalThis.fetch=async()=>Response.json({...projection,lines:[line],byLayer:[group],byType:[{...group,id:"c"}]});
  await assert.rejects(getBackendProjectCost("P",7),FortisProtocolError);
 } finally {globalThis.fetch=original;}
});
