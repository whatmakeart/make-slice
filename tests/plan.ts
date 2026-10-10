import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { DEFAULT_SETTINGS, type LaserCutPiece, type Path2DLoop, type SliceResult, type SliceSettings, type WorkerResponse } from "../lib/slicer/types";
import { validateSettings } from "../lib/slicer/validation";
import { materials } from "../lib/slicer/materials";
import { makePreset } from "../lib/slicer/presets";
import { sliceMesh } from "../lib/slicer/engine";
import { bounds, materialArea, offsetPaths, perimeter } from "../lib/slicer/polygons";
import { allowedAngles, candidateBounds, compensate, rotateLoops } from "../lib/slicer/beam";
import { auditCuts, segmentSeparation } from "../lib/slicer/cut-audit";
import { sheetToolpaths } from "../lib/slicer/operations";
import { exportRecoveryBundle, exportRecoveryDXF, exportBundle, exportDXF, exportSVG, masterLayout } from "../lib/slicer/export";
import { createKerfGauge, GAUGE_VERSION, kerfFromGap, lightBurnGaugeReading, exportCalibrationKit, syntheticGaugeGap, representativeJoint } from "../lib/slicer/calibration-kit";
import { fingerJointSpan } from "../lib/slicer/finger-box";
import { createSlicerSession, layoutObjective, betterLayout } from "../lib/slicer/session";
import { createJobQueue } from "../lib/slicer/job-queue";
import { exportProject, importProject } from "../lib/slicer/project";
import { validateProfile } from "../lib/calibration-profiles";

const near=(a:number,b:number,e=.0002)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`),fresh=()=>structuredClone(DEFAULT_SETTINGS);
const base={...fresh(),targetWidth:100,materialThickness:4,xSliceCount:4,ySliceCount:4},stock=materials(base)[0];
for(const bad of [NaN,Infinity,-1,401,null])assert.throws(()=>validateSettings({...base,skipTopLayersCount:bad as number}));
for(const k of ["keepAspectRatio","alignmentPins","allowRotation"])assert.throws(()=>validateSettings({...base,[k]:"false"} as SliceSettings));
for(const k of ["hingeKFactor","hingePitch","hingeSlitLength","kerfX","minimumWeb"])assert.throws(()=>validateSettings({...base,materialPresets:[{...stock,[k]:NaN}]}));
for(const k of ["bandHeight","bandDeviation"])assert.throws(()=>validateSettings({...base,fingerBox:{...base.fingerBox!,[k]:NaN}}));
for(const k of ["targetWidth","targetDepth","targetHeight","sheetWidth","sheetHeight","laserKerf","slotFitTolerance"])assert.throws(()=>validateSettings({...base,[k]:Infinity} as SliceSettings));
assert.throws(()=>validateSettings({...base,targetWidth:10001}));validateSettings({...base,targetWidth:10000});
assert.throws(()=>validateSettings({...base,sheetWidth:19}));validateSettings({...base,sheetWidth:20,sheetHeight:20,sheetMargin:0});
assert.throws(()=>validateSettings({...base,partThickness:{"X-01":"T9"}}));
assert.throws(()=>validateSettings({...base,materialPresets:[{...stock,kerfX:.2}]}));
assert.throws(()=>validateSettings({...base,scrapSheets:[{id:"a",width:20,height:30,thicknessId:"T9",quantity:1}]}));
assert.throws(()=>validateSettings({...base,fingerBox:{...base.fingerBox!,bracing:{...base.fingerBox!.bracing,enabled:"yes" as unknown as boolean}}}));

// Manufacturing boundary accounting, derived independently from the raw bar/frame geometry.
for(const kerf of [.05,.115,.333,1.2]){
  const bars=Array.from({length:19},(_,i)=>({isHole:false,points:[{x:i*80/19,y:0},{x:(i+1)*80/19,y:0},{x:(i+1)*80/19,y:30},{x:i*80/19,y:30}]}));
  const packed=bars.reduce((width,b)=>width+bounds(offsetPaths([b],-kerf/2)).width,0),cavity=80+kerf,gap=cavity-packed;
  near(kerfFromGap(gap).fullKerfMm,kerf,.00006);near(syntheticGaugeGap(kerf),(19+1)*kerf,1e-10);
}
const lb=lightBurnGaugeReading(2,3);near(lb.fullKerfMm,.115,1e-12);near(lb.oneSidedOffsetMm,.0575,1e-12);assert.equal(kerfFromGap(2.3).effectiveCuts,20);assert.throws(()=>kerfFromGap(0));assert.throws(()=>lightBurnGaugeReading(2.2,3));
for(const angle of [0,90,45]){const gauge=createKerfGauge(angle);assert.equal(gauge.compensated,false);assert.equal(gauge.paths.filter(p=>p.operation==="cut_slit").length,18);assert.equal(gauge.paths.filter(p=>p.closed).length,2);assert.equal(gauge.paths.filter(p=>p.operation==="reference").length,0);}
const compact={...base,sheetWidth:120,sheetHeight:120,sheetMargin:2,partSpacing:3},raw=exportCalibrationKit("measure",stock,compact,{diagonal:true});assert.equal(raw.sheets.length,3);
const rawFiles=unzipSync(raw.data),metadata=JSON.parse(strFromU8(rawFiles["calibration-metadata.json"]));assert.equal(metadata.gaugeVersion,GAUGE_VERSION);assert.equal(metadata.compensationApplied,false);assert.equal(metadata.fullKerfMm,0);assert.equal(metadata.effectiveCuts,20);
assert.ok(rawFiles["Instructions.pdf"]);assert.ok(Object.keys(rawFiles).filter(f=>f.endsWith(".dxf")).length===3);
assert.equal(metadata.artboardBorderMm,20);
assert.deepEqual(raw.sheets.slice(0,2).map(s=>[s.width,s.height]),[[140,90],[90,140]]);
const tinyBed=exportCalibrationKit("measure",stock,{...base,sheetWidth:20,sheetHeight:20,sheetMargin:10,partSpacing:100},{diagonal:true});
assert.deepEqual(tinyBed.sheets,raw.sheets); // Bed/margin/spacing never scale the test.
const checkCalibrationArtboards=(kit:ReturnType<typeof exportCalibrationKit>)=>{
  const files=unzipSync(kit.data);
  for(const [i,sheet] of kit.sheets.entries()){
    const b=bounds([{isHole:false,points:sheet.paths.flatMap(p=>p.points)}]);
    for(const border of [b.minX,b.minY,sheet.width-b.maxX,sheet.height-b.maxY])near(border,20,1e-8);
    const name=Object.keys(files).find(name=>name.endsWith(`Sheet_${String(i+1).padStart(2,"0")}.svg`))!,svg=strFromU8(files[name]);
    const size=svg.match(/<svg[^>]+width="([\d.]+)mm" height="([\d.]+)mm"/)!;
    near(Number(size[1]),sheet.width);near(Number(size[2]),sheet.height);
    assert.ok(!Object.keys(files).some(name=>name.endsWith(".lbrn2")));
  }
};
checkCalibrationArtboards(raw);
for(const mode of ["interlocking","stacked","finger_box"] as const){const s={...base,mode},kit=exportCalibrationKit("fit",stock,s,{step:.02});const meta=JSON.parse(strFromU8(unzipSync(kit.data)["calibration-metadata.json"]));assert.equal(meta.compensationApplied,true);assert.equal(meta.compensationOwner,"MakeSlice");assert.ok(kit.coupons.some(c=>c.id===`CHECK-${mode}`));assert.equal(kit.slots.length,11);near(kit.slots[6]-kit.slots[5],.02);checkCalibrationArtboards(kit);}
for(const clearance of [-.25,.25]){
  const joint=fingerJointSpan(8,18,clearance),s={...base,mode:"finger_box" as const,fingerBox:{...base.fingerBox!,fingerWidth:10,jointTolerance:clearance,cornerStyle:"sharp" as const}},sample=representativeJoint(stock,s),hole=sample.nominal!.find(p=>p.isHole)!;
  near(bounds([hole]).width,joint.slotEnd-joint.slotStart);near(bounds([hole]).height,stock.thickness+clearance);
  const tab=sample.nominal!.find(p=>!p.isHole&&bounds([p]).maxY>30-stock.thickness)!;
  const top=tab.points.filter(p=>p.y>25+stock.thickness-.001);near(Math.max(...top.map(p=>p.x))-Math.min(...top.map(p=>p.x)),joint.maleEnd-joint.maleStart);
}

const rectangle=(w:number,h:number):Path2DLoop=>({isHole:false,points:[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}]});
const paths=[rectangle(100,20)],p:LaserCutPiece={id:"P",parentId:"P",label:"P",axis:"Z",sliceIndex:0,worldPosition:0,assemblyPaths:paths,cutPaths:paths,unmodifiedPaths:paths,etchPaths:[],bounds:bounds(paths),area:2000,cutLength:240,joints:[],assignedThicknessId:"T1",beam:{x:.4,y:.1}};
near(candidateBounds(p,0).width,100.4);near(candidateBounds(p,90).width,20.4);near(candidateBounds(p,90).height,100.1);
assert.ok(Math.abs(bounds(rotateLoops(compensate(paths,.4,.1),90)).width-candidateBounds(p,90).width)>.2,"Compensation must follow rotation in fixed machine axes");
assert.deepEqual(allowedAngles({...p,rotationConstraint:"half_turn"},base),[0,180]);assert.deepEqual(allowedAngles({...p,rotationConstraint:"fixed",stockOrientation:"machine_y"},base),[90]);assert.equal(allowedAngles(p,{...base,rotationStep:15}).length,24);
const scene=sliceMesh(makePreset("cube"),base),directional={...scene,pieces:[p],sheets:[{sheetIndex:0,placements:[{pieceId:"P",x:10,y:10,rotation:90}],width:200,height:200,utilization:.1,cutLength:240}]};
const machine=bounds(sheetToolpaths(directional,directional.sheets[0],false).map(t=>({points:t.points,isHole:false})));near(machine.width,20.4);near(machine.height,100.1);near(machine.minX,10);
const small=(id:string)=>{const paths=[rectangle(10,10)];return {...p,id,parentId:id,label:id,assemblyPaths:paths,cutPaths:paths,unmodifiedPaths:paths,bounds:bounds(paths),beam:undefined,kerf:.2,area:100,cutLength:40};};
const auditAt=(x:number)=>auditCuts({...scene,pieces:[small("A"),small("B")],settings:{...base,sheetMargin:0,partSpacing:2},sheets:[{sheetIndex:0,placements:[{pieceId:"A",x:20,y:20,rotation:0},{pieceId:"B",x,y:20,rotation:0}],width:100,height:100,utilization:.1,cutLength:80}]});
assert.ok(auditAt(28).issues.some(i=>i.kind==="intersection"&&i.severity==="error"));assert.ok(auditAt(20).issues.some(i=>i.kind==="duplicate"));
const close=auditAt(31);assert.ok(close.issues.some(i=>i.kind==="clearance"&&i.severity==="warning"));near(close.minimumSeparationMm!,.8);assert.ok(close.issues.every(i=>i.pathIds?.length&&i.partIds?.length&&i.sheetIndex===0));
const repeated=small("A"),broken=[{...rectangle(10,10),points:[{x:0,y:0},{x:10,y:0},{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},{x:0,y:10}]}];
const repeatAudit=auditCuts({...scene,pieces:[{...repeated,assemblyPaths:broken,cutPaths:broken}],sheets:[{sheetIndex:0,placements:[{pieceId:"A",x:20,y:20,rotation:0}],width:100,height:100,utilization:.01,cutLength:70}]});assert.ok(repeatAudit.issues.some(i=>i.kind==="duplicate"));assert.ok(repeatAudit.issues.some(i=>i.code==="cut-zero-length"));
near(segmentSeparation({x:0,y:0},{x:10,y:0},{x:5,y:3},{x:5,y:6}).distance,3);

const zero=sliceMesh(makePreset("cube"),{...base,sheetWidth:30,sheetHeight:30,sheetMargin:2});assert.equal(zero.sheets.length,0);assert.equal(zero.unplaced.length,zero.pieces.length);
const recovery=unzipSync(exportRecoveryBundle({...zero,revision:71}));const report=JSON.parse(strFromU8(recovery["geometry-report.json"]));assert.equal(report.generatedParts.length,8);assert.equal(report.revision,71);assert.ok(strFromU8(recovery["GENERATED_PARTS_RECOVERY.dxf"]).includes("LWPOLYLINE"));
const partial=unzipSync(exportRecoveryBundle({...scene,unplaced:[scene.pieces[0].id]}));assert.equal(JSON.parse(strFromU8(partial["geometry-report.json"])).includedParts.length,scene.pieces.length);
assert.equal(masterLayout(scene).paths.filter(p=>p.operation==="reference").length,0);assert.equal(masterLayout(scene,true,true).paths.filter(p=>p.operation==="reference").length,scene.sheets.length);
const bundle=unzipSync(exportBundle(scene));assert.ok(Object.keys(bundle).some(k=>k.startsWith("reference-layout/")&&k.endsWith(".dxf")));const projectMeta=JSON.parse(strFromU8(bundle["project-metadata.json"]));assert.equal(projectMeta.compensationApplied,true);assert.equal(projectMeta.stocks[0].fullKerfMm,.15);

const session=createSlicerSession(),result=(r:WorkerResponse)=>{assert.ok("result" in r,JSON.stringify(r));return r.result;};
result(session({id:1,type:"preset",preset:"cube",settings:base}));
const appearance=result(session({id:2,type:"settings",settings:{...base,materialPresets:[{...stock,colorHex:"#123456",name:"New name"}]}}));assert.deepEqual(appearance.cache,{geometry:true,offsets:true,nesting:true,labels:true});
const bed=result(session({id:3,type:"settings",settings:{...base,sheetWidth:1000}}));assert.equal(bed.cache?.geometry,true);assert.equal(bed.cache?.offsets,true);assert.equal(bed.cache?.nesting,false);
const offset=result(session({id:4,type:"settings",settings:{...base,laserKerf:.2}}));assert.equal(offset.cache?.geometry,true);assert.equal(offset.cache?.offsets,false);assert.equal(offset.pieces[0].assemblyPaths,bed.pieces[0].assemblyPaths);
const fit=result(session({id:5,type:"settings",settings:{...base,slotFitTolerance:.2}}));assert.equal(fit.cache?.geometry,false);
const optimized=result(session({id:6,type:"optimize",settings:{...base,slotFitTolerance:.2}}));assert.ok(optimized.optimization);assert.ok(!betterLayout(optimized.optimization.before,layoutObjective(optimized)));assert.equal(optimized.revision,6);
const after=result(session({id:7,type:"settings",settings:optimized.settings}));assert.equal(after.optimization,undefined);
const grain=result(session({id:70,type:"settings",settings:{...after.settings,materialPresets:[{...stock,rotationConstraint:"fixed",stockOrientation:"machine_y"}]}}));
assert.equal(grain.cache?.geometry,true);assert.equal(grain.cache?.offsets,true);assert.equal(grain.cache?.nesting,false);assert.ok(grain.sheets.flatMap(s=>s.placements).every(p=>p.rotation===90));assert.ok(grain.pieces.every(p=>p.rotationConstraint==="fixed"&&p.stockOrientation==="machine_y"));
const failed=session({id:8,type:"load",name:"bad.stl",buffer:strToU8("solid invalid").buffer,settings:base});assert.ok("error" in failed);assert.equal(result(session({id:9,type:"settings",settings:base})).model.name,"Calibration cube");

// Queued work coalesces; canceled jobs do not replace the source or commit state.
const emitted:WorkerResponse[]=[],queue=createJobQueue(r=>emitted.push(r));queue.post({id:100,type:"preset",preset:"cube",settings:{...base,mode:"stacked",targetWidth:900,materialThickness:3}});queue.post({id:101,type:"settings",settings:base});
await new Promise<void>((resolve,reject)=>{const deadline=Date.now()+10000;const poll=()=>{if(emitted.some(r=>r.id===101&&("result" in r||"error" in r)))resolve();else if(Date.now()>deadline)reject(new Error("Coalesced job did not complete"));else setTimeout(poll,10);};poll();});
assert.ok(emitted.some(r=>r.id===100&&"cancelled" in r));const newest=emitted.find(r=>r.id===101&&"result" in r)!;assert.equal(result(newest).pieces.length,8);queue.close();
const sourceEvents:WorkerResponse[]=[],sourceQueue=createJobQueue(r=>sourceEvents.push(r));
sourceQueue.post({id:201,type:"preset",preset:"cube",settings:{...base,mode:"stacked",targetWidth:900,materialThickness:3}});
sourceQueue.post({id:202,type:"preset",preset:"letter_t",settings:base});sourceQueue.post({id:203,type:"settings",settings:{...base,targetWidth:80}});
await new Promise<void>((resolve,reject)=>{const deadline=Date.now()+10000;const poll=()=>{if(sourceEvents.some(r=>r.id===203&&("result" in r||"error" in r)))resolve();else if(Date.now()>deadline)reject(new Error("Queued source did not complete"));else setTimeout(poll,10);};poll();});
const queuedSource=result(sourceEvents.find(r=>r.id===203&&"result" in r)!);assert.equal(queuedSource.model.name,makePreset("letter_t").info.name);assert.equal(queuedSource.settings.targetWidth,80);sourceQueue.close();

const calibrated={...stock,calibration:{id:"cal-test",gaugeVersion:GAUGE_VERSION,date:"2026-10-10T00:00:00Z",fullKerfMm:.15,measuredThicknessMm:4,machineName:"Recorded machine",power:"actual test",speed:"actual test"}};
const project={settings:{...base,materialPresets:[calibrated],scrapSheets:[{id:"scrap",width:120,height:120,thicknessId:"T1",quantity:2}],partThickness:{"X-01":"T2"}},source:{kind:"preset" as const,preset:"cube" as const},naming:{projectName:"My model",prefix:"Rev A",pageSize:"a4" as const},displayUnit:"in" as const};
const saved=exportProject(project),opened=importProject(saved.data);assert.deepEqual(opened,project);
const obj=strToU8("# original bytes\nv 0 0 0\nf 1 1 1\n"),meshProject={...project,source:{kind:"mesh" as const,name:"original.obj",bytes:obj}};assert.deepEqual(importProject(exportProject(meshProject).data),meshProject);
const invalidFiles=unzipSync(saved.data),json=JSON.parse(strFromU8(invalidFiles["project.json"]));json.settings.skipTopLayersCount=null;assert.throws(()=>importProject(zipSync({...invalidFiles,"project.json":strToU8(JSON.stringify(json))})),/finite number/);
assert.throws(()=>importProject(zipSync({"project.json":invalidFiles["project.json"],"../evil":strToU8("x")})),/unexpected/);validateProfile({id:"p",name:"Recorded stock",stock:calibrated});

const out=".sites-runtime/validation/sprint-32";mkdirSync(out,{recursive:true});writeFileSync(`${out}/raw-calibration.zip`,raw.data);for(const [name,data] of Object.entries(rawFiles))if(name.endsWith("pdf")||name.endsWith("svg")||name.endsWith("dxf"))writeFileSync(`${out}/${name}`,data);
const kit=exportCalibrationKit("fit",stock,base,{step:.02}),fitFiles=unzipSync(kit.data);writeFileSync(`${out}/fit-instructions.pdf`,fitFiles["Instructions.pdf"]);writeFileSync(`${out}/fit-instructions.svg`,fitFiles["Instructions.svg"]);writeFileSync(`${out}/recovery-zero.dxf`,exportRecoveryDXF({...zero,revision:71}));writeFileSync(`${out}/project.makeslice`,saved.data);
writeFileSync(`${out}/production.zip`,exportBundle({...scene,revision:72}));
for(const [name,data] of Object.entries(unzipSync(exportBundle(scene))))if(name.endsWith(".dxf")||name.endsWith(".svg")&&!name.includes("Assembly")&&!name.startsWith("assembly-guide/"))writeFileSync(`${out}/production-${name.replaceAll("/","_")}`,data);
for(const [name,data] of Object.entries(fitFiles))if(name.endsWith(".dxf")||name.endsWith(".svg")&&name!=="Instructions.svg")writeFileSync(`${out}/fit-${name}`,data);
writeFileSync(`${out}/production-r12.dxf`,exportDXF(scene,scene.sheets[0],true,true));writeFileSync(`${out}/production-lines.dxf`,exportDXF(scene,scene.sheets[0],true,false,true));
writeFileSync(`${out}/directional-production.dxf`,exportDXF(directional,directional.sheets[0],false));writeFileSync(`${out}/directional-production.svg`,exportSVG(directional,directional.sheets[0],false));
console.log("PASS: shared optional/boolean/reference validation; measured-gauge cut factor and matching decimal reader; raw/fit kits with 20 mm artboard borders independent of bed size, representative joints and PDF; machine-axis compensation and rotation constraints; post-placement intersections/duplicates/gaps; zero-sheet recovery/report; separate production/reference operations; staged cache reuse, optimization and cancellation; source/settings/calibration/naming project round-trips.");
