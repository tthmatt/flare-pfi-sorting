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

test('10.5 m and 10.7 m horizontal photos start the next folder once the opposite pass is confirmed', () => {
  const result = analyze([[-10, 34], [-10, 26], [-10, 18], [0, 10.5], [0, 10.7], [-10, 18], [-10, 26]]);
  assert.deepEqual([...result.horizontalStarts], [3]);
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
