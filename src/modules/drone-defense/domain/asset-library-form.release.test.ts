import assert from "node:assert/strict";
import { test } from "node:test";
import original from "../../../../test/fixtures/frc04-project.json";
import type { DefenseAsset } from "@/shared/types/defense-project";
import { emptyForm,formFromAsset,formToAssetInput } from "./asset-library-form";

test("unchanged typed card form preserves fields, sub-metre distances and roles",()=>{
 const asset=original.assetLibrary[0] as DefenseAsset;
 const result=formToAssetInput(formFromAsset(asset));
 for(const key of ["minEffectiveDistance","maxEffectiveDistance","coverageRadius","coverageAngle","category","roles","unitLabel","deploymentType","placementType","compatibleLayerCodes","compoundProfile","weaponSpec","detectionSpec","ewSpec","mapCatalogGroupIds"] as const) assert.deepEqual(result[key],asset[key],key);
});
test("empty price is unknown; exact halfkopeck rounds once; bad price and unsupported confirmed fail",()=>{
 const form=emptyForm("enterprise"); form.name="Synthetic";
 assert.equal(formToAssetInput(form).unitPriceMinor,null);
 assert.equal(formToAssetInput(form).pricePerUnitMln,null);
 assert.equal(formToAssetInput({...form,pricePerUnitMln:"0.000000005"}).unitPriceMinor,"1");
 assert.throws(()=>formToAssetInput({...form,pricePerUnitMln:"-1"}));
 assert.throws(()=>formToAssetInput({...form,sourceQuality:"confirmed"}));
 assert.throws(()=>formToAssetInput({...form,sourceUrl:"javascript:alert(1)"}));
});
test("clearing source quality removes old price-field confirmation",()=>{
 const provenance={sourceLabel:"Synthetic owner",sourceDocumentId:null,sourceUrl:null,sourceDate:"2026-09-20",recordedAt:"2026-09-20T00:00:00Z",recordedBy:"fixture",quality:"confirmed" as const,revision:"1"};
 const asset={...original.assetLibrary[0],provenance,fieldProvenance:{unitPriceMinor:provenance,pricePerUnitMln:provenance,coverageRadius:provenance}} as DefenseAsset;
 const result=formToAssetInput({...formFromAsset(asset),sourceQuality:"unknown"});
 assert.equal(result.provenance,null);
 assert.equal(result.fieldProvenance?.unitPriceMinor,undefined);
 assert.equal(result.fieldProvenance?.pricePerUnitMln,undefined);
 assert.deepEqual(result.fieldProvenance?.coverageRadius,provenance);
});

test("unchanged source editor preserves distinct card and price provenance",()=>{
 const provenance={sourceLabel:"Manufacturer specification",sourceDocumentId:null,sourceUrl:null,sourceDate:"2026-09-20",recordedAt:"2026-09-20T00:00:00Z",recordedBy:"owner",quality:"confirmed" as const,revision:"r1"};
 const price={...provenance,sourceLabel:"Planning estimate",quality:"estimated" as const,revision:"r2"};
 const asset={...original.assetLibrary[0],provenance,fieldProvenance:{unitPriceMinor:price}} as DefenseAsset;
 const result=formToAssetInput({...formFromAsset(asset),name:"Renamed card"});
 assert.deepEqual(result.provenance,provenance);
 assert.deepEqual(result.fieldProvenance,{unitPriceMinor:price});
});

test("malformed exact price can be opened but cannot be silently saved as unknown or rounded",()=>{
 for(const price of ["bad","-1","1000000000000001"]){
  const asset={...original.assetLibrary[0],unitPriceMinor:price} as DefenseAsset;
  const form=formFromAsset(asset);
  assert.match(form.priceError??"",/Некорректная цена/);
  assert.throws(()=>formToAssetInput({...form,name:"Rename only"}),/Некорректная цена/);
  assert.equal(asset.unitPriceMinor,price);
 }
});
