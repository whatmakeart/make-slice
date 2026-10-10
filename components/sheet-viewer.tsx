"use client";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { sheetToolpaths, type Toolpath } from "@/lib/slicer/operations";
import { pieceMaterial } from "@/lib/slicer/materials";
import { placedPoint } from "@/lib/slicer/nesting";
import { UnitContext } from "./parameter-inputs";
import type { Issue, LaserCutPiece, Path2DLoop, Point2D, SliceResult } from "@/lib/slicer/types";
export const loopD=(loops:Path2DLoop[])=>loops.map(l=>l.points.map((p,i)=>`${i?"L":"M"}${p.x},${p.y}`).join(" ")+"Z").join(" ");
const pathD=(p:Toolpath)=>p.points.map((q,i)=>`${i?"L":"M"}${q.x},${q.y}`).join(" ")+(p.closed?" Z":"");
interface Props {colorByThickness?:boolean;result:SliceResult;sheetIndex:number;selected:string|null;onSelect:(id:string|null)=>void;cuts:boolean;labels:boolean;raw:boolean;pins:boolean;nominal?:boolean;beam?:boolean;showAudit?:boolean;focusIssue?:{id:number;issue:Issue};zoomAction:{id:number;kind:"fit"|"in"|"out"}}
function bands(p:Toolpath,piece:LaserCutPiece){const rx=(piece.beam?.x??piece.kerf??0)/2,ry=(piece.beam?.y??piece.kerf??0)/2,quads:Point2D[][]=[];
  for(let i=0;i<(p.closed?p.points.length:p.points.length-1);i++){const a=p.points[i],b=p.points[(i+1)%p.points.length],dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy);if(!L)continue;const nx=-dy/L,ny=dx/L,r=Math.hypot(rx*nx,ry*ny),ox=r?rx*rx*nx/r:0,oy=r?ry*ry*ny/r:0;quads.push([{x:a.x+ox,y:a.y+oy},{x:b.x+ox,y:b.y+oy},{x:b.x-ox,y:b.y-oy},{x:a.x-ox,y:a.y-oy}]);}
  return {quads,rx,ry};
}
export default function SheetViewer(p:Props){
  const unit=useContext(UnitContext),svg=useRef<SVGSVGElement>(null),drag=useRef<{x:number;y:number;bx:number;by:number}|null>(null);
  const sheet=p.result.sheets[p.sheetIndex],W=sheet?.width||p.result.settings.sheetWidth,H=sheet?.height||p.result.settings.sheetHeight;
  const indexed=useMemo(()=>{const paths=sheet?sheetToolpaths(p.result,sheet,true):[],byId=new Map(p.result.pieces.map(piece=>[piece.id,piece])),byPart=new Map<string,Toolpath[]>();for(const path of paths){const list=byPart.get(path.pieceId!)||[];list.push(path);byPart.set(path.pieceId!,list);}return {paths,byId,byPart};},[p.result.pieces,p.result.sheets,p.sheetIndex]);
  const beamGeometry=useMemo(()=>p.beam?indexed.paths.filter(t=>t.operation!=="score").map(t=>({path:t,...bands(t,indexed.byId.get(t.pieceId!)!)})):[],[indexed,p.beam]);
  const [box,setBox]=useState({x:-25,y:-25,w:W+50,h:H+50});const current=useRef(box);current.current=box;
  const reset=()=>setBox({x:-25,y:-25,w:W+50,h:H+50});
  useEffect(()=>{reset();},[W,H,p.sheetIndex]);
  useEffect(()=>{if(p.zoomAction.kind==="fit")reset();else setBox(b=>{const f=p.zoomAction.kind==="in"?.8:1.25;return {x:b.x+b.w*(1-f)/2,y:b.y+b.h*(1-f)/2,w:b.w*f,h:b.h*f};});},[p.zoomAction]);
  useEffect(()=>{const issue=p.focusIssue?.issue;if(!issue||issue.sheetIndex!==p.sheetIndex)return;const paths=indexed.paths.filter(path=>issue.pathIds?.includes(path.id!)||!issue.pathIds?.length&&issue.partIds?.includes(path.pieceId!)),points=paths.flatMap(t=>t.points);if(!points.length)return;const xs=points.map(q=>q.x),ys=points.map(q=>q.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),size=Math.max(30,maxX-minX,maxY-minY)*1.35;setBox({x:(minX+maxX-size)/2,y:H-(minY+maxY+size)/2,w:size,h:size});},[p.focusIssue,p.sheetIndex,indexed,H]);
  useEffect(()=>{const node=svg.current;if(!node)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const b=current.current,m=node.getScreenCTM();if(!m)return;const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()),f=Math.exp(Math.max(-150,Math.min(150,e.deltaY))*.002);if(b.w*f<W/15||b.w*f>W*8)return;setBox({x:q.x+(b.x-q.x)*f,y:q.y+(b.y-q.y)*f,w:b.w*f,h:b.h*f});};node.addEventListener("wheel",wheel,{passive:false});return ()=>node.removeEventListener("wheel",wheel);},[W,!!sheet]);
  if(!sheet)return null;
  const tickStep=unit==="in"?25.4:W>1000?100:50,ticks=Array.from({length:Math.floor(W/tickStep)+1},(_,i)=>i*tickStep);
  const alerts=p.result.audit?.issues.filter(i=>i.sheetIndex===p.sheetIndex&&i.location)||[];
  return <svg ref={svg} className="sheet-svg" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="group" aria-label={`Laser sheet ${p.sheetIndex+1}, ${W} by ${H} millimeters. Select a part, or drag empty space to pan.`}
    onPointerDown={e=>{if((e.target as Element).closest("[data-piece]"))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,bx:box.x,by:box.y};}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;const m=e.currentTarget.getScreenCTM();if(!m)return;setBox(b=>({...b,x:d.bx-(e.clientX-d.x)/m.a,y:d.by-(e.clientY-d.y)/m.d}));}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    <defs><pattern id="sheet-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" stroke="#dce2e2" strokeWidth=".25" fill="none"/></pattern></defs>
    <rect x="0" y="0" width={W} height={H} fill="#fcfdfb" stroke="#879896" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
    <rect x="0" y="0" width={W} height={H} fill="url(#sheet-grid)"/>
    <g transform={`translate(0 ${H}) scale(1 -1)`}>
      <rect x={p.result.settings.sheetMargin} y={p.result.settings.sheetMargin} width={W-2*p.result.settings.sheetMargin} height={H-2*p.result.settings.sheetMargin} fill="none" stroke="#a9b8b3" strokeWidth=".8" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/>
      {sheet.placements.map(pl=>{const piece=indexed.byId.get(pl.pieceId)!,selected=p.selected===piece.id,paths=indexed.byPart.get(piece.id)||[];
        const transformed=(ls:Path2DLoop[])=>ls.map(l=>({...l,points:l.points.map(q=>placedPoint(q,piece,pl))}));
        const cut=paths.filter(path=>path.closed&&path.operation!=="score").map(path=>({points:path.points,isHole:path.operation==="interior"}));
        return <g key={piece.id} data-piece={piece.id} role="button" tabIndex={0} aria-label={`Select part ${piece.id}`} className="sheet-part" onClick={()=>p.onSelect(piece.id)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();p.onSelect(piece.id);}}}>
          <title>{piece.id} · {piece.bounds.width.toFixed(1)} × {piece.bounds.height.toFixed(1)} mm</title>
          <path d={loopD(cut)} fill={selected?"#def0ad":p.colorByThickness?pieceMaterial(p.result.settings,piece).colorHex:"#f3eadc"} fillOpacity={selected?.8:.55} fillRule="evenodd" stroke="transparent" strokeWidth="8" vectorEffect="non-scaling-stroke"/>
          {p.raw&&<path d={loopD(transformed(piece.unmodifiedPaths))} fill="none" stroke="#9eaaa5" strokeWidth=".8" strokeDasharray="2 3" vectorEffect="non-scaling-stroke"/>}
          {p.nominal&&<path d={loopD(transformed(piece.assemblyPaths))} fill="none" stroke="#6747a6" strokeWidth="1" strokeDasharray="5 3" vectorEffect="non-scaling-stroke"/>}
        </g>;
      })}
      {beamGeometry.map(({path,quads,rx,ry})=><g key={path.id} pointerEvents="none" fill="#ef4444" fillOpacity=".3"><path d={loopD(quads.map(points=>({points,isHole:false})))}/>{path.points.map((q,i)=><ellipse key={i} cx={q.x} cy={q.y} rx={rx} ry={ry}/>)}</g>)}
      {p.showAudit&&alerts.map((i,n)=><g key={n} className="audit-marker" role="button" tabIndex={0} aria-label={`Inspect: ${i.message}`} onClick={()=>p.onSelect(i.partIds?.[0]||null)} onKeyDown={e=>{if(e.key==="Enter")p.onSelect(i.partIds?.[0]||null);}}><title>{i.message} {i.adjustment}</title><circle cx={i.location!.x} cy={i.location!.y} r={Math.max(2,box.w/200)} fill={i.severity==="error"?"#dc2626":"#dd7c15"} fillOpacity=".5" stroke="#7c2d12" strokeWidth="1" vectorEffect="non-scaling-stroke"/></g>)}
    </g>
    {ticks.map(t=><g key={t}><path d={`M${t} -3V-8`} stroke="#75847f" strokeWidth="1" vectorEffect="non-scaling-stroke"/><text x={t} y="-12" fill="#65766f" textAnchor="middle" fontSize="10" fontFamily="monospace">{Number((t/(unit==="in"?25.4:1)).toFixed(2))}</text></g>)}
    <text x="0" y={H+18} fill="#65766f" fontSize="11" fontFamily="monospace">0,0 · {unit} · {pieceMaterial(p.result.settings,indexed.byId.get(sheet.placements[0].pieceId)!).rotationConstraint||"free"} rotation</text>
  </svg>;
}
