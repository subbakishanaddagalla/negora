export type FilmProfileId =
  | 'c41-standard'
  | 'kodak-warm'
  | 'fuji-cool'
  | 'bw-silver'
  | 'bw-selenium'
  | 'positive-restore';

export type BwToneStyle = 'none' | 'selenium' | 'sepia' | 'cyanotype';

export type ViewMode = 'split' | 'positive' | 'negative' | 'side-by-side';

export type ActiveTool =
  | 'pan'
  | 'pick-base'
  | 'pick-gray'
  | 'heal'
  | 'crop'
  | 'perspective';

export type AppSection = 'darkroom' | 'contact-sheet' | 'guide';

export type PrintBorderStyle = 'none' | 'white' | 'black';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface CropRect {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  w: number; // normalized 0..1
  h: number; // normalized 0..1
}

export interface PerspectiveQuad {
  tl: Point2D;
  tr: Point2D;
  br: Point2D;
  bl: Point2D;
}

export interface HealStroke {
  id: string;
  x: number; // normalized 0..1 in processed frame
  y: number; // normalized 0..1 in processed frame
  radius: number; // normalized fraction of min(width, height)
}

export interface ToneCurves {
  master: Point2D[];
  r: Point2D[];
  g: Point2D[];
  b: Point2D[];
}

export interface SplitToneOffsets {
  shadows: Point2D; // x, y in -1..1
  midtones: Point2D;
  highlights: Point2D;
}

export interface GradingSettings {
  profile: FilmProfileId;
  bwTone: BwToneStyle;
  baseColor: RGB;
  autoBalance: number; // 0 to 100
  borderIgnore: number; // 0 to 20 (%)
  vignetteFix: number; // 0 to 100 (%)
  exposure: number; // -2.0 to +2.0 EV
  contrast: number; // -50 to +50
  highlights: number; // -100 to +100
  shadows: number; // -100 to +100
  blackPoint: number; // -30 to +50
  temperature: number; // -100 to +100
  tint: number; // -100 to +100
  saturation: number; // -100 to +100
  clarity: number; // 0 to 100
  sharpen: number; // 0 to 100
  dustClean: number; // 0 to 100
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  crop: CropRect | null;
  perspective: PerspectiveQuad | null;
  healStrokes: HealStroke[];
  curves: ToneCurves;
  splitTone: SplitToneOffsets;
  printBorder: PrintBorderStyle;
}

export interface GradingPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: Partial<GradingSettings>;
}

export interface RollMetadata {
  rollTitle: string;
  camera: string;
  lens: string;
  filmStock: string;
  iso: string;
  notes: string;
}

export interface HistogramData {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  maxCount: number;
  clipBlackPct: number;
  clipWhitePct: number;
}

export interface NegativeFrame {
  id: string;
  name: string;
  filmStockLabel: string;
  notes: string;
  isSample: boolean;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  sourceCanvas: HTMLCanvasElement;
  previewSourceData: ImageData;
  settings: GradingSettings;
  detectedType: 'c41' | 'bw' | 'positive';
}
