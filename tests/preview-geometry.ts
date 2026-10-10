import assert from "node:assert/strict";
import * as THREE from "three";
import { makePreset } from "../lib/slicer/presets";
import {sliceMesh} from "../lib/slicer/engine";
import {pieceGeometry} from "../lib/slicer/three-geometry";
import {DEFAULT_SETTINGS} from "../lib/slicer/types";
const cube=makePreset("cube");
for(const mode of ["interlocking","stacked"] as const)for(const axis of ["X","Y","Z"] as const){
  const r=sliceMesh(cube,{...DEFAULT_SETTINGS,targetWidth:100,materialThickness:4,xSliceCount:4,ySliceCount:4,mode,stackedAxis:axis});
  for(const p of r.pieces){
    const g=pieceGeometry(p,4);g.computeBoundingBox();const dim=g.boundingBox!.getSize(new THREE.Vector3());const a=p.axis==="X"?0:p.axis==="Y"?1:2;
    assert.ok(Math.abs(dim.getComponent(a)-4)<.001);
    let volume=0;const pos=g.getAttribute("position");const v0=new THREE.Vector3(),v1=new THREE.Vector3(),v2=new THREE.Vector3();
    for(let i=0;i<pos.count;i+=3){v0.fromBufferAttribute(pos,i);v1.fromBufferAttribute(pos,i+1);v2.fromBufferAttribute(pos,i+2);volume+=v0.dot(v1.clone().cross(v2))/6;}
    assert.ok(Math.abs(Math.abs(volume)-p.area*4)<.1,`3D volume disagrees with cut material for ${p.id}: ${volume} vs ${p.area*4}`);
    g.dispose();
  }
}
console.log("PASS: extruded preview has the correct thickness, axis, slots, and pin-hole volume for both construction modes and all three stack axes.");
