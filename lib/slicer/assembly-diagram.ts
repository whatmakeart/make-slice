import { EdgesGeometry, Quaternion, Vector3 } from "three";
import { assembledPosition, pieceGeometry } from "./three-geometry";
import { booleanPaths, signedArea } from "./polygons";
import type { Bounds2D, LaserCutPiece, Path2DLoop, Point2D, SliceResult } from "./types";
import { MATERIAL_NAMES, pieceMaterial } from "./materials";
import { APP_CONFIG, BRAND_LOGO } from "../app-config";

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
const num=(n:number)=>Number(n.toFixed(2));
const project=(p:Vector3):Point2D=>({x:(p.x+p.y)/Math.sqrt(2),y:(p.x-p.y)/Math.sqrt(6)-p.z*Math.sqrt(2/3)});
const depth=(p:Vector3)=>(p.x-p.y+p.z)/Math.sqrt(3);
const vertexKey=(p:Vector3)=>[p.x,p.y,p.z].map(v=>Math.round(v*100000)).join(",");
const edgeKey=(a:Vector3,b:Vector3)=>[vertexKey(a),vertexKey(b)].sort().join("/");
export interface Face { paths:Point2D[][]; edges:{a:Point2D;b:Point2D}[]; depth:number }
export interface PartDrawing { p:LaserCutPiece; index:number; faces:Face[]; bounds:Bounds2D; center:Vector3 }
export interface DiagramPlacement { pieceId:string; index:number; bounds:Bounds2D; badge:Point2D; group:string }
interface DiagramLayout { width:number; diagramBottom:number; scale:number; placements:DiagramPlacement[]; groups:{label:string;y:number;bottom:number}[]; assemblyBottom:number }
export interface ExplodedPlacement { pieceId:string; index:number; displacement:[number,number,number]; bounds:Bounds2D; badge:Point2D; anchor:Point2D; showCallout:boolean; group?:string; groupCount?:number }
interface ExplodedLayout { width:number; height:number; scale:number; placements:ExplodedPlacement[]; sourceBounds:Bounds2D; grouped:boolean }

function boundsOf(points:Point2D[]):Bounds2D {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  if(!points.length)minX=minY=maxX=maxY=0;
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}

function faceBoundaries(triangles:Path2DLoop[]):Point2D[][] {
  const key=(p:Point2D)=>`${Math.round(p.x*10000)},${Math.round(p.y*10000)}`;
  const edges=new Map<string,{a:Point2D;b:Point2D;from:string;to:string;count:number}>();
  for(const triangle of triangles)for(let i=0;i<triangle.points.length;i++){
    const a=triangle.points[i],b=triangle.points[(i+1)%triangle.points.length],from=key(a),to=key(b);if(from===to)continue;
    const id=from<to?`${from}/${to}`:`${to}/${from}`,prior=edges.get(id);
    if(prior)prior.count++;else edges.set(id,{a,b,from,to,count:1});
  }
  const fallback=()=>triangles.map(t=>t.points),boundary=[...edges.values()].filter(e=>e.count===1);
  if(!boundary.length||[...edges.values()].some(e=>e.count>2))return fallback();
  const next=new Map<string,typeof boundary[number]>(),incoming=new Set<string>();
  for(const edge of boundary){if(next.has(edge.from)||incoming.has(edge.to))return fallback();next.set(edge.from,edge);incoming.add(edge.to);}
  if([...next.keys()].some(k=>!incoming.has(k)))return fallback();
  const visited=new Set<string>(),paths:Point2D[][]=[];
  for(const first of boundary){
    if(visited.has(first.from))continue;
    const path:Point2D[]=[];let edge=first;
    while(!visited.has(edge.from)){visited.add(edge.from);path.push(edge.a);const following=next.get(edge.to);if(!following)return fallback();edge=following;}
    if(edge.from!==first.from)return fallback();
    if(path.length>=3)paths.push(path);
  }
  return paths.length?paths:fallback();
}

export function partDrawings(r:SliceResult):PartDrawing[] {
  return r.pieces.map((p,index)=>{
    // Illustrate each bent strip and its joints, without thousands of tiny
    // kerf channels obscuring its shape. Cut sheets, flat guide inventories,
    // the viewport, and Assembly.obj retain the complete laser lattice.
    const schematic=p.cutStrokes?.length?{...p,assemblyPaths:booleanPaths(p.unmodifiedPaths,p.interiorRegions||[],"difference")}:p;
    const geometry=pieceGeometry(schematic,p.thickness||r.settings.materialThickness),offset=assembledPosition(p);
    geometry.translate(offset.x,offset.y,offset.z);
    geometry.computeBoundingBox();const center=geometry.boundingBox!.getCenter(new Vector3());
    const edges=new EdgesGeometry(geometry,25),ep=edges.getAttribute("position"),edgeKeys=new Set<string>();
    for(let i=0;i<ep.count;i+=2)edgeKeys.add(edgeKey(new Vector3().fromBufferAttribute(ep,i),new Vector3().fromBufferAttribute(ep,i+1)));
    const pos=geometry.getAttribute("position"),indices=geometry.getIndex(),points:Point2D[]=[],faces:Face[]=[];
    const planes=new Map<string,{triangles:Path2DLoop[];edges:Map<string,{a:Point2D;b:Point2D}>;depth:number;area:number}>();
    for(let i=0;i<pos.count;i++)points.push(project(new Vector3().fromBufferAttribute(pos,i)));
    // Join coplanar triangles before rendering. One compound white face masks
    // rear edges without thousands of triangle nodes or visible diagonals.
    for(let i=0;i<(indices?.count??pos.count);i+=3){
      const v=[0,1,2].map(k=>new Vector3().fromBufferAttribute(pos,indices?indices.getX(i+k):i+k));
      const normal=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
      if(depth(normal)<=1e-9)continue;
      normal.normalize();const key=[normal.x,normal.y,normal.z].map(n=>Math.round(n*1000)).join(",")+"/"+Math.round(normal.dot(v[0])*100);
      let plane=planes.get(key);if(!plane){plane={triangles:[],edges:new Map(),depth:0,area:0};planes.set(key,plane);}
      const projected=v.map(project),area=Math.abs(signedArea(projected));
      if(signedArea(projected)<0)projected.reverse();plane.triangles.push({isHole:false,points:projected});
      plane.depth+=v.reduce((n,p)=>n+depth(p),0)/3*area;plane.area+=area;
      v.forEach((a,k)=>{const b=v[(k+1)%3],edge=edgeKey(a,b);if(edgeKeys.has(edge))plane!.edges.set(edge,{a:project(a),b:project(b)});});
    }
    // Merge coplanar triangles into outlines. This keeps the illustration
    // vector-based without embedding every triangulation seam in each page.
    for(const plane of planes.values())faces.push({paths:faceBoundaries(plane.triangles),edges:[...plane.edges.values()],depth:plane.depth/(plane.area||1)});
    faces.sort((a,b)=>a.depth-b.depth);geometry.dispose();edges.dispose();
    return {p,index,faces,bounds:boundsOf(points),center};
  });
}

export function spreadDrawings(r:SliceResult,drawings:PartDrawing[]):ExplodedLayout {
  const span=Math.max(...r.dimensions),center=new Vector3(...r.dimensions).multiplyScalar(.5);
  const banded=drawings.some(d=>d.p.shellMethod==="contour_bands");
  const grouped=banded||r.settings.mode==="finger_box"&&(drawings.length>60||drawings.length>24&&drawings.some(d=>d.p.shellMethod==="mesh_panels"));
  const directions=drawings.map(d=>{
    const p=d.p;
    if(p.explodeDirection){const n=new Vector3(...p.explodeDirection);if(p.category==="brace"&&n.dot(d.center.clone().sub(center))<0)n.negate();return n.normalize();}
    const axis=new Vector3(p.axis==="X"?1:0,p.axis==="Y"?1:0,p.axis==="Z"?1:0);return axis.multiplyScalar(axis.dot(d.center.clone().sub(center))<0?-1:1);
  });
  const innerNormals=drawings.filter(d=>d.p.wallRole==="hole").map(d=>directions[d.index]);
  const innerAxis=[0,1,2].sort((a,b)=>innerNormals.reduce((n,v)=>n+Math.abs(v.getComponent(a)),0)-innerNormals.reduce((n,v)=>n+Math.abs(v.getComponent(b)),0))[0];
  const units:{indices:number[];direction:Vector3;bounds:Bounds2D;distance:number;label?:string}[]=[],byGroup=new Map<string,number>(),unitFor:number[]=[];
  drawings.forEach((d,i)=>{
    let direction=directions[i],label:string|undefined;
    if(banded){
      label=d.p.plateRole==="top"?"TOP PLATE":`BAND ${String((d.p.bandIndex||0)+1).padStart(2,"0")}`;
      if(direction.lengthSq()<1e-8){direction=new Vector3(0,0,1);if(d.p.frameRotation)direction.applyQuaternion(new Quaternion(...d.p.frameRotation));}
    }else if(grouped){
      const component=[0,1,2].sort((a,b)=>Math.abs(direction.getComponent(b))-Math.abs(direction.getComponent(a)))[0],sign=direction.getComponent(component)<0?-1:1;
      if(d.p.wallRole==="hole"){direction=new Vector3().setComponent(innerAxis,1);label="INNER TUNNELS";}
      else{direction=new Vector3().setComponent(component,sign);label=`OUTER ${sign<0?"−":"+"}${["X","Y","Z"][component]}`;}
    }
    let id=label?byGroup.get(label):undefined;
    if(id===undefined){id=units.length;units.push({indices:[],direction,bounds:d.bounds,distance:d.p.category==="box_cap"?span*1.1:span*.65,label});if(label)byGroup.set(label,id);}
    units[id].indices.push(i);unitFor[i]=id;
  });
  for(const unit of units)unit.bounds=boundsOf(unit.indices.flatMap(i=>{const b=drawings[i].bounds;return [{x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}];}));
  const bandAxis=new Vector3(0,0,1),frame=drawings.find(d=>d.p.frameRotation)?.p.frameRotation;if(frame)bandAxis.applyQuaternion(new Quaternion(...frame));
  const bandScreen=project(bandAxis),screenLength=Math.hypot(bandScreen.x,bandScreen.y),bandGap=Math.max(span*.35,...units.map(u=>(Math.abs(bandScreen.x)*u.bounds.width+Math.abs(bandScreen.y)*u.bounds.height)/(screenLength*screenLength||1)*.8));
  const deltas=()=>units.map(u=>banded?bandAxis.clone().multiplyScalar(((drawings[u.indices[0]].p.bandIndex||0)-r.layerCount/2)*bandGap):u.direction.clone().multiplyScalar(u.distance));
  const shifted=(b:Bounds2D,delta:Vector3)=>{const p=project(delta);return {minX:b.minX+p.x,maxX:b.maxX+p.x,minY:b.minY+p.y,maxY:b.maxY+p.y,width:b.width,height:b.height};};
  // Dense curved shells explode as coherent panel groups. Their full individual
  // inventory remains below, avoiding hundreds of crossing leaders in one view.
  for(let pass=0;!banded&&pass<65;pass++){
    const ds=deltas();let changed=false;
    for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
      const a=shifted(units[i].bounds,ds[i]),b=shifted(units[j].bounds,ds[j]),ox=Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX),oy=Math.min(a.maxY,b.maxY)-Math.max(a.minY,b.minY);
      if(ox<=span*.025||oy<=span*.025||ox*oy<Math.min(a.width*a.height,b.width*b.height)*.1)continue;
      const k=units[i].distance>units[j].distance+span*.05?i:j;units[k].distance+=span*.16;changed=true;
    }
    if(!changed)break;
  }
  const ds=deltas(),boxes=drawings.map((d,i)=>shifted(d.bounds,ds[unitFor[i]])),sourceBounds=boundsOf(boxes.flatMap(b=>[{x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}]));
  const scale=Math.min(990/(sourceBounds.width||1),920/(sourceBounds.height||1));
  const screen=(p:Point2D)=>({x:700+(p.x-(sourceBounds.minX+sourceBounds.maxX)/2)*scale,y:240+(p.y-sourceBounds.minY)*scale});
  const representatives=units.map(u=>u.indices.reduce((a,b)=>drawings[a].p.area>drawings[b].p.area?a:b));
  const placements:ExplodedPlacement[]=drawings.map((d,i)=>{const unit=unitFor[i],delta=ds[unit],b=boxes[i],min=screen({x:b.minX,y:b.minY}),max=screen({x:b.maxX,y:b.maxY}),anchor=screen(project(d.center.clone().add(delta)));return {pieceId:d.p.id,index:i,displacement:delta.toArray(),bounds:{minX:min.x,minY:min.y,maxX:max.x,maxY:max.y,width:max.x-min.x,height:max.y-min.y},anchor,badge:{x:anchor.x<700?78:1322,y:0},showCallout:i===representatives[unit],group:units[unit].label,groupCount:units[unit].indices.length};});
  let bottom=240+sourceBounds.height*scale;
  for(const side of [78,1322]){
    const items=placements.filter(p=>p.showCallout&&p.badge.x===side).sort((a,b)=>a.anchor.y-b.anchor.y),first=240,gap=grouped?65:32;
    items.forEach((p,i)=>{p.badge.y=Math.max(p.anchor.y,first+i*gap,i?items[i-1].badge.y+gap:first);bottom=Math.max(bottom,p.badge.y+(grouped?55:20));});
  }
  return {width:1400,height:bottom+80,scale,placements,sourceBounds,grouped};
}
export function explodedAssemblyLayout(r:SliceResult):ExplodedLayout {return spreadDrawings(r,partDrawings(r));}

function layoutDrawings(r:SliceResult,drawings:PartDrawing[],assembly=spreadDrawings(r,drawings)):DiagramLayout {
  const groups:{label:string;parts:PartDrawing[]}[]=[];
  const add=(label:string,parts:PartDrawing[])=>{if(parts.length)groups.push({label,parts});};
  if(r.pieces.some(p=>p.shellMethod==="contour_bands")){
    add("TOP CONTOUR PLATE",drawings.filter(d=>d.p.plateRole==="top"));
    add("NUMBERED HINGE BANDS / OUTER AND INNER STRIPS",drawings.filter(d=>d.p.category!=="box_cap"));
    add("SHARED JOINING PLATES",drawings.filter(d=>d.p.plateRole==="joining"));
    add("BOTTOM CONTOUR PLATE",drawings.filter(d=>d.p.plateRole==="bottom"));
  }else if(r.settings.mode==="finger_box"){
    add("TOP CAP",drawings.filter(d=>d.p.category==="box_cap"&&d.p.id.includes("TOP")));
    add("PERIMETER WALLS / CURVED STRIPS",drawings.filter(d=>d.p.category==="box_wall"||d.p.category==="box_curved_wall"));
    add("INTERNAL REINFORCEMENTS",drawings.filter(d=>d.p.category==="brace"));
    add("BOTTOM CAP",drawings.filter(d=>d.p.category==="box_cap"&&!d.p.id.includes("TOP")));
  }else if(r.settings.mode==="stacked"){
    add("STACKED LAYERS — TOP TO BOTTOM",drawings.filter(d=>d.p.kind!=="alignment-pin").sort((a,b)=>b.p.sliceIndex-a.p.sliceIndex||a.index-b.index));
    add("ALIGNMENT PINS",drawings.filter(d=>d.p.kind==="alignment-pin"));
  }else{
    add("X RIBS — NUMBERED ORDER",drawings.filter(d=>d.p.axis==="X"));
    add("Y RIBS — NUMBERED ORDER",drawings.filter(d=>d.p.axis==="Y"));
  }
  const grouped=new Set(groups.flatMap(g=>g.parts.map(d=>d.index)));
  add("OTHER PARTS",drawings.filter(d=>!grouped.has(d.index)));
  const scale=Math.min(320/Math.max(1,...drawings.map(d=>d.bounds.width)),260/Math.max(1,...drawings.map(d=>d.bounds.height)));
  const placements:DiagramPlacement[]=[],bands:DiagramLayout["groups"]=[];
  let cursor=assembly.height+70;
  for(const group of groups){
    const y=cursor;cursor+=32;
    // Separate bounding boxes share one scale. Grow the page, never overlap.
    const columns=Math.min(3,group.parts.length),columnWidth=1160/columns;
    for(let i=0;i<group.parts.length;i+=columns){
      const row=group.parts.slice(i,i+columns),rowHeight=Math.max(...row.map(d=>d.bounds.height*scale));
      row.forEach((d,j)=>{
        const x=120+columnWidth*(j+.5)+(columns===3?(j-1)*10:0),w=d.bounds.width*scale,h=d.bounds.height*scale;
        const minX=x-w/2,minY=cursor+64+(rowHeight-h)/2;
        placements.push({pieceId:d.p.id,index:d.index,group:group.label,
          bounds:{minX,minY,maxX:minX+w,maxY:minY+h,width:w,height:h},badge:{x:minX-23,y:cursor+22}});
      });
      cursor+=rowHeight+110;
    }
    bands.push({label:group.label,y,bottom:cursor-25});cursor+=24;
  }
  return {width:1400,diagramBottom:cursor,scale,placements,groups:bands,assemblyBottom:assembly.height};
}

export function assemblyDiagramLayout(r:SliceResult):DiagramLayout {return layoutDrawings(r,partDrawings(r));}

function faceSVG(face:Face,screen:(p:Point2D)=>Point2D,weight=.85):string {
  const fill=`<path d="${face.paths.map(path=>path.map(screen).map((q,i)=>`${i?"L":"M"}${num(q.x)} ${num(q.y)}`).join(" ")+"Z").join(" ")}" fill="white" fill-rule="nonzero" stroke="none"/>`;
  if(!face.edges.length)return fill;
  return fill+`<path d="${face.edges.map(l=>{const a=screen(l.a),b=screen(l.b);return `M${num(a.x)} ${num(a.y)}L${num(b.x)} ${num(b.y)}`;}).join(" ")}" fill="none" stroke="#28333a" stroke-width="${weight}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

export function exportAssemblyDiagram(r:SliceResult,drawings=partDrawings(r)):string {
  const assembly=spreadDrawings(r,drawings),layout=layoutDrawings(r,drawings,assembly),width=layout.width,tableY=layout.diagramBottom+35,height=tableY+80+drawings.length*28+125;
  const exploded=explodedSVG(drawings,assembly);
  const placementByIndex=new Map(layout.placements.map(p=>[p.index,p]));
  const parts=drawings.map(d=>{
    const pl=placementByIndex.get(d.index)!,screen=(p:Point2D)=>({x:pl.bounds.minX+(p.x-d.bounds.minX)*layout.scale,y:pl.bounds.minY+(p.y-d.bounds.minY)*layout.scale});
    const candidates=d.faces.flatMap(f=>f.edges.flatMap(e=>[screen(e.a),screen(e.b)]));
    const anchor=candidates.reduce((a,p)=>Math.hypot(p.x-pl.badge.x,p.y-pl.badge.y)<Math.hypot(a.x-pl.badge.x,a.y-pl.badge.y)?p:a,candidates[0]||{x:pl.bounds.minX,y:pl.bounds.minY});
    const badge=pl.badge;
    return `<g id="part-${esc(d.p.id)}" data-part-bounds="${[pl.bounds.minX,pl.bounds.minY,pl.bounds.maxX,pl.bounds.maxY].map(num).join(" ")}"><title>${esc(d.p.id)}</title>${d.faces.map(f=>faceSVG(f,screen)).join("")}<g class="part-callout"><path d="M${num(badge.x+12)} ${num(badge.y+15)}L${num(badge.x+24)} ${num(badge.y+33)}L${num(anchor.x)} ${num(anchor.y)}" fill="none" stroke="#71808a" stroke-dasharray="4 3"/><circle cx="${num(anchor.x)}" cy="${num(anchor.y)}" r="2.5" fill="#28333a"/><circle cx="${num(badge.x)}" cy="${num(badge.y)}" r="19" fill="white" stroke="#28333a" stroke-width="1.3"/><text x="${num(badge.x)}" y="${num(badge.y+5)}" text-anchor="middle" font-size="13">${String(d.index+1).padStart(2,"0")}</text><text x="${num(badge.x+29)}" y="${num(badge.y-1)}" font-size="14" font-weight="bold">${esc(d.p.id)}</text><text x="${num(badge.x+29)}" y="${num(badge.y+16)}" font-size="11" fill="#66747e">${esc(d.p.assignedThicknessId||"T1")} / ${num(d.p.thickness||r.settings.materialThickness)} mm${d.p.wallRole==="hole"?" · inner tunnel wall":""}</text></g></g>`;
  }).join("\n");
  const bands=layout.groups.map((g,i)=>`<g><text x="85" y="${g.y}" font-size="13" font-weight="bold" letter-spacing=".7">${esc(g.label)}</text><path d="M85 ${g.y+10}H1345" stroke="#dce2e6"/>${i<layout.groups.length-1?`<path d="M48 ${g.y+18}V${layout.groups[i+1].y-15}" fill="none" stroke="#b4bfc6" stroke-dasharray="5 5"/><path d="M43 ${layout.groups[i+1].y-22}L48 ${layout.groups[i+1].y-15}L53 ${layout.groups[i+1].y-22}" fill="none" stroke="#b4bfc6"/>`:""}</g>`).join("");
  const allPoints=drawings.flatMap(d=>d.faces.flatMap(f=>f.paths.flat())),referenceBounds=boundsOf(allPoints),refScale=Math.min(215/(referenceBounds.width||1),88/(referenceBounds.height||1));
  const refScreen=(p:Point2D)=>({x:1230+(p.x-(referenceBounds.minX+referenceBounds.maxX)/2)*refScale,y:160+(p.y-(referenceBounds.minY+referenceBounds.maxY)/2)*refScale});
  const reference=drawings.flatMap(d=>d.faces).sort((a,b)=>a.depth-b.depth).map(f=>faceSVG(f,refScreen,.45)).join("");
  const header=["ITEM","PART ID / TYPE","STOCK","CUT SIZE (mm)","QTY","SHEET / JOINTS"],xs=[40,125,480,690,930,1010];
  const rows=drawings.map(d=>{const p=d.p,m=pieceMaterial(r.settings,p),sheet=r.sheets.find(s=>s.placements.some(pl=>pl.pieceId===p.id)),y=tableY+65+d.index*28,values=[String(d.index+1).padStart(2,"0"),`${p.id} / ${p.wallRole==="hole"?"inner tunnel wall":(p.category||p.kind||"rib").replace(/_/g," ")}`,`${p.assignedThicknessId||"T1"} · ${p.thickness||r.settings.materialThickness} mm · ${MATERIAL_NAMES[m.family||"cardboard"]}`,`${num(p.bounds.width)} × ${num(p.bounds.height)}`,"1",`${sheet?`Sheet ${sheet.sheetIndex+1}`:"UNPLACED"}${p.category==="brace"?` / ${p.anchorCount||0} anchors`:""}`];return `<path d="M40 ${y+10}H1360" stroke="#dce2e6"/>${values.map((v,j)=>`<text x="${xs[j]}" y="${y}" font-size="12">${esc(v)}</text>`).join("")}`;}).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#28333a"><image href="${BRAND_LOGO}" x="40" y="25" width="44" height="44"/><text x="94" y="43" font-size="23" font-weight="bold">EXPLODED ASSEMBLY / PARTS DIAGRAM</text><text x="94" y="69" font-size="13">${esc(r.model.name)} · ${r.dimensions.map(num).join(" × ")} mm · ${r.settings.mode==="finger_box"?"Finger-joint box":r.settings.mode==="stacked"?"Stacked layers":"Interlocking ribs"}</text><text x="1360" y="43" font-size="13" text-anchor="end">${APP_CONFIG.NAME.toUpperCase()} / ${APP_CONFIG.VERSION}</text><path d="M40 83H1360" stroke="#28333a"/><text x="40" y="116" font-size="13">Match the numbered parts to the inventory and bill of materials below.</text><text x="40" y="140" font-size="12" fill="#66747e">Dashed assembly axes lead back to each part or panel group's fitted position.</text>${drawings.some(d=>d.p.cutStrokes?.length)?'<text x="40" y="164" font-size="11" fill="#66747e">Tiny hinge channels are omitted in 3D schematics. Full lattice cuts remain in the cut sheets and flat guide inventory.</text>':""}<text x="1230" y="99" text-anchor="middle" font-size="10" fill="#66747e">ASSEMBLED REFERENCE</text><g id="assembled-reference">${reference}</g><text x="40" y="208" font-size="17" font-weight="bold">01 / EXPLODED ASSEMBLY VIEW</text><g id="exploded-assembly">${exploded}</g><path d="M40 ${layout.assemblyBottom+8}H1360" stroke="#28333a"/><text x="40" y="${layout.assemblyBottom+42}" font-size="17" font-weight="bold">02 / INDIVIDUAL LABELED PARTS INVENTORY</text><g id="parts-inventory">${bands}${parts}</g><text x="40" y="${tableY}" font-size="19" font-weight="bold">BILL OF MATERIALS${r.pieces.some(p=>p.category==="brace")?" — INCLUDING INTERNAL REINFORCEMENTS":""}</text>${header.map((v,j)=>`<text x="${xs[j]}" y="${tableY+31}" font-size="12" font-weight="bold">${v}</text>`).join("")}<path d="M40 ${tableY+39}H1360" stroke="#28333a"/>${rows}<text x="40" y="${height-60}" font-size="12">Schematic spacing; cut dimensions come from the CAD files. Match etched IDs before assembly.</text><text x="40" y="${height-36}" font-size="12">Dry-fit joints and inspect fabrication notes before cutting.</text></g></svg>\n`;
}

function explodedSVG(drawings:PartDrawing[],layout:ExplodedLayout):string {
  const screen=(p:Point2D)=>({x:700+(p.x-(layout.sourceBounds.minX+layout.sourceBounds.maxX)/2)*layout.scale,y:240+(p.y-layout.sourceBounds.minY)*layout.scale});
  const guides=drawings.map((d,i)=>{if(!layout.placements[i].showCallout)return "";const a=screen(project(d.center)),b=layout.placements[i].anchor;return `<path d="M${num(a.x)} ${num(a.y)}L${num(b.x)} ${num(b.y)}" fill="none" stroke="#b4bfc6" stroke-dasharray="7 5"/>`;}).join("");
  const faces=drawings.flatMap((d,i)=>{const delta=new Vector3(...layout.placements[i].displacement),shift=project(delta);return d.faces.map(face=>({face,delta,shift}));}).sort((a,b)=>a.face.depth+depth(a.delta)-b.face.depth-depth(b.delta));
  const geometry=faces.map(({face,shift})=>faceSVG(face,p=>screen({x:p.x+shift.x,y:p.y+shift.y}),.95)).join("");
  const callouts=layout.placements.filter(p=>p.showCallout).map(p=>{const left=p.badge.x<700,elbow=left?180:1220,end=p.badge.x+(left?15:-15);return `<g class="assembly-callout" data-piece="${esc(p.pieceId)}"><path d="M${num(p.anchor.x)} ${num(p.anchor.y)}L${elbow} ${num(p.badge.y)}H${end}" fill="none" stroke="#8796a0" stroke-width=".8" stroke-dasharray="4 3"/><circle cx="${num(p.anchor.x)}" cy="${num(p.anchor.y)}" r="2"/><circle cx="${p.badge.x}" cy="${num(p.badge.y)}" r="14" stroke="#28333a" fill="white"/><text x="${p.badge.x}" y="${num(p.badge.y+4)}" font-size="11" text-anchor="middle">${String(p.index+1).padStart(2,"0")}</text>${p.group?`<text x="${p.badge.x}" y="${num(p.badge.y+29)}" text-anchor="middle" font-size="9" font-weight="bold">${esc(p.group)}</text><text x="${p.badge.x}" y="${num(p.badge.y+42)}" text-anchor="middle" font-size="9">${p.groupCount} panels</text>`:""}</g>`;}).join("");
  const groupedNote=drawings.some(d=>d.p.shellMethod==="contour_bands")?"Each band and its lower plate move together. Callouts identify reference parts; every strip and plate is numbered below.":"Dense facets are shown in assembly groups. The callout identifies one reference panel; every panel is numbered in the inventory.";
  return `${layout.grouped?`<text x="40" y="228" font-size="11" fill="#66747e">${groupedNote}</text>`:""}<g class="assembly-axes">${guides}</g><g class="assembly-parts">${geometry}</g>${callouts}`;
}
