import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { METADATA_READ_LIMIT, parseImageMetadataText, readImageMetadata } from './metadata.js';

const golden = JSON.parse(readFileSync(new URL('../../tests/metadata_golden_vectors.json', import.meta.url), 'utf8'));
for (const vector of golden.vectors) {
  test(`metadata golden: ${vector.name}`, () => {
    const parsed = parseImageMetadataText(vector.text);
    const actualEpochMs = parsed.captureDate?.getTime() ?? null;
    const actual = { ...parsed };
    delete actual.captureDate;
    const expected = { ...vector.expected };
    delete expected.captureTime;
    delete expected.captureEpochMs;
    assert.deepEqual(actual, expected);
    assert.equal(actualEpochMs, vector.expected.captureEpochMs);
  });
}

test('mixed timezone and timezone-free timestamps preserve UTC ordering', () => {
  const noZone = parseImageMetadataText('<CreateDate>2026-01-01T10:00:01</CreateDate>').captureDate;
  const offset = parseImageMetadataText('<CreateDate>2026-01-01T10:30:00+01:00</CreateDate>').captureDate;
  assert.ok(offset.getTime() < noZone.getTime());
});

test('field priorities and attribute-before-element behavior are unchanged', () => {
  const parsed = parseImageMetadataText(`
    <x:GimbalPitchDegree>-70</x:GimbalPitchDegree>
    <x:CameraPitchDegree="-80" x:GimbalPitchDegree="-90" x:RelativeAltitude="12" x:AbsoluteAltitude="22" x:GPSAltitude="32"
      x:DateTimeOriginal="2026:01:02 03:04:05" x:CreateDate="2025:01:01 00:00:00" />
    <x:RelativeAltitude>99</x:RelativeAltitude><x:GimbalPitchDegree>-60</x:GimbalPitchDegree>`);
  assert.equal(parsed.pitch, -90);
  assert.equal(parsed.altitude, 12);
  assert.equal(parsed.altitudeSource, 'relative');
  assert.equal(parsed.captureDate.toISOString(), '2026-01-02T03:04:05.000Z');
});

test('sparse metadata keeps warning codes and order', () => {
  assert.deepEqual(parseImageMetadataText('<x:FlightYawDegree>4</x:FlightYawDegree>').warnings,
    ['missing-pitch', 'missing-capture-time', 'missing-altitude', 'missing-gps']);
});

test('metadata near the end of the 2 MiB read window is detected', async () => {
  const suffix = '<x:GimbalPitchDegree="-89.5" x:GPSLatitude="51.5" x:GPSLongitude="-0.1" />';
  const bytes = new TextEncoder().encode(`${'x'.repeat(METADATA_READ_LIMIT - suffix.length)}${suffix}ignored`);
  const file = new Blob([bytes]);
  const parsed = await readImageMetadata(file);
  assert.equal(parsed.pitch, -89.5);
  assert.equal(parsed.latitude, 51.5);
  assert.equal(parsed.longitude, -0.1);
});
