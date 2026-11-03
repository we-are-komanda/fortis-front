import { test } from "node:test";
import assert from "node:assert/strict";
import { chemicalAssets, chemicalFocus, chemicalObjects, chemicalZones } from "./chemical-site";

test("pilot has 12 zones, 18 buildings, five assets and 26 independent placements",()=>{
  assert.equal(chemicalZones.length,12);
  assert.equal(chemicalObjects.filter(o=>o.kind==="building").length,18);
  assert.equal(new Set(chemicalObjects.map(o=>o.id)).size,chemicalObjects.length);
  assert.deepEqual(chemicalAssets.map(a=>chemicalObjects.filter(o=>o.assetId===a.id).length),[12,4,4,4,2]);
  for(const o of chemicalObjects){
    assert(chemicalZones.some(z=>z.id===o.zone));
    assert([o.width,o.depth,o.height].every(n=>Number.isFinite(n)&&n>0));
    assert(Math.abs(o.x)+o.width/2<600&&Math.abs(o.y)+o.depth/2<450,`${o.id} outside site`);
    if(o.assetId) assert(chemicalAssets.some(a=>a.id===o.assetId));
  }
});
test("camera fits individual objects and zones without changing placement identity",()=>{
  const pumps=chemicalObjects.filter(o=>o.assetId==="M01-pump");
  assert.notEqual(pumps[0].id,pumps[1].id);
  assert.equal(pumps[0].assetId,pumps[1].assetId);
  assert.notDeepEqual(chemicalFocus(pumps[0].id),chemicalFocus(pumps[1].id));
  assert(chemicalFocus(pumps[0].id).span < chemicalFocus("Z01").span);
  assert(chemicalFocus("Z01").span < chemicalFocus().span);
  assert.deepEqual(chemicalFocus("missing-id"),chemicalFocus());
});
test("placements fit their zones; only trucks intentionally share canopy footprints",()=>{
  for(const o of chemicalObjects){
    const z=chemicalZones.find(z=>z.id===o.zone)!;
    assert(Math.abs(o.x-z.x)+o.width/2<=120&&Math.abs(o.y-z.y)+o.depth/2<=110,`${o.id} outside zone`);
  }
  for(let i=0;i<chemicalObjects.length;i++) for(let j=i+1;j<chemicalObjects.length;j++){
    const a=chemicalObjects[i],b=chemicalObjects[j];
    if(a.zone!==b.zone || a.kind==="canopy" || b.kind==="canopy") continue;
    const overlap=Math.abs(a.x-b.x)<(a.width+b.width)/2 && Math.abs(a.y-b.y)<(a.depth+b.depth)/2;
    assert(!overlap,`${a.id} intersects ${b.id}`);
  }
});
