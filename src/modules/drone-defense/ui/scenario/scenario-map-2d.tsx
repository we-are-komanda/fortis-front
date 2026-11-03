import { memo } from "react";
import { protectionRule, sectorColors, type MotionMarker } from "../../domain/mass-motion";
import { positionAt, type Track } from "../../domain/scenario-playback";
import { trees, trackColors, contours, roads, waterOutline, terrainGrid, type ScenarioLayers } from "../../domain/scenario-site";
import { FactoryCampusPlan } from "./factory-campus-plan";
import styles from "./scenario.module.css";

function Map2D({ markers, tracks, timeMs, layers, zoom, preview, selectedObject, onSelectObject, onFocusCampus }: { markers?: MotionMarker[]; selectedObject?: string; onFocusCampus:()=>void; onSelectObject: (id:string)=>void; tracks: Track[]; timeMs: number; layers: ScenarioLayers; zoom: number; preview: boolean }) {
  const extent = 11000 / zoom;
  const points = (coords: number[][]) => coords.map(([x, y]) => `${x},${-y}`).join(" ");
  return <svg className={styles.map2d} role="img" aria-label="2D: синтетическая площадка, север сверху, радиус 10 километров" viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}>
    <rect x={-extent*2} y={-extent*2} width={extent*4} height={extent*4} fill="var(--scene-ground)" />
    {layers.terrain && <g>
      {terrainGrid.map((path,i)=><polyline key={`grid-${i}`} points={points(path)} fill="none" stroke="var(--scene-contour)" strokeOpacity=".18" strokeWidth=".5" vectorEffect="non-scaling-stroke" />)}
      {contours.map((path,i)=><polyline key={i} points={points(path)} fill="none" stroke="var(--scene-contour)" strokeWidth=".7" vectorEffect="non-scaling-stroke" />)}
      <polygon points={points(waterOutline)} fill="var(--scene-water)" />
      {trees.map(([x, y], i) => <circle key={i} cx={x} cy={-y} r={4.5} fill="var(--scene-tree)" opacity={.55 + (i % 4) * .15} />)}
      {zoom >= 8 && <><text x="-500" y="-220" className={styles.mapLabel} style={{fontSize:320/zoom}}>Лесной массив</text>
      <text x="-500" y="400" className={styles.mapLabel} style={{fontSize:320/zoom}}>Холмы</text></>}
    </g>}
    {roads.map((road, i) => <g key={i}><polyline points={points(road)} fill="none" stroke="#c8c7b5" strokeWidth="14" strokeLinejoin="round"/><polyline points={points(road)} fill="none" stroke="var(--scene-road)" strokeWidth="12" strokeLinejoin="round"/></g>)}
    {layers.enterprise && <FactoryCampusPlan selected={selectedObject} onSelect={onSelectObject}/>}
    {markers && <g data-protection-zone aria-label="Учебная зона защиты">
      <circle r={protectionRule.radiusM} fill="none" stroke="var(--protection)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {zoom >= 8 && <text textAnchor="middle" y={-protectionRule.radiusM - 180 / zoom} fill="var(--protection)" fontSize={240 / zoom}>Учебная зона защиты</text>}
    </g>}
    {zoom<8 && <g role="button" tabIndex={0} aria-label="Приблизить предприятие" onClick={onFocusCampus} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onFocusCampus();}}}>
      <rect x={-900/zoom} y={-300/zoom} width={1800/zoom} height={600/zoom} rx={80/zoom} fill="var(--surface)" stroke="var(--accent)" strokeWidth={20/zoom}/>
      <text textAnchor="middle" y={80/zoom} fill="var(--ink)" fontSize={240/zoom}>Предприятие · 4 комплекса</text>
    </g>}
    {layers.radius && <circle r="10000" fill="none" stroke="var(--scene-contour)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="140 100" />}
    {tracks.map((track, i) => {
      const p = positionAt(track, timeMs);
      return <g key={track.id} style={{ color: `var(--track-${track.id}, ${trackColors[track.id]})`, opacity: preview && i > 0 ? .4 : 1 }}>
        {layers.tracks && <polyline points={track.samples.map(s => `${s.xM},${-s.yM}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray={!markers && i ? "180 100" : undefined} />}
        {!markers && <><circle cx={p.xM} cy={-p.yM} r={220/zoom} fill="var(--scene-roof)" stroke="currentColor" strokeWidth={60/zoom} />
        <text x={p.xM + 340/zoom} y={-p.yM + 120/zoom} fill="currentColor" fontSize={440/zoom} fontWeight="700">{track.label}</text></>}
      </g>;
    })}
    {markers?.map(marker => <g key={marker.id} data-motion-marker={marker.triggered ? undefined : ""} data-protection-signal={marker.triggered ? marker.id : undefined} data-sector={marker.sector} style={{color:marker.triggered ? "var(--protection)" : sectorColors[marker.sector]}}>
      {layers.tracks && !marker.triggered && <line x1={marker.tail.xM} y1={-marker.tail.yM} x2={marker.xM} y2={-marker.yM} stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity=".7" />}
      {marker.triggered ? <path d={`M${marker.xM},${-marker.yM - 150 / zoom} l${150 / zoom},${150 / zoom} l${-150 / zoom},${150 / zoom} l${-150 / zoom},${-150 / zoom} Z`} fill="currentColor"><title>Объект {marker.id + 1}: учебное срабатывание</title></path> : <circle cx={marker.xM} cy={-marker.yM} r={90/zoom} fill="currentColor" />}
    </g>)}
    <text x={-extent * .95} y={-extent * .9} className={styles.mapLabel} style={{fontSize:extent * .06}}>С ↑</text>
  </svg>;
}

export const ScenarioMap2D = memo(Map2D);
