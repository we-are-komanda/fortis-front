import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Box3, Group, Line, Mesh, Vector3 } from "three";
import { factoryUnits, factoryCampusSize, factoryCampusVersion, factoryCampusGrade } from "../domain/factory-campus";
import { createFactoryBimModel, disposeFactoryBimModel } from "./factory-bim-model";
import { createFactoryCampusModel } from "./factory-campus-model";
import { FactoryCampusPlan } from "./scenario/factory-campus-plan";

test("four distinct original-scale factories share resources, with unique IDs and matching 2D footprints", () => {
  const original = createFactoryBimModel();
  const campus = createFactoryCampusModel();
  const collect = (root: Group) => {
    const list: (Mesh|Line)[] = [];
    root.traverse(o=>{if(o instanceof Mesh||o instanceof Line)list.push(o)});
    return list;
  };
  const originals = collect(original), copies = collect(campus);
  assert.equal(campus.name, factoryCampusVersion);
  assert.equal(campus.children.length, 15);
  assert.equal(copies.length, originals.length * 4);
  assert.equal(new Set(copies.map(o=>o.userData.objectId)).size, copies.length);
  assert.equal(new Set(copies.map(o=>o.geometry)).size, new Set(originals.map(o=>o.geometry)).size);
  const bounds: Box3[] = [];
  for (const unit of factoryUnits) {
    const objects = copies.filter(o=>o.userData.unitId===unit.id);
    assert.equal(objects.length, originals.length);
    const bound = new Box3();
    for (const o of objects) {
      const source = originals.find(s=>`${unit.id}/${s.userData.objectId}`===o.userData.objectId)!;
      assert.ok(source);
      assert.deepEqual(o.getWorldScale(new Vector3()).toArray(), [1,1,1]);
      assert.deepEqual(o.getWorldPosition(new Vector3()).toArray(), source.getWorldPosition(new Vector3()).add(new Vector3(unit.x,factoryCampusGrade,-unit.y)).toArray());
      bound.expandByObject(o);
    }
    bounds.push(bound);
    assert.ok(Math.abs(bound.min.x)<=factoryCampusSize/2 && Math.abs(bound.max.x)<=factoryCampusSize/2);
    assert.ok(Math.abs(bound.min.z)<=factoryCampusSize/2 && Math.abs(bound.max.z)<=factoryCampusSize/2);
  }
  bounds.forEach((box,i)=>bounds.slice(i+1).forEach(other=>assert.equal(box.intersectsBox(other),false)));
  const svg = renderToStaticMarkup(createElement(FactoryCampusPlan,{selected:"F04",onSelect:()=>{}}));
  for (const unit of factoryUnits) {
    assert.ok(svg.includes(`data-object-id="${unit.id}"`));
    assert.ok(svg.includes(`transform="translate(${unit.x} ${-unit.y})"`));
  }
  const resources = new Set(copies.flatMap(o=>[o.geometry,...(Array.isArray(o.material)?o.material:[o.material])]));
  let disposed=0;
  resources.forEach(resource=>resource.addEventListener("dispose",()=>disposed++));
  disposeFactoryBimModel(campus);
  assert.equal(disposed,resources.size);
  disposeFactoryBimModel(original);
});
