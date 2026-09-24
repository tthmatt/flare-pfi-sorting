import { parseCaptureTimestamp } from './captureTime.js';

const decoder = new TextDecoder('ascii');
const empty = () => ({ original: null, digitized: null });

// Read only the EXIF date fields needed for sorting. Every offset stays within
// its APP1 segment (or the bounded TIFF window); no thumbnails/MakerNotes run.
function readTiffDates(bytes, start, end) {
  const result = empty();
  if (end - start < 8) return result;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  const byteOrder = view.getUint16(0);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return result;
  const little = byteOrder === 0x4949;
  const fits = (offset, length) => offset >= 0 && length >= 0 && offset <= view.byteLength - length;
  if (view.getUint16(2, little) !== 42) return result;

  function entries(offset) {
    if (offset < 8 || !fits(offset, 2)) return [];
    const count = view.getUint16(offset, little);
    if (count > 4096 || !fits(offset + 2, count * 12 + 4)) return [];
    return Array.from({ length: count }, (_, index) => offset + 2 + index * 12);
  }
  function ascii(entry) {
    if (view.getUint16(entry + 2, little) !== 2) return null;
    const count = view.getUint32(entry + 4, little);
    if (count < 1 || count > 128) return null;
    const offset = count <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    if (!fits(offset, count)) return null;
    return decoder.decode(bytes.subarray(start + offset, start + offset + count)).replace(/\0.*$/s, '').trim();
  }

  const root = entries(view.getUint32(4, little));
  const pointer = root.find((entry) => view.getUint16(entry, little) === 0x8769);
  if (pointer === undefined || view.getUint16(pointer + 2, little) !== 4 || view.getUint32(pointer + 4, little) !== 1) return result;
  const dates = new Map();
  for (const entry of entries(view.getUint32(pointer + 8, little))) {
    const tag = view.getUint16(entry, little);
    if ([0x9003, 0x9004, 0x9011, 0x9012].includes(tag)) dates.set(tag, ascii(entry));
  }
  function timestamp(dateTag, offsetTag) {
    const date = dates.get(dateTag);
    if (!date) return null;
    const offset = dates.get(offsetTag);
    if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) return parseCaptureTimestamp(date + offset);
    return parseCaptureTimestamp(date);
  }
  return { original: timestamp(0x9003, 0x9011), digitized: timestamp(0x9004, 0x9012) };
}

export function readExifDates(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) return empty();
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return readTiffDates(bytes, 0, bytes.length);
  const dates = empty();
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break; // Never scan image pixels.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) break;
    const payload = offset + 2;
    if (marker === 0xe1 && length >= 8 && decoder.decode(bytes.subarray(payload, payload + 6)) === 'Exif\0\0') {
      const parsed = readTiffDates(bytes, payload + 6, end);
      dates.original ??= parsed.original;
      dates.digitized ??= parsed.digitized;
      if (dates.original) break;
    }
    offset = end;
  }
  return dates;
}
