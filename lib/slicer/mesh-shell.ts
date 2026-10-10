import { Matrix4, Quaternion, Vector3 } from "three";
import type { Issue, LaserCutPiece, Path2DLoop, Point2D, SliceSettings } from "./types";
import { booleanPaths, circle, inMaterial, materialArea, pointClearance, splitComponents } from "./polygons";
import { facetMesh } from "./mesh-facets";
import { buildPiece } from "./piece-builder";
import { boxSettings, materialFor } from "./materials";
import { meshBounds } from "./stl";
import { section } from "./section";

type Report=(code:string,severity:Issue["severity"],message:string,ids?:string[])=>void;
interface Panel { id:string; normal:Vector3; origin:Vector3; u:Vector3; v:Vector3; triangles:number[]; paths:Path2DLoop[]; cuts:Path2DLoop[]; joints:Set<string> }
const key=(a:number,b:number)=>[a,b].sort((a,b)=>a-b).join("/");
const local=(p:Panel,v:Vector3):Point2D=>({x:v.clone().sub(p.origin).dot(p.u),y:v.clone().sub(p.origin).dot(p.v)});

/** Planar surface panels preserve tunnels on non-extruded, chamfered and faceted volumes. */
export function buildMeshShell(input:Float64Array,s:SliceSettings,report:Report):LaserCutPiece[]{
  const f=boxSettings(s),mesh=facetMesh(input,f.chordalError/2),{points,triangles}=mesh;
  const modelBounds=meshBounds(input),holeProfiles=(["X","Y","Z"] as const).map((axis,i)=>({axis,i,holes:section(input,axis,(modelBounds.min[i]+modelBounds.max[i])/2).loops.filter(l=>l.isHole).map(l=>({...l,isHole:false}))}));
  const edges=new Map<string,{a:number;b:number;triangles:number[]}>(),normals=triangles.map(t=>points[t[1]].clone().sub(points[t[0]]).cross(points[t[2]].clone().sub(points[t[0]])).normalize());
  triangles.forEach((t,id)=>t.forEach((a,i)=>{const b=t[(i+1)%3],k=key(a,b);let e=edges.get(k);if(!e){e={a,b,triangles:[]};edges.set(k,e);}e.triangles.push(id);}));
  if([...edges.values()].some(e=>e.triangles.length!==2)){report("shell-open-mesh","error","Surface-panel shells need a watertight mesh. Repair open or non-manifold edges, or use ribs/stacked layers.");return [];}
  const neighbors=triangles.map(()=>[] as number[]);for(const e of edges.values()){neighbors[e.triangles[0]].push(e.triangles[1]);neighbors[e.triangles[1]].push(e.triangles[0]);}
  const assignments=Array(triangles.length).fill(-1) as number[],panels:Panel[]=[];
  // Large faces first prevent a tiny sliver from setting the projection frame for a whole cap.
  const order=triangles.map((_,i)=>i).sort((a,b)=>points[triangles[b][1]].clone().sub(points[triangles[b][0]]).cross(points[triangles[b][2]].clone().sub(points[triangles[b][0]])).lengthSq()-points[triangles[a][1]].clone().sub(points[triangles[a][0]]).cross(points[triangles[a][2]].clone().sub(points[triangles[a][0]])).lengthSq());
  for(const start of order){
    if(assignments[start]>=0)continue;
    const normal=normals[start],origin=points[triangles[start][0]],u=points[triangles[start][1]].clone().sub(origin).normalize(),v=normal.clone().cross(u).normalize();
    const panel:Panel={id:`PANEL-${String(panels.length+1).padStart(2,"0")}`,normal,origin,u,v,triangles:[start],paths:[],cuts:[],joints:new Set()};
    assignments[start]=panels.length;
    for(let i=0;i<panel.triangles.length;i++)for(const next of neighbors[panel.triangles[i]]){
      if(assignments[next]>=0||normal.dot(normals[next])<Math.cos(Math.PI/9)||triangles[next].some(k=>Math.abs(normal.dot(points[k].clone().sub(origin)))>f.chordalError/2))continue;
      assignments[next]=panels.length;panel.triangles.push(next);
    }
    panel.paths=booleanPaths(panel.triangles.map(id=>({isHole:false,points:triangles[id].map(k=>local(panel,points[k]))})),[],"union");panels.push(panel);
  }
  if(panels.length>750){report("shell-panel-limit","error",`This surface needs ${panels.length} panels. Increase curve deviation, scale down, or use ribs/stacked layers (limit: 750 panels).`);return [];}
  const seams=new Map<string,{a:number;b:number;edges:{a:number;b:number}[]}>();
  for(const e of edges.values()){
    const [i,j]=e.triangles.map(t=>assignments[t]);if(i===j)continue;const a=Math.min(i,j),b=Math.max(i,j),k=key(a,b);let seam=seams.get(k);if(!seam){seam={a,b,edges:[]};seams.set(k,seam);}seam.edges.push(e);
  }
  for(const seam of seams.values()){
    const A=panels[seam.a],B=panels[seam.b],exact=seam.edges.every(e=>[points[e.a],points[e.b]].every(v=>Math.abs(A.normal.dot(v.clone().sub(A.origin)))<.002&&Math.abs(B.normal.dot(v.clone().sub(B.origin)))<.002)),right=exact&&Math.abs(A.normal.dot(B.normal))<.015;
    A.joints.add(B.id);B.joints.add(A.id);
    if(!right){report("shell-bevel-seams","warning","Angled surface-panel seams need manual edge bevels or adhesive. Etched part IDs and the assembly manual show their neighbors; these are not automatic square finger joints.",[A.id,B.id]);continue;}
    // Merge each connected collinear run, including boundaries around through-holes.
    const adjacent=new Map<number,Set<number>>();for(const e of seam.edges){if(!adjacent.has(e.a))adjacent.set(e.a,new Set());if(!adjacent.has(e.b))adjacent.set(e.b,new Set());adjacent.get(e.a)!.add(e.b);adjacent.get(e.b)!.add(e.a);}
    const visited=new Set<number>();
    for(const start of adjacent.keys()){
      if(visited.has(start))continue;const chain=[start];visited.add(start);for(let i=0;i<chain.length;i++)for(const next of adjacent.get(chain[i])!){if(!visited.has(next)){visited.add(next);chain.push(next);}}
      const direction=A.normal.clone().cross(B.normal).normalize(),sorted=chain.sort((a,b)=>points[a].dot(direction)-points[b].dot(direction)),from=points[sorted[0]],to=points[sorted.at(-1)!],length=from.distanceTo(to);
      const ma=materialFor(s,A.id),mb=materialFor(s,B.id);if(length<Math.max(f.fingerWidth*.8,2*ma.thickness,2*mb.thickness)){report("shell-small-seams","warning","Short surface-panel edges use glued butt seams. They are too small for usable fingers at this stock thickness.",[A.id,B.id]);continue;}
      let count=Math.max(3,Math.round(length/f.fingerWidth));if(count%2===0)count++;
      const pending=new Map<Panel,Path2DLoop[]>();
      for(const [p,other,phase] of [[A,mb,0],[B,ma,1]] as const){
        const cuts:Path2DLoop[]=[];pending.set(p,cuts);
        const a=local(p,from),b=local(p,to),u={x:(b.x-a.x)/length,y:(b.y-a.y)/length},n={x:-u.y,y:u.x},middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        if(!inMaterial({x:middle.x+n.x*.01,y:middle.y+n.y*.01},p.paths)){n.x*=-1;n.y*=-1;}
        const point=(x:number,y:number)=>({x:a.x+u.x*x+n.x*y,y:a.y+u.y*x+n.y*y});
        for(let i=phase;i<count;i+=2){const lo=i*length/count-f.jointTolerance/2,hi=(i+1)*length/count+f.jointTolerance/2,depth=Math.max(.05,other.thickness+f.jointTolerance/2);
          const mask={isHole:false,points:[point(lo,-.01),point(hi,-.01),point(hi,depth),point(lo,depth)]};cuts.push(mask);
          if(f.cornerStyle!=="sharp")for(const q of mask.points.slice(2))cuts.push(circle(q,Math.max(.02,materialFor(s,p.id).laserKerf/2)));
        }
      }
      if([...pending].some(([p,cuts])=>splitComponents(booleanPaths(p.paths,[...p.cuts,...cuts],"difference")).length!==1)){
        report("shell-fragile-joints","warning","Fingers that would split a narrow panel were omitted. Use adhesive at those seams, or increase model size / reduce stock thickness.",[A.id,B.id]);
      }else for(const [p,cuts] of pending)p.cuts.push(...cuts);
    }
  }
  const pieces:LaserCutPiece[]=[];
  for(const panel of panels){
    const m=materialFor(s,panel.id),q=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(panel.u,panel.v,panel.normal)),position=panel.origin.clone().addScaledVector(panel.normal,-m.thickness/2);
    const center=panel.triangles.reduce((c,id)=>c.add(points[triangles[id][0]]).add(points[triangles[id][1]]).add(points[triangles[id][2]]),new Vector3()).multiplyScalar(1/(panel.triangles.length*3));
    const inner=holeProfiles.some(h=>Math.abs(panel.normal.getComponent(h.i))<.8&&h.holes.some(hole=>pointClearance({x:center.getComponent(h.i===0?1:0),y:center.getComponent(h.i===2?1:2)},[hole])>=-f.chordalError));
    const nominal=booleanPaths(panel.paths,panel.cuts,"difference"),components=splitComponents(nominal);
    if(!components.length){report("shell-removed-panel","warning","A very small surface panel disappeared after joints. Increase model size or reduce thickness.",[panel.id]);continue;}
    components.forEach((paths,i)=>{
      const id=components.length===1?panel.id:`${panel.id}-${String.fromCharCode(65+i)}`;
      if(materialArea(paths)<2){report("shell-micro-panel","warning","Surface fragments below 2 mm² were omitted. Inspect the assembled shell for small gaps.",[id]);return;}
      const p=buildPiece(s,id,paths,[],{parentId:panel.id,axis:"UNROLLED",category:"box_wall",shellMethod:"mesh_panels",wallRole:inner?"hole":"outer",sliceIndex:pieces.length,assignedThicknessId:m.id,worldTransform:{position:position.toArray(),rotation:q.toArray()},explodeDirection:panel.normal.toArray(),joints:[...panel.joints]});
      if(p.cutPaths.filter(l=>l.isHole).length<p.assemblyPaths.filter(l=>l.isHole).length)report("vanishing-holes","warning","A hole is smaller than the kerf and disappeared. Reduce kerf or increase feature size.",[id]);
      pieces.push(p);
    });
  }
  for(const p of pieces)p.joints=p.joints.flatMap(id=>pieces.filter(q=>q.parentId===id).map(q=>q.id));
  report("surface-panel-shell","warning",`The model is not a constant extrusion. Its surface was developed into ${pieces.length} flat panels with the mesh's tunnel surfaces retained. Curves and bevels are approximated using the ${f.chordalError} mm curve-deviation setting. Inspect narrow panels, small gaps, and angled seams; finish those edges by hand.`);
  if(f.curveHandling==="living_hinge")report("surface-hinge-facets","warning","Compound or changing mesh surfaces use flat panels. Living-hinge strips are available on constant extrusions; a K factor cannot flatten a double-curved bevel.");
  if(f.bracing.enabled)report("surface-braces","warning","Automatic internal bracing applies to extruded shells. It was omitted on this changing-profile surface shell; add support after inspecting the panels.");
  return pieces;
}
