import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { unzipSync, strFromU8 } from "fflate";
import { createCalibrationStrip, exportCalibrationBundle, exportCalibrationSVG } from "../lib/slicer/calibration";
import { bounds, booleanPaths, inMaterial, materialArea } from "../lib/slicer/polygons";
import { DEFAULT_SETTINGS } from "../lib/slicer/types";
import { materials } from "../lib/slicer/materials";

const stock=materials(DEFAULT_SETTINGS)[0];
for(const kerf of [0,.15,.33,1.2]){
  const strip=createCalibrationStrip({...stock,laserKerf:kerf},4);
  assert.deepEqual(strip.slots.map(s=>s.width),Array.from({length:11},(_,i)=>(35+i)/10));
  assert.equal(strip.cutPaths.length,1);assert.equal(strip.cutPaths[0].isHole,false);
  const normalized=booleanPaths(strip.nominal,[],"union");assert.equal(normalized.length,1);
  assert.ok(Math.abs(materialArea(normalized)-materialArea(strip.nominal))<1e-5);
  assert.ok(strip.barWidth<150 && strip.barHeight===40);
  const loop=strip.cutPaths[0].points,b=bounds(strip.cutPaths);
  assert.ok(b.minX>=0 && b.minY>=0 && b.maxX<strip.width && b.maxY<strip.height);
  for(const slot of strip.slots){
    assert.equal(inMaterial(slot.center,strip.cutPaths),false);
    const xEdges=loop.flatMap((a,i)=>{
      const z=loop[(i+1)%loop.length];
      return Math.abs(a.x-z.x)<1e-7 && slot.center.y>Math.min(a.y,z.y) && slot.center.y<Math.max(a.y,z.y) && Math.abs(a.x-slot.center.x)<slot.width ? [a.x] : [];
    }).sort((a,b)=>a-b);
    assert.equal(xEdges.length,2);
    assert.ok(Math.abs(xEdges[1]-xEdges[0]+kerf-slot.width)<.0002,`Finished ${slot.width} mm opening with ${kerf} mm kerf`);
    assert.ok(strip.paths.some(p=>p.pieceId===`SLOT-${String(Number(slot.width.toFixed(3)))}mm`));
  }
  for(const path of strip.paths.filter(p=>p.layer==="ETCH_LABELS"))
    for(const point of path.points)assert.equal(inMaterial(point,strip.nominal),true,"Vector labels stay inside solid stock");
}
const thick=createCalibrationStrip({...stock,id:"T2",thickness:6,laserKerf:.2},6);
assert.deepEqual(thick.slots.map(s=>s.width),Array.from({length:11},(_,i)=>(55+i)/10));
assert.equal(thick.stockId,"T2");assert.equal(thick.stockThickness,6);
const rounded=createCalibrationStrip(stock,4.25);assert.deepEqual(rounded.slots.map(s=>s.width),Array.from({length:11},(_,i)=>Number((3.75+i*.1).toFixed(6))));
for(const center of [NaN,.5,106])assert.throws(()=>createCalibrationStrip(stock,center),/Calibration center/);
for(const laserKerf of [NaN,-1,3.5])assert.throws(()=>createCalibrationStrip({...stock,laserKerf},4),/Kerf must be smaller/);

const bundle=exportCalibrationBundle(stock,4),files=unzipSync(bundle.data);
assert.equal(Object.keys(files).length,4);assert.match(bundle.filename,/T1_3\.5-4\.5mm_kerf0\.15\.zip$/);
const svg=strFromU8(files[Object.keys(files).find(f=>f.endsWith(".svg"))!]);
const dom=new JSDOM(svg,{contentType:"image/svg+xml"});
const root=dom.window.document.documentElement;
assert.equal(root.getAttribute("width"),"150.5mm");assert.equal(root.getAttribute("height"),"46mm");
assert.equal(root.querySelectorAll("#CUT_OUTLINE path").length,1);
assert.match(root.querySelector("#CUT_OUTLINE path")!.getAttribute("d")!,/ Z$/);
assert.equal(root.querySelector("#CUT_OUTLINE")!.getAttribute("stroke-width"),"0.0003528");
assert.equal(root.querySelector("#ETCH_LABELS")!.getAttribute("stroke"),"#0000FF");
assert.equal(root.querySelector("#ETCH_LABELS")!.getAttribute("stroke-width"),"0.1763889");
assert.equal(root.querySelectorAll("text").length,0); // Vector glyphs, no installed font required.
for(let i=35;i<=45;i++)assert.ok(root.querySelector(`[data-piece-id="SLOT-${String(i/10)}mm"] path`));
dom.window.close();
const dxf=strFromU8(files[Object.keys(files).find(f=>f.endsWith(".dxf"))!]);
assert.match(dxf,/\$INSUNITS\r\n\s*70\r\n4/);
const rows=dxf.split(/\r?\n/),entities:Array<Map<number,string>>=[];
let entity:Map<number,string>|null=null;
for(let i=0;i<rows.length-1;i+=2){
  const code=Number(rows[i].trim()),value=rows[i+1].trim();
  if(code===0){if(entity)entities.push(entity);entity=value==="LWPOLYLINE"?new Map([[0,value]]):null;}
  else if(entity&&!entity.has(code))entity.set(code,value);
}
if(entity)entities.push(entity);
const cuts=entities.filter(e=>e.get(8)==="CUT_OUTLINE");assert.equal(cuts.length,1);
assert.equal(cuts[0].get(70),"1");assert.equal(cuts[0].get(62),"1");assert.equal(cuts[0].get(370),"0");
assert.ok(entities.some(e=>e.get(8)==="ETCH_LABELS"&&e.get(62)==="5"));
const metadata=JSON.parse(strFromU8(files["calibration-settings.json"]));assert.equal(metadata.kerfCompensated,true);assert.equal(metadata.finishedSlotsMm.length,11);
assert.match(strFromU8(files["README.txt"]),/chosen labeled slot width minus actual mating stock thickness/);
assert.match(strFromU8(files["README.txt"]),/does not independently measure beam kerf/);
mkdirSync(".sites-runtime/validation/sprint-25",{recursive:true});
writeFileSync(".sites-runtime/validation/sprint-25/calibration.svg",exportCalibrationSVG(bundle.strip));
writeFileSync(".sites-runtime/validation/sprint-25/calibration.zip",bundle.data);
writeFileSync(".sites-runtime/validation/sprint-25/calibration.dxf",dxf);
console.log("PASS: 11 finished 3.5–4.5 mm slots, selected-stock kerf applied once, alternate thickness ranges, closed joined DXF/SVG outline, vector labels inside stock, exact millimeter dimensions and usable one-click ZIP.");
