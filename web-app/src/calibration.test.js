import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalibrationReport } from './calibration.js';

test('calibration report recursively excludes sensitive and binary source data', () => {
  const file = { name: 'safe.jpg', path: '/secret/safe.jpg', webkitRelativePath: 'private/safe.jpg', bytes: new Uint8Array([1]) };
  const report = createCalibrationReport({
    appVersion: '0.3.6', settings: { gpsWindowSize: 3, latitude: 1 },
    analyses: [{ file, latitude: 1.3, longitude: 103.8, captureDate: new Date(), pitch: -20, altitudeSource: 'relative', rawMetadata: 'secret', objectUrl: 'blob:secret' }],
    proposals: [{ boundaryIndex: 0, detectedAtIndex: 0, boundaryFile: 'safe.jpg', detectedAtFile: 'safe.jpg', reason: 'gps-horizontal-turn', status: 'proposed', evidence: { gpsDisplacementM: 8 }, latitude: 1.3, file }],
    reasonCounts: { 'insufficient-gps': 2 }, decisions: { 0: { state: 'confirmed', boundaryIndex: 0, boundaryFile: 'safe.jpg' } },
    missedBoundaries: [], fullFlightReviewed: true, exportedAt: new Date('2026-08-11T00:00:00Z'),
  });
  const serialized = JSON.stringify(report);
  for (const forbidden of ['latitude', 'longitude', 'rawMetadata', 'webkitRelativePath', '/secret', 'blob:', 'bytes', 'private/safe']) assert.equal(serialized.includes(forbidden), false, forbidden);
  const visit = (value) => { if (value && typeof value === 'object') { assert.equal(value instanceof Blob, false); assert.equal(value instanceof Uint8Array, false); for (const child of Object.values(value)) visit(child); } };
  visit(report);
  assert.equal(report.reviewComplete, true);
});
