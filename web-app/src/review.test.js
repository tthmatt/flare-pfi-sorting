import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewItems } from './review.js';
import { buildGroups } from './grouping.js';
import { isMarkerPitch } from './markers.js';

const settings = { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers: true };

test('all photos remain reviewable, including skipped markers, beyond the first preview page', () => {
  const items = Array.from({ length: 105 }, (_, index) => ({ file: { name: `${index}.jpg`, size: 1 }, pitch: index % 2 ? -90 : -10 }));
  const { groups } = buildGroups(items, settings);
  const review = buildReviewItems(items, groups, settings);
  assert.equal(review.length, 105);
  assert.equal(review[1].groupName, undefined);
  assert.equal(review[104].file, items[104].file);
  assert.equal(new Set(review.map((item) => item.id)).size, 105);
});

test('all-skipped selection stays reviewable and undo restores an output photo', () => {
  const items = [{ file: { name: 'marker.jpg', size: 1 }, pitch: 0, markerOverride: 'marker' }];
  const skipped = buildGroups(items, settings);
  assert.equal(skipped.groups.length, 0);
  assert.equal(buildReviewItems(items, skipped.groups, settings).length, 1);
  items[0].markerOverride = 'auto';
  const restored = buildGroups(items, settings);
  assert.equal(buildReviewItems(items, restored.groups, settings)[0].groupName, 'test_001');
});

test('marker recognition accepts either sign and rejects missing or non-finite pitch', () => {
  for (const pitch of [-90, 90, -88, 92]) assert.equal(isMarkerPitch(pitch, -90, 2), true);
  for (const pitch of [0, -84.4, null, undefined, NaN, Infinity]) assert.equal(isMarkerPitch(pitch, -90, 2), false);
});
