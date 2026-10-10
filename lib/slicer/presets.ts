import { ExtrudeGeometry, Shape } from "three";
import { MODEL_BYTES } from "./embedded-models";
import { parseSTL } from "./stl";
import { inspectMesh } from "./stl";
import type { MeshData, Preset } from "./types";

export const PRESET_NAMES: Record<Preset, string> = { ripple: "Ripple form", sphere: "Ellipsoid", torus: "Torus", cube: "Calibration cube", letter_t: "Letter T shell", letter_s: "Letter S shell", jimmy: "Jimmy", donut_box: "Donut box" };
export const PRESET_DESCRIPTIONS: Partial<Record<Preset,string>> = { jimmy: "Organic sculptural test model", donut_box: "Finger-joint enclosure with an open central tunnel" };
export function makePreset(preset: Preset): MeshData {
  if(preset==="jimmy"||preset==="donut_box"){const binary=atob(MODEL_BYTES[preset]),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return parseSTL(bytes.buffer,preset==="jimmy"?"Jimmy.stl":"donut-box.stl");}
  const out: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c);
  if (preset === "letter_t" || preset === "letter_s") {
    const shape=new Shape();
    if(preset==="letter_t"){
      shape.moveTo(0,160);shape.lineTo(200,160);shape.lineTo(200,110);shape.lineTo(125,110);shape.lineTo(125,0);shape.lineTo(75,0);shape.lineTo(75,110);shape.lineTo(0,110);shape.closePath();
    }else{
      const centers:number[][]=[],normals:number[][]=[];
      const count=60;
      for(let i=0;i<=count;i++){const t=Math.PI/4+i/count*Math.PI*1.25;centers.push([60*Math.cos(t),60+60*Math.sin(t)]);normals.push([-Math.cos(t),-Math.sin(t)]);}
      for(let i=1;i<=count;i++){const t=Math.PI/2-i/count*Math.PI*1.25;centers.push([60*Math.cos(t),-60+60*Math.sin(t)]);normals.push([Math.cos(t),Math.sin(t)]);}
      const left=centers.map((p,i)=>[p[0]+normals[i][0]*15,p[1]+normals[i][1]*15]),right=centers.map((p,i)=>[p[0]-normals[i][0]*15,p[1]-normals[i][1]*15]).reverse();
      const outline=[...left,...right];shape.moveTo(outline[0][0],outline[0][1]);for(const p of outline.slice(1))shape.lineTo(p[0],p[1]);shape.closePath();
    }
    const geometry=new ExtrudeGeometry(shape,{depth:60,bevelEnabled:false,curveSegments:32}),pos=geometry.getAttribute("position");
    for(let i=0;i<pos.count;i++)out.push(pos.getX(i),pos.getY(i),pos.getZ(i));geometry.dispose();
  } else if (preset === "cube") {
    const v = [[0,0,0],[100,0,0],[100,100,0],[0,100,0],[0,0,100],[100,0,100],[100,100,100],[0,100,100]];
    for (const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]) { tri(v[a],v[b],v[c]); tri(v[a],v[c],v[d]); }
  } else if (preset === "torus") {
    const nu = 72, nv = 36;
    const at = (i: number, j: number) => {
      const u = i / nu * Math.PI * 2, v = j / nv * Math.PI * 2;
      return [(76 + 30 * Math.cos(v)) * Math.cos(u), (76 + 30 * Math.cos(v)) * Math.sin(u), 30 * Math.sin(v)];
    };
    for (let i=0;i<nu;i++) for (let j=0;j<nv;j++) { const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1); tri(a,b,c);tri(a,c,d); }
  } else if (preset === "sphere") {
    const nu=72,nv=36;
    const at=(i:number,j:number)=>{ const u=i/nu*Math.PI*2,v=j/nv*Math.PI;return [100*Math.sin(v)*Math.cos(u),80*Math.sin(v)*Math.sin(u),112*Math.cos(v)]; };
    for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){ const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);if(j>0)tri(a,b,c);if(j<nv-1)tri(a,c,d); }
  } else {
    const nu=80,nv=44;
    const at=(i:number,j:number)=>{const u=i/nu*Math.PI*2, t=j/nv; const r=37+49*Math.pow(Math.sin(Math.PI*t),.75)+12*Math.sin(t*Math.PI*2); const ripple=1+.08*Math.sin(3*u-t*5); return [r*ripple*Math.cos(u),r*ripple*Math.sin(u)*.84,t*220];};
    for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);tri(a,b,c);tri(a,c,d);}
    for(let i=0;i<nu;i++){tri([0,0,0],at(i+1,0),at(i,0));tri([0,0,220],at(i,nv),at(i+1,nv));}
  }
  const vertices = new Float64Array(out);
  return { vertices, info: inspectMesh(vertices, PRESET_NAMES[preset], "Sample model") };
}
