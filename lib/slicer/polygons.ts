import ClipperLib from "clipper-lib";
import type { Bounds2D, Path2DLoop, Point2D } from "./types";
export const SCALE = 10000;
export const EPS = 0.0001;
export function signedArea(points: Point2D[]): number {
  let a=0;for(let i=0,j=points.length-1;i<points.length;j=i++)a+=points[j].x*points[i].y-points[i].x*points[j].y;return a/2;
}
export function bounds(loops: Path2DLoop[]): Bounds2D {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const l of loops)for(const p of l.points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
export function toInt(loops: Path2DLoop[]): ClipperLib.Paths {
  return loops.map(l=>l.points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)})));
}
function fromTree(tree: ClipperLib.PolyTree): Path2DLoop[] {
  const out:Path2DLoop[]=[];
  function walk(n:ClipperLib.PolyNode){for(const c of n.Childs()){const hole=c.IsHole();const pts=ClipperLib.Clipper.CleanPolygon(c.Contour(),1.1).map(p=>({x:p.X/SCALE,y:p.Y/SCALE}));if(pts.length>=3){if((signedArea(pts)>0)===hole)pts.reverse();out.push({isHole:hole,points:pts});}walk(c);}}
  walk(tree);return out;
}
export function booleanPaths(subject:Path2DLoop[],clip:Path2DLoop[],op:"union"|"difference"|"intersection",evenOdd=false):Path2DLoop[]{
  if(!subject.length)return [];
  const c=new ClipperLib.Clipper();c.StrictlySimple=true;
  c.AddPaths(toInt(subject),ClipperLib.PolyType.ptSubject,true);
  if(clip.length)c.AddPaths(toInt(clip),ClipperLib.PolyType.ptClip,true);
  const tree=new ClipperLib.PolyTree();const fill=evenOdd?ClipperLib.PolyFillType.pftEvenOdd:ClipperLib.PolyFillType.pftNonZero;
  c.Execute(op==="union"?ClipperLib.ClipType.ctUnion:op==="difference"?ClipperLib.ClipType.ctDifference:ClipperLib.ClipType.ctIntersection,tree,fill,ClipperLib.PolyFillType.pftNonZero);
  return fromTree(tree);
}
export function offsetPaths(loops:Path2DLoop[],delta:number):Path2DLoop[]{
  if(!loops.length)return [];if(Math.abs(delta)<EPS/10)return loops.map(l=>({...l,points:l.points.map(p=>({...p}))}));
  const o=new ClipperLib.ClipperOffset(2,0.002*SCALE);o.AddPaths(toInt(loops),ClipperLib.JoinType.jtMiter,ClipperLib.EndType.etClosedPolygon);
  const tree=new ClipperLib.PolyTree();o.Execute(tree,delta*SCALE);return fromTree(tree);
}
export function inLoop(p:Point2D,points:Point2D[]):boolean{
  let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;
}
export function inMaterial(p:Point2D,loops:Path2DLoop[]):boolean{let yes=false;for(const l of loops)if(inLoop(p,l.points))yes=!yes;return yes;}
export function splitComponents(loops:Path2DLoop[]):Path2DLoop[][]{
  const outers=loops.filter(l=>!l.isHole).map(l=>[l]);
  for(const hole of loops.filter(l=>l.isHole)){
    const candidates=outers.filter(ls=>inLoop(hole.points[0],ls[0].points));
    candidates.sort((a,b)=>Math.abs(signedArea(a[0].points))-Math.abs(signedArea(b[0].points)));
    if(candidates[0])candidates[0].push(hole);
  }return outers;
}
export function materialArea(loops:Path2DLoop[]):number{return loops.reduce((a,l)=>a+(l.isHole?-1:1)*Math.abs(signedArea(l.points)),0);}
export function perimeter(loops:Path2DLoop[]):number{let n=0;for(const l of loops)for(let i=0,j=l.points.length-1;i<l.points.length;j=i++)n+=Math.hypot(l.points[i].x-l.points[j].x,l.points[i].y-l.points[j].y);return n;}
export function pointClearance(p:Point2D,loops:Path2DLoop[]):number{
  let d=Infinity;
  for(const l of loops)for(let i=0,j=l.points.length-1;i<l.points.length;j=i++){
    const a=l.points[j],b=l.points[i],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    d=Math.min(d,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));
  }return inMaterial(p,loops)?d:-d;
}
export function interiorPoint(loops:Path2DLoop[]):{point:Point2D;clearance:number}{
  const b=bounds(loops);let best={point:{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2},clearance:-Infinity};
  const nx=18,ny=18;
  for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){const p={x:b.minX+(x+.5)*b.width/nx,y:b.minY+(y+.5)*b.height/ny};const d=pointClearance(p,loops);if(d>best.clearance)best={point:p,clearance:d};}
  let step=Math.max(b.width,b.height)/18;
  for(let i=0;i<7;i++){const base=best.point;for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++){const p={x:base.x+x*step,y:base.y+y*step},d=pointClearance(p,loops);if(d>best.clearance)best={point:p,clearance:d};}step/=2;}
  return best;
}
export function circle(center:Point2D,r:number):Path2DLoop{
  return {isHole:false,points:Array.from({length:96},(_,i)=>({x:center.x+r*Math.cos(i*Math.PI*2/96),y:center.y+r*Math.sin(i*Math.PI*2/96)}))};
}
export function scanIntervals(loops:Path2DLoop[],u:number):[number,number][]{
  const hits:number[]=[];
  for(const l of loops)for(let i=0,j=l.points.length-1;i<l.points.length;j=i++){
    const a=l.points[j],b=l.points[i];if((a.x<=u&&b.x>u)||(b.x<=u&&a.x>u))hits.push(a.y+(b.y-a.y)*(u-a.x)/(b.x-a.x));
  }hits.sort((a,b)=>a-b);
  const spans:[number,number][]=[];for(let i=0;i+1<hits.length;i+=2)if(hits[i+1]-hits[i]>EPS)spans.push([hits[i],hits[i+1]]);return spans;
}
