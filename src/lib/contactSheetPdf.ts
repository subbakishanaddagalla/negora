import { jsPDF } from 'jspdf';
import type { NegativeFrame, RollMetadata } from '../types/darkroom';
import {
  createOrientedImageData,
  processNegativeImageData,
} from './negativeProcessor';

function renderFrameThumbCanvas(
  frame: NegativeFrame,
  showRawNegative: boolean,
  maxDim = 680
): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(frame.previewWidth, frame.previewHeight));
  const pw = Math.max(1, Math.round(frame.previewWidth * scale));
  const ph = Math.max(1, Math.round(frame.previewHeight * scale));

  const srcTmp = document.createElement('canvas');
  srcTmp.width = frame.previewWidth;
  srcTmp.height = frame.previewHeight;
  const srcCtx = srcTmp.getContext('2d');
  if (!srcCtx) throw new Error('2D context unavailable');
  srcCtx.putImageData(frame.previewSourceData, 0, 0);

  const scaled = document.createElement('canvas');
  scaled.width = pw;
  scaled.height = ph;
  const scaledCtx = scaled.getContext('2d');
  if (!scaledCtx) throw new Error('2D context unavailable');
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

  const out = document.createElement('canvas');
  out.width = output.width;
  out.height = output.height;
  const outCtx = out.getContext('2d');
  if (outCtx) outCtx.putImageData(output, 0, 0);
  return out;
}

function buildMetaLine(meta: RollMetadata): string {
  return [
    meta.camera.trim(),
    meta.lens.trim(),
    meta.filmStock.trim(),
    meta.iso.trim() ? `ISO ${meta.iso.trim()}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
}

export async function exportContactSheetPdf(
  frames: NegativeFrame[],
  rollMetadata: RollMetadata,
  showRawNegative: boolean
): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const cols = 3;
  const rowsPerPage = 4;
  const perPage = cols * rowsPerPage;
  const headerH = 74;
  const gapX = 16;
  const gapY = 20;
  const cellW = (pageW - margin * 2 - gapX * (cols - 1)) / cols;
  const availH = pageH - margin * 2 - headerH;
  const cellH = (availH - gapY * (rowsPerPage - 1)) / rowsPerPage;

  const drawPageChrome = (pageNum: number, totalPages: number) => {
    doc.setFillColor(14, 14, 16);
    doc.rect(0, 0, pageW, pageH, 'F');

    doc.setTextColor(229, 154, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('NEGORA', margin, margin + 10);

    doc.setTextColor(244, 244, 245);
    doc.setFontSize(16);
    doc.text(rollMetadata.rollTitle.trim() || 'Contact Sheet', margin, margin + 30);

    const metaLine = buildMetaLine(rollMetadata);
    doc.setTextColor(161, 161, 170);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (metaLine) {
      doc.text(metaLine, margin, margin + 46);
    }
    if (rollMetadata.notes.trim()) {
      doc.text(rollMetadata.notes.trim().slice(0, 95), margin, margin + 59);
    }

    doc.setFontSize(8.5);
    doc.setTextColor(113, 113, 122);
    doc.text(
      `Page ${pageNum} / ${totalPages}  ·  ${frames.length} frames`,
      pageW - margin,
      margin + 10,
      { align: 'right' }
    );

    doc.setDrawColor(39, 39, 42);
    doc.line(margin, margin + headerH - 8, pageW - margin, margin + headerH - 8);
  };

  const totalPages = Math.max(1, Math.ceil(frames.length / perPage));

  for (let i = 0; i < frames.length; i++) {
    const pageIndex = Math.floor(i / perPage);
    const indexOnPage = i % perPage;
    if (indexOnPage === 0) {
      if (pageIndex > 0) doc.addPage();
      drawPageChrome(pageIndex + 1, totalPages);
    }

    const col = indexOnPage % cols;
    const row = Math.floor(indexOnPage / cols);
    const x = margin + col * (cellW + gapX);
    const y = margin + headerH + row * (cellH + gapY);

    const imgBoxH = cellH - 26;
    doc.setFillColor(18, 18, 20);
    doc.setDrawColor(38, 38, 42);
    doc.roundedRect(x, y, cellW, imgBoxH, 3, 3, 'FD');

    const thumbCanvas = renderFrameThumbCanvas(frames[i], showRawNegative, 560);
    const pad = 8;
    const maxW = cellW - pad * 2;
    const maxH = imgBoxH - pad * 2;
    const scale = Math.min(maxW / thumbCanvas.width, maxH / thumbCanvas.height);
    const dw = thumbCanvas.width * scale;
    const dh = thumbCanvas.height * scale;
    const dx = x + (cellW - dw) / 2;
    const dy = y + (imgBoxH - dh) / 2;

    const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.9);
    doc.addImage(dataUrl, 'JPEG', dx, dy, dw, dh);

    const frameNum = `${String(i + 1).padStart(2, '0')}A`;
    doc.setTextColor(229, 154, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(frameNum, x + 2, y + imgBoxH + 12);

    doc.setTextColor(228, 228, 231);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text((frames[i].name || frameNum).slice(0, 24), x + 24, y + imgBoxH + 12);

    if (frames[i].notes?.trim()) {
      doc.setTextColor(113, 113, 122);
      doc.setFontSize(7.5);
      doc.text(frames[i].notes.trim().slice(0, 32), x + 2, y + imgBoxH + 22);
    }
  }

  return doc.output('blob');
}

export async function exportContactSheetPng(
  frames: NegativeFrame[],
  rollMetadata: RollMetadata,
  showRawNegative: boolean
): Promise<Blob> {
  const cols = 3;
  const rows = Math.max(1, Math.ceil(frames.length / cols));
  const width = 2100;
  const margin = 90;
  const headerH = 190;
  const gapX = 48;
  const gapY = 64;
  const cellW = (width - margin * 2 - gapX * (cols - 1)) / cols;
  const imgBoxH = Math.round(cellW * 0.72);
  const cellH = imgBoxH + 74;
  const height = margin * 2 + headerH + rows * cellH + Math.max(0, rows - 1) * gapY;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.fillStyle = '#0E0E10';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#E59A28';
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.fillText('NEGORA', margin, margin + 28);

  ctx.fillStyle = '#F4F4F5';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText(rollMetadata.rollTitle.trim() || 'Contact Sheet', margin, margin + 84);

  const metaLine = buildMetaLine(rollMetadata);
  if (metaLine) {
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '400 24px monospace';
    ctx.fillText(metaLine, margin, margin + 126);
  }
  if (rollMetadata.notes.trim()) {
    ctx.fillStyle = '#71717A';
    ctx.font = '400 22px system-ui, sans-serif';
    ctx.fillText(rollMetadata.notes.trim().slice(0, 120), margin, margin + 160);
  }

  ctx.strokeStyle = '#27272A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(margin, margin + headerH - 18);
  ctx.lineTo(width - margin, margin + headerH - 18);
  ctx.stroke();

  for (let i = 0; i < frames.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cellW + gapX);
    const y = margin + headerH + row * (cellH + gapY);

    ctx.fillStyle = '#141416';
    ctx.strokeStyle = '#27272A';
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, cellW, imgBoxH);
    ctx.strokeRect(x, y, cellW, imgBoxH);

    const thumbCanvas = renderFrameThumbCanvas(frames[i], showRawNegative, 680);
    const pad = 20;
    const scale = Math.min(
      (cellW - pad * 2) / thumbCanvas.width,
      (imgBoxH - pad * 2) / thumbCanvas.height
    );
    const dw = thumbCanvas.width * scale;
    const dh = thumbCanvas.height * scale;
    ctx.drawImage(
      thumbCanvas,
      x + (cellW - dw) / 2,
      y + (imgBoxH - dh) / 2,
      dw,
      dh
    );

    const frameNum = `${String(i + 1).padStart(2, '0')}A`;
    ctx.fillStyle = '#E59A28';
    ctx.font = '700 22px monospace';
    ctx.fillText(frameNum, x, y + imgBoxH + 34);

    ctx.fillStyle = '#E4E4E7';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText((frames[i].name || frameNum).slice(0, 28), x + 64, y + imgBoxH + 34);

    if (frames[i].notes?.trim()) {
      ctx.fillStyle = '#71717A';
      ctx.font = '400 18px system-ui, sans-serif';
      ctx.fillText(frames[i].notes.trim().slice(0, 38), x, y + imgBoxH + 62);
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode contact sheet PNG'));
      },
      'image/png'
    );
  });
}
