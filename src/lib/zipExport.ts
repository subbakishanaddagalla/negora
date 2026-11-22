import JSZip from 'jszip';
import type { NegativeFrame } from '../types/darkroom';
import { exportFullResolutionBlob } from './negativeProcessor';

export async function buildRollZipArchive(
  frames: NegativeFrame[],
  format: 'image/png' | 'image/jpeg',
  onProgress?: (completed: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  const ext = format === 'image/png' ? 'png' : 'jpg';
  const usedNames = new Map<string, number>();

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const blob = await exportFullResolutionBlob(
      frame.sourceCanvas,
      frame.settings,
      format
    );

    const framePrefix = String(i + 1).padStart(2, '0');
    const cleanBase = frame.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'frame';
    let filename = `${framePrefix}_${cleanBase}_positive`;
    const count = usedNames.get(filename) ?? 0;
    usedNames.set(filename, count + 1);
    if (count > 0) filename = `${filename}_${count + 1}`;

    zip.file(`${filename}.${ext}`, blob);
    onProgress?.(i + 1, frames.length);
  }

  return zip.generateAsync({ type: 'blob' });
}
