import { createSlicerSession } from "./session";
import type { WorkerRequest } from "./types";
const process = createSlicerSession((id,progress)=>self.postMessage({id,progress}));
self.onmessage=(event:MessageEvent<WorkerRequest>)=>{
  const response = process(event.data);
  self.postMessage(response, "result" in response ? {transfer:[response.result.vertices.buffer]} : undefined);
};
self.postMessage({type:"ready"});
