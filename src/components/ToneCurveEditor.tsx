import { useMemo, useRef, useState } from 'react';
import type { Point2D, ToneCurves } from '../types/darkroom';
import { buildCurveLut, createDefaultCurves } from '../lib/negativeProcessor';

interface ToneCurveEditorProps {
  curves: ToneCurves;
  isBW: boolean;
  onBeginEdit?: () => void;
  onChange: (curves: ToneCurves) => void;
}

type CurveChannel = 'master' | 'r' | 'g' | 'b';

const CHANNEL_META: Record<
  CurveChannel,
  { label: string; stroke: string; dot: string }
> = {
  master: { label: 'RGB', stroke: '#E4E4E7', dot: '#E59A28' },
  r: { label: 'R', stroke: '#F87171', dot: '#F87171' },
  g: { label: 'G', stroke: '#4ADE80', dot: '#4ADE80' },
  b: { label: 'B', stroke: '#60A5FA', dot: '#60A5FA' },
};

function isDefaultCurve(pts: Point2D[]): boolean {
  return (
    pts.length === 2 &&
    pts[0].x === 0 &&
    pts[0].y === 0 &&
    pts[1].x === 1 &&
    pts[1].y === 1
  );
}

export function ToneCurveEditor({
  curves,
  isBW,
  onBeginEdit,
  onChange,
}: ToneCurveEditorProps) {
  const [channel, setChannel] = useState<CurveChannel>('master');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const activeChannel: CurveChannel = isBW ? 'master' : channel;
  const activePoints = curves[activeChannel] ?? [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];

  const pathData = useMemo(() => {
    const lut = buildCurveLut(activePoints);
    const cmds: string[] = [];
    for (let i = 0; i < 256; i += 3) {
      const px = (i / 255) * 180;
      const py = (1 - lut[i]) * 180;
      cmds.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`);
    }
    cmds.push(`L 180 ${((1 - lut[255]) * 180).toFixed(1)}`);
    return cmds.join(' ');
  }, [activePoints]);

  const getNormalizedCoords = (clientX: number, clientY: number): Point2D => {
    const svg = svgRef.current;
    if (!svg) return { x: 0.5, y: 0.5 };
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / Math.max(1, rect.height)));
    return { x, y };
  };

  const updateChannelPoints = (nextPoints: Point2D[]) => {
    onChange({
      ...curves,
      [activeChannel]: nextPoints,
    });
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pt = getNormalizedCoords(e.clientX, e.clientY);

    const hitIdx = activePoints.findIndex(
      (p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 0.095
    );

    onBeginEdit?.();

    if (hitIdx !== -1) {
      setDragIndex(hitIdx);
      setSelectedIndex(hitIdx);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }

    const tooClose = activePoints.some((p) => Math.abs(p.x - pt.x) < 0.045);
    if (tooClose) return;

    const next = [...activePoints, pt].sort((a, b) => a.x - b.x);
    const newIdx = next.findIndex((p) => p === pt);
    updateChannelPoints(next);
    setDragIndex(newIdx);
    setSelectedIndex(newIdx);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragIndex === null) return;
    const pt = getNormalizedCoords(e.clientX, e.clientY);
    const next = activePoints.map((p) => ({ ...p }));
    const target = next[dragIndex];
    if (!target) return;

    if (dragIndex === 0) {
      target.x = 0;
      target.y = pt.y;
    } else if (dragIndex === next.length - 1) {
      target.x = 1;
      target.y = pt.y;
    } else {
      const minX = next[dragIndex - 1].x + 0.03;
      const maxX = next[dragIndex + 1].x - 0.03;
      target.x = Math.max(minX, Math.min(maxX, pt.x));
      target.y = pt.y;
    }

    updateChannelPoints(next);
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragIndex !== null) {
      setDragIndex(null);
      if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      }
    }
  };

  const removePointAt = (idx: number) => {
    if (idx <= 0 || idx >= activePoints.length - 1) return;
    onBeginEdit?.();
    const next = activePoints.filter((_, i) => i !== idx);
    updateChannelPoints(next);
    setSelectedIndex(null);
  };

  const handlePointDoubleClick = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    removePointAt(idx);
  };

  const handleReset = () => {
    onBeginEdit?.();
    const def = createDefaultCurves();
    onChange({
      ...curves,
      [activeChannel]: def[activeChannel],
    });
    setSelectedIndex(null);
  };

  const channels: CurveChannel[] = isBW ? ['master'] : ['master', 'r', 'g', 'b'];
  const canRemoveSelected =
    selectedIndex !== null &&
    selectedIndex > 0 &&
    selectedIndex < activePoints.length - 1;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-0.5 rounded bg-[#0B0B0D]">
          {channels.map((ch) => {
            const active = activeChannel === ch;
            const modified = !isDefaultCurve(curves[ch] ?? []);
            return (
              <button
                key={ch}
                type="button"
                onClick={() => {
                  setChannel(ch);
                  setSelectedIndex(null);
                }}
                className={`relative px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.1] text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {CHANNEL_META[ch].label}
                {modified && (
                  <span
                    className="inline-block w-1 h-1 rounded-full ml-1 align-middle"
                    style={{ backgroundColor: CHANNEL_META[ch].dot }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5">
          {canRemoveSelected && (
            <button
              type="button"
              onClick={() => removePointAt(selectedIndex)}
              className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
            >
              Remove point
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={isDefaultCurve(activePoints)}
            className="text-[11px] text-zinc-500 hover:text-[#E59A28] transition-colors disabled:opacity-35"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="rounded-md bg-[#0B0B0D] border border-white/[0.06] p-2">
        <svg
          ref={svgRef}
          viewBox="0 0 180 180"
          className="w-full max-w-[260px] mx-auto aspect-square block touch-none select-none cursor-crosshair"
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerUp}
        >
          {/* 4x4 Tone Grid */}
          {[45, 90, 135].map((pos) => (
            <g key={pos}>
              <line
                x1={pos}
                y1={0}
                x2={pos}
                y2={180}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
              <line
                x1={0}
                y1={pos}
                x2={180}
                y2={pos}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
            </g>
          ))}

          {/* Linear diagonal reference */}
          <line
            x1={0}
            y1={180}
            x2={180}
            y2={0}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {/* Spline Curve */}
          <path
            d={pathData}
            fill="none"
            stroke={CHANNEL_META[activeChannel].stroke}
            strokeWidth="1.75"
            strokeLinecap="round"
          />

          {/* Control Points */}
          {activePoints.map((pt, idx) => {
            const cx = pt.x * 180;
            const cy = (1 - pt.y) * 180;
            const isDragging = dragIndex === idx;
            const isSelected = selectedIndex === idx;
            return (
              <circle
                key={`${idx}-${activePoints.length}`}
                cx={cx}
                cy={cy}
                r={isDragging || isSelected ? 6 : 4.8}
                fill="#0B0B0D"
                stroke={CHANNEL_META[activeChannel].dot}
                strokeWidth="2"
                className="cursor-grab active:cursor-grabbing"
                onDoubleClick={(e) => handlePointDoubleClick(e, idx)}
              />
            );
          })}
        </svg>
      </div>

      <p className="text-[11px] text-zinc-500">
        Tap to add · Drag to shape · Select &amp; tap Remove point
      </p>
    </div>
  );
}
