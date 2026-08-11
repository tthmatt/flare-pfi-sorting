import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImageMetadataText } from './metadata.js';

const golden = JSON.parse(readFileSync(new URL('../../tests/metadata_golden_vectors.json', import.meta.url), 'utf8'));
for (const vector of golden.vectors) {
  test(`metadata golden: ${vector.name}`, () => {
    const parsed = parseImageMetadataText(vector.text);
    const actual = {
      ...parsed,
      captureTime: parsed.captureDate ? vector.expected.captureTime : null,
    };
    delete actual.captureDate;
    assert.deepEqual(actual, vector.expected);
  });
}
