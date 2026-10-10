import { strToU8, zipSync } from "fflate";
import { createCalibrationStrip } from "./calibration";
import { bounds, booleanPaths, circle } from "./polygons";
import { compensate, rotatePoint } from "./beam";
import { drawingDXF } from "./dxf";
import { svgDrawing } from "./export";
import { vectorLabel } from "./labels";
import { BRAND_PRINT_IMAGE } from "../brand-logo";
import { VectorPage, vectorPDF } from "./vector-document";
import { boxSettings } from "./materials";
import { fingerJointSpan, fingerJointRelief } from "./finger-box";
import { validateSettings } from "./validation";
import type { Toolpath } from "./operations";
import type { MaterialThicknessPreset, Path2DLoop, Point2D, SliceSettings } from "./types";

export const GAUGE_VERSION="MS-CAVITY-19-V1";
export const GAUGE_BARS=19;
export const EFFECTIVE_CUTS=GAUGE_BARS+1;
export const CALIBRATION_BORDER_MM=20;
const rectangle=(x:number,y:number,w:number,h:number,isHole=false):Path2DLoop=>({isHole,points:(isHole?[[x,y],[x,y+h],[x+w,y+h],[x+w,y]]:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]).map(([x,y])=>({x,y}))});
function label(paths:Toolpath[],text:string,x:number,y:number,id:string,size=2.5){const strokes=vectorLabel(text,[],{point:{x,y},clearance:1000});for(const s of strokes)paths.push({layer:"ETCH_LABELS",operation:"score",pieceId:id,points:s.points.map(p=>({x:x+(p.x-x)*size/3.8,y:y+(p.y-y)*size/3.8})),closed:!!s.closed});}
export function kerfFromGap(gapMm:number){if(!Number.isFinite(gapMm)||gapMm<=0||gapMm>EFFECTIVE_CUTS*5)throw new Error("Measured gap must be greater than zero and at most 100 mm.");return {fullKerfMm:gapMm/EFFECTIVE_CUTS,oneSidedOffsetMm:gapMm/(2*EFFECTIVE_CUTS),effectiveCuts:EFFECTIVE_CUTS,gaugeVersion:GAUGE_VERSION};}
export function lightBurnGaugeReading(D:number,E:number){if(!Number.isInteger(D)||D<0||D>9||!Number.isInteger(E)||E<0||E>9)throw new Error("Choose D and E digits from 0 to 9.");const decimalMm=D+E/10;return {decimalMm,oneSidedOffsetMm:decimalMm/40,fullKerfMm:decimalMm/20,gaugeVersion:"LIGHTBURN-20-KERF-GAUGE"};}
export interface Coupon {id:string;paths:Toolpath[];width:number;height:number;orientation:number;compensated:boolean;nominal?:Path2DLoop[]}
export function createKerfGauge(angle=0):Coupon{
  if(![0,90,45].includes(angle))throw new Error("Gauge orientation must be X, Y or 45 degrees.");
  // 19 bars span a single cavity. Its boundary widens by k, while each bar
  // loses k: assembled gap = (19 + 1) * k. Internal lines are shared ONCE.
  const outer=rectangle(0,0,100,50),cavity=rectangle(10,10,80,30,true),id=`${GAUGE_VERSION}-${angle===0?"X":angle===90?"Y":"45"}`,paths:Toolpath[]=[{points:outer.points,closed:true,layer:"CUT_OUTLINE",operation:"exterior",pieceId:id},{points:cavity.points,closed:true,layer:"CUT_INTERIOR",operation:"interior",pieceId:id}];
  for(let i=1;i<GAUGE_BARS;i++){const x=10+i*80/GAUGE_BARS;paths.push({points:[{x,y:10},{x,y:40}],closed:false,layer:"CUT_INTERIOR",operation:"cut_slit",pieceId:id});}
  label(paths,`MS19V1 ${angle===0?"X":angle===90?"Y":"45"} N20 RAW`,50,45,id,2.2);
  label(paths,"PACK LEFT - READ GAP RIGHT",50,5,id,2);
  for(let i=0;i<GAUGE_BARS;i++)label(paths,String(i+1),10+(i+.5)*80/GAUGE_BARS,25,id,1.3);
  paths.push({layer:"ETCH_LABELS",operation:"score",pieceId:id,closed:false,points:[{x:25,y:7},{x:80,y:7},{x:77,y:9},{x:80,y:7},{x:77,y:5}]});
  const rotated=paths.map(p=>({...p,points:p.points.map(q=>rotatePoint(q,angle))})),b=bounds([{isHole:false,points:rotated.flatMap(p=>p.points)}]);
  return {id,paths:rotated.map(p=>({...p,points:p.points.map(q=>({x:q.x-b.minX,y:q.y-b.minY}))})),width:b.width,height:b.height,orientation:angle,compensated:false};
}
export function syntheticGaugeGap(fullKerf:number,length=80){const cavityWidth=length+fullKerf,barWidth=length/GAUGE_BARS-fullKerf;return cavityWidth-GAUGE_BARS*barWidth;}
export function createFitCoupons(stock:MaterialThicknessPreset,s:SliceSettings,step=.1,perpendicular=true):Coupon[]{
  const clearance=s.mode==="finger_box"?boxSettings(s).jointTolerance:s.slotFitTolerance,strip=createCalibrationStrip(stock,stock.thickness+clearance,step);
  return (perpendicular?[0,90]:[0]).map(angle=>{const nominal=strip.nominal.map(l=>({...l,points:l.points.map(q=>rotatePoint(q,angle))})),cut=compensate(nominal,stock.kerfX??stock.laserKerf,stock.kerfY??stock.laserKerf),b=bounds(cut),id=`JOINT-FIT-${angle===0?"X":"Y"}`;
    const paths:Toolpath[]=cut.map(l=>({points:l.points,closed:true,layer:l.isHole?"CUT_INTERIOR":"CUT_OUTLINE",operation:l.isHole?"interior":"exterior",pieceId:id}));
    paths.push(...strip.paths.filter(p=>p.layer==="ETCH_LABELS").map(p=>({...p,points:p.points.map(q=>rotatePoint(q,angle)),pieceId:id})));
    return {id,paths:paths.map(p=>({...p,points:p.points.map(q=>({x:q.x-b.minX,y:q.y-b.minY}))})),width:b.width,height:b.height,orientation:angle,compensated:true};
  });
}
export function representativeJoint(stock:MaterialThicknessPreset,s:SliceSettings):Coupon{
  const fit=s.mode==="finger_box"?boxSettings(s).jointTolerance:s.slotFitTolerance,t=stock.thickness,id=`CHECK-${s.mode}`,w=s.mode==="finger_box"?boxSettings(s).fingerWidth:20;
  // Actual current-mode dimensions: edge half-lap notch, closed pin-sized slot,
  // or shell wall tab projecting by the mating cap thickness.
  let left:Path2DLoop[],right:Path2DLoop[];
  if(s.mode==="finger_box"){
    const joint=fingerJointSpan(8,8+w,fit);
    if(joint.maleEnd<=joint.maleStart||joint.slotEnd<=joint.slotStart||t+fit<=0)throw new Error("The CHECK joint has no usable tab or opening. Increase finger width/thickness or reduce clearance.");
    const tab=rectangle(joint.maleStart,25-.002,joint.maleEnd-joint.maleStart,t+.002);left=booleanPaths([rectangle(0,0,w+16,25),tab],[],"union");
    const slot=rectangle(w+26+joint.slotStart,10,joint.slotEnd-joint.slotStart,t+fit);
    right=booleanPaths([rectangle(w+26,0,w+16,32)],fingerJointRelief(slot,Math.max(.02,stock.laserKerf/2),boxSettings(s).cornerStyle),"difference");
  }else if(s.mode==="stacked"){
    const side=Math.max(30,s.pinDiameter+12,t+12);
    if(s.alignmentPinType==="material"){
      left=[rectangle(0,0,side,side),rectangle((side-s.pinDiameter-fit)/2,(side-t-fit)/2,s.pinDiameter+fit,t+fit,true)];right=[rectangle(side+10,0,s.pinDiameter,side)];
    }else{
      left=booleanPaths([rectangle(0,0,side,side)],[circle({x:side/2,y:side/2},s.pinDiameter/2)],"difference");right=booleanPaths([rectangle(side+10,0,side,side)],[circle({x:side+10+side/2,y:side/2},s.pinDiameter/2)],"difference");
    }
  }else{
    left=booleanPaths([rectangle(0,0,30,36)],[rectangle(15-(t+fit)/2,18,t+fit,20)],"difference");
    right=booleanPaths([rectangle(40,0,30,36)],[rectangle(55-(t+fit)/2,-2,t+fit,20)],"difference");
  }
  const cut=compensate([...left,...right],stock.kerfX??stock.laserKerf,stock.kerfY??stock.laserKerf),b=bounds(cut),paths:Toolpath[]=cut.map(l=>({points:l.points,closed:true,layer:l.isHole?"CUT_INTERIOR":"CUT_OUTLINE",operation:l.isHole?"interior":"exterior",pieceId:id}));
  label(paths,`CHECK ${stock.id}`,15,6,id,2);return {id,paths:paths.map(p=>({...p,points:p.points.map(q=>({x:q.x-b.minX,y:q.y-b.minY}))})),width:b.width,height:b.height,orientation:0,compensated:true,nominal:[...left,...right]};
}
export function layoutCoupons(coupons:Coupon[]){
  // Each test gets its own artboard, including the etching extent. The machine
  // bed and production nesting margin do not change calibration drawing size.
  return coupons.map(c=>{
    const b=bounds([{isHole:false,points:c.paths.flatMap(p=>p.points)}]);
    return {width:b.width+2*CALIBRATION_BORDER_MM,height:b.height+2*CALIBRATION_BORDER_MM,couponIds:[c.id],paths:c.paths.map(p=>({...p,points:p.points.map(q=>({x:q.x-b.minX+CALIBRATION_BORDER_MM,y:q.y-b.minY+CALIBRATION_BORDER_MM}))}))};
  });
}
function instructions(stage:"measure"|"fit",stock:MaterialThicknessPreset,s:SliceSettings,slots:number[]){
  const p=new VectorPage(612,792,`MakeSlice ${stage==="measure"?"cut-width measurement":"joint fit"} instructions`);
  p.rect(0,0,612,792,"#ffffff");p.image(BRAND_PRINT_IMAGE,36,20,24,24);p.text("WHAT MAKE ART / MakeSlice",70,38,12,true,"#317466");p.rect(36,54,25,25,"#317466");p.text(stage==="measure"?"1":"2",48.5,73,19,true,"#ffffff","center");p.text(stage==="measure"?"Measure laser cut width":"Choose joint fit",70,74,22,true);
  p.text(`${stock.id} · ${stock.name.slice(0,42)} · measured ${stock.thickness} mm`,36,99,10);p.text(`Date: ${new Date().toISOString().slice(0,10)}   Test artboards: artwork + 20 mm border per side`,36,116,10);
  const lines=stage==="measure"?[
    "Cut the RAW SVG or DXF at 1:1 in millimeters. All CAM offsets = ZERO.",
    "Etch the blue numbers, then cut green cavity/shared lines and red frame.",
    "Keep all 19 numbered bars in order. Remove char/debris without sanding.",
    "Pack the bars together against the LEFT inner wall of their matching frame.",
    "Keep bars parallel and flush; do not leave gaps between them.",
    "Measure the gap at the RIGHT inner wall with calipers, in millimeters.",
    "Full cut width = measured gap / 20. One-sided CAM offset = gap / 40.",
    "The cavity gains one kerf; the 19 bars lose 19 kerfs. Total factor = 20.",
    "Do not measure against nominal 80 mm: that setup has a different factor.",
    "Repeat for X and Y; optionally compare 45°. Apply the reading to this stock.",
    "Re-test the same coupon three times; record min/max and repeatability.",
    "These equations model ideal cuts. Validate actual stock and a joint sample.",
  ]:[
    "First measure and apply the full kerf using the RAW measurement coupon.",
    "Fit files are already compensated by MakeSlice. Extra CAM offsets = ZERO.",
    "Import one SVG or DXF copy at 1:1 mm. Etch blue, then cut green/red.",
    "Try a measured edge of the mating stock in each labeled opening.",
    "Do not force the fit or crush cardboard flutes. Select the opening in the app.",
    "Joint clearance = selected finished opening minus measured stock thickness.",
    "For shell mode this updates box fit; for ribs/layers it updates joint clearance.",
    "Cut the CHECK pair from this kit to validate the active construction joint.",
    "For mixed stock, test both mating thicknesses and each cutting stock.",
    "Orientation, char, moisture and compressibility can change the actual fit.",
    "A fine comb is useful only when repeated cuts support its smaller step.",
    "This test does not qualify a living hinge's strength, fatigue or bend radius.",
  ];lines.forEach((line,i)=>p.text(`${i+1}. ${line}`,36,150+i*21,9));
  if(stage==="measure"){
    const x=70,y=444,w=400,h=120;p.rect(x-20,y-20,w+40,h+40,"#f1f5f9","#374151");p.rect(x,y,w,h,"#ffffff","#374151");for(let i=0;i<19;i++)p.rect(x+i*19,y,19,h,"#d9be8b","#64748b");
    p.line({x:x+w-38,y:y+60},{x:x+w-2,y:y+60},"#d83d45",2);p.text("READ THIS GAP",x+w-25,y+h+40,10,true,"#b4232b","center");p.text("PACK LEFT",x+60,y-34,10,true);p.text("Diagram enlarged; not a cutting template",36,647,10);
    p.text("Gauge ID: MS-CAVITY-19-V1 / 19 bars / N = 20",36,672,11,true);
    p.text("2.3 mm gap ÷ 20 = 0.115 mm full kerf; half = 0.0575 mm offset",36,695,10);
  }else{
    p.text("FINISHED OPENING       CLEARANCE VS MEASURED STOCK",36,427,10,true);slots.forEach((v,i)=>p.text(`${v.toFixed(3)} mm                      ${(v-stock.thickness).toFixed(3)} mm`,36,449+i*17,10));
    p.text(`Full kerf applied: ${stock.laserKerf} mm · directional ${stock.kerfX??stock.laserKerf} / ${stock.kerfY??stock.laserKerf} mm`,36,654,10);
    p.text("Choose the tested slot in MakeSlice to calculate clearance automatically.",36,677,10);
  }
  p.line({x:36,y:735},{x:576,y:735},"#b6c3cc");p.text("PAPER INSTRUCTIONS ONLY. Drawings are schematic, not 1:1 cut templates.",36,756,9,true);p.text("Laser geometry: use the separate SVG/DXF files in millimeters at original size.",36,773,9);
  return {pdf:vectorPDF([p],p.title),svg:p.svg()};
}
export function exportCalibrationKit(stage:"measure"|"fit",stock:MaterialThicknessPreset,s:SliceSettings,options:{diagonal?:boolean;step?:number;perpendicular?:boolean}={}){
  validateSettings({...s,sheetWidth:900,sheetHeight:600,sheetMargin:0,partSpacing:0});const step=options.step??.1,clearance=s.mode==="finger_box"?boxSettings(s).jointTolerance:s.slotFitTolerance;
  const slots=Array.from({length:11},(_,i)=>Number((stock.thickness+clearance+(i-5)*step).toFixed(6)));
  const coupons=stage==="measure"?[createKerfGauge(0),createKerfGauge(90),...(options.diagonal?[createKerfGauge(45)]:[])]:[...createFitCoupons(stock,s,step,options.perpendicular!==false),representativeJoint(stock,s)];
  const sheets=layoutCoupons(coupons),files:Record<string,Uint8Array>={},base=`MakeSlice_${stage==="measure"?"RAW_Kerf_Measurement":"Joint_Fit_Test"}_${stock.id}`,print=instructions(stage,stock,s,slots);
  sheets.forEach((sheet,i)=>{const name=`${base}_Sheet_${String(i+1).padStart(2,"0")}`;files[`${name}.svg`]=strToU8(svgDrawing(sheet.paths,sheet.width,sheet.height,name,stage==="measure"?`RAW UNCOMPENSATED; zero CAM offsets. Gauge ${GAUGE_VERSION}; 19 packed bars in matching cavity; factor 20. X is width across machine X from vertical lines.`:"Finished openings. MakeSlice already compensated; extra CAM offsets zero."));files[`${name}.dxf`]=strToU8(drawingDXF(sheet.paths,sheet.width,sheet.height));});
  files["Instructions.pdf"]=print.pdf;files["Instructions.svg"]=strToU8(print.svg);
  files["calibration-metadata.json"]=strToU8(JSON.stringify({stage,gaugeVersion:stage==="measure"?GAUGE_VERSION:"MS-FIT-V2",effectiveCuts:stage==="measure"?EFFECTIVE_CUTS:undefined,barCount:stage==="measure"?GAUGE_BARS:undefined,measurementSetup:"19 bars packed against LEFT inner wall of matching cut cavity; gap at RIGHT wall",units:"mm",stock,date:new Date().toISOString(),fullKerfMm:stage==="measure"?0:stock.laserKerf,compensationApplied:stage==="fit",compensationOwner:stage==="fit"?"MakeSlice":"none",CAMOffsetMm:0,stepMm:step,finishedSlotsMm:stage==="fit"?slots:undefined,sheets:sheets.map(s=>s.couponIds),artboardBorderMm:CALIBRATION_BORDER_MM,artboards:sheets.map(s=>({couponIds:s.couponIds,widthMm:s.width,heightMm:s.height})),directionModel:stock.kerfX!==undefined?"ellipse in machine coordinates, mitered corners; empirical approximation":"isotropic"},null,2));
  files["README.txt"]=strToU8(`MakeSlice ${stage} calibration kit\nRead Instructions.pdf. Laser drawings and paper instructions are separate. All additional CAM kerf offsets must be ZERO.\n${stage==="measure"?`${GAUGE_VERSION}: 19 bars, matching cavity, gap=(19+1)*fullKerf. Do not use a nominal-length reading.`:"Labeled sizes are desired finished openings. Use an actual material edge, then test the active-mode CHECK joint pair."}\nSVG and DXF test artboards include a 20 mm blank border on each side of the artwork. Import at original size; the border is not a cutting path.\n`);
  return {filename:`${base}.zip`,data:zipSync(files,{level:6}),sheets,slots,coupons};
}
