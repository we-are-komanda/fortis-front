import { DefenseAssetSymbol } from "@/shared/ui/defense-asset-symbol";
import { defenseAssetSymbols } from "@/shared/config/defense-asset-symbols";
import { Html, Line } from "@react-three/drei";
import type { ProjectScenario } from "../../domain/project-scenario";
import { FactoryCampus } from "./factory-campus-3d";
import { FactoryCampusPlan } from "./factory-campus-plan";

const noop = () => {};

type Props = { scene: ProjectScenario; zoom: number; selected?: string; onSelect: (id: string) => void };

export function ProjectSite2D({ scene, zoom, selected, onSelect }: Props) {
  return <g data-project-object={scene.objectId}>
    <polygon points={scene.perimeter.map(point => `${point.xM},${-point.yM}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    <FactoryCampusPlan onSelect={noop} />
    {scene.placements.map((object) => <g key={object.id} data-project-placement={object.id} data-x-m={object.xM} data-y-m={object.yM}
      transform={`translate(${object.xM} ${-object.yM})`} role="button" tabIndex={0} aria-pressed={selected === object.id} aria-label={`Средство: ${object.name}, ${object.quantity} шт.`}
      onClick={() => onSelect(object.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(object.id); } }} style={{ cursor: "pointer" }}>
      <title>{object.name} · {defenseAssetSymbols[object.symbolId].label} · {object.quantity} шт.</title>
      <rect x={-800 / zoom} y={-800 / zoom} width={1600 / zoom} height={1600 / zoom} rx={180 / zoom} fill="white" stroke={selected === object.id ? "var(--accent)" : "#cbd5e1"} strokeWidth={selected === object.id ? 2 : 1} vectorEffect="non-scaling-stroke" />
      <DefenseAssetSymbol symbolId={object.symbolId} x={-600 / zoom} y={-600 / zoom} width={1200 / zoom} height={1200 / zoom} style={{ color: "black" }} />
      {object.quantity > 1 && <text x={800 / zoom} y={-800 / zoom} textAnchor="middle" dominantBaseline="central" fontSize={500 / zoom} fill="black" stroke="white" strokeWidth={100 / zoom} paintOrder="stroke">{object.quantity}</text>}
      {selected === object.id && <text x={1000 / zoom} dominantBaseline="central" fontSize={640 / zoom} fill="var(--ink)" stroke="var(--surface)" strokeWidth={35 / zoom} paintOrder="stroke">{object.name} · {object.quantity}</text>}
    </g>)}
  </g>;
}

export function ProjectSite3D({ scene, selected, onSelect }: Props) {
  const perimeter = [...scene.perimeter, scene.perimeter[0]].map(point => [point.xM / 1000, .006, -point.yM / 1000] as [number, number, number]);
  return <group>
    <group scale={.001}><FactoryCampus onSelect={noop} /></group>
    <Line points={perimeter} color="#2563eb" lineWidth={2} toneMapped={false} />
    {scene.placements.map((object) => <Html key={object.id} center position={[object.xM / 1000, .02, -object.yM / 1000]}>
      <button data-project-placement={object.id} data-x-m={object.xM} data-y-m={object.yM} aria-label={`Средство: ${object.name}, ${object.quantity} шт.`} aria-pressed={selected === object.id}
        onClick={() => onSelect(object.id)} title={`${object.name} · ${defenseAssetSymbols[object.symbolId].label} · ${object.quantity} шт.`} style={{ position: "relative", width: 44, height: 44, padding: 5, background: "white", color: "black", borderColor: selected === object.id ? "var(--accent)" : "#cbd5e1", boxShadow: selected === object.id ? "0 0 0 2px var(--accent)" : undefined }}>
        <DefenseAssetSymbol symbolId={object.symbolId} />
        {object.quantity > 1 && <span style={{ position: "absolute", top: -6, right: -6, borderRadius: 8, padding: "0 4px", background: "#0f172a", color: "white", fontSize: 10 }}>{object.quantity}</span>}
      </button>
    </Html>)}
  </group>;
}
