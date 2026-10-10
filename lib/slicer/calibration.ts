import { strToU8, zipSync } from "fflate";
import { drawingDXF } from "./dxf";
import { svgDrawing, type Toolpath } from "./export";
import { vectorLabel } from "./labels";
import { offsetPaths } from "./polygons";
import { sanitizeFileComponent } from "./export-naming";
import type { MaterialThicknessPreset, Path2DLoop, Point2D } from "./types";

export interface CalibrationSlot { width: number; center: Point2D }
export interface CalibrationStrip {
  width: number; height: number; barWidth: number; barHeight: number;
  kerf: number; stockId: string; stockThickness: number; slotDepth: number;
  slots: CalibrationSlot[]; nominal: Path2DLoop[]; cutPaths: Path2DLoop[];
  paths: Toolpath[];
}

/** Slot labels are finished openings, not centerline widths. Offset the solid
 * once by half the cutting stock's kerf, exactly as for assembly parts. */
export function createCalibrationStrip(stock: MaterialThicknessPreset, center=4): CalibrationStrip {
  if (!Number.isFinite(center) || center<.6 || center>50)
    throw new Error("Calibration center must be between 0.6 and 50 mm.");
  const centerTenths=Math.round(center*10);
  const widths=Array.from({length:11},(_,i)=>(centerTenths-5+i)/10);
  if (!Number.isFinite(stock.laserKerf) || stock.laserKerf<0 || stock.laserKerf>=widths[0])
    throw new Error("Kerf must be smaller than the narrowest test slot. Increase the calibration center or reduce kerf.");
  const margin=Math.max(3,stock.laserKerf/2+1), endMargin=10, pitch=Math.max(12,widths.at(-1)!+6);
  const barWidth=10*pitch+widths.at(-1)!+2*endMargin, barHeight=40, slotDepth=14;
  const top=margin+barHeight, bottom=top-slotDepth;
  const slots=widths.map((width,i)=>({width,center:{x:margin+endMargin+widths.at(-1)!/2+i*pitch,y:top-slotDepth/2}}));
  const points:Point2D[]=[{x:margin,y:margin},{x:margin+barWidth,y:margin},{x:margin+barWidth,y:top}];
  for(const slot of [...slots].reverse()){
    const left=slot.center.x-slot.width/2,right=slot.center.x+slot.width/2;
    points.push({x:right,y:top},{x:right,y:bottom},{x:left,y:bottom},{x:left,y:top});
  }
  points.push({x:margin,y:top});
  const nominal:Path2DLoop[]=[{points,isHole:false}],cutPaths=offsetPaths(nominal,stock.laserKerf/2);
  if(cutPaths.length!==1 || cutPaths[0].isHole)throw new Error("The calibration outline could not be generated. Reduce kerf.");
  const paths:Toolpath[]=cutPaths.map(loop=>({points:loop.points,closed:true,layer:"CUT_OUTLINE",pieceId:"FIT-COMB"}));
  const etch=(text:string,point:Point2D,id:string)=>{
    for(const stroke of vectorLabel(text,nominal,{point,clearance:1000}))
      paths.push({points:stroke.points,closed:!!stroke.closed,layer:"ETCH_LABELS",pieceId:id});
  };
  slots.forEach(slot=>etch(slot.width.toFixed(1),{x:slot.center.x,y:bottom-4.5},`SLOT-${slot.width.toFixed(1)}mm`));
  etch(`FIT TEST ${stock.id}`,{x:margin+barWidth*.25,y:margin+14},"TITLE");
  etch(`KERF ${Number(stock.laserKerf.toFixed(4))} MM`,{x:margin+barWidth*.73,y:margin+14},"KERF");
  etch("MM - NO EXTRA KERF",{x:margin+barWidth/2,y:margin+6},"INSTRUCTIONS");
  return {width:barWidth+2*margin,height:barHeight+2*margin,
    barWidth,barHeight,kerf:stock.laserKerf,stockId:stock.id,stockThickness:stock.thickness,slotDepth,slots,nominal,cutPaths,paths};
}

export function calibrationReadme(strip:CalibrationStrip,stock:MaterialThicknessPreset):string {
  return `MAKESLICE — KERF / JOINT FIT TEST\n\nStock: ${strip.stockId} · ${stock.name}\nMaterial: ${stock.family||"cardboard"}\nConfigured stock thickness: ${strip.stockThickness} mm (measure your actual sheet)\nConfigured laser kerf: ${strip.kerf} mm\n11 finished slot widths: ${strip.slots.map(s=>s.width.toFixed(1)).join(", ")} mm\nStep: 0.1 mm · Slot depth: ${strip.slotDepth} mm\nNominal comb: ${strip.barWidth} × ${strip.barHeight} mm\n\n1. Import ONE of the SVG or DXF files at 100%, in millimeters. They contain the same drawing.\n2. Blue ETCH_LABELS are vector labels. Etch them first; cut the red CUT_OUTLINE second. The outline and all open-edge notches are one joined closed polyline.\n3. These paths already include the selected stock's kerf. Disable extra kerf/offset compensation in the machine software. Machine speed and power are set on your laser.\n4. Cut from the actual stock used for your model. Test a straight edge of that stock in each slot without forcing it. Cardboard can compress; stop before crushing the flute.\n5. Pick the label with your desired fit. Measure the actual stock thickness and enter it for the material slot. Set joint fit clearance to: chosen labeled slot width minus actual mating stock thickness. For example, 3.9 mm fit with 3.8 mm stock means +0.1 mm clearance.\n6. The comb tests the combined stock/kerf fit. It does not independently measure beam kerf. If you change kerf, material, thickness, or machine settings, cut a fresh test. Recheck a joint from the actual assembly when materials are mixed.\n7. Adjust Calibration center for other stock: the default is 4.0 mm, giving 3.5–4.5 mm. The center is independent of assembly parameters.\n\nLabels describe nominal FINISHED openings. For a ${strip.slots[0].width.toFixed(1)} mm opening with ${strip.kerf} mm kerf, the vertical cutting centerlines are ${(strip.slots[0].width-strip.kerf).toFixed(4)} mm apart.\n\nThis fit comb does not certify living-hinge strength or bend radius. Acrylic lattice hinges can work in tested static bends but remain brittle; test the actual thickness, slit bridges, and radius separately.\n`;
}

export function exportCalibrationSVG(strip:CalibrationStrip):string {
  return svgDrawing(strip.paths,strip.width,strip.height,`MakeSlice kerf test · ${strip.stockId} · ${strip.slots[0].width.toFixed(1)}–${strip.slots.at(-1)!.width.toFixed(1)} mm`,
    `11 labeled finished slot widths in 0.1 mm steps. Kerf ${strip.kerf} mm is already compensated. Import at 1:1 in millimeters and disable extra CAM offsets. Closed red outline; blue vector etches. This fit test does not independently measure beam kerf.`);
}

export function exportCalibrationBundle(stock:MaterialThicknessPreset,center=4):{filename:string;data:Uint8Array;strip:CalibrationStrip} {
  const strip=createCalibrationStrip(stock,center);
  const base=`MakeSlice_Kerf_Test_${sanitizeFileComponent(stock.id)}_${strip.slots[0].width.toFixed(1)}-${strip.slots.at(-1)!.width.toFixed(1)}mm_kerf${stock.laserKerf}`;
  const files={
    [`${base}.svg`]:strToU8(exportCalibrationSVG(strip)),
    [`${base}.dxf`]:strToU8(drawingDXF(strip.paths,strip.width,strip.height)),
    "README.txt":strToU8(calibrationReadme(strip,stock)),
    "calibration-settings.json":strToU8(JSON.stringify({stockId:stock.id,stockName:stock.name,materialFamily:stock.family||"cardboard",stockThicknessMm:stock.thickness,kerfMm:stock.laserKerf,finishedSlotsMm:strip.slots.map(s=>s.width),slotDepthMm:strip.slotDepth,stepMm:.1,kerfCompensated:true},null,2)),
  };
  return {filename:`${base}.zip`,data:zipSync(files,{level:6}),strip};
}
