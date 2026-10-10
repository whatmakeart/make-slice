import type { Axis, Path2DLoop, Point2D } from "./types";
import { booleanPaths, EPS } from "./polygons";

export function section(v:Float64Array,axis:Axis,position:number):{loops:Path2DLoop[];open:number;branches:number}{
  const n=axis==="X"?0:axis==="Y"?1:2,u=n===0?1:0,w=n===2?1:2;
  const edges=new Map<string,[string,string]>(),points=new Map<string,Point2D>();
  const key=(p:Point2D)=>`${Math.round(p.x/EPS)},${Math.round(p.y/EPS)}`;
  for(let i=0;i<v.length;i+=9){
    const d=[v[i+n]-position,v[i+3+n]-position,v[i+6+n]-position].map(x=>Math.abs(x)<EPS/10?0:x);
    if(d.every(x=>x>=0)||d.every(x=>x<0))continue;
    const hits:Point2D[]=[];
    for(let a=0;a<3;a++){const b=(a+1)%3;if((d[a]<0)===(d[b]<0))continue;const t=d[a]/(d[a]-d[b]);hits.push({x:v[i+a*3+u]+t*(v[i+b*3+u]-v[i+a*3+u]),y:v[i+a*3+w]+t*(v[i+b*3+w]-v[i+a*3+w])});}
    if(hits.length!==2)continue;
    const a=key(hits[0]),b=key(hits[1]);if(a===b)continue;
    points.set(a,hits[0]);points.set(b,hits[1]);const k=a<b?`${a}|${b}`:`${b}|${a}`;
    // Parity cancels the duplicate edges created at a tangential mesh edge.
    if(edges.has(k))edges.delete(k);else edges.set(k,[a,b]);
  }
  const neighbors=new Map<string,Set<string>>();
  for(const [a,b] of edges.values()){if(!neighbors.has(a))neighbors.set(a,new Set());if(!neighbors.has(b))neighbors.set(b,new Set());neighbors.get(a)!.add(b);neighbors.get(b)!.add(a);}
  let open=0,branches=0;for(const ns of neighbors.values()){if(ns.size===1)open++;if(ns.size>2)branches++;}
  const visited=new Set<string>(),loops:Path2DLoop[]=[];
  for(const start of neighbors.keys()){
    if(visited.has(start))continue;
    // A malformed connected component is quarantined, never closed with an invented edge.
    const component:string[]=[start];visited.add(start);for(let q=0;q<component.length;q++)for(const next of neighbors.get(component[q])!){if(!visited.has(next)){visited.add(next);component.push(next);}}
    if(component.some(k=>neighbors.get(k)!.size!==2))continue;
    const chain:Point2D[]=[];let prev="",current=start;
    do{chain.push(points.get(current)!);const next=[...neighbors.get(current)!].find(k=>k!==prev)!;prev=current;current=next;}while(current!==start&&chain.length<=component.length);
    if(current===start&&chain.length>=3)loops.push({isHole:false,points:chain});
  }
  return {loops:booleanPaths(loops,[],"union",true),open,branches};
}
