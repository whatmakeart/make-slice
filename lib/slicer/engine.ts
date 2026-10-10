import type { Axis, Issue, Joint, LaserCutPiece, MeshData, Path2DLoop, Point2D, SliceResult, SliceSettings } from "./types";
import { meshBounds } from "./stl";
import { section } from "./section";
import { booleanPaths, bounds, circle, EPS, inLoop, inMaterial, interiorPoint, materialArea, offsetPaths, perimeter, pointClearance, scanIntervals, splitComponents } from "./polygons";
import { vectorLabel } from "./labels";
import { nestPieces } from "./nesting";
import { materialPin, pinHole } from "./material-pins";
import { materialFor, materials, boxSettings } from "./materials";
import { buildFingerBox } from "./finger-box";

export function validateSettings(s:SliceSettings):void{
  const ranges:Partial<Record<keyof SliceSettings,[number,number]>>={targetWidth:[1,10000],targetDepth:[1,10000],targetHeight:[1,10000],materialThickness:[.1,100],laserKerf:[0,5],slotFitTolerance:[-2,5],leadInChamfer:[0,20],xSliceCount:[1,100],ySliceCount:[1,100],slotDepthRatio:[.1,.9],pinDiameter:[.5,100],pinCount:[1,5],sheetWidth:[20,5000],sheetHeight:[20,5000],sheetMargin:[0,500],partSpacing:[0,100]};
  for(const [key,[min,max]] of Object.entries(ranges)){const n=s[key as keyof SliceSettings];if(typeof n!=="number"||!Number.isFinite(n)||n<min||n>max)throw new Error(`${key.replace(/([A-Z])/g," $1")} must be between ${min} and ${max}.`);}
  for(const key of ["xSliceCount","ySliceCount","pinCount"] as const)if(!Number.isInteger(s[key]))throw new Error("Slice and pin counts must be whole numbers.");
  if(!["interlocking","stacked","finger_box"].includes(s.mode)||!["X","Y","Z"].includes(s.stackedAxis)||!["X","Y","Z"].includes(s.scaleAxis))throw new Error("Invalid slicing mode or axis.");
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
  check(s.skipTopLayersCount||0,0,400,"Unperforated top layers",true);
  if((s.scrapSheets?.length||0)>50)throw new Error("Use at most 50 scrap entries.");
  const scrapIds=new Set<string>();
  for(const scrap of s.scrapSheets||[]){if(!scrap.id||scrapIds.has(scrap.id)||!["T1","T2","T3"].includes(scrap.thicknessId))throw new Error("Scraps need unique IDs and an existing thickness slot.");scrapIds.add(scrap.id);check(scrap.width,20,5000,"Scrap width");check(scrap.height,20,5000,"Scrap height");check(scrap.quantity,1,100,"Scrap quantity",true);}
  const f=boxSettings(s),b=f.bracing;
  check(f.fingerWidth,2,200,"Finger width");check(f.jointTolerance,-1,3,"Box fit");check(f.chordalError,.05,15,"Curve deviation");check(f.livingHingeSlitLength,3,100,"Hinge slit length");check(f.livingHingeGap,1,10,"Hinge pitch");
  if(!["sharp","dogbone","round"].includes(f.cornerStyle)||!["facets","living_hinge"].includes(f.curveHandling))throw new Error("Invalid box corner or curve setting.");
  if(!["auto","X","Y","Z"].includes(f.extrusionAxis||"auto")||!["auto","extrusion","bands"].includes(f.shellConstruction||"auto"))throw new Error("Invalid shell construction or extrusion axis.");
  check(f.bandHeight??30,8,200,"Maximum band height");check(f.bandDeviation??3,.25,25,"Band profile deviation");
  if(f.adaptiveBands!==undefined&&typeof f.adaptiveBands!=="boolean")throw new Error("Adaptive bands must be true or false.");
  check(b.maxUnsupportedSpan,10,1000,"Maximum span");check(b.spacing,10,1000,"Brace spacing");check(b.tenonWidth,2,100,"Brace tab width");check(b.tenonDepthRatio,.1,1,"Brace depth ratio");check(b.tenonCountPerEdge,1,8,"Tabs per edge",true);check(b.slotFitTolerance,-1,3,"Brace fit");check(b.cornerReliefSize,0,20,"Brace corner relief");
  if(!["auto","transverse","longitudinal","grid"].includes(b.mode)||!["through_tenon","blind_notch","tab_and_slot"].includes(b.jointType)||!["T1","T2","T3"].includes(b.braceThicknessId))throw new Error("Invalid bracing setting.");

}
interface Layer {id:string;axis:Axis;index:number;position:number;raw:Path2DLoop[];cuts:Path2DLoop[];material:ReturnType<typeof materialFor>}
function slot(u:number,lo:number,hi:number,mid:number,top:boolean,width:number,chamfer:number,cap:number):Path2DLoop{
  const h=width/2,c=Math.min(chamfer,(hi-lo)*.15,(top?hi-mid:mid-lo)*.45),p=top?[
    [u-h,mid],[u+h,mid],[u+h,hi-c],[u+h+c,hi],[u+h+c,cap],[u-h-c,cap],[u-h-c,hi],[u-h,hi-c]
  ]:[
    [u-h-c,cap],[u+h+c,cap],[u+h+c,lo],[u+h,lo+c],[u+h,mid],[u-h,mid],[u-h,lo+c],[u-h-c,lo]
  ];
  return {isHole:false,points:p.map(([x,y])=>({x,y}))};
}
function pinLocations(layers:Layer[],s:SliceSettings):Point2D[]{
  let shared=layers[0]?.raw||[];
  for(let i=1;i<layers.length&&shared.length;i++)shared=booleanPaths(shared,layers[i].raw,"intersection");
  const radius=s.alignmentPinType==="material"?Math.hypot(s.pinDiameter+s.slotFitTolerance,s.materialThickness+s.slotFitTolerance)/2:s.pinDiameter/2;
  const safe=offsetPaths(shared,-(radius+Math.max(s.materialThickness,2)));
  if(!safe.length)return [];
  const b=bounds(safe),candidates:Point2D[]=[];
  for(let x=0;x<29;x++)for(let y=0;y<29;y++){const p={x:b.minX+(x+.5)*b.width/29,y:b.minY+(y+.5)*b.height/29};if(inMaterial(p,safe))candidates.push(p);}
  for(const comp of splitComponents(safe))candidates.push(interiorPoint(comp).point);
  const selected:Point2D[]=[];
  while(selected.length<s.pinCount&&candidates.length){
    let best=-1,score=-Infinity;
    candidates.forEach((p,i)=>{const d=selected.length?Math.min(...selected.map(q=>Math.hypot(p.x-q.x,p.y-q.y))):s.pinCount>1?Math.hypot(p.x-(b.minX+b.maxX)/2,p.y-(b.minY+b.maxY)/2):pointClearance(p,safe);if(selected.length&&d<s.pinDiameter+2*s.materialThickness)return;if(d>score){score=d;best=i;}});
    if(best<0)break;selected.push(candidates.splice(best,1)[0]);
  }return selected;
}
export function sliceMesh(mesh:MeshData,s:SliceSettings,onProgress?:(p:import("./types").SlicingProgress)=>void):SliceResult{
  onProgress?.({stage:"geometry",completed:0,total:1,percent:0});
  const started=performance.now();validateSettings(s);
  const issues:Issue[]=[];
  const issue=(code:string,severity:Issue["severity"],message:string,ids:string[]=[])=>{
    let existing=issues.find(i=>i.code===code);if(!existing){existing={code,severity,message,partIds:[]};issues.push(existing);}for(const id of ids)if(!existing.partIds!.includes(id))existing.partIds!.push(id);
  };
  if(mesh.info.boundaryEdges||mesh.info.nonManifoldEdges)issue("mesh-topology","warning",`Mesh has ${mesh.info.boundaryEdges.toLocaleString()} open edges and ${mesh.info.nonManifoldEdges.toLocaleString()} non-manifold edges. Repair the STL for reliable sections.`);
  const b=meshBounds(mesh.vertices),targets=[s.targetWidth,s.targetDepth,s.targetHeight],anchor=s.scaleAxis==="X"?0:s.scaleAxis==="Y"?1:2;
  const factors=s.keepAspectRatio?b.dimensions.map(()=>targets[anchor]/b.dimensions[anchor]):targets.map((t,i)=>t/b.dimensions[i]);
  const dim=b.dimensions.map((n,i)=>n*factors[i]) as [number,number,number];
  const v=new Float64Array(mesh.vertices.length);for(let i=0;i<v.length;i++)v[i]=(mesh.vertices[i]-b.min[i%3])*factors[i%3];
  if(s.mode==="finger_box"){
    const pieces=buildFingerBox(v,dim,s,issue),nesting=nestPieces(pieces,s,onProgress);
    if(nesting.unplaced.length)issue("oversize-parts","error","Some parts do not fit the usable sheet area. Increase the sheet size, reduce margins/spacing, or scale the model down.",nesting.unplaced);
    if(!pieces.length)issue("no-pieces","error","No shell could be generated. Check the model topology, construction settings, size, and stock thickness.");
    const bandAxis=boxSettings(s).extrusionAxis,depthIndex=bandAxis==="X"?0:bandAxis==="Y"?1:2;
    return {model:mesh.info,dimensions:dim,vertices:new Float32Array(v),settings:structuredClone(s),pieces,...nesting,joints:[],pins:[],issues,processingMs:performance.now()-started,layerCount:new Set(pieces.filter(p=>p.category!=="box_cap"&&p.shellMethod==="contour_bands").map(p=>p.bandIndex)).size,builtDepth:dim[depthIndex]};
  }
  const layers:Layer[]=[],joints:Joint[]=[];let layerCount=0,builtDepth=0;
  const addLayer=(axis:Axis,index:number,position:number,sample=position)=>{
    const id=`${axis}-${String(index+1).padStart(2,"0")}`;const res=section(v,axis,sample);
    if(res.open||res.branches)issue("open-contours","error","Some sections have open or branching contours and were omitted. DXF can export the generated parts; repair the STL for complete sections.",[id]);
    if(res.loops.length)layers.push({id,axis,index,position,raw:res.loops,cuts:[],material:materialFor(s,id)});
    else issue("empty-sections","warning","Some slicing planes have no closed material contour.",[id]);
  };
  if(s.mode==="interlocking"){
    for(const [axis,count,d] of [["X",s.xSliceCount,dim[0]],["Y",s.ySliceCount,dim[1]]] as const){
      const gap=d/(count+1);
      if(gap<s.materialThickness)issue("slice-collision","error",`${axis} ribs overlap. Reduce the slice count or material thickness.`);
      else if(gap<s.materialThickness*1.5)issue("tight-spacing","warning",`${axis} ribs are closely spaced. Check the material remaining between slots.`);
      for(let i=0;i<count;i++)addLayer(axis,i,(i+1)*gap);
    }
    const xs=layers.filter(l=>l.axis==="X"),ys=layers.filter(l=>l.axis==="Y");
    for(const x of xs)for(const y of ys){
      if(y.material.thickness+s.slotFitTolerance<=x.material.laserKerf+EPS||x.material.thickness+s.slotFitTolerance<=y.material.laserKerf+EPS){issue("mixed-slot-kerf","error","A mating slot is smaller than the cutting stock kerf. Increase its mating thickness/tolerance or reduce kerf.",[x.id,y.id]);continue;}
      const a=scanIntervals(x.raw,y.position),bb=scanIntervals(y.raw,x.position),overlaps:[number,number][]=[];
      for(const [al,ah] of a)for(const [bl,bh] of bb){const lo=Math.max(al,bl),hi=Math.min(ah,bh);if(hi-lo>EPS)overlaps.push([lo,hi]);}
      if(overlaps.length>1)issue("multi-span-joints","warning","Some joints cross hollow or concave regions. Check that each slot is accessible during assembly.",[x.id,y.id]);
      for(let k=0;k<overlaps.length;k++){
        const [lo,hi]=overlaps[k];if(hi-lo<=2*s.materialThickness||(hi-lo)*Math.min(s.slotDepthRatio,1-s.slotDepthRatio)<s.materialThickness){issue("short-joints","warning","Short intersections were left unslotted to avoid fragile joints.",[x.id,y.id]);continue;}
        // Both slots meet at exactly the same height, including a non-50% split.
        const mid=hi-(hi-lo)*s.slotDepthRatio;
        const prevHi=k?overlaps[k-1][1]:-s.materialThickness,nextLo=k+1<overlaps.length?overlaps[k+1][0]:dim[2]+s.materialThickness;
        const topCap=(hi+nextLo)/2+EPS,bottomCap=(lo+prevHi)/2-EPS;
        // Extend to the surface over the entire slot width, while isolating each span.
        x.cuts.push(slot(y.position,lo,hi,mid,true,y.material.thickness+s.slotFitTolerance,s.leadInChamfer,overlaps.length===1?dim[2]+1:topCap));
        y.cuts.push(slot(x.position,lo,hi,mid,false,x.material.thickness+s.slotFitTolerance,s.leadInChamfer,overlaps.length===1?-1:bottomCap));
        joints.push({a:x.id,b:y.id,x:x.position,y:y.position,z:mid});
      }
    }
  }else{
    const a=s.stackedAxis==="X"?0:s.stackedAxis==="Y"?1:2;
    const physical:{center:number;thickness:number}[]=[];
    let depth=0;
    for(let i=0;i<401;i++){
      const m=materialFor(s,`${s.stackedAxis}-${String(i+1).padStart(2,"0")}`),t=m.thickness;
      if(i>0&&depth+t/2>dim[a]+EPS)break;
      physical.push({center:depth+t/2,thickness:t});depth+=t;
    }
    layerCount=physical.length;builtDepth=depth;
    if(layerCount>400)throw new Error("This stack needs more than 400 layers. Increase material thickness or reduce model size.");
    physical.forEach((l,i)=>addLayer(s.stackedAxis,i,l.center,l.center*dim[a]/builtDepth));
    if(Math.abs(builtDepth-dim[a])>.001)issue("rounded-stack","warning",`Stack depth is rounded to ${builtDepth.toFixed(2)} mm (${layerCount} layers at their assigned thicknesses).`);
  }
  // A component reassignment belongs to its whole cutting plane so opposite slots remain consistent.
  if(s.mode==="interlocking")for(const axis of ["X","Y"] as const){
    const family=layers.filter(l=>l.axis===axis);
    for(let i=1;i<family.length;i++)if(family[i].position-family[i-1].position<(family[i].material.thickness+family[i-1].material.thickness)/2-EPS)issue("slice-collision","error",`${axis} ribs overlap. Reduce the slice count or material thickness.`,[family[i-1].id,family[i].id]);
  }
  const cutoff=Math.max(0,layerCount-(s.skipTopLayersCount||0));
  const pinLayers=layers.filter(l=>l.index<cutoff);
  const pins=s.mode==="stacked"&&s.alignmentPins&&pinLayers.length?pinLocations(pinLayers,s):[];
  if(s.mode==="stacked"&&s.alignmentPins&&pinLayers.length&&pins.length<s.pinCount)issue("pin-placement","warning",pins.length?`Only ${pins.length} pin positions fit through all perforated layers with a material margin.`:"No safe pin position passes through the perforated layers. Pins were omitted; use adhesive or external registration.");
  if(pins.length)for(const l of pinLayers)l.cuts.push(...pins.map(p=>s.alignmentPinType==="material"?pinHole(p,s):circle(p,s.pinDiameter/2)));

  const pieces:LaserCutPiece[]=[];
  for(const l of layers){
    const nominal=l.cuts.length?booleanPaths(l.raw,l.cuts,"difference"):l.raw;
    const components=splitComponents(nominal).filter(c=>{if(materialArea(c)>=2)return true;issue("micro-islands","warning","Tiny components below 2 mm² were omitted.",[l.id]);return false;});
    if(components.length>1)issue("split-components","warning","Disconnected regions are exported as separate labeled parts. Inspect their assembly connections.",[l.id]);
    if(!components.length)issue("removed-pieces","warning","Slots removed all usable material from some slices.",[l.id]);
    components.forEach((paths,k)=>{
      const suffix=components.length>1?`-${k<26?String.fromCharCode(65+k):k+1}`:"",id=l.id+suffix;
      const cut=offsetPaths(paths,l.material.laserKerf/2);
      if(cut.filter(p=>p.isHole).length<paths.filter(p=>p.isHole).length)issue("vanishing-holes","warning","A hole is smaller than the kerf and disappeared. Reduce kerf or increase feature size.",[id]);
      if(!cut.length){issue("collapsed-path","error","Kerf compensation removed an entire part.",[id]);return;}
      for(const path of cut)if(path.isHole&&pins.some(p=>inLoop(p,path.points)))path.isRegistration=true;
      const location=interiorPoint(paths),p=location.point;
      const raw=splitComponents(l.raw).find(c=>inMaterial(p,c))||l.raw;
      const etch=vectorLabel(id,paths,location);
      if(!etch.length)issue("small-labels","warning","Some narrow parts have no room for an etched label. Match them using the assembly preview.",[id]);
      pieces.push({id,label:id,parentId:l.id,axis:l.axis,sliceIndex:l.index,worldPosition:l.position,unmodifiedPaths:raw,assemblyPaths:paths,cutPaths:cut,etchPaths:etch,bounds:bounds(cut),area:materialArea(paths),cutLength:perimeter(cut),joints:[],category:s.mode==="stacked"?"stacked_layer":"rib",assignedThicknessId:l.material.id,thickness:l.material.thickness,kerf:l.material.laserKerf,interiorRegions:l.cuts});
    });
  }
  const actualJoints:Joint[]=[];
  for(const j of joints){
    const pa=pieces.find(p=>p.parentId===j.a&&inMaterial({x:j.y,y:j.z-.1},p.assemblyPaths));
    const pb=pieces.find(p=>p.parentId===j.b&&inMaterial({x:j.x,y:j.z+.1},p.assemblyPaths));
    if(pa&&pb){pa.joints.push(pb.id);pb.joints.push(pa.id);actualJoints.push({...j,a:pa.id,b:pb.id});
      for(const [p,u,direction] of [[pa,j.y,-1],[pb,j.x,1]] as const){
        for(const side of [-1,1]){const a={x:u+side*((p===pa?pb.thickness:pa.thickness)!+s.slotFitTolerance)/2+side*.7,y:j.z+direction*.9},b={x:a.x+side*1.4,y:a.y};if(pointClearance(a,p.assemblyPaths)>.2&&pointClearance(b,p.assemblyPaths)>.2)p.etchPaths.push({points:[a,b]});}
      }
    }else issue("incomplete-joints","warning","Some joints lost their supporting material during slot subtraction.",[j.a,j.b]);
  }
  if(s.mode==="interlocking"){
    const isolated=pieces.filter(p=>!p.joints.length).map(p=>p.id);
    if(isolated.length)issue("unanchored-parts","warning","Some parts have no usable interlock. They need support or adhesive.",isolated);
    const seen=new Set<string>();let groups=0;const byId=new Map(pieces.map(p=>[p.id,p]));
    for(const p of pieces){if(seen.has(p.id))continue;groups++;const queue=[p.id];seen.add(p.id);for(let i=0;i<queue.length;i++)for(const next of byId.get(queue[i])!.joints)if(!seen.has(next)){seen.add(next);queue.push(next);}}
    if(groups>1)issue("separate-assemblies","warning",`The joint graph contains ${groups} separate assemblies. Review how they are supported.`);
  }else if(pins.length){
    const unsupported=pieces.filter(p=>p.sliceIndex<cutoff&&!p.cutPaths.some(l=>l.isRegistration)).map(p=>p.id);
    if(unsupported.length)issue("unpinned-components","warning","Some stacked components contain no registration pin. Use adhesive and position them by the preview.",unsupported);
  }
  if(!pieces.length)issue("no-pieces","error","No usable parts were generated. Try fewer slices, a thicker stack, or a closed mesh.");
  else if(s.mode==="stacked"&&s.alignmentPinType==="material"&&pins.length)pieces.unshift(...pins.map((p,i)=>materialPin(p,i,cutoff<layerCount?layers.filter(l=>l.index<cutoff).reduce((n,l)=>n+l.material.thickness,0):builtDepth,s)));
  const nesting=nestPieces(pieces,s,onProgress);
  if(nesting.unplaced.length)issue("oversize-parts","error","Some parts do not fit the usable sheet area. Increase the sheet size, reduce margins/spacing, or scale the model down.",nesting.unplaced);
  return {model:mesh.info,dimensions:dim,vertices:new Float32Array(v),settings:structuredClone(s),pieces,...nesting,joints:actualJoints,pins,issues,processingMs:performance.now()-started,layerCount,builtDepth};
}
