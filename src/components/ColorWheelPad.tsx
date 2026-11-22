import { useRef, useState } from 'react';
import type { Point2D, SplitToneOffsets } from '../types/darkroom';

interface ColorWheelPadProps {
  splitTone: SplitToneOffsets;
  onBeginEdit?: () => void;
  onChange: (splitTone: SplitToneOffsets) => void;
}

type ToneBand = 'shadows' | 'midtones' | 'highlights';

const BAND_LABELS: { id: ToneBand; label: string }[] = [
  { id: 'shadows', label: 'Shadows' },
  { id: 'midtones', label: 'Midtones' },
  { id: 'highlights', label: 'Highlights' },
];

export function ColorWheelPad({
  splitTone,
  onBeginEdit,
  onChange,
}: ColorWheelPadProps) {
  const [band, setBand] = useState<ToneBand>('shadows');
  const [dragging, setDragging] = useState(false);
  const wheelRef = useRef<HTMLDivElement | null>(null);

  const currentPt = splitTone[band] ?? { x: 0, y: 0 };

  const updatePointFromClient = (clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const radius = rect.width / 2;
    let nx = (clientX - (rect.left + radius)) / Math.max(1, radius);
    let ny = -(clientY - (rect.top + radius)) / Math.max(1, radius);

    const mag = Math.hypot(nx, ny);
    if (mag > 1) {
      nx /= mag;
      ny /= mag;
    }

    onChange({
      ...splitTone,
      [band]: {
        x: Math.round(nx * 100) / 100,
        y: Math.round(ny * 100) / 100,
      },
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    onBeginEdit?.();
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePointFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    updatePointFromClient(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const handleReset = () => {
    onBeginEdit?.();
    onChange({
      ...splitTone,
      [band]: { x: 0, y: 0 },
    });
  };

  const isZero = (pt: Point2D) => Math.abs(pt.x) < 0.02 && Math.abs(pt.y) < 0.02;

  const puckLeftPct = 50 + currentPt.x * 46;
  const puckTopPct = 50 - currentPt.y * 46;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-0.5 rounded bg-[#0B0B0D]">
          {BAND_LABELS.map((item) => {
            const active = band === item.id;
            const modified = !isZero(splitTone[item.id] ?? { x: 0, y: 0 });
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setBand(item.id)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.1] text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {item.label}
                {modified && (
                  <span className="inline-block w-1 h-1 rounded-full bg-[#E59A28] ml-1 align-middle" />
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleReset}
          disabled={isZero(currentPt)}
          className="text-[11px] text-zinc-500 hover:text-[#E59A28] transition-colors disabled:opacity-35"
        >
          Reset
        </button>
      </div>

      <div className="flex items-center justify-center py-1">
        <div
          ref={wheelRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleReset}
          role="slider"
          aria-label={`${band} color balance wheel`}
          aria-valuetext={`${Math.round(currentPt.x * 100)}, ${Math.round(currentPt.y * 100)}`}
          className="relative w-40 h-40 sm:w-36 sm:h-36 rounded-full border border-white/[0.12] touch-none select-none cursor-crosshair overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at center, rgba(22,22,26,0.96) 0%, rgba(22,22,26,0.35) 55%, rgba(22,22,26,0.05) 100%), conic-gradient(from 90deg, #E56A5A 0deg, #E5C158 55deg, #68C478 125deg, #54B5D4 195deg, #6C7CE6 260deg, #C86DD7 315deg, #E56A5A 360deg)',
          }}
        >
          {/* Subtle Center Crosshair */}
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/10 pointer-events-none" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/10 pointer-events-none" />

          {/* Line from origin to puck */}
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <line
              x1="50"
              y1="50"
              x2={puckLeftPct}
              y2={puckTopPct}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="1"
            />
          </svg>

          {/* Draggable Puck */}
          <div
            className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-[#101012] shadow pointer-events-none"
            style={{
              left: `${puckLeftPct}%`,
              top: `${puckTopPct}%`,
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-zinc-500 px-1">
        <span>X {currentPt.x >= 0 ? '+' : ''}{Math.round(currentPt.x * 100)}</span>
        <span>Y {currentPt.y >= 0 ? '+' : ''}{Math.round(currentPt.y * 100)}</span>
      </div>
    </div>
  );
}
