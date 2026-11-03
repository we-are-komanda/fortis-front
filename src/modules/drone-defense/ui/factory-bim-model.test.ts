import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Mesh, Line } from "three";
import { createFactoryBimModel, disposeFactoryBimModel, FACTORY_BIM_LAYERS } from "./factory-bim-model";

test("factory contains 15 nonempty layers and finite geometry with repeatable IDs", () => {
  const model=createFactoryBimModel(), second=createFactoryBimModel();
  try {
    assert.equal(model.children.length,15);
    assert.deepEqual(model.children.map(g=>g.userData.layer),FACTORY_BIM_LAYERS.map(l=>l.id));
    const ids:string[]=[];
    for(const layer of model.children) assert.ok(layer.children.length>0,layer.name);
    model.traverse(object=>{
      if(!(object instanceof Mesh || object instanceof Line))return;
      ids.push(object.userData.objectId);
      assert.ok(FACTORY_BIM_LAYERS.some(l=>l.id===object.userData.layer));
      assert.ok(object.material);
      assert.ok(object.matrixWorld.elements.every(Number.isFinite), object.name);
      assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite),object.name);
    });
    assert.equal(new Set(ids).size,ids.length);
    const other:string[]=[];second.traverse(o=>{if(o.userData.objectId)other.push(o.userData.objectId)});
    assert.deepEqual(ids,other);
    const bounds=new Box3().setFromObject(model);
    assert.ok([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite));
    assert.ok(bounds.max.y<30 && bounds.min.y>=-2);
  } finally {disposeFactoryBimModel(model);disposeFactoryBimModel(second);}
});

test("disposing a model releases each shared geometry and material once",()=>{
  const model=createFactoryBimModel();
  const disposed=new Map<object,number>();
  model.traverse(o=>{
    if(!(o instanceof Mesh || o instanceof Line))return;
    for(const resource of [o.geometry,...(Array.isArray(o.material)?o.material:[o.material])]){
      if(disposed.has(resource))continue;
      disposed.set(resource,0);resource.addEventListener('dispose',()=>disposed.set(resource,disposed.get(resource)!+1));
    }
  });
  disposeFactoryBimModel(model);
  assert.ok(disposed.size>0);
  assert.ok([...disposed.values()].every(n=>n===1));
});
