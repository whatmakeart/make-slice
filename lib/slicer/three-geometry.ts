import * as THREE from "three";
import type { LaserCutPiece } from "./types";
import { inLoop } from "./polygons";
function cleanRing(points:{x:number;y:number}[]){
  const p=points.map(q=>({...q}));let changed=true;
  while(changed&&p.length>3){changed=false;for(let i=0;i<p.length;i++){
    const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],dx=c.x-a.x,dy=c.y-a.y,len=Math.hypot(dx,dy);
    if(len<1e-7||Math.abs(dx*(b.y-a.y)-dy*(b.x-a.x))/len<.00015&&((b.x-a.x)*dx+(b.y-a.y)*dy)>=0&&((b.x-c.x)*dx+(b.y-c.y)*dy)<=0){p.splice(i,1);changed=true;break;}
  }}return p;
}
export function pieceShapes(piece:LaserCutPiece):THREE.Shape[]{
  return piece.assemblyPaths.filter(l=>!l.isHole).map(outer=>{
    const shape=new THREE.Shape(cleanRing(outer.points).map(p=>new THREE.Vector2(p.x,p.y)));
    for(const hole of piece.assemblyPaths.filter(l=>l.isHole&&inLoop(l.points[0],outer.points)))shape.holes.push(new THREE.Path(cleanRing(hole.points).map(p=>new THREE.Vector2(p.x,p.y))));
    return shape;
  });
}
export function assembledPosition(piece:LaserCutPiece):THREE.Vector3 {
  const position=piece.bendPath?new THREE.Vector3():piece.worldTransform?new THREE.Vector3(...piece.worldTransform.position):new THREE.Vector3(piece.axis==="X"?piece.worldPosition:0,piece.axis==="Y"?piece.worldPosition:0,piece.axis==="Z"?piece.worldPosition:0);
  if(piece.frameRotation)position.applyQuaternion(new THREE.Quaternion(...piece.frameRotation));
  if(piece.framePosition)position.add(new THREE.Vector3(...piece.framePosition));
  return position;
}
export function explosionVector(piece:LaserCutPiece,result:{dimensions:[number,number,number];layerCount:number;settings:{mode:string;xSliceCount:number;ySliceCount:number;materialThickness:number}},amount:number):THREE.Vector3{
  if(piece.kind==="alignment-pin")return new THREE.Vector3();
  if(piece.explodeDirection)return new THREE.Vector3(...piece.explodeDirection).multiplyScalar(amount/100*Math.max(...result.dimensions)*.7);
  const center=result.settings.mode==="stacked"?(result.layerCount-1)/2:piece.axis==="X"?(result.settings.xSliceCount-1)/2:(result.settings.ySliceCount-1)/2;
  const d=amount/100*(piece.sliceIndex-center)*result.settings.materialThickness*3.5;
  return new THREE.Vector3(piece.axis==="X"?d:0,piece.axis==="Y"?d:0,piece.axis==="Z"?d:0);
}
function bendGeometry(source:THREE.BufferGeometry,path:{x:number;y:number}[],z0:number,developed?:number[]):THREE.BufferGeometry{
  const cumulative=[0],normals:THREE.Vector2[]=[];
  for(let i=1;i<path.length;i++){const dx=path[i].x-path[i-1].x,dy=path[i].y-path[i-1].y,len=Math.hypot(dx,dy);cumulative.push(cumulative.at(-1)!+len);normals.push(new THREE.Vector2(dy/len,-dx/len));}
  if(developed?.length===cumulative.length)cumulative.splice(0,cumulative.length,...developed);
  const atVertex=(i:number)=>{if(i===0)return normals[0];if(i===path.length-1)return normals.at(-1)!;const avg=normals[i-1].clone().add(normals[i]).normalize();return avg.multiplyScalar(1/Math.max(.5,avg.dot(normals[i])));};
  const map=(v:THREE.Vector3)=>{
    const u=v.x;let i=1;while(i<cumulative.length-1&&cumulative[i]<u)i++;
    const a=path[i-1],b=path[i],f=(u-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);
    const n=f<0?atVertex(0).clone():f>1?atVertex(path.length-1).clone():atVertex(i-1).clone().lerp(atVertex(i),f);
    return [a.x+(b.x-a.x)*f+n.x*v.z,a.y+(b.y-a.y)*f+n.y*v.z,z0+v.y];
  };
  // Split faces on each bend plane before deforming; otherwise a large triangle chords across the curve.
  const clip=(poly:THREE.Vector3[],u:number,greater:boolean)=>{
    const out:THREE.Vector3[]=[];
    for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ain=greater?a.x>=u-1e-7:a.x<=u+1e-7,bin=greater?b.x>=u-1e-7:b.x<=u+1e-7;
      if(ain)out.push(a);if(ain!==bin)out.push(a.clone().lerp(b,(u-a.x)/(b.x-a.x)));
    }return out;
  };
  const pos=source.getAttribute("position"),out:number[]=[];
  for(let j=0;j<pos.count;j+=3){const tri=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(pos,j+k)),lo=Math.min(...tri.map(v=>v.x)),hi=Math.max(...tri.map(v=>v.x));
    for(let i=1;i<cumulative.length;i++){
      const lower=i===1?-Infinity:cumulative[i-1],upper=i===cumulative.length-1?Infinity:cumulative[i];
      if(lo>upper+1e-7||hi<lower-1e-7)continue;
      const poly=Number.isFinite(upper)?clip(Number.isFinite(lower)?clip(tri,lower,true):tri,upper,false):Number.isFinite(lower)?clip(tri,lower,true):tri;
      for(let k=1;k<poly.length-1;k++){if(poly[k].clone().sub(poly[0]).cross(poly[k+1].clone().sub(poly[0])).lengthSq()<1e-24)continue;out.push(...map(poly[0]),...map(poly[k]),...map(poly[k+1]));}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(out,3));g.computeVertexNormals();g.addGroup(0,out.length/3,0);source.dispose();return g;
}
export function pieceGeometry(piece:LaserCutPiece,thickness=piece.thickness||3.8):THREE.BufferGeometry{
  let geometry:THREE.BufferGeometry=new THREE.ExtrudeGeometry(pieceShapes(piece),{depth:thickness,bevelEnabled:false,curveSegments:2,steps:1});
  geometry.translate(0,0,-thickness/2);
  if(piece.bendPath)geometry=bendGeometry(geometry,piece.bendPath,piece.bendZ||0,piece.bendDistances);
  else if(piece.worldTransform)geometry.applyQuaternion(new THREE.Quaternion(...piece.worldTransform.rotation));
  else if(piece.axis==="X")geometry.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,0)));
  else if(piece.axis==="Y")geometry.rotateX(Math.PI/2);
  if(piece.frameRotation)geometry.applyQuaternion(new THREE.Quaternion(...piece.frameRotation));
  return geometry;
}
