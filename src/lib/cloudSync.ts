import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type {
  GradingPreset,
  GradingSettings,
  NegativeFrame,
  RollMetadata,
} from '../types/darkroom';
import { createDefaultCurves, createDefaultSettings, createDefaultSplitTone } from './negativeProcessor';
import { buildPreviewDataFromCanvas, createSampleNegativeFrames } from './sampleNegatives';
import { db, handleFirestoreError, OperationType } from './firebase';

export const DEFAULT_CLOUD_ROLL_ID = 'active-roll';

export interface CloudRollSummary {
  id: string;
  rollTitle: string;
  camera: string;
  lens: string;
  filmStock: string;
  iso: string;
  notes: string;
  activeFrameId: string | null;
  frameCount: number;
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
  return cleaned || `id-${Date.now()}`;
}

function sanitizeSettingsMap(
  settings: Partial<GradingSettings>
): Record<string, unknown> {
  const curves = settings.curves ?? createDefaultCurves();
  const splitTone = settings.splitTone ?? createDefaultSplitTone();

  const cleanPoints = (pts?: Array<{ x: number; y: number }>) =>
    (pts ?? [])
      .slice(0, 16)
      .map((p) => ({
        x: Number.isFinite(p.x) ? Number(p.x.toFixed(4)) : 0,
        y: Number.isFinite(p.y) ? Number(p.y.toFixed(4)) : 0,
      }));

  const out: Record<string, unknown> = {
    profile: settings.profile ?? 'c41-standard',
    bwTone: settings.bwTone ?? 'none',
    autoBalance: settings.autoBalance ?? 94,
    borderIgnore: settings.borderIgnore ?? 4,
    vignetteFix: settings.vignetteFix ?? 0,
    exposure: settings.exposure ?? 0,
    contrast: settings.contrast ?? 8,
    highlights: settings.highlights ?? 0,
    shadows: settings.shadows ?? 6,
    blackPoint: settings.blackPoint ?? 0,
    temperature: settings.temperature ?? 0,
    tint: settings.tint ?? 0,
    saturation: settings.saturation ?? 6,
    clarity: settings.clarity ?? 12,
    sharpen: settings.sharpen ?? 0,
    dustClean: settings.dustClean ?? 0,
    rotate: settings.rotate ?? 0,
    flipH: Boolean(settings.flipH),
    printBorder: settings.printBorder ?? 'none',
    curves: {
      master: cleanPoints(curves.master),
      r: cleanPoints(curves.r),
      g: cleanPoints(curves.g),
      b: cleanPoints(curves.b),
    },
    splitTone: {
      shadows: {
        x: Number((splitTone.shadows?.x ?? 0).toFixed(4)),
        y: Number((splitTone.shadows?.y ?? 0).toFixed(4)),
      },
      midtones: {
        x: Number((splitTone.midtones?.x ?? 0).toFixed(4)),
        y: Number((splitTone.midtones?.y ?? 0).toFixed(4)),
      },
      highlights: {
        x: Number((splitTone.highlights?.x ?? 0).toFixed(4)),
        y: Number((splitTone.highlights?.y ?? 0).toFixed(4)),
      },
    },
  };

  if (settings.baseColor) {
    out.baseColor = {
      r: Math.round(settings.baseColor.r),
      g: Math.round(settings.baseColor.g),
      b: Math.round(settings.baseColor.b),
    };
  }
  if (settings.crop) {
    out.crop = {
      x: Number(settings.crop.x.toFixed(4)),
      y: Number(settings.crop.y.toFixed(4)),
      w: Number(settings.crop.w.toFixed(4)),
      h: Number(settings.crop.h.toFixed(4)),
    };
  }
  if (settings.perspective) {
    out.perspective = {
      tl: {
        x: Number(settings.perspective.tl.x.toFixed(4)),
        y: Number(settings.perspective.tl.y.toFixed(4)),
      },
      tr: {
        x: Number(settings.perspective.tr.x.toFixed(4)),
        y: Number(settings.perspective.tr.y.toFixed(4)),
      },
      br: {
        x: Number(settings.perspective.br.x.toFixed(4)),
        y: Number(settings.perspective.br.y.toFixed(4)),
      },
      bl: {
        x: Number(settings.perspective.bl.x.toFixed(4)),
        y: Number(settings.perspective.bl.y.toFixed(4)),
      },
    };
  }
  if (settings.healStrokes && settings.healStrokes.length > 0) {
    out.healStrokes = settings.healStrokes.slice(0, 80).map((st) => ({
      id: sanitizeId(st.id),
      x: Number(st.x.toFixed(4)),
      y: Number(st.y.toFixed(4)),
      radius: Number(st.radius.toFixed(4)),
    }));
  }

  return out;
}

function encodeFrameForCloudSync(frame: NegativeFrame): string {
  if (frame.isSample) return '';

  const maxDim = 900;
  const scale = Math.min(1, maxDim / Math.max(frame.width, frame.height));
  const w = Math.max(1, Math.round(frame.width * scale));
  const h = Math.max(1, Math.round(frame.height * scale));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(frame.sourceCanvas, 0, 0, w, h);

  let dataUrl = c.toDataURL('image/jpeg', 0.8);
  if (dataUrl.length > 520000) {
    dataUrl = c.toDataURL('image/jpeg', 0.62);
  }
  if (dataUrl.length > 720000) {
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(w * 0.65));
    smaller.height = Math.max(1, Math.round(h * 0.65));
    const sCtx = smaller.getContext('2d');
    if (sCtx) {
      sCtx.drawImage(c, 0, 0, smaller.width, smaller.height);
      dataUrl = smaller.toDataURL('image/jpeg', 0.65);
    }
  }
  return dataUrl.slice(0, 745000);
}

function decodeDataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Failed to decode synced image'));
    img.src = dataUrl;
  });
}

export async function ensureUserProfile(user: User): Promise<void> {
  const uid = sanitizeId(user.uid);
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const displayName = (user.displayName || 'NEGORA Photographer').slice(0, 120);
  const email = (user.email || '').slice(0, 200);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        displayName,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        email,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function savePresetToCloud(
  user: User,
  preset: GradingPreset
): Promise<void> {
  await ensureUserProfile(user);
  const uid = sanitizeId(user.uid);
  const presetId = sanitizeId(preset.id);
  const path = `users/${uid}/presets/${presetId}`;
  const ref = doc(db, 'users', uid, 'presets', presetId);

  try {
    const snap = await getDoc(ref);
    const cleanName = preset.name.trim().slice(0, 80) || 'Custom Look';
    const cleanSettings = sanitizeSettingsMap(preset.settings);

    if (!snap.exists()) {
      await setDoc(ref, {
        id: presetId,
        ownerId: uid,
        name: cleanName,
        settings: cleanSettings,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        name: cleanName,
        settings: cleanSettings,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deletePresetFromCloud(
  user: User,
  presetId: string
): Promise<void> {
  const uid = sanitizeId(user.uid);
  const pid = sanitizeId(presetId);
  const path = `users/${uid}/presets/${pid}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'presets', pid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeCloudPresets(
  user: User,
  onData: (presets: GradingPreset[]) => void
): () => void {
  const uid = sanitizeId(user.uid);
  const path = `users/${uid}/presets`;
  const q = query(
    collection(db, 'users', uid, 'presets'),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: GradingPreset[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          name: String(data.name ?? 'Custom Look'),
          createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
          updatedAt: data.updatedAt?.toMillis?.() ?? Date.now(),
          settings: (data.settings ?? {}) as Partial<GradingSettings>,
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function syncRollToCloud(
  user: User,
  rollId: string,
  rollMeta: RollMetadata,
  frames: NegativeFrame[],
  activeFrameId: string | null
): Promise<void> {
  await ensureUserProfile(user);
  const uid = sanitizeId(user.uid);
  const rid = sanitizeId(rollId);
  const rollPath = `users/${uid}/rolls/${rid}`;
  const rollRef = doc(db, 'users', uid, 'rolls', rid);

  const clampedFrames = frames.slice(0, 200);
  const cleanActiveId = activeFrameId ? sanitizeId(activeFrameId) : null;

  try {
    const rollSnap = await getDoc(rollRef);
    const rollFields = {
      rollTitle: (rollMeta.rollTitle.trim() || 'Untitled Film Roll').slice(0, 120),
      camera: rollMeta.camera.trim().slice(0, 100),
      lens: rollMeta.lens.trim().slice(0, 100),
      filmStock: rollMeta.filmStock.trim().slice(0, 100),
      iso: rollMeta.iso.trim().slice(0, 24),
      notes: rollMeta.notes.trim().slice(0, 1000),
      activeFrameId: cleanActiveId,
      frameCount: clampedFrames.length,
    };

    if (!rollSnap.exists()) {
      await setDoc(rollRef, {
        id: rid,
        ownerId: uid,
        ...rollFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(rollRef, {
        ...rollFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, rollPath);
  }

  const framesColPath = `users/${uid}/rolls/${rid}/frames`;
  const existingFrameIds = new Set<string>();
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'users', uid, 'rolls', rid, 'frames'), where('ownerId', '==', uid))
    );
    for (const d of existingSnap.docs) {
      existingFrameIds.add(d.id);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, framesColPath);
  }

  const nextFrameIds = new Set<string>();

  for (let i = 0; i < clampedFrames.length; i++) {
    const frame = clampedFrames[i];
    const fid = sanitizeId(frame.id);
    nextFrameIds.add(fid);
    const framePath = `${framesColPath}/${fid}`;
    const frameRef = doc(db, 'users', uid, 'rolls', rid, 'frames', fid);
    const syncDataUrl = encodeFrameForCloudSync(frame);

    try {
      const fSnap = await getDoc(frameRef);
      const mutableFields = {
        order: i,
        name: (frame.name.trim() || `Frame ${i + 1}`).slice(0, 140),
        filmStockLabel: frame.filmStockLabel.trim().slice(0, 120),
        notes: (frame.notes ?? '').trim().slice(0, 600),
        settings: sanitizeSettingsMap(frame.settings),
        syncImageDataUrl: syncDataUrl,
      };

      if (!fSnap.exists()) {
        await setDoc(frameRef, {
          id: fid,
          ownerId: uid,
          rollId: rid,
          ...mutableFields,
          isSample: frame.isSample,
          sampleId: frame.isSample ? sanitizeId(frame.id) : null,
          width: Math.max(1, Math.round(frame.width)),
          height: Math.max(1, Math.round(frame.height)),
          detectedType: frame.detectedType,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(frameRef, {
          ...mutableFields,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, framePath);
    }
  }

  for (const staleId of existingFrameIds) {
    if (!nextFrameIds.has(staleId)) {
      const stalePath = `${framesColPath}/${staleId}`;
      try {
        await deleteDoc(doc(db, 'users', uid, 'rolls', rid, 'frames', staleId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, stalePath);
      }
    }
  }
}

export async function loadRollFromCloud(
  user: User,
  rollId: string
): Promise<{
  rollMeta: RollMetadata;
  frames: NegativeFrame[];
  activeFrameId: string | null;
} | null> {
  const uid = sanitizeId(user.uid);
  const rid = sanitizeId(rollId);
  const rollPath = `users/${uid}/rolls/${rid}`;

  let rollData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'rolls', rid));
    if (!snap.exists()) return null;
    rollData = snap.data() as Record<string, unknown>;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, rollPath);
  }

  const framesPath = `users/${uid}/rolls/${rid}/frames`;
  let frameDocs: Array<Record<string, unknown>> = [];
  try {
    const qSnap = await getDocs(
      query(
        collection(db, 'users', uid, 'rolls', rid, 'frames'),
        where('ownerId', '==', uid),
        orderBy('order', 'asc')
      )
    );
    frameDocs = qSnap.docs.map((d) => d.data() as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, framesPath);
  }

  const sampleLookup = new Map<string, NegativeFrame>();
  if (frameDocs.some((f) => Boolean(f.isSample))) {
    const samples = await createSampleNegativeFrames();
    for (const s of samples) {
      sampleLookup.set(s.id, s);
    }
  }

  const hydrated: NegativeFrame[] = [];
  for (const rec of frameDocs) {
    const settings = createDefaultSettings(
      (rec.settings ?? {}) as Partial<GradingSettings>
    );

    if (rec.isSample && typeof rec.sampleId === 'string') {
      const baseSample = sampleLookup.get(rec.sampleId);
      if (baseSample) {
        hydrated.push({
          ...baseSample,
          id: String(rec.id),
          name: String(rec.name ?? baseSample.name),
          filmStockLabel: String(rec.filmStockLabel ?? baseSample.filmStockLabel),
          notes: String(rec.notes ?? ''),
          settings,
        });
        continue;
      }
    }

    const dataUrl = String(rec.syncImageDataUrl ?? '');
    if (!dataUrl.startsWith('data:image/')) continue;

    try {
      const canvas = await decodeDataUrlToCanvas(dataUrl);
      const { previewData, previewWidth, previewHeight } =
        buildPreviewDataFromCanvas(canvas);
      hydrated.push({
        id: String(rec.id),
        name: String(rec.name ?? 'Synced Frame'),
        filmStockLabel: String(rec.filmStockLabel ?? 'Synced Film'),
        notes: String(rec.notes ?? ''),
        isSample: false,
        width: canvas.width,
        height: canvas.height,
        previewWidth,
        previewHeight,
        sourceCanvas: canvas,
        previewSourceData: previewData,
        detectedType:
          (rec.detectedType as 'c41' | 'bw' | 'positive') ?? 'c41',
        settings,
      });
    } catch {
      // Skip corrupt frame image
    }
  }

  return {
    rollMeta: {
      rollTitle: String(rollData?.rollTitle ?? 'Untitled Film Roll'),
      camera: String(rollData?.camera ?? ''),
      lens: String(rollData?.lens ?? ''),
      filmStock: String(rollData?.filmStock ?? ''),
      iso: String(rollData?.iso ?? ''),
      notes: String(rollData?.notes ?? ''),
    },
    frames: hydrated,
    activeFrameId:
      typeof rollData?.activeFrameId === 'string' ? rollData.activeFrameId : null,
  };
}
