"use client";
import { Suspense, memo, useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Edges, Html, OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import { PMREMGenerator, Vector3 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { withBasePath } from "@/shared/lib/base-path";
import { chemicalAssets, chemicalFocus, chemicalObjects, chemicalZones, type ChemicalObject } from "../../domain/chemical-site";
import { ChemicalStructure } from "./chemical-structures";

type Props = { selected?: string; focus?: string; revision: number; dark: boolean; showEquipment: boolean; onSelect: (id: string) => void; onError: () => void; onReady: () => void };
function Camera({ focus, revision, onError, onReady }: Pick<Props, "focus" | "revision" | "onError" | "onReady">) {
  const { camera, controls, gl, scene, invalidate, size } = useThree();
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onError(); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    const room = new RoomEnvironment(), generator = new PMREMGenerator(gl);
    const environment = generator.fromScene(room);
    // eslint-disable-next-line react-hooks/immutability -- Three owns this imperative scene, not React state.
    scene.environment = environment.texture;
    room.dispose(); generator.dispose(); invalidate(); onReady();
    return () => { gl.domElement.removeEventListener("webglcontextlost", lost); scene.environment = null; environment.dispose(); };
  }, [gl, scene, invalidate, onError, onReady]);
  useEffect(() => {
    if (!controls || !("target" in controls)) return;
    const f = chemicalFocus(focus), span = f.span * Math.max(1, size.height / size.width);
    const target = new Vector3(f.x, f.height * .45, -f.y);
    const orbit = controls as unknown as { target: Vector3; update: () => void };
    orbit.target.copy(target);
    camera.position.copy(target).add(new Vector3(-.65 * span, .65 * span, .8 * span));
    camera.lookAt(target); camera.updateMatrixWorld(); orbit.update(); invalidate();
  }, [camera, controls, focus, revision, invalidate, size.width, size.height]);
  return null;
}
function Box({ at, size, color = "#bcc8cd" }: { at: [number, number, number]; size: [number, number, number]; color?: string }) {
  return <mesh position={at}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={.78} metalness={.15} /></mesh>;
}
function Generated({ assetId }: { assetId: string }) {
  const source = useGLTF(withBasePath(chemicalAssets.find(a => a.id === assetId)!.url)).scene;
  // Only transforms are cloned: instances share cached geometry, textures and materials.
  const instance = useMemo(() => source.clone(true), [source]);
  return <primitive object={instance} dispose={null} />;
}
function Parametric({ object: o }: { object: ChemicalObject }) {
  const { width: w, depth: d, height: h } = o;
  if (o.assetId) return <Suspense fallback={<Box at={[0, h / 2, 0]} size={[w, h, d]} color="#d4b46b" />}><Generated assetId={o.assetId} /></Suspense>;
  if (o.kind==="building"||o.kind==="frame") return <ChemicalStructure object={o}/>;
  if (o.kind === "tank" || o.kind === "stack" || (o.kind === "basin" && w === d)) return <group>
    <mesh position={[0,h/2,0]}><cylinderGeometry args={[w/2,w/2,h,32,1,o.kind==="basin"]}/><meshStandardMaterial color={o.kind === "stack" ? "#a9acb2" : "#d1d9dc"} metalness={.3} roughness={.6}/></mesh>
    {o.kind === "basin" ? <mesh rotation={[-Math.PI/2,0,0]} position={[0,h-.5,0]}><circleGeometry args={[w/2-.2,32]}/><meshStandardMaterial color="#427e92" roughness={.3}/></mesh> : <>
      <mesh position={[0,h+.35,0]}><cylinderGeometry args={[w*.45,w*.51,.7,32]}/><meshStandardMaterial color="#ebedeb" roughness={.6}/></mesh>
      <Box at={[w/2+.3,h/2,0]} size={[.3,h,.3]} color="#d8b454"/>
      {Array.from({length:Math.ceil(h/.65)},(_,i)=><Box key={i} at={[w/2+.5,i*.65,.3]} size={[.7,.08,.7]} color="#c3b371"/>)}
    </>}
  </group>;
  if (o.kind === "vessel") return <group>
    <mesh rotation={[0,0,Math.PI/2]} position={[0,h-d/2,0]}><cylinderGeometry args={[d/2,d/2,w,24]}/><meshStandardMaterial color="#c6d0d4" metalness={.45} roughness={.5}/></mesh>
    {[-w*.3,w*.3].map(x=><Box key={x} at={[x,.6,0]} size={[.6,1.2,d]} color="#657d89"/>)}
  </group>;
  if (o.kind === "canopy") return <group>
    {[-w/2,w/2].flatMap(x=>[-d/2,d/2].map(z=><Box key={`${x}:${z}`} at={[x,h/2,z]} size={[.5,h,.5]} color="#778b93"/>))}
    <Box at={[0,h,0]} size={[w+.6,.4,d+.6]} color="#aebbc0"/>
  </group>;
  if (o.kind === "basin") return <group>
    <Box at={[0,h/2,0]} size={[w,h,d]} color="#a9b7b5"/>
    <Box at={[0,h+.02,0]} size={[w-1,.05,d-1]} color="#427e92"/>
    <Box at={[0,h+.3,0]} size={[1,.4,d]} color="#d7d8cd"/>
  </group>;
  return <Box at={[0,h/2,0]} size={[w,h,d]}/>;
}
const PlantObjects = memo(function PlantObjects({ selected, onSelect, onlyObject, showEquipment }: Pick<Props,"selected"|"onSelect"|"showEquipment"> & {onlyObject?:string}) {
  return chemicalObjects.filter(o=>(!onlyObject||o.id===onlyObject)&&(showEquipment||!o.assetId)).map(o => <group key={o.id} name={o.id} position={[o.x,.12,-o.y]} onClick={event => { event.stopPropagation(); onSelect(o.id); }}>
    <Parametric object={o}/>
    {selected===o.id && <mesh position={[0,.02,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[o.width+.4,o.depth+.4]}/><meshBasicMaterial visible={false}/><Edges color="#2563eb" lineWidth={2}/></mesh>}
  </group>);
});
const Infrastructure = memo(function Infrastructure({ dark }: {dark:boolean}) {
  return <group>
    <Box at={[0,-.55,0]} size={[1200,1,900]} color={dark?"#384b46":"#b8c5b0"}/>
    {chemicalZones.map(z=><Box key={z.id} at={[z.x,-.02,-z.y]} size={[240,.1,220]} color={dark?"#505d60":"#d1d6d4"}/>)}
    {[-560,-280,0,280,560].map(x=><Box key={x} at={[x,.02,0]} size={[12,.1,830]} color="#677477"/>)}
    {[-410,-135,135,410].map(z=><Box key={z} at={[0,.02,z]} size={[1132,.1,12]} color="#677477"/>)}
    {[-590,590].map(x=><Box key={x} at={[x,1.1,0]} size={[.25,2.2,880]} color="#899b97"/>)}
    {[-440,440].map(z=><Box key={z} at={[0,1.1,z]} size={[1180,2.2,.25]} color="#899b97"/>)}
    {/* Schematic pipe rack: a visual utility corridor, not a process connection model. */}
    {[-130,140].map(z=><group key={z}>
      <Box at={[0,5,z]} size={[1000,.6,3]} color="#a8b3b5"/>
      {Array.from({length:34},(_,i)=><Box key={i} at={[-495+i*30,2.5,z]} size={[.4,5,3]} color="#7b8b91"/>)}
      {[-.8,.8].map(offset=><mesh key={offset} rotation={[0,0,Math.PI/2]} position={[0,5.6,z+offset]}><cylinderGeometry args={[.22,.22,1000,8]}/><meshStandardMaterial color={offset<0?"#91aab7":"#c9c1a4"}/></mesh>)}
    </group>)}
    {Array.from({length:60},(_,i)=><group key={i} position={[370+(i%15)*3,0,230+Math.floor(i/15)*14]}>
      <Box at={[0,.1,0]} size={[.1,.05,5.5]} color="#e7e3c8"/>
      <Box at={[1.4,.1,-2.7]} size={[2.8,.05,.1]} color="#e7e3c8"/>
    </group>)}
  </group>;
});
export const ChemicalPlant = memo(function ChemicalPlant({dark, selected, onSelect, showEquipment=false}: Pick<Props,"dark"|"selected"|"onSelect"> & {showEquipment?:boolean}) {
  return <group name="chemical-campus@1">
    <Infrastructure dark={dark}/>
    <PlantObjects selected={selected} onSelect={onSelect} showEquipment={showEquipment}/>
  </group>;
});
export default function ChemicalSite3D(props: Props) {
  const inspected=chemicalObjects.find(o=>o.id===props.focus);
  return <Canvas camera={{position:[-900,900,1100],fov:42,near:.05,far:10000}} scene={{environmentIntensity:.3}} frameloop="demand" dpr={[1,1.5]} gl={{antialias:true}} onPointerMissed={()=>props.onSelect("")}>
    <color attach="background" args={[props.dark?"#263b35":"#dce4d8"]}/>
    <ambientLight intensity={.45}/><directionalLight position={[-400,900,300]} intensity={1.4}/>
    {inspected ? <>
      <Box at={[inspected.x,-.1,-inspected.y]} size={[2000,.2,2000]} color={props.dark?"#384b46":"#c3c9c6"}/>
      <PlantObjects selected={props.selected} onSelect={props.onSelect} onlyObject={inspected.id} showEquipment={props.showEquipment}/>
    </> : <ChemicalPlant {...props}/>}
    {chemicalZones.filter(z=>!props.focus||z.id===props.focus).map(z=><Html key={z.id} position={[z.x,2,-z.y+95]} center style={{pointerEvents:"none",whiteSpace:"nowrap",fontSize:11,color:props.dark?"#f4f6fa":"#172336",background:props.dark?"#263b35e6":"#edf1e8e6",padding:"3px 6px"}}>{z.id} · {z.name}</Html>)}
    <OrbitControls makeDefault enableDamping={false} minDistance={1} maxDistance={3500} maxPolarAngle={Math.PI/2.04}/>
    <Camera {...props}/>
    <LoadingAssets/>
  </Canvas>;
}
function LoadingAssets() {
  const {active}=useProgress();
  return active ? <Html center position={[0,50,0]}><span role="status" style={{display:"block",whiteSpace:"nowrap",background:"#fff",color:"#172336",padding:"8px 12px"}}>Загрузка оборудования…</span></Html> : null;
}
