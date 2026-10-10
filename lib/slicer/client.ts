import SlicerWorker from "./worker?worker&inline";
import { createJobQueue } from "./job-queue";
import type { WorkerRequest, WorkerResponse } from "./types";

// Inline workers avoid asset-origin restrictions and build-time import.meta URLs.
// Wait for startup before transferring STL data, so a blocked worker can fall
// back without losing the imported file's ArrayBuffer.
export class SlicerClient {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  get compatibilityMode(){return this.session!==null;}
  private worker: Worker | null = null;
  private ready = false;
  private closed = false;
  private pending: WorkerRequest[] = [];
  private session: ReturnType<typeof createJobQueue> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    try {
      const worker = new SlicerWorker();
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse | { type: "ready" }>) => {
        if (this.closed) return;
        if ("type" in event.data && event.data.type === "ready") {
          this.clearStartupTimer();
          this.ready = true;
          for (const request of this.pending.splice(0)) this.postMessage(request);
        } else {
          this.onmessage?.({ data: event.data as WorkerResponse });
        }
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        if (!this.ready) this.useCompatibilityMode();
        else this.onerror?.({ message: event.message || "The slicing engine stopped. Reload the page and try again." });
      };
      this.startupTimer = setTimeout(() => this.useCompatibilityMode(), 3000);
    } catch {
      this.useCompatibilityMode();
    }
  }

  postMessage(request: WorkerRequest) {
    if (this.closed) throw new Error("The slicing engine has closed.");
    if (this.session) {
      this.session.post(request);
    } else if (!this.ready) {
      const source=this.pending.find(old=>old.type==="load"||old.type==="preset");
      for(const old of this.pending)this.onmessage?.({data:{id:old.id,cancelled:true}});
      this.pending=[request.type==="settings"&&source?{...source,id:request.id,settings:request.settings}:request];
    } else {
      this.worker!.postMessage(request, request.type === "load" ? [request.buffer] : []);
    }
  }

  cancel(id:number){this.pending.length=0;this.session?.post({id,type:"cancel"});if(this.ready)this.worker?.postMessage({id,type:"cancel"});}

  terminate() {
    this.closed = true;
    this.session?.close();
    this.clearStartupTimer();
    this.worker?.terminate();
    this.worker = null;
    this.pending.length = 0;
  }

  private clearStartupTimer() {
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private useCompatibilityMode() {
    if (this.closed || this.session) return;
    this.clearStartupTimer();
    this.worker?.terminate();
    this.worker = null;
    this.session = createJobQueue(data=>this.onmessage?.({data}));
    for (const request of this.pending.splice(0)) this.postMessage(request);
  }
}
