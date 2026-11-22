import { useMemo } from 'react';
import type { HistogramData } from '../types/darkroom';

interface HistogramPanelProps {
  histogram: HistogramData | null;
}

function buildAreaPath(
  bins: Uint32Array,
  maxVal: number,
  width: number,
  height: number
): string {
  const step = 4;
  const points: string[] = [`M 0 ${height}`];

  for (let i = 0; i < 256; i += step) {
    let sum = 0;
    for (let k = 0; k < step; k++) {
      sum += bins[i + k];
    }
    const avg = sum / step;
    const x = (i / (256 - step)) * width;
    const norm = Math.min(1, Math.pow(avg / Math.max(1, maxVal), 0.65));
    const y = height - norm * (height - 4);
    points.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
  }

  points.push(`L ${width} ${height} Z`);
  return points.join(' ');
}

export function HistogramPanel({ histogram }: HistogramPanelProps) {
  const paths = useMemo(() => {
    if (!histogram) return null;
    const w = 280;
    const h = 58;
    return {
      r: buildAreaPath(histogram.r, histogram.maxCount, w, h),
      g: buildAreaPath(histogram.g, histogram.maxCount, w, h),
      b: buildAreaPath(histogram.b, histogram.maxCount, w, h),
      luma: buildAreaPath(histogram.luma, histogram.maxCount, w, h),
    };
  }, [histogram]);

  return (
    <div className="relative h-[58px] w-full rounded-md bg-[#0B0B0D] overflow-hidden">
      {paths ? (
        <svg
          viewBox="0 0 280 58"
          preserveAspectRatio="none"
          className="w-full h-full block"
          aria-label="RGB and luminance histogram"
        >
          <path d={paths.r} fill="rgba(239, 68, 68, 0.24)" />
          <path d={paths.g} fill="rgba(34, 197, 94, 0.22)" />
          <path d={paths.b} fill="rgba(59, 130, 246, 0.26)" />
          <path
            d={paths.luma}
            fill="rgba(244, 244, 245, 0.12)"
            stroke="rgba(244, 244, 245, 0.45)"
            strokeWidth="1"
          />
        </svg>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-zinc-600">
          No active frame
        </div>
      )}
    </div>
  );
}
