import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root=fileURLToPath(new URL("../",import.meta.url));
async function writeChanged(path,content){let current="";try{current=await readFile(path,"utf8");}catch{}if(current!==content)await writeFile(path,content);}
export async function embedAssets(){
  const models={};
  for(const [id,file] of [["jimmy","Jimmy.stl"],["donut_box","donut-box.stl"]])models[id]=(await readFile(resolve(root,"assets/models",file))).toString("base64");
  await writeChanged(resolve(root,"lib/slicer/embedded-models.ts"),`// Bundled source STL bytes. Embedded for offline file:// operation.\nexport const MODEL_BYTES=${JSON.stringify(models)};\n`);
  const logoBytes=await readFile(resolve(root,"assets/whatmakeart-logo.png")),logo=logoBytes.toString("base64");
  const printLogo=(await readFile(resolve(root,"assets/whatmakeart-print-logo.jpg"))).toString("base64");
  await writeChanged(resolve(root,"lib/brand-logo.ts"),`// Generated from the supplied What Make Art assets for offline operation.\nexport const BRAND_LOGO="data:image/png;base64,${logo}";\nexport const BRAND_PRINT_IMAGE={name:"BrandLogo",href:BRAND_LOGO,data:"${printLogo}",width:300,height:300};\n`);
  await writeChanged(resolve(root,"public/favicon.svg"),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><image width="600" height="600" href="data:image/png;base64,${logo}"/></svg>\n`);
  await writeFile(resolve(root,"public/favicon.png"),logoBytes);
}
