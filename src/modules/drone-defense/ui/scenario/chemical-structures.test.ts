import {test} from "node:test";
import assert from "node:assert/strict";
import {Box3} from "three";
import {chemicalObjects} from "../../domain/chemical-site";
import {buildChemicalStructure} from "./chemical-structures";

test("large structures have finite merged geometry at the intended building scale",()=>{
  for(const object of chemicalObjects.filter(o=>o.kind==="building"||o.kind==="frame")){
    const parts=buildChemicalStructure(object),bounds=new Box3();
    assert(parts.length>1&&parts.length<=7,`${object.id}: bounded material draw calls`);
    for(const {geometry} of parts){
      const position=geometry.attributes.position,normal=geometry.attributes.normal;
      assert.equal(position.count,normal.count);
      assert.equal(position.count,geometry.attributes.uv.count);
      assert(Array.from(position.array).every(Number.isFinite));
      assert(Array.from(normal.array).every(Number.isFinite));
      geometry.computeBoundingBox();bounds.union(geometry.boundingBox!);
    }
    assert(bounds.max.x-bounds.min.x>=object.width);
    assert(bounds.max.x-bounds.min.x<=object.width+5);
    assert(bounds.max.z-bounds.min.z<=object.depth+5);
    assert(bounds.max.y<=object.height+.1,`${object.id}: roof exceeds target height`);
    assert(bounds.min.y>=-.2,`${object.id}: geometry below grade`);
    parts.forEach(p=>p.geometry.dispose());
  }
});
