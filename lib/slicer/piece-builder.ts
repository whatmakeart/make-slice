import type { LaserCutPiece, Path2DLoop, SliceSettings, Stroke } from "./types";
import { booleanPaths, bounds, interiorPoint, materialArea, offsetPaths, perimeter, splitComponents } from "./polygons";
import { materialFor } from "./materials";
import { vectorLabel } from "./labels";

export function rectangle(x: number, y: number, w: number, h: number): Path2DLoop {
  return { isHole: false, points: [{ x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }] };
}
export function buildPiece(s: SliceSettings, id: string, raw: Path2DLoop[], cuts: Path2DLoop[],
  meta: Partial<LaserCutPiece> = {}, guides: Stroke[] = [], cutStrokes: Stroke[] = []): LaserCutPiece {
  const m = materialFor(s, id, meta.assignedThicknessId);
  const nominal = splitComponents(cuts.length ? booleanPaths(raw, cuts, "difference") : raw).filter(c=>materialArea(c)>=2).flat();
  // A slit is a single cut centerline, but removes a kerf-wide channel in the 3D solid.
  const slitMasks = cutStrokes.flatMap(stroke => stroke.points.slice(1).map((b, i) => {
    const a = stroke.points[i], dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy), r=Math.max(.01,m.laserKerf)/2;
    const nx=-dy/len*r, ny=dx/len*r;
    return { isHole:false, points:[{x:a.x+nx,y:a.y+ny},{x:a.x-nx,y:a.y-ny},{x:b.x-nx,y:b.y-ny},{x:b.x+nx,y:b.y+ny}] };
  }));
  const assemblyPaths = slitMasks.length ? booleanPaths(nominal, slitMasks, "difference") : nominal;
  const cutPaths = offsetPaths(nominal, m.laserKerf/2);
  const etchPaths = [...vectorLabel(id, nominal, interiorPoint(nominal)), ...guides];
  return { id, label:id, parentId:id, axis:"Z", sliceIndex:0, worldPosition:0,
    unmodifiedPaths:raw, assemblyPaths, cutPaths, etchPaths, cutStrokes,
    interiorRegions:cuts, bounds:bounds(cutPaths), area:materialArea(assemblyPaths),
    cutLength:perimeter(cutPaths)+cutStrokes.reduce((n,l)=>n+l.points.slice(1).reduce((v,p,i)=>v+Math.hypot(p.x-l.points[i].x,p.y-l.points[i].y),0),0),
    joints:[], assignedThicknessId:m.id, thickness:m.thickness, kerf:m.laserKerf, ...meta,
  };
}
