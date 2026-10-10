import type { SliceSettings } from "./slicer/types";

export const MACHINE_DEFAULTS_KEY = "makeslice_machine_defaults";
const ranges = {
  sheetWidth: [20, 5000], sheetHeight: [20, 5000], laserKerf: [0, 5],
  materialThickness: [.1, 100], slotFitTolerance: [-2, 5],
} as const;
type MachineField = keyof typeof ranges;
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

export function loadMachineDefaults(base: SliceSettings, storage?: StorageAccess): SliceSettings {
  const next = structuredClone(base);
  try {
    const value = (storage ?? window.localStorage).getItem(MACHINE_DEFAULTS_KEY);
    const saved: unknown = value && JSON.parse(value);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return next;
    for (const key of Object.keys(ranges) as MachineField[]) {
      const n = (saved as Record<string, unknown>)[key], [min, max] = ranges[key];
      if (typeof n === "number" && Number.isFinite(n) && n >= min && n <= max &&
          (!key.startsWith("sheet") || n > base.sheetMargin * 2)) next[key] = n;
    }
    if (next.materialThickness + next.slotFitTolerance <= next.laserKerf) {
      next.materialThickness = base.materialThickness;
      next.slotFitTolerance = base.slotFitTolerance;
      next.laserKerf = base.laserKerf;
    }
  } catch { /* Storage can be unavailable in private browsing and some file:// hosts. */ }
  return next;
}

export function saveMachineDefaults(settings: SliceSettings, storage?: StorageAccess): void {
  try {
    const values = Object.fromEntries((Object.keys(ranges) as MachineField[]).map(key => [key, settings[key]]));
    (storage ?? window.localStorage).setItem(MACHINE_DEFAULTS_KEY, JSON.stringify(values));
  } catch { /* A blocked preference store must never block fabrication or downloads. */ }
}
