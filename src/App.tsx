import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveTool,
  AppSection,
  CropRect,
  GradingSettings,
  HealStroke,
  NegativeFrame,
  PerspectiveQuad,
  ViewMode,
} from './types/darkroom';
import {
  analyzeNegativeImageData,
  computeWhiteBalanceFromPositive,
  createDefaultSettings,
  exportFullResolutionBlob,
  processNegativeImageData,
  sampleBaseColorAt,
} from './lib/negativeProcessor';
import {
  createFrameFromFile,
  createSampleNegativeFrames,
} from './lib/sampleNegatives';
import {
  clearRollSession,
  loadRollSession,
  saveRollSession,
} from './lib/rollStorage';
import { buildRollZipArchive } from './lib/zipExport';
import { HeaderBar } from './components/HeaderBar';
import { ViewportCanvas } from './components/ViewportCanvas';
import { InspectorPanel } from './components/InspectorPanel';
import { FilmstripBar } from './components/FilmstripBar';
import { ContactSheetView } from './components/ContactSheetView';
import { FilmGuideView } from './components/FilmGuideView';

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
  const [activeSection, setActiveSection] = useState<AppSection>('darkroom');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [activeTool, setActiveTool] = useState<ActiveTool>('pan');
  const [isLoadingSamples, setIsLoadingSamples] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ completed: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyByFrame, setHistoryByFrame] = useState<Record<string, FrameHistory>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasHydratedRef = useRef(false);
  const pendingEditSnapshotRef = useRef<{
    frameId: string;
    settings: GradingSettings;
  } | null>(null);

  const loadSamples = useCallback(async () => {
    setIsLoadingSamples(true);
    setErrorMessage(null);
    try {
      const sampleFrames = await createSampleNegativeFrames();
      setFrames(sampleFrames);
      setActiveFrameId(sampleFrames[0]?.id ?? null);
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
      void saveRollSession(frames, activeFrameId);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [frames, activeFrameId]);

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
      const nextFuture = [currentSettings, ...entry.future].slice(0, MAX_HISTORY_STEPS);

      setFrames((fPrev) =>
        fPrev.map((f) =>
          f.id === frameId ? { ...f, settings: cloneSettings(previousSettings) } : f
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
    const files = Array.from(fileList).filter(
      (file) =>
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|bmp|gif|avif|tiff?)$/i.test(file.name)
    );

    if (files.length === 0) {
      setErrorMessage('Please select image files (PNG, JPEG, WebP, or BMP).');
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
        `Could not decode ${failedNames.join(', ')}. Convert raw/TIFF files to PNG or JPEG first.`
      );
    }
  }, []);

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
          format
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
    []
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
          (completed, total) => setZipProgress({ completed, total })
        );
        triggerDownload(zipBlob, 'negora-roll.zip');
      } catch {
        setErrorMessage('ZIP export failed while encoding one or more frames.');
      } finally {
        setIsBatchExporting(false);
        setZipProgress(null);
      }
    },
    [frames]
  );

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

  return (
    <div className="min-h-screen lg:h-screen w-full flex flex-col bg-[#0E0E10] text-zinc-100 lg:overflow-hidden">
      <input
        id="halide-file-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
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

      {activeSection === 'darkroom' ? (
        <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_312px] lg:grid-rows-[minmax(0,1fr)_auto]">
          <div className="min-w-0 min-h-0 flex flex-col lg:col-start-1 lg:row-start-1">
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
              isLoadingSamples={isLoadingSamples}
            />
          </div>

          <div className="min-w-0 lg:col-span-2 lg:row-start-2">
            <FilmstripBar
              frames={frames}
              activeFrameId={activeFrame?.id ?? null}
              onSelectFrame={setActiveFrameId}
              onRemoveFrame={handleRemoveFrame}
              onImportClick={() => fileInputRef.current?.click()}
            />
          </div>

          <div className="min-w-0 min-h-0 flex flex-col lg:col-start-2 lg:row-start-1">
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
            />
          </div>
        </div>
      ) : activeSection === 'contact-sheet' ? (
        <ContactSheetView
          frames={frames}
          onOpenInDarkroom={(id) => {
            setActiveFrameId(id);
            setActiveSection('darkroom');
          }}
          onExportFrame={handleExportFrame}
          onExportZip={handleExportZip}
          onResetRoll={() => void handleResetRoll()}
          onImportClick={() => fileInputRef.current?.click()}
          isBatchExporting={isBatchExporting}
          zipProgress={zipProgress}
        />
      ) : (
        <FilmGuideView onReturnToDarkroom={() => setActiveSection('darkroom')} />
      )}
    </div>
  );
}
