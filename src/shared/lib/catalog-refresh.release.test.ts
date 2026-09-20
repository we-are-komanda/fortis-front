import assert from "node:assert/strict";
import { test } from "node:test";
import original from "../../../test/fixtures/frc04-project.json";
import { createDefaultDefenseProject, importDefenseProjectJson } from "./defense-project";
import type { DefenseProject } from "@/shared/types/defense-project";
import { useDefenseProjectStore as store } from "./use-defense-project-store";

test("catalog refresh previews changes without mutating the saved price snapshot or overrides",async()=>{
 const project={...structuredClone(original),projectId:"saved",source:"backend",version:7} as DefenseProject;
 store.setState({...store.getInitialState(),project,runtimeMode:"workspace",identityId:"owner",hydrated:true,syncStatus:"saved"},true);
 const refreshed={...project.assetLibrary[0],unitPriceMinor:"25000000"};
 await store.getState().refreshAssetLibrary({loader:async()=>[refreshed]});
 assert.equal(store.getState().project,project);
 assert.equal(store.getState().syncStatus,"saved");
 assert.equal(store.getState().assetLibraryPreview?.assets[0].unitPriceMinor,"25000000");
 assert.equal(store.getState().applyAssetLibraryPreview(),true);
 assert.equal(store.getState().syncStatus,"dirty");
 assert.equal(store.getState().project.version,7);
 assert.equal(store.getState().project.assetLibrary[0].unitPriceMinor,"25000000");
 assert.deepEqual(store.getState().project.placedObjects,project.placedObjects);
 assert.equal(project.assetLibrary[0].unitPriceMinor,undefined);
});
test("an obsolete preview cannot replace edits made after it was fetched",async()=>{
 const project={...structuredClone(original),source:"backend",version:7} as DefenseProject;
 store.setState({...store.getInitialState(),project,runtimeMode:"workspace",identityId:"owner",hydrated:true,syncStatus:"saved"},true);
 await store.getState().refreshAssetLibrary({loader:async()=>[{...project.assetLibrary[0],unitPriceMinor:"1"}]});
 const edited={...project,projectName:"New local edit"};
 store.getState().replaceProject(edited);
 assert.equal(store.getState().applyAssetLibraryPreview(),false);
 assert.equal(store.getState().project,edited);
});
test("missing catalog entries do not erase sources from a saved project",async()=>{
 const project={...structuredClone(original),source:"backend",version:7} as DefenseProject;
 store.setState({...store.getInitialState(),project,runtimeMode:"workspace",identityId:"owner",hydrated:true,syncStatus:"saved"},true);
 await store.getState().refreshAssetLibrary({loader:async()=>[]});
 assert.equal(store.getState().project,project);
 assert.equal(store.getState().assetLibraryPreview,null);
});

test("saving a catalog card then selecting it keeps an applicable preview",()=>{
 const project={...structuredClone(original),source:"backend",version:7} as DefenseProject;
 store.setState({...store.getInitialState(),project,identityId:"owner",hydrated:true,syncStatus:"saved"},true);
 const saved={...project.assetLibrary[0],unitPriceMinor:"123"};
 store.getState().upsertAssetInLibrary(saved);
 store.getState().selectAsset(saved.id);
 assert.equal(store.getState().applyAssetLibraryPreview(),true);
 assert.equal(store.getState().project.assetLibrary[0].unitPriceMinor,"123");
 assert.equal(store.getState().project.selectedAssetId,saved.id);
 assert.equal(store.getState().project.version,7);
 assert.equal(project.assetLibrary[0].unitPriceMinor,undefined);
});
test("multiple card saves accumulate until the preview is applied",()=>{
 const project={...structuredClone(original),source:"backend",version:7} as DefenseProject;
 store.setState({...store.getInitialState(),project,identityId:"owner",hydrated:true,syncStatus:"saved"},true);
 const first={...project.assetLibrary[0],unitPriceMinor:"123"};
 const second={...project.assetLibrary[0],id:"second-card",unitPriceMinor:"456"};
 store.getState().upsertAssetInLibrary(first);
 store.getState().upsertAssetInLibrary(second);
 assert.equal(store.getState().applyAssetLibraryPreview(),true);
 assert.equal(store.getState().project.assetLibrary.find(asset=>asset.id===first.id)?.unitPriceMinor,"123");
 assert.equal(store.getState().project.assetLibrary.find(asset=>asset.id===second.id)?.unitPriceMinor,"456");
});

test("legacy bundled demo imported into an enterprise retains demo while unrelated legacy cards stay unknown",()=>{
 const legacy=createDefaultDefenseProject();
 legacy.assetLibrary=legacy.assetLibrary.map(asset=>{const old={...asset,isPublic:false,enterpriseId:"client-enterprise"};delete old.provenance;delete old.fieldProvenance;return old;});
 legacy.assetLibrary[0]={...legacy.assetLibrary[0],id:"1f9dd55f-833d-4ca9-b61b-71347bff642d"};
 legacy.assetLibrary.push({...legacy.assetLibrary[0],id:"client-supplied-card",legacyItemId:undefined});
 const imported=importDefenseProjectJson(JSON.stringify(legacy));
 assert.ok(imported.assetLibrary.slice(0,-1).every(asset=>asset.provenance?.quality==="demo"));
 assert.equal(imported.assetLibrary.at(-1)?.provenance,null);
 const supplied={...imported.assetLibrary[0].provenance!,quality:"confirmed" as const};
 legacy.assetLibrary[0]={...legacy.assetLibrary[0],provenance:supplied,fieldProvenance:{unitPriceMinor:supplied}};
 const edited=importDefenseProjectJson(JSON.stringify(legacy));
 assert.equal(edited.assetLibrary[0].provenance?.quality,"demo");
 assert.equal(edited.assetLibrary[0].fieldProvenance?.unitPriceMinor.quality,"demo");
});
