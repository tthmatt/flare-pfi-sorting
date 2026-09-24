import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildGroups } from './grouping.js';
import { makeCsvReport, makeZip } from './reports.js';

test('accepted inspection boundary retains the original photo and records manual-split even when skipping markers', async () => {
  const items = [-10, -90, 0, -10].map((pitch, index) => ({
    file: Object.assign(Buffer.from(`unchanged-${index}`), { name: `${index}.jpg`, size: 11 }),
    pitch, captureDate: new Date(1000 * index), markerOverride: index === 2 ? 'split' : 'auto',
  }));
  const { groups, skippedMarkerCount } = buildGroups(items, { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers: true });
  assert.equal(skippedMarkerCount, 1);
  assert.equal(groups[1].startReason, 'manual-split');
  const zip = await JSZip.loadAsync(await (await makeZip(groups, false, true)).arrayBuffer());
  assert.equal(await zip.file('test_002/2.jpg').async('string'), 'unchanged-2');
  assert.equal(zip.file('test_002/1.jpg'), null);
  assert.match(await zip.file('sort_report.csv').async('string'), /manual-split/);
  // An explicit keep-photo split also preserves a photo recorded at -90 degrees.
  items[2].pitch = -90;
  assert.equal(buildGroups(items, { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers: true }).groups[1].files[0].file, items[2].file);
});

test('corrected folders and CSV reach the ZIP while original file bytes remain unchanged', async () => {
  const items = [-10, 0, -20].map((pitch, index) => ({
    file: Object.assign(Buffer.from(`original-photo-${index}`), { name: `${index}.jpg`, size: 16 }),
    pitch, altitude: 9.1, captureDate: new Date('2026-07-15T16:58:22Z'), markerOverride: index === 1 ? 'marker' : 'auto',
  }));
  for (const skipMarkers of [false, true]) {
    const { groups } = buildGroups(items, { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers });
    const blob = await makeZip(groups, false, true);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
    assert.deepEqual(paths, skipMarkers
      ? ['test_001/0.jpg', 'test_002/2.jpg', 'sort_report.csv']
      : ['test_001/0.jpg', 'test_002/1.jpg', 'test_002/2.jpg', 'sort_report.csv']);
    assert.equal(await zip.file('test_002/2.jpg').async('string'), 'original-photo-2');
    const csv = await zip.file('sort_report.csv').async('string');
    assert.equal(csv, makeCsvReport(groups));
    assert.match(csv, /manual-marker/);
    assert.match(csv, /2026-07-15T16:58:22.000Z/);
    if (!skipMarkers) {
      assert.match(csv, /"1.jpg","0"/);
      assert.equal(await zip.file('test_002/1.jpg').async('string'), 'original-photo-1');
    }
  }
});
