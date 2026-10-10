import type { SliceSettings } from "@/lib/slicer/types";

const project=(x:number,y:number,z:number)=>`${75+(x-y)*.58},${51+(x+y)*.23-z*.85}`;
const polygon=(points:number[][])=>points.map(p=>project(p[0],p[1],p[2])).join(" ");
const descriptions={interlocking:["Interlocking ribs","Two families of ribs meet at matching half-lap slots."],stacked:["Stacked layers","Solid contours build up at the measured stock thickness."],finger_box:["Hollow shell","Caps and walls join with fingers; curved walls can use tested hinges."]};

export function ConstructionPreview({mode}:{mode:SliceSettings["mode"]}){
  const [title,description]=descriptions[mode];
  return <figure className="construction-preview"><svg viewBox="41 -1 68 68" role="img" aria-label={`${title} construction illustration`}>
    <g stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" fillOpacity=".14">
      {mode==="interlocking"&&<>{[-18,18].map(x=><polygon key={`x${x}`} points={polygon([[x,-30,0],[x,30,0],[x,30,36],[x,3,36],[x,3,18],[x,-3,18],[x,-3,36],[x,-30,36]])}/>)}{[-18,18].map(y=><polygon key={`y${y}`} points={polygon([[-30,y,0],[-3,y,0],[-3,y,18],[3,y,18],[3,y,0],[30,y,0],[30,y,36],[-30,y,36]])}/>)}</>}
      {mode==="stacked"&&[28,36,32,22].map((r,i)=><polygon key={i} points={Array.from({length:48},(_,n)=>{const a=n/48*Math.PI*2;return project(Math.cos(a)*r,Math.sin(a)*r,i*10);}).join(" ")}/>)}
      {mode==="finger_box"&&<><polygon points={polygon([[-27,-24,0],[27,-24,0],[27,24,0],[-27,24,0]])}/><polygon points={polygon([[-27,24,0],[27,24,0],[27,24,27],[-27,24,27]])}/><polygon points={polygon([[27,-24,0],[27,24,0],[27,24,27],[27,-24,27]])}/><polygon points={polygon([[-27,-24,43],[27,-24,43],[27,24,43],[-27,24,43]])} fillOpacity=".28"/><path d={`M${project(0,0,27)} L${project(0,0,43)}`} strokeDasharray="2 3" fill="none"/></>}
    </g></svg><figcaption><strong>{title}</strong><p>{description}</p></figcaption></figure>;
}
