import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {unzipSync,strFromU8} from "fflate";
import {ConeGeometry,ExtrudeGeometry,Path,Shape,Vector3} from "three";
import {parseOBJ} from "../lib/slicer/obj";
import {exportAssemblyOBJ} from "../lib/slicer/obj-export";
import {assemblyDiagramLayout,exportAssemblyDiagram} from "../lib/slicer/assembly-diagram";
import {sliceMesh,validateSettings} from "../lib/slicer/engine";
import {makePreset} from "../lib/slicer/presets";
import {inspectMesh} from "../lib/slicer/stl";
import {pieceGeometry,assembledPosition} from "../lib/slicer/three-geometry";
import {section} from "../lib/slicer/section";
import {booleanPaths,bounds,inMaterial,materialArea,scanIntervals,splitComponents} from "../lib/slicer/polygons";
import {exportBundle,exportDXF,exportSVG,exportMasterSVG,masterLayout,sheetToolpaths} from "../lib/slicer/export";
import {DEFAULT_SETTINGS,type SliceSettings} from "../lib/slicer/types";
const near=(a:number,b:number,eps=.002)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const base:SliceSettings={...structuredClone(DEFAULT_SETTINGS),targetWidth:100,materialThickness:3,laserKerf:.15,xSliceCount:4,ySliceCount:4,leadInChamfer:0,
  materialPresets:[{id:"T2",name:"Mid",thickness:5,laserKerf:.2,colorHex:"#4EA8DE"},{id:"T3",name:"Heavy",thickness:6,laserKerf:.3,colorHex:"#9D4EDD"}]};
// A real mesh bore disappears under kerf compensation without blocking ZIP.
const boreShape=new Shape();boreShape.moveTo(-40,-40);boreShape.lineTo(40,-40);boreShape.lineTo(40,40);boreShape.lineTo(-40,40);boreShape.closePath();
const boreHole=new Path();boreHole.absarc(0,0,.2,0,Math.PI*2,true);boreShape.holes.push(boreHole);
const boreGeometry=new ExtrudeGeometry(boreShape,{depth:12,bevelEnabled:false,curveSegments:12}),boreVertices=new Float64Array(boreGeometry.getAttribute("position").array);boreGeometry.dispose();
const vanished=sliceMesh({vertices:boreVertices,info:inspectMesh(boreVertices,"tiny-bore.obj","test")},{...base,targetWidth:80,mode:"stacked",laserKerf:1,alignmentPins:false});
assert.ok(vanished.issues.some(i=>i.code==="vanishing-holes"));assert.ok(vanished.issues.filter(i=>i.code==="vanishing-holes").every(i=>i.severity==="warning"));
assert.ok(!vanished.issues.some(i=>i.severity==="error"),JSON.stringify(vanished.issues));assert.ok(vanished.pieces.every(p=>!p.cutPaths.some(l=>l.isHole)));
assert.ok(unzipSync(exportBundle(vanished))["sheet-01.dxf"]);
let boreOBJ="";for(let i=0;i<boreVertices.length;i+=3)boreOBJ+=`v ${boreVertices[i]} ${boreVertices[i+1]} ${boreVertices[i+2]}\n`;
for(let i=0;i<boreVertices.length/3;i+=3)boreOBJ+=`f ${i+1} ${i+2} ${i+3}\n`;
// A concave eight-sided T face cannot be triangulated correctly by an unrestricted fan.
const outline=[[0,0],[40,0],[40,70],[100,70],[100,100],[-60,100],[-60,70],[0,70]];
let obj="";for(const z of [0,30])for(const [x,y] of outline)obj+=`v ${x} ${y} ${z}\n`;
obj+="f "+outline.map((_,i)=>`${8-i}/1/1`).join(" ")+"\n";
obj+="f "+outline.map((_,i)=>`${i+9}//1`).join(" ")+"\n";
for(let i=0;i<8;i++)obj+=`f ${i+1} ${(i+1)%8+1} ${(i+1)%8+9} ${i+9}\n`;
const parsed=parseOBJ(obj,"concave-t.obj");assert.equal(parsed.info.boundaryEdges,0);assert.equal(parsed.info.nonManifoldEdges,0);
near(materialArea(section(parsed.vertices,"Z",15).loops),7600,.01);
assert.deepEqual(Array.from(parseOBJ(obj.replace("f 9//1 10//1 11//1 12//1 13//1 14//1 15//1 16//1","f -8 -7 -6 -5 -4 -3 -2 -1")).vertices),Array.from(parsed.vertices));
assert.throws(()=>parseOBJ(obj.replace("f 8/1/1","f 0/1/1")),/nonzero/);
assert.throws(()=>parseOBJ(obj.replace("f 8/1/1","f 999/1/1")),/outside/);
assert.throws(()=>parseOBJ("v nope 2 3\nf 1 2 3"),/invalid vertex/);
const mixed=sliceMesh(makePreset("cube"),{...base,partThickness:{"X-01":"T2","Y-01":"T3"}});
const x=mixed.pieces.find(p=>p.id==="X-01")!,y=mixed.pieces.find(p=>p.id==="Y-01")!;
near(x.thickness!,5);near(y.thickness!,6);
const transpose=(paths:typeof x.cutPaths)=>paths.map(l=>({...l,points:l.points.map(p=>({x:p.y,y:p.x}))}));
const top=scanIntervals(transpose(x.cutPaths),70),bottom=scanIntervals(transpose(y.cutPaths),30);
near(top[1][0]-top[0][1],6+base.slotFitTolerance-.2);near(bottom[1][0]-bottom[0][1],5+base.slotFitTolerance-.3);
for(const p of mixed.pieces){const g=pieceGeometry(p);g.computeBoundingBox();const n=p.axis==="X"?0:1;near(g.boundingBox!.getSize(new Vector3()).getComponent(n),p.thickness!);g.dispose();}
for(const sheet of mixed.sheets)assert.ok(sheet.placements.every(pl=>mixed.pieces.find(p=>p.id===pl.pieceId)!.assignedThicknessId===sheet.thicknessId));
const scraps=sliceMesh(makePreset("cube"),{...base,partThickness:{"X-01":"T2"},scrapSheets:[{id:"large-offcut",width:250,height:230,quantity:1,thicknessId:"T1"},{id:"blue-offcut",width:250,height:230,quantity:1,thicknessId:"T2"}]});
assert.ok(scraps.sheets.some(s=>s.source==="scrap"&&s.width===250));assert.ok(scraps.sheets.some(s=>s.source==="stock"));
for(const sheet of scraps.sheets){assert.equal(new Set(sheet.placements.map(pl=>scraps.pieces.find(p=>p.id===pl.pieceId)!.assignedThicknessId)).size,1);assert.ok(exportSVG(scraps,sheet).includes(`width="${sheet.width}mm"`));}
const master=masterLayout(scraps);assert.ok(master.width>600);assert.ok(exportMasterSVG(scraps).includes("ETCH_LABELS"));
assert.equal(master.paths.filter(p=>p.pieceId?.startsWith("Sheet-")).length,0);
assert.equal(masterLayout(scraps,true,true).paths.filter(p=>p.layer==="REFERENCE_GUIDES").length,scraps.sheets.length);
const variable=sliceMesh(makePreset("cube"),{...base,mode:"stacked",alignmentPins:false,partThickness:{"Z-01":"T3","Z-02":"T2"}});
const layers=variable.pieces.filter(p=>p.category==="stacked_layer");near(layers[0].worldPosition,3);near(layers[1].worldPosition,8.5);
for(let i=1;i<layers.length;i++)near(layers[i-1].worldPosition+layers[i-1].thickness!/2,layers[i].worldPosition-layers[i].thickness!/2);
near(variable.builtDepth,layers.reduce((a,p)=>a+p.thickness!,0));
const cg=new ConeGeometry(50,100,36).toNonIndexed();cg.rotateX(Math.PI/2);const coneVertices=new Float64Array(cg.getAttribute("position").array);cg.dispose();const cone={vertices:coneVertices,info:inspectMesh(coneVertices,"cone","test")};
const full=sliceMesh(cone,{...base,mode:"stacked",materialThickness:4,skipTopLayersCount:0});assert.equal(full.pins.length,0);
const blind=sliceMesh(cone,{...base,mode:"stacked",materialThickness:4,skipTopLayersCount:10,alignmentPinType:"material"});assert.equal(blind.pins.length,2);
for(const p of blind.pieces.filter(p=>p.category==="stacked_layer"))assert.equal(p.cutPaths.some(l=>l.isRegistration),p.sliceIndex<blind.layerCount-10);
const pins=blind.pieces.filter(p=>p.kind==="alignment-pin");near(bounds(pins[0].assemblyPaths).maxY,60);
const allBlind=sliceMesh(makePreset("cube"),{...base,mode:"stacked",skipTopLayersCount:400});assert.equal(allBlind.pins.length,0);assert.ok(allBlind.pieces.every(p=>!p.cutPaths.some(l=>l.isRegistration)));
const shell=sliceMesh(makePreset("cube"),{...base,mode:"finger_box",partThickness:{"CAP-TOP":"T2","WALL-01":"T3"},fingerBox:{...DEFAULT_SETTINGS.fingerBox!,bracing:{...DEFAULT_SETTINGS.fingerBox!.bracing,enabled:true,maxUnsupportedSpan:45,braceThicknessId:"T2"}}});
assert.ok(!shell.issues.some(i=>i.severity==="error"),JSON.stringify(shell.issues));assert.equal(shell.pieces.filter(p=>p.category==="box_wall").length,4);assert.ok(shell.pieces.some(p=>p.category==="brace"));
assert.equal(shell.pieces.at(-1)!.id,"CAP-TOP");near(shell.pieces.at(-1)!.worldPosition,97.5);
for(const p of shell.pieces){assert.equal(splitComponents(p.assemblyPaths).length,1,p.id);assert.ok(p.joints.length>0);}
const invalid=sliceMesh(makePreset("sphere"),{...base,mode:"finger_box",fingerBox:{...DEFAULT_SETTINGS.fingerBox!,shellConstruction:"extrusion"}});assert.ok(invalid.issues.some(i=>i.code==="box-not-prismatic"));assert.equal(invalid.pieces.length,0);
const T=sliceMesh(makePreset("letter_t"),{...base,mode:"finger_box",targetWidth:220});assert.equal(T.pieces.length,10);assert.ok(!T.issues.some(i=>i.severity==="error"));
const S=sliceMesh(makePreset("letter_s"),{...base,mode:"finger_box",targetWidth:160,fingerBox:{...DEFAULT_SETTINGS.fingerBox!,curveHandling:"living_hinge"}});
assert.ok(!S.issues.some(i=>i.severity==="error"),JSON.stringify(S.issues));assert.ok(S.pieces.some(p=>p.bendPath&&p.cutStrokes!.length>10));
for(const p of S.pieces.filter(p=>p.bendPath)){const g=pieceGeometry(p);assert.ok(g.groups.length>0,"Curved panels need draw groups for array materials");const pos=g.getAttribute("position");assert.ok(pos.count>0);for(let i=0;i<pos.array.length;i++)assert.ok(Number.isFinite(pos.array[i]));g.dispose();}
const sReload=parseOBJ(exportAssemblyOBJ(S),"curved-assembly.obj");assert.equal(sReload.info.boundaryEdges,0);assert.equal(sReload.info.nonManifoldEdges,0);
const dxf=exportDXF(shell,shell.sheets[0]),svg=exportSVG(shell,shell.sheets[0]);assert.match(svg,/stroke-width="0.0003528"/);assert.match(svg,/stroke-width="0.1763889"/);assert.match(svg,/#00FF00/);assert.ok(dxf.includes("CUT_INTERIOR"));
const paths=sheetToolpaths(shell,shell.sheets[0]);assert.ok(paths.some(p=>p.layer==="CUT_INTERIOR"));assert.equal(paths.at(-1)!.layer,"CUT_OUTLINE");
for(const r of [shell,mixed,T])for(const sheet of r.sheets){
  const cuts=sheetToolpaths(r,sheet,false);assert.ok(cuts.every(p=>p.closed),"Perimeters and enclosed holes must stay joined and closed, including open slots");
  assert.equal(cuts.length,sheet.placements.reduce((n,pl)=>n+r.pieces.find(p=>p.id===pl.pieceId)!.cutPaths.length,0));
  const drawing=exportDXF(r,sheet,false);assert.ok(drawing.includes("LWPOLYLINE")&&!drawing.includes("\r\nLINE\r\n"));
  const entities=drawing.split(/\r?\nENTITIES\r?\n/)[1].split(/\r?\n  0\r?\nENDSEC/)[0];
  assert.equal((entities.match(/\r\n 70\r\n1\r\n/g)||[]).length,cuts.length);
  assert.equal((exportSVG(r,sheet,false).match(/ Z"/g)||[]).length,cuts.length);
}
const hingeSheet=S.sheets.find(s=>s.placements.some(pl=>S.pieces.find(p=>p.id===pl.pieceId)?.cutStrokes?.length))!;
assert.ok(sheetToolpaths(S,hingeSheet,false).some(p=>p.layer==="CUT_INTERIOR"&&!p.closed&&p.points.length===2),"Living-hinge slits must remain open");
const exported=exportAssemblyOBJ(shell),reload=parseOBJ(exported,"assembly.obj");assert.ok(reload.info.triangleCount>100);assert.equal(reload.info.boundaryEdges,0);
// Cross-section intersections check actual 3D cap, wall and brace mating solids.
const shellVolumes=shell.pieces.map(p=>{const g=pieceGeometry(p),pos=g.getAttribute("position"),t=assembledPosition(p),v=new Float64Array(pos.count*3);for(let i=0;i<pos.count;i++){v[i*3]=pos.getX(i)+t.x;v[i*3+1]=pos.getY(i)+t.y;v[i*3+2]=pos.getZ(i)+t.z;}g.dispose();return v;});
for(const z of [1,5,16,27,43,58,75,94,98]){const sections=shellVolumes.map(v=>section(v,"Z",z).loops);for(let i=0;i<sections.length;i++)for(let j=i+1;j<sections.length;j++)assert.ok(materialArea(booleanPaths(sections[i],sections[j],"intersection"))<.02,`Solid collision: ${shell.pieces[i].id}/${shell.pieces[j].id} at Z=${z}`);}
const zip=unzipSync(exportBundle(shell));for(const name of ["MASTER_ALL_SHEETS.dxf","MASTER_ALL_SHEETS.svg","Assembly.obj","Assembly_Diagram.svg","sheets.csv","project-settings.json"])assert.ok(zip[name],name);
const diagram=exportAssemblyDiagram(shell);assert.match(diagram,/INTERNAL REINFORCEMENTS/);assert.match(diagram,/stroke-dasharray/);assert.equal((diagram.match(/r="19"/g)||[]).length,shell.pieces.length);
for(const r of [shell,T,S,mixed,blind]){
  const layout=assemblyDiagramLayout(r);assert.equal(layout.placements.length,r.pieces.length);
  for(const p of layout.placements){assert.ok(p.bounds.minX>60&&p.bounds.maxX<layout.width-50);assert.ok(p.badge.y+19<p.bounds.minY,"Callouts must stay above their parts");}
  for(let i=0;i<layout.placements.length;i++)for(let j=i+1;j<layout.placements.length;j++){
    const a=layout.placements[i].bounds,b=layout.placements[j].bounds;
    assert.ok(a.maxX+30<b.minX||b.maxX+30<a.minX||a.maxY+30<b.minY||b.maxY+30<a.minY,`Diagram parts overlap: ${layout.placements[i].pieceId}/${layout.placements[j].pieceId}`);
  }
}
assert.match(diagram,/ASSEMBLED REFERENCE/);assert.match(diagram,/fill="white" fill-rule="nonzero" stroke="none"/);
assert.ok(strFromU8(zip["assembly.csv"]).includes("thickness_mm"));
assert.throws(()=>validateSettings({...base,scrapSheets:[{id:"a",width:20,height:20,quantity:0,thicknessId:"T1"}]}));
const dir=".sites-runtime/validation";mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/box.dxf`,dxf);writeFileSync(`${dir}/box.svg`,svg);writeFileSync(`${dir}/box.obj`,exported);writeFileSync(`${dir}/Assembly_Diagram.svg`,diagram);writeFileSync(`${dir}/advanced-test.zip`,exportBundle(shell));writeFileSync(`${dir}/concave-t.obj`,obj);writeFileSync(`${dir}/living-hinge.svg`,exportSVG(S,S.sheets.find(s=>s.placements.some(pl=>S.pieces.find(p=>p.id===pl.pieceId)?.bendPath))!));
writeFileSync(`${dir}/tiny-bore.obj`,boreOBJ);writeFileSync(`${dir}/Diagram_T.svg`,exportAssemblyDiagram(T));writeFileSync(`${dir}/Diagram_S.svg`,exportAssemblyDiagram(S));writeFileSync(`${dir}/Diagram_Stacked.svg`,exportAssemblyDiagram(blind));
console.log("PASS: concave/negative-index OBJ; mixed-stock reciprocal slots and stack depth; matching finite scraps; variable-sheet masters; blind pins; cube/T/S shells, braces and hinges; solid OBJ round-trip, CAD styles and exploded BOM.");
