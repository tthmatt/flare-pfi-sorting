import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraDisplacement, findVisualPassCandidates } from './visualPasses.js';
import { buildGroups } from './grouping.js';
import { buildReviewItems } from './review.js';

const fixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-calibration.json', import.meta.url)));
function flight() {
  return fixture.rows.map((r) => ({ ...r, file: { name: `image_${r.id}.jpg`, size: 1 },
    latitude: r.north / 6371000 * 180 / Math.PI, longitude: r.east / 6371000 * 180 / Math.PI,
    altitudeSource: 'relative', captureDate: new Date(r.seconds * 1000) }));
}
const settings = { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers: true };

test('confirmed sample proposes 0015, not the tilt, approach adjustment or first descent photo', () => {
  const rows = flight();
  const result = findVisualPassCandidates(rows, settings);
  assert.deepEqual(result.candidates.map((c) => rows[c.boundaryIndex].id), ['0015']);
  assert.ok(Math.abs(result.candidates[0].lateralMeters - 5.82) < 0.02);
  const before = buildGroups(rows, settings);
  assert.equal(before.groups.length, 2); // Suggestions alone cannot affect exports.
  rows[13].markerOverride = 'split';
  const after = buildGroups(rows, settings);
  assert.deepEqual(after.groups.map((group) => group.files.map((f) => f.id)), [
    ['0001', '0002', '0003', '0004', '0005', '0006', '0007'],
    ['0009', '0010', '0011', '0012', '0013'], ['0015', '0016', '0017'],
  ]);
  assert.equal(after.groups[2].startReason, 'manual-split');
  assert.equal(after.skippedMarkerCount, 1);
  rows[13].markerOverride = 'auto';
  assert.equal(buildGroups(rows, settings).groups.length, 2);
});

test('capture order and file identity govern a retained-photo boundary and its review placement', () => {
  const rows = flight(); rows[13].markerOverride = 'split';
  rows.forEach((r) => { r.file.name = 'duplicate.jpg'; });
  const input = [...rows].reverse(); const { groups } = buildGroups(input, settings);
  assert.equal(groups[2].files[0].file, rows[13].file);
  const review = buildReviewItems(input, groups, settings);
  assert.equal(review[13].file, rows[13].file);
  assert.equal(review[13].groupName, 'test_003');
  assert.equal(review[7].groupName, undefined);
});

test('no marker is needed at the proposed boundary, and filenames never determine the proposal', () => {
  const rows = flight().filter((r) => r.id !== '0008');
  rows.forEach((r) => { r.file.name = 'unlabelled.jpg'; });
  assert.deepEqual(findVisualPassCandidates(rows, settings).candidates.map((c) => rows[c.boundaryIndex].id), ['0015']);
});

test('missing telemetry, mixed altitude datums, gaps and camera turns are not silently inferred', () => {
  for (const change of [
    (r) => { r[13].latitude = null; }, (r) => { r[13].gimbalYaw = null; },
    (r) => { r[13].pitch = null; }, (r) => { r[13].captureDate = null; },
    (r) => { r[13].captureDate = new Date(NaN); },
    (r) => { r[13].captureDate = r[12].captureDate; },
    (r) => { r[13].captureDate = new Date(r[12].captureDate.getTime() + 61000); },
    (r) => { r[13].altitudeSource = 'absolute'; },
    (r) => { r[13].gimbalYaw += 30; }, (r) => { r[13].pitch = -30; },
    (r) => { r[13].markerOverride = 'normal'; }, (r) => { r[13].markerOverride = 'split'; },
    (r) => { r[13].pitch = -90; },
  ]) {
    const rows = flight(); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
  }
});

test('requires surrounding evidence and rejects a GPS jump that immediately returns to the old column', () => {
  assert.equal(findVisualPassCandidates(flight().slice(0, 14), settings).candidates.length, 0);
  const rows = flight(); rows[14].latitude = rows[12].latitude; rows[14].longitude = rows[12].longitude;
  assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
});

test('heading wraps at north and distinguishes approaching a facade from moving sideways', () => {
  const a = { latitude: 0, longitude: 0, gimbalYaw: 0 };
  const forward = cameraDisplacement(a, { ...a, latitude: 0.0001 });
  const side = cameraDisplacement(a, { ...a, longitude: 0.0001 });
  assert.equal(forward.lateral, 0); assert.ok(forward.forward > 10);
  assert.equal(side.forward, 0); assert.ok(side.lateral > 10);
  const crossing = cameraDisplacement({ ...a, longitude: 179.99999 }, { ...a, longitude: -179.99999 });
  assert.ok(crossing.lateral > 2 && crossing.lateral < 3);
});
