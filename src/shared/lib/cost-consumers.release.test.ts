import assert from "node:assert/strict";
import { test } from "node:test";
import original from "../../../test/fixtures/frc04-project.json";
import finance from "../../../test/fixtures/finance-v1.json";
import type { DefenseProject } from "@/shared/types/defense-project";
import { calculateProjectTotalCost, calculateCostByLayer, calculateLayerSummaries, priceForPlacedObject, getAssetCatalogItems } from "./defense-project";
import { buildDraftCostProjection } from "./cost-projection";
import { buildProjectReportObjectLines } from "@/modules/defense-calculator/domain/project-report-lines";

function fixtureProject() {
 const project = structuredClone(original) as DefenseProject;
 project.layers = finance.layers.map((layer,order)=>({...project.layers[0],...layer,order}));
 project.assetLibrary = finance.assets.map(asset=>({...project.assetLibrary[0],...asset,pricePerUnitMln:Number(asset.unitPriceMinor)/100000000}));
 project.placedObjects = finance.variantA.objects.map(object=>({...project.placedObjects[0],...object,customPricePerUnitMln: "customPriceMinor" in object ? Number(object.customPriceMinor)/100000000 : undefined}));
 return project;
}
test("map and legacy report adapters derive exact values from the canonical minor projection", () => {
 const project=fixtureProject();
 const lines = buildProjectReportObjectLines(project);
 assert.equal(calculateProjectTotalCost(project), 0.475);
 assert.deepEqual(calculateCostByLayer(project).map(group => group.totalMln), [0.25,0.225]);
 assert.deepEqual(calculateLayerSummaries(project).map(group => group.totalMln), [0.25,0.225]);
 assert.deepEqual(lines.map(line => line.lineTotalMln), [0.25,0.15,0.075]);
 project.placedObjects[0].customPriceMinor = null;
 assert.equal(priceForPlacedObject(project,project.placedObjects[0]),null);
 assert.equal(calculateProjectTotalCost(project),null);
 assert.equal(calculateCostByLayer(project)[0].totalMinor,null);
 assert.equal(buildProjectReportObjectLines(project)[0].lineTotalMln,null);
});
test("map structural summaries accept unavailable cost without recalculating invalid inputs",()=>{
 const project=fixtureProject();
 const invalidProject={...project,placedObjects:project.placedObjects.map(object=>({...object,quantity:0}))};
 const summaries=calculateLayerSummaries(invalidProject,null);
 assert.equal(summaries.reduce((sum,group)=>sum+group.objectCount,0),3);
 assert.ok(summaries.every(group=>group.totalMinor===null));
 const frozen=buildDraftCostProjection(project);
 assert.deepEqual(calculateLayerSummaries(invalidProject,frozen).map(group=>group.totalMinor),["25000000","22500000"]);
});

test("invalid unused catalog prices produce an error label without crashing catalog rendering",()=>{
 for(const price of ["bad", "-1", "1000000000000001"]){
  const project=structuredClone(original) as DefenseProject;
  project.placedObjects=[];
  project.assetLibrary[0].unitPriceMinor=price;
  const items=getAssetCatalogItems(project,undefined);
  assert.equal(items[0].priceLabel,"Некорректная цена");
  assert.equal(project.assetLibrary[0].unitPriceMinor,price);
 }
});
