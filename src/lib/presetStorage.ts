import type { GradingPreset, GradingSettings } from '../types/darkroom';
import { createDefaultCurves, createDefaultSplitTone } from './negativeProcessor';

const PRESETS_STORAGE_KEY = 'negora-custom-presets-v1';

export function extractPresetSettings(
  settings: GradingSettings
): Partial<GradingSettings> {
  return {
    profile: settings.profile,
    bwTone: settings.bwTone ?? 'none',
    autoBalance: settings.autoBalance,
    borderIgnore: settings.borderIgnore,
    vignetteFix: settings.vignetteFix,
    exposure: settings.exposure,
    contrast: settings.contrast,
    highlights: settings.highlights,
    shadows: settings.shadows,
    blackPoint: settings.blackPoint,
    temperature: settings.temperature,
    tint: settings.tint,
    saturation: settings.saturation,
    clarity: settings.clarity,
    sharpen: settings.sharpen ?? 0,
    dustClean: settings.dustClean,
    printBorder: settings.printBorder,
    curves: {
      master: (settings.curves?.master ?? createDefaultCurves().master).map((p) => ({
        x: p.x,
        y: p.y,
      })),
      r: (settings.curves?.r ?? createDefaultCurves().r).map((p) => ({
        x: p.x,
        y: p.y,
      })),
      g: (settings.curves?.g ?? createDefaultCurves().g).map((p) => ({
        x: p.x,
        y: p.y,
      })),
      b: (settings.curves?.b ?? createDefaultCurves().b).map((p) => ({
        x: p.x,
        y: p.y,
      })),
    },
    splitTone: {
      shadows: {
        ...(settings.splitTone?.shadows ?? createDefaultSplitTone().shadows),
      },
      midtones: {
        ...(settings.splitTone?.midtones ?? createDefaultSplitTone().midtones),
      },
      highlights: {
        ...(settings.splitTone?.highlights ?? createDefaultSplitTone().highlights),
      },
    },
  };
}

export function loadLocalPresets(): GradingPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GradingPreset =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.settings === 'object'
    );
  } catch {
    return [];
  }
}

export function saveLocalPresets(presets: GradingPreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage quota errors
  }
}
