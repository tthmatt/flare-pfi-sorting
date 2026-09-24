import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPreviewMovements } from './previewMovement.js';
import { buildGroups } from './grouping.js';

const degree = (meters) => meters / 6371000 * 180 / Math.PI;
const photo = (name, seconds, east, gimbalYaw = 0) => ({ file: { name, size: 1 },
  captureDate: new Date(seconds * 1000), latitude: 0, longitude: degree(east), gimbalYaw, pitch: 0 });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} should be near ${expected}`);

test('movement follows capture order and file identity instead of input order or duplicate filenames', () => {
  const first = photo('z.jpg', 0, 0); const second = photo('a.jpg', 1, 3); const third = photo('a.jpg', 2, 2);
  const input = [third, first, second];
  const movements = buildPreviewMovements(input);
  assert.equal(movements.get(first.file).reason, 'first-photo');
  assert.equal(movements.get(first.file).meters, null);
  close(movements.get(second.file).meters, 3);
  close(movements.get(third.file).meters, -1);
  assert.equal(movements.get(second.file).previousFile, first.file);
  assert.equal(movements.get(third.file).previousFile, second.file);
  assert.deepEqual(input, [third, first, second]);
});

test('sideways uses the previous camera heading and distinguishes stationary from unavailable', () => {
  const first = photo('1.jpg', 0, 0, 90); const next = photo('2.jpg', 1, 0, 0);
  next.latitude = degree(3);
  close(buildPreviewMovements([first, next]).get(next.file).meters, -3);
  next.latitude = 0;
  close(buildPreviewMovements([first, next]).get(next.file).meters, 0);
  first.gimbalYaw = null;
  assert.equal(buildPreviewMovements([first, next]).get(next.file).reason, 'missing-heading');
  first.gimbalYaw = 0; next.longitude = null;
  const unavailable = buildPreviewMovements([first, next]).get(next.file);
  assert.equal(unavailable.reason, 'missing-gps');
  assert.equal(unavailable.meters, null);
  next.longitude = 181;
  assert.equal(buildPreviewMovements([first, next]).get(next.file).reason, 'missing-gps');
});

test('missing, invalid and tied capture times never silently create a comparison', () => {
  const first = photo('1.jpg', 0, 0); const missing = photo('2.jpg', 1, 1); const next = photo('3.jpg', 2, 3);
  missing.captureDate = null;
  let movements = buildPreviewMovements([missing, next, first]);
  assert.equal(movements.get(missing.file).reason, 'missing-time');
  assert.equal(movements.get(next.file).previousFile, first.file);
  close(movements.get(next.file).meters, 3);
  missing.captureDate = new Date(NaN);
  assert.equal(buildPreviewMovements([missing]).get(missing.file).reason, 'missing-time');
  missing.captureDate = first.captureDate;
  movements = buildPreviewMovements([first, missing, next]);
  for (const item of [first, missing, next]) {
    assert.equal(movements.get(item.file).reason, 'ambiguous-time');
    assert.equal(movements.get(item.file).meters, null);
  }
});

test('skipped markers remain reference photos without changing folders or source records', () => {
  const rows = [photo('1.jpg', 0, 0), photo('2.jpg', 1, 1), photo('3.jpg', 2, 4)];
  rows[1].pitch = -90;
  const settings = { markerPitch: -90, tolerance: 2, folderPrefix: 'test', sortBy: 'filename', skipMarkers: true };
  const before = structuredClone(rows);
  const grouping = buildGroups(rows, settings);
  assert.equal(grouping.skippedMarkerCount, 1);
  const movements = buildPreviewMovements(rows);
  close(movements.get(rows[2].file).meters, 3);
  assert.equal(movements.get(rows[2].file).previousFile, rows[1].file);
  assert.deepEqual(rows, before);
  assert.deepEqual(buildGroups(rows, settings), grouping);
});

test('operator samples display about 2.90 m at 0062 and 2.31 m at 0070', () => {
  const fixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-pitch-adjustment.json', import.meta.url)));
  const rows = fixture.rows.map((row) => ({ ...photo(`${row.id}.jpg`, row.seconds, row.east, row.gimbalYaw), latitude: degree(row.north) }));
  const movements = buildPreviewMovements(rows);
  for (const [name, expected] of [['0062.jpg', 2.895], ['0070.jpg', 2.306]]) {
    close(movements.get(rows.find((row) => row.file.name === name).file).meters, expected);
  }
});
