import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildGroups } from './grouping.js';
import { makeZip } from './reports.js';
import { groupingOrder } from './ordering.js';
import { applyEdits, buildReviewQueue, changeMarker, emptyEdits, historyReducer, indexFiles, mergeGroup, moveBoundary, nameGroups } from './workspace.js';

const settings = { markerPitch: -90, tolerance: 2, skipMarkers: true, sortBy: 'capture', folderPrefix: 'test' };
test('manual splits and joins use capture order even when the display was configured by filename', () => {
  assert.equal(groupingOrder([{ boundaryOverride: 'join' }], { sortBy: 'filename' }), 'capture');
  assert.equal(groupingOrder([{ markerOverride: 'split' }], { sortBy: 'filename' }), 'capture');
  assert.equal(groupingOrder([], { sortBy: 'filename', inferAltitudeTurns: true }), 'capture');
  assert.equal(groupingOrder([], { sortBy: 'filename' }), 'filename');
});
function sample() {
  const records = [-20, -30, -90, -40, -30, -20].map((pitch, i) => ({ file: Object.assign(Buffer.from(`photo-${i}`), { name: `${i}.jpg`, size: 7, lastModified: 1000 + i }), pitch, altitude: 10, captureDate: new Date(1000 * i), gimbalYaw: 0, warnings: [] }));
  const ids = indexFiles(records.map((item) => item.file));
  const plan = (edits) => nameGroups(buildGroups(applyEdits(records, ids, edits), settings).groups, ids, edits.names);
  return { records, ids, plan };
}

test('merging across a skipped marker preserves the excluded image and all inspection bytes in ZIP/CSV', async () => {
  const { records, ids, plan } = sample(); const original = emptyEdits();
  const edits = mergeGroup(original, 1, plan(original), records, ids);
  const groups = plan(edits);
  assert.equal(groups.length, 1); assert.equal(groups[0].files.length, 5);
  assert.equal(groups[0].files.some((item) => item.file === records[2].file), false);
  const zip = await JSZip.loadAsync(await (await makeZip(groups, false, true)).arrayBuffer());
  for (const i of [0, 1, 3, 4, 5]) assert.equal(await zip.file(`test_001/${i}.jpg`).async('string'), `photo-${i}`);
  assert.equal(zip.file('test_001/2.jpg'), null);
  assert.match(await zip.file('sort_report.csv').async('string'), /boundary_override/);
});

test('moving a boundary works on retained photos, preserves custom name, and undo restores all edits', () => {
  const { records, ids, plan } = sample(); let edits = emptyEdits();
  edits.names[ids.get(records[3].file)] = 'West elevation';
  const before = plan(edits);
  const later = moveBoundary(edits, 1, 1, before, records, ids);
  assert.deepEqual(plan(later).map((g) => g.files.length), [3, 2]);
  assert.equal(plan(later)[1].name, 'West_elevation');
  assert.equal(plan(later)[1].files[0].file, records[4].file);
  const earlier = moveBoundary(edits, 1, -1, before, records, ids);
  assert.deepEqual(plan(earlier).map((g) => g.files.length), [1, 4]);
  let history = { past: [], present: edits, future: [] };
  history = historyReducer(history, { type: 'edit', value: later });
  history = historyReducer(history, { type: 'undo' }); assert.deepEqual(history.present, edits);
  history = historyReducer(history, { type: 'redo' }); assert.deepEqual(history.present, later);
  history = historyReducer(historyReducer(history, { type: 'undo' }), { type: 'edit', value: earlier });
  assert.equal(history.future.length, 0);
});

test('boundary moves cannot consume the only photo of either neighbouring pass', () => {
  const { records, ids, plan } = sample();
  const edits = changeMarker(emptyEdits(), ids.get(records[5].file), 'split');
  assert.equal(moveBoundary(edits, 2, 1, plan(edits), records, ids), edits);
  assert.equal(mergeGroup(edits, 0, plan(edits), records, ids), edits);
});

test('renames are safe and collision-free, and exporting selected groups includes only their records', async () => {
  const { records, ids, plan } = sample();
  const edits = emptyEdits(); edits.names[ids.get(records[0].file)] = '../West/Face'; edits.names[ids.get(records[3].file)] = 'West-Face';
  const groups = plan(edits);
  assert.deepEqual(groups.map((g) => g.name), ['West-Face', 'West-Face_2']);
  const zip = await JSZip.loadAsync(await (await makeZip([groups[1]], false, true)).arrayBuffer());
  assert.deepEqual(Object.keys(zip.files).filter((p) => !zip.files[p].dir), ['West-Face_2/3.jpg', 'West-Face_2/4.jpg', 'West-Face_2/5.jpg', 'sort_report.csv']);
  assert.doesNotMatch(await zip.file('sort_report.csv').async('string'), /"0.jpg"/);
});

test('ZIP name collisions cannot overwrite an existing numbered filename', async () => {
  const files = ['photo.jpg', 'photo.jpg', 'photo_2.jpg', 'PHOTO.jpg'].map((name, index) => ({ file: Object.assign(Buffer.from(String(index)), { name, size: 1 }) }));
  const zip = await JSZip.loadAsync(await (await makeZip([{ name: 'pass', files }], false, false)).arrayBuffer());
  const entries = Object.values(zip.files).filter((file) => !file.dir);
  assert.equal(entries.length, 4);
  assert.deepEqual((await Promise.all(entries.map((file) => file.async('string')))).sort(), ['0', '1', '2', '3']);
});

test('review queue names inconclusive and unchecked candidates and distinguishes reviewed from corrected', () => {
  const { records, ids, plan } = sample(); const edits = emptyEdits();
  records[4].warnings = ['missing-gps'];
  const result = { proposals: [{ file: records[3].file, visual: { supported: false } }], reviewCandidates: [{ boundaryIndex: 1, reason: 'ambiguous-visual-motion' }, { boundaryIndex: 5, reason: 'not-checked' }] };
  const queue = buildReviewQueue(records, plan(edits), result, ids, edits);
  assert.equal(queue.filter((row) => row.type === 'inconclusive').length, 2);
  assert.ok(queue.some((row) => row.file === records[4].file && row.type === 'metadata'));
  edits.resolved[queue[0].id] = true;
  assert.equal(buildReviewQueue(records, plan(edits), result, ids, edits)[0].resolved, true);
  const corrected = changeMarker(edits, ids.get(records[3].file), 'split');
  assert.deepEqual(corrected.resolved, {});
  assert.equal(buildReviewQueue(records, plan(corrected), result, ids, corrected).some((row) => row.type === 'suggestion'), false);
});
