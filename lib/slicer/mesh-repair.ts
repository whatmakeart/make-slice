import {BufferGeometry,Float32BufferAttribute,Vector3} from "three";
// Earcut can leave T junctions where separate holes have collinear edges. Split only
// unmatched edges at their shared vertices so each exported solid is topologically closed.
export function closeTJunctions(source:BufferGeometry):BufferGeometry{
  const pos=source.getAttribute("position"),index=source.getIndex(),count=index?.count||pos.count;
  const key=(v:Vector3)=>v.toArray().map(n=>Math.round(n*10000)).join(",");
  const edgeKey=(a:string,b:string)=>a<b?a+":"+b:b+":"+a;
  const vertices=new Map<string,Vector3>(),edges=new Map<string,number>(),tris:Vector3[][]=[];
  for(let i=0;i<count;i+=3){const vs=[0,1,2].map(j=>{const v=new Vector3().fromBufferAttribute(pos,index?index.getX(i+j):i+j),k=key(v),prior=vertices.get(k);if(prior)return prior;vertices.set(k,v);return v;});if(vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).lengthSq()<1e-24)continue;tris.push(vs);
    for(let j=0;j<3;j++){const a=vs[j],b=vs[(j+1)%3],ka=key(a),kb=key(b);vertices.set(ka,a);vertices.set(kb,b);if(ka===kb)continue;const k=edgeKey(ka,kb);edges.set(k,(edges.get(k)||0)+1);}
  }
  const finish=(values:number[])=>{const result=new BufferGeometry();result.setAttribute("position",new Float32BufferAttribute(values,3));source.dispose();return result;};
  const unmatched=[...edges].filter(([,n])=>n===1);if(!unmatched.length)return finish(tris.flatMap(tri=>tri.flatMap(v=>v.toArray())));
  const candidateKeys=new Set(unmatched.flatMap(([k])=>k.split(":"))),candidates=[...candidateKeys].map(k=>vertices.get(k)!);
  const out:number[]=[];let changed=false;
  for(const tri of tris){const polygon:Vector3[]=[];let split=false;
    for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3],ka=key(a),kb=key(b);polygon.push(a);
      if(edges.get(edgeKey(ka,kb))!==1)continue;
      const ab=b.clone().sub(a),len2=ab.lengthSq();if(len2<1e-12)continue;
      const inside=candidates.flatMap(p=>{const t=p.clone().sub(a).dot(ab)/len2;if(t<.000001||t>.999999)return [];const distance=p.distanceTo(a.clone().addScaledVector(ab,t));return distance<.0001?[{p,t}]:[];}).sort((a,b)=>a.t-b.t);
      if(inside.length){split=true;polygon.push(...inside.map(p=>p.p));}
    }
    if(split){changed=true;const center=tri[0].clone().add(tri[1]).add(tri[2]).multiplyScalar(1/3);for(let j=0;j<polygon.length;j++)out.push(...center.toArray(),...polygon[j].toArray(),...polygon[(j+1)%polygon.length].toArray());}
    else out.push(...tri.flatMap(v=>v.toArray()));
  }
  return finish(out);
}
