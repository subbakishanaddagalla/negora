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
import {
  createDefaultCurves,
  createDefaultFilmCharacter,
  createDefaultHsl,
  createDefaultSettings,
  createDefaultSplitTone,
} from './negativeProcessor';
import { buildPreviewDataFromCanvas, createSampleNegativeFrames } from './sampleNegatives';
import { db, handleFirestoreError, OperationType } from './firebase';

export const DEFAULT_CLOUD_ROLL_ID = 'active-roll';
export const HOST_ADMIN_EMAIL = 'kishanaddagalla@gmail.com';

export function isHostUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email?.toLowerCase() === HOST_ADMIN_EMAIL
  );
}

export interface CloudMemberRecord {
  uid: string;
  displayName: string;
  email: string;
  presetCount: number;
  rollCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SiteConfigRecord {
  announcementEnabled: boolean;
  announcementText: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  cloudSyncEnabled: boolean;
  cameraScannerEnabled: boolean;
  creatorName: string;
  updatedAt: number;
}

export const DEFAULT_SITE_CONFIG: SiteConfigRecord = {
  announcementEnabled: false,
  announcementText: '',
  maintenanceMode: false,
  maintenanceMessage:
    'NEGORA is currently undergoing quick darkroom maintenance. Please check back shortly.',
  cloudSyncEnabled: true,
  cameraScannerEnabled: true,
  creatorName: '',
  updatedAt: 0,
};

export interface FeaturedPresetRecord {
  id: string;
  name: string;
  description: string;
  settings: Partial<GradingSettings>;
  createdAt: number;
  updatedAt: number;
}

export type FeedbackCategory = 'feature' | 'bug' | 'film-stock' | 'general';

export interface FeedbackRecord {
  id: string;
  authorUid: string;
  authorName: string;
  authorEmail: string;
  category: FeedbackCategory;
  message: string;
  status: 'open' | 'resolved';
  hostNote: string;
  createdAt: number;
  updatedAt: number;
}

export interface BlockedMemberRecord {
  uid: string;
  email: string;
  reason: string;
  blockedBy: string;
  createdAt: number;
}

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
  const filmChar = settings.filmCharacter ?? createDefaultFilmCharacter();
  const hsl = settings.hsl ?? createDefaultHsl();

  const cleanPoints = (pts?: Array<{ x: number; y: number }>) =>
    (pts ?? [])
      .slice(0, 16)
      .map((p) => ({
        x: Number.isFinite(p.x) ? Number(p.x.toFixed(4)) : 0,
        y: Number.isFinite(p.y) ? Number(p.y.toFixed(4)) : 0,
      }));

  const cleanShift = (s?: { h?: number; s?: number; l?: number }) => ({
    h: Math.round(Number.isFinite(s?.h) ? (s?.h ?? 0) : 0),
    s: Math.round(Number.isFinite(s?.s) ? (s?.s ?? 0) : 0),
    l: Math.round(Number.isFinite(s?.l) ? (s?.l ?? 0) : 0),
  });

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
    straighten: Number(((settings.straighten ?? 0)).toFixed(2)),
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
    filmCharacter: {
      grainAmount: Math.round(filmChar.grainAmount ?? 0),
      grainSize: Math.round(filmChar.grainSize ?? 35),
      halation: Math.round(filmChar.halation ?? 0),
      fade: Math.round(filmChar.fade ?? 0),
    },
    hsl: {
      reds: cleanShift(hsl.reds),
      oranges: cleanShift(hsl.oranges),
      yellows: cleanShift(hsl.yellows),
      greens: cleanShift(hsl.greens),
      blues: cleanShift(hsl.blues),
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
  if (settings.dodgeBurnStrokes && settings.dodgeBurnStrokes.length > 0) {
    out.dodgeBurnStrokes = settings.dodgeBurnStrokes.slice(0, 80).map((st) => ({
      id: sanitizeId(st.id),
      mode: st.mode === 'burn' ? 'burn' : 'dodge',
      x: Number(st.x.toFixed(4)),
      y: Number(st.y.toFixed(4)),
      radius: Number(st.radius.toFixed(4)),
      strength: Number(st.strength.toFixed(3)),
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

export async function ensureUserProfile(
  user: User,
  stats?: { presetCount?: number; rollCount?: number }
): Promise<void> {
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
        presetCount: Math.max(0, Math.min(1000, Math.round(stats?.presetCount ?? 0))),
        rollCount: Math.max(0, Math.min(1000, Math.round(stats?.rollCount ?? 0))),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data();
      const patch: Record<string, unknown> = {
        displayName,
        email,
        updatedAt: serverTimestamp(),
      };
      if (typeof stats?.presetCount === 'number') {
        patch.presetCount = Math.max(0, Math.min(1000, Math.round(stats.presetCount)));
      } else if (typeof existing?.presetCount !== 'number') {
        patch.presetCount = 0;
      }
      if (typeof stats?.rollCount === 'number') {
        patch.rollCount = Math.max(0, Math.min(1000, Math.round(stats.rollCount)));
      } else if (typeof existing?.rollCount !== 'number') {
        patch.rollCount = 0;
      }
      await updateDoc(ref, patch);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeCloudMembers(
  user: User,
  onData: (members: CloudMemberRecord[]) => void
): () => void {
  if (!isHostUser(user)) {
    return () => {};
  }

  const q = query(collection(db, 'users'), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const members: CloudMemberRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: String(data.uid ?? d.id),
          displayName: String(data.displayName ?? 'NEGORA Photographer'),
          email: String(data.email ?? ''),
          presetCount: typeof data.presetCount === 'number' ? data.presetCount : 0,
          rollCount: typeof data.rollCount === 'number' ? data.rollCount : 0,
          createdAt: data.createdAt?.toMillis?.() ?? 0,
          updatedAt: data.updatedAt?.toMillis?.() ?? 0,
        };
      });
      onData(members);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    }
  );
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
  const clampedFrames = frames.slice(0, 200);
  await ensureUserProfile(user, { rollCount: clampedFrames.length });
  const uid = sanitizeId(user.uid);
  const rid = sanitizeId(rollId);
  const rollPath = `users/${uid}/rolls/${rid}`;
  const rollRef = doc(db, 'users', uid, 'rolls', rid);

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

// =====================================================================
// Host Feature 2 & 5: Global Announcement Banner & Feature Toggles
// =====================================================================

export function subscribeSiteConfig(
  onData: (config: SiteConfigRecord) => void
): () => void {
  const path = 'siteConfig/global';
  return onSnapshot(
    doc(db, 'siteConfig', 'global'),
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_SITE_CONFIG);
        return;
      }
      const data = snap.data();
      onData({
        announcementEnabled: Boolean(data.announcementEnabled),
        announcementText: String(data.announcementText ?? ''),
        maintenanceMode: Boolean(data.maintenanceMode),
        maintenanceMessage: String(
          data.maintenanceMessage || DEFAULT_SITE_CONFIG.maintenanceMessage
        ),
        cloudSyncEnabled:
          data.cloudSyncEnabled !== undefined ? Boolean(data.cloudSyncEnabled) : true,
        cameraScannerEnabled:
          data.cameraScannerEnabled !== undefined
            ? Boolean(data.cameraScannerEnabled)
            : true,
        creatorName: String(data.creatorName ?? ''),
        updatedAt: data.updatedAt?.toMillis?.() ?? 0,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function saveSiteConfig(
  user: User,
  config: Omit<SiteConfigRecord, 'updatedAt'>
): Promise<void> {
  if (!isHostUser(user)) {
    throw new Error('Only the verified host can update site settings.');
  }
  const path = 'siteConfig/global';
  const ref = doc(db, 'siteConfig', 'global');
  const payload = {
    announcementEnabled: Boolean(config.announcementEnabled),
    announcementText: config.announcementText.trim().slice(0, 280),
    maintenanceMode: Boolean(config.maintenanceMode),
    maintenanceMessage:
      (config.maintenanceMessage.trim() || DEFAULT_SITE_CONFIG.maintenanceMessage).slice(
        0,
        280
      ),
    cloudSyncEnabled: Boolean(config.cloudSyncEnabled),
    cameraScannerEnabled: Boolean(config.cameraScannerEnabled),
    creatorName: (config.creatorName ?? '').trim().slice(0, 80),
    updatedBy: sanitizeId(user.uid),
    updatedAt: serverTimestamp(),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { id: 'global', ...payload });
    } else {
      await updateDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// =====================================================================
// Host Feature 3: Featured Curated Film Presets
// =====================================================================

export function subscribeFeaturedPresets(
  onData: (presets: FeaturedPresetRecord[]) => void
): () => void {
  const path = 'featuredPresets';
  const q = query(
    collection(db, 'featuredPresets'),
    where('isPublic', '==', true),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: FeaturedPresetRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          name: String(data.name ?? 'Featured Look'),
          description: String(data.description ?? ''),
          settings: (data.settings ?? {}) as Partial<GradingSettings>,
          createdAt: data.createdAt?.toMillis?.() ?? 0,
          updatedAt: data.updatedAt?.toMillis?.() ?? 0,
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function publishFeaturedPreset(
  user: User,
  name: string,
  description: string,
  settings: Partial<GradingSettings>
): Promise<void> {
  if (!isHostUser(user)) {
    throw new Error('Only the verified host can publish featured presets.');
  }
  const presetId = sanitizeId(
    `featured-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  const path = `featuredPresets/${presetId}`;
  try {
    await setDoc(doc(db, 'featuredPresets', presetId), {
      id: presetId,
      ownerId: sanitizeId(user.uid),
      name: (name.trim() || 'Featured Film Look').slice(0, 80),
      description: description.trim().slice(0, 160),
      isPublic: true,
      settings: sanitizeSettingsMap(settings),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteFeaturedPreset(
  user: User,
  presetId: string
): Promise<void> {
  if (!isHostUser(user)) {
    throw new Error('Only the verified host can delete featured presets.');
  }
  const pid = sanitizeId(presetId);
  const path = `featuredPresets/${pid}`;
  try {
    await deleteDoc(doc(db, 'featuredPresets', pid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// =====================================================================
// Host Feature 4: Feedback & Bug Reports Inbox
// =====================================================================

export async function submitFeedbackReport(
  user: User,
  category: FeedbackCategory,
  message: string
): Promise<void> {
  const feedbackId = sanitizeId(
    `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  const path = `feedback/${feedbackId}`;
  const cleanMsg = message.trim().slice(0, 1000);
  if (!cleanMsg) {
    throw new Error('Please enter a short message before sending.');
  }

  try {
    await setDoc(doc(db, 'feedback', feedbackId), {
      id: feedbackId,
      authorUid: sanitizeId(user.uid),
      authorName: (user.displayName || 'NEGORA User').slice(0, 120),
      authorEmail: (user.email || '').slice(0, 200),
      category,
      message: cleanMsg,
      status: 'open',
      hostNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeFeedbackInbox(
  user: User,
  onData: (items: FeedbackRecord[]) => void
): () => void {
  if (!isHostUser(user)) {
    return () => {};
  }
  const path = 'feedback';
  const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: FeedbackRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id ?? d.id),
          authorUid: String(data.authorUid ?? ''),
          authorName: String(data.authorName ?? 'NEGORA User'),
          authorEmail: String(data.authorEmail ?? ''),
          category: (data.category as FeedbackCategory) ?? 'general',
          message: String(data.message ?? ''),
          status: data.status === 'resolved' ? 'resolved' : 'open',
          hostNote: String(data.hostNote ?? ''),
          createdAt: data.createdAt?.toMillis?.() ?? 0,
          updatedAt: data.updatedAt?.toMillis?.() ?? 0,
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function updateFeedbackStatus(
  user: User,
  feedbackId: string,
  status: 'open' | 'resolved',
  hostNote = ''
): Promise<void> {
  if (!isHostUser(user)) return;
  const fid = sanitizeId(feedbackId);
  const path = `feedback/${fid}`;
  try {
    await updateDoc(doc(db, 'feedback', fid), {
      status,
      hostNote: hostNote.trim().slice(0, 400),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFeedbackReport(
  user: User,
  feedbackId: string
): Promise<void> {
  if (!isHostUser(user)) return;
  const fid = sanitizeId(feedbackId);
  const path = `feedback/${fid}`;
  try {
    await deleteDoc(doc(db, 'feedback', fid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// =====================================================================
// Host Feature 6: Member Access Control (Block / Unblock)
// =====================================================================

export function subscribeUserBlockStatus(
  user: User,
  onBlocked: (blocked: BlockedMemberRecord | null) => void
): () => void {
  const uid = sanitizeId(user.uid);
  const path = `blockedUsers/${uid}`;
  return onSnapshot(
    doc(db, 'blockedUsers', uid),
    (snap) => {
      if (!snap.exists()) {
        onBlocked(null);
        return;
      }
      const data = snap.data();
      onBlocked({
        uid: String(data.uid ?? uid),
        email: String(data.email ?? ''),
        reason: String(data.reason ?? ''),
        blockedBy: String(data.blockedBy ?? ''),
        createdAt: data.createdAt?.toMillis?.() ?? 0,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeBlockedMembers(
  user: User,
  onData: (items: BlockedMemberRecord[]) => void
): () => void {
  if (!isHostUser(user)) {
    return () => {};
  }
  const path = 'blockedUsers';
  const q = query(collection(db, 'blockedUsers'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: BlockedMemberRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: String(data.uid ?? d.id),
          email: String(data.email ?? ''),
          reason: String(data.reason ?? ''),
          blockedBy: String(data.blockedBy ?? ''),
          createdAt: data.createdAt?.toMillis?.() ?? 0,
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function blockMember(
  user: User,
  targetUid: string,
  targetEmail: string,
  reason = 'Cloud sync suspended by host'
): Promise<void> {
  if (!isHostUser(user)) {
    throw new Error('Only the verified host can block accounts.');
  }
  const uid = sanitizeId(targetUid);
  if (uid === sanitizeId(user.uid)) {
    throw new Error('You cannot block your own host account.');
  }
  const path = `blockedUsers/${uid}`;
  try {
    await setDoc(doc(db, 'blockedUsers', uid), {
      uid,
      email: targetEmail.trim().slice(0, 200),
      reason: (reason.trim() || 'Cloud sync suspended by host').slice(0, 200),
      blockedBy: sanitizeId(user.uid),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function unblockMember(
  user: User,
  targetUid: string
): Promise<void> {
  if (!isHostUser(user)) {
    throw new Error('Only the verified host can unblock accounts.');
  }
  const uid = sanitizeId(targetUid);
  const path = `blockedUsers/${uid}`;
  try {
    await deleteDoc(doc(db, 'blockedUsers', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

