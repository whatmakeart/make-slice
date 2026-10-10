import { parseSTL } from "./stl";
import { parseOBJ } from "./obj";
import { makePreset } from "./presets";
import { sliceMeshStages } from "./engine";
import { validateSettings } from "./validation";
import { bindStock, bindOrientation, candidateBounds } from "./beam";
import { checkResultStages } from "./cut-audit";
import { nestPiecesStages } from "./nesting";
import { materials } from "./materials";
import type { MeshData, WorkerRequest, WorkerResponse, SlicingProgress, SliceSettings, SliceResult, LayoutObjective } from "./types";

type FinalResponse=Exclude<WorkerResponse,{progress:SlicingProgress}>;
function geometryKey(s:SliceSettings){const {sheetWidth,sheetHeight,sheetMargin,partSpacing,allowRotation,nestingMode,rotationStep,scrapSheets,auditTolerance,materialPresets,laserKerf,...rest}=s;return JSON.stringify([rest,s.mode==="finger_box"?laserKerf:0,materials(s).map(m=>[m.id,m.thickness,...(s.mode==="finger_box"?[m.family,m.hingeKFactor,m.allowLivingHinges,m.hingePitch,m.hingeSlitLength]:[]),s.mode==="finger_box"?m.laserKerf:0])]);}
function offsetsKey(s:SliceSettings){return JSON.stringify(materials(s).map(m=>[m.id,m.laserKerf,m.kerfX,m.kerfY,m.beamModel]));}
function auditKey(s:SliceSettings){return JSON.stringify([s.auditTolerance,materials(s).map(m=>m.minimumWeb)]);}
function nestingKey(s:SliceSettings){return JSON.stringify([s.sheetWidth,s.sheetHeight,s.sheetMargin,s.partSpacing,s.allowRotation,s.nestingMode,s.rotationStep,s.scrapSheets,materials(s).map(m=>[m.id,m.rotationConstraint,m.stockOrientation])]);}
export function layoutObjective(r:SliceResult):LayoutObjective{return {unplaced:r.unplaced.length,sheets:r.sheets.length,footprintMm2:r.sheets.reduce((area,sheet)=>{let x=0,y=0;for(const pl of sheet.placements){const p=r.pieces.find(p=>p.id===pl.pieceId)!,b=candidateBounds(p,pl.rotation);x=Math.max(x,pl.x+b.width);y=Math.max(y,pl.y+b.height);}return area+x*y;},0)};}
export function betterLayout(a:LayoutObjective,b:LayoutObjective){return a.unplaced<b.unplaced||a.unplaced===b.unplaced&&(a.sheets<b.sheets||a.sheets===b.sheets&&a.footprintMm2<b.footprintMm2-.01);}
function createCore(onProgress?:(id:number,p:SlicingProgress)=>void){
  let mesh:MeshData|null=null,last:SliceResult|null=null;
  return function* run(request:WorkerRequest):Generator<void,FinalResponse,void>{
    let candidate:MeshData|null=null;
    try{
      const started=performance.now();validateSettings(request.settings);yield;
      onProgress?.(request.id,{stage:request.type==="load"?"loading":"geometry",completed:0,total:1,percent:0});
      candidate=request.type==="load"?(/\.obj$/i.test(request.name)?parseOBJ(new TextDecoder().decode(request.buffer),request.name):parseSTL(request.buffer,request.name)):request.type==="preset"?makePreset(request.preset):mesh;
      if(!candidate)throw new Error("Load an STL/OBJ or choose a sample model.");yield;
      const s=request.settings,progress=(p:SlicingProgress)=>onProgress?.(request.id,p),same=candidate===mesh&&!!last;
      let result:SliceResult;
      const geometry=same&&geometryKey(s)===geometryKey(last!.settings),offsets=geometry&&offsetsKey(s)===offsetsKey(last!.settings),nesting=offsets&&nestingKey(s)===nestingKey(last!.settings);
      if(geometry){
        const pieces=offsets?bindOrientation(last!.pieces,s):bindStock(last!.pieces,s);
        const placement=nesting?{sheets:last!.sheets,unplaced:last!.unplaced}:yield* nestPiecesStages(pieces,s,progress);
        const issues=last!.issues.filter(i=>!i.code.startsWith("cut-")&&i.code!=="oversize-parts"&&(!offsets?i.code!=="vanishing-holes":true));
        if(placement.unplaced.length)issues.push({code:"oversize-parts",severity:"error",message:"Some generated parts do not fit. Download CAD recovery or enlarge the sheet.",partIds:placement.unplaced});
        if(!offsets)for(const p of pieces)if(p.cutPaths.filter(l=>l.isHole).length<p.assemblyPaths.filter(l=>l.isHole).length)issues.push({code:"vanishing-holes",severity:"warning",message:"A hole is smaller than the kerf and disappeared. Reduce kerf or increase feature size.",partIds:[p.id]});
        result={...last!,settings:structuredClone(s),pieces,...placement,issues,processingMs:performance.now()-started};
        progress({stage:"checking",completed:0,total:1,percent:0});yield;result=nesting&&auditKey(s)===auditKey(last!.settings)?{...result,audit:last!.audit,issues:[...issues,...last!.audit!.issues]}:yield* checkResultStages(result);
      }else result=yield* sliceMeshStages(candidate,s,progress);
      if(!result.pieces.length&&result.issues.some(i=>i.severity==="error"))throw new Error(result.issues.find(i=>i.severity==="error")!.message);
      result={...result,optimization:undefined};
      if(request.type==="optimize"){
        const before=layoutObjective(result),optSettings={...s,nestingMode:"polygon" as const,rotationStep:15 as const};
        const placement=yield* nestPiecesStages(result.pieces,optSettings,progress);
        progress({stage:"checking",completed:0,total:1,percent:0});const trial=yield* checkResultStages({...result,settings:optSettings,...placement,issues:result.issues.filter(i=>!i.code.startsWith("cut-")&&i.code!=="oversize-parts")}),after=layoutObjective(trial);
        if(trial.unplaced.length)trial.issues.push({code:"oversize-parts",severity:"error",message:"Some parts remain unplaced after optimization. Enlarge the sheet or use CAD recovery.",partIds:trial.unplaced});
        const accepted=betterLayout(after,before)&&!trial.issues.some(i=>i.severity==="error"&&i.code!=="oversize-parts");
        result={...(accepted?trial:result),optimization:{accepted,before,after,elapsedMs:performance.now()-started}};
      }
      result={...result,revision:request.id,cache:{geometry,offsets,nesting,labels:geometry},processingMs:performance.now()-started};
      mesh=candidate;last=result;progress({stage:"checking",completed:1,total:1,percent:100});return {id:request.id,result};
    }catch(error){return {id:request.id,error:error instanceof Error?error.message:"Could not process this mesh.",sourceValid:!!candidate};}
  };
}
export function createSlicerSession(onProgress?:(id:number,p:SlicingProgress)=>void){const core=createCore(onProgress);return(request:WorkerRequest):FinalResponse=>{const stages=core(request);let next=stages.next();while(!next.done)next=stages.next();return next.value;};}
export function createAsyncSlicerSession(onProgress?:(id:number,p:SlicingProgress)=>void){const core=createCore(onProgress);return async(request:WorkerRequest,cancelled:()=>boolean):Promise<FinalResponse>=>{
  const stages=core(request);let next:IteratorResult<void,FinalResponse>;let slice=performance.now();
  do{if(cancelled()){stages.return({id:request.id,cancelled:true});return {id:request.id,cancelled:true};}next=stages.next();if(!next.done&&performance.now()-slice>12){await new Promise<void>(r=>setTimeout(r,0));slice=performance.now();}}while(!next.done);
  return cancelled()?{id:request.id,cancelled:true}:next.value;
};}
