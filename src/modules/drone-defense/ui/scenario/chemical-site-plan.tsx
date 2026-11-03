import { chemicalObjects, chemicalSiteVersion, chemicalZones } from "../../domain/chemical-site";

export function ChemicalSitePlan({selected, onSelect, showEquipment=false}: {selected?:string; onSelect:(id:string)=>void; showEquipment?:boolean}) {
  return <g data-enterprise-model={chemicalSiteVersion}>
    <rect x="-600" y="-450" width="1200" height="900" fill="var(--scene-ground)"/>
    {chemicalZones.map(z=><g key={z.id}>
      <rect x={z.x-120} y={-z.y-110} width="240" height="220" fill="var(--scene-yard)" stroke="var(--secondary)" strokeWidth="1"/>
      <text x={z.x} y={-z.y+98} textAnchor="middle" fill="var(--ink)" fontSize="9">{z.id} · {z.name}</text>
    </g>)}
    {chemicalObjects.filter(o=>showEquipment||!o.assetId).map(o=><rect key={o.id} data-object-id={o.id}
      x={o.x-o.width/2} y={-o.y-o.depth/2} width={o.width} height={o.depth} rx={o.kind==="tank"?o.width/2:0}
      fill={o.id===selected?"var(--accent)":o.assetId?"#4f7f98":"var(--scene-building)"}
      stroke={o.id===selected?"var(--accent)":"var(--secondary)"} strokeWidth={o.id===selected?1:.3}
      onClick={()=>onSelect(o.id)}><title>{o.name}</title></rect>)}
  </g>;
}
