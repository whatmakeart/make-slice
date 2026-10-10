"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { LaserCutPiece, SliceResult } from "@/lib/slicer/types";
import { pieceGeometry, assembledPosition, explosionVector } from "@/lib/slicer/three-geometry";
import { pieceMaterial, materialAppearance } from "@/lib/slicer/materials";
import { recordCanvas } from "@/lib/slicer/video-recorder";

export interface AssemblyViewportHandle {recordVideo:(onProgress:(p:number)=>void,signal:AbortSignal,showGhost?:boolean)=>Promise<Blob>}
interface Props {active?:boolean;colorByThickness?:boolean;xray?:boolean;result:SliceResult|null;explode:number;step:number;ghost:boolean;selected:string|null;onSelect:(id:string|null)=>void;view:"iso"|"front"|"top";fit:number}
const AssemblyViewport=forwardRef<AssemblyViewportHandle,Props>(function AssemblyViewport(props,ref){
  const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
  const sceneRef=useRef<{scene:THREE.Scene;root:THREE.Group;camera:THREE.PerspectiveCamera;controls:OrbitControls;renderer:THREE.WebGLRenderer;reset:()=>void}|null>(null);
  const recording=useRef(false);
  const [error,setError]=useState("");
  useImperativeHandle(ref,()=>({recordVideo:async(onProgress,signal,showGhost=false)=>{
    const ctx=sceneRef.current,r=latest.current.result;if(!ctx||!r)throw new Error("Video recording needs the WebGL assembly preview.");
    if(recording.current)throw new Error("A recording is already running.");
    const {camera,controls,root,renderer,scene}=ctx,oldCamera=camera.position.clone(),oldTarget=controls.target.clone(),oldEnabled=controls.enabled;
    const target=new THREE.Vector3(r.dimensions[0]/2,r.dimensions[1]/2,r.dimensions[2]/2),radius=Math.hypot(...r.dimensions)/2;
    const halfFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect));
    const distance=radius/Math.sin(halfFov)*1.1/Math.sqrt(1+.65*.65);
    recording.current=true;controls.enabled=false;
    try{return await recordCanvas(renderer.domElement,t=>{
      const progress=Math.min(1,t/.8),reveal=progress*r.pieces.length,step=Math.ceil(reveal);
      for(const obj of root.children){if(obj.userData.ghost){obj.visible=showGhost;continue;}const piece=obj.userData.piece as LaserCutPiece;const index=r.pieces.indexOf(piece);if(index<0)continue;
        obj.visible=index<step;obj.position.copy(assembledPosition(piece));
        if(index===step-1){const settling=1-(reveal-Math.floor(reveal));obj.position.add(explosionVector(piece,r,settling*55));}
        if(progress===1)obj.position.copy(assembledPosition(piece));
      }
      const angle=-Math.PI/4+t*Math.PI*.7;camera.position.set(target.x+distance*Math.cos(angle),target.y+distance*Math.sin(angle),target.z+distance*.65);camera.lookAt(target);renderer.render(scene,camera);
    },onProgress,signal,Math.min(45000,Math.max(8000,r.pieces.length*280+2000)));}
    finally{recording.current=false;camera.position.copy(oldCamera);controls.target.copy(oldTarget);controls.enabled=oldEnabled;controls.update();}
  }}),[]);
  useEffect(()=>{
    const el=host.current!;let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"high-performance"});}catch{setError("3D preview needs WebGL. The sheet layout and cut-file exports are still available.");return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor(0x222b30);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.4;
    renderer.domElement.setAttribute("aria-label","Interactive 3D assembly. Drag to orbit, scroll to zoom, shift-drag to pan. Click a part to select it.");renderer.domElement.tabIndex=0;el.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);
    const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.04);
    scene.environment=environment.texture;room.dispose();pmrem.dispose();
    const camera=new THREE.PerspectiveCamera(34,1,.1,30000);camera.up.set(0,0,1);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.screenSpacePanning=true;controls.maxDistance=20000;
    scene.add(new THREE.HemisphereLight(0xfff4d6,0x687781,2.3));
    const key=new THREE.DirectionalLight(0xfff1d4,3.4);key.position.set(150,-300,450);scene.add(key);
    const fill=new THREE.DirectionalLight(0xd6edff,2.3);fill.position.set(-300,200,300);scene.add(fill);
    const grid=new THREE.GridHelper(2000,100,0x5a676d,0x37444b);grid.rotation.x=Math.PI/2;grid.position.z=-.15;scene.add(grid);
    const axes=new THREE.AxesHelper(70);scene.add(axes);
    const reset=()=>{
      const p=latest.current,r=p.result,d=r?.dimensions||[220,180,250],built=[...d];
      if(r?.settings.mode==="stacked")built[r.settings.stackedAxis==="X"?0:r.settings.stackedAxis==="Y"?1:2]=r.builtDepth;
      const target=new THREE.Vector3(built[0]/2,built[1]/2,built[2]/2),extents=[...built];
      if(r){const extra=(count:number)=>p.explode/100*Math.max(0,count-1)*r.settings.materialThickness*3.5;if(r.settings.mode==="stacked")extents[r.settings.stackedAxis==="X"?0:r.settings.stackedAxis==="Y"?1:2]+=extra(r.layerCount);else if(r.settings.mode==="finger_box"){for(let i=0;i<3;i++)extents[i]+=p.explode/100*Math.max(...built)*1.4;}else{extents[0]+=extra(r.settings.xSliceCount);extents[1]+=extra(r.settings.ySliceCount);}}
      const direction=(p.view==="front"?new THREE.Vector3(0,-1,0):p.view==="top"?new THREE.Vector3(0,-.002,1):new THREE.Vector3(.95,-1,.67)).normalize();
      const right=new THREE.Vector3(0,0,1).cross(direction).normalize(),up=direction.clone().cross(right).normalize();
      const tangent=Math.tan(camera.fov*Math.PI/360),aspect=Math.max(.1,el.clientWidth/Math.max(1,el.clientHeight));let distance=1;
      for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const corner=new THREE.Vector3(x*(extents[0]/2+2),y*(extents[1]/2+2),z*(extents[2]/2+2));distance=Math.max(distance,corner.dot(direction)+Math.max(Math.abs(corner.dot(right))/(tangent*aspect),Math.abs(corner.dot(up))/tangent));}
      distance*=1.12;camera.position.copy(target).addScaledVector(direction,distance);
      controls.target.copy(target);camera.near=Math.max(.05,distance/10000);camera.far=distance*40;camera.updateProjectionMatrix();controls.update();
    };
    sceneRef.current={scene,root,camera,controls,renderer,reset};reset();
    const resize=new ResizeObserver(()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();reset();});resize.observe(el);
    let raf=0;const draw=()=>{raf=requestAnimationFrame(draw);if(document.hidden||recording.current||latest.current.active===false)return;
      const p=latest.current,r=p.result;
      if(r){const centerX=(r.settings.xSliceCount-1)/2,centerY=(r.settings.ySliceCount-1)/2,centerStack=(r.layerCount-1)/2;
        root.children.forEach((object,index)=>{
          if(object.userData.ghost){object.visible=p.ghost;return;}
          const piece=object.userData.piece as LaserCutPiece;if(!piece)return;
          object.visible=index<p.step;
          object.position.copy(assembledPosition(piece)).add(explosionVector(piece,r,p.explode));
          const mat=(object as THREE.Mesh).material as THREE.Material[];
          if(mat){
            const isShell=["box_cap","box_wall","box_curved_wall"].includes(piece.category||"");
            for(const m of mat){m.transparent=!!(p.xray&&isShell);m.opacity=p.xray&&isShell?.25:1;m.depthWrite=!(p.xray&&isShell);}
            const face=mat[0] as THREE.MeshStandardMaterial;
            const stock=pieceMaterial(r.settings,piece);
            face.color.set(piece.id===p.selected?0xc7ed7a:p.colorByThickness?stock.colorHex:materialAppearance(stock).color);
            face.emissive.set(piece.id===p.selected?0x253315:0x000000);
          }
        });
      }controls.update();renderer.render(scene,camera);
    };draw();
    let down={x:0,y:0};const onDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
    const onUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hits=ray.intersectObjects(root.children.filter(o=>o.visible&&!o.userData.ghost),false);latest.current.onSelect(hits[0]?.object.userData.piece?.id||null);};
    const keydown=(e:KeyboardEvent)=>{if(e.key.toLowerCase()==="f")reset();};
    renderer.domElement.addEventListener("pointerdown",onDown);renderer.domElement.addEventListener("pointerup",onUp);renderer.domElement.addEventListener("keydown",keydown);
    return ()=>{cancelAnimationFrame(raf);resize.disconnect();controls.dispose();environment.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});renderer.dispose();renderer.domElement.remove();sceneRef.current=null;};
  },[]);
  useEffect(()=>{
    const ctx=sceneRef.current;if(!ctx||!props.result||props.active===false)return;
    const {root}=ctx;
    while(root.children.length){const o=root.children[0];root.remove(o);o.traverse(obj=>{if(obj instanceof THREE.Mesh||obj instanceof THREE.LineSegments){obj.geometry.dispose();(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>m.dispose());}});}
    const r=props.result;
    const textureCanvas=document.createElement("canvas");textureCanvas.width=textureCanvas.height=64;const tc=textureCanvas.getContext("2d")!;
    tc.fillStyle="#a2875c";tc.fillRect(0,0,64,64);for(let i=0;i<64;i++){tc.fillStyle=`rgba(48,31,12,${.08+.10*(1+Math.cos(i*Math.PI/5))/2})`;tc.fillRect(i,0,1,64);}
    const texture=new THREE.CanvasTexture(textureCanvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(.2,2);texture.colorSpace=THREE.SRGBColorSpace;
    const grainCanvas=document.createElement("canvas");grainCanvas.width=128;grainCanvas.height=64;const gc=grainCanvas.getContext("2d")!;gc.fillStyle="#ffffff";gc.fillRect(0,0,128,64);
    for(let j=0;j<64;j++){gc.strokeStyle=`rgba(94,70,34,${.02+.035*(1+Math.sin(j*1.7))/2})`;gc.beginPath();for(let x=0;x<=128;x+=4){const y=j+Math.sin(x*.04+j*.3)*1.8;x?gc.lineTo(x,y):gc.moveTo(x,y);}gc.stroke();}
    const grain=new THREE.CanvasTexture(grainCanvas);grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(.025,.025);grain.colorSpace=THREE.SRGBColorSpace;
    for(const piece of r.pieces){
      const geometry=pieceGeometry(piece,piece.thickness||r.settings.materialThickness);
      const stock=pieceMaterial(r.settings,piece),acrylic=stock.family==="acrylic",plywood=stock.family==="plywood";
      const appearance=materialAppearance(stock);
      const face=acrylic?new THREE.MeshPhysicalMaterial({...appearance,metalness:0,clearcoat:.25,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:appearance.color,roughness:appearance.roughness,map:plywood?grain:null,metalness:0,side:THREE.DoubleSide});
      const side=acrylic?new THREE.MeshPhysicalMaterial({...appearance,clearcoat:.35,side:THREE.DoubleSide}):new THREE.MeshStandardMaterial({color:plywood?0xa78b64:0x8e7146,roughness:1,map:texture,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,[face,side]);mesh.userData.piece=piece;root.add(mesh);
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),new THREE.LineBasicMaterial({color:0x65543a,transparent:true,opacity:.4}));mesh.add(edge);
    }
    const ghostGeometry=new THREE.BufferGeometry();ghostGeometry.setAttribute("position",new THREE.BufferAttribute(r.vertices,3));ghostGeometry.computeVertexNormals();
    const ghost=new THREE.Mesh(ghostGeometry,new THREE.MeshBasicMaterial({color:0xb3d6d0,wireframe:true,transparent:true,opacity:.095,depthWrite:false}));ghost.userData.ghost=true;root.add(ghost);
    return ()=>{texture.dispose();grain.dispose();};
  },[props.result,props.active]);
  useEffect(()=>{sceneRef.current?.reset();},[props.view,props.fit,props.result?.model.name,props.result?.dimensions[0],props.result?.dimensions[1],props.result?.dimensions[2],props.result?.settings.mode]);
  return <div className="assembly-canvas" ref={host}>{error&&<div className="viewport-error">{error}</div>}</div>;
});
export default AssemblyViewport;
