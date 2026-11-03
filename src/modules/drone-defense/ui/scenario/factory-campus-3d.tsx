"use client";
import { memo, useEffect, useMemo } from "react";
import { Edges } from "@react-three/drei";
import { factoryUnits } from "../../domain/factory-campus";
import { createFactoryCampusModel } from "../factory-campus-model";
import { disposeFactoryBimModel } from "../factory-bim-model";

export const FactoryCampus = memo(function FactoryCampus({selected, onSelect}: {selected?:string; onSelect:(id:string)=>void}) {
  const model = useMemo(createFactoryCampusModel, []);
  useEffect(() => () => disposeFactoryBimModel(model), [model]);
  const unit = factoryUnits.find(u => u.id === selected);
  return <group>
    <primitive object={model} dispose={null} onClick={(event: import("@react-three/fiber").ThreeEvent<MouseEvent>) => {
      event.stopPropagation(); onSelect(event.object.userData.unitId ?? "");
    }}/>
    {unit && <mesh position={[unit.x, .3, -unit.y]} rotation={[-Math.PI/2,0,0]}>
      <planeGeometry args={[134,120]}/><meshBasicMaterial visible={false}/><Edges color="#2563eb" lineWidth={2}/>
    </mesh>}
  </group>;
});
