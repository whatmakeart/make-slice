import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3, Quaternion } from "three";
import { unzipSync, strFromU8 } from "fflate";
import { sliceMesh, validateSettings } from "../lib/slicer/engine";
import { parseSTL, inspectMesh, meshBounds } from "../lib/slicer/stl";
import { section } from "../lib/slicer/section";
import { interiorPoint, signedArea, splitComponents } from "../lib/slicer/polygons";
import { pieceGeometry, assembledPosition } from "../lib/slicer/three-geometry";
import { exportAssemblyOBJ } from "../lib/slicer/obj-export";
import { parseOBJ } from "../lib/slicer/obj";
import { materials } from "../lib/slicer/materials";
import { developedDistances } from "../lib/slicer/finger-box";
import { exportBundle, sheetToolpaths } from "../lib/slicer/export";
import { exportAssemblyDiagram, explodedAssemblyLayout, assemblyDiagramLayout } from "../lib/slicer/assembly-diagram";
import { makePreset } from "../lib/slicer/presets";
import { DEFAULT_SETTINGS, type SliceResult, type SliceSettings } from "../lib/slicer/types";

const base:SliceSettings={...structuredClone(DEFAULT_SETTINGS),mode:"finger_box",targetWidth:220,materialThickness:3};
const near=(a:number,b:number,tol=.001)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const valid=(r:SliceResult)=>{assert.ok(r.pieces.length>0);assert.ok(!r.issues.some(i=>i.severity==="error"),JSON.stringify(r.issues));assert.equal(r.unplaced.length,0);for(const p of r.pieces){assert.ok(p.area>0);assert.equal(splitComponents(p.assemblyPaths).length,1,p.id);for(const l of p.cutPaths){assert.ok(l.points.length>=3);assert.ok(Math.abs(signedArea(l.points))>1e-8);assert.ok(l.points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y)));}}};
const asMeshes=(r:SliceResult)=>r.pieces.map(p=>{const m=new Mesh(pieceGeometry(p),new MeshBasicMaterial({side:DoubleSide}));m.position.copy(assembledPosition(p));m.updateMatrixWorld(true);return m;});
const dispose=(ms:Mesh[])=>ms.forEach(m=>{m.geometry.dispose();(m.material as MeshBasicMaterial).dispose();});
const results:SliceResult[]=[];
for(const [name,axis,holeCount] of [["box-hole-test","Y",1],["box-hole-test-double","Y",2],["donut-box-test","Z",1],["box-hole-test-double-with-curves","Y",2],["donut-box-test-with-bevels-test","Y",2]] as const){
  const bytes=readFileSync(`tests/fixtures/${name}.stl`),mesh=parseSTL(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),`${name}.stl`),r=sliceMesh(mesh,base);valid(r);results.push(r);
  const axisIndex=axis==="Y"?1:2,profile=section(new Float64Array(r.vertices),axis,r.dimensions[axisIndex]/2),holes=profile.loops.filter(l=>l.isHole);
  assert.equal(holes.length,holeCount,`${name}: test file tunnels`);
  assert.ok(r.pieces.some(p=>p.wallRole==="hole"),`${name}: inner tunnel surfaces are identified`);
  const meshes=asMeshes(r);
  for(const hole of holes){const p=interiorPoint([{...hole,isHole:false}]).point,origin=new Vector3(p.x,axis==="Y"?-10:p.y,axis==="Y"?p.y:-10),direction=new Vector3(0,axis==="Y"?1:0,axis==="Z"?1:0),ray=new Raycaster(origin,direction,0,r.dimensions[axisIndex]+20);
    assert.equal(ray.intersectObjects(meshes,false).length,0,`${name}: the assembled shell must not cap a tunnel center`);
  }
  dispose(meshes);
  for(const sheet of r.sheets)assert.ok(sheetToolpaths(r,sheet,false).every(path=>path.closed));
  const zip=unzipSync(exportBundle(r));assert.ok(zip["Assembly_Diagram.svg"]&&zip["Assembly.obj"]&&zip["MASTER_ALL_SHEETS.dxf"]);
  const diagram=strFromU8(zip["Assembly_Diagram.svg"]);assert.match(diagram,/id="exploded-assembly"/);assert.match(diagram,/id="parts-inventory"/);assert.equal((diagram.match(/r="19"/g)||[]).length,r.pieces.length);
  const objText=strFromU8(zip["Assembly.obj"]),obj=parseOBJ(objText);assert.equal(obj.info.boundaryEdges,0,`${name}: closed assembly OBJ solids`);
  // Separate solids can touch at fitted seams. Test manifoldness per OBJ object,
  // rather than welding independently manufactured panels into one Boolean union.
  let vertexOffset=0;
  for(const block of objText.split(/^o /m).slice(1)){
    const vertices=block.split("\n").filter(l=>l.startsWith("v ")),faces=block.split("\n").filter(l=>l.startsWith("f ")).map(l=>"f "+l.slice(2).split(" ").map(n=>Number(n)-vertexOffset).join(" "));
    const part=parseOBJ([...vertices,...faces].join("\n"));assert.equal(part.info.boundaryEdges,0,block.split("\n")[0]);assert.equal(part.info.nonManifoldEdges,0,block.split("\n")[0]);vertexOffset+=vertices.length;
  }
  const layout=assemblyDiagramLayout(r),spread=explodedAssemblyLayout(r);assert.equal(layout.placements.length,r.pieces.length);assert.equal(spread.placements.length,r.pieces.length);assert.ok(spread.placements.every(p=>p.badge.y+14<layout.assemblyBottom));
  if(r.pieces.length>60){assert.ok(spread.grouped);assert.ok(spread.placements.filter(p=>p.showCallout).length<=7,"Dense facets should use clear assembly groups with full inventory retained");}
  writeFileSync(`.sites-runtime/validation/${name}-shell.svg`,diagram);
  console.log(`PASS ${name}: ${r.pieces.length} panels; ${holeCount} clear tunnels; closed CAD and OBJ; complete ZIP.`);
}
assert.equal(results[0].pieces.filter(p=>p.category==="box_cap").length,2);assert.equal(results[1].pieces.filter(p=>p.wallRole==="hole").length,8);
for(const p of results[1].pieces.filter(p=>p.category==="box_cap"))assert.equal(p.unmodifiedPaths.filter(l=>l.isHole).length,2);
assert.ok(results[3].pieces.every(p=>p.shellMethod==="mesh_panels"));assert.ok(results[4].issues.some(i=>i.code==="shell-bevel-seams"&&i.severity==="warning"));
// Auto detects arbitrary oblique extrusions while preserving the imported world frame.
const original=results[0],q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.38),vertices=new Float64Array(original.vertices.length);
for(let i=0;i<vertices.length;i+=3)vertices.set(new Vector3(...original.vertices.slice(i,i+3)).applyQuaternion(q).toArray(),i);
const rotated=sliceMesh({vertices,info:inspectMesh(vertices,"rotated-hole.obj","OBJ")},base);valid(rotated);assert.equal(rotated.pieces.length,original.pieces.length);assert.ok(rotated.pieces.some(p=>p.frameRotation));
const transformed=asMeshes(rotated);const b=meshBounds(new Float64Array(rotated.vertices));assert.ok(transformed.every(m=>{m.geometry.computeBoundingBox();const c=m.geometry.boundingBox!.getCenter(new Vector3()).add(m.position);return c.x>=b.min[0]-5&&c.x<=b.max[0]+5&&c.y>=b.min[1]-5&&c.y<=b.max[1]+5&&c.z>=b.min[2]-5&&c.z<=b.max[2]+5;}));dispose(transformed);
// Every material family shares slot / thickness geometry. Acrylic hinge opt-in is explicit.
const {allowLivingHinges:_defaultHinges,...material}=materials(base)[0];
const byFamily=["cardboard","plywood","acrylic"] as const;
const shells=byFamily.map(family=>sliceMesh(makePreset("cube"),{...base,targetWidth:100,materialPresets:[{...material,family}]}));shells.forEach(valid);
for(const r of shells)assert.deepEqual(r.pieces.map(p=>p.assemblyPaths),shells[0].pieces.map(p=>p.assemblyPaths));
assert.equal(materials(shells[2].settings)[0].allowLivingHinges,false);assert.equal(materials(shells[1].settings)[0].allowLivingHinges,true);
const hingeSettings={...base,targetWidth:150,fingerBox:{...DEFAULT_SETTINGS.fingerBox!,curveHandling:"living_hinge" as const}},mid=sliceMesh(makePreset("letter_s"),hingeSettings),low=sliceMesh(makePreset("letter_s"),{...hingeSettings,materialPresets:[{...material,hingeKFactor:.3}]});valid(mid);valid(low);
for(const p of low.pieces.filter(p=>p.bendPath)){const same=mid.pieces.find(q=>q.id===p.id)!;assert.deepEqual(p.bendPath,same.bendPath);assert.ok(p.bendDistances!.at(-1)!<same.bendDistances!.at(-1)!);near(p.bendDistances!.at(-1)!,developedDistances(p.bendPath!,p.thickness!,.3).at(-1)!);const g=pieceGeometry(p);g.computeBoundingBox();const gm=pieceGeometry(same);gm.computeBoundingBox();near(g.boundingBox!.min.x,gm.boundingBox!.min.x,.003);near(g.boundingBox!.max.y,gm.boundingBox!.max.y,.003);g.dispose();gm.dispose();}
const disabled=sliceMesh(makePreset("letter_s"),{...hingeSettings,materialPresets:[{...material,family:"acrylic"}]});assert.ok(disabled.issues.some(i=>i.code==="hinge-material-disabled"));
const enabled=sliceMesh(makePreset("letter_s"),{...hingeSettings,materialPresets:[{...material,family:"acrylic",allowLivingHinges:true,hingeKFactor:.45}]});valid(enabled);
const curved=mid.pieces.find(p=>p.bendPath)!,mixed=sliceMesh(makePreset("letter_s"),{...hingeSettings,partThickness:{[curved.id]:"T2"},materialPresets:[{id:"T2",name:"Plywood",thickness:4.5,laserKerf:.18,colorHex:"#4EA8DE",family:"plywood",hingeKFactor:.4,hingePitch:3,hingeSlitLength:12}]});valid(mixed);const changed=mixed.pieces.find(p=>p.id===curved.id)!;near(changed.thickness!,4.5);near(changed.bendDistances!.at(-1)!,developedDistances(changed.bendPath!,4.5,.4).at(-1)!);assert.ok(changed.cutStrokes!.length>0);assert.ok(changed.cutStrokes!.every(stroke=>Math.abs(stroke.points[1].y-stroke.points[0].y)<=12.001));const columns=[...new Set(changed.cutStrokes!.map(stroke=>stroke.points[0].x))].sort((a,b)=>a-b);near(columns[1]-columns[0],3);
assert.throws(()=>validateSettings({...base,materialPresets:[{...material,hingeKFactor:1.1}]}),/K factor/);
const spread=explodedAssemblyLayout(shells[0]);assert.ok(spread.placements.every(p=>new Vector3(...p.displacement).length()>30));
for(const p of spread.placements){const original=shells[0].pieces[p.index],normal=new Vector3(...original.explodeDirection!).normalize();near(new Vector3(...p.displacement).clone().normalize().dot(normal),1);}
console.log("PASS materials and hinges: explicit acrylic opt-in; K-factor developed length; actual assigned thickness; target shape and imported assembly axes preserved.");
