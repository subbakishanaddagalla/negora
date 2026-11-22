import type { NegativeFrame } from '../types/darkroom';
import {
  analyzeNegativeImageData,
  createDefaultSettings,
} from './negativeProcessor';

interface SampleDescriptor {
  id: string;
  name: string;
  filmStockLabel: string;
  imageUrl: string;
  type: 'c41' | 'bw';
  addFilmBorder: boolean;
  baseMask: { r: number; g: number; b: number };
}

const SAMPLE_DESCRIPTORS: SampleDescriptor[] = [
  {
    id: 'sample-coastal-1974',
    name: 'Big Sur Overlook, 1974',
    filmStockLabel: 'Kodacolor II · C-41',
    imageUrl: '/src/assets/images/sample_coastal_classic_1795355486220.jpg',
    type: 'c41',
    addFilmBorder: true,
    baseMask: { r: 226, g: 134, b: 78 },
  },
  {
    id: 'sample-paris-bistro',
    name: 'Rue des Abbesses, 1982',
    filmStockLabel: 'Fujicolor 400 · C-41',
    imageUrl: '/src/assets/images/sample_street_cafe_1795355484019.jpg',
    type: 'c41',
    addFilmBorder: false,
    baseMask: { r: 218, g: 128, b: 76 },
  },
  {
    id: 'sample-watchmaker',
    name: 'Master Watchmaker, 1968',
    filmStockLabel: 'Portra 160 · 120 Medium Format',
    imageUrl: '/src/assets/images/sample_portrait_studio_1795355485053.jpg',
    type: 'c41',
    addFilmBorder: false,
    baseMask: { r: 224, g: 136, b: 82 },
  },
  {
    id: 'sample-grand-station',
    name: 'Central Concourse, 1959',
    filmStockLabel: 'Tri-X 400 · Silver Gelatin',
    imageUrl: '/src/assets/images/sample_bw_arch_1795355485470.jpg',
    type: 'bw',
    addFilmBorder: true,
    baseMask: { r: 226, g: 224, b: 220 },
  },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/**
 * Generates an authentic film-negative canvas from a reference photograph
 * using Beer-Lambert optical transmittance: C_neg = baseMask * exp(-D_scene)
 * so the converter exercises genuine negative-to-positive inversion physics.
 */
function encodeImageAsFilmNegative(
  img: HTMLImageElement,
  desc: SampleDescriptor
): HTMLCanvasElement {
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const innerW = Math.max(1, Math.round(img.naturalWidth * scale));
  const innerH = Math.max(1, Math.round(img.naturalHeight * scale));
  const border = desc.addFilmBorder ? Math.round(Math.min(innerW, innerH) * 0.032) : 0;

  const canvas = document.createElement('canvas');
  canvas.width = innerW + border * 2;
  canvas.height = innerH + border * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire 2D canvas context');

  // Fill entire frame with unexposed film base color
  ctx.fillStyle = `rgb(${desc.baseMask.r}, ${desc.baseMask.g}, ${desc.baseMask.b})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw positive image into center, then read pixels and convert to film negative densities
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = innerW;
  tmpCanvas.height = innerH;
  const tmpCtx = tmpCanvas.getContext('2d');
  if (!tmpCtx) throw new Error('Could not acquire temp 2D context');
  tmpCtx.drawImage(img, 0, 0, innerW, innerH);

  const posData = tmpCtx.getImageData(0, 0, innerW, innerH);
  const p = posData.data;
  const maxDensity = 2.35;

  for (let i = 0; i < p.length; i += 4) {
    if (desc.type === 'bw') {
      const y = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
      const d = Math.pow(y, 1.05) * maxDensity;
      const t = Math.exp(-d);
      p[i] = Math.round(desc.baseMask.r * t);
      p[i + 1] = Math.round(desc.baseMask.g * t);
      p[i + 2] = Math.round(desc.baseMask.b * t);
    } else {
      const rNorm = p[i] / 255;
      const gNorm = p[i + 1] / 255;
      const bNorm = p[i + 2] / 255;
      const dR = Math.pow(rNorm, 1.04) * maxDensity;
      const dG = Math.pow(gNorm, 1.04) * maxDensity;
      const dB = Math.pow(bNorm, 1.04) * maxDensity;
      p[i] = Math.round(desc.baseMask.r * Math.exp(-dR));
      p[i + 1] = Math.round(desc.baseMask.g * Math.exp(-dG));
      p[i + 2] = Math.round(desc.baseMask.b * Math.exp(-dB));
    }
  }

  ctx.putImageData(posData, border, border);
  return canvas;
}

export function buildPreviewDataFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  maxPreviewDim = 1100
): { previewData: ImageData; previewWidth: number; previewHeight: number } {
  const scale = Math.min(
    1,
    maxPreviewDim / Math.max(sourceCanvas.width, sourceCanvas.height)
  );
  const pw = Math.max(1, Math.round(sourceCanvas.width * scale));
  const ph = Math.max(1, Math.round(sourceCanvas.height * scale));
  const pCanvas = document.createElement('canvas');
  pCanvas.width = pw;
  pCanvas.height = ph;
  const pCtx = pCanvas.getContext('2d');
  if (!pCtx) throw new Error('Preview 2D context unavailable');
  pCtx.drawImage(sourceCanvas, 0, 0, pw, ph);
  return {
    previewData: pCtx.getImageData(0, 0, pw, ph),
    previewWidth: pw,
    previewHeight: ph,
  };
}

export async function createSampleNegativeFrames(): Promise<NegativeFrame[]> {
  const results = await Promise.allSettled(
    SAMPLE_DESCRIPTORS.map(async (desc): Promise<NegativeFrame> => {
      const img = await loadImage(desc.imageUrl);
      const sourceCanvas = encodeImageAsFilmNegative(img, desc);
      const { previewData, previewWidth, previewHeight } =
        buildPreviewDataFromCanvas(sourceCanvas);
      const analysis = analyzeNegativeImageData(previewData);

      return {
        id: desc.id,
        name: desc.name,
        filmStockLabel: desc.filmStockLabel,
        isSample: true,
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        previewWidth,
        previewHeight,
        sourceCanvas,
        previewSourceData: previewData,
        detectedType: analysis.detectedType,
        settings: createDefaultSettings({
          profile: analysis.recommendedProfile,
          baseColor: analysis.baseColor,
          borderIgnore: desc.addFilmBorder ? 5 : 2,
          contrast: desc.type === 'bw' ? 12 : 8,
          saturation: desc.type === 'bw' ? 0 : 8,
        }),
      };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<NegativeFrame> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export async function createFrameFromFile(file: File): Promise<NegativeFrame> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D canvas context');
    ctx.drawImage(img, 0, 0);

    const { previewData, previewWidth, previewHeight } =
      buildPreviewDataFromCanvas(canvas);
    const analysis = analyzeNegativeImageData(previewData);

    const cleanName = file.name.replace(/\.[^/.]+$/, '') || 'Scanned Negative';
    const stockLabel =
      analysis.detectedType === 'bw'
        ? 'Monochrome Negative'
        : analysis.detectedType === 'c41'
          ? 'Color Negative · C-41'
          : 'Scanned Film';

    return {
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: cleanName,
      filmStockLabel: stockLabel,
      isSample: false,
      width: canvas.width,
      height: canvas.height,
      previewWidth,
      previewHeight,
      sourceCanvas: canvas,
      previewSourceData: previewData,
      detectedType: analysis.detectedType,
      settings: createDefaultSettings({
        profile: analysis.recommendedProfile,
        baseColor: analysis.baseColor,
        borderIgnore: analysis.hasSprocketBorder ? 12 : 4,
      }),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
