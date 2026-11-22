import type { GradingSettings, NegativeFrame } from '../types/darkroom';
import { createDefaultSettings } from './negativeProcessor';
import { buildPreviewDataFromCanvas } from './sampleNegatives';

const DB_NAME = 'halide-lab-storage';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const SESSION_KEY = 'current-roll';

interface StoredFrameRecord {
  id: string;
  name: string;
  filmStockLabel: string;
  isSample: boolean;
  width: number;
  height: number;
  detectedType: 'c41' | 'bw' | 'positive';
  settings: GradingSettings;
  imageBlob: Blob;
}

interface StoredSession {
  activeFrameId: string | null;
  frames: StoredFrameRecord[];
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to serialize canvas'));
    }, 'image/png');
  });
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode stored image'));
    };
    img.src = url;
  });
}

export async function saveRollSession(
  frames: NegativeFrame[],
  activeFrameId: string | null
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const records: StoredFrameRecord[] = await Promise.all(
      frames.map(async (f) => ({
        id: f.id,
        name: f.name,
        filmStockLabel: f.filmStockLabel,
        isSample: f.isSample,
        width: f.width,
        height: f.height,
        detectedType: f.detectedType,
        settings: f.settings,
        imageBlob: await canvasToBlob(f.sourceCanvas),
      }))
    );

    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const payload: StoredSession = {
        activeFrameId,
        frames: records,
        updatedAt: Date.now(),
      };
      store.put(payload, SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal persistence failure (e.g., private browsing quota)
  }
}

export async function loadRollSession(): Promise<{
  frames: NegativeFrame[];
  activeFrameId: string | null;
} | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDatabase();
    const session = await new Promise<StoredSession | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => resolve(req.result as StoredSession | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();

    if (!session || !session.frames || session.frames.length === 0) {
      return null;
    }

    const hydrated: NegativeFrame[] = [];
    for (const rec of session.frames) {
      const img = await blobToImage(rec.imageBlob);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0);
      const { previewData, previewWidth, previewHeight } =
        buildPreviewDataFromCanvas(canvas);
      hydrated.push({
        id: rec.id,
        name: rec.name,
        filmStockLabel: rec.filmStockLabel,
        isSample: rec.isSample,
        width: canvas.width,
        height: canvas.height,
        previewWidth,
        previewHeight,
        sourceCanvas: canvas,
        previewSourceData: previewData,
        detectedType: rec.detectedType,
        settings: createDefaultSettings(rec.settings),
      });
    }

    if (hydrated.length === 0) return null;
    return {
      frames: hydrated,
      activeFrameId: session.activeFrameId,
    };
  } catch {
    return null;
  }
}

export async function clearRollSession(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage cleanup errors
  }
}
