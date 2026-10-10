import { bounds, offsetPaths } from "./polygons";
import { nestRectangles } from "./rectangular-nesting";
import { candidatePaths, candidateBounds, allowedAngles } from "./beam";
import type { Bounds2D, LaserCutPiece, NestedSheet, Path2DLoop, Placement, Point2D, SliceSettings, SlicingProgress } from "./types";

interface Run { a:number; b:number }
interface Mask { rotation:number; rows:Run[][]; order:number[]; width:number; height:number; w:number; h:number; minX:number; minY:number }
interface Bin { sheet:NestedSheet; bits:Uint32Array; stride:number; w:number; h:number; usableWidth:number; usableHeight:number }
const rotatedPaths=candidatePaths;
const rotationBounds=candidateBounds;
export function placedPoint(p:Point2D,piece:LaserCutPiece,placement:Placement):Point2D{
  const a=placement.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),b=rotationBounds(piece,placement.rotation);
  return {x:placement.x+p.x*c-p.y*s-b.minX,y:placement.y+p.x*s+p.y*c-b.minY};
}

// Every cell touched by material is reserved, including boundary cells. A
// half-clearance polygon offset on both parts guarantees the requested gap.
// Holes and open concave pockets remain available instead of reserving boxes.
function rasterMask(piece:LaserCutPiece,angle:number,clearance:number,cell:number):Mask{
  const rotated=rotatedPaths(piece,angle),raw=rotationBounds(piece,angle);
  const paths=offsetPaths(rotated,clearance/2+Math.max(piece.beam?.x??piece.kerf??0,piece.beam?.y??piece.kerf??0)/2),b=bounds(paths);
  const loops=paths.map(l=>l.points.map(p=>({x:(p.x-b.minX)/cell,y:(p.y-b.minY)/cell})));
  const w=Math.max(1,Math.ceil(b.width/cell-1e-8)),h=Math.max(1,Math.ceil(b.height/cell-1e-8)),rows:Run[][]=Array.from({length:h},()=>[]);
  const add=(y:number,x1:number,x2:number)=>{if(y<0||y>=h)return;const a=Math.max(0,Math.floor(Math.min(x1,x2))),end=Math.min(w-1,Math.floor(Math.max(x1,x2)));if(a<=end)rows[y].push({a,b:end});};
  for(let y=0;y<h;y++){
    const hits:number[]=[],scan=y+.5;
    for(const loop of loops)for(let i=0,j=loop.length-1;i<loop.length;j=i++){
      const a=loop[j],b=loop[i];if((a.y<=scan&&b.y>scan)||(b.y<=scan&&a.y>scan))hits.push(a.x+(b.x-a.x)*(scan-a.y)/(b.y-a.y));
    }
    hits.sort((a,b)=>a-b);for(let i=0;i+1<hits.length;i+=2)add(y,hits[i],hits[i+1]);
  }
  for(const loop of loops)for(let i=0,j=loop.length-1;i<loop.length;j=i++){
    const a=loop[j],b=loop[i],lo=Math.max(0,Math.floor(Math.min(a.y,b.y))),hi=Math.min(h-1,Math.floor(Math.max(a.y,b.y)));
    for(let y=lo;y<=hi;y++){
      if(Math.abs(b.y-a.y)<1e-10)add(y,a.x,b.x);
      else{const t1=Math.max(0,Math.min(1,(y-a.y)/(b.y-a.y))),t2=Math.max(0,Math.min(1,(y+1-a.y)/(b.y-a.y)));add(y,a.x+(b.x-a.x)*t1,a.x+(b.x-a.x)*t2);}
    }
  }
  for(let y=0;y<h;y++){const sorted=rows[y].sort((a,b)=>a.a-b.a),joined:Run[]=[];for(const run of sorted){const last=joined.at(-1);if(last&&run.a<=last.b+1)last.b=Math.max(last.b,run.b);else joined.push({...run});}rows[y]=joined;}
  const order=Array.from({length:h},(_,i)=>i).sort((a,b)=>rows[b].reduce((n,r)=>n+r.b-r.a+1,0)-rows[a].reduce((n,r)=>n+r.b-r.a+1,0));
  return {rotation:angle,rows,order,width:b.width,height:b.height,w,h,minX:b.minX-raw.minX,minY:b.minY-raw.minY};
}
const rangeMask=(a:number,b:number)=>((0xffffffff<<a)&(0xffffffff>>>(31-b)))>>>0;
function collisionAdvance(bin:Bin,mask:Mask,x:number,y:number):number{
  if(!bin.bits.length)return x;
  for(const row of mask.order)for(const run of mask.rows[row]){
    const a=x+run.a,b=x+run.b,base=(y+row)*bin.stride;
    for(let word=a>>>5;word<=b>>>5;word++){
      const occupied=bin.bits[base+word]&rangeMask(word===(a>>>5)?a&31:0,word===(b>>>5)?b&31:31);
      if(occupied)return (word*32+31-Math.clz32(occupied))-run.a+1;
    }
  }return x;
}
function reserve(bin:Bin,mask:Mask,x:number,y:number){
  if(!bin.bits.length)bin.bits=new Uint32Array(bin.stride*bin.h);
  mask.rows.forEach((row,j)=>{for(const run of row){const a=x+run.a,b=x+run.b,base=(y+j)*bin.stride;for(let word=a>>>5;word<=b>>>5;word++)bin.bits[base+word]|=rangeMask(word===(a>>>5)?a&31:0,word===(b>>>5)?b&31:31);}});
}
function findFit(bin:Bin,masks:Mask[],cell:number):{mask:Mask;x:number;y:number}|null{
  let best:{mask:Mask;x:number;y:number}|null=null;
  for(const mask of masks){
    const maxX=Math.floor((bin.usableWidth-mask.width+1e-7)/cell),maxY=Math.floor((bin.usableHeight-mask.height+1e-7)/cell);
    if(maxX<0||maxY<0)continue;
    // Bottom-left fill; testing material cells allows bounding boxes to overlap.
    const endY=best?Math.min(maxY,best.y):maxY;
    outer:for(let y=0;y<=endY;y++)for(let x=0;x<=maxX;){const next=collisionAdvance(bin,mask,x,y);if(next===x){if(!best||y<best.y||y===best.y&&x<best.x)best={mask,x,y};break outer;}x=next;}
  }return best;
}
export function nestingResolution(s:SliceSettings):number{
  const maximum=Math.max(s.sheetWidth,s.sheetHeight,...(s.scrapSheets||[]).flatMap(p=>[p.width,p.height]));
  return Math.max(.75,maximum/800);
}
export function* nestPiecesStages(pieces:LaserCutPiece[],s:SliceSettings,onProgress?:(p:SlicingProgress)=>void):Generator<void,{sheets:NestedSheet[];unplaced:string[]},void>{
  if(s.nestingMode==="rectangles"){const result=nestRectangles(pieces,s);onProgress?.({stage:"nesting",completed:pieces.length,total:pieces.length,percent:100});return result;}
  const cell=nestingResolution(s),bins:Bin[]=[],unplaced:string[]=[];
  const addBin=(width:number,height:number,thicknessId:string,source:"scrap"|"stock",scrapId?:string)=>{
    const usableWidth=Math.max(0,width-2*s.sheetMargin),usableHeight=Math.max(0,height-2*s.sheetMargin),w=Math.ceil(usableWidth/cell),h=Math.ceil(usableHeight/cell),stride=Math.ceil(w/32);
    bins.push({w,h,stride,usableWidth,usableHeight,bits:new Uint32Array(0),sheet:{sheetIndex:bins.length,width,height,thicknessId,source,scrapId,placements:[],utilization:0,cutLength:0}});
  };
  for(const scrap of s.scrapSheets||[])for(let i=0;i<scrap.quantity;i++)addBin(scrap.width,scrap.height,scrap.thicknessId,"scrap",scrap.id);
  const sorted=[...pieces].sort((a,b)=>b.bounds.width*b.bounds.height-a.bounds.width*a.bounds.height||b.area-a.area||a.id.localeCompare(b.id));
  onProgress?.({stage:"nesting",completed:0,total:pieces.length,percent:0});
  for(let index=0;index<sorted.length;index++){
    const piece=sorted[index],angles=allowedAngles(piece,s);
    yield;
    const slot=piece.assignedThicknessId||"T1",beam=Math.max(piece.beam?.x??piece.kerf??0,piece.beam?.y??piece.kerf??0),available=[[s.sheetWidth,s.sheetHeight],...(s.scrapSheets||[]).filter(a=>a.thicknessId===slot).map(a=>[a.width,a.height])];
    const feasible=angles.filter(angle=>{const b=rotationBounds(piece,angle);return available.some(([w,h])=>b.width+s.partSpacing+beam<=w-2*s.sheetMargin+1e-7&&b.height+s.partSpacing+beam<=h-2*s.sheetMargin+1e-7);});
    if(!feasible.length){unplaced.push(piece.id);onProgress?.({stage:"nesting",completed:index+1,total:pieces.length,percent:Math.round((index+1)/Math.max(1,pieces.length)*100)});continue;}
    const masks=feasible.map(angle=>rasterMask(piece,angle,s.partSpacing,cell));
    let fit:{bin:Bin;mask:Mask;x:number;y:number}|null=null;
    for(const source of ["scrap","stock"] as const){
      for(const bin of bins){if(bin.sheet.source!==source||bin.sheet.thicknessId!==slot)continue;const found=findFit(bin,masks,cell);if(found){fit={bin,...found};break;}}if(fit)break;
    }
    if(!fit){
      if(masks.some(m=>m.width<=s.sheetWidth-2*s.sheetMargin+1e-7&&m.height<=s.sheetHeight-2*s.sheetMargin+1e-7)){
        addBin(s.sheetWidth,s.sheetHeight,slot,"stock");const bin=bins.at(-1)!,found=findFit(bin,masks,cell);if(found)fit={bin,...found};
      }
    }
    if(!fit)unplaced.push(piece.id);
    else{const {bin,mask,x,y}=fit;reserve(bin,mask,x,y);bin.sheet.placements.push({pieceId:piece.id,x:s.sheetMargin+x*cell-mask.minX,y:s.sheetMargin+y*cell-mask.minY,rotation:mask.rotation});bin.sheet.utilization+=piece.area/(bin.sheet.width!*bin.sheet.height!);bin.sheet.cutLength+=piece.cutLength;}
    onProgress?.({stage:"nesting",completed:index+1,total:pieces.length,percent:Math.round((index+1)/Math.max(1,pieces.length)*100)});
  }
  return {sheets:bins.filter(b=>b.sheet.placements.length).map((b,i)=>({...b.sheet,sheetIndex:i,id:`Sheet-${String(i+1).padStart(2,"0")}`})),unplaced};
}

export function nestPieces(pieces:LaserCutPiece[],s:SliceSettings,onProgress?:(p:SlicingProgress)=>void){const steps=nestPiecesStages(pieces,s,onProgress);let next=steps.next();while(!next.done)next=steps.next();return next.value;}
