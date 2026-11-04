"use client";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import { BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, LineSegments, Object3D, PlaneGeometry, Shape } from "three";
import { protectionRule, sectorColors, darkSectorColors, type MotionMarker } from "../../domain/mass-motion";
import { positionAt, type Track } from "../../domain/scenario-playback";
import { trees, trackColors, darkTrackColors, contours, roads, waterOutline, terrainGrid, terrainElevation, zoomPixelsPerKm, type ScenarioLayers } from "../../domain/scenario-site";

import type { ProjectScenario } from "../../domain/project-scenario";
import { ProjectSite3D } from "./project-scenario-site";
import { FactoryCampus } from "./factory-campus-3d";

type Props = { projectScene?: ProjectScenario; protectionRadiusM?: number; markers?: MotionMarker[]; selectedObject?: string; onSelectObject: (id: string) => void; onZoom:(zoom:number)=>void; tracks: Track[]; timeMs: number; layers: ScenarioLayers; zoom: number; fit: number; preview: boolean; dark: boolean; onReady: () => void; onError: () => void };
function Lifecycle({ onReady, onError, zoom, fit, onZoom }: Pick<Props, "onReady" | "onError" | "zoom" | "fit" | "onZoom">) {
  const { gl, camera, invalidate, controls, size } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (e: Event) => { e.preventDefault(); onError(); };
    canvas.addEventListener("webglcontextlost", lost);
    onReady();
    return () => { canvas.removeEventListener("webglcontextlost", lost); };
  }, [gl, onReady, onError]);
  useEffect(() => {
    camera.position.set(12, 18, 22);
    if (controls && "reset" in controls) (controls as { reset: () => void }).reset();
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); invalidate();
  }, [camera, controls, fit, invalidate]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- Three.js owns an imperative camera, not React state.
    camera.zoom = zoom * zoomPixelsPerKm(size.width, size.height);
    if ("setViewOffset" in camera) camera.setViewOffset(size.width, size.height, size.width > 520 ? size.width * .04 : 0, -size.height * .03, size.width, size.height);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(); invalidate();
  }, [camera, invalidate, zoom, size.width, size.height, controls, fit]);
  return <OrbitControls makeDefault enableDamping={false} minZoom={.01*zoomPixelsPerKm(size.width,size.height)} maxZoom={128*zoomPixelsPerKm(size.width,size.height)} maxPolarAngle={Math.PI / 2.1}
    onEnd={()=>onZoom(Math.max(.01,Math.min(128,camera.zoom/zoomPixelsPerKm(size.width,size.height))))}/>;
}
const initialCamera = { position: [12, 18, 22] as [number, number, number], zoom: 35, near: .1, far: 150 };
function ScenarioMap3D(props: Props) {
  const { tracks, timeMs, layers, dark, preview, projectScene, protectionRadiusM = protectionRule.radiusM } = props;
  const terrain = layers.terrain && !projectScene;
  const contourPoints = useMemo(() => contours.map(path => path.map(([x,y]) => [x/1000, terrainElevation(x,y)/1000+.0005, -y/1000] as [number,number,number])), []);
  const roadPoints = useMemo(() => roads.map(road => road.map(([x,y]) => [x/1000, (terrain ? terrainElevation(x,y) : 0)/1000+.0006, -y/1000] as [number,number,number])), [terrain]);
  const trackPoints = useMemo(() => tracks.map(track => ({ flight: track.samples.map(s => [s.xM/1000,s.zM/1000,-s.yM/1000] as [number,number,number]), ground: track.samples.map(s => [s.xM/1000,.045,-s.yM/1000] as [number,number,number]) })), [tracks]);
  const water = useMemo(() => {
    const shape = new Shape();
    waterOutline.forEach(([x, y], i) => i ? shape.lineTo(x / 1000, y / 1000) : shape.moveTo(x / 1000, y / 1000));
    shape.closePath(); return shape;
  }, []);
  const ring = useMemo(() => Array.from({ length: 129 }, (_, i) => [10 * Math.cos(i / 128 * Math.PI * 2), .02, 10 * Math.sin(i / 128 * Math.PI * 2)] as [number, number, number]), []);
  const protectionRing = useMemo(() => Array.from({ length: 129 }, (_, i) => {
    const angle = i / 128 * Math.PI * 2, x = protectionRadiusM * Math.cos(angle), y = protectionRadiusM * Math.sin(angle);
    return [x / 1000, ((terrain ? terrainElevation(x, y) : 0) + 3) / 1000, -y / 1000] as [number, number, number];
  }), [terrain, protectionRadiusM]);
  const ground = dark ? "#283b37" : "#e7ecdf";
  return <Canvas orthographic camera={initialCamera} frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true }}>
    <color attach="background" args={[ground]} />
    <ambientLight intensity={1.6} /><directionalLight position={[-8, 18, 10]} intensity={1.6} />
    <group>
    <Terrain dark={dark} visible={terrain} />
    {terrain && <group>
      {props.zoom<8 && <TerrainGrid dark={dark}/>}
      {contourPoints.map((path, i) => <Line toneMapped={false} key={i} points={path} color={dark ? "#587464" : "#aebda0"} lineWidth={.7} transparent opacity={.85} />)}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .0003, 0]}><shapeGeometry args={[water]} /><meshBasicMaterial depthTest={false} toneMapped={false} color={dark ? "#31576a" : "#b7dce3"} /></mesh>
      <Forest dark={dark} />
      {props.zoom >= 8 && <><Html center position={[-.5, .08, -.4]} style={{pointerEvents:"none",whiteSpace:"nowrap",fontSize:11,color:dark?"#a4b6cd":"#60738c"}}>Лесной массив</Html>
      <Html center position={[-.5, .1, .4]} style={{pointerEvents:"none",whiteSpace:"nowrap",fontSize:11,color:dark?"#a4b6cd":"#60738c"}}>Холмы</Html></>}
    </group>}
    {!projectScene && roadPoints.map((road, i) => <Line key={i} toneMapped={false}
      points={road}
      color={dark ? "#808a86" : "#faf9f1"} worldUnits lineWidth={.012} />)}
    {layers.enterprise && (projectScene ? <ProjectSite3D scene={projectScene} zoom={props.zoom} selected={props.selectedObject} onSelect={props.onSelectObject}/> : <group scale={.001}>
      <FactoryCampus selected={props.selectedObject} onSelect={props.onSelectObject}/>
    </group>)}
    {props.markers && <Line name="training-protection-boundary" points={protectionRing} color={dark ? "#5eead4" : "#047857"} lineWidth={2} toneMapped={false} />}
    {layers.radius && <Line toneMapped={false} points={ring} color={dark ? "#a4b6cd" : "#60738c"} dashed dashSize={.14} gapSize={.14} lineWidth={1} />}
    {tracks.map((track, i) => {
      const p = positionAt(track, timeMs);
      const color = (dark ? darkTrackColors : trackColors)[track.id];
      const start = track.samples[0];
      const opacity = preview && i > 0 ? .4 : 1;
      return <group key={track.id}>
        {layers.tracks && <Line toneMapped={false} points={trackPoints[i].flight} color={color} lineWidth={2.5} transparent opacity={opacity} dashed={!props.markers && !preview && i > 0} dashSize={.2} gapSize={.1} />}
        {!props.markers && <mesh position={[p.xM / 1000, p.zM / 1000, -p.yM / 1000]}><sphereGeometry args={[.1 / props.zoom,16,12]} /><meshBasicMaterial toneMapped={false} color={color} /></mesh>}
        {layers.tracks && <Line toneMapped={false} points={trackPoints[i].ground} color={color} transparent opacity={opacity*.6} lineWidth={1} dashed dashSize={.08} gapSize={.12}/>}
        <Html center position={[start.xM/1000,start.zM/1000,-start.yM/1000]} style={{pointerEvents:"none",opacity}}><span style={{display:"grid",placeItems:"center",width:21,height:21,borderRadius:"50%",border:`2px solid ${color}`,background:dark?"#18212e":"#fff",color,fontSize:11,fontWeight:700}}>{track.label}</span></Html>
      </group>;
    })}
    </group>
    {props.markers && layers.radius && [["С",0,-10.5],["В",10.5,0],["Ю",0,10.5],["З",-10.5,0]].map(([label,x,z]) => <Html key={String(label)} center position={[Number(x),.1,Number(z)]} style={{pointerEvents:"none",fontSize:12,color:dark?"#afbed1":"#526782"}}>{label}</Html>)}
    {props.markers && <MassMarkers markers={props.markers} zoom={props.zoom} dark={dark} showTrails={layers.tracks} terrain={terrain} />}
    <Lifecycle {...props} />
  </Canvas>;
}

function Terrain({dark,visible}:{dark:boolean;visible:boolean}) {
  const geometry=useMemo(()=>{
    const mesh=new PlaneGeometry(32,32,160,160);mesh.rotateX(-Math.PI/2);
    const positions=mesh.attributes.position,colors=[];
    const low=new Color(dark?"#283b37":"#e7ecdf"),high=new Color(dark?"#385248":"#c6d6b7");
    for(let i=0;i<positions.count;i++){
      const localGrid = (value:number) => { const t=value/16; return Math.abs(t)<=.5?t*2.4:Math.sign(t)*(1.2+(Math.abs(t)-.5)*29.6); };
      const x=localGrid(positions.getX(i)),z=localGrid(positions.getZ(i));
      const height=visible?terrainElevation(x*1000,-z*1000)/1000:0;
      positions.setXYZ(i,x,height,z);
      const color=low.clone().lerp(high,visible ? .16 + Math.min(.4,height / .08 * .4) : 0);colors.push(color.r,color.g,color.b);
    }
    mesh.setAttribute('color',new Float32BufferAttribute(colors,3));mesh.computeVertexNormals();return mesh;
  },[dark,visible]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry}><meshStandardMaterial vertexColors roughness={1}/></mesh>;
}
function Forest({dark}:{dark:boolean}){
  const ref=useRef<InstancedMesh>(null);
  useLayoutEffect(()=>{
    if(!ref.current)return;
    const object=new Object3D();
    trees.forEach(([x,y],i)=>{
      const radius=.0045;
      object.position.set(x/1000,terrainElevation(x,y)/1000+.009,-y/1000);
      object.scale.set(radius,.006,radius*.95);object.updateMatrix();
      ref.current!.setMatrixAt(i,object.matrix);
      ref.current!.setColorAt(i,new Color(dark?(i%3?"#385f50":"#4e7961"):(i%3?"#bdcfad":"#94b18a")));
    });
    ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;
  },[dark]);
  return <instancedMesh ref={ref} args={[undefined,undefined,trees.length]}><sphereGeometry args={[1,12,8]}/><meshBasicMaterial toneMapped={false}/></instancedMesh>;
}
function TerrainGrid({dark}:{dark:boolean}) {
  const geometry=useMemo(()=>{
    const vertices:number[]=[];
    terrainGrid.forEach(path=>path.slice(1).forEach(([x,y],i)=>{
      const [previousX,previousY]=path[i];
      vertices.push(previousX/1000,terrainElevation(previousX,previousY)/1000+.003,-previousY/1000,x/1000,terrainElevation(x,y)/1000+.003,-y/1000);
    }));
    const mesh=new BufferGeometry();mesh.setAttribute("position",new Float32BufferAttribute(vertices,3));return mesh;
  },[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <lineSegments geometry={geometry}><lineBasicMaterial toneMapped={false} color={dark?"#587464":"#aebda0"} transparent opacity={.18}/></lineSegments>;
}

function MassMarkers({ markers, zoom, dark, showTrails, terrain }: { markers: MotionMarker[]; zoom: number; dark: boolean; showTrails: boolean; terrain: boolean }) {
  const invalidate = useThree(state => state.invalidate);
  const trails = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(6000), 3));
    geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(6000), 3));
    return geometry;
  }, []);
  useEffect(() => () => trails.dispose(), [trails]);
  const ref = useRef<InstancedMesh>(null);
  const trailRef = useRef<LineSegments>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    const trailGeometry = trailRef.current?.geometry;
    if (!mesh || !trailGeometry) return;
    const object = new Object3D();
    mesh.count = markers.length;
    markers.forEach((marker, index) => {
      // Lift map symbols slightly above the displayed terrain; this is not a flight altitude.
      const height = (x: number, y: number) => ((terrain ? terrainElevation(x, y) : 0) + 8) / 1000;
      object.scale.setScalar((marker.triggered ? .22 : marker.neutralized ? .18 : .14) / zoom);
      object.position.set(marker.xM / 1000, height(marker.xM, marker.yM), -marker.yM / 1000);
      object.updateMatrix();
      mesh.setMatrixAt(index, object.matrix);
      const color = new Color(marker.neutralized ? (dark ? "#c4b5fd" : "#7c3aed") : marker.triggered ? (dark ? "#5eead4" : "#047857") : (dark ? darkSectorColors : sectorColors)[marker.sector]);
      mesh.setColorAt(index, color);
      trailGeometry.attributes.position.setXYZ(index * 2, marker.tail.xM / 1000, height(marker.tail.xM, marker.tail.yM), -marker.tail.yM / 1000);
      trailGeometry.attributes.position.setXYZ(index * 2 + 1, marker.xM / 1000, height(marker.xM, marker.yM), -marker.yM / 1000);
      trailGeometry.attributes.color.setXYZ(index * 2, color.r, color.g, color.b);
      trailGeometry.attributes.color.setXYZ(index * 2 + 1, color.r, color.g, color.b);
    });
    trailGeometry.setDrawRange(0, markers.length * 2);
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.color.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [markers, zoom, dark, terrain, invalidate]);
  return <group><lineSegments ref={trailRef} geometry={trails} frustumCulled={false} visible={showTrails}><lineBasicMaterial vertexColors toneMapped={false} transparent opacity={.7} /></lineSegments><instancedMesh name="mass-motion-markers" ref={ref} args={[undefined, undefined, 1000]} frustumCulled={false}>
    <sphereGeometry args={[1, 8, 6]} /><meshBasicMaterial toneMapped={false} />
  </instancedMesh></group>;
}

export default memo(ScenarioMap3D);
