"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { sheetToolpaths } from "@/lib/slicer/export";
import { pieceMaterial } from "@/lib/slicer/materials";
import { placedPoint } from "@/lib/slicer/nesting";
import type { Path2DLoop, SliceResult } from "@/lib/slicer/types";
export const loopD=(loops:Path2DLoop[])=>loops.map(l=>l.points.map((p,i)=>`${i?"L":"M"}${p.x},${p.y}`).join(" ")+"Z").join(" ");
interface Props {colorByThickness?:boolean;result:SliceResult;sheetIndex:number;selected:string|null;onSelect:(id:string|null)=>void;cuts:boolean;labels:boolean;raw:boolean;pins:boolean;zoomAction:{id:number;kind:"fit"|"in"|"out"}}
export default function SheetViewer(p:Props){
  const svg=useRef<SVGSVGElement>(null),drag=useRef<{x:number;y:number;bx:number;by:number}|null>(null);
  const W=p.result.sheets[p.sheetIndex]?.width||p.result.settings.sheetWidth,H=p.result.sheets[p.sheetIndex]?.height||p.result.settings.sheetHeight;
  const toolpaths=useMemo(()=>{const sheet=p.result.sheets[p.sheetIndex];return sheet?sheetToolpaths(p.result,sheet,false):[];},[p.result,p.sheetIndex]);
  const [box,setBox]=useState({x:-25,y:-25,w:W+50,h:H+50});const current=useRef(box);current.current=box;
  const reset=()=>setBox({x:-25,y:-25,w:W+50,h:H+50});
  useEffect(()=>{reset();},[W,H,p.sheetIndex]);
  useEffect(()=>{
    if(p.zoomAction.kind==="fit")reset();else setBox(b=>{const f=p.zoomAction.kind==="in"?.8:1.25;return {x:b.x+b.w*(1-f)/2,y:b.y+b.h*(1-f)/2,w:b.w*f,h:b.h*f};});
  },[p.zoomAction]);
  useEffect(()=>{
    const node=svg.current!;const wheel=(e:WheelEvent)=>{e.preventDefault();const b=current.current,m=node.getScreenCTM();if(!m)return;const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());const f=Math.exp(Math.max(-150,Math.min(150,e.deltaY))*.002);if(b.w*f<W/15||b.w*f>W*8)return;setBox({x:q.x+(b.x-q.x)*f,y:q.y+(b.y-q.y)*f,w:b.w*f,h:b.h*f});};
    node.addEventListener("wheel",wheel,{passive:false});return ()=>node.removeEventListener("wheel",wheel);
  },[W]);
  const sheet=p.result.sheets[p.sheetIndex],byId=new Map(p.result.pieces.map(piece=>[piece.id,piece]));
  if(!sheet)return null;
  const tickStep=W>1000?100:50,ticks=Array.from({length:Math.floor(W/tickStep)+1},(_,i)=>i*tickStep);
  return <svg ref={svg} className="sheet-svg" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="group" aria-label={`Laser sheet ${p.sheetIndex+1}, ${W} by ${H} millimeters. Select a part, or drag empty space to pan.`}
    onPointerDown={e=>{if((e.target as Element).closest("[data-piece]"))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,bx:box.x,by:box.y};}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;const m=e.currentTarget.getScreenCTM();if(!m)return;setBox(b=>({...b,x:d.bx-(e.clientX-d.x)/m.a,y:d.by-(e.clientY-d.y)/m.d}));}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    <defs><pattern id="sheet-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" stroke="#dce2e2" strokeWidth=".25" fill="none"/></pattern></defs>
    <rect x="0" y="0" width={W} height={H} fill="#fcfdfb" stroke="#879896" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
    <rect x="0" y="0" width={W} height={H} fill="url(#sheet-grid)"/>
    <g transform={`translate(0 ${H}) scale(1 -1)`}>
      <rect x={p.result.settings.sheetMargin} y={p.result.settings.sheetMargin} width={W-2*p.result.settings.sheetMargin} height={H-2*p.result.settings.sheetMargin} fill="none" stroke="#a9b8b3" strokeWidth=".8" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/>
      {sheet.placements.map(placement=>{const piece=byId.get(placement.pieceId)!;const selected=p.selected===piece.id;
        const transformed=(ls:Path2DLoop[])=>ls.map(l=>({...l,points:l.points.map(q=>placedPoint(q,piece,placement))}));
        return <g key={piece.id} data-piece={piece.id} role="button" tabIndex={0} aria-label={`Select part ${piece.id}`} className="sheet-part" onClick={()=>p.onSelect(piece.id)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();p.onSelect(piece.id);}}}>
          <title>{piece.id} · {piece.bounds.width.toFixed(1)} × {piece.bounds.height.toFixed(1)} mm</title>
          <path d={loopD(transformed(piece.cutPaths))} fill={selected?"#def0ad":p.colorByThickness?pieceMaterial(p.result.settings,piece).colorHex:"#f3eadc"} fillOpacity={selected?.8:.65} fillRule="evenodd" stroke="transparent" strokeWidth="8" vectorEffect="non-scaling-stroke"/>
          {p.raw&&<path d={loopD(transformed(piece.unmodifiedPaths))} fill="none" stroke="#9eaaa5" strokeWidth=".8" strokeDasharray="2 3" vectorEffect="non-scaling-stroke"/>}
          {toolpaths.filter(path=>path.pieceId===piece.id&&((path.layer==="CUT_OUTLINE"&&p.cuts)||(path.layer==="CUT_INTERIOR"&&p.pins))).map((path,i)=><path key={`tool-${i}`} d={path.points.map((q,j)=>`${j?"L":"M"}${q.x},${q.y}`).join(" ")+(path.closed?" Z":"")} fill="none" stroke={path.layer==="CUT_INTERIOR"?"#15965e":selected?"#527817":"#b8433b"} strokeWidth={selected?1.8:1.05} vectorEffect="non-scaling-stroke"/>)}
          {p.labels&&piece.etchPaths.map((stroke,i)=><path key={i} d={stroke.points.map((q,j)=>{const t=placedPoint(q,piece,placement);return `${j?"L":"M"}${t.x},${t.y}`;}).join(" ")+(stroke.closed?" Z":"")} fill="none" stroke="#3869b1" strokeWidth=".85" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>)}
        </g>;
      })}
    </g>
    {ticks.map(t=><g key={t}><path d={`M${t} -3V-8`} stroke="#75847f" strokeWidth="1" vectorEffect="non-scaling-stroke"/><text x={t} y="-12" fill="#65766f" textAnchor="middle" fontSize="9" fontFamily="monospace">{t}</text></g>)}
    <text x="0" y={H+18} fill="#65766f" fontSize="10" fontFamily="monospace">0,0 · mm</text>
  </svg>;
}
