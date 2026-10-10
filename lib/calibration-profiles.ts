import { DEFAULT_SETTINGS, type MaterialThicknessPreset } from "./slicer/types";
import { validateSettings } from "./slicer/validation";
const KEY="makeslice_calibration_profiles_v1";
export interface CalibrationProfile {id:string;name:string;stock:MaterialThicknessPreset}
export function validateProfile(profile:CalibrationProfile){if(!profile||typeof profile.id!=="string"||profile.id.length>80||typeof profile.name!=="string"||!profile.name.trim()||profile.name.length>80)throw new Error("A calibration profile needs a name of at most 80 characters.");validateSettings({...structuredClone(DEFAULT_SETTINGS),mode:"stacked",alignmentPins:false,materialThickness:profile.stock?.thickness,laserKerf:profile.stock?.laserKerf,materialPresets:[{...profile.stock,id:"T1"}]});return profile;}
export function readProfiles():CalibrationProfile[]{try{const data=JSON.parse(window.localStorage.getItem(KEY)||"[]");if(!Array.isArray(data)||data.length>50)return [];return data.filter(p=>{try{validateProfile(p);return true;}catch{return false;}});}catch{return [];}}
export function saveProfile(profile:CalibrationProfile){validateProfile(profile);const all=readProfiles().filter(p=>p.id!==profile.id);all.push(profile);if(all.length>50)all.shift();window.localStorage.setItem(KEY,JSON.stringify(all));return all;}
export function deleteProfile(id:string){const all=readProfiles().filter(p=>p.id!==id);window.localStorage.setItem(KEY,JSON.stringify(all));return all;}
