import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { bounds, signedArea, materialArea, perimeter, offsetPaths, booleanPaths, inLoop } from "../lib/slicer/polygons";
import { nestPieces, placedPoint } from "../lib/slicer/nesting";
import { DEFAULT_SETTINGS, type LaserCutPiece, type Path2DLoop, type SliceSettings } from "../lib/slicer/types";
import { sliceMesh, validateSettings } from "../lib/slicer/engine";
import { makePreset } from "../lib/slicer/presets";
import { createSlicerSession } from "../lib/slicer/session";
import { exportBundle, exportDXF, sheetToolpaths } from "../lib/slicer/export";
import { exportAssemblyGuide } from "../lib/slicer/assembly-guide";
import { materialAppearance, materials } from "../lib/slicer/materials";
import { sanitizeFileComponent, sheetFileName } from "../lib/slicer/export-naming";
import { BRAND_LOGO } from "../lib/brand-logo";
import { exportAssemblyDiagram } from "../lib/slicer/assembly-diagram";
import { simplifyClosedContour } from "../lib/slicer/finger-box";

const loop=(xy:number[][],isHole=false):Path2DLoop=>{const points=xy.map(([x,y])=>({x,y}));if((signedArea(points)>0)===isHole)points.reverse();return {points,isHole};};
const piece=(id:string,cutPaths:Path2DLoop[],slot="T1"):LaserCutPiece=>({id,label:id,parentId:id,axis:"Z",sliceIndex:0,worldPosition:0,cutPaths,assemblyPaths:cutPaths,unmodifiedPaths:cutPaths,etchPaths:[],bounds:bounds(cutPaths),area:materialArea(cutPaths),cutLength:perimeter(cutPaths),joints:[],assignedThicknessId:slot});
const rectangle=(id:string,w:number,h:number,slot="T1")=>piece(id,[loop([[0,0],[w,0],[w,h],[0,h]])],slot);
function verify(pieces:LaserCutPiece[],s:SliceSettings,nesting:ReturnType<typeof nestPieces>){
  assert.equal(new Set(nesting.sheets.flatMap(s=>s.placements.map(p=>p.pieceId))).size,pieces.length-nesting.unplaced.length);
  for(const sheet of nesting.sheets){const expanded=sheet.placements.map(pl=>{
    const p=pieces.find(p=>p.id===pl.pieceId)!;assert.equal(p.assignedThicknessId,sheet.thicknessId);
    const paths=p.cutPaths.map(l=>({...l,points:l.points.map(q=>placedPoint(q,p,pl))})),b=bounds(paths);
    assert.ok(b.minX>=s.sheetMargin-1e-6&&b.minY>=s.sheetMargin-1e-6&&b.maxX<=sheet.width!-s.sheetMargin+1e-6&&b.maxY<=sheet.height!-s.sheetMargin+1e-6);
    return offsetPaths(paths,Math.max(0,s.partSpacing/2-.0002));
  });for(let i=0;i<expanded.length;i++)for(let j=i+1;j<expanded.length;j++)assert.ok(materialArea(booleanPaths(expanded[i],expanded[j],"intersection"))<.001,"Exact offset contours must not overlap");}
}
const stock={...DEFAULT_SETTINGS,sheetWidth:110,sheetHeight:110,sheetMargin:5,partSpacing:3,allowRotation:true};
const concave=[piece("L",[loop([[0,0],[90,0],[90,20],[20,20],[20,90],[0,90]])]),rectangle("INSERT",50,50)];
const polygon=nestPieces(concave,stock),boxes=nestPieces(concave,{...stock,nestingMode:"rectangles"});
assert.equal(polygon.sheets.length,1);assert.equal(boxes.sheets.length,2);verify(concave,stock,polygon);
const ring=(r:number,hole=false)=>loop(Array.from({length:96},(_,i)=>[45+r*Math.cos(i*Math.PI/48),45+r*Math.sin(i*Math.PI/48)]),hole);
const curved=[piece("RING",[ring(45),ring(32,true)]),rectangle("CENTER",35,35)];
const curvedNesting=nestPieces(curved,stock);assert.equal(curvedNesting.sheets.length,1);verify(curved,stock,curvedNesting);
const triangle=[piece("TRI-1",[loop([[0,0],[90,0],[0,90]])]),piece("TRI-2",[loop([[0,0],[90,0],[0,90]])])];
const triangleNesting=nestPieces(triangle,stock);assert.equal(triangleNesting.sheets.length,1);verify(triangle,stock,triangleNesting);
const diagonal=rectangle("DIAGONAL",100,10);diagonal.cutPaths=diagonal.cutPaths.map(l=>({...l,points:l.points.map(p=>({x:(p.x-p.y)/Math.sqrt(2)-120,y:(p.x+p.y)/Math.sqrt(2)-30}))}));diagonal.bounds=bounds(diagonal.cutPaths);
const narrow={...stock,sheetWidth:120,sheetHeight:40,sheetMargin:3,partSpacing:2};
assert.equal(nestPieces([diagonal],narrow).unplaced.length,1);
const rotated=nestPieces([diagonal],{...narrow,rotationStep:15});assert.equal(rotated.unplaced.length,0);assert.ok(rotated.sheets[0].placements[0].rotation%90!==0);verify([diagonal],narrow,rotated);
const multi=[...concave,rectangle("T2-PART",40,40,"T2"),rectangle("T3-PART",30,30,"T3")],inventory={...stock,scrapSheets:[{id:"offcut",width:110,height:110,thicknessId:"T1",quantity:1}]};
const mixed=nestPieces(multi,inventory);verify(multi,inventory,mixed);assert.equal(mixed.sheets.filter(s=>s.source==="scrap").length,1);assert.equal(mixed.sheets.filter(s=>s.source==="stock").length,2);
assert.throws(()=>validateSettings({...stock,rotationStep:7 as 15}));
for(const delta of [10,15]){const r=sliceMesh(makePreset("letter_s"),{...DEFAULT_SETTINGS,mode:"finger_box",fingerBox:{...DEFAULT_SETTINGS.fingerBox!,chordalError:delta}});assert.equal(r.issues.filter(i=>i.severity==="error").length,0);for(const p of r.pieces)assert.ok(materialArea(p.cutPaths)>0);}
const narrowContour=loop([[0,0],[100,0],[100,100],[65,100],[65,30],[35,30],[35,100],[0,100]]),simplified=simplifyClosedContour(narrowContour.points,15);
assert.equal(booleanPaths([{isHole:false,points:simplified}],[],"union").filter(l=>!l.isHole).length,1);assert.ok(signedArea(simplified)>0);
const corner=loop([[0,0],[100,0],[100,90],[100,100],[90,100],[0,100]]),smallHole=loop([[95,95],[97,95],[97,97],[95,97]],true);
assert.ok(inLoop(smallHole.points[0],simplifyClosedContour(corner.points,15,[smallHole.points])),"Simplification must retain a whole small hole in a removed corner wedge");
const progress:number[]=[],session=createSlicerSession((_,p)=>{if(p.stage==="nesting")progress.push(p.percent);});const response=session({id:7,type:"preset",preset:"jimmy",settings:DEFAULT_SETTINGS});
assert.ok("result" in response);assert.equal(response.result.issues.filter(i=>i.severity==="error").length,0);assert.equal(response.result.model.name,"Jimmy.stl");assert.equal(progress[0],0);assert.equal(progress.at(-1),100);assert.ok(progress.length>10);
const donut=sliceMesh(makePreset("donut_box"),{...DEFAULT_SETTINGS,mode:"finger_box"});assert.equal(donut.issues.filter(i=>i.severity==="error").length,0);assert.ok(donut.pieces.some(p=>p.wallRole==="hole"));
const guide=exportAssemblyGuide(donut,"a4","Workshop Donut");assert.ok(guide.pages.length>3);assert.equal(new TextDecoder().decode(guide.pdf.subarray(0,8)),"%PDF-1.4");assert.ok(guide.pages.every(p=>p.svg.includes('width="210mm"')));assert.ok(guide.pages[0].svg.includes("BILL OF MATERIALS"));for(const p of donut.pieces)assert.ok(guide.pages.some(page=>page.svg.includes(p.id)),p.id);
assert.ok(guide.pages.every(p=>p.svg.includes(`<image href="${BRAND_LOGO}"`)),"Each printable SVG page embeds the supplied mark");
assert.ok(exportAssemblyDiagram(donut).includes(`<image href="${BRAND_LOGO}"`));
const pdfText=new TextDecoder("latin1").decode(guide.pdf);assert.equal((pdfText.match(/\/Subtype \/Image/g)||[]).length,1,"PDF shares one logo across all pages");assert.ok(pdfText.includes("/BrandLogo")&&pdfText.includes("/DCTDecode"));
assert.ok(guide.pages.some(p=>p.svg.includes("Joint / slot")));assert.equal(sanitizeFileComponent('  Jimmy:/\\*? <>. '),"Jimmy");assert.equal(sanitizeFileComponent("../hello"),"hello");
const options={projectName:"Workshop Donut",prefix:"Batch/09",suffix:"rev?2",includeSheetSuffix:false,pageSize:"a4" as const};
const zip=unzipSync(exportBundle(donut,true,false,false,options)),names=Object.keys(zip);assert.ok(zip["Batch_09_Workshop_Donut_01_rev_2.dxf"]);assert.ok(zip["Batch_09_Workshop_Donut_Assembly_Guide_rev_2.pdf"]);assert.ok(zip["Batch_09_Workshop_Donut_Assembly_Diagram_rev_2.svg"]);assert.equal(names.filter(n=>n.endsWith(".dxf")).length,donut.sheets.length+2);assert.ok(names.some(n=>n.startsWith("assembly-guide/")));
const metadata=JSON.parse(strFromU8(zip["Batch_09_Workshop_Donut_project-metadata_rev_2.json"]));assert.equal(metadata.projectName,"Workshop Donut");assert.equal(metadata.guidePageSize,"a4");assert.equal(metadata.guidePages,guide.pages.length);assert.ok(sheetFileName(donut,0,"svg",{projectName:"CON"}).startsWith("_CON_"));assert.ok(sheetFileName(donut,0,"svg",{projectName:"CON.txt"}).startsWith("_CON.txt_"));assert.ok(new TextEncoder().encode(sheetFileName(donut,0,"svg",{projectName:"界".repeat(80),prefix:"界".repeat(80),suffix:"界".repeat(80)})).length<=240);
const r={...donut,pieces:[diagonal],sheets:rotated.sheets};assert.ok(exportDXF(r,r.sheets[0]).includes("LWPOLYLINE"));assert.ok(sheetToolpaths(r,r.sheets[0]).filter(p=>p.layer==="CUT_OUTLINE").every(p=>p.closed));
const m=materials(DEFAULT_SETTINGS)[0];assert.equal(materialAppearance({...m,family:"plywood"}).roughness,.85);assert.equal(materialAppearance({...m,family:"plywood"}).transmission,0);assert.equal(materialAppearance({...m,family:"acrylic"}).transmission,.88);assert.equal(materialAppearance({...m,family:"acrylic",acrylicFinish:"black"}).transmission,0);assert.equal(materialAppearance({...m,family:"acrylic",tintHex:"#123456"}).color,"#123456");
mkdirSync(".sites-runtime/validation/sprint-22",{recursive:true});writeFileSync(".sites-runtime/validation/sprint-22/print-guide.pdf",guide.pdf);
console.log("PASS: concave pockets and curved part-in-hole nesting, 180° and 15° rotation, exact clearance and margins, multi-stock scraps, worker progress, 15 mm safe curves, both supplied examples, naming sanitization, paginated SVG/vector PDF, and material appearance.");
