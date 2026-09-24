// Synthetic EXIF/XMP only: no operator photos, location, or device identifiers.
export function makeExifFixture({ little = true, original = '2026:07:15 16:58:22', digitized = null, offset = null, digitizedOffset = null, xmp = '<rdf:Description drone-dji:GimbalPitchDegree="+0.00" drone-dji:RelativeAltitude="+9.10" xmp:CreateDate="1970-01-01" />' } = {}) {
  const values = [[0x9003, original], [0x9004, digitized], [0x9011, offset], [0x9012, digitizedOffset]]
    .filter(([, value]) => value !== null).map(([tag, value]) => [tag, new TextEncoder().encode(value + '\0')]);
  const exifOffset = 26;
  const dataOffset = exifOffset + 2 + values.length * 12 + 4;
  const tiff = new Uint8Array(dataOffset + values.reduce((sum, [, value]) => sum + value.length, 0));
  const view = new DataView(tiff.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x8769, little);
  view.setUint16(12, 4, little);
  view.setUint32(14, 1, little);
  view.setUint32(18, exifOffset, little);
  view.setUint16(exifOffset, values.length, little);
  let position = dataOffset;
  values.forEach(([tag, value], index) => {
    const entry = exifOffset + 2 + index * 12;
    view.setUint16(entry, tag, little);
    view.setUint16(entry + 2, 2, little);
    view.setUint32(entry + 4, value.length, little);
    if (value.length <= 4) tiff.set(value, entry + 8);
    else {
      view.setUint32(entry + 8, position, little);
      tiff.set(value, position);
      position += value.length;
    }
  });
  function segment(payload) {
    const length = payload.length + 2;
    return new Uint8Array([0xff, 0xe1, length >> 8, length & 255, ...payload]);
  }
  const jpeg = new Uint8Array([0xff, 0xd8, ...segment(new Uint8Array([69, 120, 105, 102, 0, 0, ...tiff])),
    ...segment(new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0' + xmp)), 0xff, 0xd9]);
  return { tiff, jpeg };
}
