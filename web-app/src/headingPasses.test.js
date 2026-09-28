import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findVisualPassCandidates } from './visualPasses.js';
import { buildGroups } from './grouping.js';
import { DEFAULT_SETTINGS } from './settings.js';

const fixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-labeled-elevation.json', import.meta.url)));
// Deliberately exclude operator labels, original identifiers and folder paths.
const flight = () => fixture.rows.map((r) => ({
  file: { name: 'unlabeled.jpg', size: 1 },
  latitude: r.north / 6371000 * 180 / Math.PI, longitude: r.east / 6371000 * 180 / Math.PI,
  captureDate: new Date(r.seconds * 1000), altitude: r.altitude, altitudeSource: 'relative',
  pitch: r.pitch, gimbalYaw: r.gimbalYaw,
}));
const expected = fixture.rows.flatMap((r, i) => i && r.pass !== fixture.rows[i - 1].pass ? [i] : []);
const gapIndex = fixture.rows.findIndex((r) => r.id === '0970');

test('operator-labeled elevation finds 15 exact boundaries, no extra splits, and explicitly misses the long gap', () => {
  const rows = flight();
  const { candidates, reasons } = findVisualPassCandidates(rows, DEFAULT_SETTINGS);
  assert.equal(rows.length, 129);
  assert.equal(expected.length, 16);
  assert.deepEqual(candidates.map((c) => c.boundaryIndex), expected.filter((i) => i !== gapIndex));
  assert.equal(reasons['capture-time-gap'], 1);
  assert.equal(buildGroups(rows, DEFAULT_SETTINGS).groups.length, 1); // Suggestions are review-only.
  for (const candidate of candidates) rows[candidate.boundaryIndex].markerOverride = 'split';
  assert.equal(buildGroups(rows, DEFAULT_SETTINGS).groups.length, 16);
  rows[gapIndex].markerOverride = 'split'; // Operator-provided label, not inferred continuity.
  const { groups, skippedMarkerCount } = buildGroups(rows, { ...DEFAULT_SETTINGS, skipMarkers: true });
  assert.deepEqual(groups.map((g) => g.files.length), [5, 5, 5, 5, 5, 5, 7, 13, 14, 8, 9, 7, 7, 9, 9, 7, 9]);
  assert.equal(skippedMarkerCount, 0);
  assert.equal(new Set(groups.flatMap((g) => g.files.map((r) => r.file))).size, 129);
  groups.forEach((g, i) => assert.deepEqual(g.files.map((r) => rows.findIndex((item) => item.file === r.file)),
    fixture.rows.flatMap((r, index) => r.pass === i + 1 ? [index] : [])));
});

test('elevation boundary decisions are independent of filenames, folders and circular yaw representation', () => {
  const rows = flight();
  rows.forEach((r, i) => { r.file.name = `${rows.length - i}.jpg`; r.file.webkitRelativePath = `arbitrary/${i % 3}/${r.file.name}`; r.gimbalYaw += i % 2 ? 360 : -360; });
  assert.deepEqual(findVisualPassCandidates(rows, DEFAULT_SETTINGS).candidates.map((c) => c.boundaryIndex), expected.filter((i) => i !== gapIndex));
});

test('pans retain the first new view through setup photos, continued ascents and wide turns', () => {
  const rows = flight();
  const candidates = findVisualPassCandidates(rows, DEFAULT_SETTINGS).candidates;
  for (const id of ['0870', '0880', '0891', '0899', '0913', '0935', '0945', '0960', '0979', '0987']) {
    const candidate = candidates.find((c) => fixture.rows[c.boundaryIndex].id === id);
    assert.equal(candidate.passEvidence, 'heading-change', id);
    assert.equal(candidate.comparisonBeforeIndex, null, id);
    assert.equal(candidate.comparisonAfterIndex, null, id);
    assert.equal(candidate.requiresVisualSupport, false, id);
  }
  const continued = candidates.find((c) => fixture.rows[c.boundaryIndex].id === '0891');
  assert.equal(continued.priorDirection, 'up');
  assert.equal(continued.nextDirection, 'up');
});

function pan() {
  return [12, 9, 6, 3, 3, 6, 9, 12].map((altitude, i) => ({
    file: { name: `${i}.jpg`, size: 1 }, latitude: 0, longitude: 0,
    altitude, altitudeSource: 'relative', pitch: 0, gimbalYaw: i < 4 ? 0 : 30,
    captureDate: new Date(i * 5000),
  }));
}
const boundaries = (rows) => findVisualPassCandidates(rows, DEFAULT_SETTINGS).candidates.map((c) => c.boundaryIndex);

test('sustained pan between vertical runs needs no lateral flight or invented image match', () => {
  const rows = pan();
  assert.deepEqual(boundaries(rows), [4]);
  const [candidate] = findVisualPassCandidates(rows, DEFAULT_SETTINGS).candidates;
  assert.equal(candidate.lateralMeters, 0);
  assert.equal(candidate.passEvidence, 'heading-change');
  assert.equal(candidate.comparisonBeforeIndex, null);
});

test('pans reject transient or gradual turns, stationary detail sweeps and incomplete vertical runs', () => {
  const changes = {
    'no turn': (r) => r.forEach((item) => { item.gimbalYaw = 0; }),
    'small correction': (r) => r.slice(4).forEach((item) => { item.gimbalYaw = 10; }),
    'single yaw spike': (r) => r.slice(5).forEach((item) => { item.gimbalYaw = 0; }),
    'gradual turn': (r) => r.forEach((item, i) => { item.gimbalYaw = i * 10; }),
    'turn beyond 90 degrees': (r) => r.slice(4).forEach((item) => { item.gimbalYaw = 100; }),
    'horizontal inspection only': (r) => r.forEach((item) => { item.altitude = 3; }),
    'no prior vertical run': (r) => r.slice(0, 4).forEach((item) => { item.altitude = 3; }),
    'no following vertical run': (r) => r.slice(4).forEach((item) => { item.altitude = 3; }),
    'tilt without following ascent': (r) => r.slice(4).forEach((item, i) => { item.altitude = 3; item.pitch = i * 10; }),
    'insufficient height overlap': (r) => { r[1].altitude = 8; r[2].altitude = 5.5; r.slice(4).forEach((item, i) => { item.altitude = 6 + i * 3; }); },
    'temporary GPS excursion': (r) => { r[5].longitude = 2 / 6371000 * 180 / Math.PI; },
    'forward approach': (r) => r.slice(4).forEach((item) => { item.latitude = 5 / 6371000 * 180 / Math.PI; }),
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = pan(); change(rows);
    assert.deepEqual(boundaries(rows), [], label);
  }
});

test('heading evidence respects telemetry continuity and manual decisions', () => {
  const changes = {
    'missing position': (r) => { r[4].latitude = null; },
    'missing yaw': (r) => { r[5].gimbalYaw = null; },
    'missing pitch': (r) => { r[5].pitch = null; },
    'missing time': (r) => { r[4].captureDate = null; },
    'duplicate time': (r) => { r[5].captureDate = r[4].captureDate; },
    'backwards time': (r) => { r[5].captureDate = new Date(r[4].captureDate.getTime() - 1000); },
    'long capture gap': (r) => r.slice(4).forEach((item) => { item.captureDate = new Date(item.captureDate.getTime() + 60000); }),
    'unknown altitude source': (r) => { r[5].altitudeSource = null; },
    'altitude source changes': (r) => r.slice(4).forEach((item) => { item.altitudeSource = 'absolute'; }),
    'keep decision': (r) => { r[4].markerOverride = 'normal'; },
    'accepted boundary': (r) => { r[4].markerOverride = 'split'; },
    'nearby marker': (r) => { r[3].markerOverride = 'marker'; },
    'separate reviewed pass ahead': (r) => { r[5].markerOverride = 'split'; },
    'separate reviewed pass behind': (r) => { r[3].markerOverride = 'split'; },
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = pan(); change(rows);
    assert.deepEqual(boundaries(rows), [], label);
  }
});

test('continued ascent needs a large persistent pan and a nearby position with forward height progress', () => {
  const continued = () => pan().map((r, i) => ({ ...r, altitude: i * 2, gimbalYaw: i < 4 ? 0 : 35 }));
  assert.deepEqual(boundaries(continued()), [4]);
  for (const change of [
    (r) => r.slice(4).forEach((item) => { item.gimbalYaw = 20; }),
    (r) => r.slice(4).forEach((item) => { item.longitude = 4 / 6371000 * 180 / Math.PI; }),
    (r) => r.slice(4).forEach((item) => { item.altitude -= 2; }),
  ]) { const rows = continued(); change(rows); assert.deepEqual(boundaries(rows), []); }
});
