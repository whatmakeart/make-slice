import { Vector3 } from "three";
import { partDrawings, spreadDrawings, type Face, type PartDrawing } from "./assembly-diagram";
import { bounds } from "./polygons";
import { MATERIAL_NAMES, materials, pieceMaterial } from "./materials";
import { VectorPage, vectorPDF } from "./vector-document";
import { BRAND_PRINT_IMAGE } from "../brand-logo";
import type { Bounds2D, LaserCutPiece, Point2D, SliceResult } from "./types";

export type GuidePageSize="letter"|"a4";
const num=(v:number)=>Number(v.toFixed(1)).toString();
const project=(p:Vector3):Point2D=>({x:(p.x+p.y)/Math.sqrt(2),y:(p.x-p.y)/Math.sqrt(6)-p.z*Math.sqrt(2/3)});
const depth=(p:Vector3)=>(p.x-p.y+p.z)/Math.sqrt(3);
const item=(i:number)=>String(i+1).padStart(2,"0");
const typeName=(p:LaserCutPiece)=>p.plateRole?`${p.plateRole} contour plate`:p.shellMethod==="contour_bands"?`${p.wallRole==="hole"?"Inner":"Outer"} hinge band`:p.wallRole==="hole"?"Inner tunnel wall":p.kind==="alignment-pin"?"Alignment pin":(p.category||"rib").replace(/_/g," ");
function wrap(value:string,max:number):string[]{
  const lines:string[]=[],words=value.split(/\s+/);let line="";
  for(const word of words){if(line.length+word.length+1>max){if(line)lines.push(line);line="";}if(word.length>max){if(line)lines.push(line);for(let i=0;i<word.length;i+=max)lines.push(word.slice(i,i+max));}else line+=(line?" ":"")+word;}if(line)lines.push(line);return lines;
}
function drawFace(page:VectorPage,face:Face,screen:(p:Point2D)=>Point2D,fill="#ffffff",stroke="#374151",weight=.55){
  page.path(face.paths.map(path=>path.map(screen)),true,{fill});
  page.path(face.edges.map(e=>[screen(e.a),screen(e.b)]),false,{stroke,weight});
}
function drawingBounds(drawings:PartDrawing[]):Bounds2D{
  const points=drawings.flatMap(d=>[{x:d.bounds.minX,y:d.bounds.minY},{x:d.bounds.maxX,y:d.bounds.maxY}]);
  return bounds([{isHole:false,points}]);
}
function exploded(page:VectorPage,r:SliceResult,drawings:PartDrawing[],top:number,height:number){
  const layout=spreadDrawings(r,drawings),b=layout.sourceBounds,scale=Math.min((page.width-170)/(b.width||1),(height-25)/(b.height||1));
  const screen=(p:Point2D)=>({x:page.width/2+(p.x-(b.minX+b.maxX)/2)*scale,y:top+height/2+(p.y-(b.minY+b.maxY)/2)*scale});
  const callouts=layout.placements.filter(p=>p.showCallout),stride=Math.max(1,Math.ceil(callouts.length/22)),shown=callouts.filter((_,i)=>i%stride===0);
  for(const p of shown){const d=drawings[p.index],a=screen(project(d.center)),anchor=screen(project(d.center.clone().add(new Vector3(...p.displacement))));page.line(a,anchor,"#a0aab5",.45,true);}
  const faces=drawings.flatMap((d,i)=>{const delta=new Vector3(...layout.placements[i].displacement),shift=project(delta);return d.faces.map(face=>({face,delta,shift}));}).sort((a,b)=>a.face.depth+depth(a.delta)-b.face.depth-depth(b.delta));
  for(const {face,shift} of faces)drawFace(page,face,p=>screen({x:p.x+shift.x,y:p.y+shift.y}));
  for(const left of [true,false]){
    const items=shown.map(p=>({...p,anchor:screen(project(drawings[p.index].center.clone().add(new Vector3(...p.displacement))))})).filter(p=>(p.anchor.x<page.width/2)===left).sort((a,b)=>a.anchor.y-b.anchor.y);
    items.forEach((p,i)=>{const x=left?49:page.width-49,y=top+20+(i+.5)*(height-40)/Math.max(1,items.length);page.path([[p.anchor,{x:left?70:page.width-70,y},{x:x+(left?10:-10),y}]],false,{stroke:"#7b8796",weight:.5,dashed:true});page.circle(x,y,10);page.text(item(p.index),x,y+3,8,true,"#1f2937","center");page.circle(p.anchor.x,p.anchor.y,1.5,"#374151");});
  }
  page.text(layout.grouped?"Panel groups preserve the assembly. All individual parts follow in the inventory.":stride>1?"Selected reference callouts shown. Every part is numbered in the inventory.":"Dashed axes connect separated parts to their fitted positions.",36,top+height+16,8,false,"#4b5563");
}
interface AssemblyStep {title:string;note:string;indices:number[]}
function assemblySteps(r:SliceResult):AssemblyStep[]{
  const choose=(test:(p:LaserCutPiece)=>boolean)=>r.pieces.flatMap((p,i)=>test(p)?[i]:[]);
  const steps:AssemblyStep[]=[];
  const add=(title:string,note:string,indices:number[])=>{if(indices.length)steps.push({title,note,indices});};
  if(r.settings.mode==="finger_box"){
    if(r.pieces.some(p=>p.shellMethod==="contour_bands")){
      add("Position the first contour plate","Match all PLATE-01 islands to the ghost/reference shape. Numbered bands build upward along the stack axis.",choose(p=>p.plateRole==="bottom"));
      for(let band=0;band<r.layerCount;band++)add(`Build contour band ${item(band)}`,"Pre-bend strips and seat lower tabs. Fit any numbered internal ribs before closing with the next plate. Shared tabs engage opposite halves of a through-slot; glue seams and secure these joints. Keep tunnels clear.",choose(p=>p.bandIndex===band&&p.category!=="box_cap"||p.bandIndex===band+1&&p.category==="box_cap"));
    }else if(r.pieces.some(p=>p.shellMethod==="mesh_panels")){
      const outer=choose(p=>p.wallRole!=="hole"),split=Math.ceil(outer.length/2);
      add("Start the body panels","Match PANEL IDs and adjacent edges. Dry-fit square seams; bevel or glue angled seams.",outer.slice(0,split));
      add("Build the inner tunnels","Keep every opening clear. Match the numbered inner walls to the exploded view.",choose(p=>p.wallRole==="hole"));
      add("Close and support the shell","Fit the remaining panels progressively. Support the form while adhesive cures.",outer.slice(split));
    }else{
      add("Seat the bottom cap","Locate bottom-cap mortises and the matching wall tabs. Keep the joints loose.",choose(p=>p.category==="box_cap"&&p.id.includes("BOTTOM")));
      add("Fit perimeter and tunnel walls","Align wall tenons to cap mortises. Pre-bend hinge strips along blue guides; keep tunnels open.",choose(p=>p.category==="box_wall"||p.category==="box_curved_wall"));
      add("Install internal reinforcement","Half-lap crossed braces, then seat their tabs in the wall and cap anchors.",choose(p=>p.category==="brace"));
      add("Close the top cap","Align all remaining fingers, lower the top cap, and seat joints progressively.",choose(p=>p.category==="box_cap"&&!p.id.includes("BOTTOM")));
    }
  }else if(r.settings.mode==="interlocking"){
    add("Arrange the X ribs","X ribs have slots open toward the top. Arrange etched IDs in numerical order.",choose(p=>p.axis==="X"));
    const y=choose(p=>p.axis==="Y"),split=Math.ceil(y.length/2);
    add("Lower the first Y ribs","Y slots open from below. Engage matching half-laps and leave the joints loose.",y.slice(0,split));
    add("Complete the Y rib family","Add the remaining Y ribs. Seat every joint progressively without forcing it.",y.slice(split));
  }else{
    add("Position alignment pins","Insert cut-material pins from the lowest layer. Dowels use the green circular holes.",choose(p=>p.kind==="alignment-pin"));
    const layers=choose(p=>p.kind!=="alignment-pin").sort((a,b)=>r.pieces[a].sliceIndex-r.pieces[b].sliceIndex),count=Math.min(4,layers.length),chunk=Math.ceil(layers.length/count);
    for(let i=0;i<count;i++)add(i===count-1?"Finish the crown layers":i===0?"Start the lowest layers":"Continue the layer stack",i===count-1?`Stack by etched ID. The final ${r.settings.skipTopLayersCount||0} layers have no pin holes; bond them in position.`:"Stack in numerical order along the selected axis. Match islands to the reference shape.",layers.slice(i*chunk,(i+1)*chunk));
  }
  return steps;
}
export function exportAssemblyGuide(r:SliceResult,pageSize:GuidePageSize="letter",projectName=r.model.name,drawings=partDrawings(r)):{pages:{name:string;svg:string}[];pdf:Uint8Array}{
  const [W,H]=pageSize==="a4"?[595.276,841.89]:[612,792],pages:VectorPage[]=[];
  const newPage=(section:string)=>{
    const page=new VectorPage(W,H,`${projectName} / ${section}`);pages.push(page);
    page.image(BRAND_PRINT_IMAGE,36,15,24,24);page.text("MAKESLICE / ASSEMBLY GUIDE",70,31,9,true,"#4b5563");page.text(section,W-36,31,9,false,"#4b5563","right");page.line({x:36,y:45},{x:W-36,y:45},"#cbd2da");return page;
  };
  const first=newPage("OVERVIEW"),allTitleLines=wrap(projectName.replace(/\.(stl|obj)$/i,""),42),titleLines=allTitleLines.slice(0,2);
  if(allTitleLines.length>2)titleLines[1]=titleLines[1].slice(0,38)+"...";
  titleLines.forEach((line,i)=>first.text(line,36,71+i*23,20,true));const offset=(titleLines.length-1)*23;
  first.text(`${r.dimensions.map(num).join(" × ")} mm / ${r.settings.mode.replace(/_/g," ")} / ${r.pieces.length} parts / ${r.sheets.length} ${r.sheets.length===1?"sheet":"sheets"}`,36,92+offset,9);
  const summaryY=Math.min(535,H-246),viewTop=132+offset;
  first.text("EXPLODED ASSEMBLY",36,119+offset,11,true);exploded(first,r,drawings,viewTop,summaryY-viewTop-45);
  first.line({x:36,y:summaryY-17},{x:W-36,y:summaryY-17},"#cbd2da");first.text("BILL OF MATERIALS / SUMMARY",36,summaryY,11,true);
  const used=materials(r.settings).filter(m=>r.pieces.some(p=>p.assignedThicknessId===m.id));
  used.forEach((m,i)=>{const count=r.pieces.filter(p=>p.assignedThicknessId===m.id).length;first.text(`${m.id}  ${num(m.thickness)} mm  ${MATERIAL_NAMES[m.family||"cardboard"]}  /  ${count} parts`,36,summaryY+22+i*17,9);});
  const notesTop=summaryY+32+used.length*17;
  wrap("Match callouts to the inventory: stock, cut size, sheet and blue joint marks. Tiny hinge channels are omitted from 3D schematics; full cuts appear in the flat inventory and CAD sheets. Print at 100%; diagrams are not cutting templates.",99).forEach((line,i)=>first.text(line,36,notesTop+i*13,9,false,"#4b5563"));
  first.text(`Fabrication notes: ${r.issues.filter(i=>i.severity==="warning").length} warnings, ${r.issues.filter(i=>i.severity==="error").length} errors. See the package README.`,36,H-60,9);
  const steps=assemblySteps(r),done=new Set<number>(),reference=drawingBounds(drawings),partIds=(indices:number[])=>indices.map(i=>`${item(i)} ${r.pieces[i].id}`).join(" / ");
  steps.forEach((step,i)=>{
    const page=i%2===0?newPage("ASSEMBLY SEQUENCE"):pages.at(-1)!;
    const y=65+(i%2)*(H-112)/2;page.text(`${String(i+1).padStart(2,"0")} / ${step.title}`,36,y,13,true);
    wrap(step.note,103).forEach((line,j)=>page.text(line,36,y+20+j*12,9,false,"#4b5563"));
    const boxTop=y+52,boxHeight=(H-112)/2-125,scale=Math.min((W-135)/(reference.width||1),boxHeight/(reference.height||1));
    const screen=(p:Point2D)=>({x:W/2+(p.x-(reference.minX+reference.maxX)/2)*scale,y:boxTop+boxHeight/2+(p.y-(reference.minY+reference.maxY)/2)*scale});
    const current=new Set(step.indices);step.indices.forEach(index=>done.add(index));
    const faces=drawings.filter(d=>done.has(d.index)).flatMap(d=>d.faces.map(face=>({d,face}))).sort((a,b)=>a.face.depth-b.face.depth);
    for(const {d,face} of faces)drawFace(page,face,screen,current.has(d.index)?"#dce8f7":"#f4f5f7",current.has(d.index)?"#31577e":"#949eaa",current.has(d.index)?.65:.35);
    const ids=wrap(partIds(step.indices),101);ids.slice(0,2).forEach((line,j)=>page.text(line,36,boxTop+boxHeight+20+j*12,8));
    if(ids.length>2)page.text(`${step.indices.length} parts in this step. See all IDs in the illustrated inventory.`,36,boxTop+boxHeight+44,8,false,"#4b5563");
    page.line({x:36,y:y+(H-112)/2-14},{x:W-36,y:y+(H-112)/2-14},"#dce1e7");
  });
  const grouped=new Map<string,PartDrawing[]>();
  for(const d of drawings){const key=`${typeName(d.p).toUpperCase()} / ${d.p.assignedThicknessId||"T1"}`;const group=grouped.get(key)||[];group.push(d);grouped.set(key,group);}
  for(const [group,parts] of grouped)for(let offset=0;offset<parts.length;offset+=6){
    const page=newPage("ILLUSTRATED PARTS / BOM");page.text(group,36,65,11,true);page.text("Callout / part ID / stock / quantity / cut size / nesting sheet",36,82,8,false,"#4b5563");
    const subset=parts.slice(offset,offset+6),cellWidth=(W-84)/2,cellHeight=(H-138)/3;
    subset.forEach((d,i)=>{
      const p=d.p,m=pieceMaterial(r.settings,p),x=36+(i%2)*(cellWidth+12),y=101+Math.floor(i/2)*cellHeight;
      page.line({x,y:y+cellHeight-7},{x:x+cellWidth,y:y+cellHeight-7},"#dce1e7");page.circle(x+11,y+9,10);page.text(item(d.index),x+11,y+12,8,true,"#1f2937","center");page.text(p.id,x+28,y+12,10,true);
      page.text(`${m.id} / ${num(p.thickness||m.thickness)} mm / Qty 1`,x+28,y+28,8);
      const sheet=r.sheets.find(s=>s.placements.some(pl=>pl.pieceId===p.id));page.text(`${num(p.bounds.width)} × ${num(p.bounds.height)} mm / ${sheet?`Sheet ${sheet.sheetIndex+1}`:"UNPLACED"}`,x+28,y+42,8);
      const scale=Math.min((cellWidth-34)/(p.bounds.width||1),(cellHeight-88)/(p.bounds.height||1)),screen=(q:Point2D)=>({x:x+cellWidth/2+(q.x-(p.bounds.minX+p.bounds.maxX)/2)*scale,y:y+60+(cellHeight-88)/2+(q.y-(p.bounds.minY+p.bounds.maxY)/2)*-scale});
      page.path(p.cutPaths.map(l=>l.points.map(screen)),true,{fill:"#f4f5f7",stroke:"#374151",weight:.6,evenOdd:true});
      for(const line of p.cutStrokes||[])page.path([line.points.map(screen)],!!line.closed,{stroke:"#4b5563",weight:.4});
      const hole=p.interiorRegions?.[0]||p.cutPaths.find(l=>l.isHole);
      if(hole){const b=bounds([hole]),point=screen({x:Math.max(p.bounds.minX,Math.min(p.bounds.maxX,(b.minX+b.maxX)/2)),y:Math.max(p.bounds.minY,Math.min(p.bounds.maxY,(b.minY+b.maxY)/2))}),tail={x:x+cellWidth-8,y:y+cellHeight-27};page.line(tail,point,"#31577e",.65,true);page.circle(point.x,point.y,1.6,"#31577e","#31577e");page.text(r.settings.mode==="stacked"?"Pin / slot":"Joint / slot",tail.x,tail.y+12,7,false,"#31577e","right");}
    });
  }
  const pageCount=pages.length;
  pages.forEach((page,i)=>{page.line({x:36,y:H-38},{x:W-36,y:H-38},"#cbd2da");page.text("whatmakeart.com / millimeters / diagrams not to scale",36,H-23,8,false,"#4b5563");page.text(`${pageSize==="a4"?"A4":"LETTER"} / ${i+1} of ${pageCount}`,W-36,H-23,8,false,"#4b5563","right");});
  return {pages:pages.map((page,i)=>({name:`Assembly_Guide_Page_${String(i+1).padStart(2,"0")}.svg`,svg:page.svg()})),pdf:vectorPDF(pages,`${projectName} / Assembly Guide`)};
}
