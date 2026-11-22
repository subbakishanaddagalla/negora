import { useEffect, useRef, useState } from 'react';
import type { NegativeFrame } from '../types/darkroom';
import {
  createOrientedImageData,
  processNegativeImageData,
} from '../lib/negativeProcessor';
import { Archive, Download, RotateCcw, SlidersHorizontal, Upload } from 'lucide-react';

interface ContactSheetViewProps {
  frames: NegativeFrame[];
  onOpenInDarkroom: (frameId: string) => void;
  onExportFrame: (frame: NegativeFrame, format: 'image/png' | 'image/jpeg') => Promise<void>;
  onExportZip: (format: 'image/png' | 'image/jpeg') => Promise<void>;
  onResetRoll: () => void;
  onImportClick: () => void;
  isBatchExporting: boolean;
  zipProgress: { completed: number; total: number } | null;
}

function ContactProofCard({
  frame,
  index,
  showRawNegative,
  onOpen,
  onDownload,
}: {
  frame: NegativeFrame;
  index: number;
  showRawNegative: boolean;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxDim = 560;
    const scale = Math.min(
      1,
      maxDim / Math.max(frame.previewWidth, frame.previewHeight)
    );
    const pw = Math.max(1, Math.round(frame.previewWidth * scale));
    const ph = Math.max(1, Math.round(frame.previewHeight * scale));

    const srcTmp = document.createElement('canvas');
    srcTmp.width = frame.previewWidth;
    srcTmp.height = frame.previewHeight;
    const srcCtx = srcTmp.getContext('2d');
    if (!srcCtx) return;
    srcCtx.putImageData(frame.previewSourceData, 0, 0);

    const scaled = document.createElement('canvas');
    scaled.width = pw;
    scaled.height = ph;
    const scaledCtx = scaled.getContext('2d');
    if (!scaledCtx) return;
    scaledCtx.drawImage(srcTmp, 0, 0, pw, ph);

    const rawSmall = scaledCtx.getImageData(0, 0, pw, ph);
    const output = showRawNegative
      ? createOrientedImageData(
          rawSmall,
          frame.settings.rotate,
          frame.settings.flipH,
          frame.settings.perspective,
          frame.settings.crop
        )
      : processNegativeImageData(rawSmall, frame.settings).imageData;

    canvas.width = output.width;
    canvas.height = output.height;
    const outCtx = canvas.getContext('2d');
    if (outCtx) outCtx.putImageData(output, 0, 0);
  }, [frame, frame.settings, showRawNegative]);

  const frameNumber = `${String(index + 1).padStart(2, '0')}A`;
  const borderStyle = !showRawNegative ? frame.settings.printBorder : 'none';

  return (
    <div className="rounded-lg border border-white/[0.06] bg-[#121214] overflow-hidden flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[4/3] w-full bg-[#0B0B0D] flex items-center justify-center p-4 overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28]"
      >
        <div
          className={`max-w-full max-h-full flex items-center justify-center transition-transform duration-200 group-hover:scale-[1.02] ${
            borderStyle === 'white'
              ? 'p-2 bg-[#F6F5F0] shadow-lg'
              : borderStyle === 'black'
                ? 'p-2 bg-[#050506] ring-1 ring-white/10 shadow-lg'
                : 'shadow-lg'
          }`}
        >
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-[210px] w-auto h-auto object-contain block"
          />
        </div>
      </button>

      <div className="px-4 py-3 border-t border-white/[0.06] flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono tabular-nums text-xs text-[#E59A28]">
              {frameNumber}
            </span>
            <h3 className="text-sm font-medium text-zinc-100 truncate">
              {frame.name}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-mono tabular-nums">
            <span>{frame.width} × {frame.height}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{frame.filmStockLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpen}
            title="Edit in Darkroom"
            className="p-2 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
            aria-label={`Edit ${frame.name}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDownload}
            title="Download full-resolution PNG"
            className="p-2 rounded text-zinc-400 hover:text-[#E59A28] hover:bg-white/[0.06] transition-colors"
            aria-label={`Download ${frame.name}`}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContactSheetView({
  frames,
  onOpenInDarkroom,
  onExportFrame,
  onExportZip,
  onResetRoll,
  onImportClick,
  isBatchExporting,
  zipProgress,
}: ContactSheetViewProps) {
  const [showRawNegative, setShowRawNegative] = useState(false);
  const [zipFormat, setZipFormat] = useState<'image/png' | 'image/jpeg'>('image/png');

  return (
    <main className="flex-1 overflow-y-auto darkroom-scroll bg-[#0E0E10]">
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Header Row */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/[0.06] pb-6">
          <div className="space-y-1.5">
            <h1
              className="text-2xl font-bold tracking-tight text-zinc-100"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Contact Sheet
            </h1>
            <p className="text-sm text-zinc-400">
              Review all frames in your roll or download a full-resolution ZIP archive.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 p-0.5 rounded-md bg-[#121214] border border-white/[0.06]">
              <button
                type="button"
                onClick={() => setShowRawNegative(false)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  !showRawNegative
                    ? 'bg-white/[0.09] text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Positives
              </button>
              <button
                type="button"
                onClick={() => setShowRawNegative(true)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  showRawNegative
                    ? 'bg-white/[0.09] text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Raw Negatives
              </button>
            </div>

            {frames.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#121214] border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setZipFormat('image/png')}
                    className={`px-2 py-1.5 rounded text-[11px] font-mono transition-colors ${
                      zipFormat === 'image/png'
                        ? 'bg-white/[0.09] text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => setZipFormat('image/jpeg')}
                    className={`px-2 py-1.5 rounded text-[11px] font-mono transition-colors ${
                      zipFormat === 'image/jpeg'
                        ? 'bg-white/[0.09] text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    JPG
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isBatchExporting}
                  onClick={() => onExportZip(zipFormat)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                  {isBatchExporting && zipProgress
                    ? `Zipping ${zipProgress.completed}/${zipProgress.total}...`
                    : `Export ZIP (${frames.length})`}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onResetRoll}
              title="Reset workspace back to default sample negatives"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 text-xs transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset Roll
            </button>
          </div>
        </div>

        {/* Grid or Empty State */}
        {frames.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-[#141416] p-12 text-center space-y-4">
            <p className="text-sm text-zinc-400">
              No film frames are currently loaded in this roll.
            </p>
            <button
              type="button"
              onClick={onImportClick}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Import Negatives
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {frames.map((frame, index) => (
              <ContactProofCard
                key={frame.id}
                frame={frame}
                index={index}
                showRawNegative={showRawNegative}
                onOpen={() => onOpenInDarkroom(frame.id)}
                onDownload={() => onExportFrame(frame, 'image/png')}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
