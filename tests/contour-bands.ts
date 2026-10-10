import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { strFromU8, unzipSync } from "fflate";
import { sliceMesh, validateSettings } from "../lib/slicer/engine";
import { makePreset } from "../lib/slicer/presets";
import { DEFAULT_SETTINGS, type LaserCutPiece, type SliceResult, type SliceSettings } from "../lib/slicer/types";
import { assembledPosition, pieceGeometry } from "../lib/slicer/three-geometry";
import { booleanPaths, bounds, materialArea, splitComponents } from "../lib/slicer/polygons";
import { section } from "../lib/slicer/section";
import { developedDistances } from "../lib/slicer/finger-box";
import { exportAssemblyOBJ } from "../lib/slicer/obj-export";
import { parseOBJ } from "../lib/slicer/obj";
import { exportBundle, exportDXF, exportSVG, sheetToolpaths } from "../lib/slicer/export";
import { assemblyDiagramLayout, exportAssemblyDiagram, explodedAssemblyLayout } from "../lib/slicer/assembly-diagram";

const near=(a:number,b:number,tolerance=.003)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const base:SliceSettings={...structuredClone(DEFAULT_SETTINGS),mode:"finger_box",targetWidth:120,
  fingerBox:{...DEFAULT_SETTINGS.fingerBox!,shellConstruction:"bands",curveHandling:"living_hinge"}};
const ready=(r:SliceResult)=>{
  assert.ok(r.pieces.length>0);
  assert.ok(!r.issues.some(i=>i.severity==="error"),JSON.stringify(r.issues));
  assert.equal(r.unplaced.length,0);
  assert.ok(r.pieces.every(p=>p.shellMethod==="contour_bands"));
  const ids=new Set(r.pieces.map(p=>p.id));assert.equal(ids.size,r.pieces.length);
  for(const p of r.pieces){
    assert.equal(splitComponents(p.assemblyPaths).length,1,p.id);
    assert.ok(p.area>0&&Number.isFinite(p.area));
    assert.ok(p.joints.every(id=>ids.has(id)&&id!==p.id),p.id);
    assert.ok(p.joints.every(id=>r.pieces.find(q=>q.id===id)!.joints.includes(p.id)),`${p.id}: reciprocal mates`);
    assert.ok(p.cutPaths.every(l=>l.points.length>=3&&l.points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y))));
  }
};
const solid=(p:LaserCutPiece)=>{
  const g=pieceGeometry(p),pos=g.getAttribute("position"),t=assembledPosition(p),v=new Float64Array(pos.count*3);
  for(let i=0;i<pos.count;i++)v.set([pos.getX(i)+t.x,pos.getY(i)+t.y,pos.getZ(i)+t.z],i*3);
  g.dispose();return v;
};
function manifoldObjects(r:SliceResult){
  const obj=exportAssemblyOBJ(r);let vertexOffset=0;
  for(const block of obj.split(/^o /m).slice(1)){
    const vertices=block.split("\n").filter(l=>l.startsWith("v "));
    const faces=block.split("\n").filter(l=>l.startsWith("f ")).map(l=>"f "+l.slice(2).split(" ").map(n=>Number(n)-vertexOffset).join(" "));
    const info=parseOBJ([...vertices,...faces].join("\n")).info;
    assert.equal(info.boundaryEdges,0,`${block.split("\n")[0]}: closed solid`);
    assert.equal(info.nonManifoldEdges,0,`${block.split("\n")[0]}: manifold solid`);
    vertexOffset+=vertices.length;
  }
  return obj;
}
function plateFit(r:SliceResult){
  const solids=r.pieces.map(solid);
  for(let i=0;i<r.pieces.length;i++){
    const p=r.pieces[i];if(p.category!=="box_cap")continue;
    for(const z of [p.worldPosition-p.thickness!/4,p.worldPosition+p.thickness!/4]){
      const cap=section(solids[i],"Z",z);
      assert.equal(cap.open,0,p.id);assert.equal(cap.branches,0,p.id);
      for(let j=0;j<r.pieces.length;j++)if(r.pieces[j].category!=="box_cap"){
        const wall=section(solids[j],"Z",z);
        assert.equal(wall.open,0,r.pieces[j].id);assert.equal(wall.branches,0,r.pieces[j].id);
        const overlap=materialArea(booleanPaths(cap.loops,wall.loops,"intersection"));
        assert.ok(overlap<.02,`${p.id}/${r.pieces[j].id}: ${overlap} mm² overlap at ${z}`);
      }
    }
  }
  // Opposing tabs stop just before the center of a shared plate.
  for(const plate of r.pieces.filter(p=>p.plateRole==="joining")){
    for(const p of r.pieces.filter(p=>p.category!=="box_cap"&&p.joints.includes(plate.id))){
      const z=solids[r.pieces.indexOf(p)].filter((_,i)=>i%3===2);
      if(p.bandIndex===plate.bandIndex!-1)near(Math.max(...z),plate.worldPosition-.03);
      if(p.bandIndex===plate.bandIndex)near(Math.min(...z),plate.worldPosition+.03);
    }
  }
}

const sphere=sliceMesh(makePreset("sphere"),base);ready(sphere);
assert.ok(sphere.layerCount>Math.ceil(sphere.dimensions[2]/30));
const heights=[...new Map(sphere.pieces.filter(p=>p.bandRange).map(p=>[p.bandIndex,p.bandRange![1]-p.bandRange![0]])).values()];
assert.ok(new Set(heights.map(h=>h.toFixed(3))).size>1,"Organic forms need varying band heights");
assert.ok(heights.every(h=>h<=30.001&&h>=base.materialThickness*2+5-.001));
plateFit(sphere);manifoldObjects(sphere);
const uniform=sliceMesh(makePreset("sphere"),{...base,fingerBox:{...base.fingerBox!,adaptiveBands:false}});ready(uniform);
assert.equal(uniform.layerCount,Math.ceil(uniform.dimensions[2]/30));
const auto=sliceMesh(makePreset("sphere"),{...base,fingerBox:{...base.fingerBox!,shellConstruction:"auto"}});ready(auto);
assert.deepEqual(auto.pieces.map(p=>p.id),sphere.pieces.map(p=>p.id));
const extrusion=sliceMesh(makePreset("letter_s"),{...base,targetWidth:150,fingerBox:{...base.fingerBox!,shellConstruction:"auto"}});
assert.ok(extrusion.pieces.filter(p=>p.category!=="box_cap").every(p=>p.shellMethod==="extrusion"),"Constant extrusions retain the existing profile shell");

const mixed=sliceMesh(makePreset("sphere"),{...base,partThickness:{"PLATE-04":"T2","B04-WALL-01":"T3"},
  materialPresets:[{id:"T2",name:"Joining plate",thickness:4.5,laserKerf:.18,colorHex:"#4EA8DE",family:"plywood"},
    {id:"T3",name:"Flexible strip",thickness:6,laserKerf:.2,colorHex:"#9D4EDD",family:"plywood",hingeKFactor:.4,hingePitch:3,hingeSlitLength:8}]});ready(mixed);plateFit(mixed);manifoldObjects(mixed);
const changed=mixed.pieces.find(p=>p.id==="B04-WALL-01")!;near(changed.thickness!,6);
near(changed.bendDistances!.at(-1)!,developedDistances(changed.bendPath!,6,.4).at(-1)!);
assert.ok(changed.cutStrokes!.every(s=>Math.abs(s.points[1].y-s.points[0].y)<=8.001));
assert.equal(mixed.pieces.find(p=>p.parentId==="PLATE-04")!.assignedThicknessId,"T2");
assert.ok(mixed.sheets.every(s=>s.placements.every(pl=>mixed.pieces.find(p=>p.id===pl.pieceId)!.assignedThicknessId===s.thicknessId)));

const torus=sliceMesh(makePreset("torus"),base);ready(torus);assert.ok(torus.pieces.some(p=>p.wallRole==="hole"));
const meshes=torus.pieces.map(p=>{const m=new Mesh(pieceGeometry(p),new MeshBasicMaterial({side:DoubleSide}));m.position.copy(assembledPosition(p));m.updateMatrixWorld(true);return m;});
assert.equal(new Raycaster(new Vector3(torus.dimensions[0]/2,torus.dimensions[1]/2,-20),new Vector3(0,0,1),0,torus.dimensions[2]+40).intersectObjects(meshes,false).length,0,"Banded tunnels stay open");
meshes.forEach(m=>{m.geometry.dispose();(m.material as MeshBasicMaterial).dispose();});manifoldObjects(torus);

for(const axis of ["X","Y"] as const){
  const r=sliceMesh(makePreset("sphere"),{...base,fingerBox:{...base.fingerBox!,extrusionAxis:axis}});ready(r);
  assert.ok(r.pieces.every(p=>p.frameRotation));
  const vertices=r.pieces.flatMap(p=>Array.from(solid(p))),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  vertices.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v);});
  const a=axis==="X"?0:1;near(min[a],0);near(max[a],r.dimensions[a]);manifoldObjects(r);
}

const jimmy=sliceMesh(makePreset("jimmy"),{...base,targetWidth:220});ready(jimmy);
assert.ok(jimmy.pieces.length<100,"Organic hinge mode should not create hundreds of facets");
assert.ok(jimmy.pieces.filter(p=>p.category!=="box_cap").every(p=>p.bendPath&&p.cutStrokes!.length>0));
const jimmyOBJ=manifoldObjects(jimmy);
for(const sheet of jimmy.sheets){
  const cuts=sheetToolpaths(jimmy,sheet,false),contours=cuts.filter(p=>p.points.length>2);
  assert.ok(contours.every(p=>p.closed));
  const dxf=exportDXF(jimmy,sheet,false),svg=exportSVG(jimmy,sheet,false);
  const entities=dxf.split(/\r?\nENTITIES\r?\n/)[1].split(/\r?\n  0\r?\nENDSEC/)[0];
  assert.equal((entities.match(/\r\n 70\r\n1\r\n/g)||[]).length,contours.length);
  assert.equal((svg.match(/ Z"/g)||[]).length,contours.length);
}
const spread=explodedAssemblyLayout(jimmy),inventory=assemblyDiagramLayout(jimmy);
assert.equal(spread.placements.length,jimmy.pieces.length);assert.equal(inventory.placements.length,jimmy.pieces.length);
assert.equal(spread.grouped,true);assert.equal(spread.placements.filter(p=>p.showCallout).length,jimmy.layerCount+1);
assert.ok(spread.placements.every(p=>p.badge.y+14<inventory.assemblyBottom));
const bandDisplacements=spread.placements.filter(p=>p.showCallout).sort((a,b)=>jimmy.pieces[a.index].bandIndex!-jimmy.pieces[b.index].bandIndex!);
assert.ok(bandDisplacements.every((p,i)=>!i||p.displacement[2]>bandDisplacements[i-1].displacement[2]),"Exploded bands and the top plate retain their order along the stack axis");
const zip=unzipSync(exportBundle(jimmy));
for(const filename of ["Assembly_Diagram.svg","Assembly.obj","Assembly_Guide.pdf","MASTER_ALL_SHEETS.dxf","MASTER_ALL_SHEETS.svg"])assert.ok(zip[filename],filename);
const steps=strFromU8(zip["assembly-guide/Assembly_Guide_Page_02.svg"]);assert.match(steps,/contour band/);assert.match(steps,/opposite halves/);
assert.ok(!strFromU8(zip["sheets.csv"]).includes("feed_speed"));
const dir=".sites-runtime/validation";mkdirSync(dir,{recursive:true});
writeFileSync(`${dir}/Jimmy_Bands.svg`,exportAssemblyDiagram(jimmy));writeFileSync(`${dir}/Jimmy_Bands.obj`,jimmyOBJ);
writeFileSync(`${dir}/Jimmy_Bands_Guide.pdf`,zip["Assembly_Guide.pdf"]);
for(const [name,bytes] of Object.entries(zip))if(name.startsWith("assembly-guide/"))writeFileSync(`${dir}/Jimmy_${name.split("/").at(-1)}`,bytes);
writeFileSync(`${dir}/Sphere_Bands.svg`,exportAssemblyDiagram(sphere));
assert.throws(()=>validateSettings({...base,fingerBox:{...base.fingerBox!,bandHeight:7}}),/band height/);
assert.throws(()=>validateSettings({...base,fingerBox:{...base.fingerBox!,bandDeviation:26}}),/profile deviation/);
const acrylic=sliceMesh(makePreset("sphere"),{...base,materialPresets:[{id:"T1",name:"Cast acrylic",thickness:3.8,laserKerf:.15,colorHex:"#ffffff",family:"acrylic"}]});
assert.ok(acrylic.issues.some(i=>i.code==="hinge-material-disabled"&&i.severity==="error"));
console.log(`PASS: adaptive/uniform contour bands, mixed-stock opposing tabs and physical plate clearance, X/Y frames, clear tunnels, manifold OBJ solids, joined CAD contours, and numbered band assembly guides. Jimmy: ${jimmy.layerCount} bands / ${jimmy.pieces.length} parts.`);
