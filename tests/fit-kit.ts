import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { createFitTestPieces, exportCalibrationKit } from "../lib/slicer/calibration-kit";
import { DEFAULT_SETTINGS, type Path2DLoop, type SliceSettings } from "../lib/slicer/types";
import { bounds, booleanPaths, materialArea, pointClearance, scanIntervals, splitComponents } from "../lib/slicer/polygons";
import { rotatePoint } from "../lib/slicer/beam";
import { materials } from "../lib/slicer/materials";

const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.0003,`${a} != ${b}`);
const gaps=(loops:Path2DLoop[])=>{
  const b=bounds(loops),rows=loops.map(l=>({...l,points:l.points.map(q=>({x:q.y,y:q.x}))}));
  const teeth=scanIntervals(rows,b.maxY-7);
  return teeth.slice(1).map((span,i)=>span[0]-teeth[i][1]);
};
// Inspect actual cut geometry rather than only its labeled sizes. Directional
// compensation must follow the test's rotation in the fixed machine axes.
for(const mode of ["interlocking","stacked","finger_box"] as const)for(const thickness of [3.6,4,4.3])for(const step of [.1,.05,.02])for(const perpendicular of [true,false]){
  const s:SliceSettings={...structuredClone(DEFAULT_SETTINGS),mode,materialThickness:thickness,laserKerf:.27};
  const stock={...materials(s)[0],kerfX:.12,kerfY:.27,name:"Measured test stock"},parts=createFitTestPieces(stock,s,step,perpendicular);
  assert.equal(parts.length,2);
  for(const [i,p] of parts.entries()){
    assert.equal(splitComponents(p.nominal!).length,1,"One connected handled piece");
    assert.equal(p.paths.filter(q=>q.layer==="CUT_OUTLINE").length,1);
    assert.ok(p.paths.filter(q=>q.layer!=="ETCH_LABELS").every(q=>q.closed),"Cuts are joined closed polylines");
    assert.ok(p.paths.filter(q=>q.layer==="ETCH_LABELS").flatMap(q=>q.points).every(q=>pointClearance(q,p.nominal!)>-.01),"All etching stays on its piece");
    assert.ok(p.etchText!.some(t=>t.includes("Measured test stock")));
    assert.ok(p.etchText!.some(t=>t.includes(`THICK ${thickness}`)));
    if(i&&!perpendicular)continue;
    const unrotate=(loops:Path2DLoop[])=>loops.map(l=>({...l,points:l.points.map(q=>rotatePoint(q,-p.orientation))}));
    const nominal=gaps(unrotate(p.nominal!)),cut=gaps(unrotate(p.paths.filter(q=>q.layer!=="ETCH_LABELS").map(q=>({isHole:q.layer==="CUT_INTERIOR",points:q.points}))));
    assert.equal(nominal.length,11);assert.equal(cut.length,11);
    const clearance=mode==="finger_box"?s.fingerBox!.jointTolerance:s.slotFitTolerance;
    nominal.forEach((width,j)=>{const expected=thickness+clearance+(j-5)*step;near(width,expected);near(cut[j],expected-(p.orientation?stock.kerfY:stock.kerfX));});
  }
}
const settings:SliceSettings={...structuredClone(DEFAULT_SETTINGS),mode:"stacked",alignmentPinType:"material"},stock=materials(settings)[0];
const materialPin=createFitTestPieces(stock,settings,.1,false)[1];
// The registration key projects beyond the handle, so it can actually enter
// the closed slot instead of being obstructed by its attached body.
assert.ok(materialPin.nominal!.some(l=>l.points.some(q=>q.y<bounds(materialPin.nominal!).maxY-58-.5)));
const kit=exportCalibrationKit("fit",stock,settings),sheet=kit.sheets[0];
assert.equal(kit.sheets.length,1);assert.equal(sheet.pieceIds.length,2);
const left=sheet.paths.filter(p=>p.pieceId===sheet.pieceIds[0]&&p.layer!=="ETCH_LABELS").map(p=>({isHole:p.layer==="CUT_INTERIOR",points:p.points}));
const right=sheet.paths.filter(p=>p.pieceId===sheet.pieceIds[1]&&p.layer!=="ETCH_LABELS").map(p=>({isHole:p.layer==="CUT_INTERIOR",points:p.points}));
assert.equal(materialArea(booleanPaths(left,right,"intersection")),0);
const all=bounds([{isHole:false,points:sheet.paths.flatMap(p=>p.points)}]);
for(const border of [all.minX,all.minY,sheet.width-all.maxX,sheet.height-all.maxY])near(border,20);
const files=unzipSync(kit.data),svgName=Object.keys(files).find(k=>k.includes("Sheet_01")&&k.endsWith(".svg"))!;
assert.equal(Object.keys(files).filter(k=>k.endsWith(".dxf")).length,1);
assert.ok(!strFromU8(files[svgName]).includes("<text"));
assert.match(strFromU8(files["Instructions.svg"]),/Two handled pieces share one sheet/);
assert.ok(!strFromU8(files["README.txt"]).includes("coupon"));
console.log("PASS: two connected fit pieces, real stepped openings and directional cut widths, on-piece material etching, accessible registration key, one non-overlapping sheet and 20 mm borders.");
