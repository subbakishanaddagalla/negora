import { useState } from 'react';
import type {
  ActiveTool,
  FilmProfileId,
  GradingSettings,
  HistogramData,
  NegativeFrame,
  PrintBorderStyle,
} from '../types/darkroom';
import {
  createDefaultCurves,
  createDefaultSplitTone,
} from '../lib/negativeProcessor';
import { HistogramPanel } from './HistogramPanel';
import { ToneCurveEditor } from './ToneCurveEditor';
import { ColorWheelPad } from './ColorWheelPad';
import {
  ChevronDown,
  Copy,
  Download,
  Pipette,
  RotateCcw,
  Wand2,
} from 'lucide-react';

interface InspectorPanelProps {
  frame: NegativeFrame | null;
  histogram: HistogramData | null;
  activeTool: ActiveTool;
  onChangeTool: (tool: ActiveTool) => void;
  onBeginEdit: () => void;
  onUpdateSettings: (patch: Partial<GradingSettings>, recordHistory?: boolean) => void;
  onAutoCalibrate: () => void;
  onResetFrame: () => void;
  onSyncToRoll: () => void;
  onExport: (format: 'image/png' | 'image/jpeg') => Promise<void>;
  isExporting: boolean;
  frameCount: number;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  formatValue?: (v: number) => string;
  onBeginEdit: () => void;
  onChange: (value: number, recordHistory?: boolean) => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  formatValue,
  onBeginEdit,
  onChange,
}: SliderRowProps) {
  const display = formatValue
    ? formatValue(value)
    : value > 0 && min < 0
      ? `+${value}`
      : `${value}`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <label className="text-zinc-300 select-none">{label}</label>
        <button
          type="button"
          onClick={() => onChange(defaultValue, true)}
          title="Reset value"
          className="font-mono tabular-nums text-[11px] text-zinc-500 hover:text-[#E59A28] transition-colors"
        >
          {display}
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onBeginEdit}
        onChange={(e) => onChange(Number(e.target.value), false)}
        onDoubleClick={() => onChange(defaultValue, true)}
        className="darkroom-slider"
        aria-label={label}
      />
    </div>
  );
}

function AccordionGroup({
  title,
  defaultOpen = false,
  trailing,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="pt-3.5 border-t border-white/[0.06]">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 hover:text-white transition-colors py-0.5"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-150 ${
              open ? 'rotate-0' : '-rotate-90'
            }`}
            aria-hidden="true"
          />
          <span>{title}</span>
        </button>
        {trailing}
      </div>

      {open && <div className="pt-3 space-y-3">{children}</div>}
    </div>
  );
}

export function InspectorPanel({
  frame,
  histogram,
  activeTool,
  onChangeTool,
  onBeginEdit,
  onUpdateSettings,
  onAutoCalibrate,
  onResetFrame,
  onSyncToRoll,
  onExport,
  isExporting,
  frameCount,
}: InspectorPanelProps) {
  const [syncNotice, setSyncNotice] = useState(false);

  if (!frame) {
    return (
      <aside className="w-full lg:w-[312px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/[0.06] bg-[#121214] p-5">
        <div className="space-y-4">
          <HistogramPanel histogram={null} />
          <p className="text-xs text-zinc-500 leading-relaxed">
            Import a scanned negative or load the sample roll to begin.
          </p>
        </div>
      </aside>
    );
  }

  const s = frame.settings;
  const isColor =
    s.profile === 'c41-standard' ||
    s.profile === 'kodak-warm' ||
    s.profile === 'fuji-cool';
  const isBW = s.profile === 'bw-silver' || s.profile === 'bw-selenium';
  const isRestore = s.profile === 'positive-restore';

  const baseRgbCss = `rgb(${s.baseColor.r}, ${s.baseColor.g}, ${s.baseColor.b})`;
  const curves = s.curves ?? createDefaultCurves();
  const splitTone = s.splitTone ?? createDefaultSplitTone();
  const printBorder: PrintBorderStyle = s.printBorder ?? 'none';

  const handleSync = () => {
    onSyncToRoll();
    setSyncNotice(true);
    window.setTimeout(() => setSyncNotice(false), 1800);
  };

  return (
    <aside className="w-full lg:w-[312px] lg:flex-1 lg:h-full shrink-0 border-t lg:border-t-0 lg:border-l border-white/[0.06] bg-[#121214] flex flex-col min-h-0">
      <div className="flex-1 lg:overflow-y-auto darkroom-scroll px-4 sm:px-5 py-4 space-y-4">
        {/* Clean Frame Title & Histogram */}
        <div className="space-y-3">
          <div className="space-y-0.5">
            <h1 className="text-sm font-semibold text-zinc-100 truncate">
              {frame.name}
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono tabular-nums">
              <span>{frame.width} × {frame.height}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{frame.filmStockLabel}</span>
            </div>
          </div>

          <HistogramPanel histogram={histogram} />
        </div>

        {/* Film Mode Selector */}
        <div className="pt-3.5 border-t border-white/[0.06] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Film Type</span>
            <button
              type="button"
              onClick={onAutoCalibrate}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E59A28] hover:text-amber-300 transition-colors"
            >
              <Wand2 className="w-3 h-3" aria-hidden="true" />
              Auto
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-md bg-[#0B0B0D]">
            <button
              type="button"
              onClick={() => {
                if (!isColor) onUpdateSettings({ profile: 'c41-standard' }, true);
              }}
              className={`py-1.5 rounded text-xs font-medium transition-colors ${
                isColor
                  ? 'bg-white/[0.1] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Color
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isBW) onUpdateSettings({ profile: 'bw-silver' }, true);
              }}
              className={`py-1.5 rounded text-xs font-medium transition-colors ${
                isBW
                  ? 'bg-white/[0.1] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              B&amp;W
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ profile: 'positive-restore' }, true)}
              className={`py-1.5 rounded text-xs font-medium transition-colors ${
                isRestore
                  ? 'bg-white/[0.1] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Restore
            </button>
          </div>

          {isColor && (
            <div className="flex items-center gap-1 text-[11px]">
              {(
                [
                  { id: 'c41-standard', label: 'Neutral' },
                  { id: 'kodak-warm', label: 'Warm' },
                  { id: 'fuji-cool', label: 'Cool' },
                ] as { id: FilmProfileId; label: string }[]
              ).map((look) => (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => onUpdateSettings({ profile: look.id }, true)}
                  className={`flex-1 py-1 rounded transition-colors ${
                    s.profile === look.id
                      ? 'text-[#E59A28] bg-[#E59A28]/10 font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {look.label}
                </button>
              ))}
            </div>
          )}

          {isBW && (
            <div className="flex items-center gap-1 text-[11px]">
              {(
                [
                  { id: 'bw-silver', label: 'Silver Gelatin' },
                  { id: 'bw-selenium', label: 'Selenium Split' },
                ] as { id: FilmProfileId; label: string }[]
              ).map((look) => (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => onUpdateSettings({ profile: look.id }, true)}
                  className={`flex-1 py-1 rounded transition-colors ${
                    s.profile === look.id
                      ? 'text-[#E59A28] bg-[#E59A28]/10 font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {look.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tone (Open by default) */}
        <AccordionGroup title="Tone" defaultOpen>
          <SliderRow
            label="Exposure"
            value={s.exposure}
            min={-2}
            max={2}
            step={0.05}
            defaultValue={0}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ exposure: v }, rec)}
          />
          <SliderRow
            label="Contrast"
            value={s.contrast}
            min={-50}
            max={50}
            defaultValue={8}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ contrast: v }, rec)}
          />
          <SliderRow
            label="Highlights"
            value={s.highlights}
            min={-100}
            max={100}
            defaultValue={0}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ highlights: v }, rec)}
          />
          <SliderRow
            label="Shadows"
            value={s.shadows}
            min={-100}
            max={100}
            defaultValue={6}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ shadows: v }, rec)}
          />
        </AccordionGroup>

        {/* Color (Open by default for Color / Restore) */}
        {!isBW && (
          <AccordionGroup
            title="Color"
            defaultOpen
            trailing={
              <button
                type="button"
                onClick={() =>
                  onChangeTool(activeTool === 'pick-gray' ? 'pan' : 'pick-gray')
                }
                className={`inline-flex items-center gap-1 text-[11px] transition-colors ${
                  activeTool === 'pick-gray'
                    ? 'text-[#E59A28]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Pipette className="w-3 h-3" aria-hidden="true" />
                Pick Gray
              </button>
            }
          >
            <SliderRow
              label="Temperature"
              value={s.temperature}
              min={-100}
              max={100}
              defaultValue={0}
              onBeginEdit={onBeginEdit}
              onChange={(v, rec) => onUpdateSettings({ temperature: v }, rec)}
            />
            <SliderRow
              label="Tint"
              value={s.tint}
              min={-100}
              max={100}
              defaultValue={0}
              onBeginEdit={onBeginEdit}
              onChange={(v, rec) => onUpdateSettings({ tint: v }, rec)}
            />
            <SliderRow
              label="Saturation"
              value={s.saturation}
              min={-100}
              max={100}
              defaultValue={6}
              onBeginEdit={onBeginEdit}
              onChange={(v, rec) => onUpdateSettings({ saturation: v }, rec)}
            />
          </AccordionGroup>
        )}

        {/* RGB Tone Curves (Collapsed by default) */}
        <AccordionGroup title="Tone Curves">
          <ToneCurveEditor
            curves={curves}
            isBW={isBW}
            onBeginEdit={onBeginEdit}
            onChange={(nextCurves) => onUpdateSettings({ curves: nextCurves }, false)}
          />
        </AccordionGroup>

        {/* Split Tone Color Wheels (Collapsed by default, Color/Restore only) */}
        {!isBW && (
          <AccordionGroup title="Split Tone">
            <ColorWheelPad
              splitTone={splitTone}
              onBeginEdit={onBeginEdit}
              onChange={(nextSplit) =>
                onUpdateSettings({ splitTone: nextSplit }, false)
              }
            />
          </AccordionGroup>
        )}

        {/* Film Base & Backlight Falloff (Collapsed by default) */}
        <AccordionGroup
          title="Film Base & Falloff"
          trailing={
            <div className="flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 rounded-sm border border-white/15"
                style={{ backgroundColor: baseRgbCss }}
                title={`Film base RGB: ${s.baseColor.r}, ${s.baseColor.g}, ${s.baseColor.b}`}
              />
              <button
                type="button"
                onClick={() =>
                  onChangeTool(activeTool === 'pick-base' ? 'pan' : 'pick-base')
                }
                className={`inline-flex items-center gap-1 text-[11px] transition-colors ${
                  activeTool === 'pick-base'
                    ? 'text-[#E59A28]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Pipette className="w-3 h-3" aria-hidden="true" />
                Sample
              </button>
            </div>
          }
        >
          <SliderRow
            label="Auto Color Balance"
            value={s.autoBalance}
            min={0}
            max={100}
            defaultValue={94}
            formatValue={(v) => `${v}%`}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ autoBalance: v }, rec)}
          />
          <SliderRow
            label="Backlight Falloff"
            value={s.vignetteFix ?? 0}
            min={0}
            max={100}
            defaultValue={0}
            formatValue={(v) => `${v}%`}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ vignetteFix: v }, rec)}
          />
          <SliderRow
            label="Border Ignore"
            value={s.borderIgnore}
            min={0}
            max={18}
            defaultValue={4}
            formatValue={(v) => `${v}%`}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ borderIgnore: v }, rec)}
          />
          <SliderRow
            label="Black Point"
            value={s.blackPoint}
            min={-30}
            max={50}
            defaultValue={0}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ blackPoint: v }, rec)}
          />
        </AccordionGroup>

        {/* Restoration & Print Frame (Collapsed by default) */}
        <AccordionGroup title="Restoration & Print">
          <SliderRow
            label="Dust & Speckle Clean"
            value={s.dustClean}
            min={0}
            max={100}
            defaultValue={0}
            formatValue={(v) => `${v}%`}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ dustClean: v }, rec)}
          />
          <SliderRow
            label="Clarity"
            value={s.clarity}
            min={0}
            max={100}
            defaultValue={12}
            formatValue={(v) => `${v}%`}
            onBeginEdit={onBeginEdit}
            onChange={(v, rec) => onUpdateSettings({ clarity: v }, rec)}
          />

          <div className="space-y-1.5 pt-1">
            <span className="text-xs text-zinc-300 block">Print Border</span>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-md bg-[#0B0B0D]">
              {(
                [
                  { id: 'none', label: 'None' },
                  { id: 'white', label: 'White' },
                  { id: 'black', label: 'Black' },
                ] as { id: PrintBorderStyle; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdateSettings({ printBorder: opt.id }, true)}
                  className={`py-1 rounded text-[11px] font-medium transition-colors ${
                    printBorder === opt.id
                      ? 'bg-white/[0.1] text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </AccordionGroup>
      </div>

      {/* Clean Export Footer */}
      <div className="shrink-0 border-t border-white/[0.06] bg-[#101012] px-5 py-3.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={() => onExport('image/png')}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {isExporting ? 'Rendering...' : 'Download PNG'}
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={() => onExport('image/jpeg')}
            className="px-3 py-2 rounded-md bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-50"
          >
            JPG
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <button
            type="button"
            onClick={handleSync}
            disabled={frameCount < 2}
            className="inline-flex items-center gap-1 hover:text-zinc-200 transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            <Copy className="w-3 h-3" aria-hidden="true" />
            {syncNotice ? 'Synced to roll' : 'Sync to roll'}
          </button>

          <button
            type="button"
            onClick={onResetFrame}
            className="inline-flex items-center gap-1 hover:text-zinc-200 transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>
    </aside>
  );
}
