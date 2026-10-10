import type { LaserCutPiece, Path2DLoop, Point2D, SliceSettings } from "./types";
import { bounds, interiorPoint, materialArea, offsetPaths, perimeter, signedArea } from "./polygons";
import { vectorLabel } from "./labels";

export function pinHole(center:Point2D,s:SliceSettings):Path2DLoop{
  const w=s.pinDiameter+s.slotFitTolerance,h=s.materialThickness+s.slotFitTolerance;
  return {isHole:false,points:[{x:center.x-w/2,y:center.y-h/2},{x:center.x+w/2,y:center.y-h/2},{x:center.x+w/2,y:center.y+h/2},{x:center.x-w/2,y:center.y+h/2}]};
}

export function materialPin(center:Point2D,index:number,depth:number,s:SliceSettings):LaserCutPiece{
  const t=s.materialThickness,w=s.pinDiameter,half=w/2,head=half+t,tip=depth+((s.skipTopLayersCount||0)>0?0:t),chamfer=Math.min(t/2,w/4);
  // The head seats below layer 1. The stem passes through the full stack and
  // protrudes by one material thickness; its chamfer eases insertion.
  const profile=[[-head,-t],[head,-t],[head,0],[half,0],[half,tip-chamfer],[half-chamfer,tip],[-half+chamfer,tip],[-half,tip-chamfer],[-half,0],[-head,0]];
  const points=profile.map(([u,v])=>s.stackedAxis==="X"?{x:v,y:center.x+u}:{x:center.x+u,y:v});
  if(signedArea(points)<0)points.reverse();
  const paths:Path2DLoop[]=[{isHole:false,points}],cut=offsetPaths(paths,s.laserKerf/2);
  const id=`P-${String(index+1).padStart(2,"0")}`;
  return {id,label:id,parentId:id,kind:"alignment-pin",axis:s.stackedAxis==="Z"?"Y":"Z",sliceIndex:index,worldPosition:center.y,
    unmodifiedPaths:paths,assemblyPaths:paths,cutPaths:cut,etchPaths:vectorLabel(id,paths,interiorPoint(paths)),bounds:bounds(cut),area:materialArea(paths),cutLength:perimeter(cut),joints:[],category:"alignment_pin",assignedThicknessId:"T1",thickness:t,kerf:s.laserKerf};
}
