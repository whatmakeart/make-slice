import { Vector3 } from "three";

export interface FacetMesh { points:Vector3[]; triangles:[number,number,number][]; maxPlaneDeviation:number }
interface Vertex { p:Vector3; q:number[]; triangles:Set<number>; planes:Set<number>; version:number; active:boolean }
interface Triangle { v:[number,number,number]; normal:Vector3; active:boolean }
interface Candidate { a:number;b:number;av:number;bv:number;p:Vector3;cost:number }
const zero=()=>Array(10).fill(0) as number[];
const coefficients=(a:number,b:number,c:number,d:number)=>[a*a,a*b,a*c,a*d,b*b,b*c,b*d,c*c,c*d,d*d];
const value=(q:number[],p:Vector3)=>q[0]*p.x*p.x+2*q[1]*p.x*p.y+2*q[2]*p.x*p.z+2*q[3]*p.x+q[4]*p.y*p.y+2*q[5]*p.y*p.z+2*q[6]*p.y+q[7]*p.z*p.z+2*q[8]*p.z+q[9];
class Heap {
  items:Candidate[]=[];
  push(c:Candidate){let i=this.items.length;this.items.push(c);while(i){const p=(i-1)>>1;if(this.items[p].cost<=c.cost)break;this.items[i]=this.items[p];i=p;}this.items[i]=c;}
  pop(){const out=this.items[0],last=this.items.pop();if(this.items.length&&last){let i=0;while(i*2+1<this.items.length){let j=i*2+1;if(j+1<this.items.length&&this.items[j+1].cost<this.items[j].cost)j++;if(this.items[j].cost>=last.cost)break;this.items[i]=this.items[j];i=j;}this.items[i]=last;}return out;}
}

/** Topology-preserving quadric reduction. Every collapse is bounded against its
 * original supporting planes and may neither open a tunnel nor invert a face. */
export function facetMesh(input:Float64Array,deviation:number):FacetMesh {
  const vertices:Vertex[]=[],triangles:Triangle[]=[],planes:{n:Vector3;d:number}[]=[],byPosition=new Map<string,number>();
  const vertex=(p:Vector3)=>{const key=p.toArray().map(n=>Math.round(n/1e-5)).join(",");let id=byPosition.get(key);if(id===undefined){id=vertices.length;byPosition.set(key,id);vertices.push({p,q:zero(),triangles:new Set(),planes:new Set(),version:0,active:true});}return id;};
  for(let i=0;i<input.length;i+=9){
    const v=[0,1,2].map(j=>vertex(new Vector3(input[i+j*3],input[i+j*3+1],input[i+j*3+2]))) as [number,number,number];
    if(new Set(v).size<3)continue;
    const a=vertices[v[0]].p,b=vertices[v[1]].p,c=vertices[v[2]].p,n=b.clone().sub(a).cross(c.clone().sub(a)),area=n.length()/2;
    if(area<1e-10)continue;n.normalize();const d=-n.dot(a),id=triangles.length;
    triangles.push({v,normal:n,active:true});planes.push({n,d});const q=coefficients(n.x,n.y,n.z,d);
    for(const k of v){vertices[k].triangles.add(id);vertices[k].planes.add(id);q.forEach((x,j)=>vertices[k].q[j]+=x*area);}
  }
  const neighbors=(id:number)=>{const out=new Set<number>();for(const t of vertices[id].triangles)for(const k of triangles[t].v)if(k!==id)out.add(k);return out;};
  const edgeTriangles=(a:number,b:number)=>[...vertices[a].triangles].filter(id=>triangles[id].v.includes(b));
  const heap=new Heap();
  const queue=(a:number,b:number)=>{
    if(a>b)[a,b]=[b,a];const va=vertices[a],vb=vertices[b];if(!va.active||!vb.active)return;
    const q=va.q.map((n,i)=>n+vb.q[i]),A=q[0],B=q[1],C=q[2],D=q[4],E=q[5],F=q[7],det=A*(D*F-E*E)-B*(B*F-C*E)+C*(B*E-C*D);
    const options=[va.p,vb.p,va.p.clone().lerp(vb.p,.5)];
    if(Math.abs(det)>1e-12){const x=-q[3],y=-q[6],z=-q[8];options.push(new Vector3(((D*F-E*E)*x+(C*E-B*F)*y+(B*E-C*D)*z)/det,((C*E-B*F)*x+(A*F-C*C)*y+(B*C-A*E)*z)/det,((B*E-C*D)*x+(B*C-A*E)*y+(A*D-B*B)*z)/det));}
    let best:Vector3|null=null,cost=Infinity;
    for(const p of options){
      // An optimum far outside the edge neighborhood creates spikes on nearly planar regions.
      if(p.distanceTo(va.p)+p.distanceTo(vb.p)>va.p.distanceTo(vb.p)*2+deviation)continue;
      const n=Math.max(0,value(q,p));if(n>=cost)continue;
      if([...va.planes,...vb.planes].some(k=>Math.abs(planes[k].n.dot(p)+planes[k].d)>deviation+1e-8))continue;
      best=p;cost=n;
    }
    if(best)heap.push({a,b,av:va.version,bv:vb.version,p:best.clone(),cost});
  };
  const edges=new Map<string,[number,number]>();for(const t of triangles)for(let i=0;i<3;i++){const a=Math.min(t.v[i],t.v[(i+1)%3]),b=Math.max(t.v[i],t.v[(i+1)%3]);edges.set(`${a}/${b}`,[a,b]);}
  // Keep a true polyhedron exact; reduction is needed for densely triangulated bevels/curves.
  if(triangles.length>500){
    for(const [a,b] of edges.values())queue(a,b);
    let active=triangles.length,iterations=0;
    while(heap.items.length&&active>24&&iterations++<input.length*20){
      const candidate=heap.pop()!,{a,b,p}=candidate,va=vertices[a],vb=vertices[b];
      if(!va.active||!vb.active||candidate.av!==va.version||candidate.bv!==vb.version)continue;
      const shared=edgeTriangles(a,b);if(shared.length!==2)continue;
      const na=neighbors(a),nb=neighbors(b),common=[...na].filter(k=>nb.has(k));
      const opposite=new Set(shared.flatMap(id=>triangles[id].v.filter(k=>k!==a&&k!==b)));
      if(common.length!==2||common.some(k=>!opposite.has(k)))continue;
      const affected=new Set([...va.triangles,...vb.triangles]);
      let valid=true;
      for(const id of affected){if(shared.includes(id))continue;const t=triangles[id],pts=t.v.map(k=>k===a||k===b?p:vertices[k].p),n=pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0]));
        if(n.lengthSq()<1e-16||n.normalize().dot(t.normal)<.25){valid=false;break;}}
      if(!valid)continue;
      const nearby=new Set([...na,...nb,a]);
      for(const id of affected)for(const k of triangles[id].v)vertices[k].triangles.delete(id);
      va.p=p;va.q=va.q.map((n,i)=>n+vb.q[i]);for(const k of vb.planes)va.planes.add(k);vb.active=false;
      for(const id of affected){const t=triangles[id];if(shared.includes(id)){t.active=false;active--;continue;}t.v=t.v.map(k=>k===b?a:k) as [number,number,number];
        const pts=t.v.map(k=>vertices[k].p);t.normal=pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();for(const k of t.v)vertices[k].triangles.add(id);}
      for(const id of nearby)vertices[id].version++;
      const refreshed=new Set<string>();for(const id of nearby)if(vertices[id].active)for(const next of neighbors(id)){const key=[id,next].sort((a,b)=>a-b).join("/");if(!refreshed.has(key)){refreshed.add(key);queue(id,next);}}
    }
  }
  let maxPlaneDeviation=0;for(const v of vertices.filter(v=>v.active))for(const id of v.planes)maxPlaneDeviation=Math.max(maxPlaneDeviation,Math.abs(planes[id].n.dot(v.p)+planes[id].d));
  return {points:vertices.map(v=>v.p),triangles:triangles.filter(t=>t.active).map(t=>t.v),maxPlaneDeviation};
}
