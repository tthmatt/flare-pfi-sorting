import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImageMetadataText } from './metadata.js';

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
