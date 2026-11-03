import { factoryBuildings, factoryCampusVersion, factoryUnits } from "../../domain/factory-campus";

export function FactoryCampusPlan({selected, onSelect}: {selected?:string; onSelect:(id:string)=>void}) {
  return <g data-enterprise-model={factoryCampusVersion}>
    {factoryUnits.map(unit => <g key={unit.id} data-object-id={unit.id} transform={`translate(${unit.x} ${-unit.y})`} onClick={()=>onSelect(unit.id)}>
      <title>{unit.name}</title>
      <rect x="-60" y="-60" width="120" height="120" fill="var(--scene-ground)" stroke={selected===unit.id?"var(--accent)":"var(--secondary)"} strokeWidth={selected===unit.id?2:.5}/>
      <rect x="-50" y="17" width="100" height="25" fill="var(--scene-yard)"/>
      {Object.entries(factoryBuildings).map(([id,b])=><rect key={id} x={b.x-b.w/2} y={b.z-b.d/2} width={b.w} height={b.d}
        fill={id==="OFFICE"?"var(--scene-building)":id==="DOCK"?"var(--scene-yard)":"#dc2626"} stroke="var(--secondary)" strokeWidth=".4"/>)}
      <text x="0" y="53" textAnchor="middle" fill="var(--ink)" fontSize="7">{unit.id} · Factory BIM</text>
    </g>)}
  </g>;
}
