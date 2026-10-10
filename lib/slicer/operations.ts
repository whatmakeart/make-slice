import { placedPoint } from "./nesting";
import { candidateBounds, candidatePaths } from "./beam";
import type { DXFPath } from "./dxf";
import type { NestedSheet, SliceResult } from "./types";

export type Operation="exterior"|"interior"|"cut_slit"|"score"|"reference";
export interface Toolpath extends DXFPath { pieceId?:string; id?:string; operation?:Operation }
export const OPERATIONS={exterior:{layer:"CUT_OUTLINE",closed:true},interior:{layer:"CUT_INTERIOR",closed:true},cut_slit:{layer:"CUT_INTERIOR",closed:false},score:{layer:"ETCH_LABELS",closed:false},reference:{layer:"REFERENCE_GUIDES",closed:false}} as const;
export function sheetToolpaths(result:SliceResult,sheet:NestedSheet,labels=true):Toolpath[]{
  const paths:Toolpath[]=[],pieces=new Map(result.pieces.map(p=>[p.id,p]));
  for(const pl of sheet.placements){const p=pieces.get(pl.pieceId);if(!p)continue;
    const b=candidateBounds(p,pl.rotation);
    const add=(operation:Operation,points:DXFPath["points"],closed:boolean,index:number)=>paths.push({points,closed,layer:OPERATIONS[operation].layer,pieceId:p.id,operation,id:`S${sheet.sheetIndex+1}/${p.id}/${operation}/${index}`});
    candidatePaths(p,pl.rotation).forEach((l,i)=>add(l.isHole||l.isRegistration?"interior":"exterior",l.points.map(q=>({x:q.x+pl.x-b.minX,y:q.y+pl.y-b.minY})),true,i));
    (p.cutStrokes||[]).forEach((l,i)=>add(l.closed?"interior":"cut_slit",l.points.map(q=>placedPoint(q,p,pl)),!!l.closed,i));
    if(labels)p.etchPaths.forEach((l,i)=>add("score",l.points.map(q=>placedPoint(q,p,pl)),!!l.closed,i));
  }
  const order={ETCH_LABELS:0,CUT_INTERIOR:1,CUT_OUTLINE:2,REFERENCE_GUIDES:3};return paths.sort((a,b)=>order[a.layer]-order[b.layer]);
}
