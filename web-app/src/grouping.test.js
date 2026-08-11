import test from 'node:test';
import assert from 'node:assert/strict';
import { inferAltitudeStarts } from './grouping.js';

const settings = {
  altitudeTolerance: 0.75,
  altitudeMinSteps: 2,
  altitudeMinSpan: 5,
  altitudeMarkerSuppression: 2,
  horizontalMinPhotos: 2,
  horizontalPitchTolerance: 5,
};

function analyze(data) {
  const ordered = data.map(([pitch, altitude]) => ({ pitch, altitude }));
  const pitchStarts = ordered.map(({ pitch }) => Math.abs(Math.abs(pitch) - 90) <= 2);
  return inferAltitudeStarts(ordered, pitchStarts, settings);
}

test('10.5 m stays put and the following 10.7 m horizontal photo starts the next folder', () => {
  const result = analyze([[-10, 34], [-10, 26], [-10, 18], [0, 10.5], [0, 10.7], [-10, 18], [-10, 26]]);
  assert.deepEqual([...result.horizontalStarts], [4]);
  assert.deepEqual([...result.reversalStarts], []);
});

test('a level pause continuing in the same direction does not split', () => {
  const result = analyze([[-10, 10], [-10, 18], [-10, 26], [0, 26.1], [0, 26.2], [-10, 34], [-10, 42]]);
  assert.deepEqual([...result.horizontalStarts], []);
});

test('a pitched-down marker remains primary near a traverse', () => {
  const result = analyze([[-10, 34], [-10, 26], [-10, 18], [-90, 10.4], [0, 10.5], [0, 10.7], [-10, 18], [-10, 26]]);
  assert.deepEqual([...result.horizontalStarts], []);
  assert.deepEqual([...result.reversalStarts], []);
});

import { readFileSync } from 'node:fs';
import { buildGroups } from './grouping.js';

const golden = JSON.parse(readFileSync(new URL('../../tests/grouping_golden_vectors.json', import.meta.url), 'utf8'));
for (const vector of golden.vectors) {
  test(`shared golden: ${vector.name}`, () => {
    const analyses = vector.images.map(([name, pitch, altitude], index) => ({
      file: { name, size: 1, lastModified: index }, pitch, altitude,
      captureDate: new Date(Date.UTC(2026, 0, 1, 0, 0, index)), error: null,
    }));
    const result = buildGroups(analyses, { ...golden.settings, inferAltitudeTurns: vector.inferAltitudeTurns, skipMarkers: vector.skipMarkers });
    assert.deepEqual(result.groups.map((group) => group.files.map((item) => item.file.name)), vector.groups);
    assert.deepEqual(result.groups.map((group) => group.startReason), vector.startReasons);
    assert.equal(result.skippedMarkerCount, vector.skippedMarkerCount);
    const shadow = buildGroups(analyses, { ...golden.settings, inferAltitudeTurns: vector.inferAltitudeTurns, skipMarkers: vector.skipMarkers, proposeGpsTurns: true });
    assert.deepEqual(shadow, result, 'GPS shadow setting must not affect ZIP folder membership or reasons');
  });
}
