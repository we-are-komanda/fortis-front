"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Box3, Group, Line, Mesh, Vector3 } from "three";
import { createFactoryBimModel, disposeFactoryBimModel, FACTORY_BIM_LAYERS } from "./factory-bim-model";
import { createFactoryCampusModel } from "./factory-campus-model";

class RenderBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onError();}
  render(){return this.state.failed?null:this.props.children;}
}

function FactoryScene({model,visible,selected,onSelect,onError}:{model:Group;visible:Record<string,boolean>;selected:Mesh|Line|null;onSelect:(id:string)=>void;onError:()=>void}) {
  const {gl,invalidate}=useThree();
  useEffect(()=>{
    // eslint-disable-next-line react-hooks/immutability -- Three.js owns this mutable scene graph.
    for(const group of model.children)group.visible=visible[group.userData.layer]??true;
    invalidate();
  },[model,visible,invalidate]);
  useEffect(()=>{
    const canvas=gl.domElement;
    const lost=(event:Event)=>{event.preventDefault();onError();};
    canvas.addEventListener("webglcontextlost",lost);
    return ()=>canvas.removeEventListener("webglcontextlost",lost);
  },[gl,onError]);
  const click=(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();onSelect(event.object.userData.objectId??"");};
  return <>
    <primitive object={model} dispose={null} onClick={click}/>
    {selected&&visible[selected.userData.layer]&&<boxHelper args={[selected,"#facc15"]}/>}
  </>;
}

type ViewerProps = {returnHref:string; campus?:false} | {campus:true; unitId:string; onSelectUnit:(id:string)=>void; onReturn:()=>void};
export function FactoryBimViewer(props:ViewerProps) {
  const model=useMemo(()=>props.campus?createFactoryCampusModel():createFactoryBimModel(),[props.campus]);
  const elements=useMemo(()=>{
    const list:(Mesh|Line)[]=[];model.traverse(o=>{if(o instanceof Mesh||o instanceof Line)list.push(o)});return list;
  },[model]);
  const [visible,setVisible]=useState<Record<string,boolean>>(()=>Object.fromEntries(FACTORY_BIM_LAYERS.map(l=>[l.id,true])));
  const [selectedId,setSelectedId]=useState(()=>props.campus?elements.find(o=>o.userData.unitId===props.unitId)?.userData.objectId??"":"");
  const selectElement=(id:string)=>{
    setSelectedId(id);
    if(props.campus)props.onSelectUnit(elements.find(o=>o.userData.objectId===id)?.userData.unitId??"");
  };
  const [exporting,setExporting]=useState(false);
  const [exportError,setExportError]=useState("");
  const [webgl,setWebgl]=useState<boolean|null>(null);
  const [failed,setFailed]=useState(false);
  const exportingRef=useRef(false);
  const onError=useCallback(()=>setFailed(true),[]);
  useEffect(()=>()=>disposeFactoryBimModel(model),[model]);
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      let context:WebGL2RenderingContext|null=null;
      try {context=document.createElement("canvas").getContext("webgl2");}catch{/* Unsupported browser. */}
      setWebgl(!!context);context?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    return ()=>cancelAnimationFrame(frame);
  },[]);
  const selected=elements.find(o=>o.userData.objectId===selectedId)??null;
  const position=selected?.getWorldPosition(new Vector3());
  const size=selected?new Box3().setFromObject(selected).getSize(new Vector3()):null;
  const layerLabel=(id:string)=>FACTORY_BIM_LAYERS.find(l=>l.id===id)?.label??id;
  const allVisible=(value:boolean)=>setVisible(Object.fromEntries(FACTORY_BIM_LAYERS.map(l=>[l.id,value])));
  const exportGlb=async()=>{
    if(exportingRef.current)return;
    exportingRef.current=true;setExporting(true);setExportError("");
    let snapshot:Group|undefined;
    try {
      // Snapshot the layer choice before the async exporter loads; shared geometry stays read-only.
      snapshot=model.clone(true);
      for(const group of snapshot.children)group.visible=visible[group.userData.layer]??true;
      const {GLTFExporter}=await import("three/addons/exporters/GLTFExporter.js");
      const result=await new GLTFExporter().parseAsync(snapshot,{binary:true,onlyVisible:true});
      if(!(result instanceof ArrayBuffer))throw new Error("Экспорт не вернул GLB");
      const url=URL.createObjectURL(new Blob([result],{type:"model/gltf-binary"}));
      const link=document.createElement("a");link.href=url;link.download=props.campus?"Fortis-Factory-Campus.glb":"Fortis-Factory-BIM.glb";
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setExportError(error instanceof Error?error.message:"Экспорт GLB не удался");}
    finally {snapshot?.clear();exportingRef.current=false;setExporting(false);}
  };
  const button="min-h-11 rounded border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50";
  return <section className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-slate-950 text-slate-100" aria-label="Factory BIM" data-factory-bim data-unit-count={props.campus?4:1} data-visible-layers={Object.values(visible).filter(Boolean).length} data-selected={selectedId}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-5 py-3">
      <div><h1 className="text-lg font-semibold">Factory BIM · {props.campus?"4 производственных комплекса":"промышленный комплекс"}</h1><p className="text-sm text-slate-400">15 слоёв · демонстрационная модель · локальные метры</p></div>
      <div className="flex flex-wrap gap-2">{props.campus?<button className={button} onClick={props.onReturn}>Вернуться к сценарию</button>:<Link className={button} href={props.returnHref}>Вернуться к 2D-карте</Link>}<button className={button} disabled={exporting||!Object.values(visible).some(Boolean)} onClick={()=>void exportGlb()}>{exporting?"Экспортируется…":"Экспорт GLB"}</button></div>
    </header>
    {exportError&&<p role="alert" className="bg-red-950 p-3">{exportError}</p>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="max-h-64 w-full shrink-0 overflow-y-auto border-b border-slate-700 bg-slate-900 p-4 md:max-h-none md:w-60 md:border-r" aria-label="Слои BIM-модели">
        <h2 className="mb-3 font-semibold">Инженерные слои</h2>
        <div className="mb-3 flex gap-2"><button className={button} onClick={()=>allVisible(true)}>Все</button><button className={button} onClick={()=>allVisible(false)}>Скрыть все</button></div>
        <div className="grid grid-cols-2 gap-1 md:grid-cols-1">{FACTORY_BIM_LAYERS.map(layer=><label key={layer.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-slate-800"><input type="checkbox" className="size-4 shrink-0 accent-sky-500" checked={visible[layer.id]} onChange={e=>setVisible(v=>({...v,[layer.id]:e.target.checked}))}/>{layer.label}</label>)}</div>
      </aside>
      <div className="relative min-h-[400px] min-w-0 flex-1" data-testid="factory-bim-canvas">
        {webgl===true&&!failed?<RenderBoundary onError={onError}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:props.campus?[300,220,320]:[112,74,122],fov:45,near:.1,far:1800}} onPointerMissed={()=>selectElement("")}>
          <color attach="background" args={["#16202f"]}/><ambientLight intensity={1.1}/><hemisphereLight intensity={.6} color="#bde4ff" groundColor="#35404a"/><directionalLight position={[50,90,35]} intensity={2.2}/>
          <FactoryScene model={model} visible={visible} selected={selected} onSelect={selectElement} onError={onError}/>
          <OrbitControls makeDefault target={[0,5,-6]} maxPolarAngle={Math.PI/2.06} minDistance={12} maxDistance={props.campus?900:350}/>
        </Canvas></RenderBoundary>:<p role="status" className="p-6">{webgl===null?"Подготовка 3D…":"3D недоступен. Список элементов, слои и экспорт GLB доступны."}</p>}
        <p className="pointer-events-none absolute bottom-3 left-3 right-3 rounded bg-slate-950/80 px-3 py-2 text-xs">Перетаскивание — вращение · правая кнопка — перемещение · колесо — масштаб · щелчок — свойства</p>
      </div>
      <aside className="w-full shrink-0 overflow-y-auto border-t border-slate-700 bg-slate-900 p-4 md:w-64 md:border-l md:border-t-0" aria-label="Свойства элемента">
        <h2 className="mb-3 font-semibold">Элемент модели</h2>
        <label className="block text-sm">Выбрать элемент<select aria-label="Элемент BIM" className="mt-2 min-h-11 w-full rounded border border-slate-600 bg-slate-900 p-2" value={selectedId} onChange={e=>selectElement(e.target.value)}><option value="">Не выбран</option>{elements.map(o=><option key={o.userData.objectId} value={o.userData.objectId}>{layerLabel(o.userData.layer)} · {o.userData.objectId}{visible[o.userData.layer]?"":" · скрыт"}</option>)}</select></label>
        {selected&&position&&size?<dl className="mt-4 space-y-2 break-words text-sm">
          <dt className="text-slate-400">Идентификатор</dt><dd>{selectedId}</dd>
          <dt className="text-slate-400">Слой</dt><dd>{layerLabel(selected.userData.layer)}{visible[selected.userData.layer]?"":" · скрыт"}</dd>
          <dt className="text-slate-400">Положение X / Y / Z, м (Y вверх)</dt><dd>{position.toArray().map(n=>n.toFixed(2)).join(" / ")}</dd>
          <dt className="text-slate-400">Габариты X × Y × Z, м</dt><dd>{size.toArray().map(n=>n.toFixed(2)).join(" × ")}</dd>
        </dl>:<p className="mt-4 text-sm text-slate-400">Выберите элемент в сцене или списке.</p>}
        <p className="mt-5 text-xs leading-relaxed text-slate-400">Иллюстративная модель, без геопривязки. Экспорт включает видимые слои. Размещения и расчёты проекта ведутся на 2D-карте.</p>
        <a href="https://github.com/studio-public-demos/factory-bim" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-sky-300 underline">Источник · MIT</a>
      </aside>
    </div>
  </section>;
}
