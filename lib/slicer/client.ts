import SlicerWorker from "./worker?worker&inline";
import { createSlicerSession } from "./session";
import type { WorkerRequest, WorkerResponse } from "./types";

// Inline workers avoid asset-origin restrictions and build-time import.meta URLs.
// Wait for startup before transferring STL data, so a blocked worker can fall
// back without losing the imported file's ArrayBuffer.
export class SlicerClient {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  private worker: Worker | null = null;
  private ready = false;
  private closed = false;
  private pending: WorkerRequest[] = [];
  private session: ReturnType<typeof createSlicerSession> | null = null;
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
      // Yield before computation so the page can display its progress state.
      setTimeout(() => {
        if (!this.closed) this.onmessage?.({ data: this.session!(request) });
      }, 0);
    } else if (!this.ready) {
      this.pending.push(request);
    } else {
      this.worker!.postMessage(request, request.type === "load" ? [request.buffer] : []);
    }
  }

  terminate() {
    this.closed = true;
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
    this.session = createSlicerSession((id,progress)=>this.onmessage?.({data:{id,progress}}));
    for (const request of this.pending.splice(0)) this.postMessage(request);
  }
}
