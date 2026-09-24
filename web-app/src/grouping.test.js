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

function records(pitches) {
  return pitches.map((pitch, index) => ({ file: { name: `${index}.jpg`, size: 1 }, pitch, altitude: null, captureDate: null }));
}

test('manual marker splits a recorded 0-degree photo without changing its pitch, and undo restores grouping', () => {
  const items = records([-10, 0, -20]);
  assert.equal(buildGroups(items, analysisSettings).groups.length, 1);
  const corrected = items.map((item, index) => index === 1 ? { ...item, markerOverride: 'marker' } : item);
  const result = buildGroups(corrected, analysisSettings);
  assert.deepEqual(result.groups.map((group) => group.files.map((item) => item.file.name)), [['0.jpg'], ['1.jpg', '2.jpg']]);
  assert.equal(result.groups[1].startReason, 'manual-marker');
  assert.equal(result.groups[1].files[0].pitch, 0);
  assert.equal(items[1].markerOverride, undefined);
  assert.equal(buildGroups(corrected.map((item) => ({ ...item, markerOverride: 'auto' })), analysisSettings).groups.length, 1);
});

test('skipping a manual marker transfers its folder start to the next inspection photo', () => {
  const items = records([-10, 0, -20, 0]);
  items[1].markerOverride = 'marker';
  items[3].markerOverride = 'marker';
  const result = buildGroups(items, { ...analysisSettings, skipMarkers: true });
  assert.deepEqual(result.groups.map((group) => group.files.map((item) => item.file.name)), [['0.jpg'], ['2.jpg']]);
  assert.equal(result.groups[1].files[0].startReason, 'manual-marker');
  assert.equal(result.skippedMarkerCount, 2);
  assert.equal(buildGroups([{ ...items[1] }], { ...analysisSettings, skipMarkers: true }).groups.length, 0);
});

test('keep as inspection photo overrides automatic markers and skip-marker removal', () => {
  const items = records([-10, -90, -20]);
  items[1].markerOverride = 'normal';
  const result = buildGroups(items, { ...analysisSettings, skipMarkers: true });
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].files.length, 3);
  assert.equal(result.skippedMarkerCount, 0);
});

test('corrections follow file identity through sorting even when filenames are identical', () => {
  const items = records([-10, 0, -20]);
  for (const [index, item] of items.entries()) {
    item.file.name = 'DJI_0075.JPG';
    item.captureDate = new Date(Date.UTC(2026, 6, 15, 0, 0, index));
  }
  items[1].markerOverride = 'marker';
  const result = buildGroups([items[2], items[1], items[0]], { ...analysisSettings, sortBy: 'capture' });
  assert.deepEqual(result.groups.map((group) => group.files.map((item) => item.file)), [[items[0].file], [items[1].file, items[2].file]]);
});

test('three or more consecutive automatic markers do not alternate into extra folders', () => {
  const result = buildGroups(records([-20, -90, -90, -90, -90, -10]), analysisSettings);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[1].files.length, 5);
});

test('explicit manual folder starts take priority even next to another marker', () => {
  const items = records([-90, 0, 0]);
  items[1].markerOverride = 'marker';
  items[2].markerOverride = 'marker';
  assert.equal(buildGroups(items, analysisSettings).groups.length, 3);
});

test('keep as inspection photo suppresses an inferred split at that photo', () => {
  const items = records([-10, -10, -10, -10, -10]);
  [10, 18, 26, 18, 10].forEach((altitude, index) => { items[index].altitude = altitude; });
  const options = { ...analysisSettings, inferAltitudeTurns: true };
  assert.equal(buildGroups(items, options).groups.length, 2);
  items[3].markerOverride = 'normal';
  assert.equal(buildGroups(items, options).groups.length, 1);
});

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

test('GPS indices and filenames use deterministic capture order without changing input order', async () => {
  const files = ['late.jpg', 'missing.jpg', 'b.jpg', 'a.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg', 'z.jpg', 'zz.jpg'].map((name) => ({ name, size: 1, lastModified: 0 }));
  const metadata = new Map([
    ['late.jpg', [6, 20, 103.800060]], ['missing.jpg', [null, null, 103.800060]],
    ['b.jpg', [1, 20, 103.8]], ['a.jpg', [0, 10, 103.8]], ['03.jpg', [2, 30, 103.8]],
    ['04.jpg', [3, 30, 103.8]], ['05.jpg', [4, 30, 103.8]], ['06.jpg', [5, 30, 103.800060]], ['z.jpg', [7, 10, 103.800060]], ['zz.jpg', [7, null, 103.800060]],
  ]);
  const result = await analyzeFiles(files, { ...analysisSettings, proposeGpsTurns: true, gpsWindowSize: 3, gpsMinDisplacementMeters: 4, gpsMaxClusterRadiusMeters: 3, gpsMinSignalRatio: 2, gpsMaxGapSeconds: 30 }, null, { readMetadata: async (file) => {
    const [second, altitude, longitude] = metadata.get(file.name);
    return { pitch: -25, captureDate: second == null ? null : new Date(1786451400000 + second * 1000), altitude, altitudeSource: 'relative', latitude: 1.3, longitude, warnings: [] };
  } });
  assert.deepEqual(result.analyses.map((item) => item.file.name), files.map((file) => file.name));
  assert.deepEqual(result.captureOrderedAnalyses.map((item) => item.file.name), ['a.jpg', 'b.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg', 'late.jpg', 'z.jpg', 'zz.jpg', 'missing.jpg']);
  assert.equal(result.turnCandidates[0].boundaryFile, '06.jpg');
  assert.equal(result.turnCandidates[0].detectedAtFile, 'z.jpg');
  assert.equal(result.turnCandidates[0].evidenceStartFile, 'a.jpg');
  assert.equal(result.turnCandidates[0].evidenceEndFile, 'z.jpg');
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
