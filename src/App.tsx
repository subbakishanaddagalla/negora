import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type {
  ActiveTool,
  AppSection,
  CropRect,
  GradingPreset,
  GradingSettings,
  HealStroke,
  NegativeFrame,
  PerspectiveQuad,
  RollMetadata,
  ViewMode,
} from './types/darkroom';
import {
  analyzeNegativeImageData,
  computeWhiteBalanceFromPositive,
  createDefaultSettings,
  detectFrameCrop,
  exportFullResolutionBlob,
  processNegativeImageData,
  sampleBaseColorAt,
} from './lib/negativeProcessor';
import {
  createFrameFromCanvas,
  createFrameFromFile,
  createSampleNegativeFrames,
} from './lib/sampleNegatives';
import {
  clearRollSession,
  createDefaultRollMetadata,
  loadRollSession,
  saveRollSession,
} from './lib/rollStorage';
import {
  extractPresetSettings,
  loadLocalPresets,
  saveLocalPresets,
} from './lib/presetStorage';
import { isSupportedNegativeFile } from './lib/rawImageDecoder';
import { buildRollZipArchive } from './lib/zipExport';
import { auth, signInWithGoogle, signOutUser } from './lib/firebase';
import {
  DEFAULT_CLOUD_ROLL_ID,
  deletePresetFromCloud,
  ensureUserProfile,
  loadRollFromCloud,
  savePresetToCloud,
  subscribeCloudPresets,
  syncRollToCloud,
} from './lib/cloudSync';
import { HeaderBar } from './components/HeaderBar';
import { ViewportCanvas } from './components/ViewportCanvas';
import { InspectorPanel } from './components/InspectorPanel';
import { FilmstripBar } from './components/FilmstripBar';
import { ContactSheetView } from './components/ContactSheetView';
import { FilmGuideView } from './components/FilmGuideView';
import { CameraScannerModal } from './components/CameraScannerModal';
import { CloudSyncModal } from './components/CloudSyncModal';

interface FrameHistory {
  past: GradingSettings[];
  future: GradingSettings[];
}

const MAX_HISTORY_STEPS = 40;

function cloneSettings(s: GradingSettings): GradingSettings {
  return {
    ...s,
    baseColor: { ...s.baseColor },
    crop: s.crop ? { ...s.crop } : null,
    perspective: s.perspective
      ? {
          tl: { ...s.perspective.tl },
          tr: { ...s.perspective.tr },
          br: { ...s.perspective.br },
          bl: { ...s.perspective.bl },
        }
      : null,
    healStrokes: (s.healStrokes ?? []).map((st) => ({ ...st })),
    curves: {
      master: (s.curves?.master ?? []).map((p) => ({ ...p })),
      r: (s.curves?.r ?? []).map((p) => ({ ...p })),
      g: (s.curves?.g ?? []).map((p) => ({ ...p })),
      b: (s.curves?.b ?? []).map((p) => ({ ...p })),
    },
    splitTone: {
      shadows: { ...(s.splitTone?.shadows ?? { x: 0, y: 0 }) },
      midtones: { ...(s.splitTone?.midtones ?? { x: 0, y: 0 }) },
      highlights: { ...(s.splitTone?.highlights ?? { x: 0, y: 0 }) },
    },
  };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [frames, setFrames] = useState<NegativeFrame[]>([]);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [rollMetadata, setRollMetadata] = useState<RollMetadata>(() =>
    createDefaultRollMetadata()
  );
  const [presets, setPresets] = useState<GradingPreset[]>(() => loadLocalPresets());
  const [activeSection, setActiveSection] = useState<AppSection>('darkroom');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [activeTool, setActiveTool] = useState<ActiveTool>('pan');
  const [isLoadingSamples, setIsLoadingSamples] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [historyByFrame, setHistoryByFrame] = useState<Record<string, FrameHistory>>(
    {}
  );

  // A/B snapshot comparison state
  const [abSnapshotByFrame, setAbSnapshotByFrame] = useState<
    Record<string, GradingSettings>
  >({});
  const [isAbCompare, setIsAbCompare] = useState(false);

  // Camera Scanner modal state
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  // Firebase Auth & Cloud Sync modal state
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudStatusMessage, setCloudStatusMessage] = useState<string | null>(null);
  const [cloudErrorMessage, setCloudErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasHydratedRef = useRef(false);
  const pendingEditSnapshotRef = useRef<{
    frameId: string;
    settings: GradingSettings;
  } | null>(null);

  const showTransientNotice = useCallback((msg: string) => {
    setNoticeMessage(msg);
    window.setTimeout(() => {
      setNoticeMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const loadSamples = useCallback(async () => {
    setIsLoadingSamples(true);
    setErrorMessage(null);
    try {
      const sampleFrames = await createSampleNegativeFrames();
      setFrames(sampleFrames);
      setActiveFrameId(sampleFrames[0]?.id ?? null);
      setRollMetadata(createDefaultRollMetadata());
      setHistoryByFrame({});
    } catch {
      setErrorMessage(
        'Could not load sample negatives. You can still import your own image files.'
      );
    } finally {
      setIsLoadingSamples(false);
      hasHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setIsLoadingSamples(true);
      const saved = await loadRollSession();
      if (cancelled) return;
      if (saved && saved.frames.length > 0) {
        setFrames(saved.frames);
        const match = saved.frames.find((f) => f.id === saved.activeFrameId);
        setActiveFrameId(match ? match.id : saved.frames[0].id);
        setRollMetadata(saved.rollMetadata);
        setIsLoadingSamples(false);
        hasHydratedRef.current = true;
      } else {
        await loadSamples();
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [loadSamples]);

  // Persist roll updates cleanly to IndexedDB
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveRollSession(frames, activeFrameId, rollMetadata);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [frames, activeFrameId, rollMetadata]);

  // Listen to Firebase Auth state and subscribe to cloud presets when signed in
  useEffect(() => {
    let unsubPresets: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCloudUser(user);
      setAuthReady(true);
      if (unsubPresets) {
        unsubPresets();
        unsubPresets = null;
      }
      if (user) {
        void ensureUserProfile(user).catch(() => {
          // Non-fatal background profile check
        });
        unsubPresets = subscribeCloudPresets(user, (cloudPresets) => {
          setPresets((local) => {
            const merged = new Map<string, GradingPreset>();
            for (const p of local) merged.set(p.id, p);
            for (const p of cloudPresets) merged.set(p.id, p);
            const next = Array.from(merged.values()).sort(
              (a, b) => b.updatedAt - a.updatedAt
            );
            saveLocalPresets(next);
            return next;
          });
        });
      }
    });

    return () => {
      unsubAuth();
      if (unsubPresets) unsubPresets();
    };
  }, []);

  const activeFrame = useMemo(
    () => frames.find((f) => f.id === activeFrameId) ?? frames[0] ?? null,
    [frames, activeFrameId]
  );

  // Real-time preview processing
  const processedResult = useMemo(() => {
    if (!activeFrame) return null;
    return processNegativeImageData(
      activeFrame.previewSourceData,
      activeFrame.settings
    );
  }, [activeFrame]);

  const pushHistoryEntry = useCallback(
    (frameId: string, snapshot: GradingSettings) => {
      setHistoryByFrame((prev) => {
        const entry = prev[frameId] ?? { past: [], future: [] };
        const nextPast = [...entry.past, cloneSettings(snapshot)].slice(
          -MAX_HISTORY_STEPS
        );
        return {
          ...prev,
          [frameId]: { past: nextPast, future: [] },
        };
      });
    },
    []
  );

  const handleBeginEdit = useCallback(() => {
    if (!activeFrame) return;
    pendingEditSnapshotRef.current = {
      frameId: activeFrame.id,
      settings: cloneSettings(activeFrame.settings),
    };
  }, [activeFrame]);

  const updateActiveSettings = useCallback(
    (patch: Partial<GradingSettings>, recordHistory = true) => {
      if (!activeFrame) return;
      const targetId = activeFrame.id;

      if (recordHistory) {
        pendingEditSnapshotRef.current = null;
        pushHistoryEntry(targetId, activeFrame.settings);
      } else if (pendingEditSnapshotRef.current?.frameId === targetId) {
        const snap = pendingEditSnapshotRef.current.settings;
        pendingEditSnapshotRef.current = null;
        pushHistoryEntry(targetId, snap);
      }

      setFrames((prev) =>
        prev.map((f) =>
          f.id === targetId
            ? { ...f, settings: { ...f.settings, ...patch } }
            : f
        )
      );
    },
    [activeFrame, pushHistoryEntry]
  );

  const handleUpdateFrameMeta = useCallback(
    (patch: { name?: string; filmStockLabel?: string; notes?: string }) => {
      if (!activeFrame) return;
      const targetId = activeFrame.id;
      setFrames((prev) =>
        prev.map((f) => (f.id === targetId ? { ...f, ...patch } : f))
      );
    },
    [activeFrame]
  );

  const handleUpdateRollMetadata = useCallback(
    (patch: Partial<RollMetadata>) => {
      setRollMetadata((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const activeHistory = activeFrame
    ? historyByFrame[activeFrame.id] ?? { past: [], future: [] }
    : { past: [], future: [] };

  const canUndo = activeHistory.past.length > 0;
  const canRedo = activeHistory.future.length > 0;

  const handleUndo = useCallback(() => {
    if (!activeFrame) return;
    const frameId = activeFrame.id;
    const currentSettings = cloneSettings(activeFrame.settings);

    setHistoryByFrame((prev) => {
      const entry = prev[frameId];
      if (!entry || entry.past.length === 0) return prev;
      const previousSettings = entry.past[entry.past.length - 1];
      const nextPast = entry.past.slice(0, -1);
      const nextFuture = [currentSettings, ...entry.future].slice(
        0,
        MAX_HISTORY_STEPS
      );

      setFrames((fPrev) =>
        fPrev.map((f) =>
          f.id === frameId
            ? { ...f, settings: cloneSettings(previousSettings) }
            : f
        )
      );

      return {
        ...prev,
        [frameId]: { past: nextPast, future: nextFuture },
      };
    });
  }, [activeFrame]);

  const handleRedo = useCallback(() => {
    if (!activeFrame) return;
    const frameId = activeFrame.id;
    const currentSettings = cloneSettings(activeFrame.settings);

    setHistoryByFrame((prev) => {
      const entry = prev[frameId];
      if (!entry || entry.future.length === 0) return prev;
      const nextSettings = entry.future[0];
      const nextFuture = entry.future.slice(1);
      const nextPast = [...entry.past, currentSettings].slice(-MAX_HISTORY_STEPS);

      setFrames((fPrev) =>
        fPrev.map((f) =>
          f.id === frameId ? { ...f, settings: cloneSettings(nextSettings) } : f
        )
      );

      return {
        ...prev,
        [frameId]: { past: nextPast, future: nextFuture },
      };
    });
  }, [activeFrame]);

  const handleImportFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) =>
      isSupportedNegativeFile(file)
    );

    if (files.length === 0) {
      setErrorMessage(
        'Please select image, 16-bit TIFF, or Camera RAW files (PNG, JPEG, WebP, TIFF, DNG, CR2, NEF, ARW).'
      );
      return;
    }

    setErrorMessage(null);
    const loaded: NegativeFrame[] = [];
    const failedNames: string[] = [];

    for (const file of files) {
      try {
        const frame = await createFrameFromFile(file);
        loaded.push(frame);
      } catch {
        failedNames.push(file.name);
      }
    }

    if (loaded.length > 0) {
      setFrames((prev) => [...prev, ...loaded]);
      setActiveFrameId(loaded[0].id);
      setActiveSection('darkroom');
    }

    if (failedNames.length > 0) {
      setErrorMessage(
        `Could not decode ${failedNames.join(', ')}. Ensure the file is a valid image, TIFF, or Camera RAW scan.`
      );
    }
  }, []);

  const handleCameraCapture = useCallback(
    (canvas: HTMLCanvasElement, name: string) => {
      const frame = createFrameFromCanvas(canvas, name, 'Camera Lightbox Scan');
      setFrames((prev) => [...prev, frame]);
      setActiveFrameId(frame.id);
      setActiveSection('darkroom');
      showTransientNotice(`Captured ${name}`);
    },
    [showTransientNotice]
  );

  const handleRemoveFrame = useCallback(
    (id: string) => {
      setFrames((prev) => {
        const idx = prev.findIndex((f) => f.id === id);
        const next = prev.filter((f) => f.id !== id);
        if (activeFrameId === id) {
          const fallback = next[Math.min(idx, next.length - 1)] ?? null;
          setActiveFrameId(fallback ? fallback.id : null);
        }
        return next;
      });
    },
    [activeFrameId]
  );

  const handleResetRoll = useCallback(async () => {
    await clearRollSession();
    await loadSamples();
    setAbSnapshotByFrame({});
    setIsAbCompare(false);
    setActiveSection('darkroom');
    setActiveTool('pan');
  }, [loadSamples]);

  const handleAutoCalibrate = useCallback(() => {
    if (!activeFrame) return;
    const analysis = analyzeNegativeImageData(activeFrame.previewSourceData);
    updateActiveSettings(
      {
        profile: analysis.recommendedProfile,
        baseColor: analysis.baseColor,
        autoBalance: 94,
        borderIgnore: activeFrame.settings.crop
          ? 2
          : analysis.hasSprocketBorder
            ? 12
            : 4,
        exposure: 0,
        temperature: 0,
        tint: 0,
        blackPoint: 0,
        highlights: 0,
        shadows: 8,
      },
      true
    );
  }, [activeFrame, updateActiveSettings]);

  const handleBatchAutoFrame = useCallback(() => {
    if (frames.length === 0) return;
    setFrames((prev) =>
      prev.map((f) => {
        pushHistoryEntry(f.id, f.settings);
        const crop = detectFrameCrop(f.previewSourceData, f.settings);
        return {
          ...f,
          settings: {
            ...f.settings,
            crop,
            borderIgnore: 2,
          },
        };
      })
    );
    showTransientNotice(`Auto-framed all ${frames.length} frames on roll`);
  }, [frames.length, pushHistoryEntry, showTransientNotice]);

  const handleResetFrame = useCallback(() => {
    if (!activeFrame) return;
    const analysis = analyzeNegativeImageData(activeFrame.previewSourceData);
    updateActiveSettings(
      createDefaultSettings({
        profile: analysis.recommendedProfile,
        baseColor: analysis.baseColor,
        borderIgnore: analysis.hasSprocketBorder ? 12 : 4,
      }),
      true
    );
  }, [activeFrame, updateActiveSettings]);

  const handleSyncToRoll = useCallback(() => {
    if (!activeFrame) return;
    const sourceSettings = cloneSettings(activeFrame.settings);
    setFrames((prev) =>
      prev.map((f) => {
        if (f.id === activeFrame.id) return f;
        pushHistoryEntry(f.id, f.settings);
        return {
          ...f,
          settings: {
            ...cloneSettings(sourceSettings),
            rotate: f.settings.rotate,
            flipH: f.settings.flipH,
            crop: f.settings.crop,
            perspective: f.settings.perspective,
            healStrokes: f.settings.healStrokes,
          },
        };
      })
    );
  }, [activeFrame, pushHistoryEntry]);

  // Custom presets handlers
  const handleSavePreset = useCallback(
    (name: string) => {
      if (!activeFrame) return;
      const now = Date.now();
      const preset: GradingPreset = {
        id: `preset-${now}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim().slice(0, 80),
        createdAt: now,
        updatedAt: now,
        settings: extractPresetSettings(activeFrame.settings),
      };
      setPresets((prev) => {
        const next = [preset, ...prev];
        saveLocalPresets(next);
        return next;
      });
      if (cloudUser) {
        void savePresetToCloud(cloudUser, preset).catch(() => {
          // Local preset still preserved if offline
        });
      }
      showTransientNotice(`Saved preset "${preset.name}"`);
    },
    [activeFrame, cloudUser, showTransientNotice]
  );

  const handleApplyPreset = useCallback(
    (preset: GradingPreset) => {
      if (!activeFrame) return;
      updateActiveSettings(
        {
          ...preset.settings,
          curves: preset.settings.curves
            ? {
                master: preset.settings.curves.master.map((p) => ({ ...p })),
                r: preset.settings.curves.r.map((p) => ({ ...p })),
                g: preset.settings.curves.g.map((p) => ({ ...p })),
                b: preset.settings.curves.b.map((p) => ({ ...p })),
              }
            : activeFrame.settings.curves,
          splitTone: preset.settings.splitTone
            ? {
                shadows: { ...preset.settings.splitTone.shadows },
                midtones: { ...preset.settings.splitTone.midtones },
                highlights: { ...preset.settings.splitTone.highlights },
              }
            : activeFrame.settings.splitTone,
        },
        true
      );
      showTransientNotice(`Applied "${preset.name}"`);
    },
    [activeFrame, showTransientNotice, updateActiveSettings]
  );

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      setPresets((prev) => {
        const next = prev.filter((p) => p.id !== presetId);
        saveLocalPresets(next);
        return next;
      });
      if (cloudUser) {
        void deletePresetFromCloud(cloudUser, presetId).catch(() => {
          // Ignore if preset was only stored locally
        });
      }
    },
    [cloudUser]
  );

  // A/B snapshot handlers
  const activeAbSnapshot = activeFrame
    ? abSnapshotByFrame[activeFrame.id] ?? null
    : null;

  const handleSetAbSnapshot = useCallback(() => {
    if (!activeFrame) return;
    setAbSnapshotByFrame((prev) => ({
      ...prev,
      [activeFrame.id]: cloneSettings(activeFrame.settings),
    }));
    setIsAbCompare(true);
    if (viewMode === 'negative' || viewMode === 'positive') {
      setViewMode('split');
    }
    showTransientNotice('Saved Snapshot A — adjust sliders to compare Live B');
  }, [activeFrame, showTransientNotice, viewMode]);

  const handleToggleAbCompare = useCallback(() => {
    setIsAbCompare((prev) => {
      const next = !prev;
      if (next && (viewMode === 'negative' || viewMode === 'positive')) {
        setViewMode('split');
      }
      return next;
    });
  }, [viewMode]);

  const handleClearAbSnapshot = useCallback(() => {
    if (!activeFrame) return;
    setAbSnapshotByFrame((prev) => {
      const copy = { ...prev };
      delete copy[activeFrame.id];
      return copy;
    });
    setIsAbCompare(false);
  }, [activeFrame]);

  const handlePickBase = useCallback(
    (normX: number, normY: number) => {
      if (!activeFrame) return;
      const picked = sampleBaseColorAt(
        activeFrame.previewSourceData,
        activeFrame.settings,
        normX,
        normY
      );
      updateActiveSettings({ baseColor: picked }, true);
      setActiveTool('pan');
    },
    [activeFrame, updateActiveSettings]
  );

  const handlePickGray = useCallback(
    (normX: number, normY: number) => {
      if (!activeFrame || !processedResult) return;
      const nextWB = computeWhiteBalanceFromPositive(
        processedResult.imageData,
        normX,
        normY,
        activeFrame.settings.temperature,
        activeFrame.settings.tint
      );
      updateActiveSettings(nextWB, true);
      setActiveTool('pan');
    },
    [activeFrame, processedResult, updateActiveSettings]
  );

  const handleRotate = useCallback(() => {
    if (!activeFrame) return;
    const next = ((activeFrame.settings.rotate + 90) % 360) as 0 | 90 | 180 | 270;
    updateActiveSettings({ rotate: next }, true);
  }, [activeFrame, updateActiveSettings]);

  const handleFlipH = useCallback(() => {
    if (!activeFrame) return;
    updateActiveSettings({ flipH: !activeFrame.settings.flipH }, true);
  }, [activeFrame, updateActiveSettings]);

  const handleUpdateCrop = useCallback(
    (crop: CropRect | null) => {
      updateActiveSettings(
        {
          crop,
          borderIgnore: crop ? 2 : 6,
        },
        true
      );
    },
    [updateActiveSettings]
  );

  const handleUpdatePerspective = useCallback(
    (perspective: PerspectiveQuad | null) => {
      updateActiveSettings({ perspective }, true);
    },
    [updateActiveSettings]
  );

  const handleSplitStrip = useCallback(
    (rects: CropRect[]) => {
      if (!activeFrame || rects.length <= 1) return;
      const newFrames: NegativeFrame[] = rects.map((rect, idx) => ({
        ...activeFrame,
        id: `${activeFrame.id}-split-${Date.now()}-${idx + 1}`,
        name: `${activeFrame.name} · ${idx + 1}`,
        isSample: false,
        settings: {
          ...cloneSettings(activeFrame.settings),
          crop: rect,
          borderIgnore: 2,
          healStrokes: [],
        },
      }));

      setFrames((prev) => {
        const index = prev.findIndex((f) => f.id === activeFrame.id);
        if (index === -1) return [...prev, ...newFrames];
        const next = [...prev];
        next.splice(index, 1, ...newFrames);
        return next;
      });
      setActiveFrameId(newFrames[0].id);
    },
    [activeFrame]
  );

  const handleAddHealStroke = useCallback(
    (stroke: HealStroke) => {
      if (!activeFrame) return;
      const targetId = activeFrame.id;
      if (pendingEditSnapshotRef.current?.frameId === targetId) {
        const snap = pendingEditSnapshotRef.current.settings;
        pendingEditSnapshotRef.current = null;
        pushHistoryEntry(targetId, snap);
      }

      setFrames((prev) =>
        prev.map((f) =>
          f.id === targetId
            ? {
                ...f,
                settings: {
                  ...f.settings,
                  healStrokes: [...(f.settings.healStrokes ?? []), stroke],
                },
              }
            : f
        )
      );
    },
    [activeFrame, pushHistoryEntry]
  );

  const handleClearHealStrokes = useCallback(() => {
    updateActiveSettings({ healStrokes: [] }, true);
  }, [updateActiveSettings]);

  const handleExportFrame = useCallback(
    async (frame: NegativeFrame, format: 'image/png' | 'image/jpeg') => {
      setIsExporting(true);
      try {
        const blob = await exportFullResolutionBlob(
          frame.sourceCanvas,
          frame.settings,
          format,
          format === 'image/jpeg'
            ? {
                title: frame.name,
                camera: rollMetadata.camera,
                lens: rollMetadata.lens,
                filmStock: rollMetadata.filmStock || frame.filmStockLabel,
                iso: rollMetadata.iso,
                notes: frame.notes || rollMetadata.notes,
              }
            : undefined
        );
        const ext = format === 'image/png' ? 'png' : 'jpg';
        const safeName = frame.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
        triggerDownload(blob, `${safeName}_positive.${ext}`);
      } catch {
        setErrorMessage('Export failed. Please try again with a different format.');
      } finally {
        setIsExporting(false);
      }
    },
    [rollMetadata]
  );

  const handleExportZip = useCallback(
    async (format: 'image/png' | 'image/jpeg') => {
      if (frames.length === 0) return;
      setIsBatchExporting(true);
      setZipProgress({ completed: 0, total: frames.length });
      try {
        const zipBlob = await buildRollZipArchive(
          frames,
          format,
          (completed, total) => setZipProgress({ completed, total }),
          rollMetadata
        );
        triggerDownload(zipBlob, 'negora-roll.zip');
      } catch {
        setErrorMessage('ZIP export failed while encoding one or more frames.');
      } finally {
        setIsBatchExporting(false);
        setZipProgress(null);
      }
    },
    [frames, rollMetadata]
  );

  // Cloud Sync Modal actions
  const handleCloudSignIn = useCallback(async () => {
    setCloudErrorMessage(null);
    setCloudStatusMessage(null);
    setIsCloudSyncing(true);
    try {
      const user = await signInWithGoogle();
      await ensureUserProfile(user);
      for (const preset of presets) {
        await savePresetToCloud(user, preset);
      }
      setCloudStatusMessage('Signed in and ready to sync.');
    } catch (err) {
      setCloudErrorMessage(
        err instanceof Error ? err.message : 'Google sign-in failed.'
      );
    } finally {
      setIsCloudSyncing(false);
    }
  }, [presets]);

  const handleCloudSignOut = useCallback(async () => {
    setCloudErrorMessage(null);
    setCloudStatusMessage(null);
    try {
      await signOutUser();
    } catch (err) {
      setCloudErrorMessage(
        err instanceof Error ? err.message : 'Sign-out failed.'
      );
    }
  }, []);

  const handlePushRollToCloud = useCallback(async () => {
    if (!cloudUser) return;
    setCloudErrorMessage(null);
    setCloudStatusMessage(null);
    setIsCloudSyncing(true);
    try {
      await syncRollToCloud(
        cloudUser,
        DEFAULT_CLOUD_ROLL_ID,
        rollMetadata,
        frames,
        activeFrameId
      );
      setCloudStatusMessage(
        `Saved ${frames.length} frames and metadata to your cloud roll.`
      );
    } catch (err) {
      setCloudErrorMessage(
        err instanceof Error ? err.message : 'Could not sync roll to cloud.'
      );
    } finally {
      setIsCloudSyncing(false);
    }
  }, [activeFrameId, cloudUser, frames, rollMetadata]);

  const handlePullRollFromCloud = useCallback(async () => {
    if (!cloudUser) return;
    setCloudErrorMessage(null);
    setCloudStatusMessage(null);
    setIsCloudSyncing(true);
    try {
      const data = await loadRollFromCloud(cloudUser, DEFAULT_CLOUD_ROLL_ID);
      if (!data || data.frames.length === 0) {
        setCloudStatusMessage('No saved cloud roll found yet. Save one first.');
        return;
      }
      setFrames(data.frames);
      setRollMetadata(data.rollMeta);
      const match = data.frames.find((f) => f.id === data.activeFrameId);
      setActiveFrameId(match ? match.id : data.frames[0].id);
      setHistoryByFrame({});
      setCloudStatusMessage(`Loaded ${data.frames.length} frames from cloud.`);
    } catch (err) {
      setCloudErrorMessage(
        err instanceof Error ? err.message : 'Could not load cloud roll.'
      );
    } finally {
      setIsCloudSyncing(false);
    }
  }, [cloudUser]);

  // Global darkroom keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (e.key === 'Escape') {
        setActiveTool('pan');
        setIsCameraOpen(false);
        setIsCloudModalOpen(false);
        return;
      }

      if (isInput) return;

      if (activeSection !== 'darkroom' || !activeFrame) return;

      const mod = e.metaKey || e.ctrlKey;
      const lower = e.key.toLowerCase();

      if (mod && lower === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && lower === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (mod) return;

      if (e.key === ' ') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'negative' ? 'positive' : 'negative'));
      } else if (lower === 'b') {
        setActiveTool((prev) => (prev === 'pick-base' ? 'pan' : 'pick-base'));
      } else if (lower === 'g') {
        setActiveTool((prev) => (prev === 'pick-gray' ? 'pan' : 'pick-gray'));
      } else if (lower === 'h') {
        setActiveTool((prev) => (prev === 'heal' ? 'pan' : 'heal'));
      } else if (lower === 'c') {
        setActiveTool((prev) => (prev === 'crop' ? 'pan' : 'crop'));
      } else if (lower === 'p') {
        setActiveTool((prev) => (prev === 'perspective' ? 'pan' : 'perspective'));
      } else if (lower === 'r') {
        handleRotate();
      } else if (lower === 'f') {
        handleFlipH();
      } else if (e.key === 'ArrowRight' && frames.length > 1) {
        const idx = frames.findIndex((f) => f.id === activeFrame.id);
        const next = frames[(idx + 1) % frames.length];
        setActiveFrameId(next.id);
      } else if (e.key === 'ArrowLeft' && frames.length > 1) {
        const idx = frames.findIndex((f) => f.id === activeFrame.id);
        const prev = frames[(idx - 1 + frames.length) % frames.length];
        setActiveFrameId(prev.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeSection,
    activeFrame,
    frames,
    handleUndo,
    handleRedo,
    handleRotate,
    handleFlipH,
  ]);

  // Global Ctrl+V / Cmd+V clipboard image paste
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (isInput) return;

      const clipboard = e.clipboardData;
      if (!clipboard) return;

      const collected: File[] = [];
      if (clipboard.items && clipboard.items.length > 0) {
        for (const item of Array.from(clipboard.items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) collected.push(file);
          }
        }
      }

      if (collected.length === 0 && clipboard.files && clipboard.files.length > 0) {
        for (const file of Array.from(clipboard.files)) {
          if (isSupportedNegativeFile(file)) {
            collected.push(file);
          }
        }
      }

      if (collected.length === 0) return;

      e.preventDefault();
      const now = new Date();
      const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join('');

      const normalizedFiles = collected.map((file, idx) => {
        const isGeneric =
          !file.name || /^image\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
        if (!isGeneric) return file;

        const mimeExt = file.type.split('/')[1]?.toLowerCase() ?? 'png';
        const ext =
          mimeExt === 'jpeg' ? 'jpg' : mimeExt.replace(/[^a-z0-9]/g, '') || 'png';
        const suffix = collected.length > 1 ? `-${idx + 1}` : '';
        return new File([file], `Pasted Negative ${stamp}${suffix}.${ext}`, {
          type: file.type || 'image/png',
        });
      });

      void handleImportFiles(normalizedFiles);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleImportFiles]);

  return (
    <div className="h-[100dvh] lg:h-screen w-full flex flex-col bg-[#0E0E10] text-zinc-100 overflow-hidden">
      <input
        id="halide-file-input"
        ref={fileInputRef}
        type="file"
        accept="image/*,.tif,.tiff,.dng,.cr2,.nef,.arw,.orf,.rw2,.pef,.raf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleImportFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <HeaderBar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        onImportClick={() => fileInputRef.current?.click()}
        cloudUser={cloudUser}
        onOpenCloudSync={() => {
          setCloudStatusMessage(null);
          setCloudErrorMessage(null);
          setIsCloudModalOpen(true);
        }}
      />

      {errorMessage && (
        <div
          role="alert"
          className="shrink-0 bg-red-950/80 border-b border-red-800/70 px-5 py-2 flex items-center justify-between text-xs text-red-200"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-300 hover:text-white underline underline-offset-2 ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {noticeMessage && !errorMessage && (
        <div
          role="status"
          className="shrink-0 bg-[#171512] border-b border-[#E59A28]/25 px-5 py-1.5 flex items-center justify-between text-xs text-amber-200/90"
        >
          <span>{noticeMessage}</span>
          <button
            type="button"
            onClick={() => setNoticeMessage(null)}
            className="text-amber-300 hover:text-white underline underline-offset-2 ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {activeSection === 'darkroom' ? (
        <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_312px] lg:grid-rows-[minmax(0,1fr)_auto]">
          <div className="shrink-0 lg:flex-1 min-w-0 lg:min-h-0 flex flex-col lg:col-start-1 lg:row-start-1">
            <ViewportCanvas
              frame={activeFrame}
              processedData={processedResult?.imageData ?? null}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              activeTool={activeTool}
              onChangeTool={setActiveTool}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onRotate={handleRotate}
              onFlipH={handleFlipH}
              onUpdateCrop={handleUpdateCrop}
              onUpdatePerspective={handleUpdatePerspective}
              onSplitStrip={handleSplitStrip}
              onBeginHealStroke={handleBeginEdit}
              onAddHealStroke={handleAddHealStroke}
              onClearHealStrokes={handleClearHealStrokes}
              onPickBase={handlePickBase}
              onPickGray={handlePickGray}
              onImportFiles={handleImportFiles}
              onReloadSamples={() => void loadSamples()}
              onOpenCamera={() => setIsCameraOpen(true)}
              isLoadingSamples={isLoadingSamples}
              abSnapshotSettings={activeAbSnapshot}
              isAbCompare={isAbCompare}
              onSetAbSnapshot={handleSetAbSnapshot}
              onToggleAbCompare={handleToggleAbCompare}
              onClearAbSnapshot={handleClearAbSnapshot}
            />
          </div>

          <div className="shrink-0 min-w-0 lg:col-span-2 lg:row-start-2">
            <FilmstripBar
              frames={frames}
              activeFrameId={activeFrame?.id ?? null}
              onSelectFrame={setActiveFrameId}
              onRemoveFrame={handleRemoveFrame}
              onImportClick={() => fileInputRef.current?.click()}
              onOpenCamera={() => setIsCameraOpen(true)}
              onBatchAutoFrame={handleBatchAutoFrame}
            />
          </div>

          <div className="flex-1 min-w-0 min-h-0 flex flex-col lg:col-start-2 lg:row-start-1">
            <InspectorPanel
              frame={activeFrame}
              histogram={processedResult?.histogram ?? null}
              activeTool={activeTool}
              onChangeTool={setActiveTool}
              onBeginEdit={handleBeginEdit}
              onUpdateSettings={updateActiveSettings}
              onAutoCalibrate={handleAutoCalibrate}
              onResetFrame={handleResetFrame}
              onSyncToRoll={handleSyncToRoll}
              onExport={(format) =>
                activeFrame
                  ? handleExportFrame(activeFrame, format)
                  : Promise.resolve()
              }
              isExporting={isExporting}
              frameCount={frames.length}
              presets={presets}
              onSavePreset={handleSavePreset}
              onApplyPreset={handleApplyPreset}
              onDeletePreset={handleDeletePreset}
              onUpdateFrameMeta={handleUpdateFrameMeta}
            />
          </div>
        </div>
      ) : activeSection === 'contact-sheet' ? (
        <ContactSheetView
          frames={frames}
          rollMetadata={rollMetadata}
          onUpdateRollMetadata={handleUpdateRollMetadata}
          onOpenInDarkroom={(id) => {
            setActiveFrameId(id);
            setActiveSection('darkroom');
          }}
          onExportFrame={handleExportFrame}
          onExportZip={handleExportZip}
          onBatchAutoFrame={handleBatchAutoFrame}
          onResetRoll={() => void handleResetRoll()}
          onImportClick={() => fileInputRef.current?.click()}
          onOpenCamera={() => setIsCameraOpen(true)}
          isBatchExporting={isBatchExporting}
          zipProgress={zipProgress}
        />
      ) : (
        <FilmGuideView onReturnToDarkroom={() => setActiveSection('darkroom')} />
      )}

      <CameraScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCaptureCanvas={handleCameraCapture}
        onImportFilesClick={() => fileInputRef.current?.click()}
      />

      <CloudSyncModal
        isOpen={isCloudModalOpen}
        onClose={() => setIsCloudModalOpen(false)}
        user={cloudUser}
        authReady={authReady}
        isSyncing={isCloudSyncing}
        statusMessage={cloudStatusMessage}
        errorMessage={cloudErrorMessage}
        presetCount={presets.length}
        frameCount={frames.length}
        onSignIn={handleCloudSignIn}
        onSignOut={handleCloudSignOut}
        onPushRoll={handlePushRollToCloud}
        onPullRoll={handlePullRollFromCloud}
      />
    </div>
  );
}
