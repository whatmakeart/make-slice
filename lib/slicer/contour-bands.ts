import { Quaternion, Vector3 } from "three";
import type { Issue, LaserCutPiece, Path2DLoop, Point2D, SliceSettings } from "./types";
import { booleanPaths, bounds, EPS, materialArea, offsetPaths, pointClearance, splitComponents } from "./polygons";
import { materialFor, materials, boxSettings } from "./materials";
import { meshBounds } from "./stl";
import { section } from "./section";
import { buildPiece } from "./piece-builder";

export type BandReport=(code:string,severity:Issue["severity"],message:string,ids?:string[])=>void;
export interface ProfileBoxOptions {
  prefix?:string; bottomId?:string; topId?:string;
  bottomProfile?:Path2DLoop[]; topProfile?:Path2DLoop[];
  bottomTabDepth?:number; topTabDepth?:number; continuous?:boolean;
}
type ProfileBuilder=(profile:Path2DLoop[],height:number,s:SliceSettings,report:BandReport,options:ProfileBoxOptions)=>LaserCutPiece[];
interface Band {lo:number;hi:number;profile:Path2DLoop[];deviation:number}
interface Plate {id:string;profile:Path2DLoop[];cuts:Path2DLoop[];joints:Set<string>;z:number;index:number}

// Bidirectional boundary distance detects curvature as well as taper. Samples
// along edges keep triangulated section density from dominating the estimate.
function boundarySamples(paths:Path2DLoop[]):Point2D[]{
  return paths.flatMap(loop=>{
    const points:Point2D[]=[];
    const length=loop.points.reduce((n,a,i)=>{const b=loop.points[(i+1)%loop.points.length];return n+Math.hypot(a.x-b.x,a.y-b.y);},0),pitch=Math.max(.5,length/160);
    let next=0,travel=0;
    for(let i=0;i<loop.points.length;i++){
      const a=loop.points[i],b=loop.points[(i+1)%loop.points.length],edge=Math.hypot(a.x-b.x,a.y-b.y);
      while(next<travel+edge){const t=(next-travel)/(edge||1);points.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});next+=pitch;}
      travel+=edge;
    }
    return points;
  });
}
export function profileDeviation(a:Path2DLoop[],b:Path2DLoop[]):number {
  if(!a.length||!b.length)return Infinity;
  return Math.max(...boundarySamples(a).map(p=>Math.abs(pointClearance(p,b))),...boundarySamples(b).map(p=>Math.abs(pointClearance(p,a))));
}

export function buildContourBands(input:Float64Array,s:SliceSettings,report:BandReport,buildProfile:ProfileBuilder):LaserCutPiece[]{
  const f=boxSettings(s),axis=f.extrusionAxis==="X"?new Vector3(1,0,0):f.extrusionAxis==="Y"?new Vector3(0,1,0):new Vector3(0,0,1);
  const rotation=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),axis),inverse=rotation.clone().invert(),v=new Float64Array(input.length);
  for(let i=0;i<input.length;i+=3)v.set(new Vector3(input[i],input[i+1],input[i+2]).applyQuaternion(inverse).toArray(),i);
  const mesh=meshBounds(v);for(let i=0;i<v.length;i++)v[i]-=mesh.min[i%3];
  const H=mesh.dimensions[2],maxT=Math.max(...materials(s).filter(m=>Object.values(s.partThickness||{}).includes(m.id)||m.id==="T1").map(m=>m.thickness));
  const minHeight=Math.max(8,maxT*2+5),maxHeight=Math.max(minHeight,f.bandHeight??30),limit=f.bandDeviation??3;
  if(H<minHeight){report("band-too-shallow","error",`The selected stack axis is too shallow for contour bands in this stock. It needs at least ${minHeight.toFixed(1)} mm; choose another axis, thinner stock, or an extruded shell.`);return [];}
  const cache=new Map<number,Path2DLoop[]>();
  const profile=(z:number)=>{
    const key=Math.round(Math.max(EPS,Math.min(H-EPS,z))*10000)/10000;
    let paths=cache.get(key);if(paths)return paths;
    const sample=section(v,"Z",key);
    if(sample.open||sample.branches)throw new Error(`Contour band at ${key.toFixed(2)} mm has open or branching sections. Repair the mesh before making hinge bands.`);
    paths=sample.loops;cache.set(key,paths);return paths;
  };
  const bands:Band[]=[];
  const divide=(lo:number,hi:number)=>{
    const mid=(lo+hi)/2,reference=profile(mid),samples=[profile(lo+(hi-lo)*.15),profile(lo+(hi-lo)*.85)];
    const deviation=Math.max(...samples.map(p=>profileDeviation(reference,p)));
    const topology=samples.some(p=>p.filter(l=>!l.isHole).length!==reference.filter(l=>!l.isHole).length||p.filter(l=>l.isHole).length!==reference.filter(l=>l.isHole).length);
    if(f.adaptiveBands!==false&&(deviation>limit||topology)&&hi-lo>=2*minHeight&&bands.length<62){divide(lo,mid);divide(mid,hi);return;}
    if(reference.length)bands.push({lo,hi,profile:reference,deviation});
    else report("empty-contour-band","warning","An empty cross-section was omitted. Separate disconnected objects or choose a different stack axis for a continuous banded assembly.");
  };
  const count=Math.max(1,Math.ceil(H/maxHeight));
  if(count>64){report("band-count-limit","error","This form needs more than 64 contour bands. Increase maximum band height or reduce the model size.");return [];}
  // Equal initial intervals avoid leaving an unusably short final band.
  for(let i=0;i<count;i++)divide(i*H/count,(i+1)*H/count);
  if(!bands.length)return [];
  if(bands.length>64){report("band-count-limit","error","Adaptive slicing needs more than 64 bands. Increase profile deviation or disable adaptive heights.");return [];}
  const plateId=(i:number)=>`PLATE-${String(i+1).padStart(2,"0")}`;
  const plates:Plate[]=Array.from({length:bands.length+1},(_,index)=>{
    const profile=index===0?bands[0].profile:index===bands.length?bands.at(-1)!.profile:booleanPaths(bands[index-1].profile,bands[index].profile,"union");
    const id=plateId(index),t=materialFor(s,id).thickness,z=index===0?t/2:index===bands.length?H-t/2:bands[index].lo;
    return {id,profile,cuts:[],joints:new Set<string>(),z,index};
  });
  const wallsByBand:LaserCutPiece[][]=[];
  for(let index=0;index<bands.length;index++){
    const band=bands[index],lower=plates[index],upper=plates[index+1],tb=materialFor(s,lower.id).thickness,tt=materialFor(s,upper.id).thickness;
    const offset=lower.z-tb/2,height=upper.z-lower.z+(tb+tt)/2;
    const local={...s,fingerBox:{...f,curveHandling:"living_hinge" as const,chordalError:Math.min(f.chordalError,.3),bracing:{...f.bracing,enabled:false}}};
    const prefix=`B${String(index+1).padStart(2,"0")}-`;
    const parts=buildProfile(band.profile,height,local,report,{prefix,bottomId:lower.id,topId:upper.id,bottomProfile:lower.profile,topProfile:upper.profile,
      bottomTabDepth:index===0?tb:Math.max(.1,tb/2-.03),topTabDepth:index===bands.length-1?tt:Math.max(.1,tt/2-.03),continuous:true});
    const walls:LaserCutPiece[]=[];
    for(const part of parts){
      if(part.category==="box_cap"){
        const plate=part.id===lower.id?lower:upper;plate.cuts.push(...part.interiorRegions||[]);part.joints.forEach(id=>plate.joints.add(id));continue;
      }
      if(part.bendPath)part.bendZ=(part.bendZ||0)+offset;
      else if(part.worldTransform)part.worldTransform.position[2]+=offset;
      else part.worldPosition+=offset;
      part.shellMethod="contour_bands";part.bandIndex=index;part.bandRange=[band.lo,band.hi];
      part.explodeDirection=[0,0,(index-(bands.length-1)/2)/Math.max(1,bands.length/2)];walls.push(part);
    }
    wallsByBand.push(walls);
  }
  const platesByBoundary:LaserCutPiece[][]=[];
  const final:LaserCutPiece[]=[];
  for(const plate of plates){
    const kerf=materialFor(s,plate.id).laserKerf;
    // Boolean notches can leave microscopic enclosed wedges below the beam
    // width. They are not machinable holes; omit those from the actual plate
    // solid as well as the cut paths, so the 3D mesh has no tangent slivers.
    // A 1 µm clearance resolves exact point contacts between neighboring
    // masks. Otherwise two touching holes share an extruded edge, making the
    // plate non-manifold despite valid individual 2D loops.
    const joinedMasks=offsetPaths(booleanPaths(plate.cuts,[],"union"),.001);
    const nominal=booleanPaths(plate.profile,joinedMasks,"difference").filter(loop=>{if(!loop.isHole)return true;const b=bounds([loop]);return b.width>=Math.max(.02,kerf)&&b.height>=Math.max(.02,kerf)&&materialArea([{...loop,isHole:false}])>=Math.max(.01,kerf*kerf);}),components=splitComponents(nominal).filter(p=>materialArea(p)>2).sort((a,b)=>bounds(a).minX-bounds(b).minX||bounds(a).minY-bounds(b).minY);
    const pieces=components.map((component,i)=>{
      const id=components.length===1?plate.id:`${plate.id}-${String.fromCharCode(65+i)}`;
      const part=buildPiece(s,id,component,[],{parentId:plate.id,axis:"Z",worldPosition:plate.z,category:"box_cap",sliceIndex:plate.index,shellMethod:"contour_bands",bandIndex:plate.index,
        explodeDirection:[0,0,(plate.index-bands.length/2)/Math.max(1,bands.length/2)],assignedThicknessId:materialFor(s,plate.id).id,plateRole:plate.index===0?"bottom":plate.index===bands.length?"top":"joining"});
      part.interiorRegions=plate.cuts;part.joints=[...plate.joints];return part;
    });
    platesByBoundary.push(pieces);
  }
  // Map logical plate IDs to physical islands. Keep only anchors next to each
  // island rather than claiming every disjoint leg/arm plate mates to all walls.
  for(let i=0;i<wallsByBand.length;i++)for(const wall of wallsByBand[i]){
    const baseJoints=wall.joints.filter(id=>!id.startsWith("PLATE-")&&id!==wall.id),anchor=wall.bendPath||[];
    for(const boundary of [i,i+1]){
      const candidates=platesByBoundary[boundary].filter(p=>anchor.some(q=>Math.abs(pointClearance(q,p.assemblyPaths))<Math.max(wall.thickness||maxT,2)*2));
      for(const plate of candidates){baseJoints.push(plate.id);plate.joints=plate.joints.filter(id=>id!==wall.id).concat(wall.id);}
    }
    wall.joints=[...new Set(baseJoints)];
  }
  for(const plate of platesByBoundary.flat())plate.joints=plate.joints.filter(id=>wallsByBand.flat().some(w=>w.id===id&&w.joints.includes(plate.id)));
  for(let i=0;i<bands.length;i++){final.push(...platesByBoundary[i],...wallsByBand[i]);}final.push(...platesByBoundary.at(-1)!);
  if(f.bracing.enabled)report("band-plate-reinforcement","warning","Contour joining plates support each band. Grid braces are available for constant-profile and surface-panel shells, and are not added to contour bands.");
  const missed=bands.filter(b=>b.deviation>limit||!Number.isFinite(b.deviation));
  if(missed.length)report("band-deviation-limit","warning",`${missed.length} bands reach the minimum usable height before meeting the profile deviation target. Thin stock, smaller bands, or another stack axis can follow these features more closely.`);
  report("contour-band-assembly","warning",`${bands.length} hollow contour bands approximate the changing surface as stacked steps. Pre-bend strips, glue their butt seams, and build upward by B/PLATE number. Intermediate tabs enter opposite halves of one joining plate; adhesive secures these shared through-slots. Compare against the ghost mesh before cutting.`);
  const origin=new Vector3(...mesh.min).applyQuaternion(rotation);
  if(axis.z<.99999||origin.lengthSq()>1e-10)for(const p of final){p.frameRotation=rotation.toArray();p.framePosition=origin.toArray();if(p.explodeDirection)p.explodeDirection=new Vector3(...p.explodeDirection).applyQuaternion(rotation).toArray();}
  return final;
}
