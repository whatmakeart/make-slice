import {sliceMesh} from "../lib/slicer/engine";
import {inspectMesh} from "../lib/slicer/stl";
import {DEFAULT_SETTINGS} from "../lib/slicer/types";
const nu=192,nv=132,out:number[]=[];
function at(i:number,j:number){const u=i/nu*Math.PI*2,v=j/nv*Math.PI;return [100*Math.sin(v)*Math.cos(u),80*Math.sin(v)*Math.sin(u),112*Math.cos(v)];}
for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);if(j>0)out.push(...a,...b,...c);if(j<nv-1)out.push(...a,...c,...d);}
const vertices=new Float64Array(out),t=performance.now(),info=inspectMesh(vertices,"50k ellipsoid","Benchmark"),inspectionMs=performance.now()-t;
const r=sliceMesh({vertices,info},{...DEFAULT_SETTINGS,xSliceCount:20,ySliceCount:20});
console.log(JSON.stringify({triangles:info.triangleCount,parts:r.pieces.length,joints:r.joints.length,sheets:r.sheets.length,inspectionMs:Math.round(inspectionMs),processingMs:Math.round(r.processingMs),combinedMs:Math.round(inspectionMs+r.processingMs),issues:r.issues},null,2));
// This runner is not a browser or a named user device. Opt into a measured
// environment-specific engineering budget instead of a universal time limit.
const budget=process.env.MAKESLICE_BENCHMARK_BUDGET_MS;
if(budget!==undefined){const ms=Number(budget);if(!Number.isFinite(ms)||ms<=0)throw new Error("MAKESLICE_BENCHMARK_BUDGET_MS must be a positive millisecond budget.");if(r.processingMs>ms)process.exitCode=1;}
