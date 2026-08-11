import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFiles, inferAltitudeStarts } from './grouping.js';

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

const analysisSettings = {
  ...settings, inferAltitudeTurns: false, sortBy: 'filename', markerPitch: -90,
  tolerance: 2, folderPrefix: 'test', skipMarkers: false, proposeGpsTurns: false,
};

test('metadata reads use bounded concurrency, preserve input order, and read every image once', async () => {
  const files = Array.from({ length: 9 }, (_, index) => ({ name: `${index}.jpg`, size: 1, lastModified: index }));
  const reads = new Map();
  let active = 0; let maximumActive = 0;
  const readMetadata = async (file) => {
    reads.set(file.name, (reads.get(file.name) || 0) + 1);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, (9 - Number.parseInt(file.name, 10)) * 2));
    active -= 1;
    return { pitch: -10, captureDate: null, altitude: null, altitudeSource: null, latitude: null, longitude: null, flightYaw: null, gimbalYaw: null, warnings: [] };
  };
  const result = await analyzeFiles(files, analysisSettings, null, { readMetadata });
  assert.equal(maximumActive, 4);
  assert.ok(maximumActive > 1);
  assert.deepEqual(result.analyses.map((item) => item.file.name), files.map((file) => file.name));
  assert.deepEqual([...reads.values()], Array(files.length).fill(1));
});

test('progress is throttled, monotonic, and guaranteed to finish at the total', async () => {
  const files = Array.from({ length: 8 }, (_, index) => ({ name: `${index}.jpg`, size: 1 }));
  let clock = 0;
  const progress = [];
  const readMetadata = async () => {
    clock += 20;
    return { pitch: null, captureDate: null, altitude: null, altitudeSource: null, latitude: null, longitude: null, flightYaw: null, gimbalYaw: null, warnings: [] };
  };
  await analyzeFiles(files, analysisSettings, (done, total) => progress.push([done, total, clock]), { readMetadata, now: () => clock });
  assert.deepEqual(progress.map(([done]) => done), [1, 8]);
  assert.ok(progress.every((entry, index) => index === 0 || entry[0] >= progress[index - 1][0]));
  assert.deepEqual(progress.at(-1).slice(0, 2), [8, 8]);
});

test('one metadata failure does not stop other files and retains normalized error shape', async () => {
  const files = [{ name: 'bad.jpg', size: 1 }, { name: 'good.jpg', size: 1 }];
  const result = await analyzeFiles(files, analysisSettings, null, { readMetadata: async (file) => {
    if (file.name === 'bad.jpg') throw new Error('broken');
    return { pitch: -12, captureDate: null, altitude: null, altitudeSource: null, latitude: null, longitude: null, flightYaw: null, gimbalYaw: null, warnings: [] };
  } });
  assert.deepEqual({ ...result.analyses[0], file: undefined }, {
    file: undefined, pitch: null, captureDate: null, altitude: null, altitudeSource: null,
    latitude: null, longitude: null, flightYaw: null, gimbalYaw: null,
    warnings: ['missing-pitch', 'missing-capture-time', 'missing-altitude', 'missing-gps'], error: 'broken',
  });
  assert.equal(result.analyses[1].pitch, -12);
});

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
