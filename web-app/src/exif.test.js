import test from 'node:test';
import assert from 'node:assert/strict';
import { readExifDates } from './exif.js';
import { readImageMetadata, parseImageMetadataText } from './metadata.js';
import { sortAnalyses } from './ordering.js';
import { makeExifFixture } from '../test-support/exif-fixture.js';

for (const little of [true, false]) {
  test(`EXIF original time replaces Mavic 2's date-only XMP placeholder (${little ? 'little' : 'big'} endian)`, async () => {
    const { jpeg, tiff } = makeExifFixture({ little });
    const expected = '2026-07-15T16:58:22.000Z';
    assert.equal(readExifDates(tiff.buffer).original.toISOString(), expected);
    const parsed = await readImageMetadata(new Blob([jpeg]));
    assert.equal(parsed.captureDate.toISOString(), expected);
    assert.equal(parsed.pitch, 0, 'correcting capture time must not invent a downward pitch');
    assert.equal(parsed.altitude, 9.1);
    assert.ok(!parsed.warnings.includes('missing-capture-time'));
  });
}

test('EXIF original time wins over conflicting XMP and digitization dates', async () => {
  const { jpeg } = makeExifFixture({ digitized: '2026:07:16 01:02:03', xmp: '<DateTimeOriginal>2025-01-01T00:00:00Z</DateTimeOriginal><CreateDate>1970-01-01</CreateDate>' });
  assert.equal((await readImageMetadata(new Blob([jpeg]))).captureDate.toISOString(), '2026-07-15T16:58:22.000Z');
});

test('EXIF timezone offsets and digitized fallback preserve chronological ordering', async () => {
  const original = makeExifFixture({ offset: '+08:00' });
  const fallback = makeExifFixture({ original: null, digitized: '2026:07:15 16:58:21', digitizedOffset: '+08:00' });
  const late = { file: { name: 'a.jpg' }, ...await readImageMetadata(new Blob([original.jpeg])) };
  const early = { file: { name: 'z.jpg' }, ...await readImageMetadata(new Blob([fallback.jpeg])) };
  assert.equal(late.captureDate.toISOString(), '2026-07-15T08:58:22.000Z');
  assert.equal(early.captureDate.toISOString(), '2026-07-15T08:58:21.000Z');
  assert.deepEqual(sortAnalyses([late, early], 'capture'), [early, late]);
});

test('missing, date-only, and invalid dates stay missing and fall back to valid XMP', async () => {
  for (const invalid of ['1970-01-01', '0000:00:00 00:00:00', '2026:02:30 12:00:00', '2026:07:15 24:00:00']) {
    const { jpeg } = makeExifFixture({ original: invalid });
    const parsed = await readImageMetadata(new Blob([jpeg]));
    assert.equal(parsed.captureDate, null);
    assert.ok(parsed.warnings.includes('missing-capture-time'));
  }
  assert.equal(parseImageMetadataText('<CreateDate>1970-01-01</CreateDate>').captureDate, null);
  const { jpeg } = makeExifFixture({ original: 'invalid', xmp: '<CreateDate>2026-07-15T10:27:05Z</CreateDate>' });
  assert.equal((await readImageMetadata(new Blob([jpeg]))).captureDate.toISOString(), '2026-07-15T10:27:05.000Z');
});

test('truncated JPEG/TIFF and invalid EXIF pointers cannot read beyond their bounds', () => {
  const { jpeg, tiff } = makeExifFixture();
  for (const bytes of [jpeg, tiff]) {
    for (let length = 0; length < bytes.length; length += 1) {
      assert.doesNotThrow(() => readExifDates(bytes.slice(0, length).buffer));
    }
  }
  for (const pointer of [4, 18, 36]) {
    const corrupt = tiff.slice();
    new DataView(corrupt.buffer).setUint32(pointer, 0xffffffff, true);
    assert.equal(readExifDates(corrupt.buffer).original, null);
  }
  const corrupt = tiff.slice();
  new DataView(corrupt.buffer).setUint16(26, 0xffff, true);
  assert.equal(readExifDates(corrupt.buffer).original, null);
});
