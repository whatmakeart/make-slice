import type { GuidePageSize } from "./assembly-guide";
import type { SliceResult } from "./types";
export interface ExportOptions { projectName?:string; prefix?:string; suffix?:string; includeSheetSuffix?:boolean; pageSize?:GuidePageSize }
export function sanitizeFileComponent(value:string):string{
  return value.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,"_").replace(/\s+/g,"_").replace(/_+/g,"_").replace(/^[. _]+|[. _]+$/g,"").slice(0,80).replace(/[. _]+$/g,"");
}
const reserved=/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
export function projectStem(r:SliceResult,options:ExportOptions={}):string{
  const value=sanitizeFileComponent(options.projectName?.trim()||r.model.name.replace(/\.(stl|obj)$/i,""))||"Slice_Lab";
  const safe=reserved.test(value)?`_${value}`:value,prefix=sanitizeFileComponent(options.prefix||"");return prefix?`${prefix}_${safe}`:safe;
}
const truncateBytes=(value:string,max:number)=>{let result="",length=0;for(const char of value){const size=new TextEncoder().encode(char).length;if(length+size>max)break;result+=char;length+=size;}return result;};
export function exportFileName(r:SliceResult,role:string,extension:string,options?:ExportOptions):string{
  if(!options)return `${role}.${extension}`;
  const suffix=truncateBytes(sanitizeFileComponent(options.suffix||""),60),ending=`_${role}${suffix?`_${suffix}`:""}.${extension}`;
  const stem=truncateBytes(projectStem(r,options),240-new TextEncoder().encode(ending).length);return `${stem}${ending}`;
}
export function sheetFileName(r:SliceResult,index:number,extension:string,options?:ExportOptions):string{
  const number=String(index+1).padStart(2,"0");
  if(!options)return `sheet-${number}.${extension}`;
  return exportFileName(r,`${options.includeSheetSuffix===false?"":"sheet_"}${number}`,extension,options);
}
