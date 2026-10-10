"use client";
import { useEffect, useRef, useState } from "react";

const MIN_WIDTH = 320, DEFAULT_WIDTH = 320, MAX_WIDTH = 560;
export default function SidebarSplitter({active=true}:{active?:boolean}) {
  const element=useRef<HTMLDivElement>(null),drag=useRef<{x:number;width:number}|null>(null);
  const [width,setWidth]=useState(DEFAULT_WIDTH),[dragging,setDragging]=useState(false);
  const maximum=()=>Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,(element.current?.parentElement?.getBoundingClientRect().width||(typeof window==="undefined"?1280:window.innerWidth))-480-8));
  const apply=(value:number)=>{
    const next=Math.round(Math.max(MIN_WIDTH,Math.min(maximum(),value)));
    element.current?.parentElement?.style.setProperty("--rail-width",`${next}px`);
    setWidth(next);
  };
  useEffect(()=>{
    if(!active)return;
    const resize=()=>setWidth(current=>{
      const next=Math.min(current,maximum());
      element.current?.parentElement?.style.setProperty("--rail-width",`${next}px`);
      return next;
    });
    resize();window.addEventListener("resize",resize);
    return ()=>window.removeEventListener("resize",resize);
  },[active]);
  return <div ref={element} hidden={!active} className={`sidebar-splitter ${dragging?"dragging":""}`} role="separator" tabIndex={0}
    aria-label="Resize build settings sidebar" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={maximum()} aria-valuenow={width} aria-valuetext={`${width} pixels wide; minimum ${MIN_WIDTH}`}
    title="Drag to resize settings · Arrow keys to adjust · Double-click to reset"
    onDoubleClick={()=>apply(DEFAULT_WIDTH)} onKeyDown={e=>{
      const next=e.key==="ArrowLeft"?width-16:e.key==="ArrowRight"?width+16:e.key==="Home"?MIN_WIDTH:e.key==="End"?maximum():null;
      if(next!==null){e.preventDefault();apply(next);}
    }} onPointerDown={e=>{
      if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
      drag.current={x:e.clientX,width};setDragging(true);
    }} onPointerMove={e=>{if(drag.current)apply(drag.current.width+e.clientX-drag.current.x);}}
    onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);drag.current=null;setDragging(false);}}
    onPointerCancel={()=>{drag.current=null;setDragging(false);}} onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
  />;
}
