import { Group } from "three";
import { factoryCampusVersion, factoryCampusGrade, factoryUnits } from "../domain/factory-campus";
import { createFactoryBimModel } from "./factory-bim-model";

export function createFactoryCampusModel() {
  const source = createFactoryBimModel();
  const campus = new Group();
  campus.name = factoryCampusVersion;
  // Clone transforms/IDs, share immutable geometry and materials between the four copies.
  for (const sourceLayer of source.children) {
    const layer = new Group();
    layer.name = sourceLayer.name;
    layer.userData = { ...sourceLayer.userData };
    for (const unit of factoryUnits) {
      const copy = sourceLayer.clone(true);
      copy.position.set(unit.x, factoryCampusGrade, -unit.y);
      copy.traverse(object => {
        object.userData.unitId = unit.id;
        if (object.userData.objectId) {
          object.userData.objectId = `${unit.id}/${object.userData.objectId}`;
          object.name = object.userData.objectId;
        }
      });
      layer.add(copy);
    }
    campus.add(layer);
  }
  source.clear();
  campus.updateMatrixWorld(true);
  return campus;
}
