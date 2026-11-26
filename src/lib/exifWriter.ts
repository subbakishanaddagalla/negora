export interface ExifMetadataInput {
  title?: string;
  camera?: string;
  lens?: string;
  filmStock?: string;
  iso?: string;
  notes?: string;
}

function writeUint16LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
}

function writeUint32LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
  buf[offset + 2] = (val >> 16) & 0xff;
  buf[offset + 3] = (val >> 24) & 0xff;
}

function encodeAscii(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length + 1);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes[i] = code < 128 ? code : 63;
  }
  bytes[str.length] = 0;
  return bytes;
}

function formatExifDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

interface IfdEntry {
  tag: number;
  type: number; // 2=ASCII, 3=SHORT, 4=LONG
  count: number;
  inlineValue?: number;
  dataBytes?: Uint8Array;
}

function buildApp1ExifSegment(meta: ExifMetadataInput): Uint8Array {
  const descParts = [meta.title, meta.filmStock, meta.notes]
    .map((s) => s?.trim())
    .filter(Boolean);
  const imageDescription = descParts.join(' — ').slice(0, 240);
  const cameraModel = meta.camera?.trim().slice(0, 80) || '';
  const lensModel = meta.lens?.trim().slice(0, 80) || '';
  const isoNum = Number.parseInt((meta.iso || '').replace(/[^0-9]/g, ''), 10);
  const dateStr = formatExifDate(new Date());

  const ifd0Entries: IfdEntry[] = [];
  if (imageDescription) {
    const b = encodeAscii(imageDescription);
    ifd0Entries.push({ tag: 0x010e, type: 2, count: b.length, dataBytes: b });
  }
  if (cameraModel) {
    const b = encodeAscii(cameraModel);
    ifd0Entries.push({ tag: 0x0110, type: 2, count: b.length, dataBytes: b });
  }
  {
    const b = encodeAscii('NEGORA Darkroom');
    ifd0Entries.push({ tag: 0x0131, type: 2, count: b.length, dataBytes: b });
  }
  {
    const b = encodeAscii(dateStr);
    ifd0Entries.push({ tag: 0x0132, type: 2, count: b.length, dataBytes: b });
  }

  const exifSubEntries: IfdEntry[] = [];
  {
    const b = encodeAscii(dateStr);
    exifSubEntries.push({ tag: 0x9003, type: 2, count: b.length, dataBytes: b });
  }
  if (Number.isFinite(isoNum) && isoNum > 0 && isoNum < 65535) {
    exifSubEntries.push({ tag: 0x8827, type: 3, count: 1, inlineValue: isoNum });
  }
  if (lensModel) {
    const b = encodeAscii(lensModel);
    exifSubEntries.push({ tag: 0xa434, type: 2, count: b.length, dataBytes: b });
  }

  // Reserve space for ExifIFD pointer in IFD0 (tag 0x8769)
  const ifd0Count = ifd0Entries.length + (exifSubEntries.length > 0 ? 1 : 0);
  const tiffHeaderSize = 8;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifIfdOffset = tiffHeaderSize + ifd0Size;
  const exifIfdSize =
    exifSubEntries.length > 0 ? 2 + exifSubEntries.length * 12 + 4 : 0;

  let dataCursor = exifIfdOffset + exifIfdSize;
  const dataChunks: Uint8Array[] = [];

  const placeEntryData = (entry: IfdEntry): number => {
    if (!entry.dataBytes) return entry.inlineValue ?? 0;
    if (entry.dataBytes.length <= 4) {
      let packed = 0;
      for (let i = 0; i < entry.dataBytes.length; i++) {
        packed |= entry.dataBytes[i] << (8 * i);
      }
      return packed;
    }
    const off = dataCursor;
    dataChunks.push(entry.dataBytes);
    dataCursor += entry.dataBytes.length;
    if (dataCursor % 2 === 1) {
      dataChunks.push(new Uint8Array([0]));
      dataCursor += 1;
    }
    return off;
  };

  const fullIfd0: IfdEntry[] = [...ifd0Entries];
  if (exifSubEntries.length > 0) {
    fullIfd0.push({
      tag: 0x8769,
      type: 4,
      count: 1,
      inlineValue: exifIfdOffset,
    });
  }
  fullIfd0.sort((a, b) => a.tag - b.tag);
  exifSubEntries.sort((a, b) => a.tag - b.tag);

  const ifd0Values = fullIfd0.map((e) => placeEntryData(e));
  const exifValues = exifSubEntries.map((e) => placeEntryData(e));

  const tiffLen = dataCursor;
  const tiffBuf = new Uint8Array(tiffLen);

  // Little-endian TIFF header ("II", 0x002A, offset 8)
  tiffBuf[0] = 0x49;
  tiffBuf[1] = 0x49;
  writeUint16LE(tiffBuf, 2, 0x002a);
  writeUint32LE(tiffBuf, 4, 8);

  // Write IFD0
  let p = 8;
  writeUint16LE(tiffBuf, p, fullIfd0.length);
  p += 2;
  for (let i = 0; i < fullIfd0.length; i++) {
    const e = fullIfd0[i];
    writeUint16LE(tiffBuf, p, e.tag);
    writeUint16LE(tiffBuf, p + 2, e.type);
    writeUint32LE(tiffBuf, p + 4, e.count);
    writeUint32LE(tiffBuf, p + 8, ifd0Values[i]);
    p += 12;
  }
  writeUint32LE(tiffBuf, p, 0);

  // Write ExifIFD
  if (exifSubEntries.length > 0) {
    p = exifIfdOffset;
    writeUint16LE(tiffBuf, p, exifSubEntries.length);
    p += 2;
    for (let i = 0; i < exifSubEntries.length; i++) {
      const e = exifSubEntries[i];
      writeUint16LE(tiffBuf, p, e.tag);
      writeUint16LE(tiffBuf, p + 2, e.type);
      writeUint32LE(tiffBuf, p + 4, e.count);
      writeUint32LE(tiffBuf, p + 8, exifValues[i]);
      p += 12;
    }
    writeUint32LE(tiffBuf, p, 0);
  }

  let chunkOff = exifIfdOffset + exifIfdSize;
  for (const chunk of dataChunks) {
    tiffBuf.set(chunk, chunkOff);
    chunkOff += chunk.length;
  }

  // Wrap in JPEG APP1 marker: FF E1 <lenHi lenLo> "Exif\0\0" <tiff>
  const app1PayloadLen = 2 + 6 + tiffBuf.length;
  const seg = new Uint8Array(2 + app1PayloadLen);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg[2] = (app1PayloadLen >> 8) & 0xff;
  seg[3] = app1PayloadLen & 0xff;
  seg[4] = 0x45; // E
  seg[5] = 0x78; // x
  seg[6] = 0x69; // i
  seg[7] = 0x66; // f
  seg[8] = 0x00;
  seg[9] = 0x00;
  seg.set(tiffBuf, 10);
  return seg;
}

export async function injectExifIntoJpegBlob(
  jpegBlob: Blob,
  meta?: ExifMetadataInput
): Promise<Blob> {
  if (!meta) return jpegBlob;
  const hasAny =
    Boolean(meta.title?.trim()) ||
    Boolean(meta.camera?.trim()) ||
    Boolean(meta.lens?.trim()) ||
    Boolean(meta.filmStock?.trim()) ||
    Boolean(meta.iso?.trim()) ||
    Boolean(meta.notes?.trim());
  if (!hasAny) return jpegBlob;

  const bytes = new Uint8Array(await jpegBlob.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return jpegBlob;
  }

  const app1 = buildApp1ExifSegment(meta);
  const out = new Uint8Array(bytes.length + app1.length);
  // Keep SOI (FF D8), insert APP1 right after SOI
  out[0] = bytes[0];
  out[1] = bytes[1];
  out.set(app1, 2);
  out.set(bytes.subarray(2), 2 + app1.length);
  return new Blob([out], { type: 'image/jpeg' });
}
