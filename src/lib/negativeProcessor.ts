import type {
  CropRect,
  FilmProfileId,
  GradingSettings,
  HealStroke,
  HistogramData,
  PerspectiveQuad,
  Point2D,
  RGB,
  SplitToneOffsets,
  ToneCurves,
} from '../types/darkroom';

export interface FilmProfileMeta {
  id: FilmProfileId;
  label: string;
  shortLabel: string;
  description: string;
  category: 'color' | 'bw' | 'restore';
}

export const FILM_PROFILES: FilmProfileMeta[] = [
  {
    id: 'c41-standard',
    label: 'C-41 Standard',
    shortLabel: 'C-41',
    description: 'Balanced orange-mask removal and neutral color reproduction',
    category: 'color',
  },
  {
    id: 'kodak-warm',
    label: 'Warm Portrait',
    shortLabel: 'Warm',
    description: 'Golden skin tones and gentle highlight roll-off',
    category: 'color',
  },
  {
    id: 'fuji-cool',
    label: 'Cool Daylight',
    shortLabel: 'Cool',
    description: 'Crisp cyan-greens and clean neutral whites',
    category: 'color',
  },
  {
    id: 'bw-silver',
    label: 'B&W Silver Gelatin',
    shortLabel: 'B&W',
    description: 'Panchromatic monochrome inversion with classic silver tonal curve',
    category: 'bw',
  },
  {
    id: 'bw-selenium',
    label: 'B&W Selenium Tone',
    shortLabel: 'Selenium',
    description: 'Archival split-tone monochrome with cool D-max shadows',
    category: 'bw',
  },
  {
    id: 'positive-restore',
    label: 'Faded Slide / Print',
    shortLabel: 'Restore',
    description: 'Restores faded color positives without negative inversion',
    category: 'restore',
  },
];

export const DEFAULT_BASE_COLOR: RGB = { r: 222, g: 132, b: 78 };

export function createDefaultCurves(): ToneCurves {
  return {
    master: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    r: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    g: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    b: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  };
}

export function createDefaultSplitTone(): SplitToneOffsets {
  return {
    shadows: { x: 0, y: 0 },
    midtones: { x: 0, y: 0 },
    highlights: { x: 0, y: 0 },
  };
}

export function createDefaultSettings(
  overrides: Partial<GradingSettings> = {}
): GradingSettings {
  return {
    profile: 'c41-standard',
    baseColor: { ...DEFAULT_BASE_COLOR },
    autoBalance: 94,
    borderIgnore: 4,
    vignetteFix: 0,
    exposure: 0,
    contrast: 8,
    highlights: 0,
    shadows: 6,
    blackPoint: 0,
    temperature: 0,
    tint: 0,
    saturation: 6,
    clarity: 12,
    dustClean: 0,
    rotate: 0,
    flipH: false,
    crop: null,
    perspective: null,
    healStrokes: [],
    curves: createDefaultCurves(),
    splitTone: createDefaultSplitTone(),
    printBorder: 'none',
    ...overrides,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function isSprocketOrBacklightPixel(r: number, g: number, b: number): boolean {
  const minC = Math.min(r, g, b);
  const maxC = Math.max(r, g, b);
  return minC > 218 && maxC - minC < 34;
}

export function analyzeNegativeImageData(imageData: ImageData): {
  baseColor: RGB;
  detectedType: 'c41' | 'bw' | 'positive';
  recommendedProfile: FilmProfileId;
  hasSprocketBorder: boolean;
} {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const step = Math.max(1, Math.floor(totalPixels / 14000));

  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);

  let filmSampleCount = 0;
  let totalSampleCount = 0;
  let whiteSprocketCount = 0;
  let chromaSum = 0;
  let lumaSum = 0;

  for (let i = 0; i < totalPixels; i += step) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    totalSampleCount++;

    if (isSprocketOrBacklightPixel(r, g, b)) {
      whiteSprocketCount++;
      continue;
    }

    histR[r]++;
    histG[g]++;
    histB[b]++;

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    chromaSum += maxC - minC;
    lumaSum += 0.299 * r + 0.587 * g + 0.114 * b;
    filmSampleCount++;
  }

  if (filmSampleCount < 64) {
    return {
      baseColor: { ...DEFAULT_BASE_COLOR },
      detectedType: 'c41',
      recommendedProfile: 'c41-standard',
      hasSprocketBorder: false,
    };
  }

  const findPercentile = (hist: Uint32Array, pct: number): number => {
    const target = Math.floor(filmSampleCount * pct);
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };

  const baseR = clamp(findPercentile(histR, 0.96), 48, 250);
  const baseG = clamp(findPercentile(histG, 0.96), 42, 250);
  const baseB = clamp(findPercentile(histB, 0.96), 36, 250);

  const avgChroma = chromaSum / filmSampleCount;
  const avgLuma = lumaSum / filmSampleCount;
  const hasSprocketBorder =
    whiteSprocketCount / Math.max(1, totalSampleCount) > 0.02;

  const isOrangeMask =
    baseR > baseB * 1.18 && baseR >= baseG * 1.06 && avgLuma > 45;

  let relativeChromaSum = 0;
  for (let i = 0; i < totalPixels; i += step) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    if (isSprocketOrBacklightPixel(r, g, b)) continue;
    const nr = r / baseR;
    const ng = g / baseG;
    const nb = b / baseB;
    relativeChromaSum += Math.max(nr, ng, nb) - Math.min(nr, ng, nb);
  }
  const avgRelativeChroma = relativeChromaSum / filmSampleCount;

  if (isOrangeMask) {
    return {
      baseColor: { r: baseR, g: baseG, b: baseB },
      detectedType: 'c41',
      recommendedProfile: 'c41-standard',
      hasSprocketBorder,
    };
  }

  if (avgChroma < 16 || avgRelativeChroma < 0.045) {
    return {
      baseColor: { r: baseR, g: baseG, b: baseB },
      detectedType: 'bw',
      recommendedProfile: 'bw-silver',
      hasSprocketBorder,
    };
  }

  return {
    baseColor: { r: baseR, g: baseG, b: baseB },
    detectedType: 'c41',
    recommendedProfile: 'c41-standard',
    hasSprocketBorder,
  };
}

/**
 * Automatically detects the inner photo boundary inside 35mm sprocket holes and film borders.
 */
export function detectFrameCrop(
  imageData: ImageData,
  settings: GradingSettings
): CropRect {
  const oriented = createOrientedImageData(
    imageData,
    settings.rotate,
    settings.flipH,
    settings.perspective,
    null
  );
  const { width, height, data } = oriented;

  // Scan top and bottom rows for white sprocket holes
  let topY = 0;
  let botY = height - 1;
  const maxScanY = Math.floor(height * 0.28);

  const rowHasSprocket = (y: number): boolean => {
    let whiteCount = 0;
    const samples = Math.max(1, Math.floor(width / 4));
    for (let x = 0; x < width; x += 4) {
      const idx = (y * width + x) * 4;
      if (isSprocketOrBacklightPixel(data[idx], data[idx + 1], data[idx + 2])) {
        whiteCount++;
      }
    }
    return whiteCount / samples > 0.035;
  };

  for (let y = 0; y < maxScanY; y++) {
    if (rowHasSprocket(y)) topY = Math.min(height - 20, y + 6);
  }
  for (let y = height - 1; y >= height - maxScanY; y--) {
    if (rowHasSprocket(y)) botY = Math.max(topY + 20, y - 6);
  }

  // Add subtle 1.5% rebate trim inside sprocket line
  const padY = Math.round(height * 0.015);
  topY = clamp(topY + padY, 0, Math.floor(height * 0.35));
  botY = clamp(botY - padY, topY + 20, height - 1);

  // Scan left/right edges for low-variance orange/dark film rebate gutters
  let leftX = 0;
  let rightX = width - 1;
  const maxScanX = Math.floor(width * 0.22);

  const colVariance = (x: number): number => {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = topY; y <= botY; y += 3) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      sum += lum;
      sumSq += lum * lum;
      count++;
    }
    if (count < 2) return 0;
    const mean = sum / count;
    return sumSq / count - mean * mean;
  };

  for (let x = 0; x < maxScanX; x++) {
    if (colVariance(x) < 85) leftX = x + 3;
    else break;
  }
  for (let x = width - 1; x >= width - maxScanX; x--) {
    if (colVariance(x) < 85) rightX = x - 3;
    else break;
  }

  const nx = clamp(leftX / width, 0, 0.4);
  const ny = clamp(topY / height, 0, 0.4);
  const nw = clamp((rightX - leftX) / width, 0.2, 1 - nx);
  const nh = clamp((botY - topY) / height, 0.2, 1 - ny);

  return { x: nx, y: ny, w: nw, h: nh };
}

/**
 * Detects multiple adjacent film frames in a scanned film strip by locating
 * vertical inter-frame gaps (low-variance film base gutters).
 */
export function detectStripSubFrames(
  imageData: ImageData,
  settings: GradingSettings
): CropRect[] {
  const baseCrop = detectFrameCrop(imageData, settings);
  const oriented = createOrientedImageData(
    imageData,
    settings.rotate,
    settings.flipH,
    settings.perspective,
    null
  );
  const { width, height, data } = oriented;

  const y0 = Math.round(baseCrop.y * height);
  const y1 = Math.round((baseCrop.y + baseCrop.h) * height);
  const x0 = Math.round(baseCrop.x * width);
  const x1 = Math.round((baseCrop.x + baseCrop.w) * width);

  // Measure per-column variance and redness/uniformity to locate gutters
  const variances = new Float32Array(width);
  for (let x = x0; x < x1; x++) {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 3) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      sum += lum;
      sumSq += lum * lum;
      count++;
    }
    const mean = count > 0 ? sum / count : 0;
    variances[x] = count > 0 ? sumSq / count - mean * mean : 0;
  }

  // Smooth variances and look for low-variance valleys (gutters)
  const gutters: number[] = [];
  const minFrameWidth = Math.max(40, Math.round((y1 - y0) * 0.65));
  let inGutter = false;
  let gutterStart = x0;

  for (let x = x0 + Math.round(minFrameWidth * 0.5); x < x1 - Math.round(minFrameWidth * 0.5); x++) {
    const isLowVar = variances[x] < 110;
    if (isLowVar && !inGutter) {
      inGutter = true;
      gutterStart = x;
    } else if (!isLowVar && inGutter) {
      inGutter = false;
      const gWidth = x - gutterStart;
      if (gWidth >= 4) {
        const center = Math.round((gutterStart + x) / 2);
        if (
          gutters.length === 0 ||
          center - gutters[gutters.length - 1] >= minFrameWidth
        ) {
          gutters.push(center);
        }
      }
    }
  }

  if (gutters.length === 0) {
    // Fallback: if very wide strip (aspect > 2.2), split evenly into 2 or 3 frames
    const activeW = x1 - x0;
    const activeH = y1 - y0;
    const ratio = activeW / Math.max(1, activeH);
    if (ratio >= 2.2) {
      const count = ratio >= 3.6 ? 3 : 2;
      const out: CropRect[] = [];
      const sliceW = baseCrop.w / count;
      for (let i = 0; i < count; i++) {
        out.push({
          x: baseCrop.x + i * sliceW + 0.008,
          y: baseCrop.y,
          w: sliceW - 0.016,
          h: baseCrop.h,
        });
      }
      return out;
    }
    return [baseCrop];
  }

  const cuts = [x0, ...gutters, x1];
  const frames: CropRect[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const fx0 = cuts[i] + (i === 0 ? 0 : 4);
    const fx1 = cuts[i + 1] - (i === cuts.length - 2 ? 0 : 4);
    if (fx1 - fx0 < minFrameWidth * 0.45) continue;
    frames.push({
      x: clamp(fx0 / width, 0, 0.98),
      y: baseCrop.y,
      w: clamp((fx1 - fx0) / width, 0.05, 1),
      h: baseCrop.h,
    });
  }

  return frames.length > 0 ? frames : [baseCrop];
}

export function getOrientedDimensions(
  width: number,
  height: number,
  rotate: 0 | 90 | 180 | 270
): { width: number; height: number } {
  if (rotate === 90 || rotate === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * Solves an 8-DOF projective homography mapping unit square [0,1]x[0,1]
 * onto an arbitrary quadrilateral { tl, tr, br, bl }.
 */
function computeUnitSquareToQuadHomography(q: PerspectiveQuad): number[] {
  const x0 = q.tl.x;
  const y0 = q.tl.y;
  const x1 = q.tr.x;
  const y1 = q.tr.y;
  const x2 = q.br.x;
  const y2 = q.br.y;
  const x3 = q.bl.x;
  const y3 = q.bl.y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-8) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;

  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;

  return [a, b, c, d, e, f, g, h, 1];
}

export function applyPerspectiveWarp(
  src: ImageData,
  quad: PerspectiveQuad
): ImageData {
  const sw = src.width;
  const sh = src.height;

  // Estimate output rectangle aspect from quad edge lengths
  const topW = Math.hypot((quad.tr.x - quad.tl.x) * sw, (quad.tr.y - quad.tl.y) * sh);
  const botW = Math.hypot((quad.br.x - quad.bl.x) * sw, (quad.br.y - quad.bl.y) * sh);
  const leftH = Math.hypot((quad.bl.x - quad.tl.x) * sw, (quad.bl.y - quad.tl.y) * sh);
  const rightH = Math.hypot((quad.br.x - quad.tr.x) * sw, (quad.br.y - quad.tr.y) * sh);

  const outW = clamp(Math.round((topW + botW) / 2), 64, sw);
  const outH = clamp(Math.round((leftH + rightH) / 2), 64, sh);

  const H = computeUnitSquareToQuadHomography({
    tl: { x: quad.tl.x * sw, y: quad.tl.y * sh },
    tr: { x: quad.tr.x * sw, y: quad.tr.y * sh },
    br: { x: quad.br.x * sw, y: quad.br.y * sh },
    bl: { x: quad.bl.x * sw, y: quad.bl.y * sh },
  });

  const out = new Uint8ClampedArray(outW * outH * 4);
  const sData = src.data;

  for (let y = 0; y < outH; y++) {
    const v = y / Math.max(1, outH - 1);
    for (let x = 0; x < outW; x++) {
      const u = x / Math.max(1, outW - 1);
      const denom = H[6] * u + H[7] * v + H[8];
      const sx = clamp((H[0] * u + H[1] * v + H[2]) / denom, 0, sw - 1.001);
      const sy = clamp((H[3] * u + H[4] * v + H[5]) / denom, 0, sh - 1.001);

      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x0 + 1) * 4;
      const i01 = ((y0 + 1) * sw + x0) * 4;
      const i11 = ((y0 + 1) * sw + x0 + 1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const dIdx = (y * outW + x) * 4;
      out[dIdx] = sData[i00] * w00 + sData[i10] * w10 + sData[i01] * w01 + sData[i11] * w11;
      out[dIdx + 1] =
        sData[i00 + 1] * w00 + sData[i10 + 1] * w10 + sData[i01 + 1] * w01 + sData[i11 + 1] * w11;
      out[dIdx + 2] =
        sData[i00 + 2] * w00 + sData[i10 + 2] * w10 + sData[i01 + 2] * w01 + sData[i11 + 2] * w11;
      out[dIdx + 3] = 255;
    }
  }

  return new ImageData(out, outW, outH);
}

export function cropImageData(src: ImageData, crop: CropRect | null): ImageData {
  if (!crop) return src;
  const cx = clamp(Math.round(crop.x * src.width), 0, src.width - 2);
  const cy = clamp(Math.round(crop.y * src.height), 0, src.height - 2);
  const cw = clamp(Math.round(crop.w * src.width), 2, src.width - cx);
  const ch = clamp(Math.round(crop.h * src.height), 2, src.height - cy);

  if (cx === 0 && cy === 0 && cw === src.width && ch === src.height) {
    return src;
  }

  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((cy + y) * src.width + cx) * 4;
    const dstStart = y * cw * 4;
    out.set(src.data.subarray(srcStart, srcStart + cw * 4), dstStart);
  }
  return new ImageData(out, cw, ch);
}

export function createOrientedImageData(
  src: ImageData,
  rotate: 0 | 90 | 180 | 270,
  flipH: boolean,
  perspective: PerspectiveQuad | null = null,
  crop: CropRect | null = null
): ImageData {
  let oriented: ImageData;
  if (rotate === 0 && !flipH) {
    oriented = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  } else {
    const { width: outW, height: outH } = getOrientedDimensions(
      src.width,
      src.height,
      rotate
    );
    const out = new Uint8ClampedArray(outW * outH * 4);
    const sData = src.data;
    const sW = src.width;
    const sH = src.height;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const fx = flipH ? outW - 1 - x : x;
        let sx = fx;
        let sy = y;

        if (rotate === 90) {
          sx = y;
          sy = sH - 1 - fx;
        } else if (rotate === 180) {
          sx = sW - 1 - fx;
          sy = sH - 1 - y;
        } else if (rotate === 270) {
          sx = sW - 1 - y;
          sy = fx;
        }

        const sIdx = (sy * sW + sx) * 4;
        const dIdx = (y * outW + x) * 4;
        out[dIdx] = sData[sIdx];
        out[dIdx + 1] = sData[sIdx + 1];
        out[dIdx + 2] = sData[sIdx + 2];
        out[dIdx + 3] = sData[sIdx + 3];
      }
    }

    oriented = new ImageData(out, outW, outH);
  }

  if (perspective) {
    oriented = applyPerspectiveWarp(oriented, perspective);
  }

  return crop ? cropImageData(oriented, crop) : oriented;
}

/**
 * Corrects radial backlight falloff / vignetting from tablets & DIY lightboxes
 * prior to log-density inversion.
 */
function applyBacklightCorrection(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number
) {
  if (amount <= 0) return;
  const k = (amount / 100) * 0.42;
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const maxR2 = cx * cx + cy * cy || 1;

  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const r2 = (dx * dx + dy2) / maxR2;
      const gain = 1 + k * r2;
      const idx = (rowOff + x) * 4;
      if (isSprocketOrBacklightPixel(data[idx], data[idx + 1], data[idx + 2])) {
        continue;
      }
      data[idx] = clampByte(data[idx] * gain);
      data[idx + 1] = clampByte(data[idx + 1] * gain);
      data[idx + 2] = clampByte(data[idx + 2] * gain);
    }
  }
}

/**
 * Interactive spot healing brush: patches dust specks, hairs, and scratches
 * using surrounding annulus samples blended smoothly across the brush radius.
 */
function applyHealStrokes(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  strokes: HealStroke[]
) {
  if (!strokes || strokes.length === 0) return;
  const minDim = Math.min(w, h);

  for (const stroke of strokes) {
    const cx = Math.round(stroke.x * (w - 1));
    const cy = Math.round(stroke.y * (h - 1));
    const rad = Math.max(2, Math.round(stroke.radius * minDim));
    const outerR = Math.max(rad + 3, Math.round(rad * 1.65));

    const yMin = Math.max(0, cy - rad);
    const yMax = Math.min(h - 1, cy + rad);
    const xMin = Math.max(0, cx - rad);
    const xMax = Math.min(w - 1, cx + rad);

    // Sample clean surrounding annulus colors at 12 angles
    const ringSamples: Array<{ r: number; g: number; b: number; dx: number; dy: number }> = [];
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const sx = clamp(Math.round(cx + Math.cos(ang) * outerR), 0, w - 1);
      const sy = clamp(Math.round(cy + Math.sin(ang) * outerR), 0, h - 1);
      const sIdx = (sy * w + sx) * 4;
      ringSamples.push({
        r: data[sIdx],
        g: data[sIdx + 1],
        b: data[sIdx + 2],
        dx: sx - cx,
        dy: sy - cy,
      });
    }

    const copy = new Uint8ClampedArray((xMax - xMin + 1) * (yMax - yMin + 1) * 4);
    const boxW = xMax - xMin + 1;
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const sIdx = (y * w + x) * 4;
        const cIdx = ((y - yMin) * boxW + (x - xMin)) * 4;
        copy[cIdx] = data[sIdx];
        copy[cIdx + 1] = data[sIdx + 1];
        copy[cIdx + 2] = data[sIdx + 2];
      }
    }

    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > rad) continue;

        // Distance-weighted interpolation from clean annulus ring + subtle texture offset
        let sumW = 0;
        let accR = 0;
        let accG = 0;
        let accB = 0;
        const lx = x - cx;
        const ly = y - cy;

        for (const s of ringSamples) {
          const d2 = (lx - s.dx) * (lx - s.dx) + (ly - s.dy) * (ly - s.dy) + 4;
          const weight = 1 / d2;
          accR += s.r * weight;
          accG += s.g * weight;
          accB += s.b * weight;
          sumW += weight;
        }

        const targetR = accR / sumW;
        const targetG = accG / sumW;
        const targetB = accB / sumW;

        // Cosine feather at boundary
        const t = dist / rad;
        const blend = t < 0.55 ? 1 : 0.5 * (1 + Math.cos(((t - 0.55) / 0.45) * Math.PI));

        const dIdx = (y * w + x) * 4;
        const cIdx = ((y - yMin) * boxW + (x - xMin)) * 4;
        data[dIdx] = clampByte(copy[cIdx] + (targetR - copy[cIdx]) * blend);
        data[dIdx + 1] = clampByte(copy[cIdx + 1] + (targetG - copy[cIdx + 1]) * blend);
        data[dIdx + 2] = clampByte(copy[cIdx + 2] + (targetB - copy[cIdx + 2]) * blend);
      }
    }
  }
}

function applyDustClean(data: Uint8ClampedArray, w: number, h: number, strength: number) {
  if (strength <= 0) return;
  const copy = new Uint8ClampedArray(data);
  const threshold = 58 - (strength / 100) * 44;
  const mix = clamp(strength / 100, 0.25, 1.0);
  const buf = new Uint8Array(9);

  for (let y = 1; y < h - 1; y++) {
    const rowOff = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = (rowOff + x) * 4;
      for (let c = 0; c < 3; c++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const nRow = (y + dy) * w;
          for (let dx = -1; dx <= 1; dx++) {
            buf[k++] = copy[(nRow + x + dx) * 4 + c];
          }
        }
        for (let i = 1; i < 9; i++) {
          const val = buf[i];
          let j = i - 1;
          while (j >= 0 && buf[j] > val) {
            buf[j + 1] = buf[j];
            j--;
          }
          buf[j + 1] = val;
        }
        const median = buf[4];
        const cur = copy[idx + c];
        if (Math.abs(cur - median) > threshold) {
          data[idx + c] = clampByte(cur + (median - cur) * mix);
        }
      }
    }
  }
}

function applyClarity(data: Uint8ClampedArray, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  const copy = new Uint8ClampedArray(data);
  const strength = (amount / 100) * 0.65;

  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    const prevRow = (y - 1) * w;
    const nextRow = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = (row + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        const avg =
          (copy[(prevRow + x - 1) * 4 + c] +
            copy[(prevRow + x) * 4 + c] +
            copy[(prevRow + x + 1) * 4 + c] +
            copy[(row + x - 1) * 4 + c] +
            center +
            copy[(row + x + 1) * 4 + c] +
            copy[(nextRow + x - 1) * 4 + c] +
            copy[(nextRow + x) * 4 + c] +
            copy[(nextRow + x + 1) * 4 + c]) /
          9;
        const midWeight = 1 - Math.abs(center / 127.5 - 1) * 0.45;
        data[idx + c] = clampByte(center + (center - avg) * strength * midWeight);
      }
    }
  }
}

/**
 * Builds a smooth Fritsch-Carlson monotone cubic spline LUT (256 entries -> 0..1)
 * from normalized tone curve control points.
 */
export function buildCurveLut(points: Point2D[]): Float32Array {
  const lut = new Float32Array(256);
  const pts = [...points]
    .map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
    .sort((a, b) => a.x - b.x);

  if (pts.length < 2 || (pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 1 && pts[1].y === 1)) {
    for (let i = 0; i < 256; i++) lut[i] = i / 255;
    return lut;
  }

  // Ensure endpoints
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y });
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: pts[pts.length - 1].y });

  const n = pts.length;
  const dxs: number[] = [];
  const dys: number[] = [];
  const ms: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = Math.max(1e-5, pts[i + 1].x - pts[i].x);
    const dy = pts[i + 1].y - pts[i].y;
    dxs.push(dx);
    dys.push(dy);
    ms.push(dy / dx);
  }

  const c1s: number[] = [ms[0]];
  for (let i = 0; i < dxs.length - 1; i++) {
    const m = ms[i];
    const mNext = ms[i + 1];
    if (m * mNext <= 0) {
      c1s.push(0);
    } else {
      const dx = dxs[i];
      const dxNext = dxs[i + 1];
      const common = dx + dxNext;
      c1s.push((3 * common) / ((common + dxNext) / m + (common + dx) / mNext));
    }
  }
  c1s.push(ms[ms.length - 1]);

  const c2s: number[] = [];
  const c3s: number[] = [];
  for (let i = 0; i < c1s.length - 1; i++) {
    const c1 = c1s[i];
    const m = ms[i];
    const invDx = 1 / dxs[i];
    const common = c1 + c1s[i + 1] - m - m;
    c2s.push((m - c1 - common) * invDx);
    c3s.push(common * invDx * invDx);
  }

  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let seg = 0;
    for (let s = 0; s < n - 1; s++) {
      if (x >= pts[s].x && x <= pts[s + 1].x) {
        seg = s;
        break;
      }
    }
    const diff = x - pts[seg].x;
    const y = pts[seg].y + diff * (c1s[seg] + diff * (c2s[seg] + diff * c3s[seg]));
    lut[i] = clamp(y, 0, 1);
  }

  return lut;
}

function wheelOffsetToRgbDelta(pt: Point2D, strength: number): { dr: number; dg: number; db: number } {
  // x: -1 (cyan) .. +1 (red), y: -1 (blue/magenta) .. +1 (yellow/green)
  const r = pt.x * 0.8 + pt.y * 0.45;
  const g = -pt.x * 0.35 + pt.y * 0.65;
  const b = -pt.x * 0.65 - pt.y * 0.8;
  // Normalize mean so luminance stays steady
  const mean = (r + g + b) / 3;
  return {
    dr: (r - mean) * strength,
    dg: (g - mean) * strength,
    db: (b - mean) * strength,
  };
}

export interface ProcessResult {
  imageData: ImageData;
  histogram: HistogramData;
}

export function processNegativeImageData(
  rawSource: ImageData,
  settings: GradingSettings,
  ignoreCrop = false,
  ignorePerspective = false
): ProcessResult {
  const oriented = createOrientedImageData(
    rawSource,
    settings.rotate,
    settings.flipH,
    ignorePerspective ? null : settings.perspective,
    ignoreCrop ? null : settings.crop
  );
  const { width, height, data } = oriented;
  const totalPixels = width * height;

  if (settings.vignetteFix > 0 && settings.profile !== 'positive-restore') {
    applyBacklightCorrection(data, width, height, settings.vignetteFix);
  }

  if (settings.dustClean > 0) {
    applyDustClean(data, width, height, settings.dustClean);
  }

  const isRestorePositive = settings.profile === 'positive-restore';
  const isBW =
    settings.profile === 'bw-silver' || settings.profile === 'bw-selenium';

  const baseR = Math.max(20, settings.baseColor.r);
  const baseG = Math.max(20, settings.baseColor.g);
  const baseB = Math.max(20, settings.baseColor.b);
  const baseY = 0.299 * baseR + 0.587 * baseG + 0.114 * baseB;

  const marginX = Math.floor((width * settings.borderIgnore) / 100);
  const marginY = Math.floor((height * settings.borderIgnore) / 100);
  const startX = Math.min(marginX, Math.floor(width * 0.25));
  const endX = Math.max(width - startX, startX + 1);
  const startY = Math.min(marginY, Math.floor(height * 0.25));
  const endY = Math.max(height - startY, startY + 1);

  const BINS = 512;
  const MIN_DENSITY = -1.6;
  const MAX_DENSITY = 5.4;
  const DENSITY_SPAN = MAX_DENSITY - MIN_DENSITY;

  const densHistR = new Uint32Array(BINS);
  const densHistG = new Uint32Array(BINS);
  const densHistB = new Uint32Array(BINS);
  const densHistAll = new Uint32Array(BINS);

  const rgbHistR = new Uint32Array(256);
  const rgbHistG = new Uint32Array(256);
  const rgbHistB = new Uint32Array(256);
  const rgbHistAll = new Uint32Array(256);

  const innerW = endX - startX;
  const innerH = endY - startY;
  const innerCount = innerW * innerH;
  const sampleStep = Math.max(1, Math.floor(innerCount / 16000));
  let sampled = 0;

  const densLutR = new Float32Array(256);
  const densLutG = new Float32Array(256);
  const densLutB = new Float32Array(256);

  for (let v = 0; v < 256; v++) {
    densLutR[v] = -Math.log(Math.max(v / baseR, 0.0045));
    densLutG[v] = -Math.log(Math.max(v / baseG, 0.0045));
    densLutB[v] = -Math.log(Math.max(v / baseB, 0.0045));
  }

  for (let k = 0; k < innerCount; k += sampleStep) {
    const lx = k % innerW;
    const ly = Math.floor(k / innerW);
    const idx = ((startY + ly) * width + (startX + lx)) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    if (!isRestorePositive && isSprocketOrBacklightPixel(r, g, b)) {
      continue;
    }

    if (isRestorePositive) {
      rgbHistR[r]++;
      rgbHistG[g]++;
      rgbHistB[b]++;
      const yVal = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
      rgbHistAll[yVal]++;
    } else if (isBW) {
      const yVal = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
      const dY = -Math.log(Math.max(yVal / baseY, 0.0045));
      const bin = clamp(
        Math.floor(((dY - MIN_DENSITY) / DENSITY_SPAN) * (BINS - 1)),
        0,
        BINS - 1
      );
      densHistAll[bin]++;
    } else {
      const binR = clamp(
        Math.floor(((densLutR[r] - MIN_DENSITY) / DENSITY_SPAN) * (BINS - 1)),
        0,
        BINS - 1
      );
      const binG = clamp(
        Math.floor(((densLutG[g] - MIN_DENSITY) / DENSITY_SPAN) * (BINS - 1)),
        0,
        BINS - 1
      );
      const binB = clamp(
        Math.floor(((densLutB[b] - MIN_DENSITY) / DENSITY_SPAN) * (BINS - 1)),
        0,
        BINS - 1
      );
      densHistR[binR]++;
      densHistG[binG]++;
      densHistB[binB]++;
      densHistAll[Math.round(0.299 * binR + 0.587 * binG + 0.114 * binB)]++;
    }
    sampled++;
  }

  const percentileFromDensHist = (hist: Uint32Array, pct: number): number => {
    const target = Math.max(1, Math.floor(sampled * pct));
    let acc = 0;
    const len = hist.length;
    for (let i = 0; i < len; i++) {
      acc += hist[i];
      if (acc >= target) {
        return MIN_DENSITY + (i / (len - 1)) * DENSITY_SPAN;
      }
    }
    return MAX_DENSITY;
  };

  const percentileFromRgbHist = (hist: Uint32Array, pct: number): number => {
    const target = Math.max(1, Math.floor(sampled * pct));
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  };

  let lowR = 0;
  let highR = 1;
  let lowG = 0;
  let highG = 1;
  let lowB = 0;
  let highB = 1;

  const balanceMix = clamp(settings.autoBalance / 100, 0, 1);

  if (sampled < 24) {
    lowR = lowG = lowB = 0;
    highR = highG = highB = isRestorePositive ? 255 : 2.2;
  } else if (isRestorePositive) {
    const pLowAll = percentileFromRgbHist(rgbHistAll, 0.006);
    const pHighAll = Math.max(pLowAll + 20, percentileFromRgbHist(rgbHistAll, 0.994));
    const pLowR = percentileFromRgbHist(rgbHistR, 0.006);
    const pHighR = Math.max(pLowR + 20, percentileFromRgbHist(rgbHistR, 0.994));
    const pLowG = percentileFromRgbHist(rgbHistG, 0.006);
    const pHighG = Math.max(pLowG + 20, percentileFromRgbHist(rgbHistG, 0.994));
    const pLowB = percentileFromRgbHist(rgbHistB, 0.006);
    const pHighB = Math.max(pLowB + 20, percentileFromRgbHist(rgbHistB, 0.994));

    lowR = pLowAll + (pLowR - pLowAll) * balanceMix;
    highR = pHighAll + (pHighR - pHighAll) * balanceMix;
    lowG = pLowAll + (pLowG - pLowAll) * balanceMix;
    highG = pHighAll + (pHighG - pHighAll) * balanceMix;
    lowB = pLowAll + (pLowB - pLowAll) * balanceMix;
    highB = pHighAll + (pHighB - pHighAll) * balanceMix;
  } else if (isBW) {
    const lowY = percentileFromDensHist(densHistAll, 0.006);
    const highY = Math.max(lowY + 0.18, percentileFromDensHist(densHistAll, 0.994));
    lowR = lowG = lowB = lowY;
    highR = highG = highB = highY;
  } else {
    const pLowAll = percentileFromDensHist(densHistAll, 0.008);
    const pHighAll = Math.max(pLowAll + 0.2, percentileFromDensHist(densHistAll, 0.994));
    const pLowR = percentileFromDensHist(densHistR, 0.008);
    const pHighR = Math.max(pLowR + 0.2, percentileFromDensHist(densHistR, 0.994));
    const pLowG = percentileFromDensHist(densHistG, 0.008);
    const pHighG = Math.max(pLowG + 0.2, percentileFromDensHist(densHistG, 0.994));
    const pLowB = percentileFromDensHist(densHistB, 0.008);
    const pHighB = Math.max(pLowB + 0.2, percentileFromDensHist(densHistB, 0.994));

    lowR = pLowAll + (pLowR - pLowAll) * balanceMix;
    highR = pHighAll + (pHighR - pHighAll) * balanceMix;
    lowG = pLowAll + (pLowG - pLowAll) * balanceMix;
    highG = pHighAll + (pHighG - pHighAll) * balanceMix;
    lowB = pLowAll + (pLowB - pLowAll) * balanceMix;
    highB = pHighAll + (pHighB - pHighAll) * balanceMix;
  }

  const exposureMult = Math.pow(2, settings.exposure * 0.72);
  const blackOffset = settings.blackPoint / 255;
  const contrastFactor = settings.contrast / 50;
  const hlAmt = settings.highlights / 100;
  const shAmt = settings.shadows / 100;
  const tempShift = (settings.temperature / 100) * 0.18;
  const tintShift = (settings.tint / 100) * 0.14;
  const satMult = 1 + settings.saturation / 100;

  let profR = 1.0;
  let profG = 1.0;
  let profB = 1.0;
  let profGamma = 0.94;
  if (settings.profile === 'kodak-warm') {
    profR = 1.04;
    profG = 1.01;
    profB = 0.95;
    profGamma = 0.91;
  } else if (settings.profile === 'fuji-cool') {
    profR = 0.97;
    profG = 1.02;
    profB = 1.03;
    profGamma = 0.95;
  }

  // Tone curve LUTs
  const curveMaster = buildCurveLut(settings.curves?.master ?? []);
  const curveR = buildCurveLut(settings.curves?.r ?? []);
  const curveG = buildCurveLut(settings.curves?.g ?? []);
  const curveB = buildCurveLut(settings.curves?.b ?? []);

  // Split-tone wheel deltas
  const st = settings.splitTone ?? createDefaultSplitTone();
  const shDelta = wheelOffsetToRgbDelta(st.shadows, 0.24);
  const midDelta = wheelOffsetToRgbDelta(st.midtones, 0.22);
  const hlDelta = wheelOffsetToRgbDelta(st.highlights, 0.24);
  const hasSplitTone =
    st.shadows.x !== 0 ||
    st.shadows.y !== 0 ||
    st.midtones.x !== 0 ||
    st.midtones.y !== 0 ||
    st.highlights.x !== 0 ||
    st.highlights.y !== 0;

  const buildChannelLut = (
    densLut: Float32Array,
    low: number,
    high: number,
    profMult: number,
    channelCurve: Float32Array
  ): Float32Array => {
    const lut = new Float32Array(256);
    const span = Math.max(0.05, high - low);
    for (let v = 0; v < 256; v++) {
      let n = isRestorePositive
        ? (v - low) / span
        : (densLut[v] - low) / span;

      n = (n - blackOffset) / Math.max(0.15, 1 - blackOffset);
      n = clamp(n, 0, 1.35);

      if (!isRestorePositive) {
        n = Math.pow(Math.max(0, n), profGamma);
      }

      n = n * exposureMult * profMult;

      if (n > 0.85) {
        n = 0.85 + (n - 0.85) / (1 + (n - 0.85) * 1.15);
      }
      n = clamp(n, 0, 1);

      if (contrastFactor !== 0) {
        if (contrastFactor > 0) {
          const s = n * n * (3 - 2 * n);
          n = n + (s - n) * contrastFactor * 0.72;
        } else {
          n = 0.5 + (n - 0.5) * (1 + contrastFactor * 0.52);
        }
      }

      // Apply master & per-channel tone curves
      const mIdx = clampByte(n * 255);
      n = curveMaster[mIdx];
      const cIdx = clampByte(n * 255);
      n = channelCurve[cIdx];

      lut[v] = clamp(n, 0, 1);
    }
    return lut;
  };

  const lutR = buildChannelLut(densLutR, lowR, highR, profR, curveR);
  const lutG = buildChannelLut(densLutG, lowG, highG, profG, curveG);
  const lutB = buildChannelLut(densLutB, lowB, highB, profB, curveB);

  const histOutR = new Uint32Array(256);
  const histOutG = new Uint32Array(256);
  const histOutB = new Uint32Array(256);
  const histOutL = new Uint32Array(256);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    let r: number;
    let g: number;
    let b: number;

    if (isBW) {
      const yRaw = clampByte(
        0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
      );
      const dY = -Math.log(Math.max(yRaw / baseY, 0.0045));
      const span = Math.max(0.05, highR - lowR);
      let n = (dY - lowR) / span;
      n = (n - blackOffset) / Math.max(0.15, 1 - blackOffset);
      n = Math.pow(clamp(n, 0, 1.35), 0.94) * exposureMult;
      if (n > 0.85) n = 0.85 + (n - 0.85) / (1 + (n - 0.85) * 1.15);
      n = clamp(n, 0, 1);
      if (contrastFactor !== 0) {
        if (contrastFactor > 0) {
          const s = n * n * (3 - 2 * n);
          n = n + (s - n) * contrastFactor * 0.75;
        } else {
          n = 0.5 + (n - 0.5) * (1 + contrastFactor * 0.52);
        }
      }
      n = curveMaster[clampByte(n * 255)];
      r = g = b = n;
    } else {
      r = lutR[data[idx]];
      g = lutG[data[idx + 1]];
      b = lutB[data[idx + 2]];
    }

    if (hlAmt !== 0 || shAmt !== 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      let delta = 0;
      if (shAmt !== 0) {
        const shMask = (1 - lum) * (1 - lum);
        delta += shAmt * 0.28 * shMask;
      }
      if (hlAmt !== 0) {
        const hlMask = lum * lum;
        delta += hlAmt * 0.28 * hlMask;
      }
      r = clamp(r + delta, 0, 1);
      g = clamp(g + delta, 0, 1);
      b = clamp(b + delta, 0, 1);
    }

    if (hasSplitTone && !isBW) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const shM = (1 - lum) * (1 - lum);
      const midM = 4 * lum * (1 - lum) * 0.55;
      const hlM = lum * lum;
      r = clamp(r + shDelta.dr * shM + midDelta.dr * midM + hlDelta.dr * hlM, 0, 1);
      g = clamp(g + shDelta.dg * shM + midDelta.dg * midM + hlDelta.dg * hlM, 0, 1);
      b = clamp(b + shDelta.db * shM + midDelta.db * midM + hlDelta.db * hlM, 0, 1);
    }

    if (settings.profile === 'bw-selenium') {
      const lum = r;
      const coolShadow = (1 - lum) * 0.045;
      const warmMid = Math.sin(lum * Math.PI) * 0.028;
      r = clamp(lum + warmMid + tempShift * 0.5, 0, 1);
      g = clamp(lum - coolShadow * 0.35 - tintShift * 0.3, 0, 1);
      b = clamp(lum + coolShadow - tempShift * 0.5, 0, 1);
    } else if (!isBW) {
      if (tempShift !== 0 || tintShift !== 0) {
        r = clamp(r * (1 + tempShift + tintShift * 0.5), 0, 1);
        g = clamp(g * (1 - tintShift * 0.7), 0, 1);
        b = clamp(b * (1 - tempShift + tintShift * 0.5), 0, 1);
      }

      if (satMult !== 1) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = clamp(lum + (r - lum) * satMult, 0, 1);
        g = clamp(lum + (g - lum) * satMult, 0, 1);
        b = clamp(lum + (b - lum) * satMult, 0, 1);
      }
    }

    data[idx] = clampByte(r * 255);
    data[idx + 1] = clampByte(g * 255);
    data[idx + 2] = clampByte(b * 255);
  }

  if (settings.clarity > 0) {
    applyClarity(data, width, height, settings.clarity);
  }

  // Apply non-destructive spot healing strokes on developed positive
  if (!ignoreCrop && !ignorePerspective && settings.healStrokes?.length > 0) {
    applyHealStrokes(data, width, height, settings.healStrokes);
  }

  let clipBlack = 0;
  let clipWhite = 0;
  const histStep = totalPixels > 300000 ? 2 : 1;
  let histSampleCount = 0;

  for (let i = 0; i < totalPixels; i += histStep) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const l = clampByte(0.299 * r + 0.587 * g + 0.114 * b);

    histOutR[r]++;
    histOutG[g]++;
    histOutB[b]++;
    histOutL[l]++;

    if (l <= 2) clipBlack++;
    if (l >= 253) clipWhite++;
    histSampleCount++;
  }

  let maxCount = 1;
  for (let v = 4; v < 252; v++) {
    if (histOutL[v] > maxCount) maxCount = histOutL[v];
    if (histOutR[v] > maxCount) maxCount = histOutR[v];
    if (histOutG[v] > maxCount) maxCount = histOutG[v];
    if (histOutB[v] > maxCount) maxCount = histOutB[v];
  }

  return {
    imageData: oriented,
    histogram: {
      r: histOutR,
      g: histOutG,
      b: histOutB,
      luma: histOutL,
      maxCount,
      clipBlackPct: (clipBlack / Math.max(1, histSampleCount)) * 100,
      clipWhitePct: (clipWhite / Math.max(1, histSampleCount)) * 100,
    },
  };
}

export function sampleBaseColorAt(
  rawSource: ImageData,
  settings: GradingSettings,
  normX: number,
  normY: number
): RGB {
  const oriented = createOrientedImageData(
    rawSource,
    settings.rotate,
    settings.flipH,
    settings.perspective,
    settings.crop
  );
  const cx = clamp(Math.round(normX * (oriented.width - 1)), 0, oriented.width - 1);
  const cy = clamp(Math.round(normY * (oriented.height - 1)), 0, oriented.height - 1);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = clamp(cx + dx, 0, oriented.width - 1);
      const py = clamp(cy + dy, 0, oriented.height - 1);
      const idx = (py * oriented.width + px) * 4;
      sumR += oriented.data[idx];
      sumG += oriented.data[idx + 1];
      sumB += oriented.data[idx + 2];
      count++;
    }
  }

  return {
    r: clamp(Math.round(sumR / count), 20, 254),
    g: clamp(Math.round(sumG / count), 20, 254),
    b: clamp(Math.round(sumB / count), 20, 254),
  };
}

export function computeWhiteBalanceFromPositive(
  processedData: ImageData,
  normX: number,
  normY: number,
  currentTemp: number,
  currentTint: number
): { temperature: number; tint: number } {
  const cx = clamp(
    Math.round(normX * (processedData.width - 1)),
    0,
    processedData.width - 1
  );
  const cy = clamp(
    Math.round(normY * (processedData.height - 1)),
    0,
    processedData.height - 1
  );

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = clamp(cx + dx, 0, processedData.width - 1);
      const py = clamp(cy + dy, 0, processedData.height - 1);
      const idx = (py * processedData.width + px) * 4;
      sumR += processedData.data[idx];
      sumG += processedData.data[idx + 1];
      sumB += processedData.data[idx + 2];
      count++;
    }
  }

  const r = Math.max(8, sumR / count);
  const g = Math.max(8, sumG / count);
  const b = Math.max(8, sumB / count);
  const avg = (r + g + b) / 3;

  const tempDelta = ((b - r) / avg) * 140;
  const tintDelta = ((g - (r + b) / 2) / avg) * 140;

  return {
    temperature: Math.round(clamp(currentTemp + tempDelta, -100, 100)),
    tint: Math.round(clamp(currentTint + tintDelta, -100, 100)),
  };
}

export async function exportFullResolutionBlob(
  sourceCanvas: HTMLCanvasElement,
  settings: GradingSettings,
  format: 'image/png' | 'image/jpeg'
): Promise<Blob> {
  const srcCtx = sourceCanvas.getContext('2d');
  if (!srcCtx) throw new Error('Canvas 2D context unavailable');

  const rawData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const { imageData } = processNegativeImageData(rawData, settings);

  const imgCanvas = document.createElement('canvas');
  imgCanvas.width = imageData.width;
  imgCanvas.height = imageData.height;
  const imgCtx = imgCanvas.getContext('2d');
  if (!imgCtx) throw new Error('Export canvas 2D context unavailable');
  imgCtx.putImageData(imageData, 0, 0);

  let outCanvas = imgCanvas;
  if (settings.printBorder && settings.printBorder !== 'none') {
    const borderPx = Math.max(
      24,
      Math.round(Math.min(imageData.width, imageData.height) * 0.06)
    );
    const framed = document.createElement('canvas');
    framed.width = imageData.width + borderPx * 2;
    framed.height = imageData.height + borderPx * 2;
    const fCtx = framed.getContext('2d');
    if (fCtx) {
      fCtx.fillStyle = settings.printBorder === 'white' ? '#F6F5F0' : '#0E0E10';
      fCtx.fillRect(0, 0, framed.width, framed.height);
      fCtx.drawImage(imgCanvas, borderPx, borderPx);
      outCanvas = framed;
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode exported image'));
      },
      format,
      format === 'image/jpeg' ? 0.95 : undefined
    );
  });
}
