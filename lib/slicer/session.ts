import { parseSTL } from "./stl";
import { parseOBJ } from "./obj";
import { makePreset } from "./presets";
import { sliceMesh } from "./engine";
import type { MeshData, WorkerRequest, WorkerResponse, SlicingProgress } from "./types";

// Both execution paths keep the last successfully processed mesh.
export function createSlicerSession(onProgress?:(id:number,p:SlicingProgress)=>void) {
  let mesh: MeshData | null = null;
  return (request: WorkerRequest): Exclude<WorkerResponse,{progress:SlicingProgress}> => {
    try {
      const candidate = request.type === "load" ? (/\.obj$/i.test(request.name) ? parseOBJ(new TextDecoder().decode(request.buffer), request.name) : parseSTL(request.buffer, request.name))
        : request.type === "preset" ? makePreset(request.preset) : mesh;
      if (!candidate) throw new Error("Load an STL/OBJ or choose a sample model.");
      const result = sliceMesh(candidate, request.settings,p=>onProgress?.(request.id,p));
      mesh = candidate;
      return { id: request.id, result };
    } catch (error) {
      return { id: request.id, error: error instanceof Error ? error.message : "Could not process this mesh." };
    }
  };
}
