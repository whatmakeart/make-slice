import assert from "node:assert/strict";
import { sliceMesh } from "../lib/slicer/engine";
import { makePreset } from "../lib/slicer/presets";
import { auditCuts } from "../lib/slicer/cut-audit";
import { bounds, circle, materialArea, perimeter } from "../lib/slicer/polygons";
import { DEFAULT_SETTINGS, type LaserCutPiece, type Path2DLoop, type Point2D, type Stroke } from "../lib/slicer/types";

const settings={...structuredClone(DEFAULT_SETTINGS),targetWidth:100,materialThickness:4,xSliceCount:4,ySliceCount:4};
const scene=sliceMesh(makePreset("cube"),settings);
const outline=(coordinates:number[][]):Path2DLoop=>({isHole:false,points:coordinates.map(([x,y])=>({x,y}))});
const rectangle=outline([[0,0],[60,0],[60,40],[0,40]]);
function check(paths:Path2DLoop[],options:{rotation?:number;beam?:{x:number;y:number};strokes?:Stroke[];web?:number}={}){
  const part:LaserCutPiece={...scene.pieces[0],id:"WEB-TEST",parentId:"WEB-TEST",label:"WEB-TEST",axis:"Z",assemblyPaths:paths,cutPaths:paths,unmodifiedPaths:paths,etchPaths:[],cutStrokes:options.strokes,bounds:bounds(paths),area:materialArea(paths),cutLength:perimeter(paths),beam:options.beam,kerf:0};
  return auditCuts({...scene,settings:{...settings,sheetMargin:0,materialPresets:[{id:"T1",name:"Audit test",colorHex:"#d4a373",thickness:4,laserKerf:0,minimumWeb:options.web??.25}]},pieces:[part],sheets:[{sheetIndex:0,thicknessId:"T1",width:100,height:100,placements:[{pieceId:part.id,x:10,y:10,rotation:options.rotation??0}],utilization:.1,cutLength:part.cutLength}]});
}

// A deep slot meets a densely sampled convex shoulder. Nearby vertices are
// adjacent material boundaries, not opposite sides of a narrow bridge.
const shoulder=(a:number,b:number):Point2D[]=>Array.from({length:401},(_,i)=>{const t=a+(b-a)*i/400;return {x:20+20*Math.cos(t),y:20+20*Math.sin(t)};});
const curvedSlot:Path2DLoop={isHole:false,points:[{x:0,y:0},{x:40,y:0},...shoulder(0,Math.acos(.2)),{x:24,y:10},{x:20,y:10},...shoulder(Math.PI/2,Math.PI)]};
for(const rotation of [0,90,180,270])assert.equal(check([curvedSlot],{rotation}).issues.filter(i=>i.kind==="web").length,0,`False curved-shoulder warning at ${rotation}°`);

// Opposing notches leave a real 0.12 mm ligament, far from their connected ends.
const neck=outline([[0,0],[25,0],[25,19.94],[35,19.94],[35,0],[60,0],[60,40],[35,40],[35,20.06],[25,20.06],[25,40],[0,40]]);
for(const rotation of [0,90,180,270]){
  const web=check([neck],{rotation}).issues.find(i=>i.kind==="web");
  assert.ok(web);assert.ok(Math.abs(web.minimumSeparationMm!-.12)<1e-6);
}
assert.ok(check([neck],{beam:{x:.4,y:.1},rotation:90}).issues.some(i=>i.kind==="web"&&Math.abs(i.minimumSeparationMm!-.12)<.001));
const hole={...circle({x:2.12,y:20},2),isHole:true};
assert.ok(check([rectangle,hole]).issues.some(i=>i.kind==="web"&&i.pathIds!.length===2&&Math.abs(i.minimumSeparationMm!-.12)<.001));
const slits:Stroke[]=[10,10.3].map(x=>({points:[{x,y:10},{x,y:30}],closed:false}));
assert.ok(check([rectangle],{strokes:slits,beam:{x:.2,y:.2}}).issues.some(i=>i.kind==="web"&&Math.abs(i.minimumSeparationMm!-.1)<.001));
assert.equal(check([neck],{web:0}).issues.filter(i=>i.kind==="web").length,0);
const crossing=outline([[0,0],[20,20],[0,20],[20,0]]);
assert.ok(check([crossing]).issues.some(i=>i.kind==="intersection"&&i.severity==="error"));
const duplicate=outline([[0,0],[20,0],[0,0],[20,0],[20,20],[0,20]]);
assert.ok(check([duplicate]).issues.some(i=>i.kind==="duplicate"&&i.severity==="error"));

// Actual reported source: X-02's shoulder used to warn even with no kerf.
const jimmy=makePreset("jimmy"),counts:{kerf:number;webWarnings:number}[]=[];
for(const kerf of [0,.15]){
  const result=sliceMesh(jimmy,{...structuredClone(DEFAULT_SETTINGS),materialThickness:4,laserKerf:kerf});
  assert.ok(result.pieces.some(p=>p.id==="X-02"));
  assert.equal(result.audit!.issues.filter(i=>i.kind==="web"&&i.partIds?.includes("X-02")).length,0);
  counts.push({kerf,webWarnings:result.audit!.issues.filter(i=>i.kind==="web").length});
}
console.log("PASS: tessellated slot shoulders and Jimmy X-02; real opposing-notch webs, hole/edge ligaments and open-hinge bridges; directional rotation; zero-threshold behavior; blocking intersections and duplicates.");
console.log(JSON.stringify({jimmy:counts}));
