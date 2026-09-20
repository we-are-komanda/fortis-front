import assert from "node:assert/strict";
import {test} from "node:test";
import {buildEchelonMapModel} from "./echelon-map-model";
import type {DefenseLayerId} from "@/shared/types/drone-defense";
test("custom zero-order layer without explicit color renders zones and slots",()=>{
 const model=buildEchelonMapModel({facility:{id:"f",name:"Synthetic",region:"",center:{lat:0,lon:0},priorityWeight:1,status:"active"},layers:[{id:"custom" as DefenseLayerId,name:"Custom",shortName:"C",order:0,defaultWeight:1,distanceBandM:{min:0,max:100,label:"100m"}}],configuration:{facilityId:"f",scenarioId:"baseline",placements:[]},layerCoverage:null,catalog:null});
 assert.equal(model.zones.length,1);assert.equal(model.zones[0].fillColor.length,4);assert.equal(model.slots.length,4);assert.ok(model.zones[0].fillColor.every(Number.isFinite));
});
