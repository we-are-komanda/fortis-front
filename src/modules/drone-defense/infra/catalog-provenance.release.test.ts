import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDefenseAssetPayload, serializeDefenseAssetMutation } from "./asset-library-api";
import { buildPublicAssetSeedPayloads } from "./seed-backend-asset-library";
import { FortisProtocolError } from "@/shared/lib/api-client";
import { defenseAssetLibrary } from "@/shared/config/defense-asset-library";
import { exportDefenseProjectJson, importDefenseProjectJson, createDefaultDefenseProject } from "@/shared/lib/defense-project";
const provenance={sourceLabel:"Synthetic source <b>text</b>",sourceDocumentId:"doc",sourceDocumentRevision:"1",sourceDocumentChecksum:"a".repeat(64),sourceUrl:null,sourceDate:"2026-09-20",recordedAt:"2026-09-20T00:00:00Z",recordedBy:"synthetic",quality:"confirmed" as const,revision:"1"};
test("asset DTO roundtrip preserves native categories/roles, exactnull prices and provenance references",()=>{
 for(const category of ["early-warning","classification","spoofing","engineering-protection","software","external-service"] as const){
  const asset={...defenseAssetLibrary[0],id:"x",legacyItemId:undefined,category,roles:["track","alert"] as ("track"|"alert")[],unitPriceMinor:null,pricingMode:"components" as const,components:[{id:"c",name:"part",quantity:2,unitPriceMinor:"7"}],provenance,fieldProvenance:{unitPriceMinor:provenance}};
  const payload=serializeDefenseAssetMutation(asset);
  const result=normalizeDefenseAssetPayload({...payload,id:asset.id});
  for(const key of ["category","roles","unitPriceMinor","pricingMode","components","provenance","fieldProvenance","compoundProfile","weaponSpec","detectionSpec","ewSpec"] as const) assert.deepEqual(result[key],asset[key],key);
 }
});
test("old sources remain unknown; malformed finance/source metadata fails closed",()=>{
 assert.equal(normalizeDefenseAssetPayload({id:"x",name:"Old"}).provenance,null);
 for(const field of [{provenance:{quality:"confirmed",sourceLabel:{bad:"child"}}},{unitPriceMinor:-1},{unitPriceMinor:"-1"},{currency:"USD"},{components:[{name:"x",quantity:1.5,unitPriceMinor:"0"}]}]) assert.throws(()=>normalizeDefenseAssetPayload({id:"x",name:"Invalid",...field}),FortisProtocolError);
});
test("bundled demo quality survives seed serialization and project export/import",()=>{
 assert.ok(buildPublicAssetSeedPayloads().every(asset=>asset.provenance?.quality==="demo"));
 const project=importDefenseProjectJson(exportDefenseProjectJson(createDefaultDefenseProject()));
 assert.ok(project.assetLibrary.every(asset=>asset.provenance?.quality==="demo"));
});

test("legacy backend seed lineage remains demo even with supplied confirmed sources",()=>{
 for(const identity of [{id:"mobile-radar"},{id:"backend-uuid",legacyItemId:"mobile-radar"}]) {
  const legacy=normalizeDefenseAssetPayload({...identity,name:"Imported old seed",isPublic:false,enterpriseId:"client"});
  assert.equal(legacy.provenance?.quality,"demo");
  const edited=normalizeDefenseAssetPayload({...identity,name:"Edited seed",provenance,fieldProvenance:{unitPriceMinor:provenance}});
  assert.equal(edited.provenance?.quality,"demo");
  assert.equal(edited.fieldProvenance?.unitPriceMinor.quality,"demo");
 }
 const client=normalizeDefenseAssetPayload({id:"new-client-card",name:"Client source",provenance});
 assert.equal(client.provenance?.quality,"confirmed");
});
