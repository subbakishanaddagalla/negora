import UTIF from 'utif';

export interface DecodedRawCanvas {
  canvas: HTMLCanvasElement;
  formatLabel: string;
}

const TIFF_EXTENSIONS = /\.(tiff?)$/i;
const CAMERA_RAW_EXTENSIONS = /\.(dng|cr2|nef|arw|orf|rw2|pef|raf)$/i;

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image buffer'));
    img.src = url;
  });
}

async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Extracts the largest embedded JPEG preview stream inside TIFF-based Camera RAW files
 * (DNG, CR2, NEF, ARW, PEF, ORF). Most RAW scans embed a full-resolution or high-res
 * preview frame between SOI (0xFF 0xD8 0xFF) and EOI (0xFF 0xD9).
 */
function extractLargestEmbeddedJpeg(bytes: Uint8Array): Uint8Array | null {
  let bestSlice: Uint8Array | null = null;
  let bestLen = 16 * 1024; // ignore tiny thumbnails < 16KB

  let i = 0;
  const limit = bytes.length - 4;
  while (i < limit) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      // Find matching EOI while skipping ahead safely
      let end = -1;
      for (let j = i + 4; j < bytes.length - 1; j++) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          end = j + 2;
          // Keep scanning in case of embedded thumbnail EOI inside a larger JPEG, up to reasonable cap
          if (end - i > bestLen) {
            break;
          }
        }
      }
      if (end > i) {
        const len = end - i;
        if (len > bestLen) {
          bestLen = len;
          bestSlice = bytes.subarray(i, end);
        }
        i = end;
        continue;
      }
    }
    i++;
  }

  return bestSlice;
}

function decodeTiffViaUtif(buffer: ArrayBuffer): HTMLCanvasElement | null {
  const ifds = UTIF.decode(buffer);
  if (!ifds || ifds.length === 0) return null;

  // Pick the highest-resolution decodable IFD
  const sorted = [...ifds].sort((a, b) => {
    const areaA = (a.width || a.t256?.[0] || 0) * (a.height || a.t257?.[0] || 0);
    const areaB = (b.width || b.t256?.[0] || 0) * (b.height || b.t257?.[0] || 0);
    return areaB - areaA;
  });

  for (const ifd of sorted) {
    try {
      UTIF.decodeImage(buffer, ifd);
      if (!ifd.width || !ifd.height) continue;
      const rgba = UTIF.toRGBA8(ifd);
      if (!rgba || rgba.length !== ifd.width * ifd.height * 4) continue;

      const canvas = document.createElement('canvas');
      canvas.width = ifd.width;
      canvas.height = ifd.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const imgData = new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height);
      ctx.putImageData(imgData, 0, 0);
      return canvas;
    } catch {
      // Try next IFD
    }
  }
  return null;
}

export async function decodeNegativeFileToCanvas(
  file: File
): Promise<DecodedRawCanvas> {
  const isTiff =
    TIFF_EXTENSIONS.test(file.name) ||
    file.type === 'image/tiff' ||
    file.type === 'image/x-tiff';
  const isCameraRaw = CAMERA_RAW_EXTENSIONS.test(file.name);

  if (isTiff || isCameraRaw) {
    const buffer = await file.arrayBuffer();

    // 1. Try direct TIFF / 16-bit IFD decode first for TIFF/DNG
    if (isTiff || /\.dng$/i.test(file.name)) {
      const utifCanvas = decodeTiffViaUtif(buffer);
      if (utifCanvas) {
        return {
          canvas: utifCanvas,
          formatLabel: isCameraRaw ? 'Camera RAW · DNG' : '16-bit TIFF Scan',
        };
      }
    }

    // 2. Extract embedded full-res JPEG preview for CR2/NEF/ARW/DNG RAW files
    const jpegSlice = extractLargestEmbeddedJpeg(new Uint8Array(buffer));
    if (jpegSlice) {
      const copy = new Uint8Array(jpegSlice.length);
      copy.set(jpegSlice);
      const canvas = await canvasFromBlob(new Blob([copy], { type: 'image/jpeg' }));
      const ext = file.name.split('.').pop()?.toUpperCase() || 'RAW';
      return {
        canvas,
        formatLabel: `Camera RAW · ${ext}`,
      };
    }

    // 3. Last-ditch UTIF attempt for non-DNG TIFF containers
    const fallbackUtif = decodeTiffViaUtif(buffer);
    if (fallbackUtif) {
      return {
        canvas: fallbackUtif,
        formatLabel: 'TIFF / RAW Scan',
      };
    }

    throw new Error(`Unsupported RAW/TIFF compression in ${file.name}`);
  }

  // Standard browser-decodable formats (PNG, JPEG, WebP, BMP, GIF, AVIF)
  const canvas = await canvasFromBlob(file);
  return {
    canvas,
    formatLabel: '',
  };
}

export function isSupportedNegativeFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|bmp|gif|avif|tiff?|dng|cr2|nef|arw|orf|rw2|pef|raf)$/i.test(
      file.name
    )
  );
}
