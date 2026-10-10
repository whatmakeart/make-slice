import type { Axis, Issue, Joint, LaserCutPiece, MeshData, Path2DLoop, Point2D, SliceResult, SliceSettings } from "./types";
import { meshBounds } from "./stl";
import { section } from "./section";
import { booleanPaths, bounds, circle, EPS, inLoop, inMaterial, interiorPoint, materialArea, offsetPaths, perimeter, pointClearance, scanIntervals, splitComponents } from "./polygons";
import { vectorLabel } from "./labels";
import { nestPiecesStages } from "./nesting";
import { bindStock } from "./beam";
import { checkResultStages } from "./cut-audit";
import { materialPin, pinHole } from "./material-pins";
import { materialFor, materials, boxSettings } from "./materials";
import { buildFingerBox } from "./finger-box";

export { validateSettings } from "./validation";
import { validateSettings } from "./validation";

const normalized=new WeakMap<MeshData,Map<string,Float64Array>>();
const sections=new WeakMap<Float64Array,Map<string,ReturnType<typeof section>>>();
function cachedSection(v:Float64Array,axis:Axis,sample:number){let cache=sections.get(v);if(!cache){cache=new Map();sections.set(v,cache);}const key=`${axis}/${sample}`;let value=cache.get(key);if(!value){value=section(v,axis,sample);if(cache.size>1600)cache.delete(cache.keys().next().value!);cache.set(key,value);}return value;}
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
export function* sliceMeshStages(mesh:MeshData,s:SliceSettings,onProgress?:(p:import("./types").SlicingProgress)=>void):Generator<void,SliceResult,void>{
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
  if(dim.some(n=>!Number.isFinite(n)||n>10000))throw new Error("Scaled model exceeds 10,000 mm on an axis. Reduce the size or unlock proportions and set each dimension.");
  let normalizedCache=normalized.get(mesh);if(!normalizedCache){normalizedCache=new Map();normalized.set(mesh,normalizedCache);}const scaleKey=JSON.stringify(factors);let v=normalizedCache.get(scaleKey);if(!v){v=new Float64Array(mesh.vertices.length);for(let i=0;i<v.length;i++){v[i]=(mesh.vertices[i]-b.min[i%3])*factors[i%3];if(i%150000===0)yield;}if(normalizedCache.size>=3)normalizedCache.delete(normalizedCache.keys().next().value!);normalizedCache.set(scaleKey,v);}
  if(s.mode==="finger_box"){
    yield;
    const pieces=bindStock(buildFingerBox(v,dim,s,issue),s),nesting=yield* nestPiecesStages(pieces,s,onProgress);
    if(nesting.unplaced.length)issue("oversize-parts","error","Some parts do not fit the usable sheet area. Increase the sheet size, reduce margins/spacing, or scale the model down.",nesting.unplaced);
    if(!pieces.length)issue("no-pieces","error","No shell could be generated. Check the model topology, construction settings, size, and stock thickness.");
    const bandAxis=boxSettings(s).extrusionAxis,depthIndex=bandAxis==="X"?0:bandAxis==="Y"?1:2;
    onProgress?.({stage:"checking",completed:0,total:1,percent:0});yield;
    return yield* checkResultStages({model:mesh.info,dimensions:dim,vertices:new Float32Array(v),settings:structuredClone(s),pieces,...nesting,joints:[],pins:[],issues,processingMs:performance.now()-started,layerCount:new Set(pieces.filter(p=>p.category!=="box_cap"&&p.shellMethod==="contour_bands").map(p=>p.bandIndex)).size,builtDepth:dim[depthIndex]});
  }
  const layers:Layer[]=[],joints:Joint[]=[];let layerCount=0,builtDepth=0;
  const addLayer=(axis:Axis,index:number,position:number,sample=position)=>{
    const id=`${axis}-${String(index+1).padStart(2,"0")}`;const res=cachedSection(v!,axis,sample);
    if(res.open||res.branches)issue("open-contours","error","Some sections have open or branching contours and were omitted. DXF can export the generated parts; repair the STL for complete sections.",[id]);
    if(res.loops.length)layers.push({id,axis,index,position,raw:res.loops,cuts:[],material:materialFor(s,id)});
    else issue("empty-sections","warning","Some slicing planes have no closed material contour.",[id]);
  };
  if(s.mode==="interlocking"){
    for(const [axis,count,d] of [["X",s.xSliceCount,dim[0]],["Y",s.ySliceCount,dim[1]]] as const){
      const gap=d/(count+1);
      if(gap<s.materialThickness)issue("slice-collision","error",`${axis} ribs overlap. Reduce the slice count or material thickness.`);
      else if(gap<s.materialThickness*1.5)issue("tight-spacing","warning",`${axis} ribs are closely spaced. Check the material remaining between slots.`);
      for(let i=0;i<count;i++){yield;addLayer(axis,i,(i+1)*gap);onProgress?.({stage:"geometry",completed:i+1,total:count,percent:Math.round((i+1)/count*60)});}
    }
    const xs=layers.filter(l=>l.axis==="X"),ys=layers.filter(l=>l.axis==="Y");
    for(const x of xs)for(const y of ys){
      yield;
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
    for(let i=0;i<physical.length;i++){yield;const l=physical[i];addLayer(s.stackedAxis,i,l.center,l.center*dim[a]/builtDepth);onProgress?.({stage:"geometry",completed:i+1,total:physical.length,percent:Math.round((i+1)/physical.length*60)});}
    if(Math.abs(builtDepth-dim[a])>.001)issue("rounded-stack","warning",`Stack depth is rounded to ${builtDepth.toFixed(2)} mm (${layerCount} layers at their assigned thicknesses).`);
  }
  // A component reassignment belongs to its whole cutting plane so opposite slots remain consistent.
  if(s.mode==="interlocking")for(const axis of ["X","Y"] as const){
    const family=layers.filter(l=>l.axis===axis);
    for(let i=1;i<family.length;i++)if(family[i].position-family[i-1].position<(family[i].material.thickness+family[i-1].material.thickness)/2-EPS)issue("slice-collision","error",`${axis} ribs overlap. Reduce the slice count or material thickness.`,[family[i-1].id,family[i].id]);
  }
  const cutoff=Math.max(0,layerCount-(s.skipTopLayersCount??0));
  const pinLayers=layers.filter(l=>l.index<cutoff);
  const pins=s.mode==="stacked"&&s.alignmentPins&&pinLayers.length?pinLocations(pinLayers,s):[];
  if(s.mode==="stacked"&&s.alignmentPins&&pinLayers.length&&pins.length<s.pinCount)issue("pin-placement","warning",pins.length?`Only ${pins.length} pin positions fit through all perforated layers with a material margin.`:"No safe pin position passes through the perforated layers. Pins were omitted; use adhesive or external registration.");
  if(pins.length)for(const l of pinLayers)l.cuts.push(...pins.map(p=>s.alignmentPinType==="material"?pinHole(p,s):circle(p,s.pinDiameter/2)));

  const pieces:LaserCutPiece[]=[];
  for(const l of layers){
    yield;
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
  const prepared=bindStock(pieces,s),nesting=yield* nestPiecesStages(prepared,s,onProgress);
  if(nesting.unplaced.length)issue("oversize-parts","error","Some parts do not fit the usable sheet area. Increase the sheet size, reduce margins/spacing, or scale the model down.",nesting.unplaced);
  onProgress?.({stage:"checking",completed:0,total:1,percent:0});yield;
  return yield* checkResultStages({model:mesh.info,dimensions:dim,vertices:new Float32Array(v),settings:structuredClone(s),pieces:prepared,...nesting,joints:actualJoints,pins,issues,processingMs:performance.now()-started,layerCount,builtDepth});
}

export function sliceMesh(mesh:MeshData,s:SliceSettings,onProgress?:(p:import("./types").SlicingProgress)=>void):SliceResult{const stages=sliceMeshStages(mesh,s,onProgress);let next=stages.next();while(!next.done)next=stages.next();return next.value;}
