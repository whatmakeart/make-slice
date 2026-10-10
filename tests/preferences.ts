import assert from "node:assert/strict";
import { ParameterHistory } from "../lib/parameter-history";
import { loadMachineDefaults, saveMachineDefaults, MACHINE_DEFAULTS_KEY } from "../lib/machine-defaults";
import { DEFAULT_SETTINGS } from "../lib/slicer/types";

const history=new ParameterHistory<{n:number;nested:{kerf:number}}>();
let current={n:0,nested:{kerf:.15}};
assert.equal(history.undo(current),null);assert.equal(history.redo(current),null);
for(let i=1;i<=30;i++){const next={n:i,nested:{kerf:i/100}};assert.ok(history.push(current,next));current=next;}
for(let i=29;i>=5;i--){current=history.undo(current)!;assert.equal(current.n,i);assert.equal(current.nested.kerf,i===0?.15:i/100);}
assert.equal(history.undo(current),null);assert.equal(history.canUndo,false);
current=history.redo(current)!;assert.equal(current.n,6);
assert.equal(history.push(current,structuredClone(current)),false);assert.equal(history.canRedo,true);
const next={n:99,nested:{kerf:.99}};history.push(current,next);current.nested.kerf=77;
assert.equal(history.canRedo,false);assert.equal(history.undo(next)?.nested.kerf,.06);
history.clear();assert.equal(history.canUndo,false);assert.equal(history.canRedo,false);

const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
const settings={...structuredClone(DEFAULT_SETTINGS),sheetWidth:1200,sheetHeight:700,materialThickness:6,laserKerf:.2,slotFitTolerance:.08,targetWidth:380};
saveMachineDefaults(settings,storage);
assert.deepEqual(Object.keys(JSON.parse(values.get(MACHINE_DEFAULTS_KEY)!)).sort(),["laserKerf","materialThickness","sheetHeight","sheetWidth","slotFitTolerance"]);
const loaded=loadMachineDefaults(DEFAULT_SETTINGS,storage);
assert.equal(loaded.sheetWidth,1200);assert.equal(loaded.sheetHeight,700);assert.equal(loaded.materialThickness,6);assert.equal(loaded.laserKerf,.2);assert.equal(loaded.slotFitTolerance,.08);
assert.equal(loaded.targetWidth,DEFAULT_SETTINGS.targetWidth);assert.equal(loaded.fingerBox?.chordalError,DEFAULT_SETTINGS.fingerBox?.chordalError);
loaded.fingerBox!.chordalError=9;assert.notEqual(DEFAULT_SETTINGS.fingerBox!.chordalError,9);
for(const invalid of ['no JSON','[]','null','{"sheetWidth":20,"sheetHeight":-1,"materialThickness":"3","laserKerf":99}']){
  values.set(MACHINE_DEFAULTS_KEY,invalid);assert.deepEqual(loadMachineDefaults(DEFAULT_SETTINGS,storage),DEFAULT_SETTINGS);
}
values.set(MACHINE_DEFAULTS_KEY,JSON.stringify({sheetWidth:1000,materialThickness:.1,slotFitTolerance:-2,laserKerf:5,mode:"stacked",vertices:[1,2,3]}));
const safe=loadMachineDefaults(DEFAULT_SETTINGS,storage);assert.equal(safe.sheetWidth,1000);assert.equal(safe.materialThickness,DEFAULT_SETTINGS.materialThickness);assert.equal(safe.slotFitTolerance,DEFAULT_SETTINGS.slotFitTolerance);assert.equal(safe.mode,"interlocking");
const blocked={getItem(){throw new Error("Storage blocked");},setItem(){throw new Error("Quota exceeded");}};
assert.deepEqual(loadMachineDefaults(DEFAULT_SETTINGS,blocked),DEFAULT_SETTINGS);assert.doesNotThrow(()=>saveMachineDefaults(settings,blocked));
console.log("PASS: bounded nested parameter snapshots, undo/redo branches, no-op commits, machine-only persistence, invalid preference recovery, and blocked storage.");
