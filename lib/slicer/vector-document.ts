import { GUIDE_FONTS } from "./guide-fonts";
import { strToU8, zlibSync } from "fflate";
import type { Point2D } from "./types";

const n=(v:number)=>Number(v.toFixed(3)).toString();
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
const rgb=(hex:string)=>[1,3,5].map(i=>n(parseInt(hex.slice(i,i+2),16)/255)).join(" ");
const pdfText=(value:string)=>{
  const replacements:Record<string,string>={"—":"-","–":"-","−":"-","→":">","↗":">","…":"...","°":"\xb0","×":"\xd7","·":"\xb7"};
  const normalized=value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[—–−→↗…°×·]/g,c=>replacements[c]);
  return normalized.replace(/[\x00-\x1f]/g," ").split("").map(c=>c.charCodeAt(0)>255?"?":c).join("");
};
const literal=(value:string)=>pdfText(value).split("").map(c=>c==="("||c===")"||c==="\\"?"\\"+c:c.charCodeAt(0)>126?"\\"+c.charCodeAt(0).toString(8).padStart(3,"0"):c).join("");

export interface VectorStyle { fill?:string; stroke?:string; weight?:number; dashed?:boolean; evenOdd?:boolean }
/** SVG embeds the original image; PDF shares a JPEG XObject between pages. */
export interface VectorImage { name:string; href:string; data:string; width:number; height:number }
export class VectorPage {
  readonly svgElements:string[]=[];
  readonly pdfCommands:string[]=[];
  readonly images=new Map<string,VectorImage>();
  constructor(readonly width:number,readonly height:number,readonly title:string){this.pdfCommands.push(`1 0 0 -1 0 ${n(height)} cm 1 J 1 j`);}
  path(paths:Point2D[][],closed:boolean,style:VectorStyle={}){
    if(!paths.length)return;
    const {fill,stroke,weight=.65,dashed=false,evenOdd=false}=style;
    const d=paths.map(path=>path.map((p,i)=>`${i?"L":"M"}${n(p.x)} ${n(p.y)}`).join(" ")+(closed?"Z":"")).join(" ");
    this.svgElements.push(`<path d="${d}" fill="${fill||"none"}" stroke="${stroke||"none"}" stroke-width="${n(weight)}"${dashed?' stroke-dasharray="3 3"':""}${evenOdd?' fill-rule="evenodd"':""}/>`);
    const geometry=paths.map(path=>path.map((p,i)=>`${n(p.x)} ${n(p.y)} ${i?"l":"m"}`).join(" ")+(closed?" h":"")).join(" ");
    this.pdfCommands.push(`q ${fill?rgb(fill)+" rg ":""}${stroke?rgb(stroke)+" RG "+n(weight)+" w ":""}${dashed?"[3 3] 0 d ":""}${geometry} ${fill&&stroke?(evenOdd?"B*":"B"):fill?(evenOdd?"f*":"f"):"S"} Q`);
  }
  line(a:Point2D,b:Point2D,stroke="#374151",weight=.65,dashed=false){this.path([[a,b]],false,{stroke,weight,dashed});}
  rect(x:number,y:number,w:number,h:number,fill?:string,stroke?:string){this.path([[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]],true,{fill,stroke});}
  circle(x:number,y:number,r:number,fill="#ffffff",stroke="#374151"){
    this.svgElements.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="${stroke}" stroke-width=".65"/>`);
    const k=r*.55228475;
    this.pdfCommands.push(`q ${rgb(fill)} rg ${rgb(stroke)} RG .65 w ${n(x+r)} ${n(y)} m ${n(x+r)} ${n(y+k)} ${n(x+k)} ${n(y+r)} ${n(x)} ${n(y+r)} c ${n(x-k)} ${n(y+r)} ${n(x-r)} ${n(y+k)} ${n(x-r)} ${n(y)} c ${n(x-r)} ${n(y-k)} ${n(x-k)} ${n(y-r)} ${n(x)} ${n(y-r)} c ${n(x+k)} ${n(y-r)} ${n(x+r)} ${n(y-k)} ${n(x+r)} ${n(y)} c B Q`);
  }
  text(value:string,x:number,y:number,size=10,bold=false,color="#1f2937",align:"left"|"center"|"right"="left"){
    this.svgElements.push(`<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}"${bold?' font-weight="bold"':""} fill="${color}" text-anchor="${align==="center"?"middle":align==="right"?"end":"start"}">${esc(value)}</text>`);
    const metrics=(bold?GUIDE_FONTS.bold:GUIDE_FONTS.regular).widths;
    const width=[...pdfText(value)].reduce((sum,c)=>sum+(metrics[c.charCodeAt(0)-32]||0),0)*size/1000;
    const left=x-(align==="center"?width/2:align==="right"?width:0);
    this.pdfCommands.push(`BT /${bold?"F2":"F1"} ${n(size)} Tf ${rgb(color)} rg 1 0 0 -1 ${n(left)} ${n(y)} Tm (${literal(value)}) Tj ET`);
  }
  image(image:VectorImage,x:number,y:number,width:number,height:number){
    if(!/^[A-Za-z][A-Za-z0-9]*$/.test(image.name))throw new Error("Invalid PDF image resource name.");
    this.images.set(image.name,image);
    this.svgElements.push(`<image href="${esc(image.href)}" x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}"/>`);
    this.pdfCommands.push(`q ${n(width)} 0 0 ${n(-height)} ${n(x)} ${n(y+height)} cm /${image.name} Do Q`);
  }
  svg(){return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.width*25.4/72)}mm" height="${n(this.height*25.4/72)}mm" viewBox="0 0 ${n(this.width)} ${n(this.height)}"><title>${esc(this.title)}</title><rect width="100%" height="100%" fill="white"/><g font-family="DejaVu Sans, Arial, Helvetica, sans-serif" stroke-linejoin="round" stroke-linecap="round">${this.svgElements.join("\n")}</g></svg>`;}
}
const concatenate=(arrays:Uint8Array[])=>{const result=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let i=0;for(const a of arrays){result.set(a,i);i+=a.length;}return result;};
export function vectorPDF(pages:VectorPage[],title:string):Uint8Array{
  const objects:Uint8Array[]=[];
  const images=new Map<string,VectorImage>();
  pages.forEach(page=>page.images.forEach((image,name)=>images.set(name,image)));
  const imageResources=new Map([...images.keys()].map((name,i)=>[name,9+pages.length*2+i]));
  const add=(s:string)=>objects.push(strToU8(s));
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(" ")}] >>`);
  [GUIDE_FONTS.regular,GUIDE_FONTS.bold].forEach((font,i)=>add(`<< /Type /Font /Subtype /TrueType /BaseFont /SLCLAB+DejaVuSans${i?"-Bold":""} /FirstChar 32 /LastChar 255 /Widths [${font.widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor ${5+pages.length*2+i*2} 0 R >>`));
  pages.forEach((page,i)=>{
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${page.images.size?` /XObject << ${[...page.images.keys()].map(name=>`/${name} ${imageResources.get(name)} 0 R`).join(" ")} >>`:""} >> /Contents ${6+i*2} 0 R >>`);
    const content=zlibSync(strToU8(page.pdfCommands.join("\n")),{level:6});
    objects.push(concatenate([strToU8(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`),content,strToU8("\nendstream")]));
  });
  [GUIDE_FONTS.regular,GUIDE_FONTS.bold].forEach((font,i)=>{
    add(`<< /Type /FontDescriptor /FontName /SLCLAB+DejaVuSans${i?"-Bold":""} /Flags 32 /FontBBox [${font.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.capHeight} /StemV ${i?120:80} /FontFile2 ${6+pages.length*2+i*2} 0 R >>`);
    const bytes=Uint8Array.from(atob(font.data),c=>c.charCodeAt(0)),compressed=zlibSync(bytes,{level:6});objects.push(concatenate([strToU8(`<< /Length ${compressed.length} /Length1 ${bytes.length} /Filter /FlateDecode >>\nstream\n`),compressed,strToU8("\nendstream")]));
  });
  for(const image of images.values()){
    const bytes=Uint8Array.from(atob(image.data),c=>c.charCodeAt(0));
    objects.push(concatenate([strToU8(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${bytes.length} /Filter /DCTDecode >>\nstream\n`),bytes,strToU8("\nendstream")]));
  }
  add(`<< /Title (${literal(title)}) /Creator (MakeSlice) /Producer (MakeSlice vector assembly writer) >>`);
  const chunks=[strToU8("%PDF-1.4\n%MakeSlice vector document\n")],offsets=[0];let length=chunks[0].length;
  objects.forEach((object,i)=>{offsets.push(length);const chunk=concatenate([strToU8(`${i+1} 0 obj\n`),object,strToU8("\nendobj\n")]);chunks.push(chunk);length+=chunk.length;});
  chunks.push(strToU8(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return concatenate(chunks);
}
