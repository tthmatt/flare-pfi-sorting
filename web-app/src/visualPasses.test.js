import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraDisplacement, findVisualPassCandidates } from './visualPasses.js';
import { buildGroups } from './grouping.js';
import { buildReviewItems } from './review.js';

const fixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-calibration.json', import.meta.url)));
const tiltFixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-pitch-adjustment.json', import.meta.url)));
const sweepFixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-camera-sweep.json', import.meta.url)));
function flight(source = fixture) {
  return source.rows.map((r) => ({ ...r, file: { name: `image_${r.id}.jpg`, size: 1 },
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
    (r) => { r[13].gimbalYaw += 30; }, (r) => { r[13].pitch = -75; },
    (r) => { r[13].markerOverride = 'normal'; }, (r) => { r[13].markerOverride = 'split'; },
    (r) => { r[13].pitch = -90; },
  ]) {
    const rows = flight(); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
  }
});

const partialFlight = () => flight(tiltFixture).slice(8);

test('short tilted sample suggests 0070, comparing 0066/0071 without moving the boundary', () => {
  const rows = partialFlight();
  rows.forEach((row) => { row.file.name = 'same-name.jpg'; });
  const { candidates } = findVisualPassCandidates(rows, settings);
  assert.deepEqual(candidates.map((c) => rows[c.boundaryIndex].id), ['0070']);
  const [candidate] = candidates;
  assert.equal(candidate.passEvidence, 'partial');
  assert.equal(candidate.priorDirection, null);
  assert.equal(candidate.nextDirection, 'up');
  assert.ok(Math.abs(candidate.lateralMeters - 2.306) < 0.01);
  assert.equal(rows[candidate.comparisonBeforeIndex].id, '0066');
  assert.equal(rows[candidate.comparisonAfterIndex].id, '0071');
  assert.equal(buildGroups(rows, settings).groups.length, 1);
  rows[candidate.boundaryIndex].markerOverride = 'split';
  const { groups } = buildGroups(rows, settings);
  assert.deepEqual(groups.map((g) => g.files.map((r) => r.id)), [['0065', '0066', '0067', '0068'], ['0070', '0071', '0072']]);
  assert.equal(groups[1].startReason, 'manual-split');
});

test('combined excerpts retain the 0062 suggestion and add only 0070', () => {
  const rows = flight(tiltFixture);
  const { candidates } = findVisualPassCandidates(rows, settings);
  assert.deepEqual(candidates.map((c) => rows[c.boundaryIndex].id), ['0062', '0070']);
  assert.equal(candidates[0].passEvidence, 'established');
  assert.equal(candidates[0].comparisonBeforeIndex, candidates[0].beforeIndex);
  assert.equal(candidates[0].comparisonAfterIndex, candidates[0].boundaryIndex);
  for (const c of candidates) rows[c.boundaryIndex].markerOverride = 'split';
  assert.deepEqual(buildGroups(rows, settings).groups.map((g) => g.files.length), [5, 7, 3]);
});

test('steady-height camera sweeps propose only 0024, require image support and keep the inspection photo', () => {
  const rows = flight(sweepFixture);
  rows.forEach((row) => { row.file.name = 'same-name.jpg'; });
  const { candidates } = findVisualPassCandidates(rows, settings);
  assert.deepEqual(candidates.map((c) => rows[c.boundaryIndex].id), ['0024']);
  const [candidate] = candidates;
  assert.equal(candidate.passEvidence, 'camera-sweep');
  assert.equal(candidate.requiresVisualSupport, true);
  assert.equal(candidate.priorDirection, 'down');
  assert.equal(candidate.nextDirection, 'up');
  assert.ok(Math.abs(candidate.lateralMeters - 1.263) < 0.01);
  assert.equal(candidate.altitudeDelta, 0);
  assert.equal(rows[candidate.comparisonBeforeIndex].id, '0020');
  assert.equal(rows[candidate.comparisonAfterIndex].id, '0026');
  assert.equal(buildGroups(rows, settings).groups.length, 1);
  rows[candidate.boundaryIndex].markerOverride = 'split';
  assert.deepEqual(buildGroups(rows, settings).groups.map((g) => g.files.map((r) => r.id)),
    [['0020', '0021', '0022'], ['0024', '0025', '0026']]);
  rows[candidate.boundaryIndex].markerOverride = 'auto';
  assert.equal(buildGroups(rows, settings).groups.length, 1);
});

test('surrounding altitude changes do not hide a complete camera sweep beside the boundary', () => {
  const rows = flight(sweepFixture);
  rows.unshift({ ...rows[0], id: 'earlier', altitude: 7, captureDate: new Date(-5000) });
  rows.push({ ...rows.at(-1), id: 'later', altitude: 7, captureDate: new Date(31000) });
  const { candidates } = findVisualPassCandidates(rows, settings);
  assert.deepEqual(candidates.map((c) => rows[c.boundaryIndex].id), ['0024']);
  assert.equal(rows[candidates[0].comparisonBeforeIndex].id, '0020');
  assert.equal(rows[candidates[0].comparisonAfterIndex].id, '0026');
});

test('camera sweeps reject stationary tilts, small shifts, approaches and unstable GPS positions', () => {
  const changes = {
    stationary: (rows) => { for (const r of rows) { r.latitude = 0; r.longitude = 0; } },
    'sub-metre shift': (rows) => { for (const r of rows) { r.latitude *= 0.5; r.longitude *= 0.5; } },
    approach: (rows) => { for (const r of rows) r.gimbalYaw -= 90; },
    'GPS jump': (rows) => { rows[4].latitude = rows[2].latitude; rows[4].longitude = rows[2].longitude; },
    'horizontal drift': (rows) => { rows[4].latitude += 0.3 / 6371000 * 180 / Math.PI; },
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = flight(sweepFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0, label);
  }
});

test('camera sweeps need two deliberate reversed tilts on each side at steady height', () => {
  const changes = {
    'same direction': (rows) => { [-1, -20, -40].forEach((pitch, i) => { rows[i + 3].pitch = pitch; }); },
    'small tilt': (rows) => { for (const r of rows) r.pitch /= 4; },
    'single tilt': (rows) => { rows[1].pitch = rows[0].pitch; },
    'backtracking tilt': (rows) => { rows[1].pitch = 10; },
    'missing pitch': (rows) => { rows[1].pitch = null; },
    'altitude change': (rows) => { rows[1].altitude += 0.8; },
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = flight(sweepFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0, label);
  }
  assert.equal(findVisualPassCandidates(flight(sweepFixture).slice(1), settings).candidates.length, 0);
  assert.equal(findVisualPassCandidates(flight(sweepFixture).slice(0, -1), settings).candidates.length, 0);
});

test('camera sweeps honor marker decisions and require consistent metadata', () => {
  for (const change of [
    (r) => { r[3].markerOverride = 'normal'; }, (r) => { r[3].markerOverride = 'split'; },
    (r) => { r[2].pitch = -90; }, (r) => { r[2].markerOverride = 'marker'; },
    (r) => { r[3].gimbalYaw += 15; }, (r) => { r[3].latitude = null; },
    (r) => { r[3].altitudeSource = 'absolute'; }, (r) => { r[3].captureDate = null; },
    (r) => { r[3].captureDate = new Date(r[2].captureDate.getTime() + 61000); },
  ]) {
    const rows = flight(sweepFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
  }
});

test('a small sideways shift is not enough for ordinary altitude-pass suggestions', () => {
  const rows = partialFlight();
  for (const r of rows) { r.latitude *= 0.55; r.longitude *= 0.55; }
  assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
});

test('partial evidence does not turn tilts, approaches, transient GPS jumps or horizontal-only moves into passes', () => {
  for (const change of [
    // Camera tilt alone while remaining in the same column.
    (rows) => { for (const r of rows) { r.latitude = 0; r.longitude = 0; } },
    // Move parallel to the viewing direction instead of sideways.
    (rows) => { for (const r of rows) r.gimbalYaw -= 90; },
    // GPS jump returns to the old column.
    (rows) => { rows[5].latitude = rows[3].latitude; rows[5].longitude = rows[3].longitude; },
    (rows) => { for (const r of rows.slice(4)) r.altitude = 5.3; },
    // A partial but clearly ascending prior pass followed by continued ascent.
    (rows) => { [3.5, 4.4, 5.1, 5.1].forEach((h, i) => { rows[i].altitude = h; }); },
    (rows) => { rows[4].gimbalYaw += 15; },
    (rows) => { rows[4].pitch = null; },
    (rows) => { rows[4].altitudeSource = 'absolute'; },
    (rows) => { rows[4].captureDate = new Date(rows[3].captureDate.getTime() + 61000); },
    (rows) => { rows[4].markerOverride = 'normal'; },
    (rows) => { rows[3].markerOverride = 'marker'; },
  ]) {
    const rows = partialFlight(); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
  }
  assert.equal(findVisualPassCandidates(partialFlight().slice(0, 6), settings).candidates.length, 0);
});

test('without comparable camera angles a metadata proposal has no invented visual pair', () => {
  const rows = partialFlight();
  for (const row of rows.slice(0, 4)) row.pitch = -40;
  for (const row of rows.slice(4)) row.pitch = 0;
  const [candidate] = findVisualPassCandidates(rows, settings).candidates;
  assert.equal(candidate.boundaryIndex, 4);
  assert.equal(candidate.comparisonBeforeIndex, null);
  assert.equal(candidate.comparisonAfterIndex, null);
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
