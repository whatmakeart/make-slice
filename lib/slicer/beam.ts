import { bounds, offsetPaths, inLoop } from "./polygons";
import type { LaserCutPiece, Path2DLoop, Point2D, SliceSettings } from "./types";
import { materials } from "./materials";

export function rotatePoint(p:Point2D,angle:number):Point2D{
  const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return {x:p.x*c-p.y*s,y:p.x*s+p.y*c};
}
export function rotateLoops(paths:Path2DLoop[],angle:number){return paths.map(p=>({...p,points:p.points.map(q=>rotatePoint(q,angle))}));}
// Elliptical beam approximation, in fixed machine coordinates. Affine scaling
// makes the ellipse a circle. Straight parallel edges retain the measured full
// cut width; corners follow the same miter convention as isotropic compensation.
export function compensate(paths:Path2DLoop[],x:number,y=x):Path2DLoop[]{
  if(Math.abs(x-y)<1e-9)return offsetPaths(paths,x/2);
  const rx=Math.max(.00005,x/2),ry=Math.max(.00005,y/2);
  const scaled=paths.map(p=>({...p,points:p.points.map(q=>({x:q.x/rx,y:q.y/ry}))}));
  return offsetPaths(scaled,1).map(p=>({...p,points:p.points.map(q=>({x:q.x*rx,y:q.y*ry}))}));
}
const candidates=new WeakMap<LaserCutPiece,Map<number,Path2DLoop[]>>();
export function candidatePaths(piece:LaserCutPiece,angle:number):Path2DLoop[]{
  let cache=candidates.get(piece);if(!cache){cache=new Map();candidates.set(piece,cache);}
  let paths=cache.get(angle);if(!paths){paths=piece.beam?compensate(rotateLoops(piece.assemblyPaths,angle),piece.beam.x,piece.beam.y):rotateLoops(piece.cutPaths,angle);cache.set(angle,paths);}return paths;
}
export const candidateBounds=(p:LaserCutPiece,a:number)=>bounds(candidatePaths(p,a));
export function allowedAngles(p:LaserCutPiece,s:SliceSettings):number[]{
  const rule=p.rotationConstraint||"free",base=p.stockOrientation==="machine_y"?90:0;
  if(!s.allowRotation)return [base];
  const step=rule==="fixed"?360:rule==="half_turn"?180:rule==="quarter_turn"?90:s.rotationStep||90;
  return Array.from({length:360/step},(_,i)=>(base+i*step)%360);
}
export function bindStock(pieces:LaserCutPiece[],s:SliceSettings):LaserCutPiece[]{
  const stocks=materials(s);
  return pieces.map(p=>{const m=stocks.find(m=>m.id===(p.assignedThicknessId||"T1"))!;
    const x=m.kerfX??m.laserKerf,y=m.kerfY??m.laserKerf;
    const cutPaths=compensate(p.assemblyPaths,x,y);
    for(const l of cutPaths)if(l.isHole){const b=bounds([l]),c={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};if(p.cutPaths.some(q=>q.isRegistration&&inLoop(c,q.points)))l.isRegistration=true;}
    return {...p,cutPaths,bounds:bounds(cutPaths),kerf:m.laserKerf,beam:{x,y},rotationConstraint:m.rotationConstraint,stockOrientation:m.stockOrientation};
  });
}
export function bindOrientation(pieces:LaserCutPiece[],s:SliceSettings):LaserCutPiece[]{
  const stocks=materials(s);
  return pieces.map(p=>{const m=stocks.find(m=>m.id===(p.assignedThicknessId||"T1"))!;
    return p.rotationConstraint===m.rotationConstraint&&p.stockOrientation===m.stockOrientation?p:{...p,rotationConstraint:m.rotationConstraint,stockOrientation:m.stockOrientation};
  });
}
export function beamRadius(p:LaserCutPiece,n:Point2D):number{
  const x=p.beam?.x??p.kerf??0,y=p.beam?.y??p.kerf??0;
  return Math.hypot(x*n.x,y*n.y)/2;
}
