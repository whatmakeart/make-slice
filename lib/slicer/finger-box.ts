import { Matrix4, Quaternion, Vector3 } from "three";
import type { Issue, LaserCutPiece, Path2DLoop, Point2D, SliceSettings, Stroke } from "./types";
import { booleanPaths, bounds, circle, EPS, materialArea, offsetPaths, pointClearance, scanIntervals, splitComponents, signedArea, inLoop } from "./polygons";
import { vectorLabel } from "./labels";
import { section } from "./section";
import { boxSettings, materialFor } from "./materials";
import { buildPiece, rectangle } from "./piece-builder";
import { meshBounds } from "./stl";
import { buildMeshShell } from "./mesh-shell";
import { buildContourBands, type ProfileBoxOptions } from "./contour-bands";

type Report = (code: string, severity: Issue["severity"], message: string, ids?: string[]) => void;
interface Draft { id:string; raw:Path2DLoop[]; cuts:Path2DLoop[]; guides:Stroke[]; slits:Stroke[]; meta:Partial<LaserCutPiece> }
interface Wall { draft:Draft; path:Point2D[]; cumulative:number[]; length:number; t:number; startEdge:number; endEdge:number }
const dist=(a:Point2D,b:Point2D)=>Math.hypot(a.x-b.x,a.y-b.y);
const normal=(a:Point2D,b:Point2D)=>{const d=dist(a,b);return {x:-(b.y-a.y)/d,y:(b.x-a.x)/d};};
const add=(a:Point2D,b:Point2D,k=1)=>({x:a.x+b.x*k,y:a.y+b.y*k});
// Removing a vertex must respect every original point on its replaced arc,
// keep the winding, and leave all other contour edges and holes untouched.
export function simplifyClosedContour(points:Point2D[],error:number,obstacles:Point2D[][]=[]):Point2D[]{
  const nodes=points.map((point,index)=>({point,index})),originalSign=Math.sign(signedArea(points));
  const cross=(a:Point2D,b:Point2D,c:Point2D)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const touches=(a:Point2D,b:Point2D,c:Point2D,d:Point2D)=>{
    const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
    if(ab1*ab2<-1e-8&&cd1*cd2<-1e-8)return true;
    const on=(p:Point2D,q:Point2D,r:Point2D)=>Math.abs(cross(p,q,r))<1e-8&&r.x>=Math.min(p.x,q.x)-EPS&&r.x<=Math.max(p.x,q.x)+EPS&&r.y>=Math.min(p.y,q.y)-EPS&&r.y<=Math.max(p.y,q.y)+EPS;
    return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
  };
  let changed=true;
  while(changed&&nodes.length>3){changed=false;for(let i=0;i<nodes.length;i++){
    const previous=nodes[(i+nodes.length-1)%nodes.length],next=nodes[(i+1)%nodes.length],a=previous.point,c=next.point,dx=c.x-a.x,dy=c.y-a.y,length2=dx*dx+dy*dy;
    if(length2<EPS*EPS)continue;
    let safe=true;
    for(let j=(previous.index+1)%points.length;j!==next.index;j=(j+1)%points.length){const q=points[j],t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/length2));if(Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy)>error+EPS){safe=false;break;}}
    if(!safe)continue;
    for(let j=0;j<nodes.length;j++){const k=(j+1)%nodes.length;if(j===i||k===i||j===(i+nodes.length-1)%nodes.length||k===(i+nodes.length-1)%nodes.length||j===(i+1)%nodes.length)continue;if(touches(a,c,nodes[j].point,nodes[k].point)){safe=false;break;}}
    if(safe)for(const loop of obstacles){for(let j=0;j<loop.length;j++)if(touches(a,c,loop[j],loop[(j+1)%loop.length])){safe=false;break;}if(!safe)break;}
    if(!safe)continue;
    const candidate=nodes.filter((_,j)=>j!==i).map(n=>n.point);
    if(Math.sign(signedArea(candidate))!==originalSign||Math.abs(signedArea(candidate))<2)continue;
    // A chord can remove an entire tiny hole without crossing its edges.
    // Keep the original containment relationships as well as edge topology.
    if(obstacles.some(loop=>inLoop(loop[0],candidate)!==inLoop(loop[0],nodes.map(n=>n.point))))continue;
    nodes.splice(i,1);changed=true;break;
  }}return nodes.map(n=>({...n.point}));
}

function cum(path:Point2D[]){const d=[0];for(let i=1;i<path.length;i++)d.push(d.at(-1)!+dist(path[i-1],path[i]));return d;}
export function developedDistances(path:Point2D[],thickness:number,kFactor=.5):number[]{
  const lengths=path.slice(1).map((p,i)=>dist(path[i],p));
  for(let i=1;i<path.length-1;i++){
    const a=path[i-1],b=path[i],c=path[i+1],cos=((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))/(dist(a,b)*dist(b,c));
    const correction=(kFactor-.5)*thickness*Math.acos(Math.max(-1,Math.min(1,cos)));
    lengths[i-1]+=correction/2;lengths[i]+=correction/2;
  }
  const out=[0];for(const length of lengths){if(length<=.001)throw new Error("Hinge K factor and thickness leave no usable developed curve segment. Increase K, reduce thickness, or use flat facets.");out.push(out.at(-1)!+length);}return out;
}
function at(w:Wall,u:number):{point:Point2D;normal:Point2D}{
  u=Math.max(0,Math.min(w.length,u));let i=1;while(i<w.cumulative.length-1&&w.cumulative[i]<u)i++;
  const a=w.path[i-1],b=w.path[i],f=(u-w.cumulative[i-1])/(w.cumulative[i]-w.cumulative[i-1]||1);
  // Match the miter normals used by the actual bent solid, including samples
  // between bend vertices. Segment normals alone leave undersized curved slots.
  const vertexNormal=(index:number):Point2D=>{
    if(index===0)return normal(w.path[0],w.path[1]);
    if(index===w.path.length-1)return normal(w.path[index-1],w.path[index]);
    const n0=normal(w.path[index-1],w.path[index]),n1=normal(w.path[index],w.path[index+1]),x=n0.x+n1.x,y=n0.y+n1.y,len=Math.hypot(x,y);
    if(len<EPS)return n1;
    const scale=1/Math.max(.5,(x*n1.x+y*n1.y)/len);return {x:x/len*scale,y:y/len*scale};
  };
  const n0=vertexNormal(i-1),n1=vertexNormal(i);
  return {point:{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f},normal:{x:n0.x+(n1.x-n0.x)*f,y:n0.y+(n1.y-n0.y)*f}};
}
function strip(w:Wall,lo:number,hi:number,width:number):Path2DLoop{
  const samples=[lo,...w.cumulative.filter(d=>d>lo+EPS&&d<hi-EPS),hi];
  const left=samples.map(u=>{const p=at(w,u);return add(p.point,p.normal,width/2);});
  const right=samples.map(u=>{const p=at(w,u);return add(p.point,p.normal,-width/2);}).reverse();
  return {isHole:false,points:[...left,...right]};
}
function oddSegments(length:number,width:number){let n=Math.max(1,Math.round(length/width));if(n%2===0)n++;return n;}
function connect(a:Draft,b:Draft){a.meta.joints||=[];b.meta.joints||=[];if(!a.meta.joints.includes(b.id))a.meta.joints.push(b.id);if(!b.meta.joints.includes(a.id))b.meta.joints.push(a.id);}
export function fingerJointSpan(start:number,end:number,clearance:number){
  const inset=Math.max(0,clearance)/2;
  return {maleStart:start+inset,maleEnd:end-inset,slotStart:start+inset-clearance,slotEnd:end-inset+clearance};
}
export function fingerJointRelief(cut:Path2DLoop, radius:number, style:string):Path2DLoop[]{
  // Masks represent removed solids. Give strips and circles the same winding
  // so overlapping brace/finger cuts union instead of canceling one another.
  cut={...cut,isHole:false,points:signedArea(cut.points)<0?[...cut.points].reverse():cut.points};
  if(style==="sharp"||radius<=EPS)return [cut];
  if(style==="dogbone")return [cut,...cut.points.map(p=>circle(p,radius))];
  const rounded:Point2D[]=[];
  cut.points.forEach((p,i)=>{
    const before=cut.points[(i+cut.points.length-1)%cut.points.length],after=cut.points[(i+1)%cut.points.length],r=Math.min(radius,dist(before,p)/4,dist(after,p)/4);
    const a=add(p,{x:(before.x-p.x)/dist(before,p),y:(before.y-p.y)/dist(before,p)},r),b=add(p,{x:(after.x-p.x)/dist(after,p),y:(after.y-p.y)/dist(after,p)},r);
    for(let j=0;j<=4;j++){const t=j/4;rounded.push({x:(1-t)*(1-t)*a.x+2*(1-t)*t*p.x+t*t*b.x,y:(1-t)*(1-t)*a.y+2*(1-t)*t*p.y+t*t*b.y});}
  });return [{isHole:false,points:rounded}];
}
function isExtrusion(v:Float64Array,dim:[number,number,number]){
  const H=dim[2],reference=section(v,"Z",H/2);if(reference.open||reference.branches||!reference.loops.length)return false;
  const footprint=reference.loops,area=materialArea(footprint);
  return [.01,.25,.75,.99].every(t=>{const sample=section(v,"Z",H*t);return !sample.open&&!sample.branches&&sample.loops.length&&materialArea(booleanPaths(footprint,sample.loops,"difference"))+materialArea(booleanPaths(sample.loops,footprint,"difference"))<=Math.max(.5,area*.001);});
}
export function buildFingerBox(input:Float64Array,dim:[number,number,number],s:SliceSettings,report:Report):LaserCutPiece[]{
  const f=boxSettings(s),axis=f.extrusionAxis||"auto";
  if(f.shellConstruction==="bands")return buildContourBands(input,s,report,buildProfileBox);
  const candidates=axis==="auto"?[new Vector3(0,0,1),new Vector3(0,1,0),new Vector3(1,0,0)]:[new Vector3(axis==="X"?1:0,axis==="Y"?1:0,axis==="Z"?1:0)];
  if(axis==="auto"){
    const normals:{n:Vector3;area:number}[]=[];
    for(let i=0;i<input.length;i+=9){const a=new Vector3(input[i],input[i+1],input[i+2]),b=new Vector3(input[i+3],input[i+4],input[i+5]),c=new Vector3(input[i+6],input[i+7],input[i+8]),n=b.sub(a).cross(c.sub(a)),area=n.length();if(area<1e-8)continue;n.normalize();
      const main=n.toArray().find(x=>Math.abs(x)>1e-5)!;if(main<0)n.negate();let group=normals.find(g=>g.n.dot(n)>.9999);if(!group){group={n,area:0};normals.push(group);}group.area+=area;
    }
    candidates.push(...normals.sort((a,b)=>b.area-a.area).slice(0,6).map(g=>g.n).filter(n=>candidates.every(c=>Math.abs(c.dot(n))<.9999)));
  }
  for(const n of candidates){
    const q=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),n),inverse=q.clone().invert(),v=new Float64Array(input.length);
    for(let i=0;i<input.length;i+=3)v.set(new Vector3(input[i],input[i+1],input[i+2]).applyQuaternion(inverse).toArray(),i);
    const b=meshBounds(v);for(let i=0;i<v.length;i++)v[i]-=b.min[i%3];
    if(!isExtrusion(v,b.dimensions))continue;
    const pieces=buildExtrudedBox(v,b.dimensions,s,report),position=new Vector3(...b.min).applyQuaternion(q);
    if(n.z<.99999||position.lengthSq()>1e-10)for(const p of pieces){p.frameRotation=q.toArray();p.framePosition=position.toArray();if(p.explodeDirection)p.explodeDirection=new Vector3(...p.explodeDirection).applyQuaternion(q).toArray();}
    if(n.z<.99999)report("box-extrusion-axis","warning",`The extrusion direction was detected as (${n.toArray().map(v=>Number(v.toFixed(3))).join(", ")}). Caps, hole walls, and braces keep the imported model's orientation.`);
    return pieces;
  }
  if(f.shellConstruction!=="extrusion")return f.curveHandling==="living_hinge"?buildContourBands(input,s,report,buildProfileBox):buildMeshShell(input,s,report);
  report("box-not-prismatic","error","This mesh changes profile along its extrusion direction. Choose Auto shell construction for faceted surface panels, or use ribs / stacked layers.");return [];
}

function buildExtrudedBox(v:Float64Array,dim:[number,number,number],s:SliceSettings,report:Report):LaserCutPiece[]{
  const H=dim[2],reference=section(v,"Z",H/2);
  if(reference.open||reference.branches||!reference.loops.length){report("box-open-profile","error","Box mode needs a closed profile.");return [];}
  const footprint=reference.loops,area=materialArea(footprint);
  for(const z of [H*.01,H*.25,H*.75,H*.99]){
    const sample=section(v,"Z",z),diff=materialArea(booleanPaths(footprint,sample.loops,"difference"))+materialArea(booleanPaths(sample.loops,footprint,"difference"));
    if(sample.open||sample.branches||diff>Math.max(.5,area*.001)){
      report("box-not-prismatic","error","This mesh changes profile along its extrusion axis. Choose contour bands, Auto shell construction, or ribs / stacked layers.");return [];
    }
  }
  return buildProfileBox(footprint,H,s,report);
}
export function buildProfileBox(footprint:Path2DLoop[],H:number,s:SliceSettings,report:Report,options:ProfileBoxOptions={}):LaserCutPiece[]{
  const f=boxSettings(s),bottomId=options.bottomId||"CAP-BOTTOM",topId=options.topId||"CAP-TOP",bottomM=materialFor(s,bottomId),topM=materialFor(s,topId);
  const z0=bottomM.thickness,z1=H-topM.thickness,height=z1-z0;
  if(height<=Math.max(bottomM.thickness,topM.thickness)){report("box-too-shallow","error","Box height leaves no usable wall between its caps.");return [];}
  const simplified=footprint.map((loop,i)=>({...loop,points:simplifyClosedContour(loop.points,f.chordalError,footprint.filter((_,j)=>j!==i).map(l=>l.points))}));
  const fabricationFootprint=f.curveHandling==="facets"?simplified:footprint;
  const drafts:Draft[]=[],walls:Wall[]=[];
  const cap=(id:string,z:number,direction:number):Draft=>({id,raw:(id===bottomId?options.bottomProfile:options.topProfile)||fabricationFootprint,cuts:[],guides:[],slits:[],meta:{category:"box_cap",axis:"Z",worldPosition:z,explodeDirection:[0,0,direction],joints:[]}});
  const bottom=cap(bottomId,bottomM.thickness/2,-1),top=cap(topId,H-topM.thickness/2,1);
  drafts.push(bottom,top);let wallIndex=0;
  for(let loopIndex=0;loopIndex<footprint.length;loopIndex++){
    const loop=footprint[loopIndex],pts=simplified[loopIndex].points,n=pts.length;
    const hard=pts.map((p,i)=>{const a=pts[(i+n-1)%n],b=pts[(i+1)%n];const cos=((p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y))/(dist(a,p)*dist(p,b));return Math.acos(Math.max(-1,Math.min(1,cos)))>Math.PI/5;});
    const groups:number[][]=[];
    if(options.continuous)groups.push(Array.from({length:n},(_,i)=>i));
    else if(f.curveHandling==="facets")for(let i=0;i<n;i++)groups.push([i]);
    else {
      const corners=hard.flatMap((yes,i)=>yes?[i]:[]);
      if(!corners.length)groups.push(Array.from({length:n},(_,i)=>i));
      else for(let k=0;k<corners.length;k++){const g:number[]=[];for(let i=corners[k];;i=(i+1)%n){g.push(i);if((i+1)%n===corners[(k+1)%corners.length])break;}groups.push(g);}
    }
    if(f.curveHandling==="living_hinge"){
      const maxLength=Math.max(s.sheetWidth,s.sheetHeight)-2*s.sheetMargin-s.partSpacing-12;
      const split:number[][]=[];
      for(const group of groups){let chunk:number[]=[],length=0;for(const edge of group){const l=dist(pts[edge],pts[(edge+1)%n]);if(chunk.length&&length+l>maxLength){split.push(chunk);chunk=[];length=0;}chunk.push(edge);length+=l;}if(chunk.length)split.push(chunk);}
      groups.splice(0,groups.length,...split);
    }
    const ids=groups.map(()=>`${options.prefix||""}WALL-${String(++wallIndex).padStart(2,"0")}`);
    const thicknesses=Array(n).fill(0) as number[];
    groups.forEach((g,k)=>g.forEach(i=>thicknesses[i]=materialFor(s,ids[k]).thickness));
    // Intersection of adjacent offset edge planes supports independent wall stock thicknesses.
    const neutral=pts.map((p,i)=>{
      const a=normal(pts[(i+n-1)%n],p),b=normal(p,pts[(i+1)%n]),da=thicknesses[(i+n-1)%n]/2,db=thicknesses[i]/2,det=a.x*b.y-a.y*b.x;
      if(Math.abs(det)<1e-5)return add(p,b,db);
      return {x:p.x+(da*b.y-a.y*db)/det,y:p.y+(a.x*db-da*b.x)/det};
    });
    groups.forEach((edges,k)=>{
      const id=ids[k],m=materialFor(s,id),path=[...edges.map(i=>neutral[i]),neutral[(edges.at(-1)!+1)%n]],curved=path.length>2;
      if(curved&&!m.allowLivingHinges){report("hinge-material-disabled","error",`${m.id} (${m.family}) has living hinges disabled. Choose flat facets or enable tested hinge stock in Materials.`,[id]);return;}
      const cumulative=curved?developedDistances(path,m.thickness,m.hingeKFactor):cum(path),length=cumulative.at(-1)!;
      if(length<Math.max(2,m.thickness)){report("box-short-walls","error","Some perimeter segments are too short for the selected stock. Increase curve deviation, reduce stock thickness, or use living hinges.",[id]);return;}
      const dir=normal(path[0],path[1]),u=new Vector3((path[1].x-path[0].x)/dist(path[0],path[1]),(path[1].y-path[0].y)/dist(path[0],path[1]),0);
      const q=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(u,new Vector3(0,0,1),u.clone().cross(new Vector3(0,0,1))));
      const d:Draft={id,raw:[rectangle(0,0,length,height)],cuts:[],guides:[],slits:[],meta:{category:curved?"box_curved_wall":"box_wall",axis:"UNROLLED",sliceIndex:drafts.length,assignedThicknessId:m.id,
        worldTransform:curved?undefined:{position:[path[0].x,path[0].y,z0],rotation:q.toArray()},
        bendPath:curved?path:undefined,bendDistances:curved?cumulative:undefined,bendZ:curved?z0:undefined,explodeDirection:[-dir.x,-dir.y,0],wallRole:loop.isHole?"hole":"outer",shellMethod:"extrusion",joints:[]}};
      const wall:Wall={draft:d,path,cumulative,length,t:m.thickness,startEdge:edges[0],endEdge:edges.at(-1)!};
      const margin=Math.min(length/4,Math.max(m.thickness*1.5,3)),usable=length-2*margin;
      const segmentCount=oddSegments(usable,f.fingerWidth),width=usable/segmentCount;
      for(let i=0;i<segmentCount;i+=2){
        const joint=fingerJointSpan(margin+i*width,margin+(i+1)*width,f.jointTolerance),lo=joint.maleStart,hi=joint.maleEnd;
        if(hi-lo<1)continue;
        d.raw.push(rectangle(lo,height-.002,hi-lo,(options.topTabDepth??topM.thickness)+.002),rectangle(lo,-(options.bottomTabDepth??bottomM.thickness),hi-lo,(options.bottomTabDepth??bottomM.thickness)+.002));
        for(const c of [bottom,top]){
          const mask=strip(wall,Math.max(0,joint.slotStart),Math.min(length,joint.slotEnd),m.thickness+f.jointTolerance);
          c.cuts.push(...fingerJointRelief(mask,Math.max(.02,materialFor(s,c.id).laserKerf/2),f.cornerStyle));connect(d,c);
        }
      }
      const tabs=oddSegments(height,f.fingerWidth),tabH=height/tabs;
      const corner=(start:boolean)=>{
        const vertex=start?edges[0]:(edges.at(-1)!+1)%n,otherT=thicknesses[start?(vertex+n-1)%n:vertex],neighbor=ids[start?(k+groups.length-1)%groups.length:(k+1)%groups.length];
        const a=normal(pts[(vertex+n-1)%n],pts[vertex]),b=normal(pts[vertex],pts[(vertex+1)%n]);
        const isRight=Math.abs(a.x*b.x+a.y*b.y)<.02;
        if(!isRight){
          if(!curved||groups.length>1)report("facet-corner-fit","warning",f.curveHandling==="facets"?"Non-square faceted wall corners use cap tabs and butt/miter seams. Trim bevels or glue these seams; select living hinges for smooth curves.":"Living-hinge strips use cap tabs and butt seams at their ends. Align and glue these seams after pre-bending the strips.",[id]);return;
        }
        const depth=otherT/2;
        for(let j=0;j<tabs;j++){
          const male=start?j%2===1:j%2===0;
          const y=j*tabH+(male?Math.max(0,f.jointTolerance)/2:0),h=tabH-(male?Math.max(0,f.jointTolerance):0);
          if(male)d.raw.push(rectangle(start?-depth:length-.002,y,depth+.002,h));
          else d.cuts.push(...fingerJointRelief(rectangle(start?-depth-EPS:length-depth,y,depth*2+EPS,h),m.laserKerf/2,f.cornerStyle));
        }
        d.meta.joints!.push(neighbor);
      };
      corner(true);corner(false);
      d.raw=booleanPaths(d.raw,[],"union");
      if(curved){
        const pitch=m.hingePitch??f.livingHingeGap,slit=Math.min(m.hingeSlitLength??f.livingHingeSlitLength,height-4),bridge=Math.max(1.5,pitch*.7);
        let count=0;
        for(let x=Math.max(3,m.thickness);x<length-Math.max(3,m.thickness);x+=pitch){
          const edge=Math.max(1,cumulative.findIndex(d=>d>x)),a=path[Math.max(0,edge-2)],b=path[edge-1],c=path[Math.min(path.length-1,edge)];
          const bend=Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x));
          if(bend<EPS&&path.length>3)continue;
          const stagger=(Math.round(x/pitch)%2)*(slit+bridge)/2;
          for(let y=2-stagger;y<height-2;y+=slit+bridge){const lo=Math.max(2,y),hi=Math.min(height-2,y+slit);if(hi-lo<2)continue;d.slits.push({points:[{x,y:lo},{x,y:hi}]});if(++count>6000)throw new Error("Living hinge has too many slits. Increase the pitch or reduce the form size.");}
        }
        for(let j=1;j<path.length-1;j++)d.guides.push({points:[{x:cumulative[j],y:1},{x:cumulative[j],y:height-1}]});
        report("living-hinge-fit","warning","Hinge developed length uses each stock's thickness and effective K factor (0.5 = mid-surface). Lattice flexibility, springback, and minimum bend radius depend on material, grain, and slit pattern. Calibrate on a strip; the 3D preview shows the intended shape, not a bend-strength simulation.",[id]);
      }
      walls.push(wall);drafts.push(d);
    });
  }
  if(drafts.length>250){report("box-panel-limit","error","This shell needs more than 250 panels. Increase curve deviation or choose living hinges.");return [];}
  if(f.bracing.enabled)makeBraces(footprint,walls,bottom,top,drafts,z0,z1,s,report,options);
  options.onCapGuides?.(bottom.id,bottom.guides);options.onCapGuides?.(top.id,top.guides);
  // Keep the bottom first and top last so the animated assembly exposes its reinforcements.
  const ordered=[bottom,...drafts.filter(d=>d!==bottom&&d!==top),top];
  const result:LaserCutPiece[]=[];
  for(const d of ordered){
    const p=buildPiece(s,d.id,d.raw,d.cuts,d.meta,d.guides,d.slits);
    if(p.cutPaths.filter(l=>l.isHole).length<booleanPaths(d.raw,d.cuts,"difference").filter(l=>l.isHole).length)report("vanishing-holes","warning","A hole is smaller than the kerf and disappeared. Reduce kerf or increase feature size.",[d.id]);
    if(!p.cutPaths.length||p.area<=1){report("box-collapsed-part","error","A box part collapsed. Reduce joint size, kerf, or stock thickness.",[d.id]);continue;}
    if(splitComponents(p.assemblyPaths).length>1&&!(options.continuous&&p.category==="box_cap"))report("box-disconnected","error","Joint or hinge cuts disconnected a panel. Reduce tabs/cuts or increase the panel dimensions.",[d.id]);
    result.push(p);
  }
  return result;
}

function makeBraces(footprint:Path2DLoop[],walls:Wall[],bottom:Draft,top:Draft,drafts:Draft[],z0:number,z1:number,s:SliceSettings,report:Report,options:ProfileBoxOptions){
  const b=boxSettings(s).bracing,maxT=Math.max(...walls.map(w=>w.t)),cavity=offsetPaths(footprint,-maxT),cb=bounds(cavity),braces:Draft[]=[];
  if(!cavity.length){report("brace-no-cavity","error","No interior cavity remains for the selected wall thickness.");return;}
  if(new Set(walls.map(w=>w.t)).size>1)report("brace-variable-wall","warning","The cavity uses the thickest wall as clearance. Braces anchor to the caps; some thinner walls may need adhesive at their contacts.");
  const positions=(lo:number,hi:number,axis:"X"|"Y")=>{
    if(b.mode==="transverse"&&axis==="Y"||b.mode==="longitudinal"&&axis==="X")return [];
    const span=hi-lo,gap=b.mode==="auto"?b.maxUnsupportedSpan:b.spacing;
    const count=b.mode==="auto"?Math.max(0,Math.ceil(span/gap)-1):Math.max(0,Math.ceil(span/gap)-1);
    if(count>60)throw new Error("Too many braces. Increase brace spacing or maximum span.");
    return Array.from({length:count},(_,i)=>lo+(i+1)*span/(count+1));
  };
  let number=0;
  for(const axis of ["X","Y"] as const)for(const position of positions(axis==="X"?cb.minX:cb.minY,axis==="X"?cb.maxX:cb.maxY,axis)){
    const profile=axis==="X"?cavity:cavity.map(l=>({...l,points:l.points.map(p=>({x:p.y,y:p.x}))}));
    for(const [lo,hi] of scanIntervals(profile,position)){
      const id=`${options.prefix||""}BR-${axis}${String(++number).padStart(2,"0")}`,m=materialFor(s,id,b.braceThicknessId),height=z1-z0;
      if(hi-lo<Math.max(10,m.thickness*3))continue;
      const reliefSize=Math.min((hi-lo)/5,height/5,Math.max(maxT,b.cornerReliefSize));
      const raw:Path2DLoop[]=[{isHole:false,points:[{x:lo+reliefSize,y:z0},{x:hi-reliefSize,y:z0},{x:hi,y:z0+reliefSize},{x:hi,y:z1-reliefSize},{x:hi-reliefSize,y:z1},{x:lo+reliefSize,y:z1},{x:lo,y:z1-reliefSize},{x:lo,y:z0+reliefSize}]}];
      const d:Draft={id,raw,cuts:[],guides:[],slits:[],meta:{category:"brace",axis,worldPosition:position,sliceIndex:number,assignedThicknessId:m.id,explodeDirection:axis==="X"?[1,0,0]:[0,1,0],anchorCount:0,joints:[]}};
      const blind=b.jointType==="blind_notch"||b.tenonDepthRatio<.999;
      const width=Math.min(b.tenonWidth,(hi-lo-2*reliefSize)/(b.tenonCountPerEdge*1.8));
      if(width<1)continue;
      for(let j=0;j<b.tenonCountPerEdge;j++){
        const center=lo+reliefSize+(j+.5)*(hi-lo-2*reliefSize)/b.tenonCountPerEdge;
        for(const [cap,z,up] of [[bottom,z0,false],[top,z1,true]] as const){
          const t=materialFor(s,cap.id).thickness,fit=b.slotFitTolerance;
          const depth=(up?options.topTabDepth:options.bottomTabDepth)??t;
          const mask=axis==="X"?rectangle(position-(m.thickness+fit)/2,center-(width+fit)/2,m.thickness+fit,width+fit):rectangle(center-(width+fit)/2,position-(m.thickness+fit)/2,width+fit,m.thickness+fit);
          if(blind)cap.guides.push({points:mask.points,closed:true});
          else {d.raw.push(rectangle(center-width/2,up?z-.002:z-depth,width,depth+.002));cap.cuts.push(mask);}
          options.onBraceAnchor?.(cap.id,id,axis==="X"?{x:position,y:center}:{x:center,y:position});
          const candidate={x:(mask.points[0].x+mask.points[2].x)/2+(axis==="X"?m.thickness+6:0),y:(mask.points[0].y+mask.points[2].y)/2+(axis==="Y"?m.thickness+6:0)};
          cap.guides.push(...vectorLabel(id,cap.raw,{point:candidate,clearance:Math.min(6,pointClearance(candidate,cap.raw))}));
          cap.guides.push({points:[{x:mask.points[0].x-1,y:mask.points[0].y},{x:mask.points[0].x-1,y:mask.points[0].y+2}]});
          d.meta.anchorCount!++;connect(d,cap);
        }
      }
      // Side anchors are added only where the brace reaches the actual inner wall.
      for(const [contact,sign] of [[lo,-1],[hi,1]] as const){
        const anchor=axis==="X"?{x:position,y:contact}:{x:contact,y:position};
        let nearest:{wall:Wall;u:number;distance:number;projection:number}|null=null;
        for(const wall of walls)for(let i=1;i<wall.path.length;i++){
          const a=wall.path[i-1],q=wall.path[i],dx=q.x-a.x,dy=q.y-a.y,len=dist(a,q),f=Math.max(0,Math.min(1,((anchor.x-a.x)*dx+(anchor.y-a.y)*dy)/(len*len)));
          const point={x:a.x+f*dx,y:a.y+f*dy},distance=dist(anchor,point),projection=Math.abs(axis==="X"?dx/len:dy/len);
          if(projection>.25&&(!nearest||distance<nearest.distance))nearest={wall,u:wall.cumulative[i-1]+f*(wall.cumulative[i]-wall.cumulative[i-1]),distance,projection};
        }
        if(!nearest||Math.abs(nearest.distance-nearest.wall.t/2)>.15)continue;
        // A through-slot in a flex lattice severs its bridges. Curved strips
        // instead meet the rib at an uncut butt contact; cap tabs locate it.
        if(nearest.wall.draft.meta.category==="box_curved_wall")continue;
        const wall=nearest.wall,t=wall.t/nearest.projection,slot=m.thickness/nearest.projection+b.slotFitTolerance;
        for(let j=0;j<b.tenonCountPerEdge;j++){
          const z=z0+reliefSize+(j+.5)*(height-2*reliefSize)/b.tenonCountPerEdge,w=Math.min(b.tenonWidth,(height-2*reliefSize)/(b.tenonCountPerEdge*2)),mask=rectangle(nearest.u-slot/2,z-z0-w/2,slot,w+b.slotFitTolerance);
          if(blind)wall.draft.guides.push({points:mask.points,closed:true});
          else {d.raw.push(rectangle(sign<0?contact-t:contact-.002,z-w/2,t+.002,w));wall.draft.cuts.push(mask);}
          const mark={x:nearest.u+slot/2+7,y:z-z0};
          wall.draft.guides.push(...vectorLabel(id,wall.draft.raw,{point:mark,clearance:Math.min(6,pointClearance(mark,wall.draft.raw))}));
          d.meta.anchorCount!++;connect(d,wall.draft);
        }
      }
      d.raw=booleanPaths(d.raw,[],"union");

      braces.push(d);drafts.push(d);
    }
  }
  if(b.eggCrateSlotted)for(const a of braces.filter(d=>d.meta.axis==="X"))for(const c of braces.filter(d=>d.meta.axis==="Y")){
    const ap=a.meta.worldPosition!,cp=c.meta.worldPosition!,ai=scanIntervals(a.raw,cp),ci=scanIntervals(c.raw,ap);
    for(const [alo,ahi] of ai)for(const [clo,chi] of ci){const lo=Math.max(alo,clo,z0),hi=Math.min(ahi,chi,z1);if(hi-lo<5)continue;
      const mid=(lo+hi)/2;
      for(const [d,u,other,up] of [[a,cp,c,true],[c,ap,a,false]] as const){
        const width=materialFor(s,other.id,b.braceThicknessId).thickness+b.slotFitTolerance,half=width/2,chamfer=Math.min(1,(hi-lo)/10);
        d.cuts.push({isHole:false,points:(up?[[u-half,mid],[u+half,mid],[u+half,hi-chamfer],[u+half+chamfer,hi],[u+half+chamfer,z1+maxT+1],[u-half-chamfer,z1+maxT+1],[u-half-chamfer,hi],[u-half,hi-chamfer]]:[[u-half-chamfer,z0-maxT-1],[u+half+chamfer,z0-maxT-1],[u+half+chamfer,lo],[u+half,lo+chamfer],[u+half,mid],[u-half,mid],[u-half,lo+chamfer],[u-half-chamfer,lo]]).map(([x,y])=>({x,y}))});
      }connect(a,c);
    }
  }
  if(b.lightningHoles)for(const d of braces){
    const material=booleanPaths(d.raw,d.cuts,"difference"),bb=bounds(material);
    for(const fx of [.22,.5,.78])for(const fy of [.32,.68]){
      const p={x:bb.minX+fx*bb.width,y:bb.minY+fy*bb.height},radius=Math.min(10,bb.width/16,bb.height/12,pointClearance(p,material)-4);
      if(radius>3)d.cuts.push(circle(p,radius));
    }
  }
  if(!b.eggCrateSlotted&&braces.some(d=>d.meta.axis==="X")&&braces.some(d=>d.meta.axis==="Y"))report("brace-collision","error","Crossing braces need egg-crate half-lap slots. Enable them or choose a single brace direction.");
  if(b.jointType==="blind_notch"||b.tenonDepthRatio<.999)report("blind-brace-guide","warning","Blind brace contacts use unperforated butt joints and blue alignment marks. Laser vector cuts cannot make a controlled-depth recess; bond these contacts with adhesive.");
}
