import { createJobQueue } from "./job-queue";
import type { WorkerMessage } from "./types";
const queue=createJobQueue(r=>self.postMessage(r));
self.onmessage=(event:MessageEvent<WorkerMessage>)=>queue.post(event.data);
self.postMessage({type:"ready"});
