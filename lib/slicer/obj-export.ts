import { Vector3 } from "three";
import { assembledPosition, pieceGeometry } from "./three-geometry";
import { closeTJunctions } from "./mesh-repair";
import type { SliceResult } from "./types";
export function exportAssemblyOBJ(result:SliceResult):string{
  const rows=["# MakeSlice assembled laser-cut solids", "# Units: millimeters. Assembled positions; preview explosion is not baked."];
  let offset=1;
  for(const p of result.pieces){
    const geometry=closeTJunctions(pieceGeometry(p,p.thickness||result.settings.materialThickness)),position=assembledPosition(p),pos=geometry.getAttribute("position"),index=geometry.getIndex();
    rows.push(`o ${p.id.replace(/[^a-zA-Z0-9_-]/g,"_")}`,`# ${p.assignedThicknessId||"T1"}: ${p.thickness||result.settings.materialThickness} mm`);
    const v=new Vector3();for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).add(position);rows.push(`v ${v.toArray().map(n=>Number(n.toFixed(6))).join(" ")}`);}
    const count=index?.count||pos.count;
    for(let i=0;i<count;i+=3){
      const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j),vs=ids.map(id=>new Vector3().fromBufferAttribute(pos,id).add(position).multiplyScalar(1e6).round().multiplyScalar(1e-6));
      if(vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).lengthSq()<1e-24)continue;
      rows.push(`f ${ids.map(id=>id+offset).join(" ")}`);
    }
    offset+=pos.count;geometry.dispose();
  }
  return rows.join("\n")+"\n";
}
