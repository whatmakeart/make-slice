import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import * as THREE from "three";
import {makePreset} from "../lib/slicer/presets";
import {sliceMesh,validateSettings} from "../lib/slicer/engine";
import {pieceGeometry} from "../lib/slicer/three-geometry";
import {section} from "../lib/slicer/section";
import {bounds,inLoop} from "../lib/slicer/polygons";
import {exportDXF,exportSVG,exportBundle,exportGuide} from "../lib/slicer/export";
import {DEFAULT_SETTINGS} from "../lib/slicer/types";
import {unzipSync,strFromU8} from "fflate";
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
const base={...DEFAULT_SETTINGS,targetWidth:100,materialThickness:4,mode:"stacked" as const,alignmentPinType:"material" as const,pinDiameter:6,pinCount:2};
mkdirSync(".sites-runtime/validation",{recursive:true});
for(const axis of ["X","Y","Z"] as const){
  const r=sliceMesh(makePreset("cube"),{...base,stackedAxis:axis});
  const pins=r.pieces.filter(p=>p.kind==="alignment-pin"),layers=r.pieces.filter(p=>!p.kind);
  assert.equal(pins.length,2);assert.equal(layers.length,25);assert.deepEqual(r.issues,[]);
  assert.deepEqual(r.pieces.slice(0,2).map(p=>p.id),["P-01","P-02"]);
  for(const layer of layers)for(const hole of layer.assemblyPaths.filter(p=>p.isHole)){
    const b=bounds([hole]);near(b.width,6.05);near(b.height,4.05);
  }
  for(const layer of layers)for(const hole of layer.cutPaths.filter(p=>p.isRegistration)){
    const b=bounds([hole]);near(b.width,5.90);near(b.height,3.90);
  }
  for(const pin of pins){
    const geometry=pieceGeometry(pin,4),normal=pin.axis==="X"?0:pin.axis==="Y"?1:2;
    geometry.computeBoundingBox();near(geometry.boundingBox!.getSize(new THREE.Vector3()).getComponent(normal),4);
    const pb=bounds(pin.assemblyPaths);near(Math.max(pb.width,pb.height),108);near(Math.min(pb.width,pb.height),14);
    const position=geometry.getAttribute("position"),vertices=new Float64Array(position.count*3);
    let volume=0;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    for(let i=0;i<position.count;i++)for(let j=0;j<3;j++)vertices[i*3+j]=position.getComponent(i,j)+(j===normal?pin.worldPosition:0);
    for(let i=0;i<position.count;i+=3){a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);volume+=a.dot(b.clone().cross(c))/6;}
    assert.ok(Math.abs(Math.abs(volume)-pin.area*4)<.1);
    for(const layer of [layers[0],layers[12],layers.at(-1)!]){
      const cross=section(vertices,axis,layer.worldPosition);
      assert.equal(cross.open,0);assert.equal(cross.loops.length,1);
      const cb=bounds(cross.loops);near(cb.width,6);near(cb.height,4);
      assert.ok(cross.loops[0].points.every(point=>layer.assemblyPaths.some(hole=>hole.isHole&&inLoop(point,hole.points))),`Pin ${pin.id} does not pass through ${axis} layer slot`);
    }
    geometry.dispose();assert.ok(pin.etchPaths.length>0);
    assert.ok(r.sheets.some(s=>s.placements.some(p=>p.pieceId===pin.id)));
  }
  const zip=unzipSync(exportBundle(r));assert.ok(strFromU8(zip["assembly.csv"]).includes("P-01"));
  assert.ok(exportGuide(r).includes("cut-material"));
  writeFileSync(`.sites-runtime/validation/material-pins-${axis}.dxf`,exportDXF(r,r.sheets[0]));
  writeFileSync(`.sites-runtime/validation/material-pins-${axis}.svg`,exportSVG(r,r.sheets[0]));
}
const off=sliceMesh(makePreset("cube"),{...base,alignmentPins:false});assert.equal(off.pieces.length,25);assert.equal(off.pins.length,0);
assert.throws(()=>validateSettings({...base,slotFitTolerance:-2,materialThickness:1}));
console.log("PASS: cut-material pins are nested, kerf compensated, labeled, and pass through the matching slots on X/Y/Z stacks; stop heads and preview volumes have the correct dimensions.");
