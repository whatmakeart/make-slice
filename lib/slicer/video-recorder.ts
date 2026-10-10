export function recordingMime():string{
  if(typeof MediaRecorder==="undefined")throw new Error("Assembly recording is unavailable in this browser. Use current Chrome, Edge, Firefox, or Safari.");
  return ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t=>MediaRecorder.isTypeSupported(t))||"";
}
export async function recordCanvas(canvas:HTMLCanvasElement,render:(progress:number)=>void,onProgress:(pct:number)=>void,signal:AbortSignal,durationMs:number):Promise<Blob>{
  if(!canvas.captureStream)throw new Error("Canvas video recording is unavailable in this browser.");
  const mime=recordingMime();if(!mime)throw new Error("This browser has no supported MP4 or WebM recorder.");
  const stream=canvas.captureStream(30),chunks:Blob[]=[];
  try {
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8_000_000});
    const stopped=new Promise<Blob>((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType||mime}));recorder.onerror=()=>reject(new Error("The browser could not encode the assembly video."));});
    recorder.start(250);const start=performance.now();
    await new Promise<void>((resolve,reject)=>{
      let raf=0;
      const abort=()=>{cancelAnimationFrame(raf);reject(new DOMException("Recording canceled.","AbortError"));};
      signal.addEventListener("abort",abort,{once:true});
      const tick=()=>{
        if(signal.aborted){abort();return;}
        const t=Math.min(1,(performance.now()-start)/durationMs);
        try{render(t);onProgress(t);}catch(e){signal.removeEventListener("abort",abort);reject(e);return;}
        if(t>=1){signal.removeEventListener("abort",abort);resolve();}else raf=requestAnimationFrame(tick);
      };tick();
    }).catch(e=>{if(recorder.state!=="inactive")recorder.stop();void stopped.catch(()=>{});throw e;});
    recorder.stop();return await stopped;
  }finally{stream.getTracks().forEach(t=>t.stop());}
}
