import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildGroups } from './grouping.js';
import { makeCsvReport, makeZip } from './reports.js';

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
