import { createAsyncSlicerSession } from "./session";
import type { WorkerMessage, WorkerRequest, WorkerResponse } from "./types";
// One execution lane. New requests coalesce; superseded generators cannot commit.
export function createJobQueue(emit:(r:WorkerResponse)=>void){
  const run=createAsyncSlicerSession((id,progress)=>emit({id,progress}));let queued:WorkerRequest|null=null,running=false,active:WorkerRequest|null=null,epoch=0,closed=false;
  const drain=async()=>{if(running||closed)return;running=true;try{while(queued&&!closed){const request=queued;active=request;queued=null;const token=epoch;const response=await run(request,()=>closed||epoch!==token);if(!closed)emit(response);active=null;}}finally{running=false;}};
  return {post(message:WorkerMessage){epoch++;if(message.type==="cancel"){queued=null;return;}const source=queued&&(queued.type==="load"||queued.type==="preset")?queued:active&&(active.type==="load"||active.type==="preset")?active:null;if(queued)emit({id:queued.id,cancelled:true});queued=message.type==="settings"&&source?{...source,id:message.id,settings:message.settings}:message;void drain();},close(){closed=true;epoch++;queued=null;}};
}
