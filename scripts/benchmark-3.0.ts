import { cpus, platform, arch } from "node:os";
import { writeFileSync } from "node:fs";
import { createAsyncSlicerSession, layoutObjective } from "../lib/slicer/session";
import { DEFAULT_SETTINGS, type SliceSettings, type WorkerRequest } from "../lib/slicer/types";
import { materials } from "../lib/slicer/materials";

// Engineering runner timings, not browser/device interaction acceptance.
const stages=new Map<number,Set<string>>(),session=createAsyncSlicerSession((id,p)=>{
  if(!stages.has(id))stages.set(id,new Set());stages.get(id)!.add(p.stage);
}),rows:object[]=[];
let settings:SliceSettings=structuredClone(DEFAULT_SETTINGS),id=0;
async function measure(name:string,request:Omit<WorkerRequest,"id">){
  const start=performance.now();let last=start,maxTimerDelayMs=0,ticks=0;
  const timer=setInterval(()=>{const now=performance.now();maxTimerDelayMs=Math.max(maxTimerDelayMs,now-last-10);last=now;ticks++;},10);
  const response=await session({...request,id:++id} as WorkerRequest,()=>false);clearInterval(timer);
  if(!("result" in response))throw new Error(JSON.stringify(response));const r=response.result;
  rows.push({case:name,totalMs:Number((performance.now()-start).toFixed(2)),engineMs:Number(r.processingMs.toFixed(2)),timerTicks:ticks,maxTimerDelayMs:Number(Math.max(0,maxTimerDelayMs).toFixed(2)),stages:[...stages.get(id)||[]],triangles:r.model.triangleCount,parts:r.pieces.length,...layoutObjective(r),cache:r.cache,optimization:r.optimization,issues:{errors:r.issues.filter(i=>i.severity==="error").length,warnings:r.issues.filter(i=>i.severity==="warning").length}});
  settings=r.settings;return r;
}
await measure("Jimmy cold / polygon 90°",{type:"preset",preset:"jimmy",settings} as Omit<WorkerRequest,"id">);
await measure("Stock name/color only",{type:"settings",settings:{...settings,materialPresets:materials(settings).map(m=>({...m,name:`${m.name} profile`,colorHex:"#73A4D4"}))}});
await measure("Bed width only",{type:"settings",settings:{...settings,sheetWidth:950}});
await measure("Full kerf only",{type:"settings",settings:{...settings,laserKerf:.2}});
await measure("Joint clearance",{type:"settings",settings:{...settings,slotFitTolerance:.1}});
await measure("Optimize 15°",{type:"optimize",settings});
const report={date:new Date().toISOString(),version:"3.0.0",environment:{runtime:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},scope:"Node container engineering measurements. Not real-browser p95, touch, WebGL, physical fabrication or CAM import acceptance.",rows};
writeFileSync("docs/benchmark-3.0.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
