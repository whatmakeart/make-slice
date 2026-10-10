import type { SliceSettings } from "./types";
import { EPS } from "./polygons";
import { materials, boxSettings } from "./materials";

const plain=(x:unknown)=>!!x&&typeof x==="object"&&!Array.isArray(x);
const finite=(x:unknown,min:number,max:number,label:string)=>{if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)throw new Error(`${label} must be a finite number between ${min} and ${max}.`);};
const text=(x:unknown,label:string,max=120)=>{if(typeof x!=="string"||x.length>max)throw new Error(`${label} must be text of at most ${max} characters.`);};
function validateShape(s:SliceSettings){
  if(!plain(s))throw new Error("Build settings must be an object.");
  for(const key of ["keepAspectRatio","alignmentPins","allowRotation"] as const)if(typeof s[key]!=="boolean")throw new Error(`${key} must be true or false.`);
  if(s.materialPresets!==undefined&&!Array.isArray(s.materialPresets))throw new Error("Material presets must be an array.");
  if(s.scrapSheets!==undefined&&!Array.isArray(s.scrapSheets))throw new Error("Scrap inventory must be an array.");
  if(s.partThickness!==undefined){if(!plain(s.partThickness))throw new Error("Part stock assignments must be an object.");for(const [key,value] of Object.entries(s.partThickness)){text(key,"Part ID");if(["__proto__","constructor","prototype"].includes(key)||typeof value!=="string")throw new Error("Invalid part stock reference.");}}
  if(s.skipTopLayersCount!==undefined)finite(s.skipTopLayersCount,0,400,"Unperforated top layers");
  if(s.auditTolerance!==undefined)finite(s.auditTolerance,.001,1,"Cut audit tolerance");
  for(const m of s.materialPresets||[]){
    if(!plain(m))throw new Error("Each stock must be an object.");
    text(m.id,"Stock ID",20);text(m.name,"Stock name");finite(m.thickness,.1,100,`${m.id} measured thickness`);finite(m.laserKerf,0,5,`${m.id} full kerf`);
    if(typeof m.colorHex!=="string"||!/^#[0-9a-f]{6}$/i.test(m.colorHex))throw new Error("Stock display color must be a six-digit hex color.");
    if(m.hingeKFactor!==undefined)finite(m.hingeKFactor,0,1,"Hinge K factor");
    if(m.allowLivingHinges!==undefined&&typeof m.allowLivingHinges!=="boolean")throw new Error("Living hinge enablement must be true or false.");
    if(m.family!==undefined&&!["cardboard","plywood","acrylic","custom"].includes(m.family))throw new Error("Invalid material family.");
    for(const k of ["kerfX","kerfY"] as const)if(m[k]!==undefined)finite(m[k],0,5,`${m.id} ${k}`);
    if((m.kerfX===undefined)!==(m.kerfY===undefined))throw new Error("Directional calibration needs both kerf X and kerf Y.");
    if(m.kerfX!==undefined&&((m.kerfX===0)!==(m.kerfY===0)))throw new Error("Both directional cut widths must be positive, or both zero.");
    if(m.beamModel!==undefined&&m.beamModel!=="ellipse")throw new Error("The supported directional beam model is ellipse.");
    if(m.rotationConstraint!==undefined&&!["free","quarter_turn","half_turn","fixed"].includes(m.rotationConstraint))throw new Error("Invalid stock rotation constraint.");
    if(m.stockOrientation!==undefined&&!["machine_x","machine_y"].includes(m.stockOrientation))throw new Error("Choose stock direction along machine X or Y.");
    if(m.minimumWeb!==undefined)finite(m.minimumWeb,0,20,`${m.id} minimum web`);
    if(m.calibration!==undefined){
      const c=m.calibration;if(!plain(c))throw new Error("Calibration record must be an object.");
      text(c.id,"Calibration ID",80);text(c.gaugeVersion,"Gauge version",80);text(c.date,"Test date",80);if(!Number.isFinite(Date.parse(c.date)))throw new Error("Calibration needs a valid test date.");
      finite(c.fullKerfMm,0,5,"Recorded full kerf");finite(c.measuredThicknessMm,.1,100,"Recorded thickness");
      for(const k of ["kerfXmm","kerfYmm","kerf45mm"] as const)if(c[k]!==undefined)finite(c[k],0,5,k);
      if(c.gapMm!==undefined)finite(c.gapMm,0,100,"Measured gap");
      if(c.effectiveCuts!==undefined){finite(c.effectiveCuts,1,100,"Effective cut count");if(!Number.isInteger(c.effectiveCuts))throw new Error("Effective cut count must be an integer.");}
      for(const k of ["machineName","orientation","focus","speed","power","passes"] as const)if(c[k]!==undefined)text(c[k],`Calibration ${k}`);
    }
  }
  for(const scrap of s.scrapSheets||[])if(!plain(scrap))throw new Error("Each scrap sheet must be an object.");
  if(s.fingerBox!==undefined){
    if(!plain(s.fingerBox))throw new Error("Shell settings must be an object.");
    const f=s.fingerBox;
    if(f.bandHeight!==undefined)finite(f.bandHeight,8,200,"Maximum band height");
    if(f.bandDeviation!==undefined)finite(f.bandDeviation,.25,25,"Band profile deviation");
    if(f.extrusionAxis!==undefined&&!["auto","X","Y","Z"].includes(f.extrusionAxis))throw new Error("Invalid extrusion axis.");
    if(f.shellConstruction!==undefined&&!["auto","extrusion","bands"].includes(f.shellConstruction))throw new Error("Invalid shell construction.");
    if(f.bracing!==undefined&&!plain(f.bracing))throw new Error("Brace settings must be an object.");
    for(const key of ["enabled","eggCrateSlotted","lightningHoles"] as const)if(f.bracing?.[key]!==undefined&&typeof f.bracing[key]!=="boolean")throw new Error(`Brace ${key} must be true or false.`);
  }
}
export function validateSettings(s:SliceSettings):void{
  validateShape(s);
  const ranges:Partial<Record<keyof SliceSettings,[number,number]>>={targetWidth:[1,10000],targetDepth:[1,10000],targetHeight:[1,10000],materialThickness:[.1,100],laserKerf:[0,5],slotFitTolerance:[-2,5],leadInChamfer:[0,20],xSliceCount:[1,100],ySliceCount:[1,100],slotDepthRatio:[.1,.9],pinDiameter:[.5,100],pinCount:[1,5],sheetWidth:[20,5000],sheetHeight:[20,5000],sheetMargin:[0,500],partSpacing:[0,100]};
  for(const [key,[min,max]] of Object.entries(ranges)){const n=s[key as keyof SliceSettings];if(typeof n!=="number"||!Number.isFinite(n)||n<min||n>max)throw new Error(`${key.replace(/([A-Z])/g," $1")} must be between ${min} and ${max}.`);}
  for(const key of ["xSliceCount","ySliceCount","pinCount"] as const)if(!Number.isInteger(s[key]))throw new Error("Slice and pin counts must be whole numbers.");
  if(!["interlocking","stacked","finger_box"].includes(s.mode)||!["X","Y","Z"].includes(s.stackedAxis)||!["X","Y","Z"].includes(s.scaleAxis))throw new Error("Invalid slicing mode or axis.");
  if(s.mode==="interlocking"&&materials(s).filter(m=>m.id==="T1"||Object.values(s.partThickness||{}).includes(m.id)).some(a=>materials(s).filter(m=>m.id==="T1"||Object.values(s.partThickness||{}).includes(m.id)).some(b=>b.thickness+s.slotFitTolerance<=Math.max(a.laserKerf,a.kerfX??0,a.kerfY??0)+EPS)))throw new Error("A desired mating opening is no larger than the cutting stock kerf. Increase measured thickness/clearance or reduce full kerf.");
  if(s.materialThickness+s.slotFitTolerance<=s.laserKerf+EPS&&s.mode==="interlocking")throw new Error("The desired slot is smaller than the laser kerf. Increase thickness/tolerance or reduce kerf.");
  if(s.alignmentPins&&s.pinDiameter<=s.laserKerf+EPS&&s.mode==="stacked")throw new Error("Pin diameter must be larger than the laser kerf.");
  if(s.alignmentPinType!==undefined&&!["dowel","material"].includes(s.alignmentPinType))throw new Error("Choose dowels or pins cut from sheet material.");
  if(s.mode==="stacked"&&s.alignmentPins&&s.alignmentPinType==="material"&&Math.min(s.pinDiameter+s.slotFitTolerance,s.materialThickness+s.slotFitTolerance)<=s.laserKerf+EPS)throw new Error("The material-pin slot is smaller than the kerf. Increase pin width or fit tolerance, or reduce kerf.");
  if(s.sheetMargin*2>=Math.min(s.sheetWidth,s.sheetHeight))throw new Error("The margin leaves no usable sheet area.");
  if(s.nestingMode!==undefined&&!["polygon","rectangles"].includes(s.nestingMode))throw new Error("Choose polygon or rectangular nesting.");
  if(s.rotationStep!==undefined&&![90,15].includes(s.rotationStep))throw new Error("Rotation steps must be 90 or 15 degrees.");
  const check=(n:number,min:number,max:number,label:string,integer=false)=>{if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw new Error(`${label} must be ${integer?"a whole number ":""}between ${min} and ${max}.`);};
  for(const m of materials(s)){check(m.thickness,.1,100,`${m.id} thickness`);check(m.laserKerf,0,5,`${m.id} kerf`);check(m.hingeKFactor??.5,0,1,`${m.id} hinge K factor`);if(!["cardboard","plywood","acrylic","custom"].includes(m.family||"cardboard"))throw new Error("Choose cardboard, plywood, acrylic, or custom material.");if(!/^#[0-9a-f]{6}$/i.test(m.colorHex))throw new Error("Material colors must be hex colors.");}
  if(s.materialPresets&&(s.materialPresets.length>3||new Set(s.materialPresets.map(m=>m.id)).size!==s.materialPresets.length||s.materialPresets.some(m=>!["T1","T2","T3"].includes(m.id))))throw new Error("Use up to three unique material slots: T1, T2, T3.");
  for(const m of materials(s)){if(m.hingePitch!==undefined)check(m.hingePitch,1,10,`${m.id} hinge pitch`);if(m.hingeSlitLength!==undefined)check(m.hingeSlitLength,3,100,`${m.id} hinge slit length`);if(m.allowLivingHinges!==undefined&&typeof m.allowLivingHinges!=="boolean")throw new Error("Living hinge enablement must be true or false.");}
  for(const m of materials(s)){if(m.tintHex!==undefined&&!/^#[0-9a-f]{6}$/i.test(m.tintHex))throw new Error("Acrylic tints must be hex colors.");if(m.acrylicFinish!==undefined&&!["clear","frosted","smoke","green","black","white"].includes(m.acrylicFinish))throw new Error("Choose a listed acrylic finish.");}
  if(Object.values(s.partThickness||{}).some(id=>!["T1","T2","T3"].includes(id)))throw new Error("Every part must use T1, T2, or T3.");
  check(s.skipTopLayersCount??0,0,400,"Unperforated top layers",true);
  if((s.scrapSheets?.length||0)>50)throw new Error("Use at most 50 scrap entries.");
  const scrapIds=new Set<string>();
  for(const scrap of s.scrapSheets||[]){text(scrap.id,"Scrap ID",80);if(!scrap.id||scrapIds.has(scrap.id)||!["T1","T2","T3"].includes(scrap.thicknessId))throw new Error("Scraps need unique IDs and an existing thickness slot.");scrapIds.add(scrap.id);check(scrap.width,20,5000,"Scrap width");check(scrap.height,20,5000,"Scrap height");check(scrap.quantity,1,100,"Scrap quantity",true);}
  const f=boxSettings(s),b=f.bracing;
  check(f.fingerWidth,2,200,"Finger width");check(f.jointTolerance,-1,3,"Box fit");check(f.chordalError,.05,15,"Curve deviation");check(f.livingHingeSlitLength,3,100,"Hinge slit length");check(f.livingHingeGap,1,10,"Hinge pitch");
  if(!["sharp","dogbone","round"].includes(f.cornerStyle)||!["facets","living_hinge"].includes(f.curveHandling))throw new Error("Invalid box corner or curve setting.");
  if(!["auto","X","Y","Z"].includes(f.extrusionAxis??"auto")||!["auto","extrusion","bands"].includes(f.shellConstruction??"auto"))throw new Error("Invalid shell construction or extrusion axis.");
  check(f.bandHeight??30,8,200,"Maximum band height");check(f.bandDeviation??3,.25,25,"Band profile deviation");
  if(f.adaptiveBands!==undefined&&typeof f.adaptiveBands!=="boolean")throw new Error("Adaptive bands must be true or false.");
  check(b.maxUnsupportedSpan,10,1000,"Maximum span");check(b.spacing,10,1000,"Brace spacing");check(b.tenonWidth,2,100,"Brace tab width");check(b.tenonDepthRatio,.1,1,"Brace depth ratio");check(b.tenonCountPerEdge,1,8,"Tabs per edge",true);check(b.slotFitTolerance,-1,3,"Brace fit");check(b.cornerReliefSize,0,20,"Brace corner relief");
  if(!["auto","transverse","longitudinal","grid"].includes(b.mode)||!["through_tenon","blind_notch","tab_and_slot"].includes(b.jointType)||!["T1","T2","T3"].includes(b.braceThicknessId))throw new Error("Invalid bracing setting.");

}
