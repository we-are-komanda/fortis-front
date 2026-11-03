"use client";
import { useEffect, useMemo } from "react";
import { BoxGeometry, BufferGeometry, CylinderGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ChemicalObject } from "../../domain/chemical-site";

// Architectural massing at building scale. Parts are merged by material, not individual draw calls.
export function buildChemicalStructure(o: ChemicalObject) {
  const parts = new Map<string, BufferGeometry[]>();
  const steel="#708892", wall="#b5c1c4", roof="#6f8790", glass="#365f73", concrete="#9caaa7", accent="#c3a55b";
  function add(geometry:BufferGeometry,color:string,position:number[],rotation=[0,0,0]){
    const g=geometry.index?geometry.toNonIndexed():geometry;
    if(g!==geometry)geometry.dispose();
    g.applyMatrix4(new Matrix4().compose(new Vector3(...position),new Quaternion().setFromEuler(new Euler(...rotation)),new Vector3(1,1,1)));
    const group=parts.get(color)??[];group.push(g);parts.set(color,group);
  }
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,c=steel,rotation=[0,0,0])=>add(new BoxGeometry(w,h,d),c,[x,y,z],rotation);
  const cylinder=(x:number,y:number,z:number,r:number,h:number,c=wall,rotation=[0,0,0])=>add(new CylinderGeometry(r,r,h,24),c,[x,y,z],rotation);
  function beam(from:number[],to:number[],width:number,c=steel){
    const a=new Vector3(...from),b=new Vector3(...to),delta=b.clone().sub(a);
    const g=new BoxGeometry(width,delta.length(),width).toNonIndexed();
    g.applyMatrix4(new Matrix4().compose(a.add(b).multiplyScalar(.5),new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()),new Vector3(1,1,1)));
    const group=parts.get(c)??[];group.push(g);parts.set(c,group);
  }
  const {width:w,depth:d,height:h}=o;
  if(o.kind==="frame"){
    const levels=[h*.22,h*.46,h*.7];
    for(let x=-w/2+1;x<=w/2;x+=12)for(const z of [-d/2+1,d/2-1]){
      box(x,h*.35,z,.8,h*.7,.8);
      levels.forEach(y=>box(x,y,0,.7,.7,d));
    }
    levels.forEach(y=>{
      for(const z of [-d/2+1,d/2-1]){
        box(0,y,z,w,.8,.8);
        box(0,y+.45,z,w,.25,3,concrete);
        box(0,y+1.6,z,w,.16,.16,accent);
        for(let x=-w/2+1;x<w/2;x+=6)box(x,y+1,z,.12,1.8,.12,accent);
      }
    });
    for(let x=-w/2+1;x<w/2-12;x+=24)for(const z of [-d/2+1,d/2-1]){
      beam([x,0,z],[x+12,levels[1],z],.35);
      beam([x+12,0,z],[x,levels[1],z],.35);
    }
    for(let i=0;i<3;i++){
      const x=-w*.3+i*w*.3, height=h*(i===1?.98:.84);
      cylinder(x,height/2,0,3.5,height);
      cylinder(x,height+.12,0,3.7,.24,roof);
      for(const y of [height*.32,height*.62])cylinder(x,y,0,4.2,.4,steel);
      cylinder(x,3,d*.27,2,12,wall,[0,0,Math.PI/2]);
      for(let p=0;p<3;p++)cylinder(x+5+p*1.2,h*.32,d*.12,.4,h*.64,accent);
    }
    for(let p=0;p<4;p++)cylinder(0,4+p*.9,-d*.28,.36,w,wall,[0,0,Math.PI/2]);
    levels.forEach((y,i)=>beam([-w/2+4,i?levels[i-1]:1,d/2-3],[-w/2+4,y,-d/2+3],1.8,concrete));
  } else {
    const office=o.zone==="Z09"||o.zone==="Z11"||o.zone==="Z12";
    const wallH=office?h-1:h*.73;
    box(0,wallH/2,0,w,wallH,d,wall);
    box(0,.7,0,w+.1,1.4,d+.1,concrete);
    if(office){
      box(0,h-.5,0,w+1,1,d+1,roof);
      for(let y=3;y<h-1;y+=3.6)for(let x=-w/2+3;x<w/2-2;x+=5)
        for(const z of [-d/2-.08,d/2+.08])box(x,y,z,3.2,1.8,.15,glass);
      box(-w*.25,2.4,d/2+1.2,8,.4,2.4,roof);
      box(-w*.25,1.3,d/2+.1,4,2.6,.2,glass);
    }else{
      const bays=Math.max(1,Math.round(d/20)),bayD=d/bays,rise=h*.12;
      const slope=Math.atan2(rise,bayD/2),slopeLength=Math.hypot(bayD/2,rise);
      for(let bay=0;bay<bays;bay++){
        const z=-d/2+bayD*(bay+.5);
        for(const side of [-1,1]){
          box(0,wallH+rise/2,z+side*bayD/4,w+.6,.25,slopeLength+.4,roof,[side*slope,0,0]);
          // Raised roof lights are metres wide and remain legible in a workshop overview.
          for(let x=-w/2+14;x<w/2-8;x+=24)box(x,wallH+rise*.72,z+side*bayD*.18,14,.3,bayD*.22,glass,[side*slope,0,0]);
        }
        for(const x of [-w/2,w/2]){
          const g=new BufferGeometry();
          const vertices=[x,wallH,z-bayD/2,x,wallH+rise,z,x,wallH,z+bayD/2];
          // Both sides of the gable retain their own face normal.
          g.setAttribute("position",new Float32BufferAttribute([...vertices, ...vertices.slice(6,9),...vertices.slice(3,6),...vertices.slice(0,3)],3));
          g.setAttribute("uv",new Float32BufferAttribute(Array(12).fill(0),2));g.computeVertexNormals();add(g,wall,[0,0,0]);
        }
        for(let x=-w/2+18;x<w/2-10;x+=36){
          const ventH=h-wallH-rise;
          box(x,wallH+rise+ventH*.45,z,5,ventH*.9,3.2,steel);
          box(x,wallH+rise+ventH*.95,z,6,ventH*.1,4,roof);
        }
      }
      for(let x=-w/2+2;x<w/2;x+=6)for(const side of [-1,1])
        box(x,wallH/2,side*(d/2+.12),.24,wallH,.25,steel);
      for(let x=-w/2+7;x<w/2-3;x+=12)for(const side of [-1,1]){
        box(x,wallH*.7,side*(d/2+.18),9,2.6,.22,glass);
        box(x,2.7,side*(d/2+.2),4.5,5.4,.3,roof);
        box(x,5.7,side*(d/2+1),5.7,.25,2,steel);
      }
      // A large external service duct gives the long facade a readable industrial silhouette.
      cylinder(0,wallH*.45,-d/2+.8,.7,w*.9,steel,[0,0,Math.PI/2]);
      for(const x of [-w*.36,w*.36])cylinder(x,wallH*.6,-d/2+.8,1,wallH*.8,steel);
    }
  }
  return [...parts].map(([color,geometries])=>{
    const geometry=mergeGeometries(geometries)!;geometries.forEach(g=>g.dispose());
    return {color,geometry};
  });
}
export function ChemicalStructure({object}:{object:ChemicalObject}){
  const parts=useMemo(()=>buildChemicalStructure(object),[object]);
  useEffect(()=>()=>parts.forEach(p=>p.geometry.dispose()),[parts]);
  return <group>{parts.map(p=><mesh key={p.color} geometry={p.geometry}><meshStandardMaterial color={p.color} roughness={.7} metalness={.2}/></mesh>)}</group>;
}
