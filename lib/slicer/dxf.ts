import { DXF_TEMPLATES } from "./dxf-template";
import type { Point2D } from "./types";

export interface DXFPath {points:Point2D[];closed:boolean;layer:"CUT_OUTLINE"|"CUT_INTERIOR"|"ETCH_LABELS"}
const num=(n:number)=>Number(n.toFixed(4)).toString();

export function drawingDXF(paths:DXFPath[],width:number,height:number,legacy=false,lineSegments=false):string{
  const template=DXF_TEMPLATES[legacy?"R12":"R2000"],rows:string[]=[];
  let handle=4096;
  const next=()=> (handle++).toString(16).toUpperCase();
  const g=(code:number,value:string|number)=>{rows.push(String(code).padStart(3," "),typeof value==="number"?num(value):value);};
  const colors={CUT_OUTLINE:1,ETCH_LABELS:5,CUT_INTERIOR:3};
  const entity=(type:string,layer:DXFPath["layer"],subclass:string)=>{
    g(0,type);g(5,next());
    if(!legacy){g(330,template.modelHandle);g(100,"AcDbEntity");}
    g(8,layer);g(62,colors[layer]);
    if(!legacy)g(370,layer==="ETCH_LABELS"?18:0);
    if(!legacy)g(100,subclass);
  };
  for(const path of paths){
    if(path.points.length<2)continue;
    if(path.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error("DXF contains a non-finite coordinate.");
    if(lineSegments&&!legacy){
      const count=path.closed?path.points.length:path.points.length-1;
      for(let i=0;i<count;i++){
        const a=path.points[i],b=path.points[(i+1)%path.points.length];
        if(Math.hypot(a.x-b.x,a.y-b.y)<1e-8)continue;
        entity("LINE",path.layer,"AcDbLine");
        g(10,a.x);g(20,a.y);g(30,0);g(11,b.x);g(21,b.y);g(31,0);
      }
    }else if(legacy){
      entity("POLYLINE",path.layer,"");g(66,1);g(10,0);g(20,0);g(30,0);g(70,path.closed?1:0);
      for(const p of path.points){entity("VERTEX",path.layer,"");g(10,p.x);g(20,p.y);g(30,0);g(70,0);}
      entity("SEQEND",path.layer,"");
    }else{
      entity("LWPOLYLINE",path.layer,"AcDbPolyline");g(90,path.points.length);g(70,path.closed?1:0);g(43,0);
      for(const p of path.points){g(10,p.x);g(20,p.y);}
    }
  }
  const replace=(text:string)=>text.replaceAll("__WIDTH__",num(width)).replaceAll("__HEIGHT__",num(height))
    .replaceAll("__VIEW_HEIGHT__",num(Math.max(width,height))).replaceAll("__CENTER_X__",num(width/2)).replaceAll("__CENTER_Y__",num(height/2))
    .replaceAll("__HANDSEED__",handle.toString(16).toUpperCase());
  return (replace(template.prefix)+(rows.length?rows.join("\n")+"\n":"")+replace(template.suffix)).replace(/\r?\n/g,"\r\n");
}
