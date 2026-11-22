import { useEffect, useRef } from 'react';
import type { NegativeFrame } from '../types/darkroom';
import { processNegativeImageData } from '../lib/negativeProcessor';
import { Plus, X } from 'lucide-react';

interface FilmstripBarProps {
  frames: NegativeFrame[];
  activeFrameId: string | null;
  onSelectFrame: (id: string) => void;
  onRemoveFrame: (id: string) => void;
  onImportClick: () => void;
}

function FilmstripThumb({
  frame,
  index,
  isActive,
  onSelect,
  onRemove,
}: {
  frame: NegativeFrame;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxThumb = 140;
    const scale = Math.min(
      1,
      maxThumb / Math.max(frame.previewWidth, frame.previewHeight)
    );
    const tw = Math.max(1, Math.round(frame.previewWidth * scale));
    const th = Math.max(1, Math.round(frame.previewHeight * scale));

    const tmp = document.createElement('canvas');
    tmp.width = frame.previewWidth;
    tmp.height = frame.previewHeight;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return;
    tmpCtx.putImageData(frame.previewSourceData, 0, 0);

    const small = document.createElement('canvas');
    small.width = tw;
    small.height = th;
    const smallCtx = small.getContext('2d');
    if (!smallCtx) return;
    smallCtx.drawImage(tmp, 0, 0, tw, th);

    const thumbRaw = smallCtx.getImageData(0, 0, tw, th);
    const { imageData } = processNegativeImageData(thumbRaw, frame.settings);

    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const outCtx = canvas.getContext('2d');
    if (outCtx) outCtx.putImageData(imageData, 0, 0);
  }, [frame, frame.settings]);

  const frameNumber = `${String(index + 1).padStart(2, '0')}A`;

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={onSelect}
        title={`${frameNumber} · ${frame.name}`}
        className={`relative h-[58px] w-[84px] rounded overflow-hidden transition-all bg-black flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28] ${
          isActive
            ? 'ring-2 ring-[#E59A28]'
            : 'opacity-70 hover:opacity-100 ring-1 ring-white/10'
        }`}
      >
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full w-auto h-auto object-contain block"
        />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title={`Remove ${frame.name}`}
        aria-label={`Remove ${frame.name}`}
        className="opacity-85 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 absolute -top-1.5 -right-1.5 w-5 h-5 md:w-4 md:h-4 rounded-full bg-zinc-900 border border-white/25 text-zinc-200 hover:text-white flex items-center justify-center transition-opacity"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

export function FilmstripBar({
  frames,
  activeFrameId,
  onSelectFrame,
  onRemoveFrame,
  onImportClick,
}: FilmstripBarProps) {
  return (
    <div className="h-[78px] sm:h-[82px] shrink-0 border-y lg:border-b-0 lg:border-t border-white/[0.06] bg-[#101012] px-3.5 sm:px-5 flex items-center gap-2.5 overflow-x-auto darkroom-scroll">
      {frames.map((frame, index) => (
        <FilmstripThumb
          key={frame.id}
          frame={frame}
          index={index}
          isActive={frame.id === activeFrameId}
          onSelect={() => onSelectFrame(frame.id)}
          onRemove={() => onRemoveFrame(frame.id)}
        />
      ))}

      <button
        type="button"
        onClick={onImportClick}
        title="Add negative files"
        aria-label="Add negative files"
        className="shrink-0 h-[58px] w-[64px] rounded border border-dashed border-white/15 hover:border-[#E59A28]/70 text-zinc-500 hover:text-zinc-200 flex items-center justify-center transition-colors"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
