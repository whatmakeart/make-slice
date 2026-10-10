"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Box, Layers, Grid3X3, Upload, Download, RotateCcw, Undo2, Redo2, Maximize2, ChevronLeft, ChevronRight, ChevronDown, PanelRight, Settings2, Minus, Plus, SlidersHorizontal, Info, AlertTriangle, Check, Play, Pause, SkipBack, SkipForward, Link, Unlink, Package, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import AssemblyViewport, { type AssemblyViewportHandle } from "./assembly-viewport";
import SheetViewer from "./sheet-viewer";
import ViewportSplitter from "./viewport-splitter";
import { APP_CONFIG, BRAND_LOGO } from "@/lib/app-config";
import { ParameterHistory } from "@/lib/parameter-history";
import { loadMachineDefaults, saveMachineDefaults } from "@/lib/machine-defaults";
import { PRESET_NAMES, PRESET_DESCRIPTIONS } from "@/lib/slicer/presets";
import { DEFAULT_SETTINGS, type Axis, type Preset, type SliceResult, type SliceSettings, type WorkerResponse, type WorkerRequest } from "@/lib/slicer/types";
import { exportBundle, exportDXF, exportUnplacedDXF, exportSVG, exportMasterDXF, exportMasterSVG } from "@/lib/slicer/export";
import { validateSettings } from "@/lib/slicer/engine";
import { registerSlicerTools } from "@/lib/slicer/webmcp";
import { SlicerClient } from "@/lib/slicer/client";
import { materials, boxSettings, MATERIAL_NAMES, ACRYLIC_FINISHES, materialAppearance } from "@/lib/slicer/materials";
import { exportAssemblyOBJ } from "@/lib/slicer/obj-export";
import { exportAssemblyGuide, type GuidePageSize } from "@/lib/slicer/assembly-guide";
import { exportFileName, sheetFileName, sanitizeFileComponent, type ExportOptions } from "@/lib/slicer/export-naming";
import { exportAssemblyDiagram } from "@/lib/slicer/assembly-diagram";


type ViewportMode = "assembly" | "sheets" | "split";
function ParameterGroup({number,title,defaultOpen=false,children}:{number:string;title:string;defaultOpen?:boolean;children:React.ReactNode}){
  const [open,setOpen]=useState(defaultOpen);
  return <details className="parameter-group" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary><span>{number}</span><h2>{title}</h2><ChevronDown size={15}/></summary><div className="parameter-group-content">{children}</div></details>;
}
function ToolMark(){return <svg viewBox="0 0 32 36" aria-hidden="true" className="tool-mark"><path d="M4 20 28 8v8l-10 5v-4l-4 2v4L4 28Z" fill="currentColor" opacity=".55"/><path d="M4 8 14 13v4l4 2v-4l10 5v8L4 16Z" fill="currentColor"/><path d="m4 8 10 5m4 2 10 5M4 20l10-7m4 2 10-7" fill="none" stroke="currentColor" strokeWidth=".8"/></svg>;}

type WithoutId<T> = T extends unknown ? Omit<T,"id"> : never;
type Job=WithoutId<WorkerRequest>;
const fmt=(n:number,d=1)=>n.toLocaleString("en-US",{maximumFractionDigits:d});
function Range({label,value,max=100,min=0,step=1,onChange,onCommit}:{label:string;value:number;max?:number;min?:number;step?:number;onChange:(n:number)=>void;onCommit?:(n:number)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{ref.current?.querySelectorAll("[role=slider]").forEach(t=>t.setAttribute("aria-label",label));},[label]);
  return <div ref={ref}><Slider value={[value]} max={max} min={min} step={step} onValueChange={v=>onChange(v[0])} onValueCommit={v=>onCommit?.(v[0])} aria-label={label}/></div>;
}
function ParameterRange({label,value,min,max,step,onCommit,readout}:{label:string;value:number;min:number;max:number;step:number;onCommit:(n:number)=>void;readout:(n:number)=>string}){
  const [draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[value]);
  return <><div className="range-row"><label>{label}</label><span>{readout(draft)}</span></div><Range label={label} value={draft} min={min} max={max} step={step} onChange={setDraft} onCommit={onCommit}/></>;
}
function NumberField({label,value,onChange,min=0,max=10000,step=.1,unit="mm"}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;step?:number;unit?:string}){
  const id=useId(),[draft,setDraft]=useState(String(Number(value.toFixed(3))));
  useEffect(()=>setDraft(String(Number(value.toFixed(3)))),[value]);
  return <label htmlFor={id} className="number-field"><span>{label}</span><div className="number-input"><Input id={id} type="number" value={draft} min={min} max={max} step={step} inputMode="decimal" title="Apply on Enter or when you leave this field" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}}} onBlur={()=>{const n=Number(draft);if(draft===""||!Number.isFinite(n)){setDraft(String(Number(value.toFixed(3))));return;}const v=Math.max(min,Math.min(max,step===1?Math.round(n):n));setDraft(String(v));if(v!==value)onChange(v);}}/>{unit&&<span>{unit}</span>}</div></label>;
}
function Toggle({label,checked,onChange,id:explicit}:{label:string;checked:boolean;onChange:(b:boolean)=>void;id?:string}){const generated=useId(),id=explicit||generated;return <div className="toggle-row"><label htmlFor={id}>{label}</label><Switch id={id} checked={checked} onCheckedChange={onChange}/></div>;}
function Picker({label,value,onChange,items}:{label:string;value:string;onChange:(v:string)=>void;items:{value:string;label:string}[]}){
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} title={items.find(i=>i.value===value)?.label} className="picker"><SelectValue/></SelectTrigger><SelectContent position="popper">{items.map(i=><SelectItem value={i.value} key={i.value}>{i.label}</SelectItem>)}</SelectContent></Select>;
}
function download(data:string|Uint8Array,name:string,mime:string){
  const body=typeof data==="string"?data:new Uint8Array(data).buffer;
  const url=URL.createObjectURL(new Blob([body],{type:mime})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function summary(r:SliceResult|null){return r?{model:r.model.name,dimensions:r.dimensions,settings:r.settings,partCount:r.pieces.length,sheetCount:r.sheets.length,unplaced:r.unplaced,issues:r.issues,processingMs:Math.round(r.processingMs)}:{status:"No completed project"};}

function BoxControls({settings,onChange,advanced=false}:{settings:SliceSettings;onChange:(value:NonNullable<SliceSettings["fingerBox"]>)=>void;advanced?:boolean}){
  const f=boxSettings(settings),b=f.bracing;
  const update=<K extends keyof typeof f>(key:K,value:typeof f[K])=>onChange({...f,[key]:value});
  const brace=<K extends keyof typeof b>(key:K,value:typeof b[K])=>update("bracing",{...b,[key]:value});
  if(!advanced)return <div className="box-controls">
    <div className="labeled-picker"><label>Shell construction</label><Picker label="Shell construction" value={f.shellConstruction||"auto"} onChange={v=>onChange({...f,shellConstruction:v as typeof f.shellConstruction,...(v==="bands"?{curveHandling:"living_hinge" as const}:{})})} items={[{value:"auto",label:"Auto · by curve method"},{value:"extrusion",label:"Constant extruded profile"},{value:"bands",label:"Contour bands · organic forms"}]}/></div>
    <div className="labeled-picker"><label>{f.shellConstruction==="bands"?"Band stack axis":"Extrusion / stack axis"}</label><Picker label="Box extrusion direction" value={f.extrusionAxis||"auto"} onChange={v=>update("extrusionAxis",v as typeof f.extrusionAxis)} items={[{value:"auto",label:"Auto · detect / Z bands"},{value:"X",label:"X · width"},{value:"Y",label:"Y · depth"},{value:"Z",label:"Z · height"}]}/></div>
    <div className="labeled-picker"><label>Curved walls</label><Picker label="Curved wall construction" value={f.curveHandling} onChange={v=>onChange({...f,curveHandling:v as typeof f.curveHandling,...(v==="facets"&&f.shellConstruction==="bands"?{shellConstruction:"auto" as const}:{})})} items={[{value:"facets",label:"Flat facets"},{value:"living_hinge",label:"Living hinge strips"}]}/></div>
    {f.curveHandling==="living_hinge"&&f.shellConstruction!=="extrusion"&&<><div className="two-fields"><NumberField label="Maximum band height" value={f.bandHeight??30} min={8} max={200} step={1} onChange={n=>update("bandHeight",n)}/><NumberField label="Band profile deviation" value={f.bandDeviation??3} min={.25} max={25} step={.25} onChange={n=>update("bandDeviation",n)}/></div><Toggle label="Adaptive band heights" checked={f.adaptiveBands!==false} onChange={v=>update("adaptiveBands",v)}/><p className="field-note">Changing profiles use hollow contour bands joined by plates. Adaptive bands get shorter where the profile changes faster. Band height is separate from stock thickness.</p></>}
    <NumberField label="Curve deviation" value={f.chordalError} min={.05} max={15} step={.05} onChange={n=>update("chordalError",n)}/>
    <p className="field-note">Flat facets simplify up to 15 mm. Hinge bands keep smooth perimeter detail and approximate compound curves as stacked steps.</p>
    <p className="field-note">Through-holes retain inner tunnel walls. Use the ghost mesh to compare the fabricated envelope to the source.</p>
  </div>;
  return <div className="box-controls">
    <div className="two-fields"><NumberField label="Finger width" value={f.fingerWidth} min={2} max={200} onChange={n=>update("fingerWidth",n)}/><NumberField label="Box fit tolerance" value={f.jointTolerance} min={-1} max={3} step={.01} onChange={n=>update("jointTolerance",n)}/></div>
    <Picker label="Box corner relief" value={f.cornerStyle} onChange={v=>update("cornerStyle",v as typeof f.cornerStyle)} items={[{value:"sharp",label:"Sharp corners"},{value:"dogbone",label:"Dogbone relief"},{value:"round",label:"Round lead-in relief"}]}/>
    {f.curveHandling==="living_hinge"&&<><div className="two-fields"><NumberField label="Hinge slit length" value={f.livingHingeSlitLength} min={3} max={100} onChange={n=>update("livingHingeSlitLength",n)}/><NumberField label="Hinge pitch" value={f.livingHingeGap} min={1} max={10} onChange={n=>update("livingHingeGap",n)}/></div><p className="field-note">Each material slot has its own thickness, K factor, and optional hinge pattern under Material & tooling.</p></>}
    <Toggle label="Internal bracing" checked={b.enabled} onChange={v=>brace("enabled",v)}/>
    {b.enabled&&<div className="brace-settings">
      <Picker label="Brace layout" value={b.mode} onChange={v=>brace("mode",v as typeof b.mode)} items={[{value:"auto",label:"Auto · span support"},{value:"transverse",label:"Transverse · across profile"},{value:"longitudinal",label:"Longitudinal · along profile"},{value:"grid",label:"Grid · both directions"}]}/>
      <NumberField label={b.mode==="auto"?"Maximum unsupported span":"Brace spacing"} value={b.mode==="auto"?b.maxUnsupportedSpan:b.spacing} min={10} max={1000} onChange={v=>brace(b.mode==="auto"?"maxUnsupportedSpan":"spacing",v)}/>
      <Picker label="Brace stock" value={b.braceThicknessId} onChange={v=>brace("braceThicknessId",v)} items={materials(settings).map(m=>({value:m.id,label:`${m.id} · ${m.thickness} mm`}))}/>
      <Picker label="Brace joint" value={b.jointType} onChange={v=>brace("jointType",v as typeof b.jointType)} items={[{value:"tab_and_slot",label:"Tabs and through slots"},{value:"through_tenon",label:"Through tenons"},{value:"blind_notch",label:"Blind · glue + etch guides"}]}/>
      <Toggle label="Egg-crate half-lap slots" checked={b.eggCrateSlotted} onChange={v=>brace("eggCrateSlotted",v)}/>
      <Toggle label="Weight-reduction holes" checked={b.lightningHoles} onChange={v=>brace("lightningHoles",v)}/>
      <details className="advanced-details"><summary>Brace joint dimensions</summary><div className="two-fields"><NumberField label="Brace tab width" value={b.tenonWidth} min={2} max={100} onChange={v=>brace("tenonWidth",v)}/><NumberField label="Tabs per edge" value={b.tenonCountPerEdge} unit="" min={1} max={8} step={1} onChange={v=>brace("tenonCountPerEdge",v)}/><NumberField label="Brace fit" value={b.slotFitTolerance} min={-1} max={3} step={.01} onChange={v=>brace("slotFitTolerance",v)}/><NumberField label="Anchor depth fraction" value={b.tenonDepthRatio} unit="" min={.1} max={1} step={.1} onChange={v=>brace("tenonDepthRatio",v)}/><NumberField label="Corner relief" value={b.cornerReliefSize} min={0} max={20} onChange={v=>brace("cornerReliefSize",v)}/></div></details>
    </div>}
  </div>;
}

export default function SliceWorkspace(){
  const [compact,setCompact]=useState(()=>typeof window!=="undefined"&&window.innerWidth<=1050);
  const [viewportMode,setViewportMode]=useState<ViewportMode>(()=>typeof window!=="undefined"&&window.innerWidth<=1050?"assembly":"split");
  const [sequenceOpen,setSequenceOpen]=useState(false),[inspectorOpen,setInspectorOpen]=useState(false);
  const parametersRef=useRef<HTMLElement>(null);
  useEffect(()=>{const update=()=>{const small=window.innerWidth<=1050;setCompact(small);if(small)setViewportMode(mode=>mode==="split"?"assembly":mode);};update();window.addEventListener("resize",update);return ()=>window.removeEventListener("resize",update);},[]);
  const [settings,setSettings]=useState<SliceSettings>(()=>loadMachineDefaults(DEFAULT_SETTINGS)),[result,setResult]=useState<SliceResult|null>(null);
  const history=useRef(new ParameterHistory<SliceSettings>()),[,refreshHistory]=useState(0);
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[modelChoice,setModelChoice]=useState<string>("jimmy");
  const [selected,setSelected]=useState<string|null>(null),[sheetIndex,setSheetIndex]=useState(0),[explode,setExplode]=useState(0),[step,setStep]=useState(10000),[playing,setPlaying]=useState(false);
  const [colorByThickness,setColorByThickness]=useState(true),[activeThickness,setActiveThickness]=useState("T1"),[paintThickness,setPaintThickness]=useState(false),[xray,setXray]=useState(false);
  const viewport=useRef<AssemblyViewportHandle|null>(null),recordAbort=useRef<AbortController|null>(null);
  const [slicingProgress,setSlicingProgress]=useState({stage:"geometry",percent:0,completed:0,total:1});
  const [recording,setRecording]=useState(false),[recordProgress,setRecordProgress]=useState(0);
  const [videoGhost,setVideoGhost]=useState(true);
  const [ghost,setGhost]=useState(false),[view,setView]=useState<"iso"|"front"|"top">("iso"),[fit,setFit]=useState(0);
  const [showCuts,setShowCuts]=useState(true),[showLabels,setShowLabels]=useState(true),[showPins,setShowPins]=useState(true),[showRaw,setShowRaw]=useState(false);
  const [zoomAction,setZoomAction]=useState<{id:number;kind:"fit"|"in"|"out"}>({id:0,kind:"fit"});
  const [exportOpen,setExportOpen]=useState(false),[helpOpen,setHelpOpen]=useState(false),[issuesOpen,setIssuesOpen]=useState(false),[parametersOpen,setParametersOpen]=useState(false),[dragOver,setDragOver]=useState(false);
  useEffect(()=>{
    if(!compact||!parametersOpen)return;
    const previous=document.activeElement as HTMLElement|null,rail=parametersRef.current;
    rail?.querySelector<HTMLElement>(".parameters-close")?.focus();
    const keys=(e:KeyboardEvent)=>{
      if(e.key==="Escape"){e.preventDefault();setParametersOpen(false);}
      if(e.key!=="Tab"||!rail)return;
      const nodes=[...rail.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [role="combobox"], [role="switch"]')].filter(el=>el.getClientRects().length>0);
      const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",keys);return ()=>{document.removeEventListener("keydown",keys);previous?.focus();};
  },[compact,parametersOpen]);
  const [exportLabels,setExportLabels]=useState(true),[legacy,setLegacy]=useState(false),[dxfLines,setDxfLines]=useState(false),[notice,setNotice]=useState("");
  const [projectName,setProjectName]=useState("Jimmy"),[filePrefix,setFilePrefix]=useState(""),[fileSuffix,setFileSuffix]=useState(""),[sheetSuffix,setSheetSuffix]=useState(true),[guidePageSize,setGuidePageSize]=useState<GuidePageSize>("letter");
  const exportOptions:ExportOptions={projectName,prefix:filePrefix,suffix:fileSuffix,includeSheetSuffix:sheetSuffix,pageSize:guidePageSize};
  useEffect(()=>{if(result?.model.name)setProjectName(result.model.name.replace(/\.(stl|obj)$/i,""));},[result?.model.name]);
  const worker=useRef<SlicerClient|null>(null),ids=useRef(0),settingsRef=useRef(settings),busyRef=useRef(true),resultRef=useRef(result),skipSettings=useRef(true);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  settingsRef.current=settings;resultRef.current=result;
  const fileInput=useRef<HTMLInputElement>(null),waiters=useRef(new Map<number,{resolve:(r:SliceResult)=>void;reject:(e:Error)=>void}>());
  const process=useCallback((job:Job):Promise<SliceResult>=>{
    const w=worker.current;if(!w)return Promise.reject(new Error("The slicer is still starting."));
    const id=++ids.current;busyRef.current=true;setBusy(true);setError("");setSlicingProgress({stage:"geometry",percent:0,completed:0,total:1});
    for(const [old,pending] of waiters.current){pending.reject(new Error("Regeneration was replaced by a newer request."));waiters.current.delete(old);}
    return new Promise((resolve,reject)=>{waiters.current.set(id,{resolve,reject});try{w.postMessage({...job,id});}catch(e){waiters.current.delete(id);busyRef.current=false;setBusy(false);const message=e instanceof Error?e.message:"Could not send the slicing request.";setError(message);reject(new Error(message));}});
  },[]);
  useEffect(()=>{
    const w=new SlicerClient();
    worker.current=w;
    w.onmessage=(event:{data:WorkerResponse})=>{
      const response=event.data;if(response.id!==ids.current)return;
      if("progress" in response){setSlicingProgress(response.progress);return;}
      busyRef.current=false;setBusy(false);const pending=waiters.current.get(response.id);waiters.current.delete(response.id);
      if("error" in response){setError(response.error);pending?.reject(new Error(response.error));return;}
      const r=response.result,oldLength=resultRef.current?.pieces.length||0;resultRef.current=r;setResult(r);setSheetIndex(i=>r.sheets.find(s=>s.placements.some(p=>p.pieceId===selectedRef.current))?.sheetIndex??Math.min(i,Math.max(0,r.sheets.length-1)));setSelected(s=>r.pieces.some(p=>p.id===s)?s:null);
      setStep(old=>old>=oldLength?r.pieces.length:Math.min(old,r.pieces.length));
      requestAnimationFrame(()=>pending?.resolve(r));
    };
    w.onerror=(event)=>{busyRef.current=false;setBusy(false);setError(event.message);for(const pending of waiters.current.values())pending.reject(new Error(event.message));waiters.current.clear();};
    void process({type:"preset",preset:"jimmy",settings:settingsRef.current}).catch(()=>{});
    return ()=>{w.terminate();worker.current=null;for(const p of waiters.current.values())p.reject(new Error("Workspace closed."));waiters.current.clear();};
  },[process]);
  useEffect(()=>{
    if(skipSettings.current){skipSettings.current=false;return;}
    ids.current++;busyRef.current=true;setBusy(true);
    const timer=setTimeout(()=>{void process({type:"settings",settings}).catch(()=>{});},150);
    return ()=>clearTimeout(timer);
  },[settings,process]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(""),4500);return ()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{if(!playing||!result)return;const timer=setInterval(()=>setStep(s=>{if(s>=result.pieces.length){setPlaying(false);return s;}return s+1;}),420);return ()=>clearInterval(timer);},[playing,result]);
  const commitSettings=(next:SliceSettings,immediate=false)=>{
    if(!history.current.push(settingsRef.current,next))return false;
    refreshHistory(n=>n+1);settingsRef.current=next;ids.current++;busyRef.current=true;setBusy(true);
    if(immediate)skipSettings.current=true;
    setSettings(next);return true;
  };
  const restoreHistory=(redo=false)=>{
    if(recordAbort.current)return;
    const next=redo?history.current.redo(settingsRef.current):history.current.undo(settingsRef.current);
    if(!next)return;
    settingsRef.current=next;ids.current++;busyRef.current=true;setBusy(true);setSettings(next);refreshHistory(n=>n+1);
    setNotice(redo?"Parameter change redone":"Parameter change undone");
  };
  const historyActions=useRef(restoreHistory);historyActions.current=restoreHistory;
  useEffect(()=>{
    const keys=(e:KeyboardEvent)=>{
      if(!e.ctrlKey&&!e.metaKey||e.altKey)return;
      const target=e.target instanceof Element?e.target:null;
      if(target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
      if(e.key.toLowerCase()==="z"){e.preventDefault();historyActions.current(e.shiftKey);}
      else if(e.ctrlKey&&e.key.toLowerCase()==="y"){e.preventDefault();historyActions.current(true);}
    };
    window.addEventListener("keydown",keys);return ()=>window.removeEventListener("keydown",keys);
  },[]);
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{if(resultRef.current){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",warn);return ()=>window.removeEventListener("beforeunload",warn);
  },[]);
  const wasParametersOpen=useRef(false);
  useEffect(()=>{if(wasParametersOpen.current&&!parametersOpen)saveMachineDefaults(settingsRef.current);wasParametersOpen.current=parametersOpen;},[parametersOpen]);
  const change=<K extends keyof SliceSettings>(key:K,value:SliceSettings[K])=>commitSettings({...settingsRef.current,[key]:value});
  const dimension=(axis:Axis,value:number)=>commitSettings({...settingsRef.current,[axis==="X"?"targetWidth":axis==="Y"?"targetDepth":"targetHeight"]:value,scaleAxis:axis});
  const choosePreset=(preset:Preset,reset=false)=>{
    const next=reset?structuredClone(DEFAULT_SETTINGS):{...settingsRef.current,partThickness:{}};
    if(preset==="jimmy")Object.assign(next,{mode:"interlocking",targetWidth:220,keepAspectRatio:true,scaleAxis:"X",xSliceCount:10,ySliceCount:8});
    if(preset==="cube"&&!reset)Object.assign(next,{targetWidth:100,targetDepth:100,targetHeight:100,scaleAxis:"X",xSliceCount:4,ySliceCount:4,materialThickness:4});
    if(preset==="letter_t"||preset==="letter_s"||preset==="donut_box")Object.assign(next,{mode:"finger_box",targetWidth:220,scaleAxis:"X",keepAspectRatio:true});
    if(preset==="letter_s")next.fingerBox={...boxSettings(next),curveHandling:"living_hinge"};
    history.current.clear();refreshHistory(n=>n+1);settingsRef.current=next;
    skipSettings.current=true;setSettings(next);setModelChoice(preset);setSelected(null);setInspectorOpen(false);setExplode(0);setStep(10000);setPlaying(false);setSheetIndex(0);
    void process({type:"preset",preset,settings:next}).catch(()=>{});
  };
  const loadFile=async(file:File)=>{
    if(!/\.(stl|obj)$/i.test(file.name)){setError("Choose a .stl or .obj mesh file.");return;}
    if(file.size>100*1024*1024){setError("This mesh is over 100 MB. Simplify it before importing.");return;}
    ids.current++;busyRef.current=true;setBusy(true);setError("");setPlaying(false);setSelected(null);setInspectorOpen(false);setStep(10000);setExplode(0);setSheetIndex(0);
    try{const buffer=await file.arrayBuffer();await process({type:"load",buffer,name:file.name,settings:{...settingsRef.current,partThickness:{}}});history.current.clear();refreshHistory(n=>n+1);skipSettings.current=true;const next={...settingsRef.current,partThickness:{}};settingsRef.current=next;setSettings(next);setModelChoice("uploaded");}catch(e){if(e instanceof Error&&!e.message.includes("replaced")){setError(e.message);busyRef.current=false;setBusy(false);}}
  };
  const assignPart=(id:string,slot=activeThickness)=>{
    const p=resultRef.current?.pieces.find(p=>p.id===id);if(!p||recording)return;
    const target=p.kind==="alignment-pin"?"P-ALL":p.parentId;
    if(target==="P-ALL"){setNotice("Cut-material pins use T1 stock; their holes match that thickness.");return;}
    change("partThickness",{...settingsRef.current.partThickness,[target]:slot});
  };
  const editMaterial=(id:string,key:string,value:string|number|boolean)=>{
    if(key==="family"||key==="acrylicFinish"||key==="tintHex")setColorByThickness(false);
    const next=materials(settingsRef.current).map(m=>m.id===id?{...m,[key]:value,...(key==="family"?{allowLivingHinges:value!=="acrylic"}:{})}:m);
    if(id==="T1"&&(key==="thickness"||key==="laserKerf")){change(key==="thickness"?"materialThickness":"laserKerf",Number(value));return;}
    change("materialPresets",next);
  };
  const customHingePattern=(id:string,enabled:boolean)=>{
    const f=boxSettings(settingsRef.current);
    change("materialPresets",materials(settingsRef.current).map(m=>m.id===id?{...m,hingePitch:enabled?f.livingHingeGap:undefined,hingeSlitLength:enabled?f.livingHingeSlitLength:undefined}:m));
  };
  const selectPart=(id:string|null)=>{const chosen=id&&result?(result.pieces.find(p=>p.id===id)||result.pieces.find(p=>p.parentId===id))?.id||null:null;setSelected(chosen);if(chosen)setInspectorOpen(true);if(chosen&&paintThickness&&!busy)assignPart(chosen);if(chosen&&result){setPlaying(false);setStep(old=>Math.max(old,result.pieces.findIndex(p=>p.id===chosen)+1));const sheet=result.sheets.find(s=>s.placements.some(p=>p.pieceId===chosen));if(sheet)setSheetIndex(sheet.sheetIndex);}};
  const blocked=busy||recording||!!error||!result||result.issues.some(i=>i.severity==="error");
  const dxfBlocked=busy||recording||!!error||!result||!result.pieces.length;
  const save=(format:"zip"|"svg"|"dxf",index=sheetIndex,labels=exportLabels)=>{
    const r=resultRef.current;
    if(busyRef.current||error||!r||!r.pieces.length)throw new Error("Wait for a completed slicing result before exporting.");
    if(format!=="dxf"&&r.issues.some(i=>i.severity==="error"))throw new Error("Resolve the fabrication errors before exporting SVG or the laser ZIP. DXF export is available.");
    const unplaced=format==="dxf"&&r.unplaced.length>0&&index===r.sheets.length;
    if(!unplaced&&!r.sheets[index])throw new Error("Choose an existing sheet.");
    const filename=format==="zip"?exportFileName(r,"laser-sheets","zip",exportOptions):unplaced?exportFileName(r,"unplaced-parts","dxf",exportOptions):sheetFileName(r,index,format,exportOptions);
    saveMachineDefaults(settingsRef.current);
    if(format==="zip")download(exportBundle(r,labels,legacy,dxfLines,exportOptions),filename,"application/zip");
    else if(format==="dxf")download(unplaced?exportUnplacedDXF(r,labels,legacy,dxfLines):exportDXF(r,r.sheets[index],labels,legacy,dxfLines),filename,"application/dxf");
    else download(exportSVG(r,r.sheets[index],labels),filename,"image/svg+xml");
    setNotice(`Downloaded ${filename}`);return {filename,format,sheets:format==="zip"?r.sheets.length:1};
  };
  const extraDownload=(type:"obj"|"diagram"|"guide-pdf"|"master-dxf"|"master-svg")=>{
    if(!result||busy||error)return;
    saveMachineDefaults(settingsRef.current);
    const name=exportFileName(result,type==="obj"?"Assembly":type==="diagram"?"Assembly_Diagram":type==="guide-pdf"?"Assembly_Guide":"MASTER_ALL_SHEETS",type==="obj"?"obj":type==="guide-pdf"?"pdf":type==="master-dxf"?"dxf":"svg",exportOptions);
    const data=type==="obj"?exportAssemblyOBJ(result):type==="diagram"?exportAssemblyDiagram(result):type==="guide-pdf"?exportAssemblyGuide(result,guidePageSize,projectName).pdf:type==="master-dxf"?exportMasterDXF(result,exportLabels,legacy,dxfLines):exportMasterSVG(result,exportLabels);
    download(data,name,type==="obj"?"text/plain":type==="guide-pdf"?"application/pdf":type==="master-dxf"?"application/dxf":"image/svg+xml");setNotice(`Downloaded ${name}`);
  };
  const recordVideo=async()=>{
    if(recording){recordAbort.current?.abort();return;}if(!result||!viewport.current)return;
    saveMachineDefaults(settingsRef.current);
    setViewportMode("assembly");setSequenceOpen(true);setExportOpen(false);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const controller=new AbortController();recordAbort.current=controller;setPlaying(false);setRecording(true);setRecordProgress(0);
    try{const blob=await viewport.current.recordVideo(p=>setRecordProgress(p),controller.signal,videoGhost);const name=exportFileName(result,"Assembly",blob.type.includes("mp4")?"mp4":"webm",exportOptions),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setNotice(`Downloaded ${name}`);}
    catch(e){if(!(e instanceof DOMException&&e.name==="AbortError"))setNotice(e instanceof Error?e.message:"Video recording failed.");}
    finally{setRecording(false);recordAbort.current=null;}
  };
  useEffect(()=>()=>recordAbort.current?.abort(),[]);
  const actionsRef=useRef({settings,save,process,error});actionsRef.current={settings,save,process,error};
  useEffect(()=>registerSlicerTools({
    read:()=>({...summary(resultRef.current),pending:busyRef.current,error:actionsRef.current.error}),
    configure:async input=>{
      if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Expected an object of slicing settings.");
      const allowed=["mode","targetWidth","materialThickness","laserKerf","slotFitTolerance","xSliceCount","ySliceCount","stackedAxis","alignmentPins","alignmentPinType","pinDiameter","pinCount","slotFitTolerance","sheetWidth","sheetHeight","skipTopLayersCount","materialPresets","partThickness","scrapSheets","fingerBox","nestingMode","rotationStep","allowRotation","partSpacing","sheetMargin"];
      for(const [k,v] of Object.entries(input)){if(!allowed.includes(k))throw new Error(`Unknown setting: ${k}`);if(k==="alignmentPins"&&typeof v!=="boolean")throw new Error("alignmentPins must be a boolean.");}
      const next={...actionsRef.current.settings,...input, ...("targetWidth" in input?{scaleAxis:"X" as Axis}:{})};validateSettings(next);
      if(!commitSettings(next,true)&&resultRef.current&&!busyRef.current)return summary(resultRef.current);
      const r=await actionsRef.current.process({type:"settings",settings:next});return summary(r);
    },
    export:input=>{
      if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Expected export options.");
      const o=input as Record<string,unknown>;if(Object.keys(o).some(k=>!["format","sheet","labels"].includes(k)))throw new Error("Unknown export option.");
      if(!["zip","dxf","svg"].includes(String(o.format)))throw new Error("Format must be zip, svg, or dxf.");
      if(o.sheet!==undefined&&(typeof o.sheet!=="number"||!Number.isInteger(o.sheet)||o.sheet<1))throw new Error("Sheet must be a positive integer.");
      if(o.labels!==undefined&&typeof o.labels!=="boolean")throw new Error("labels must be a boolean.");
      return actionsRef.current.save(o.format as "zip"|"dxf"|"svg",typeof o.sheet==="number"?o.sheet-1:0,typeof o.labels==="boolean"?o.labels:true);
    },
  }),[]);
  const dims=settings.keepAspectRatio&&result?.model.originalDimensions?(()=>{const d=result.model.originalDimensions,a=settings.scaleAxis==="X"?0:settings.scaleAxis==="Y"?1:2,t=[settings.targetWidth,settings.targetDepth,settings.targetHeight][a];return d.map(n=>n*t/d[a]);})():[settings.targetWidth,settings.targetDepth,settings.targetHeight];
  const sheet=result?.sheets[sheetIndex],piece=result?.pieces.find(p=>p.id===selected),issues=result?.issues||[],errors=issues.filter(i=>i.severity==="error"),warnings=issues.filter(i=>i.severity==="warning");
  const efficiency=result?.sheets.length?result.pieces.filter(p=>!result.unplaced.includes(p.id)).reduce((n,p)=>n+p.area,0)/result.sheets.reduce((n,s)=>n+(s.width||settings.sheetWidth)*(s.height||settings.sheetHeight),0)*100:0;
  const actualStep=result?Math.min(step,result.pieces.length):0,totalCut=result?.pieces.reduce((n,p)=>n+p.cutLength,0)||0;
  const zoom=(kind:"fit"|"in"|"out")=>setZoomAction(z=>({id:z.id+1,kind}));
  return <div className="slice-app" onDragOver={e=>{e.preventDefault();if(e.dataTransfer.types.includes("Files"))setDragOver(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragOver(false);}} onDrop={e=>{e.preventDefault();setDragOver(false);if(!recording&&e.dataTransfer.files[0])void loadFile(e.dataTransfer.files[0]);}}>
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><ToolMark/></span><h1>{APP_CONFIG.NAME}</h1><a className="creator-mark" href={APP_CONFIG.CREATOR_URL} target="_blank" rel="noopener noreferrer" title="MakeSlice by What Make Art" aria-label="What Make Art"><img src={BRAND_LOGO} alt="What Make Art" width="36" height="36"/></a></div>
      <div className="header-project" title={`${result?.model.name||"Jimmy"} · ${dims.map(d=>fmt(d)).join(" × ")} mm`}><h2>{result?.model.name||"Jimmy"}</h2><div className="project-dimensions">{dims.map(d=>fmt(d)).join(" × ")} mm</div></div>
      <div className="header-metric-strip" aria-label="Project metrics"><span className="metric-badge"><strong>{result?.pieces.length??"—"}</strong> parts</span><span className="metric-badge" title={`Standard stock ${settings.sheetWidth} × ${settings.sheetHeight} mm`}><strong>{result?.sheets.length??"—"}</strong> sheets <small>{settings.sheetWidth}×{settings.sheetHeight}</small></span><span className="metric-badge yield-badge">Yield <strong>{result?fmt(efficiency,1):"—"}%</strong></span><button disabled={!issues.length&&!error} onClick={()=>setIssuesOpen(true)} className={`readiness-badge ${errors.length||error?"check-error":warnings.length?"check-warning":"check-ok"}`} title={busy?"Generating geometry and layouts":errors.length?"Review fabrication errors":warnings.length?"Review fabrication notes":"Ready to export"}>{busy?<><Loader2 size={13} className="spin"/>Generating</>:error||errors.length?<><AlertTriangle size={13}/>Needs attention</>:warnings.length?<><Info size={13}/>{warnings.length} notes</>:<><Check size={13}/>Ready to export</>}</button></div>
      <div className="header-actions"><Button variant="ghost" className="icon-button help-button" aria-label="How to use MakeSlice" onClick={()=>setHelpOpen(true)}><Info size={17}/></Button><Button variant="outline" className="upload-button" aria-label="Upload mesh" title="Upload STL or OBJ" disabled={recording} onClick={()=>fileInput.current?.click()}><Upload size={15}/><span>Upload mesh</span></Button><Button className="primary-button" aria-label="Export sheets" disabled={dxfBlocked} onClick={()=>setExportOpen(true)}><Download size={15}/><span>Export sheets</span></Button></div>
      <input type="file" ref={fileInput} accept=".stl,.obj" aria-label="Import STL or OBJ file" className="file-input" onChange={e=>{if(e.target.files?.[0])void loadFile(e.target.files[0]);e.target.value="";}}/>
    </header>
    <div className="workspace-layout">
      {compact&&parametersOpen&&<button className="parameters-backdrop" aria-label="Close parameter settings" onClick={()=>setParametersOpen(false)}/>}
      <aside ref={parametersRef} className={`parameters ${parametersOpen?"parameters-open":""}`} aria-label="Fabrication parameters" role={compact?"dialog":undefined} aria-modal={compact&&parametersOpen?true:undefined} aria-hidden={compact&&!parametersOpen?true:undefined} inert={compact&&!parametersOpen?true:undefined}>
        <div className="parameters-heading"><div><Settings2 size={16}/><strong>Build settings</strong></div><Button className="icon-button parameters-close" variant="ghost" aria-label="Close settings" onClick={()=>setParametersOpen(false)}><X size={17}/></Button></div>
        <div className="parameters-scroll-area"><fieldset className="parameters-fields" disabled={recording}>
          <ParameterGroup number="01" title="Model & scale" defaultOpen><section className="parameter-section model-section"><div className="subsection-title-row"><h3>Source mesh</h3></div>
          <Picker label="Sample model" value={modelChoice} onChange={v=>{if(v!=="uploaded")choosePreset(v as Preset);}} items={[...Object.entries(PRESET_NAMES).map(([value,label])=>({value,label})),...(modelChoice==="uploaded"?[{value:"uploaded",label:result?.model.name||"Imported mesh"}]:[])]}/>
          <p className="field-note">{PRESET_DESCRIPTIONS[modelChoice as Preset]||"Choose an example, or drop an STL / OBJ anywhere."}</p>
        </section><section className="parameter-section"><div className="subsection-title-row"><h3>Dimensions</h3><button className="ratio-lock" title={settings.keepAspectRatio?"Unlock proportions":"Lock proportions"} aria-label={settings.keepAspectRatio?"Unlock proportions":"Lock proportions"} aria-pressed={settings.keepAspectRatio} onClick={()=>{const lock=!settings.keepAspectRatio;commitSettings({...settingsRef.current,keepAspectRatio:lock,targetWidth:dims[0],targetDepth:dims[1],targetHeight:dims[2]});}}>{settings.keepAspectRatio?<Link size={15}/>:<Unlink size={15}/>}</button></div>
          <div className="dimension-fields"><NumberField label="Width · X" value={dims[0]} onChange={n=>dimension("X",n)} min={1}/><NumberField label="Depth · Y" value={dims[1]} onChange={n=>dimension("Y",n)} min={1}/><NumberField label="Height · Z" value={dims[2]} onChange={n=>dimension("Z",n)} min={1}/></div>
          <p className="field-note">{settings.keepAspectRatio?"Proportions locked":"Scale each axis independently"} · millimeters</p>
        </section></ParameterGroup>
          <ParameterGroup number="02" title="Slicing structure" defaultOpen><section className="parameter-section"><div className="subsection-title-row"><h3>Construction method</h3></div>
          <Tabs value={settings.mode} onValueChange={v=>change("mode",v as SliceSettings["mode"])} className="construction-tabs"><TabsList><TabsTrigger value="interlocking"><Grid3X3 size={15}/>Interlocking</TabsTrigger><TabsTrigger value="stacked"><Layers size={15}/>Stacked</TabsTrigger><TabsTrigger value="finger_box"><Box size={15}/>Box</TabsTrigger></TabsList><TabsContent value="interlocking"><p className="field-note">Two families of ribs with matching half-lap slots.</p></TabsContent><TabsContent value="stacked"><p className="field-note">Solid layers, spaced by your material thickness.</p></TabsContent><TabsContent value="finger_box"><p className="field-note">Hollow caps, walls, tabs and optional braces.</p></TabsContent></Tabs>
        </section><section className="parameter-section"><div className="subsection-title-row"><h3>Slicing geometry</h3></div>
          {settings.mode==="interlocking"?<><div className="two-fields"><NumberField label="X ribs" unit="" value={settings.xSliceCount} min={1} max={100} step={1} onChange={n=>change("xSliceCount",n)}/><NumberField label="Y ribs" unit="" value={settings.ySliceCount} min={1} max={100} step={1} onChange={n=>change("ySliceCount",n)}/></div><ParameterRange label="Joint depth split" value={settings.slotDepthRatio*100} min={10} max={90} step={5} onCommit={n=>change("slotDepthRatio",n/100)} readout={n=>`${fmt(n,0)} / ${fmt(100-n,0)}%`}/></>:settings.mode==="finger_box"?<BoxControls settings={settings} onChange={f=>change("fingerBox",f)}/>:<>
            <div className="labeled-picker"><label>Stack axis</label><Picker label="Stack axis" value={settings.stackedAxis} onChange={v=>change("stackedAxis",v as Axis)} items={[{value:"Z",label:"Z · vertical"},{value:"X",label:"X · width"},{value:"Y",label:"Y · depth"}]}/></div>
            <Toggle label="Registration pins" checked={settings.alignmentPins} onChange={b=>change("alignmentPins",b)}/>
            {settings.alignmentPins&&<><Picker label="Pin type" value={settings.alignmentPinType} onChange={v=>change("alignmentPinType",v as "dowel"|"material")} items={[{value:"dowel",label:"Round dowels"},{value:"material",label:"Cut from sheet material"}]}/><div className="two-fields"><NumberField label={settings.alignmentPinType==="material"?"Pin width":"Diameter"} value={settings.pinDiameter} min={.5} max={100} onChange={n=>change("pinDiameter",n)}/><NumberField label="Pins" unit="" value={settings.pinCount} min={1} max={5} step={1} onChange={n=>change("pinCount",n)}/></div>{settings.alignmentPinType==="material"&&<><NumberField label="Pin fit tolerance" value={settings.slotFitTolerance} min={-2} max={5} step={.01} onChange={n=>change("slotFitTolerance",n)}/><p className="field-note">Flat pins with stop heads are included in the cut sheets. Slots are {fmt(settings.pinDiameter+settings.slotFitTolerance,3)} × {fmt(settings.materialThickness+settings.slotFitTolerance,3)} mm. Positive tolerance loosens the fit.</p></>}</>}
            <NumberField label="Unperforated top layers" unit="" value={settings.skipTopLayersCount||0} min={0} max={400} step={1} onChange={n=>change("skipTopLayersCount",n)}/><p className="field-note">Pins end below these final layers. Glue the crown layers in position.</p>
            {result?.settings.mode==="stacked"&&<p className="field-note">{result.layerCount} layers · {fmt(result.builtDepth,2)} mm built depth</p>}
          </>}
        </section></ParameterGroup>
          <ParameterGroup number="03" title="Material & tooling"><section className="parameter-section"><div className="subsection-title-row"><h3>Primary stock & fit</h3></div>
          <p className="field-note primary-stock-note">T1 is the default stock for new parts.</p>
          <div className="two-fields"><NumberField label="Thickness" value={settings.materialThickness} min={.1} max={100} onChange={n=>change("materialThickness",n)}/><NumberField label="Laser kerf" value={settings.laserKerf} step={.01} min={0} max={5} onChange={n=>change("laserKerf",n)}/></div>
          {settings.mode==="interlocking"&&<><div className="two-fields"><NumberField label="Fit tolerance" value={settings.slotFitTolerance} step={.01} min={-2} max={5} onChange={n=>change("slotFitTolerance",n)}/><NumberField label="Lead-in" value={settings.leadInChamfer} min={0} max={20} onChange={n=>change("leadInChamfer",n)}/></div><div className="fit-readout"><span>Finished slot</span><strong>{fmt(settings.materialThickness+settings.slotFitTolerance,3)} mm</strong></div><p className="field-note">Positive tolerance loosens the fit. Kerf is applied once to the cut paths.</p></>}
        </section><section className="parameter-section material-slots"><div className="subsection-title-row"><h3>Thickness slots</h3></div>
          <p className="field-note">Measure thickness and kerf for each stock. Assign any slot to parts in either view.</p>
          {materials(settings).map(m=><details className="material-slot" key={m.id} open={m.id===activeThickness}><summary><i style={{background:m.colorHex}}/><span><strong>{m.id} · {m.thickness} mm</strong><small>{MATERIAL_NAMES[m.family||"cardboard"]} · {m.name}</small></span><ChevronRight size={14}/></summary>
            <div className="labeled-picker stock-type"><label>Material</label><Picker label={`${m.id} material`} value={m.family||"cardboard"} onChange={v=>editMaterial(m.id,"family",v)} items={Object.entries(MATERIAL_NAMES).map(([value,label])=>({value,label}))}/></div>
            {m.family==="acrylic"&&<div className="acrylic-controls"><div className="labeled-picker"><label>Acrylic finish</label><Picker label={`${m.id} acrylic finish`} value={m.acrylicFinish||"clear"} onChange={v=>editMaterial(m.id,"acrylicFinish",v)} items={Object.entries(ACRYLIC_FINISHES).map(([value,finish])=>({value,label:finish.name}))}/></div><label className="slot-color">Acrylic tint<input type="color" aria-label={`${m.id} acrylic tint`} value={materialAppearance(m).color} onChange={e=>editMaterial(m.id,"tintHex",e.target.value)}/></label>{m.tintHex&&<button className="text-action" onClick={()=>change("materialPresets",materials(settings).map(stock=>stock.id===m.id?{...stock,tintHex:undefined}:stock))}>Reset finish tint</button>}</div>}<label className="slot-name">Stock name<Input aria-label={`${m.id} stock name`} value={m.name} onChange={e=>editMaterial(m.id,"name",e.target.value)}/></label><div className="two-fields"><NumberField label={`${m.id} thickness`} value={m.thickness} min={.1} max={100} onChange={v=>editMaterial(m.id,"thickness",v)}/><NumberField label={`${m.id} kerf`} value={m.laserKerf} min={0} max={5} step={.01} onChange={v=>editMaterial(m.id,"laserKerf",v)}/></div>
            {settings.mode==="finger_box"&&<details className="hinge-calibration"><summary>Living hinge calibration</summary><Toggle label={`${m.id} allow living hinges`} checked={!!m.allowLivingHinges} onChange={v=>editMaterial(m.id,"allowLivingHinges",v)}/><NumberField label={`${m.id} effective K factor`} value={m.hingeKFactor??.5} min={0} max={1} step={.01} unit="" onChange={v=>editMaterial(m.id,"hingeKFactor",v)}/><Toggle label={`${m.id} custom hinge pattern`} checked={m.hingePitch!==undefined||m.hingeSlitLength!==undefined} onChange={v=>customHingePattern(m.id,v)}/>{(m.hingePitch!==undefined||m.hingeSlitLength!==undefined)&&<div className="two-fields"><NumberField label={`${m.id} hinge pitch`} value={m.hingePitch??boxSettings(settings).livingHingeGap} min={1} max={10} onChange={v=>editMaterial(m.id,"hingePitch",v)}/><NumberField label={`${m.id} slit length`} value={m.hingeSlitLength??boxSettings(settings).livingHingeSlitLength} min={3} max={100} onChange={v=>editMaterial(m.id,"hingeSlitLength",v)}/></div>}<p className="field-note">0.5 uses the mid-surface. A lower K shortens the developed strip without changing the intended 3D shape. Calibrate to this thickness, grain, and slit pattern.</p>{m.family==="acrylic"?<p className="field-note">Acrylic hinges default off. Tested patterns can make static bends; repeated flexing can break their bridges.</p>:<p className="field-note">{m.family==="plywood"?"Plywood grain and veneer layers affect flexibility.":m.family==="custom"?"Flexibility depends on your stock and cut pattern.":"Cardboard grain and flute direction affect flexibility."} Test a small strip before cutting the model.</p>}{!m.allowLivingHinges&&boxSettings(settings).curveHandling==="living_hinge"&&<Button variant="outline" onClick={()=>change("fingerBox",{...boxSettings(settings),curveHandling:"facets",shellConstruction:"auto"})}>Use flat facets</Button>}</details>}
            <label className="slot-color">Thickness color<input type="color" aria-label={`${m.id} display color`} value={m.colorHex} onChange={e=>editMaterial(m.id,"colorHex",e.target.value)}/></label></details>)}
          <Picker label="Active thickness slot" value={activeThickness} onChange={setActiveThickness} items={materials(settings).map(m=>({value:m.id,label:`${m.id} · ${m.thickness} mm`}))}/>
          <Toggle label="Assign thickness on click" checked={paintThickness} onChange={setPaintThickness}/>
          <Toggle label="Color code by thickness" checked={colorByThickness} onChange={setColorByThickness}/>
          <p className="field-note">Select a part, then apply the active slot. Rib and layer components share stock with their cutting plane.</p>
          <Button variant="outline" disabled={!selected||busy||recording} onClick={()=>selected&&assignPart(selected)}>Apply {activeThickness} to selected</Button>
        </section><section className="parameter-section bed-section"><div className="subsection-title-row"><h3>Sheet & nesting</h3></div>
          <div className="two-fields"><NumberField label="Width" value={settings.sheetWidth} min={20} max={5000} step={1} onChange={n=>change("sheetWidth",n)}/><NumberField label="Height" value={settings.sheetHeight} min={20} max={5000} step={1} onChange={n=>change("sheetHeight",n)}/><NumberField label="Margin" value={settings.sheetMargin} min={0} max={500} onChange={n=>change("sheetMargin",n)}/><NumberField label="Part spacing" value={settings.partSpacing} min={0} max={100} onChange={n=>change("partSpacing",n)}/></div>
          <div className="labeled-picker"><label>Nesting method</label><Picker label="Nesting method" value={settings.nestingMode||"polygon"} onChange={v=>change("nestingMode",v as "polygon"|"rectangles")} items={[{value:"polygon",label:"Polygon nesting"},{value:"rectangles",label:"Bounding boxes"}]}/></div><Toggle label="Allow part rotation" checked={settings.allowRotation} onChange={b=>change("allowRotation",b)}/>{settings.allowRotation&&settings.nestingMode!=="rectangles"&&<Picker label="Nesting rotation step" value={String(settings.rotationStep||90)} onChange={v=>change("rotationStep",Number(v) as 90|15)} items={[{value:"90",label:"90° steps · faster"},{value:"15",label:"15° steps · more orientations"}]}/>}<p className="field-note">Polygon nesting uses conservative occupied cells, including clearance. Parts can share concave pockets. Cut paths keep their full vector resolution.</p>
        </section></ParameterGroup>
          <ParameterGroup number="04" title="Advanced / production"><section className="parameter-section">{settings.mode==="finger_box"&&<><div className="subsection-title-row"><h3>Box joinery & reinforcement</h3></div><BoxControls advanced settings={settings} onChange={f=>change("fingerBox",f)}/></>}</section><section className="parameter-section scrap-inventory"><div className="subsection-title-row"><h3>Scrap inventory</h3></div><p className="field-note">Rectangular scraps pack first, grouped by stock. Standard sheets fill the shortfall.</p>
          {(settings.scrapSheets||[]).map((scrap,i)=><div className="scrap-entry" key={scrap.id}><div className="scrap-heading"><strong>Scrap {i+1}</strong><button aria-label={`Remove scrap ${i+1}`} onClick={()=>change("scrapSheets",settings.scrapSheets!.filter(q=>q.id!==scrap.id))}><X size={14}/></button></div><div className="two-fields"><NumberField label={`Scrap ${i+1} width`} value={scrap.width} min={20} max={5000} step={1} onChange={v=>change("scrapSheets",settings.scrapSheets!.map(q=>q.id===scrap.id?{...q,width:v}:q))}/><NumberField label={`Scrap ${i+1} height`} value={scrap.height} min={20} max={5000} step={1} onChange={v=>change("scrapSheets",settings.scrapSheets!.map(q=>q.id===scrap.id?{...q,height:v}:q))}/><NumberField label={`Scrap ${i+1} quantity`} unit="" value={scrap.quantity} min={1} max={100} step={1} onChange={v=>change("scrapSheets",settings.scrapSheets!.map(q=>q.id===scrap.id?{...q,quantity:v}:q))}/></div><Picker label={`Scrap ${i+1} stock`} value={scrap.thicknessId} onChange={v=>change("scrapSheets",settings.scrapSheets!.map(q=>q.id===scrap.id?{...q,thicknessId:v}:q))} items={materials(settings).map(m=>({value:m.id,label:`${m.id} · ${m.thickness} mm`}))}/></div>)}
          <Button variant="outline" disabled={(settings.scrapSheets?.length||0)>=50} onClick={()=>change("scrapSheets",[...settings.scrapSheets||[],{id:`SCRAP-${Date.now()}`,width:300,height:200,thicknessId:activeThickness,quantity:1}])}><Plus size={14}/>Add scrap sheet</Button>
          {!!settings.scrapSheets?.length&&result&&<p className="stock-shortfall">Requires {result.sheets.filter(s=>s.source==="stock").length} standard sheets in addition to {result.sheets.filter(s=>s.source==="scrap").length} used scraps.</p>}
        </section></ParameterGroup>
          <div className="local-note"><Box size={14}/><span>Mesh processing stays in your browser.</span></div>
        </fieldset></div>
        <div className="sidebar-footer"><Button className="primary-button bundle-button" disabled={dxfBlocked} onClick={()=>{setParametersOpen(false);setExportOpen(true);}}><Package size={16}/>Export cut bundle</Button><span>Number edits: Enter or blur · Undo: Ctrl / ⌘ Z</span></div>
      </aside>
      <main className="main-workspace">
        <div className="workspace-toolbar"><div className="viewport-switch" role="group" aria-label="Viewport mode">{([{value:"assembly",label:"3D Assembly",icon:Box},{value:"sheets",label:"2D Sheets",icon:Grid3X3},{value:"split",label:"Split",icon:Layers}] as const).map(mode=><button key={mode.value} disabled={recording||(compact&&mode.value==="split")} className={viewportMode===mode.value?"active":""} aria-pressed={viewportMode===mode.value} onClick={()=>setViewportMode(mode.value)}><mode.icon size={14}/>{mode.label}</button>)}</div><div className="history-controls"><Button variant="ghost" className="icon-button" aria-label="Undo parameter change" title="Undo · Ctrl / ⌘ Z" disabled={!history.current.canUndo||recording} onClick={()=>restoreHistory()}><Undo2 size={16}/></Button><Button variant="ghost" className="icon-button" aria-label="Redo parameter change" title="Redo · Ctrl / ⌘ Shift Z" disabled={!history.current.canRedo||recording} onClick={()=>restoreHistory(true)}><Redo2 size={16}/></Button></div>{settings.mode==="finger_box"&&result&&<div className="construction-readout"><span>{result.pieces.some(p=>p.shellMethod==="contour_bands")?`${result.layerCount} contour bands`:result.pieces.some(p=>p.shellMethod==="mesh_panels")?"Faceted surface shell":"Extruded box shell"}</span>{result.pieces.some(p=>p.wallRole==="hole")&&<span>{result.pieces.filter(p=>p.wallRole==="hole").length} inner tunnel walls</span>}</div>}<Button variant="ghost" className="inspector-trigger" aria-label="Open parts inspector" aria-pressed={inspectorOpen} onClick={()=>setInspectorOpen(v=>!v)}><PanelRight size={16}/><span>Parts</span></Button></div>
        {(error||errors.length>0)&&<div className="error-banner" role="alert"><AlertTriangle size={16}/><span>{error||errors[0].message}</span>{!error&&<button onClick={()=>setIssuesOpen(true)}>Details</button>}</div>}
        <div className="preview-grid" data-mode={viewportMode}>
          <section className="assembly-panel" aria-label="3D assembly preview" hidden={viewportMode==="sheets"}>
            <div className={`assembly-stage ${sequenceOpen||recording?"sequence-open":""}`}>
              <AssemblyViewport active={viewportMode!=="sheets"} ref={viewport} colorByThickness={colorByThickness} xray={xray} result={result} explode={explode} step={actualStep} ghost={ghost} selected={selected} onSelect={selectPart} view={view} fit={fit}/>
              <div className="panel-header"><div><Box size={15}/><h3>Assembly</h3><span className="small-tag">3D</span></div><Button variant="ghost" className="sequence-toggle" aria-expanded={sequenceOpen||recording} onClick={()=>{setSequenceOpen(v=>!v);setPlaying(false);}} disabled={recording}><Play size={13}/><span>Sequence</span><ChevronDown size={13}/></Button></div>
              <div className="view-actions"><div className="view-buttons">{(["iso","front","top"] as const).map(v=><button className={view===v?"active":""} key={v} onClick={()=>setView(v)} aria-label={`${v} view`} aria-pressed={view===v}>{v}</button>)}</div><Button variant="ghost" className="icon-button" aria-label="Fit assembly in view" onClick={()=>setFit(n=>n+1)}><Maximize2 size={15}/></Button></div>
              <div className="stage-note">Drag to orbit · Scroll to zoom</div><div className="axis-legend"><span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span></div>
              {busy&&<div className="processing-pill" role="status"><Loader2 size={14} className="spin"/>{slicingProgress.stage==="nesting"?`Nesting ${slicingProgress.completed} / ${slicingProgress.total} · ${slicingProgress.percent}%`:"Building geometry…"}</div>}
              {!result&&!error&&<div className="stage-initial"><Layers size={40} strokeWidth={1}/><p>Preparing your first assembly</p></div>}
              <div className="assembly-hud"><div className="explode-control"><div className="range-row"><label>Explode</label><span>{explode===0?"Assembled":`${explode}%`}</span></div><Range label="Explode assembly" value={explode} onChange={setExplode}/></div><div className="ghost-control"><Toggle label="Ghost mesh" checked={ghost} onChange={setGhost}/>{settings.mode==="finger_box"&&<Toggle label="X-Ray bracing view" checked={xray} onChange={setXray}/>}</div></div>
              {(sequenceOpen||recording)&&<div className="sequence-control"><div className="sequence-heading"><div className="sequence-title"><span>Assembly sequence</span><span>{actualStep} / {result?.pieces.length??0}</span></div><Button variant="outline" className="sequence-video-button" disabled={dxfBlocked&&!recording} aria-label={recording?"Cancel assembly video recording":"Download assembly video"} onClick={()=>void recordVideo()}><Download size={14}/>{recording?`Cancel · ${Math.round(recordProgress*100)}%`:"Download video"}</Button></div><div className="sequence-player"><Button variant="ghost" className="icon-button" aria-label="First assembly step" onClick={()=>{setPlaying(false);setStep(0);}}><SkipBack size={14}/></Button><Button variant="ghost" className="icon-button play-button" disabled={!result} aria-label={playing?"Pause assembly":"Play assembly"} onClick={()=>{if(!playing&&result&&actualStep>=result.pieces.length)setStep(0);setPlaying(v=>!v);}}>{playing?<Pause size={15}/>:<Play size={15}/>}</Button><Range label="Assembly step" value={actualStep} max={Math.max(1,result?.pieces.length||1)} onChange={n=>{setPlaying(false);setStep(n);}}/><Button variant="ghost" className="icon-button" aria-label="Show completed assembly" onClick={()=>{setPlaying(false);setStep(result?.pieces.length||0);}}><SkipForward size={14}/></Button></div><div className="sequence-video-options"><Toggle label="Show Reference Ghost Mesh in Video" checked={videoGhost} onChange={setVideoGhost}/></div></div>}
            </div>
          </section>
          <ViewportSplitter active={viewportMode==="split"&&!compact}/>
          <section className="sheet-panel" aria-label="Laser sheet layout" hidden={viewportMode==="assembly"}><div className="sheet-stage">
            {result&&sheet&&viewportMode!=="assembly"?<SheetViewer colorByThickness={colorByThickness} result={result} sheetIndex={sheetIndex} selected={selected} onSelect={selectPart} cuts={showCuts} labels={showLabels} raw={showRaw} pins={showPins} zoomAction={zoomAction}/>:<div className="sheet-empty"><Grid3X3 size={32} strokeWidth={1}/><p>{result?"No parts fit this sheet":"Nesting your parts"}</p></div>}
            <div className="panel-header"><div><Grid3X3 size={15}/><h3>Laser layout</h3><span className="small-tag">2D</span></div><span className="sheet-size">{fmt(sheet?.width||settings.sheetWidth,0)} × {fmt(sheet?.height||settings.sheetHeight,0)} mm</span></div>
            <div className="sheet-navigation"><Button variant="ghost" className="icon-button" aria-label="Previous sheet" disabled={sheetIndex===0} onClick={()=>setSheetIndex(i=>i-1)}><ChevronLeft size={16}/></Button><Picker label="Selected laser sheet" value={String(sheetIndex)} onChange={v=>setSheetIndex(Number(v))} items={result?.sheets.length?result.sheets.map(s=>({value:String(s.sheetIndex),label:`Sheet ${s.sheetIndex+1} · ${s.thicknessId||"T1"} · ${s.source||"stock"}`})):[{value:"0",label:result?"No sheets":"Preparing sheets"}]}/><Button variant="ghost" className="icon-button" aria-label="Next sheet" disabled={!result||sheetIndex>=result.sheets.length-1} onClick={()=>setSheetIndex(i=>i+1)}><ChevronRight size={16}/></Button><div className="sheet-zoom"><Button variant="ghost" className="icon-button" aria-label="Zoom out of sheet" onClick={()=>zoom("out")}><Minus size={14}/></Button><Button variant="ghost" className="icon-button" aria-label="Zoom into sheet" onClick={()=>zoom("in")}><Plus size={14}/></Button><Button variant="ghost" className="icon-button" aria-label="Fit sheet in view" onClick={()=>zoom("fit")}><Maximize2 size={14}/></Button></div></div>
            <div className="sheet-hud"><div className="sheet-metrics"><span>{sheet?.placements.length??0} parts</span><span>{fmt((sheet?.utilization||0)*100,0)}% used</span><span>{fmt((sheet?.cutLength||0)/1000,2)} m cut</span></div><div className="sheet-hud-actions"><div className="layer-toggles">{[{name:"Cut",checked:showCuts,set:setShowCuts,color:"cut"},{name:"Labels",checked:showLabels,set:setShowLabels,color:"labels"},{name:"Interiors",checked:showPins,set:setShowPins,color:"pins"},{name:"Raw",checked:showRaw,set:setShowRaw,color:"raw"}].map(layer=><button key={layer.name} aria-pressed={layer.checked} className={`${layer.color} ${layer.checked?"on":""}`} onClick={()=>layer.set(v=>!v)}><span/>{layer.name}</button>)}</div><div className="sheet-downloads"><Button variant="outline" disabled={dxfBlocked} onClick={()=>save("dxf")}><Download size={13}/>DXF</Button>{!!result?.sheets.length&&!!result.unplaced.length&&<Button variant="outline" disabled={dxfBlocked} onClick={()=>save("dxf",result.sheets.length)}>Unplaced DXF</Button>}<Button variant="outline" disabled={blocked} onClick={()=>save("svg")}><Download size={13}/>SVG</Button></div></div></div>
          </div></section>
        </div>
        <section className={`part-inspector ${inspectorOpen?"inspector-open":""}`} aria-label="Parts inspector" aria-hidden={!inspectorOpen} inert={!inspectorOpen}>
          <div className="inspector-heading"><div><PanelRight size={16}/><h2>Parts inspector</h2></div><Button variant="ghost" className="icon-button" aria-label="Close parts inspector" onClick={()=>{setInspectorOpen(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(".inspector-trigger")?.focus());}}><X size={17}/></Button></div>
          <div className="inspector-scroll">{piece?<div className="selected-part-details"><div className="selected-part-title"><strong>{piece.id}</strong><button aria-label="Clear part selection" onClick={()=>setSelected(null)}><X size={14}/></button></div><dl><dt>Cut dimensions</dt><dd>{fmt(piece.bounds.width)} × {fmt(piece.bounds.height)} mm</dd><dt>Stock</dt><dd>{piece.assignedThicknessId||"T1"} · {fmt(piece.thickness||settings.materialThickness,2)} mm</dd><dt>Orientation</dt><dd>{piece.axis==="UNROLLED"?(piece.shellMethod==="mesh_panels"?"Flat surface panel":"Unrolled wall blank"):`${piece.frameRotation?"Construction frame · ":""}${piece.axis} = ${fmt(piece.worldPosition,2)} mm`}</dd>{piece.bandRange&&<><dt>Contour band</dt><dd>{fmt(piece.bandRange[0])}–{fmt(piece.bandRange[1])} mm</dd></>}<dt>Sheet</dt><dd>{result?.sheets.find(s=>s.placements.some(p=>p.pieceId===piece.id))?.sheetIndex!==undefined?`Sheet ${result.sheets.find(s=>s.placements.some(p=>p.pieceId===piece.id))!.sheetIndex+1}`:"Unplaced"}</dd><dt>Mates</dt><dd>{piece.kind==="alignment-pin"?"Insert from layer 1":piece.joints.length?[...new Set(piece.joints)].join(", "):settings.mode==="stacked"?"Stack in numerical order":"No interlocking joint"}</dd></dl><Picker label="Selected part stock" value={piece.assignedThicknessId||"T1"} onChange={v=>assignPart(piece.id,v)} items={materials(settings).map(m=>({value:m.id,label:`${m.id} · ${m.thickness} mm`}))}/><p className="field-note">Changing stock updates this part, its mating joints, and sheet placement.</p></div>:<p className="field-note">Click a part in either canvas to see its stock, joints, and cutting sheet.</p>}
          <div className="part-list-heading"><h3>Parts on this sheet</h3><span>{piece?`Selected ${piece.id}`:`${sheet?.placements.length||0} parts`}</span></div><div className="part-chips">{sheet?.placements.map(p=><button className={selected===p.pieceId?"selected":""} key={p.pieceId} onClick={()=>selectPart(p.pieceId)} aria-pressed={selected===p.pieceId}><span className={p.pieceId.startsWith("Y")?"chip-y":"chip-x"}/>{p.pieceId}{p.rotation!==0&&<small>{p.rotation}°</small>}</button>)}</div></div>
        </section>
        {compact&&<Button hidden={parametersOpen} className="tune-settings" onClick={()=>setParametersOpen(true)}><SlidersHorizontal size={16}/>Tune settings</Button>}
      </main>
    </div>
    <footer className="app-footer"><div className="footer-links"><a href={APP_CONFIG.CREATOR_URL} target="_blank" rel="noopener noreferrer">Created by What Make Art</a><a href={APP_CONFIG.REPO_URL} target="_blank" rel="noopener noreferrer">GitHub source ↗</a></div><div><span>{result?`${fmt(result.model.triangleCount,0)} triangles · ${Math.round(result.processingMs)} ms`:"Preparing model"}</span><span>{fmt(totalCut/1000,2)} m total cut</span><span>mm · v{APP_CONFIG.VERSION}</span></div></footer>
    {dragOver&&<div className="drop-overlay"><Upload size={48}/><h2>Drop your mesh</h2><p>STL or OBJ · up to 100 MB</p></div>}
    {notice&&<div className="download-notice" role="status"><Check size={16}/>{notice}</div>}
    <Dialog open={exportOpen} onOpenChange={setExportOpen}><DialogContent className="export-dialog"><DialogHeader><div className="dialog-icon"><Package size={24}/></div><DialogTitle>{errors.length?"Export for CAD editing":"Ready for the laser"}</DialogTitle><DialogDescription>{result?.pieces.length} parts across {result?.sheets.length} sheets. Files use millimeters at 1:1 scale.</DialogDescription></DialogHeader><div className="export-summary"><div><span>Material</span><strong>{settings.materialThickness} mm</strong></div><div><span>Kerf</span><strong>{settings.laserKerf} mm</strong></div><div><span>Cut length</span><strong>{fmt(totalCut/1000,2)} m</strong></div></div><section className="export-options-card"><h3>Export file naming</h3><label className="slot-name">Project name<Input aria-label="Export project name" value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder={result?.model.name.replace(/\.(stl|obj)$/i,"")}/></label><div className="two-fields"><label className="slot-name">Prefix (optional)<Input aria-label="Export file prefix" value={filePrefix} onChange={e=>setFilePrefix(e.target.value)}/></label><label className="slot-name">Suffix (optional)<Input aria-label="Export file suffix" value={fileSuffix} onChange={e=>setFileSuffix(e.target.value)}/></label></div><Toggle label="Include sheet suffix" checked={sheetSuffix} onChange={setSheetSuffix}/><p className="filename-preview">{result?sheetFileName(result,sheetIndex,"dxf",exportOptions):""}</p><p className="field-note">Sheet numbers are always included to keep batch files unique. Spaces and filesystem characters become underscores.</p>{[projectName,filePrefix,fileSuffix].some(v=>v&&sanitizeFileComponent(v)!==v)&&<p className="field-note">The preview shows the filename after sanitizing.</p>}</section><section className="export-options-card"><h3>Printable assembly guide</h3><Picker label="Assembly guide page size" value={guidePageSize} onChange={v=>setGuidePageSize(v as GuidePageSize)} items={[{value:"letter",label:"Letter · 8.5 × 11 in"},{value:"a4",label:"A4 · 210 × 297 mm"}]}/><p className="field-note">ZIP includes the large assembly diagram, a vector PDF, and every printable SVG page.</p></section><section className="export-options-card"><h3>Assembly & master downloads</h3><p className="field-note">All diagrams, labeled inventories, and printable pages are also included in the laser ZIP.</p><div className="assembly-export-buttons"><Button variant="outline" disabled={dxfBlocked} onClick={()=>extraDownload("obj")}>Assembly OBJ</Button><Button variant="outline" disabled={dxfBlocked} onClick={()=>extraDownload("diagram")}>Exploded manual</Button><Button variant="outline" disabled={dxfBlocked} onClick={()=>extraDownload("guide-pdf")}>Printable PDF</Button><Button variant="outline" disabled={dxfBlocked||!result?.sheets.length} onClick={()=>extraDownload("master-dxf")}>Master DXF</Button><Button variant="outline" disabled={blocked||!result?.sheets.length} onClick={()=>extraDownload("master-svg")}>Master SVG</Button><Button variant="outline" disabled={dxfBlocked&&!recording} onClick={()=>void recordVideo()}>{recording?"Cancel recording":"Record assembly video"}</Button></div></section><Toggle label="Include vector labels & guides" checked={exportLabels} onChange={setExportLabels}/><Toggle label="Legacy R12 DXF" checked={legacy} onChange={setLegacy}/>{!legacy&&<Toggle label="DXF line segments (Illustrator)" checked={dxfLines} onChange={setDxfLines}/>}<p className="field-note">{legacy?"R12 uses classic POLYLINE entities. Select millimeters when importing.":"Closed, joined AutoCAD 2000 polylines by default. Edge-open notches stay in the red perimeter; enclosed holes are green. Hinge slits and label strokes stay open. In Illustrator, choose Original Size, millimeters, and Model layout. Enable line segments only if your importer requires them."}</p><div className="export-layer-key"><span><i className="cut"/>Cut outlines</span><span><i className="labels"/>Etch labels</span><span><i className="pins"/>Interior cuts</span></div>{warnings.length>0&&<button className="export-notes" onClick={()=>{setExportOpen(false);setIssuesOpen(true);}}><AlertTriangle size={15}/>Review {warnings.length} fabrication notes</button>}{errors.length>0&&<p className="field-note">DXF export is available with the reported fabrication errors. Unplaced parts export without a sheet-size limit.</p>}<Button variant="outline" disabled={dxfBlocked} onClick={()=>save("dxf")}><Download size={14}/>Download DXF</Button>{!!result?.sheets.length&&!!result.unplaced.length&&<Button variant="outline" disabled={dxfBlocked} onClick={()=>save("dxf",result.sheets.length)}><Download size={14}/>Download unplaced parts · DXF</Button>}<p className="export-fit-note">Paths already include kerf compensation. Disable extra kerf offsets in your laser software, and cut a small fit sample first.</p><Button className="primary-button bundle-button" disabled={blocked} onClick={()=>save("zip")}><Download size={17}/>Download all sheets · ZIP</Button><p className="export-contents">Per-sheet + master DXF/SVG, assembly OBJ, exploded diagram, paginated SVG/PDF guide, BOM, naming metadata, and settings.</p></DialogContent></Dialog>
    <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}><DialogContent className="issues-dialog"><DialogHeader><DialogTitle>Fabrication check</DialogTitle><DialogDescription>{errors.length?"DXF export is available. Resolve these errors before exporting SVG or the laser ZIP.":"Inspect these notes before cutting and assembling."}</DialogDescription></DialogHeader><div className="issues-list">{error&&<div className="issue error"><AlertTriangle size={17}/><div><p>{error}</p></div></div>}{issues.map(i=><div className={`issue ${i.severity}`} key={i.code}><AlertTriangle size={17}/><div><p>{i.message}</p>{!!i.partIds?.length&&<div className="issue-parts">{i.partIds.slice(0,18).map(id=><button key={id} onClick={()=>{selectPart(id);setIssuesOpen(false);}}>{id}</button>)}{i.partIds.length>18&&<span>+{i.partIds.length-18} more</span>}</div>}</div></div>)}{!issues.length&&!error&&<p>All generated contours are closed and all parts fit the sheets.</p>}</div></DialogContent></Dialog>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="help-dialog"><DialogHeader><DialogTitle>From mesh to material</DialogTitle><DialogDescription>Create ribs, stacked layers, extruded shells, or hollow living-hinge contour bands.</DialogDescription></DialogHeader><ol className="help-steps"><li><strong>Import and size</strong><p>Load a closed STL/OBJ or choose a sample. Mesh units are not assumed; check the X, Y, and Z dimensions before cutting.</p></li><li><strong>Choose a construction</strong><p>Interlocking: X ribs lie in YZ planes and slot down from the top. Y ribs lie in XZ planes and slot up from the bottom. Stacked: layers follow the selected axis at your material thickness. Box + living hinges: constant profiles wrap in strips; organic forms use contour bands with joining plates. Band height and material thickness are separate measurements.</p></li><li><strong>Measure your material</strong><p>Use the actual sheet thickness. Positive fit tolerance makes slots looser; negative tolerance tightens them. Lead-in adds a chamfer at slot mouths.</p></li><li><strong>Inspect the assembly</strong><p>Orbit the model, turn on the ghost mesh, or separate the slices with exploded view. Click a part to find it on its sheet. Open Sequence for playback and video recording. The Parts drawer lists each part and its mating IDs. The sequence player reveals parts in order; check slot accessibility on complex forms.</p></li><li><strong>Export and cut</strong><p>Download one sheet or the entire ZIP. Etch blue labels first, then cut green pin holes and red outlines. Kerf is already applied. Start with a small fit test.</p></li></ol><p className="field-note">Polygon nesting fits actual contours into concave gaps with conservative clearance. Choose bounding boxes for a comparison or 15° rotations for more trials. Registration pins are placed only where they pass through every stacked layer. Round dowels use circular holes; cut-material pins add flat P-parts and matching rectangular slots. DXF remains available for generated geometry when fabrication checks report errors.</p></DialogContent></Dialog>
  </div>;
}
