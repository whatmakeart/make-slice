import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { makePreset } from "../lib/slicer/presets";
import { parseSTL, inspectMesh } from "../lib/slicer/stl";
import { sliceMesh, validateSettings } from "../lib/slicer/engine";
import { section } from "../lib/slicer/section";
import { scanIntervals, materialArea, signedArea, bounds, inMaterial, offsetPaths, booleanPaths } from "../lib/slicer/polygons";
import { placedPoint } from "../lib/slicer/nesting";
import { exportDXF, exportUnplacedDXF, exportSVG, exportBundle, sheetToolpaths } from "../lib/slicer/export";
import { DEFAULT_SETTINGS, type SliceResult } from "../lib/slicer/types";
import { unzipSync, strFromU8 } from "fflate";
const cube=makePreset("cube");
const settings={...DEFAULT_SETTINGS,targetWidth:100,materialThickness:4,xSliceCount:4,ySliceCount:4};
const near=(a:number,b:number,e=.0002)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const binary=new ArrayBuffer(84+cube.info.triangleCount*50),view=new DataView(binary);
new Uint8Array(binary).set(new TextEncoder().encode("solid binary test"));view.setUint32(80,cube.info.triangleCount,true);
for(let t=0;t<cube.info.triangleCount;t++)for(let j=0;j<9;j++)view.setFloat32(84+t*50+12+j*4,cube.vertices[t*9+j],true);
const parsed=parseSTL(binary,"solid-binary.stl");assert.equal(parsed.info.format,"Binary STL");assert.equal(parsed.info.boundaryEdges,0);assert.deepEqual(Array.from(parsed.vertices),Array.from(cube.vertices));
let ascii="solid cube\n";for(let t=0;t<cube.info.triangleCount;t++){ascii+="facet normal 0 0 0\nouter loop\n";for(let v=0;v<3;v++)ascii+=`vertex ${Array.from(cube.vertices.slice(t*9+v*3,t*9+v*3+3)).join(" ")}\n`;ascii+="endloop\nendfacet\n";}ascii+="endsolid cube";
const a=parseSTL(new TextEncoder().encode(ascii).buffer,"ascii.stl");assert.equal(a.info.format,"ASCII STL");assert.deepEqual(Array.from(a.vertices),Array.from(cube.vertices));
assert.throws(()=>parseSTL(new TextEncoder().encode("solid invalid\nvertex 0 0 0").buffer,"bad.stl"));
const cap=section(cube.vertices,"Z",50);assert.equal(cap.open,0);assert.equal(cap.branches,0);near(materialArea(cap.loops),10000);
const r=sliceMesh(cube,settings);assert.equal(r.pieces.length,8);assert.equal(r.joints.length,16);assert.deepEqual(r.issues,[]);
const x=r.pieces.find(p=>p.id==="X-01")!;
const atHeight=(paths:typeof x.cutPaths,z:number)=>scanIntervals(paths.map(l=>({...l,points:l.points.map(p=>({x:p.y,y:p.x}))})),z);
const nominal=atHeight(x.assemblyPaths,70),compensated=atHeight(x.cutPaths,70);
assert.equal(nominal.length,5);assert.equal(compensated.length,5);
for(let i=0;i<4;i++){near(nominal[i+1][0]-nominal[i][1],4.05);near(compensated[i+1][0]-compensated[i][1],3.9);}
near(bounds(x.cutPaths).width,100.15);near(bounds(x.cutPaths).height,100.15);
const split=sliceMesh(cube,{...settings,slotDepthRatio:.3,leadInChamfer:0});
assert.ok(split.joints.every(j=>Math.abs(j.z-70)<.001));
const sx=split.pieces.find(p=>p.axis==="X")!,sy=split.pieces.find(p=>p.axis==="Y")!;
assert.ok(inMaterial({x:20,y:69},sx.assemblyPaths));assert.ok(!inMaterial({x:20,y:71},sx.assemblyPaths));
assert.ok(!inMaterial({x:20,y:69},sy.assemblyPaths));assert.ok(inMaterial({x:20,y:71},sy.assemblyPaths));
function verifySheets(result:SliceResult){
  assert.equal(result.unplaced.length,0);
  for(const sheet of result.sheets){
    const outlines=sheet.placements.map(pl=>{const p=result.pieces.find(x=>x.id===pl.pieceId)!;const loops=p.cutPaths.map(l=>({...l,points:l.points.map(q=>placedPoint(q,p,pl))})),b=bounds(loops),s=result.settings;
      assert.ok(b.minX>=s.sheetMargin-1e-7&&b.minY>=s.sheetMargin-1e-7&&b.maxX<=(sheet.width||s.sheetWidth)-s.sheetMargin+1e-7&&b.maxY<=(sheet.height||s.sheetHeight)-s.sheetMargin+1e-7);return offsetPaths(loops,Math.max(0,s.partSpacing/2-.0002));
    });
    for(let i=0;i<outlines.length;i++)for(let j=i+1;j<outlines.length;j++)assert.ok(materialArea(booleanPaths(outlines[i],outlines[j],"intersection"))<.001,"Material contours overlap or violate spacing");
  }
}
verifySheets(r);
const ripple=sliceMesh(makePreset("ripple"),DEFAULT_SETTINGS);verifySheets(ripple);assert.equal(ripple.issues.length,0);
const torus=makePreset("torus"),ring=section(torus.vertices,"Z",0.1);assert.equal(ring.open,0);
const centerRing=section(torus.vertices,"Z",0); // Exact equatorial plane is a vertex/edge degeneracy test.
assert.equal(centerRing.open,0);assert.equal(centerRing.branches,0);assert.equal(centerRing.loops.filter(p=>p.isHole).length,1);
for(const l of centerRing.loops)assert.equal(signedArea(l.points)>0,!l.isHole);
for(const axis of ["X","Y","Z"] as const){
  const stack=sliceMesh(cube,{...settings,mode:"stacked",stackedAxis:axis,alignmentPins:true,pinCount:2,pinDiameter:6});
  assert.equal(stack.layerCount,25);near(stack.builtDepth,100);assert.equal(stack.pins.length,2);assert.equal(stack.pieces.length,25);assert.deepEqual(stack.issues,[]);verifySheets(stack);
  for(const p of stack.pieces){assert.equal(p.cutPaths.filter(l=>l.isRegistration).length,2);for(const pin of stack.pins){const hole=p.cutPaths.find(l=>l.isRegistration&&Math.hypot(bounds([l]).minX+2.925-pin.x,bounds([l]).minY+2.925-pin.y)<.05)!;assert.ok(hole);near(bounds([hole]).width,5.85,.002);}}
}
const rounded=sliceMesh(cube,{...settings,mode:"stacked",materialThickness:3.8});assert.equal(rounded.layerCount,26);near(rounded.builtDepth,98.8);assert.ok(rounded.issues.some(i=>i.code==="rounded-stack"));
const over=sliceMesh(cube,{...settings,sheetWidth:50,sheetHeight:50});assert.ok(over.unplaced.length>0);assert.ok(over.issues.some(i=>i.code==="oversize-parts"&&i.severity==="error"));
const unplacedDXF=exportUnplacedDXF(over),unplacedR12=exportUnplacedDXF(over,true,true);
assert.ok(unplacedDXF.includes("LWPOLYLINE")&&unplacedDXF.includes("\r\nOBJECTS\r\n"));
assert.ok(unplacedDXF.includes("$INSUNITS")&&!unplacedDXF.includes("NaN"));
assert.ok(unplacedR12.includes("AC1009")&&!unplacedR12.includes("LWPOLYLINE"));
assert.throws(()=>exportUnplacedDXF(r));
const collision=sliceMesh(cube,{...settings,xSliceCount:40});assert.ok(collision.issues.some(i=>i.code==="slice-collision"&&i.severity==="error"));
assert.throws(()=>validateSettings({...settings,laserKerf:4.1}));assert.throws(()=>validateSettings({...settings,xSliceCount:4.5}));assert.throws(()=>validateSettings({...settings,sheetMargin:300}));
const missing=cube.vertices.slice(9);const broken=sliceMesh({vertices:missing,info:inspectMesh(missing,"broken","Test")},settings);assert.ok(broken.issues.some(i=>i.code==="open-contours"&&i.severity==="error"));
const dxf=exportDXF(r,r.sheets[0]),segments=exportDXF(r,r.sheets[0],true,false,true),legacy=exportDXF(r,r.sheets[0],true,true),svg=exportSVG(r,r.sheets[0]);
assert.ok(dxf.includes("AC1015")&&dxf.includes("$INSUNITS")&&dxf.includes("LWPOLYLINE")&&!dxf.includes("\r\nLINE\r\n"));
for(const name of ["CLASSES","VPORT","APPID","DIMSTYLE","BLOCK_RECORD","OBJECTS","LAYOUT"])assert.ok(dxf.includes(name),`DXF is missing ${name}`);
assert.equal((segments.match(/\r\nLINE\r\n/g)||[]).length,sheetToolpaths(r,r.sheets[0]).reduce((sum,p)=>sum+p.points.length-(p.closed?0:1),0));
assert.ok(segments.includes("\r\nLINE\r\n")&&!segments.includes("LWPOLYLINE"));
assert.ok(legacy.includes("AC1009")&&!legacy.includes("LWPOLYLINE")&&!legacy.includes("$INSUNITS"));assert.ok(svg.includes('width="900mm"')&&svg.includes('height="600mm"'));assert.ok(!/\bTEXT\b/.test(dxf));
const files=unzipSync(exportBundle(r));assert.ok(files["sheet-01.svg"]&&files["sheet-01.dxf"]&&files["README.txt"]&&files["assembly.csv"]);assert.ok(strFromU8(files["README.txt"]).includes("Disable additional kerf compensation"));
const dir=".sites-runtime/validation";mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/cube.dxf`,dxf);writeFileSync(`${dir}/cube-lines.dxf`,segments);writeFileSync(`${dir}/cube-r12.dxf`,legacy);writeFileSync(`${dir}/unplaced.dxf`,unplacedDXF);writeFileSync(`${dir}/cube.svg`,svg);writeFileSync(`${dir}/cube-binary.stl`,new Uint8Array(binary));writeFileSync(`${dir}/cube-ascii.stl`,ascii);
console.log("PASS: binary/ASCII STL, closed contours, 3.90 mm kerf-adjusted slots, complementary joints, holes, all pin axes, layer depth, spacing, oversize/open-mesh errors, SVG, DXF, and ZIP.");
console.log(JSON.stringify({rippleParts:ripple.pieces.length,rippleSheets:ripple.sheets.length,rippleMs:Math.round(ripple.processingMs)}));
