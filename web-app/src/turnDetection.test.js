import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeGpsTurns } from './turnDetection.js';

const golden = JSON.parse(readFileSync(new URL('../../tests/gps_turn_golden_vectors.json', import.meta.url), 'utf8'));
test('manual markers suppress GPS proposals without replacing raw zero-degree pitch', () => {
  const vector = golden.vectors.find((item) => item.expected.proposalCount > 0);
  const records = structuredClone(vector.records);
  const marker = records[vector.expected.boundaryIndex];
  marker.pitch = 0;
  marker.markerOverride = 'marker';
  const result = analyzeGpsTurns(records, golden.settings);
  assert.equal(result.proposals.length, 0);
  assert.ok(result.reasonCounts['nearby-pitched-down-marker'] > 0);
  assert.equal(marker.pitch, 0);
  marker.markerOverride = 'auto';
  assert.ok(analyzeGpsTurns(records, golden.settings).proposals.length > 0);
});

for (const vector of golden.vectors) {
  test(`GPS turn golden: ${vector.name}`, () => {
    const original = structuredClone(vector.records);
    const result = analyzeGpsTurns(vector.records, golden.settings);
    assert.deepEqual(vector.records, original);
    assert.equal(result.proposals.length, vector.expected.proposalCount);
    if (vector.expected.reason) assert.ok(result.reasonCounts[vector.expected.reason] > 0);
    if (result.proposals.length) {
      const proposal = result.proposals[0];
      assert.equal(proposal.boundaryIndex, vector.expected.boundaryIndex);
      assert.equal(proposal.detectedAtIndex, vector.expected.detectedAtIndex);
      assert.ok(Math.abs(proposal.evidence.gpsDisplacementM - vector.expected.gpsDisplacementM) <= vector.expected.distanceToleranceM);
      assert.ok(!JSON.stringify(proposal).match(/latitude|longitude/i));
    }
  });
}
