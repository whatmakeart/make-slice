import { sheetToolpaths, type Toolpath } from "./operations";
import { beamRadius } from "./beam";
import { inMaterial } from "./polygons";
import { materials } from "./materials";
import { placedPoint } from "./nesting";
import type { CutAudit, Issue, LaserCutPiece, Point2D, SliceResult } from "./types";

interface Segment {a:Point2D;b:Point2D;path:Toolpath;part:LaserCutPiece;index:number;count:number;serial:number;arc:number;totalArc:number;length:number}
const dist=(a:Point2D,b:Point2D)=>Math.hypot(a.x-b.x,a.y-b.y);
function closest(p:Point2D,a:Point2D,b:Point2D){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return {x:a.x+t*dx,y:a.y+t*dy};}
export function segmentSeparation(a:Point2D,b:Point2D,c:Point2D,d:Point2D):{distance:number;a:Point2D;b:Point2D}{
  const cross=(u:Point2D,v:Point2D)=>u.x*v.y-u.y*v.x,ab={x:b.x-a.x,y:b.y-a.y},cd={x:d.x-c.x,y:d.y-c.y},ac={x:c.x-a.x,y:c.y-a.y},den=cross(ab,cd);
  if(Math.abs(den)>1e-12){const t=cross(ac,cd)/den,u=cross(ac,ab)/den;if(t>=0&&t<=1&&u>=0&&u<=1){const p={x:a.x+t*ab.x,y:a.y+t*ab.y};return {distance:0,a:p,b:p};}}
  return [[a,closest(a,c,d)],[b,closest(b,c,d)],[closest(c,a,b),c],[closest(d,a,b),d]].map(([a,b])=>({a,b,distance:dist(a,b)})).sort((x,y)=>x.distance-y.distance)[0];
}
function normal(s:Segment,t:Segment,a:Point2D,b:Point2D){const length=dist(a,b);if(length>1e-8)return {x:(b.x-a.x)/length,y:(b.y-a.y)/length};const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,n=Math.hypot(dx,dy)||1;return {x:-dy/n,y:dx/n};}
export function* auditCutsStages(result:SliceResult):Generator<void,CutAudit,void>{
  const tolerance=result.settings.auditTolerance??.02,issues:Issue[]=[],pieces=new Map(result.pieces.map(p=>[p.id,p])),stocks=materials(result.settings),seenIssues=new Set<string>();
  let checkedPaths=0,checkedPairs=0,minimum=Infinity,truncated=false;
  const indexes=new Map<string,number>();
  const report=(key:string,i:Issue)=>{if(seenIssues.has(key)){const index=indexes.get(key);if(index!==undefined&&(i.severity==="error"&&issues[index].severity!=="error"||(i.minimumSeparationMm??Infinity)<(issues[index].minimumSeparationMm??Infinity)))issues[index]=i;return;}seenIssues.add(key);if(issues.length>=300){truncated=true;if(i.severity==="error"){const index=issues.findIndex(i=>i.severity==="warning");if(index>=0){for(const [key,value] of indexes)if(value===index)indexes.delete(key);indexes.set(key,index);issues[index]=i;}}return;}indexes.set(key,issues.length);issues.push(i);};
  for(const sheet of result.sheets){
    yield;
    const paths=sheetToolpaths(result,sheet,false),segments:Segment[]=[],grid=new Map<string,number[]>(),tested=new Set<string>(),stock=stocks.find(m=>m.id===sheet.thicknessId),web=stock?.minimumWeb??.25;
    const placedNominal=new Map(sheet.placements.map(pl=>{const p=pieces.get(pl.pieceId)!;return [p.id,p.assemblyPaths.map(l=>({...l,points:l.points.map(q=>placedPoint(q,p,pl))}))];}));
    const W=sheet.width||result.settings.sheetWidth,H=sheet.height||result.settings.sheetHeight;
    for(const path of paths){yield;checkedPaths++;const part=pieces.get(path.pieceId!)!,pts=path.points;
      if(pts.length<(path.closed?3:2)||pts.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))){report(`invalid/${path.id}`,{code:"invalid-cut",severity:"error",kind:"invalid",message:"A cut path is empty or has non-finite coordinates.",partIds:[part.id],pathIds:[path.id!],sheetIndex:sheet.sheetIndex,consequence:"This path cannot be cut.",adjustment:"Repair the source contour or reduce the joint/offset settings."});continue;}
      const count=path.closed?pts.length:pts.length-1,lengths=Array.from({length:count},(_,i)=>dist(pts[i],pts[(i+1)%pts.length])),totalArc=lengths.reduce((a,b)=>a+b,0);let arc=0;
      for(let i=0;i<count;i++){const a=pts[i],b=pts[(i+1)%pts.length];if(dist(a,b)<1e-7){report(`zero/${path.id}`,{code:"cut-zero-length",severity:"warning",kind:"invalid",message:`${part.id}: zero-length cut segment.`,partIds:[part.id],pathIds:[path.id!],sheetIndex:sheet.sheetIndex,location:a,consequence:"This segment makes no cut and may be discarded by CAM.",adjustment:"Remove repeated contour points and verify the joined perimeter."});continue;}
        const sx=beamRadius(part,{x:1,y:0}),sy=beamRadius(part,{x:0,y:1}),edge=Math.min(a.x-sx,b.x-sx,W-a.x-sx,W-b.x-sx,a.y-sy,b.y-sy,H-a.y-sy,H-b.y-sy);
        if(edge<result.settings.sheetMargin-tolerance)report(`edge/${part.id}/${sheet.sheetIndex}`,{code:"cut-sheet-edge",severity:edge < -tolerance?"error":"warning",kind:"clearance",message:`${part.id}: beam envelope leaves ${edge.toFixed(3)} mm to the sheet edge.`,partIds:[part.id],pathIds:[path.id!],sheetIndex:sheet.sheetIndex,minimumSeparationMm:edge,location:a,consequence:"Removed material reaches the bed margin or outside the stock.",adjustment:"Increase the sheet margin or use a larger sheet."});
        segments.push({a,b,path,part,index:i,count,serial:segments.length,arc,totalArc,length:lengths[i]});arc+=lengths[i];
      }
    }
    const reach=Math.max(result.settings.partSpacing,web,tolerance)+Math.max(stock?.kerfX??stock?.laserKerf??0,stock?.kerfY??stock?.laserKerf??0),cell=Math.max(16,reach*2);
    for(const s of segments){
      if(s.serial%64===0)yield;
      const x0=Math.floor((Math.min(s.a.x,s.b.x)-reach)/cell),x1=Math.floor((Math.max(s.a.x,s.b.x)+reach)/cell),y0=Math.floor((Math.min(s.a.y,s.b.y)-reach)/cell),y1=Math.floor((Math.max(s.a.y,s.b.y)+reach)/cell);
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=`${x},${y}`,ids=grid.get(key)||[];
        for(const id of ids){const t=segments[id],pair=`${id}/${s.serial}`;if(tested.has(pair))continue;tested.add(pair);
          const samePath=s.path.id===t.path.id,samePart=s.part.id===t.part.id;
          const duplicate=(dist(s.a,t.a)<1e-6&&dist(s.b,t.b)<1e-6)||(dist(s.a,t.b)<1e-6&&dist(s.b,t.a)<1e-6);
          const delta=Math.abs(s.index-t.index);if(!duplicate&&samePath&&(delta<=1||s.path.closed&&delta>=s.count-1))continue;
          checkedPairs++;const sep=segmentSeparation(s.a,s.b,t.a,t.b),n=normal(s,t,sep.a,sep.b),gap=sep.distance-beamRadius(s.part,n)-beamRadius(t.part,n),location={x:(sep.a.x+sep.b.x)/2,y:(sep.a.y+sep.b.y)/2};
          if(!duplicate&&samePath&&s.path.closed&&sep.distance>1e-7){
            // Dense tessellation and slot shoulders put non-adjacent segments close
            // together along one corner. A web spans distinct boundary branches:
            // reaching the other side around the contour takes a substantial detour.
            // Measure that detour from the actual closest points, not segment centers.
            const along=Math.abs(s.arc+dist(s.a,sep.a)-t.arc-dist(t.a,sep.b));
            if(Math.min(along,s.totalArc-along)<=3*sep.distance+1e-6)continue;
          }
          if(samePart&&sep.distance<tolerance&&!duplicate&&(!samePath)&&(dist(s.a,t.a)<tolerance||dist(s.a,t.b)<tolerance||dist(s.b,t.a)<tolerance||dist(s.b,t.b)<tolerance))continue; // Intentional slit endpoints at an aperture.
          if(samePart&&sep.distance>1e-7&&gap> -tolerance&&!inMaterial(location,placedNominal.get(s.part.id)!))continue; // Empty apertures are not a fragile material web; actual crossings stay blocking.
          if(!samePart)minimum=Math.min(minimum,gap);
          const threshold=samePart?web:result.settings.partSpacing;
          if(!duplicate&&gap>=threshold-tolerance)continue;
          const kind=duplicate?"duplicate":sep.distance<1e-7?"intersection":samePart?"web":"clearance";
          const severity:Issue["severity"]=duplicate||(!samePart&&gap< -tolerance)||sep.distance<1e-7?"error":"warning";
          const parts=[...new Set([s.part.id,t.part.id])],pathIds=[...new Set([s.path.id!,t.path.id!])],key=`${sheet.sheetIndex}/${kind}/${[...pathIds].sort().join("|")}`;
          report(key,{code:`cut-${kind}`,kind,severity,sheetIndex:sheet.sheetIndex,partIds:parts,pathIds,minimumSeparationMm:gap,location,message:`${parts.join(" / ")}: ${kind==="duplicate"?"duplicate cut segment":kind==="intersection"?"cut paths intersect":`${kind==="web"?"remaining web":"beam separation"} ${gap.toFixed(3)} mm`}.`,consequence:duplicate?"The same segment would be cut twice.":severity==="error"?"Cuts may sever a part or remove its neighbor.":"The remaining material is below the configured gap/web threshold.",adjustment:samePart?"Reduce kerf or enlarge this feature; test the material's minimum bridge width.":"Increase part spacing and nest again. Shared edges are not merged automatically."});
        }
        ids.push(s.serial);grid.set(key,ids);
      }
    }
  }
  if(truncated)issues.push({code:"cut-audit-summary",severity:"warning",message:`${seenIssues.size} cut issues found. The 300 representative issues shown include blocking errors; inspect the geometry before cutting.`,consequence:"Some repeated markers are summarized to keep the inspector usable.",adjustment:"Resolve the highlighted issues and repeat the audit."});
  return {issues,checkedPaths,checkedPairs,toleranceMm:tolerance,minimumSeparationMm:Number.isFinite(minimum)?minimum:null,truncated,totalIssues:seenIssues.size};
}
export function* checkResultStages(result:SliceResult):Generator<void,SliceResult,void>{
  const audit=yield* auditCutsStages(result);return {...result,audit,issues:[...result.issues.filter(i=>!i.code.startsWith("cut-")),...audit.issues]};
}
export function auditCuts(result:SliceResult){const stages=auditCutsStages(result);let next=stages.next();while(!next.done)next=stages.next();return next.value;}
export function checkResult(result:SliceResult){const stages=checkResultStages(result);let next=stages.next();while(!next.done)next=stages.next();return next.value;}
