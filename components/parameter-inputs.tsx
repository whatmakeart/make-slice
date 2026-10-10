import { createContext, useContext, useEffect, useId, useState, useRef } from "react";
import { Input } from "./ui/input";
import { Tooltip, Popover, Slot } from "radix-ui";
import { Info } from "lucide-react";

export type DisplayUnit="mm"|"in";
export const UnitContext=createContext<DisplayUnit>("mm");
export const displayLength=(mm:number,unit:DisplayUnit,precision=3)=>`${Number((mm/(unit==="in"?25.4:1)).toFixed(precision))} ${unit}`;
function TooltipTarget({children,...props}:React.HTMLAttributes<HTMLElement>&{children:React.ReactElement;ref?:React.Ref<HTMLElement>}){
  // The child owns its selected/active state; tooltip state must not overwrite it.
  const {"data-state":_tooltipState,...targetProps}=props as typeof props&{"data-state"?:string};
  return <Slot.Root {...targetProps}>{children}</Slot.Root>;
}
export function ControlTooltip({description,children}:{description:React.ReactNode;children:React.ReactElement}){
  return <Tooltip.Provider delayDuration={250}><Tooltip.Root><Tooltip.Trigger asChild><TooltipTarget>{children}</TooltipTarget></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="info-tooltip" side="right" sideOffset={8} collisionPadding={16}>{description}<Tooltip.Arrow/></Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>;
}
export function InfoHelp({title,children}:{title:string;children:React.ReactNode}){
  const [open,setOpen]=useState(false),[hover,setHover]=useState(false),restoringFocus=useRef(false);
  return <Tooltip.Provider delayDuration={250}><Popover.Root open={open} onOpenChange={v=>{setOpen(v);setHover(false);restoringFocus.current=!v;}}><Tooltip.Root open={hover&&!open} onOpenChange={v=>{if(!v||!open&&!restoringFocus.current)setHover(v);}}><Tooltip.Trigger asChild><Popover.Trigger asChild><button type="button" className="info-help" onPointerEnter={()=>{restoringFocus.current=false;}} onBlur={()=>{restoringFocus.current=false;}} aria-label={`Help: ${title}`}><Info size={15}/></button></Popover.Trigger></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="info-tooltip" side="right" sideOffset={8} collisionPadding={16}><h3>{title}</h3>{children}<Tooltip.Arrow/></Tooltip.Content></Tooltip.Portal></Tooltip.Root><Popover.Portal><Popover.Content className="info-popover" sideOffset={8} collisionPadding={16}><h3>{title}</h3>{children}<Popover.Close className="text-action" aria-label="Close help">Close</Popover.Close><Popover.Arrow/></Popover.Content></Popover.Portal></Popover.Root></Tooltip.Provider>;
}
export function NumberField({label,value,onChange,min=0,max=10000,step=.1,unit="mm",displayPrecision,help}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;step?:number;unit?:string;displayPrecision?:number;help?:React.ReactNode}){
  const preference=useContext(UnitContext),id=useId(),display=unit==="mm"?preference:unit,factor=display==="in"?25.4:1;
  const format=(mm:number)=>String(Number(displayPrecision===undefined?(mm/factor).toPrecision(12):(mm/factor).toFixed(displayPrecision)));
  const initial=format(value),[draft,setDraft]=useState(initial),[touched,setTouched]=useState(false);
  useEffect(()=>{setDraft(initial);setTouched(false);},[value,preference,initial]);
  // A rounded display is not an edit: retain the exact geometry on blur.
  const n=draft===initial?value:Number(draft)*factor,integer=unit===""&&step===1;
  const error=draft.trim()===""?"Enter a value.":!Number.isFinite(n)?"Enter a finite number.":n<min||n>max?`Enter ${displayLength(min,display==="in"?"in":"mm",6).replace(/ mm$/,"" )} to ${displayLength(max,display==="in"?"in":"mm",6).replace(/ mm$/,"" )}${display?"":" (no units)"}.`:integer&&!Number.isInteger(n)?"Enter a whole number.":"";
  const commit=()=>{setTouched(true);if(error)return;setDraft(format(n));if(draft!==initial&&Math.abs(n-value)>1e-12*Math.max(1,Math.abs(value)))onChange(n);};
  const increment=(direction:number,fine=false)=>{const next=Number((value+direction*step*(fine && !integer ? .1 : 1)).toPrecision(12));if(next<min||next>max)return;setDraft(format(next));onChange(next);};
  return <div className="number-field"><div className="field-label-row"><label htmlFor={id}><span>{label}</span></label>{help&&<InfoHelp title={label}>{help}</InfoHelp>}</div><div className="number-input"><Input id={id} aria-label={label} type="text" role="spinbutton" aria-valuemin={min/factor} aria-valuemax={max/factor} aria-valuenow={error?undefined:n/factor} value={draft} inputMode={integer?"numeric":"decimal"} aria-invalid={!!error&&(touched||draft!==initial)} aria-describedby={error?`${id}-error`:undefined} onChange={e=>{setDraft(e.target.value);setTouched(true);}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commit();e.currentTarget.blur();}else if((e.key==="ArrowUp"||e.key==="ArrowDown")&&!error){e.preventDefault();increment(e.key==="ArrowUp"?1:-1,e.shiftKey);}}} onBlur={commit}/>{display&&<span>{display}</span>}<div className="number-steppers"><button type="button" aria-label={`Increase ${label}`} title="Increase; Shift for fine adjustment" disabled={!!error||value>=max} onClick={e=>{e.preventDefault();increment(1,e.shiftKey);}}>+</button><button type="button" aria-label={`Decrease ${label}`} title="Decrease; Shift for fine adjustment" disabled={!!error||value<=min} onClick={e=>{e.preventDefault();increment(-1,e.shiftKey);}}>−</button></div></div>{error&&(touched||draft!==initial)&&<span className="field-error" id={`${id}-error`}>{error} Previous valid setting remains active.</span>}</div>;
}
