"use client";
import { useRef, useState } from "react";

const DEFAULT_RATIO = 1.3 / 2.3;
export default function ViewportSplitter({active=true}:{active?:boolean}) {
  const [ratio, setRatio] = useState(DEFAULT_RATIO), [dragging, setDragging] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const apply = (value: number) => {
    const next = Math.max(.2, Math.min(.8, value)), grid = element.current?.parentElement;
    grid?.style.setProperty("--split-left", String(next));
    grid?.style.setProperty("--split-right", String(1 - next));
    setRatio(next);
  };
  return <div ref={element} hidden={!active} className={`viewport-splitter ${dragging ? "dragging" : ""}`} role="separator" tabIndex={0}
    aria-label="Resize assembly and sheet views" aria-orientation="vertical"
    aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(ratio * 100)}
    aria-valuetext={`${Math.round(ratio * 100)} percent assembly view`}
    title="Drag to resize · Arrow keys to adjust · Double-click to reset"
    onDoubleClick={() => apply(DEFAULT_RATIO)}
    onKeyDown={e => {
      const value = e.key === "ArrowLeft" ? ratio - .02 : e.key === "ArrowRight" ? ratio + .02 : e.key === "Home" ? .2 : e.key === "End" ? .8 : null;
      if (value !== null) { e.preventDefault(); apply(value); }
    }}
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
    onPointerMove={e => {
      if (!dragging) return;
      const box = e.currentTarget.parentElement!.getBoundingClientRect();
      if (box.width) apply((e.clientX - box.left) / box.width);
    }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
    onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
  />;
}
