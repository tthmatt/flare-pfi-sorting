import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraDisplacement, findVisualPassCandidates } from './visualPasses.js';
import { buildGroups } from './grouping.js';
import { buildReviewItems } from './review.js';

const fixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-calibration.json', import.meta.url)));
const tiltFixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-pitch-adjustment.json', import.meta.url)));
const sweepFixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-camera-sweep.json', import.meta.url)));
const shortTiltFixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-short-tilted-return.json', import.meta.url)));
const viewpointFixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-viewpoint-change.json', import.meta.url)));
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

test('an ascent followed by a short tilted return proposes 0076 and preserves the real marker at 0078', () => {
  const rows = flight(shortTiltFixture);
  rows.forEach((row) => { row.file.name = 'same-name.jpg'; });
  const { candidates } = findVisualPassCandidates(rows, settings);
  assert.deepEqual(candidates.map((c) => rows[c.boundaryIndex].id), ['0076']);
  const [candidate] = candidates;
  assert.equal(candidate.passEvidence, 'tilted-return');
  assert.equal(candidate.priorDirection, 'up');
  assert.equal(candidate.nextDirection, 'down');
  assert.ok(Math.abs(candidate.lateralMeters - 3.494) < 0.01);
  assert.equal(candidate.requiresVisualSupport, false);
  assert.equal(candidate.comparisonBeforeIndex, null); // A 33° angle change is not an aligned comparison.
  assert.equal(candidate.comparisonAfterIndex, null);
  assert.deepEqual(buildGroups(rows, settings).groups.map((g) => g.files.length), [7]);
  rows[candidate.boundaryIndex].markerOverride = 'split';
  const result = buildGroups(rows, settings);
  assert.deepEqual(result.groups.map((g) => g.files.map((r) => r.id)),
    [['0070', '0071', '0072', '0073', '0074'], ['0076', '0077']]);
  assert.equal(result.skippedMarkerCount, 1);
  const retained = buildGroups(rows, { ...settings, skipMarkers: false });
  assert.deepEqual(retained.groups.map((g) => g.files.map((r) => r.id)),
    [['0070', '0071', '0072', '0073', '0074'], ['0076', '0077'], ['0078']]);
  assert.equal(retained.groups[2].startReason, 'pitched-down');
  rows[candidate.boundaryIndex].markerOverride = 'auto';
  assert.deepEqual(buildGroups(rows, settings).groups.map((g) => g.files.length), [7]);
});

test('a short tilted return needs an established prior pass and a deliberate opposite tilt', () => {
  const changes = {
    'stationary tilt only': (rows) => { for (const r of rows) { r.latitude = 0; r.longitude = 0; } },
    'short sideways move': (rows) => { for (const r of rows) { r.latitude *= 0.5; r.longitude *= 0.5; } },
    approach: (rows) => { for (const r of rows) r.gimbalYaw += 90; },
    'no prior altitude motion': (rows) => { for (const r of rows) r.altitude = 11.5; },
    'partial prior altitude motion': (rows) => { [9.2, 9.2, 9.8, 10.6, 11.5].forEach((h, i) => { rows[i].altitude = h; }); },
    'conflicting prior motion': (rows) => { rows[2].altitude = 10.5; },
    'continued upward coverage': (rows) => { rows[6].pitch = -20; },
    'small pitch adjustment': (rows) => { rows[6].pitch = -36; },
    'missing return pitch': (rows) => { rows[6].pitch = null; },
    'unstable return altitude': (rows) => { rows[6].altitude += 0.8; },
    'transient GPS jump': (rows) => { rows[6].latitude = rows[4].latitude; rows[6].longitude = rows[4].longitude; },
    'forward drift': (rows) => { rows[6].latitude += 1 / 6371000 * 180 / Math.PI; },
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = flight(shortTiltFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0, label);
  }
});

test('two tilted inspection photos need a nearby marker endpoint with matching telemetry', () => {
  assert.equal(findVisualPassCandidates(flight(shortTiltFixture).slice(0, -1), settings).candidates.length, 0);
  const changes = {
    'ordinary final photo': (rows) => { rows[7].pitch = -47.8; },
    'marker ignored manually': (rows) => { rows[7].markerOverride = 'normal'; },
    'marker reused as inspection start': (rows) => { rows[7].markerOverride = 'split'; },
    'marker at another position': (rows) => { rows[7].latitude = rows[4].latitude; rows[7].longitude = rows[4].longitude; },
    'missing marker position': (rows) => { rows[7].latitude = null; },
    'missing marker heading': (rows) => { rows[7].gimbalYaw = null; },
    'marker heading change': (rows) => { rows[7].gimbalYaw += 20; },
    'mixed marker altitude source': (rows) => { rows[7].altitudeSource = 'absolute'; },
    'marker at another height': (rows) => { rows[7].altitude += 1; },
    'missing marker time': (rows) => { rows[7].captureDate = null; },
    'duplicate marker time': (rows) => { rows[7].captureDate = rows[6].captureDate; },
    'late marker': (rows) => { rows[7].captureDate = new Date(rows[6].captureDate.getTime() + 61000); },
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = flight(shortTiltFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0, label);
  }
});

test('the next marker cannot supply a missing tilt step or override a reviewed boundary', () => {
  for (const change of [
    (r) => { r.splice(6, 1); }, // Only one inspection photo before the marker.
    (r) => { r[6].pitch = r[5].pitch; },
    (r) => { r[5].markerOverride = 'normal'; },
    (r) => { r[5].markerOverride = 'split'; },
    (r) => { r[4].markerOverride = 'marker'; },
    (r) => { r[5].altitudeSource = 'absolute'; },
    (r) => { r[5].captureDate = new Date(r[4].captureDate.getTime() + 61000); },
  ]) {
    const rows = flight(shortTiltFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
  }
});

test('a complete three-photo tilted return can supply its own evidence without an ending marker', () => {
  const rows = flight(shortTiltFixture);
  rows[7].pitch = -59;
  const { candidates } = findVisualPassCandidates(rows, settings);
  assert.deepEqual(candidates.map((c) => rows[c.boundaryIndex].id), ['0076']);
  assert.equal(candidates[0].passEvidence, 'tilted-return');
});

test('a descent can likewise return by tilting upwards in the next column', () => {
  const rows = flight(shortTiltFixture);
  rows.forEach((r) => { r.altitude = 20 - r.altitude; });
  [rows[5].pitch, rows[6].pitch] = [rows[6].pitch, rows[5].pitch];
  const [candidate] = findVisualPassCandidates(rows, settings).candidates;
  assert.equal(candidate.boundaryIndex, 5);
  assert.equal(candidate.priorDirection, 'down');
  assert.equal(candidate.nextDirection, 'up');
});

test('stable vertical passes with a changed viewpoint suggest only 0865 and keep every inspection photo', () => {
  const rows = flight(viewpointFixture);
  rows.forEach((r) => { r.file.name = 'same-name.jpg'; });
  const { candidates } = findVisualPassCandidates(rows, settings);
  assert.deepEqual(candidates.map((c) => rows[c.boundaryIndex].id), ['0865']);
  const [candidate] = candidates;
  assert.equal(candidate.passEvidence, 'changed-viewpoint');
  assert.equal(candidate.priorDirection, 'down');
  assert.equal(candidate.nextDirection, 'up');
  assert.ok(Math.abs(candidate.lateralMeters - 10.738) < 0.01);
  assert.ok(Math.abs(candidate.headingChangeDegrees - 38.4) < 0.01);
  assert.equal(candidate.altitudeDelta, -2.2);
  assert.equal(candidate.comparisonBeforeIndex, null); // Heading differs by about 39° in every possible pair.
  assert.equal(candidate.comparisonAfterIndex, null);
  assert.equal(candidate.requiresVisualSupport, false);
  assert.deepEqual(buildGroups(rows, settings).groups.map((g) => g.files.length), [11]);
  rows[candidate.boundaryIndex].markerOverride = 'split';
  assert.deepEqual(buildGroups(rows, settings).groups.map((g) => g.files.map((r) => r.id)), [
    ['0859', '0860', '0861', '0862', '0863', '0864'], ['0865', '0866', '0867', '0868', '0869'],
  ]);
  rows[candidate.boundaryIndex].markerOverride = 'auto';
  assert.deepEqual(buildGroups(rows, settings).groups.map((g) => g.files.length), [11]);
});

test('heading changes and height offsets each require complete pass evidence, with circular yaw handling', () => {
  for (const change of [
    (r) => { for (const item of r.slice(6)) item.altitude += 2.2; }, // Heading change only.
    (r) => { for (const item of r.slice(6)) item.gimbalYaw = r[5].gimbalYaw; }, // Height offset only.
    (r) => { for (const item of r.slice(6)) item.gimbalYaw -= 360; }, // Equivalent headings across ±180°.
    (r) => { for (const item of r) item.altitude = 20 - item.altitude; }, // Ascent followed by descent.
  ]) {
    const rows = flight(viewpointFixture); change(rows);
    assert.deepEqual(findVisualPassCandidates(rows, settings).candidates.map((c) => rows[c.boundaryIndex].id), ['0865']);
  }
});

test('a changed viewpoint needs sustained opposing vertical passes with overlapping height ranges', () => {
  const changes = {
    'flat prior pass': (r) => { for (const item of r.slice(0, 6)) item.altitude = 4.2; },
    'partial prior pass': (r) => { [5.9, 5.8, 5.7, 5.2, 4.7, 4.2].forEach((h, i) => { r[i].altitude = h; }); },
    'partial return': (r) => { [2, 2.8, 3.6, 4.4, 5.2].forEach((h, i) => { r[i + 6].altitude = h; }); },
    'same-direction return': (r) => { [2, 0, -2, -4, -6].forEach((h, i) => { r[i + 6].altitude = h; }); },
    'conflicting prior steps': (r) => { r[3].altitude = 10.5; },
    'conflicting return steps': (r) => { r[8].altitude = 3; },
    'non-overlapping heights': (r) => { [7, 9, 11, 13, 15].forEach((h, i) => { r[i + 6].altitude = h; }); },
    'camera sweep without ascent': (r) => { for (const [i, item] of r.slice(6).entries()) { item.altitude = 2; item.pitch = i * 10; } },
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = flight(viewpointFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0, label);
  }
  assert.equal(findVisualPassCandidates(flight(viewpointFixture).slice(0, 8), settings).candidates.length, 0);
  assert.equal(findVisualPassCandidates(flight(viewpointFixture).slice(4), settings).candidates.length, 0);
});

test('changed viewpoints reject stationary turns, small shifts, approaches, unstable clusters and large height gaps', () => {
  const changes = {
    'stationary turn': (r) => { for (const item of r) { item.latitude = 0; item.longitude = 0; } },
    'small shift': (r) => { for (const item of r) { item.latitude *= 0.3; item.longitude *= 0.3; } },
    'forward approach': (r) => { for (const item of r) item.gimbalYaw += 90; },
    'temporary GPS jump': (r) => { r[7].latitude = r[5].latitude; r[7].longitude = r[5].longitude; },
    'prior GPS drift': (r) => { r[3].latitude += 3 / 6371000 * 180 / Math.PI; },
    'return forward drift': (r) => { r[7].latitude += 2 / 6371000 * 180 / Math.PI; },
    'large height gap': (r) => { r[6].altitude = -2; },
    'height-dominated move': (r) => {
      for (const item of r) { item.latitude *= 0.55; item.longitude *= 0.55; }
      r[6].altitude = 0.5;
    },
  };
  for (const [label, change] of Object.entries(changes)) {
    const rows = flight(viewpointFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0, label);
  }
});

test('motion must remain lateral in both headings even when the midpoint frame looks sideways', () => {
  const rows = flight(viewpointFixture); const previous = rows[5]; const next = rows[6];
  const midpointYaw = previous.gimbalYaw - 38.4 / 2;
  const heading = midpointYaw * Math.PI / 180;
  const north = -10 * Math.sin(heading) - 4.9 * Math.cos(heading);
  const east = 10 * Math.cos(heading) - 4.9 * Math.sin(heading);
  const latitudeOffset = previous.latitude + north / 6371000 * 180 / Math.PI - next.latitude;
  const longitudeOffset = previous.longitude + east / 6371000 * 180 / Math.PI - next.longitude;
  for (const item of rows.slice(6)) { item.latitude += latitudeOffset; item.longitude += longitudeOffset; }
  const middle = cameraDisplacement({ ...previous, gimbalYaw: midpointYaw }, next);
  const endFrame = cameraDisplacement({ ...previous, gimbalYaw: next.gimbalYaw }, next);
  assert.ok(Math.abs(middle.lateral) > 2 * Math.abs(middle.forward));
  assert.ok(Math.abs(endFrame.forward) > Math.abs(endFrame.lateral));
  assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
});

test('changed viewpoints reject unstable headings, missing telemetry and reviewed or marked boundaries', () => {
  for (const change of [
    (r) => { for (const item of r.slice(6)) item.gimbalYaw = 160; }, // Turn exceeds 45°.
    (r) => { r[7].gimbalYaw += 15; }, (r) => { r[4].gimbalYaw += 15; },
    (r) => { r[6].latitude = null; }, (r) => { r[7].gimbalYaw = null; },
    (r) => { r[7].pitch = null; }, (r) => { r[6].captureDate = null; },
    (r) => { r[6].altitudeSource = 'absolute'; }, (r) => { r[4].altitudeSource = 'absolute'; },
    (r) => { r[6].captureDate = new Date(r[5].captureDate.getTime() + 61000); },
    (r) => { r[7].captureDate = r[6].captureDate; },
    (r) => { r[6].markerOverride = 'normal'; }, (r) => { r[6].markerOverride = 'split'; },
    (r) => { r[5].markerOverride = 'marker'; }, (r) => { r[5].pitch = -90; },
  ]) {
    const rows = flight(viewpointFixture); change(rows);
    assert.equal(findVisualPassCandidates(rows, settings).candidates.length, 0);
  }
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
