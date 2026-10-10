export type Axis = "X" | "Y" | "Z";
export type Preset = "ripple" | "sphere" | "torus" | "cube" | "letter_t" | "letter_s" | "jimmy" | "donut_box";
export type SlicingMode = "interlocking" | "stacked" | "finger_box";
export type MaterialFamily = "cardboard" | "plywood" | "acrylic" | "custom";
export interface MaterialThicknessPreset {
  id: string; thickness: number; name: string; colorHex: string; laserKerf: number;
  family?: MaterialFamily; hingeKFactor?: number; allowLivingHinges?: boolean;
  hingePitch?: number; hingeSlitLength?: number;
  acrylicFinish?: "clear" | "frosted" | "smoke" | "green" | "black" | "white";
  tintHex?: string;
}
export interface ScrapSheet { id: string; width: number; height: number; thicknessId: string; quantity: number }
export interface BlindPinSettings { enabled: boolean; diameter: number; pinCount: number; skipTopLayersCount: number }
export interface InternalBraceSettings {
  enabled: boolean; mode: "auto" | "transverse" | "longitudinal" | "grid";
  maxUnsupportedSpan: number; spacing: number; braceThicknessId: string;
  jointType: "through_tenon" | "blind_notch" | "tab_and_slot";
  tenonWidth: number; tenonDepthRatio: number; tenonCountPerEdge: number;
  eggCrateSlotted: boolean; slotFitTolerance: number; cornerReliefSize: number; lightningHoles: boolean;
}
export interface FingerBoxSettings {
  fingerWidth: number; jointTolerance: number; cornerStyle: "sharp" | "dogbone" | "round";
  curveHandling: "facets" | "living_hinge"; chordalError: number;
  livingHingeSlitLength: number; livingHingeGap: number; bracing: InternalBraceSettings;
  extrusionAxis?: "auto" | Axis; shellConstruction?: "auto" | "extrusion" | "bands";
  bandHeight?: number; bandDeviation?: number; adaptiveBands?: boolean;
}
export interface Point2D { x: number; y: number }
export interface Path2DLoop { points: Point2D[]; isHole: boolean; isRegistration?: boolean }
export interface Stroke { points: Point2D[]; closed?: boolean }
export interface SliceSettings {
  mode: SlicingMode;
  targetWidth: number; targetDepth: number; targetHeight: number;
  keepAspectRatio: boolean; scaleAxis: Axis;
  materialThickness: number; laserKerf: number; slotFitTolerance: number;
  leadInChamfer: number; xSliceCount: number; ySliceCount: number; slotDepthRatio: number;
  stackedAxis: Axis; alignmentPins: boolean; alignmentPinType: "dowel" | "material"; pinDiameter: number; pinCount: number;
  sheetWidth: number; sheetHeight: number; sheetMargin: number; partSpacing: number;
  allowRotation: boolean;
  nestingMode?: "polygon" | "rectangles"; rotationStep?: 90 | 15;
  materialPresets?: MaterialThicknessPreset[]; partThickness?: Record<string, string>;
  scrapSheets?: ScrapSheet[]; skipTopLayersCount?: number; fingerBox?: FingerBoxSettings;
}
export interface Bounds2D { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
export interface LaserCutPiece {
  kind?: "alignment-pin";
  id: string; label: string; parentId: string; axis: Axis | "UNROLLED"; sliceIndex: number; worldPosition: number;
  unmodifiedPaths: Path2DLoop[]; assemblyPaths: Path2DLoop[]; cutPaths: Path2DLoop[];
  etchPaths: Stroke[]; bounds: Bounds2D; area: number; cutLength: number; joints: string[];
  category?: "rib" | "stacked_layer" | "box_cap" | "box_wall" | "box_curved_wall" | "brace" | "alignment_pin";
  assignedThicknessId?: string; thickness?: number; kerf?: number;
  interiorRegions?: Path2DLoop[]; cutStrokes?: Stroke[];
  worldTransform?: { position: [number, number, number]; rotation: [number, number, number, number] };
  // Bend the flat blank along this material-neutral perimeter path in the assembled preview.
  bendPath?: Point2D[]; bendZ?: number;
  // Developed distances can differ from the physical mid-surface at a calibrated K factor.
  bendDistances?: number[]; frameRotation?: [number, number, number, number]; framePosition?: [number, number, number];
  wallRole?: "outer" | "hole"; shellMethod?: "extrusion" | "mesh_panels" | "contour_bands";
  bandIndex?: number; bandRange?: [number, number]; plateRole?: "bottom" | "joining" | "top";
  explodeDirection?: [number, number, number]; anchorCount?: number;
}
export interface Placement { pieceId: string; x: number; y: number; rotation: number }
export interface NestedSheet { sheetIndex: number; placements: Placement[]; utilization: number; cutLength: number;
  id?: string; width?: number; height?: number; thicknessId?: string; source?: "scrap" | "stock"; scrapId?: string }
export interface Issue { code: string; severity: "warning" | "error"; message: string; partIds?: string[] }
export interface Joint { a: string; b: string; x: number; y: number; z: number }
export interface ModelInfo { name: string; triangleCount: number; originalDimensions: [number, number, number]; format: string; boundaryEdges: number; nonManifoldEdges: number }
export interface SliceResult {
  model: ModelInfo; dimensions: [number, number, number]; vertices: Float32Array;
  settings: SliceSettings; pieces: LaserCutPiece[]; sheets: NestedSheet[]; unplaced: string[];
  joints: Joint[]; pins: Point2D[]; issues: Issue[]; processingMs: number; layerCount: number; builtDepth: number;
}
export interface MeshData { vertices: Float64Array; info: ModelInfo }
export type WorkerRequest =
  | { id: number; type: "load"; buffer: ArrayBuffer; name: string; settings: SliceSettings }
  | { id: number; type: "preset"; preset: Preset; settings: SliceSettings }
  | { id: number; type: "settings"; settings: SliceSettings };
export interface SlicingProgress { stage: "geometry" | "nesting"; completed: number; total: number; percent: number }
export type WorkerResponse = { id: number; result: SliceResult } | { id: number; error: string } | { id: number; progress: SlicingProgress };
export const DEFAULT_SETTINGS: SliceSettings = {
  mode: "interlocking", targetWidth: 220, targetDepth: 180, targetHeight: 240,
  keepAspectRatio: true, scaleAxis: "X", materialThickness: 3.8, laserKerf: 0.15,
  slotFitTolerance: 0.05, leadInChamfer: 1.2, xSliceCount: 10, ySliceCount: 8, slotDepthRatio: 0.5,
  stackedAxis: "Z", alignmentPins: true, alignmentPinType: "dowel", pinDiameter: 6, pinCount: 2,
  sheetWidth: 900, sheetHeight: 600, sheetMargin: 10, partSpacing: 5, allowRotation: true,
  nestingMode: "polygon", rotationStep: 90,
  partThickness: {}, scrapSheets: [], skipTopLayersCount: 0,
  fingerBox: {
    fingerWidth: 10, jointTolerance: .1, cornerStyle: "sharp", curveHandling: "facets", chordalError: .5,
    livingHingeSlitLength: 16, livingHingeGap: 2,
    extrusionAxis: "auto", shellConstruction: "auto", bandHeight: 30, bandDeviation: 3, adaptiveBands: true,
    bracing: { enabled: false, mode: "auto", maxUnsupportedSpan: 75, spacing: 75, braceThicknessId: "T2",
      jointType: "tab_and_slot", tenonWidth: 12, tenonDepthRatio: 1, tenonCountPerEdge: 2,
      eggCrateSlotted: true, slotFitTolerance: .1, cornerReliefSize: 2, lightningHoles: true },
  },
};
