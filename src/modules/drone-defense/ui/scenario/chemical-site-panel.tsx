"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Component, useCallback, useState, type ReactNode } from "react";
import { chemicalAssets, chemicalFocus, chemicalKinds, chemicalObjects, chemicalSiteVersion, chemicalZones } from "../../domain/chemical-site";
import { withBasePath } from "@/shared/lib/base-path";
import styles from "./chemical-site.module.css";
import { ChemicalSitePlan } from "./chemical-site-plan";

const Scene = dynamic(()=>import("./chemical-site-3d"), {ssr:false,loading:()=> <p role="status">Подготовка 3D-вида…</p>});
class Boundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onError();}
  render(){return this.state.failed?null:this.props.children;}
}
export default function ChemicalSitePanel({dark,webglAvailable,initialSelection=""}:{dark:boolean;webglAvailable:boolean|null;initialSelection?:string}) {
  const [selected,setSelected]=useState(initialSelection);
  const [zone,setZone]=useState("");
  const [showEquipment,setShowEquipment]=useState(false);
  const [focus,setFocus]=useState<string|undefined>(initialSelection||undefined);
  const [revision,setRevision]=useState(0);
  const [mode,setMode]=useState<"2d"|"3d">(webglAvailable===false?"2d":"3d");
  const [failed,setFailed]=useState(false);
  const [ready,setReady]=useState(false);
  const activeMode=webglAvailable===false?"2d":mode;
  const onError=useCallback(()=>{setFailed(true);setMode("2d");},[]);
  const onReady=useCallback(()=>setReady(true),[]);
  const object=chemicalObjects.find(o=>o.id===selected);
  const asset=chemicalAssets.find(a=>a.id===object?.assetId);
  const visible=chemicalObjects.filter(o=>(!zone||o.zone===zone)&&(showEquipment||!o.assetId));
  const frame=chemicalFocus(focus);
  const inspecting=chemicalObjects.some(o=>o.id===focus);
  const focusOn=(id?:string)=>{setFocus(id);setRevision(n=>n+1);};
  const chooseZone=(id:string)=>{setZone(id);setSelected("");focusOn(id);};
  const retry=async()=>{
    const {useGLTF}=await import("@react-three/drei");
    chemicalAssets.forEach(a=>useGLTF.clear(withBasePath(a.url)));
    setFailed(false);setReady(false);setMode("3d");
  };
  return <div className={styles.panel} data-chemical-site={chemicalSiteVersion} data-selected={selected} data-view={activeMode} data-ready={ready}>
    <div className={styles.toolbar}>
      <div><h2>Химическое предприятие</h2><p>1200 × 900 м · 12 зон · производственные корпуса и крупные сооружения</p></div>
      <div className={styles.actions}>
        <button onClick={()=>{setZone("");focusOn();}}>Вся площадка</button>
        <button aria-pressed={activeMode==="2d"} onClick={()=>setMode("2d")}>План 2D</button>
        <button aria-pressed={activeMode==="3d"} disabled={webglAvailable===false||failed} onClick={()=>{if(mode!=="3d")setReady(false);setMode("3d");}}>Модель 3D</button>
      </div>
    </div>
    {failed&&<p role="alert" className={styles.notice}>Не удалось отобразить 3D. План и карточки доступны. <button onClick={retry}>Повторить 3D</button></p>}
    <div className={styles.content}>
      <div className={styles.viewport} aria-label="Площадка химического предприятия">
        {activeMode==="3d" ? webglAvailable===true&&<Boundary onError={onError}><Scene dark={dark} selected={selected} focus={focus} revision={revision} showEquipment={showEquipment} onSelect={setSelected} onReady={onReady} onError={onError}/></Boundary> :
          <svg className={styles.plan} viewBox={`${frame.x-frame.span/2} ${-frame.y-frame.span/2} ${frame.span} ${frame.span}`} role="img" aria-label="План предприятия. Выберите объект в списке для просмотра карточки.">
            <ChemicalSitePlan selected={selected} onSelect={setSelected} showEquipment={showEquipment}/>
          </svg>}
        {activeMode==="3d"&&!ready&&<p role="status" className={styles.loading}>Загрузка площадки…</p>}
        <span className={styles.hint}>{activeMode==="3d" ? inspecting ? "Осмотр отдельного объекта · перетаскивание — поворот · колесо — масштаб" : "Перетаскивание — поворот · колесо — масштаб · щелчок — карточка" : "Выберите объект на плане или в списке"}</span>
      </div>
      <aside className={styles.sidebar} aria-label="Объекты химического предприятия">
        <section className={styles.card} aria-label="Карточка объекта" aria-live="polite">
          {object ? <>
            <div className={styles.objectHeading}>{asset&&<Image src={withBasePath(`/models/chemical-pilot-v1/${asset.id}.png`)} width={88} height={74} alt={`Вид 3D-модели: ${object.name}`}/>}<h3>{object.name}</h3></div>
            <div className={styles.cardBody}><p>{object.purpose}</p>
            <dl>
              <div><dt>Идентификатор</dt><dd>{object.id}</dd></div>
              <div><dt>Тип</dt><dd>{chemicalKinds[object.kind]}</dd></div>
              <div><dt>Зона</dt><dd>{object.zone} · {chemicalZones.find(z=>z.id===object.zone)?.name}</dd></div>
              <div><dt>Габариты, Д × Ш × В</dt><dd>{[object.width,object.depth,object.height].map(n=>n.toLocaleString("ru-RU",{maximumFractionDigits:2})).join(" × ")} м</dd></div>
              <div><dt>Положение X / Y</dt><dd>{object.x} / {object.y} м</dd></div>
              <div><dt>Модель</dt><dd>{asset ? `${asset.id} · Meshy 7.1 · PBR 2K`:"Размерная геометрия Fortis"}</dd></div>
            </dl>
            <p className={styles.small}>Синтетический объект · {chemicalSiteVersion}. Размеры учебные.</p>
            </div>
            <div className={styles.actions}><button onClick={()=>focusOn(object.id)}>Осмотреть объект</button><button onClick={()=>focusOn(object.zone)}>Показать зону</button></div>
          </> : <><h3>Корпуса и сооружения</h3><p>Выберите производственную зону, чтобы осмотреть её здания и установки.</p><p className={styles.small}>Крупные сооружения пока представлены размерным макетом. Детальные модели для них — следующая очередь.</p></>}
        </section>
        <label className={styles.filter}>Зона предприятия<select value={zone} onChange={event=>chooseZone(event.target.value)}><option value="">Все зоны · {chemicalObjects.filter(o=>showEquipment||!o.assetId).length} объектов</option>{chemicalZones.map(z=><option key={z.id} value={z.id}>{z.id} · {z.name}</option>)}</select></label>
        <label className={styles.equipmentFilter}><input type="checkbox" checked={showEquipment} onChange={e=>{setShowEquipment(e.target.checked);if(!e.target.checked&&object?.assetId){setSelected("");focusOn(zone);}}}/>Вспомогательное оборудование</label>
        <div className={styles.list} aria-label="Список объектов">{visible.map(o=><button key={o.id} aria-pressed={selected===o.id} onClick={()=>setSelected(o.id)}><span>{o.name}<small>{o.id}{o.assetId?" · 3D-модель":""}</small></span></button>)}</div>
      </aside>
    </div>
    <p className={styles.note}>Учебная компоновка. Технологические связи и нормативные расстояния не моделируются. Просмотр оборудования не меняет записи движения.</p>
  </div>;
}
