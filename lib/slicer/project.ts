import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { validateSettings } from "./validation";
import { PRESET_NAMES } from "./presets";
import { APP_CONFIG } from "../app-config";
import { sanitizeFileComponent, type ExportOptions } from "./export-naming";
import type { Preset, SliceSettings } from "./types";

export type ProjectSource={kind:"preset";preset:Preset}|{kind:"mesh";name:string;bytes:Uint8Array};
export interface MakeSliceProject {settings:SliceSettings;source:ProjectSource;naming:ExportOptions;displayUnit:"mm"|"in"}
const LIMIT=100*1024*1024;
export function exportProject(project:MakeSliceProject){validateSettings(project.settings);const files:Record<string,Uint8Array>={};
  const source=project.source.kind==="preset"?project.source:{kind:"mesh",name:project.source.name,path:/\.obj$/i.test(project.source.name)?"mesh.obj":"mesh.stl"};
  if(project.source.kind==="mesh"){if(project.source.bytes.length>LIMIT)throw new Error("Mesh exceeds the project limit of 100 MB.");files[(source as {path:string}).path]=project.source.bytes;}
  files["project.json"]=strToU8(JSON.stringify({format:"makeslice-project",schemaVersion:1,appVersion:APP_CONFIG.VERSION,createdAt:new Date().toISOString(),settings:project.settings,source,naming:project.naming,displayUnit:project.displayUnit},null,2));
  return {filename:`${sanitizeFileComponent(project.naming.projectName||"MakeSlice")}.makeslice`,data:zipSync(files,{level:6})};
}
export function importProject(data:Uint8Array):MakeSliceProject{
  if(data.length>LIMIT)throw new Error("Project archive exceeds 100 MB.");let total=0;
  const files=unzipSync(data,{filter:file=>{total+=file.originalSize;if(total>LIMIT+2*1024*1024||!["project.json","mesh.obj","mesh.stl"].includes(file.name)||file.originalSize>(file.name==="project.json"?2*1024*1024:LIMIT))throw new Error("The project contains unexpected files or exceeds its size limit.");return true;}});
  if(!files["project.json"])throw new Error("This is not a MakeSlice project.");const p=JSON.parse(strFromU8(files["project.json"]));
  if(p.format!=="makeslice-project"||p.schemaVersion!==1)throw new Error("Unsupported MakeSlice project version.");validateSettings(p.settings);
  if(!p.naming||typeof p.naming!=="object")throw new Error("Project export naming is missing.");
  for(const key of ["projectName","prefix","suffix"])if(p.naming[key]!==undefined&&(typeof p.naming[key]!=="string"||p.naming[key].length>160))throw new Error("Invalid project filename metadata.");
  if(p.naming.includeSheetSuffix!==undefined&&typeof p.naming.includeSheetSuffix!=="boolean")throw new Error("Invalid sheet suffix preference.");if(p.naming.pageSize!==undefined&&!["letter","a4"].includes(p.naming.pageSize))throw new Error("Invalid guide page size.");if(!["mm","in"].includes(p.displayUnit))throw new Error("Invalid display unit.");
  let source:ProjectSource;
  if(p.source?.kind==="preset"&&Object.hasOwn(PRESET_NAMES,p.source.preset))source={kind:"preset",preset:p.source.preset};
  else if(p.source?.kind==="mesh"&&typeof p.source.name==="string"&&p.source.name.length<=200&&/\.(obj|stl)$/i.test(p.source.name)&&["mesh.stl","mesh.obj"].includes(p.source.path)&&p.source.path===(/\.obj$/i.test(p.source.name)?"mesh.obj":"mesh.stl")&&files[p.source.path]?.length)source={kind:"mesh",name:p.source.name,bytes:files[p.source.path]};
  else throw new Error("Project source mesh or preset is missing.");
  return {settings:p.settings,source,naming:p.naming,displayUnit:p.displayUnit};
}
export function projectFingerprint(project:Omit<MakeSliceProject,"source">){return JSON.stringify([project.settings,project.naming,project.displayUnit]);}
