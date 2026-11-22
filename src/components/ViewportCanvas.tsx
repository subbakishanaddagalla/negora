import { useEffect, useRef, useState } from 'react';
import type {
  ActiveTool,
  CropRect,
  HealStroke,
  NegativeFrame,
  PerspectiveQuad,
  ViewMode,
} from '../types/darkroom';
import {
  createOrientedImageData,
  detectFrameCrop,
  detectStripSubFrames,
  processNegativeImageData,
} from '../lib/negativeProcessor';
import {
  Crop,
  Eraser,
  FlipHorizontal2,
  MoveHorizontal,
  Pipette,
  Redo2,
  RotateCw,
  Scan,
  Scissors,
  Sparkles,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface ViewportCanvasProps {
  frame: NegativeFrame | null;
  processedData: ImageData | null;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  activeTool: ActiveTool;
  onChangeTool: (tool: ActiveTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRotate: () => void;
  onFlipH: () => void;
  onUpdateCrop: (crop: CropRect | null) => void;
  onUpdatePerspective: (quad: PerspectiveQuad | null) => void;
  onSplitStrip: (rects: CropRect[]) => void;
  onBeginHealStroke: () => void;
  onAddHealStroke: (stroke: HealStroke) => void;
  onClearHealStrokes: () => void;
  onPickBase: (normX: number, normY: number) => void;
  onPickGray: (normX: number, normY: number) => void;
  onImportFiles: (files: FileList | File[]) => void;
  onReloadSamples: () => void;
  isLoadingSamples: boolean;
}

type CropDragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type QuadCornerKey = keyof PerspectiveQuad;

const DEFAULT_PERSPECTIVE: PerspectiveQuad = {
  tl: { x: 0.04, y: 0.04 },
  tr: { x: 0.96, y: 0.04 },
  br: { x: 0.96, y: 0.96 },
  bl: { x: 0.04, y: 0.96 },
};

export function ViewportCanvas({
  frame,
  processedData,
  viewMode,
  onChangeViewMode,
  activeTool,
  onChangeTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRotate,
  onFlipH,
  onUpdateCrop,
  onUpdatePerspective,
  onSplitStrip,
  onBeginHealStroke,
  onAddHealStroke,
  onClearHealStrokes,
  onPickBase,
  onPickGray,
  onImportFiles,
  onReloadSamples,
  isLoadingSamples,
}: ViewportCanvasProps) {
  const negCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const posCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sideNegCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sidePosCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 560,
  });
  const [wipePct, setWipePct] = useState(50);
  const [isDraggingWipe, setIsDraggingWipe] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });
  const [isDragOver, setIsDragOver] = useState(false);

  // Interactive crop state (synced with activeTool === 'crop')
  const isCropping = activeTool === 'crop' && Boolean(frame);
  const isWarping = activeTool === 'perspective' && Boolean(frame);
  const isHealing = activeTool === 'heal' && Boolean(frame);

  const [draftCrop, setDraftCrop] = useState<CropRect>({
    x: 0.06,
    y: 0.1,
    w: 0.84,
    h: 0.8,
  });
  const [cropNote, setCropNote] = useState<string | null>(null);
  const [cropDrag, setCropDrag] = useState<{
    handle: CropDragHandle;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  // Interactive 4-corner perspective warp state
  const [draftQuad, setDraftQuad] = useState<PerspectiveQuad>(DEFAULT_PERSPECTIVE);
  const [quadDragCorner, setQuadDragCorner] = useState<QuadCornerKey | null>(null);

  // Spot healing brush state
  const [healBrushRadius, setHealBrushRadius] = useState<number>(0.022);
  const [healHover, setHealHover] = useState<{ x: number; y: number } | null>(null);
  const [isPaintingHeal, setIsPaintingHeal] = useState(false);
  const lastHealPtRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const pad = window.innerWidth >= 768 ? 72 : 24;
      setStageSize({
        w: Math.max(180, rect.width - pad),
        h: Math.max(180, rect.height - pad),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setCropNote(null);
  }, [frame?.id]);

  // Initialize draft crop/perspective when switching into crop/warp tool
  useEffect(() => {
    if (!frame) return;
    if (activeTool === 'crop') {
      if (viewMode === 'side-by-side') onChangeViewMode('positive');
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setCropNote(null);
      setDraftCrop(
        frame.settings.crop ?? { x: 0.06, y: 0.1, w: 0.84, h: 0.8 }
      );
    } else if (activeTool === 'perspective') {
      if (viewMode === 'side-by-side') onChangeViewMode('positive');
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setDraftQuad(frame.settings.perspective ?? DEFAULT_PERSPECTIVE);
    } else if (activeTool === 'heal') {
      if (viewMode === 'negative' || viewMode === 'side-by-side') {
        onChangeViewMode('positive');
      }
    }
  }, [activeTool, frame?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute preview data depending on active editing overlay
  const activeDisplayData = (() => {
    if (!frame) return null;
    if (isWarping) {
      return processNegativeImageData(
        frame.previewSourceData,
        frame.settings,
        true,
        true
      ).imageData;
    }
    if (isCropping) {
      return processNegativeImageData(
        frame.previewSourceData,
        frame.settings,
        true,
        false
      ).imageData;
    }
    return processedData;
  })();

  useEffect(() => {
    if (!frame) return;
    const orientedNeg = createOrientedImageData(
      frame.previewSourceData,
      frame.settings.rotate,
      frame.settings.flipH,
      isWarping ? null : frame.settings.perspective,
      isCropping || isWarping ? null : frame.settings.crop
    );

    const targets = [negCanvasRef.current, sideNegCanvasRef.current];
    for (const canvas of targets) {
      if (!canvas) continue;
      canvas.width = orientedNeg.width;
      canvas.height = orientedNeg.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.putImageData(orientedNeg, 0, 0);
    }
  }, [
    frame,
    frame?.settings.rotate,
    frame?.settings.flipH,
    frame?.settings.perspective,
    frame?.settings.crop,
    viewMode,
    isCropping,
    isWarping,
  ]);

  useEffect(() => {
    if (!activeDisplayData) return;
    const targets = [posCanvasRef.current, sidePosCanvasRef.current];
    for (const canvas of targets) {
      if (!canvas) continue;
      canvas.width = activeDisplayData.width;
      canvas.height = activeDisplayData.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.putImageData(activeDisplayData, 0, 0);
    }
  }, [activeDisplayData, viewMode]);

  useEffect(() => {
    if (!isDraggingWipe) return;
    const handleMove = (e: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
      setWipePct(Math.max(2, Math.min(98, pct)));
    };
    const handleUp = () => setIsDraggingWipe(false);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [isDraggingWipe]);

  useEffect(() => {
    if (!isPanning) return;
    const handleMove = (e: PointerEvent) => {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    };
    const handleUp = () => setIsPanning(false);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [isPanning]);

  useEffect(() => {
    if (!cropDrag) return;
    const handleMove = (e: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = (e.clientX - cropDrag.startX) / Math.max(1, rect.width);
      const dy = (e.clientY - cropDrag.startY) / Math.max(1, rect.height);
      const sc = cropDrag.startCrop;
      const minSize = 0.08;

      if (cropDrag.handle === 'move') {
        const nx = Math.max(0, Math.min(1 - sc.w, sc.x + dx));
        const ny = Math.max(0, Math.min(1 - sc.h, sc.y + dy));
        setDraftCrop({ x: nx, y: ny, w: sc.w, h: sc.h });
      } else if (cropDrag.handle === 'nw') {
        const nx = Math.max(0, Math.min(sc.x + sc.w - minSize, sc.x + dx));
        const ny = Math.max(0, Math.min(sc.y + sc.h - minSize, sc.y + dy));
        setDraftCrop({
          x: nx,
          y: ny,
          w: sc.x + sc.w - nx,
          h: sc.y + sc.h - ny,
        });
      } else if (cropDrag.handle === 'ne') {
        const ny = Math.max(0, Math.min(sc.y + sc.h - minSize, sc.y + dy));
        const nw = Math.max(minSize, Math.min(1 - sc.x, sc.w + dx));
        setDraftCrop({
          x: sc.x,
          y: ny,
          w: nw,
          h: sc.y + sc.h - ny,
        });
      } else if (cropDrag.handle === 'sw') {
        const nx = Math.max(0, Math.min(sc.x + sc.w - minSize, sc.x + dx));
        const nh = Math.max(minSize, Math.min(1 - sc.y, sc.h + dy));
        setDraftCrop({
          x: nx,
          y: sc.y,
          w: sc.x + sc.w - nx,
          h: nh,
        });
      } else if (cropDrag.handle === 'se') {
        const nw = Math.max(minSize, Math.min(1 - sc.x, sc.w + dx));
        const nh = Math.max(minSize, Math.min(1 - sc.y, sc.h + dy));
        setDraftCrop({
          x: sc.x,
          y: sc.y,
          w: nw,
          h: nh,
        });
      }
    };
    const handleUp = () => setCropDrag(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [cropDrag]);

  useEffect(() => {
    if (!quadDragCorner) return;
    const handleMove = (e: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const nx = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const ny = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top) / Math.max(1, rect.height)));
      setDraftQuad((prev) => ({
        ...prev,
        [quadDragCorner]: { x: nx, y: ny },
      }));
    };
    const handleUp = () => setQuadDragCorner(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [quadDragCorner]);

  useEffect(() => {
    if (!isPaintingHeal) return;
    const handleUp = () => {
      setIsPaintingHeal(false);
      lastHealPtRef.current = null;
    };
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [isPaintingHeal]);

  const handleAutoFrame = () => {
    if (!frame) return;
    const detected = detectFrameCrop(frame.previewSourceData, frame.settings);
    setDraftCrop(detected);
    setCropNote('Detected inner frame boundaries.');
  };

  const handleSplitStrip = () => {
    if (!frame) return;
    const rects = detectStripSubFrames(frame.previewSourceData, frame.settings);
    if (rects.length > 1) {
      onSplitStrip(rects);
      onChangeTool('pan');
    } else {
      setDraftCrop(rects[0]);
      setCropNote('Single frame detected — trimmed film borders.');
    }
  };

  const emitHealAtClient = (clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width);
    const ny = (clientY - rect.top) / Math.max(1, rect.height);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    const last = lastHealPtRef.current;
    if (last && Math.hypot(nx - last.x, ny - last.y) < healBrushRadius * 0.55) {
      return;
    }
    lastHealPtRef.current = { x: nx, y: ny };
    onAddHealStroke({
      id: `heal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: nx,
      y: ny,
      radius: healBrushRadius,
    });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      isCropping ||
      isWarping ||
      isHealing ||
      activeTool === 'pan' ||
      !containerRef.current ||
      !frame
    ) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / Math.max(1, rect.width);
    const normY = (e.clientY - rect.top) / Math.max(1, rect.height);
    if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return;

    if (activeTool === 'pick-base') {
      onPickBase(normX, normY);
    } else if (activeTool === 'pick-gray') {
      onPickGray(normX, normY);
    }
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isCropping || isWarping || isHealing || activeTool !== 'pan' || zoom <= 1) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(e.dataTransfer.files);
    }
  };

  const showMat =
    !isCropping &&
    !isWarping &&
    Boolean(frame) &&
    frame?.settings.printBorder !== 'none' &&
    viewMode !== 'negative';
  const matPad = showMat ? (stageSize.w < 460 ? 28 : 44) : 0;

  const imgW = activeDisplayData
    ? activeDisplayData.width
    : frame
      ? frame.previewWidth
      : 4;
  const imgH = activeDisplayData
    ? activeDisplayData.height
    : frame
      ? frame.previewHeight
      : 3;
  const fitScale = Math.min(
    Math.max(140, stageSize.w - matPad) / imgW,
    Math.max(140, stageSize.h - matPad) / imgH
  );
  const boxW = Math.max(100, Math.round(imgW * fitScale));
  const boxH = Math.max(100, Math.round(imgH * fitScale));
  const healPxRadius = Math.max(6, Math.round(healBrushRadius * Math.min(boxW, boxH)));

  return (
    <div
      className="w-full h-[54dvh] min-h-[330px] max-h-[540px] lg:h-full lg:max-h-none lg:flex-1 min-w-0 flex flex-col bg-[#0B0B0D] relative overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      {/* Responsive Stage Toolbar */}
      <div className="min-h-10 shrink-0 border-b border-white/[0.06] bg-[#101012] px-3 sm:px-4 py-1.5 md:py-0 md:h-10 flex flex-wrap md:flex-nowrap items-center justify-between gap-2">
        <div className="flex items-center justify-between md:justify-start w-full md:w-auto gap-1 shrink-0">
          <div className="flex items-center gap-0.5 sm:gap-1">
            {(
              [
                { id: 'split', label: 'Split', mobileLabel: 'Split' },
                { id: 'positive', label: 'Positive', mobileLabel: 'Pos' },
                { id: 'negative', label: 'Negative', mobileLabel: 'Neg' },
                { id: 'side-by-side', label: 'Side by Side', mobileLabel: '2×' },
              ] as const
            ).map((mode) => {
              const active = viewMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  disabled={(isCropping || isWarping) && mode.id === 'side-by-side'}
                  onClick={() => onChangeViewMode(mode.id)}
                  className={`px-2 sm:px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                    active
                      ? 'bg-white/[0.09] text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span className="hidden sm:inline">{mode.label}</span>
                  <span className="sm:hidden">{mode.mobileLabel}</span>
                </button>
              );
            })}
          </div>

          <span className="hidden md:inline-block w-px h-3.5 bg-white/[0.08] mx-1.5" aria-hidden="true" />

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo"
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors disabled:opacity-30"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo"
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors disabled:opacity-30"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-0.5 sm:gap-1 flex-wrap">
          <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap">
            <button
              type="button"
              onClick={() =>
                onChangeTool(activeTool === 'pick-base' ? 'pan' : 'pick-base')
              }
              disabled={!frame || isCropping || isWarping}
              title="Sample unexposed film border to calibrate mask (B)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                activeTool === 'pick-base'
                  ? 'bg-[#E59A28]/15 text-[#E59A28]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
              }`}
            >
              <Pipette className="w-3.5 h-3.5" aria-hidden="true" />
              Base
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeTool(activeTool === 'pick-gray' ? 'pan' : 'pick-gray')
              }
              disabled={!frame || viewMode === 'negative' || isCropping || isWarping}
              title="Sample neutral gray on the positive image (G)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                activeTool === 'pick-gray'
                  ? 'bg-[#E59A28]/15 text-[#E59A28]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
              }`}
            >
              <Pipette className="w-3.5 h-3.5" aria-hidden="true" />
              Gray
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeTool(activeTool === 'heal' ? 'pan' : 'heal')
              }
              disabled={!frame || isCropping || isWarping}
              title="Spot heal dust and scratches (H)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                activeTool === 'heal' || (frame?.settings.healStrokes?.length ?? 0) > 0
                  ? activeTool === 'heal'
                    ? 'bg-[#E59A28]/15 text-[#E59A28]'
                    : 'text-zinc-200 hover:bg-white/[0.05]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
              }`}
            >
              <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
              Heal
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeTool(activeTool === 'crop' ? 'pan' : 'crop')
              }
              disabled={!frame || isWarping}
              title="Crop borders & split multi-frame film strips (C)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                isCropping || frame?.settings.crop
                  ? 'bg-[#E59A28]/15 text-[#E59A28]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
              }`}
            >
              <Crop className="w-3.5 h-3.5" aria-hidden="true" />
              Crop
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeTool(activeTool === 'perspective' ? 'pan' : 'perspective')
              }
              disabled={!frame || isCropping}
              title="4-corner perspective straighten for skewed phone captures (P)"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                isWarping || frame?.settings.perspective
                  ? 'bg-[#E59A28]/15 text-[#E59A28]'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
              }`}
            >
              <Scan className="w-3.5 h-3.5" aria-hidden="true" />
              Warp
            </button>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <button
              type="button"
              onClick={onRotate}
              disabled={!frame || isCropping || isWarping}
              title="Rotate 90° clockwise (R)"
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors disabled:opacity-40"
              aria-label="Rotate 90 degrees"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onFlipH}
              disabled={!frame || isCropping || isWarping}
              title="Flip horizontally (F)"
              className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
                frame?.settings.flipH
                  ? 'bg-white/[0.09] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
              }`}
              aria-label="Flip horizontally"
            >
              <FlipHorizontal2 className="w-3.5 h-3.5" />
            </button>

            <span className="w-px h-3.5 bg-white/[0.08] mx-1 hidden sm:inline-block" aria-hidden="true" />

            <button
              type="button"
              onClick={() => {
                const next = Math.max(1, Number((zoom - 0.5).toFixed(1)));
                setZoom(next);
                if (next === 1) setPan({ x: 0, y: 0 });
              }}
              disabled={!frame || zoom <= 1 || isCropping || isWarping}
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors disabled:opacity-30"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              disabled={!frame || isCropping || isWarping}
              className="px-1.5 py-1 rounded text-[11px] font-mono tabular-nums text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </button>

            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.5).toFixed(1))))}
              disabled={!frame || zoom >= 3 || isCropping || isWarping}
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors disabled:opacity-30"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Active Crop & Strip-Split Contextual Bar */}
      {isCropping && frame && (
        <div className="shrink-0 bg-[#171511] border-b border-[#E59A28]/25 px-3.5 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <span className="text-amber-200/90">
            {cropNote ?? 'Drag corners to crop, auto-frame sprockets, or split strips.'}
          </span>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleAutoFrame}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 sm:py-1 rounded bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 transition-colors"
            >
              <Sparkles className="w-3 h-3 text-[#E59A28]" aria-hidden="true" />
              Auto-Frame
            </button>
            <button
              type="button"
              onClick={handleSplitStrip}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 sm:py-1 rounded bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 transition-colors"
            >
              <Scissors className="w-3 h-3 text-[#E59A28]" aria-hidden="true" />
              Split Strip
            </button>
            {frame.settings.crop && (
              <button
                type="button"
                onClick={() => {
                  onUpdateCrop(null);
                  onChangeTool('pan');
                }}
                className="px-2.5 py-1.5 sm:py-1 rounded text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => onChangeTool('pan')}
              className="px-2 py-1.5 sm:py-1 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateCrop(draftCrop);
                onChangeTool('pan');
              }}
              className="px-3 py-1.5 sm:py-1 rounded bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] font-semibold transition-colors"
            >
              Apply Crop
            </button>
          </div>
        </div>
      )}

      {/* Active Perspective Corner Warp Contextual Bar */}
      {isWarping && frame && (
        <div className="shrink-0 bg-[#171511] border-b border-[#E59A28]/25 px-3.5 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <span className="text-amber-200/90">
            Drag the 4 corner pins onto the frame edges to flatten angled captures.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {frame.settings.perspective && (
              <button
                type="button"
                onClick={() => {
                  onUpdatePerspective(null);
                  onChangeTool('pan');
                }}
                className="px-2.5 py-1.5 sm:py-1 rounded text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => onChangeTool('pan')}
              className="px-2 py-1.5 sm:py-1 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdatePerspective(draftQuad);
                onChangeTool('pan');
              }}
              className="px-3 py-1.5 sm:py-1 rounded bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] font-semibold transition-colors"
            >
              Apply Warp
            </button>
          </div>
        </div>
      )}

      {/* Active Spot Heal Contextual Bar */}
      {isHealing && frame && (
        <div className="shrink-0 bg-[#171511] border-b border-[#E59A28]/25 px-3.5 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-amber-200/90">
            Tap or drag over dust spots ({frame.settings.healStrokes?.length ?? 0}).
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-2 text-zinc-300">
              <span>Size</span>
              <input
                type="range"
                min={0.008}
                max={0.055}
                step={0.002}
                value={healBrushRadius}
                onChange={(e) => setHealBrushRadius(Number(e.target.value))}
                className="darkroom-slider w-20"
                aria-label="Heal brush size"
              />
            </label>
            {(frame.settings.healStrokes?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={onClearHealStrokes}
                className="px-2 py-1 rounded text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => onChangeTool('pan')}
              className="px-3 py-1.5 sm:py-1 rounded bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Active Eyedropper Instruction Strip */}
      {(activeTool === 'pick-base' || activeTool === 'pick-gray') && frame && (
        <div className="shrink-0 bg-[#171511] border-b border-[#E59A28]/25 px-3.5 sm:px-5 py-1.5 flex items-center justify-between gap-4 text-xs">
          <span className="text-amber-200/90">
            {activeTool === 'pick-base'
              ? 'Tap an unexposed orange border or deepest shadow on the negative.'
              : 'Tap a neutral gray or white surface on the positive image.'}
          </span>
          <button
            type="button"
            onClick={() => onChangeTool('pan')}
            className="text-zinc-400 hover:text-zinc-100 underline underline-offset-2 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main Light-Table Canvas Area */}
      <div
        ref={stageRef}
        className={`flex-1 min-h-0 darkroom-stage-bg relative flex items-center justify-center p-3 md:p-9 overflow-hidden select-none ${
          isHealing
            ? 'touch-none md:cursor-none'
            : activeTool === 'pick-base' || activeTool === 'pick-gray'
              ? 'cursor-crosshair'
              : zoom > 1 && !isCropping && !isWarping
                ? isPanning
                  ? 'touch-none cursor-grabbing'
                  : 'touch-none cursor-grab'
                : 'cursor-default'
        }`}
        onPointerDown={handleStagePointerDown}
      >
        {isLoadingSamples ? (
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <div className="w-7 h-7 rounded-full border-2 border-zinc-800 border-t-[#E59A28] animate-spin" />
            <p className="text-xs text-zinc-400">Loading sample negatives...</p>
          </div>
        ) : !frame ? (
          <div className="max-w-sm w-full rounded-xl border border-dashed border-white/15 bg-[#121215] p-6 sm:p-8 text-center space-y-4">
            <div className="space-y-1.5">
              <h2
                className="text-base font-semibold text-zinc-100"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Drop film negatives here
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Supports scanned C-41 color negatives, black-and-white film, or
                backlit phone captures.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById('halide-file-input');
                  input?.click();
                }}
                className="px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Choose Files
              </button>
              <button
                type="button"
                onClick={onReloadSamples}
                className="px-4 py-2 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs font-medium transition-colors whitespace-nowrap"
              >
                Sample Roll
              </button>
            </div>
          </div>
        ) : viewMode === 'side-by-side' && !isCropping && !isWarping ? (
          <div
            className="w-full h-full grid grid-cols-2 gap-3 md:gap-6 items-center justify-items-center"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: isPanning
                ? 'none'
                : 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div className="relative max-w-full max-h-full flex flex-col items-center gap-1.5">
              <div className="shadow-2xl bg-black overflow-hidden">
                <canvas
                  ref={sideNegCanvasRef}
                  className="max-h-[34dvh] lg:max-h-[calc(100vh-270px)] max-w-full w-auto h-auto block"
                />
              </div>
              <span className="text-[11px] text-zinc-500">Negative</span>
            </div>

            <div className="relative max-w-full max-h-full flex flex-col items-center gap-1.5">
              <div
                className={`shadow-2xl overflow-hidden transition-colors ${
                  frame.settings.printBorder === 'white'
                    ? 'p-2 md:p-3.5 bg-[#F6F5F0]'
                    : frame.settings.printBorder === 'black'
                      ? 'p-2 md:p-3.5 bg-[#050506] ring-1 ring-white/10'
                      : 'bg-black'
                }`}
              >
                <canvas
                  ref={sidePosCanvasRef}
                  className="max-h-[34dvh] lg:max-h-[calc(100vh-290px)] max-w-full w-auto h-auto block"
                />
              </div>
              <span className="text-[11px] text-zinc-400">Positive</span>
            </div>
          </div>
        ) : (
          <div
            className={`shrink-0 transition-[padding,background-color] duration-150 ${
              showMat
                ? frame.settings.printBorder === 'white'
                  ? 'p-3 sm:p-5 bg-[#F6F5F0] shadow-[0_24px_60px_rgba(0,0,0,0.72)]'
                  : 'p-3 sm:p-5 bg-[#050506] ring-1 ring-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.8)]'
                : ''
            }`}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: isPanning
                ? 'none'
                : 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div
              ref={containerRef}
              onClick={handleCanvasClick}
              onPointerDown={(e) => {
                if (!isHealing || (e.button !== 0 && e.pointerType === 'mouse')) return;
                e.stopPropagation();
                onBeginHealStroke();
                setIsPaintingHeal(true);
                lastHealPtRef.current = null;
                emitHealAtClient(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (!isHealing || !containerRef.current) return;
                if (e.pointerType === 'mouse') {
                  const rect = containerRef.current.getBoundingClientRect();
                  setHealHover({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }
                if (isPaintingHeal) {
                  emitHealAtClient(e.clientX, e.clientY);
                }
              }}
              onPointerLeave={() => setHealHover(null)}
              className={`relative bg-black overflow-hidden shrink-0 group ${
                isHealing || isCropping || isWarping ? 'touch-none' : ''
              } ${showMat ? '' : 'shadow-[0_24px_60px_rgba(0,0,0,0.65)]'}`}
              style={{
                width: `${boxW}px`,
                height: `${boxH}px`,
              }}
            >
              <canvas
                ref={posCanvasRef}
                className={`w-full h-full block object-contain ${
                  viewMode === 'negative' ? 'hidden' : 'block'
                }`}
              />

              <canvas
                ref={negCanvasRef}
                className={`w-full h-full block object-contain ${
                  viewMode === 'positive'
                    ? 'hidden'
                    : viewMode === 'split'
                      ? 'absolute inset-0'
                      : 'block'
                }`}
                style={
                  viewMode === 'split'
                    ? { clipPath: `inset(0 ${100 - wipePct}% 0 0)` }
                    : undefined
                }
              />

              {viewMode === 'split' && !isCropping && !isWarping && (
                <>
                  <div
                    className="absolute top-0 bottom-0 z-10 pointer-events-none"
                    style={{ left: `${wipePct}%` }}
                  >
                    <div className="w-px h-full bg-white/80 shadow-[0_0_6px_rgba(0,0,0,0.8)]" />
                  </div>

                  <button
                    type="button"
                    aria-label="Drag comparison divider"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setIsDraggingWipe(true);
                    }}
                    className="touch-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 w-9 h-9 md:w-7 md:h-7 rounded-full bg-[#121214]/90 border border-white/75 text-white shadow-md flex items-center justify-center hover:border-[#E59A28] hover:text-[#E59A28] transition-colors cursor-ew-resize"
                    style={{ left: `${wipePct}%` }}
                  >
                    <MoveHorizontal className="w-4 h-4 md:w-3.5 md:h-3.5" aria-hidden="true" />
                  </button>
                </>
              )}

              {/* Heal Brush Ring Cursor */}
              {isHealing && healHover && (
                <div
                  className="absolute z-30 rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.7)] pointer-events-none"
                  style={{
                    left: `${healHover.x - healPxRadius}px`,
                    top: `${healHover.y - healPxRadius}px`,
                    width: `${healPxRadius * 2}px`,
                    height: `${healPxRadius * 2}px`,
                  }}
                />
              )}

              {/* Interactive Crop Box Overlay */}
              {isCropping && (
                <div className="absolute inset-0 z-30 touch-none">
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setCropDrag({
                        handle: 'move',
                        startX: e.clientX,
                        startY: e.clientY,
                        startCrop: draftCrop,
                      });
                    }}
                    className="touch-none absolute border border-[#E59A28] cursor-move"
                    style={{
                      left: `${draftCrop.x * 100}%`,
                      top: `${draftCrop.y * 100}%`,
                      width: `${draftCrop.w * 100}%`,
                      height: `${draftCrop.h * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.62)',
                    }}
                  >
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                      <div className="border-r border-b border-white/15" />
                      <div className="border-r border-b border-white/15" />
                      <div className="border-b border-white/15" />
                      <div className="border-r border-b border-white/15" />
                      <div className="border-r border-b border-white/15" />
                      <div className="border-b border-white/15" />
                      <div className="border-r border-white/15" />
                      <div className="border-r border-white/15" />
                      <div />
                    </div>

                    {(
                      [
                        { id: 'nw', cls: '-top-2.5 -left-2.5 md:-top-1.5 md:-left-1.5 cursor-nwse-resize' },
                        { id: 'ne', cls: '-top-2.5 -right-2.5 md:-top-1.5 md:-right-1.5 cursor-nesw-resize' },
                        { id: 'sw', cls: '-bottom-2.5 -left-2.5 md:-bottom-1.5 md:-left-1.5 cursor-nesw-resize' },
                        { id: 'se', cls: '-bottom-2.5 -right-2.5 md:-bottom-1.5 md:-right-1.5 cursor-nwse-resize' },
                      ] as const
                    ).map((corner) => (
                      <button
                        key={corner.id}
                        type="button"
                        aria-label={`Resize ${corner.id} corner`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setCropDrag({
                            handle: corner.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            startCrop: draftCrop,
                          });
                        }}
                        className={`touch-none absolute w-5 h-5 md:w-3.5 md:h-3.5 rounded-sm bg-[#E59A28] border border-[#0E0E10] shadow ${corner.cls}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive 4-Corner Perspective Quad Overlay */}
              {isWarping && (
                <div className="absolute inset-0 z-30 touch-none">
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  >
                    <polygon
                      points={`${draftQuad.tl.x * 100},${draftQuad.tl.y * 100} ${draftQuad.tr.x * 100},${draftQuad.tr.y * 100} ${draftQuad.br.x * 100},${draftQuad.br.y * 100} ${draftQuad.bl.x * 100},${draftQuad.bl.y * 100}`}
                      fill="rgba(229, 154, 40, 0.08)"
                      stroke="#E59A28"
                      strokeWidth="0.6"
                    />
                  </svg>

                  {(
                    [
                      { key: 'tl', label: 'Top left corner' },
                      { key: 'tr', label: 'Top right corner' },
                      { key: 'br', label: 'Bottom right corner' },
                      { key: 'bl', label: 'Bottom left corner' },
                    ] as const
                  ).map((corner) => {
                    const pt = draftQuad[corner.key];
                    return (
                      <button
                        key={corner.key}
                        type="button"
                        aria-label={corner.label}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setQuadDragCorner(corner.key);
                        }}
                        className="touch-none absolute w-6 h-6 -ml-3 -mt-3 md:w-4 md:h-4 md:-ml-2 md:-mt-2 rounded-full bg-[#E59A28] border-2 border-[#0E0E10] shadow cursor-grab active:cursor-grabbing"
                        style={{
                          left: `${pt.x * 100}%`,
                          top: `${pt.y * 100}%`,
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {isDragOver && (
          <div className="absolute inset-4 z-30 rounded-xl border-2 border-dashed border-[#E59A28] bg-[#0B0B0D]/90 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Upload className="w-7 h-7 text-[#E59A28]" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-100">
              Drop negatives to open
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
