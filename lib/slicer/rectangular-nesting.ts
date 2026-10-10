import type { LaserCutPiece, NestedSheet, Placement, Point2D, SliceSettings } from "./types";
import { allowedAngles, candidateBounds } from "./beam";
interface Rect {x:number;y:number;w:number;h:number}
function contains(a:Rect,b:Rect){return b.x>=a.x-1e-8&&b.y>=a.y-1e-8&&b.x+b.w<=a.x+a.w+1e-8&&b.y+b.h<=a.y+a.h+1e-8;}
function reserve(free:Rect[],used:Rect):Rect[]{
  const next:Rect[]=[];
  for(const r of free){
    if(used.x>=r.x+r.w-1e-8||used.x+used.w<=r.x+1e-8||used.y>=r.y+r.h-1e-8||used.y+used.h<=r.y+1e-8){next.push(r);continue;}
    if(used.x>r.x)next.push({x:r.x,y:r.y,w:used.x-r.x,h:r.h});
    if(used.x+used.w<r.x+r.w)next.push({x:used.x+used.w,y:r.y,w:r.x+r.w-used.x-used.w,h:r.h});
    if(used.y>r.y)next.push({x:r.x,y:r.y,w:r.w,h:used.y-r.y});
    if(used.y+used.h<r.y+r.h)next.push({x:r.x,y:used.y+used.h,w:r.w,h:r.y+r.h-used.y-used.h});
  }
  return next.filter((r,i)=>r.w>1e-8&&r.h>1e-8&&!next.some((s,j)=>j!==i&&contains(s,r)&&(!contains(r,s)||j<i)));
}
export function nestRectangles(pieces:LaserCutPiece[],s:SliceSettings):{sheets:NestedSheet[];unplaced:string[]}{
  const bins:{free:Rect[];sheet:NestedSheet}[]=[],unplaced:string[]=[];
  const addBin=(width:number,height:number,thicknessId:string,source:"scrap"|"stock",scrapId?:string)=>{
    bins.push({free:[{x:0,y:0,w:Math.max(0,width-2*s.sheetMargin),h:Math.max(0,height-2*s.sheetMargin)}],
      sheet:{sheetIndex:bins.length,id:`${source}-${bins.length+1}`,width,height,thicknessId,source,scrapId,placements:[],utilization:0,cutLength:0}});
  };
  // Inventory is finite; standard stock is created only when matching scraps cannot fit a part.
  for(const scrap of s.scrapSheets||[])for(let i=0;i<scrap.quantity;i++)addBin(scrap.width,scrap.height,scrap.thicknessId,"scrap",scrap.id);
  const sorted=[...pieces].sort((a,b)=>b.bounds.width*b.bounds.height-a.bounds.width*a.bounds.height||a.id.localeCompare(b.id));
  for(const piece of sorted){
    const beam=Math.max(piece.beam?.x??piece.kerf??0,piece.beam?.y??piece.kerf??0),clearance=s.partSpacing+beam,slot=piece.assignedThicknessId||"T1",angles=allowedAngles(piece,{...s,rotationStep:90});
    let best:{bin:number;rect:Rect;rotation:number;short:number;long:number}|null=null;
    const evaluate=(index:number)=>{
      if(bins[index].sheet.thicknessId!==slot)return;
      for(const r of bins[index].free)for(const rot of angles){
        const box=candidateBounds(piece,rot),rw=box.width+clearance,rh=box.height+clearance;if(rw>r.w+1e-8||rh>r.h+1e-8)continue;
        const short=Math.min(r.w-rw,r.h-rh),long=Math.max(r.w-rw,r.h-rh);
        if(!best||short<best.short-1e-8||(Math.abs(short-best.short)<1e-8&&long<best.long))best={bin:index,rect:{x:r.x,y:r.y,w:rw,h:rh},rotation:rot,short,long};
      }
    };
    for(const source of ["scrap","stock"] as const){for(let i=0;i<bins.length;i++)if(bins[i].sheet.source===source)evaluate(i);if(best)break;}
    if(!best){
      const W=s.sheetWidth-s.sheetMargin*2,H=s.sheetHeight-s.sheetMargin*2;
      if(!angles.some(a=>{const b=candidateBounds(piece,a);return b.width+clearance<=W&&b.height+clearance<=H;})){unplaced.push(piece.id);continue;}
      addBin(s.sheetWidth,s.sheetHeight,slot,"stock");evaluate(bins.length-1);
    }
    const fit=best as {bin:number;rect:Rect;rotation:number}|null;
    if(!fit){unplaced.push(piece.id);continue;}
    const bin=bins[fit.bin];bin.free=reserve(bin.free,fit.rect);
    bin.sheet.placements.push({pieceId:piece.id,x:fit.rect.x+s.sheetMargin+clearance/2,y:fit.rect.y+s.sheetMargin+clearance/2,rotation:fit.rotation});
    bin.sheet.utilization+=piece.area/(bin.sheet.width!*bin.sheet.height!);bin.sheet.cutLength+=piece.cutLength;
  }
  return {sheets:bins.filter(b=>b.sheet.placements.length).map((b,i)=>({...b.sheet,sheetIndex:i,id:`Sheet-${String(i+1).padStart(2,"0")}`})),unplaced};
}
export function placedPoint(p:Point2D,piece:LaserCutPiece,placement:Placement):Point2D{
  if(placement.rotation===90)return {x:placement.x+piece.bounds.maxY-p.y,y:placement.y+p.x-piece.bounds.minX};
  return {x:placement.x+p.x-piece.bounds.minX,y:placement.y+p.y-piece.bounds.minY};
}
