import { DEFAULT_SETTINGS, type LaserCutPiece, type MaterialThicknessPreset, type SliceSettings } from "./types";

export function materials(s: SliceSettings): MaterialThicknessPreset[] {
  const defaults = [
    { id: "T1", name: "Primary stock", thickness: s.materialThickness, laserKerf: s.laserKerf, colorHex: "#D4A373" },
    { id: "T2", name: "Medium stock", thickness: 4.5, laserKerf: .15, colorHex: "#4EA8DE" },
    { id: "T3", name: "Heavy stock", thickness: 6, laserKerf: .2, colorHex: "#9D4EDD" },
  ];
  return defaults.map(m => {
    const saved=s.materialPresets?.find(p => p.id === m.id),family=saved?.family||"cardboard";
    return { ...m, ...saved, family, hingeKFactor:saved?.hingeKFactor??.5, allowLivingHinges:saved?.allowLivingHinges??family!=="acrylic",
      ...(m.id === "T1" ? { thickness: s.materialThickness, laserKerf: s.laserKerf } : {}) };
  });
}
export const MATERIAL_NAMES={cardboard:"Cardboard",plywood:"Baltic Birch Plywood",acrylic:"Cast Acrylic",custom:"Custom"};
export const ACRYLIC_FINISHES={clear:{name:"Clear",color:"#e8f5fa",transmission:.88,roughness:.1},frosted:{name:"Frosted",color:"#dce7ee",transmission:.65,roughness:.2},smoke:{name:"Smoke",color:"#687785",transmission:.75,roughness:.14},green:{name:"Fluorescent Green",color:"#95ff3e",transmission:.7,roughness:.12},black:{name:"Opaque Black",color:"#171c23",transmission:0,roughness:.12},white:{name:"Opaque White",color:"#f4f5f5",transmission:0,roughness:.15}};
export function materialAppearance(stock:MaterialThicknessPreset){
  if(stock.family==="acrylic"){const finish=ACRYLIC_FINISHES[stock.acrylicFinish||"clear"];return {color:stock.tintHex||finish.color,roughness:finish.roughness,transmission:finish.transmission,ior:1.49,thickness:stock.thickness};}
  return {color:stock.family==="plywood"?"#d9be8b":stock.family==="custom"?stock.colorHex:"#d4b988",roughness:stock.family==="plywood"?.85:.94,transmission:0,ior:1.5,thickness:stock.thickness};
}
export function materialFor(s: SliceSettings, id: string, fallback = "T1"): MaterialThicknessPreset {
  const slot = s.partThickness?.[id] || s.partThickness?.[id.replace(/-[A-Z]$/, "")] || fallback;
  return materials(s).find(m => m.id === slot) || materials(s)[0];
}
export function pieceMaterial(s: SliceSettings, p: LaserCutPiece): MaterialThicknessPreset {
  return materials(s).find(m => m.id === p.assignedThicknessId) || materials(s)[0];
}
export function boxSettings(s: SliceSettings) {
  return { ...DEFAULT_SETTINGS.fingerBox!, ...s.fingerBox,
    bracing: { ...DEFAULT_SETTINGS.fingerBox!.bracing, ...s.fingerBox?.bracing } };
}
