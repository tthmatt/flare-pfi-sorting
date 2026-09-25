import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFlight, mergeBenchmarks, scoreBoundaries, summarizeBenchmarks, validateBenchmarks } from './benchmark.js';
import { indexFiles } from './workspace.js';

test('exact-boundary scoring penalizes a one-photo error as both missed and extra, without invented percentages', () => {
  assert.deepEqual(scoreBoundaries(['a', 'b'], ['a', 'c']), { expected: 2, predicted: 2, correct: 1, missed: ['b'], extra: ['c'], precision: 0.5, recall: 0.5 });
  assert.equal(scoreBoundaries([], []).precision, null); assert.equal(scoreBoundaries([], []).recall, null);
  assert.equal(scoreBoundaries(['a'], []).recall, 0);
  assert.equal(scoreBoundaries(['a'], ['a', 'a']).correct, 1);
});

async function evaluate(visual = null) {
  const records = [0, 1, 2, 3].map((i) => ({ file: new File(['x'], `${i}.jpg`, { lastModified: 1 }), captureDate: new Date(i * 1000), pitch: -20,
    markerOverride: i === 2 ? 'split' : 'auto', boundaryOverride: i === 1 ? 'join' : undefined }));
  const ids = indexFiles(records.map((r) => r.file)); let input;
  const result = await evaluateFlight({ records, settings: { markerPitch: -90, tolerance: 2, inferAltitudeTurns: false },
    labels: { retained: records.map((r) => ids.get(r.file)), expected: [ids.get(records[2].file)] }, ids,
    manifest: { id: 'a'.repeat(64) }, flightName: 'Flight A', drone: 'Mavic 2', appVersion: '0.6.0',
    analyze: async (rows) => { input = rows; return visual ?? { proposals: [{ file: records[1].file }], unchecked: 0 }; } });
  return { result, input };
}

test('benchmark reruns uncorrected records and does not score accepted corrections as predictions', async () => {
  const { result, input } = await evaluate();
  assert.ok(input.every((row) => !('markerOverride' in row) && !('boundaryOverride' in row)));
  assert.equal(result.scores.correct, 0); assert.equal(result.scores.missed.length, 1); assert.equal(result.scores.extra.length, 1);
});

test('partial worker runs cannot be reported as complete-flight benchmarks', async () => {
  await assert.rejects(() => evaluate({ proposals: [], unchecked: 3 }), /partial run/);
});

test('benchmark imports recompute scores, reject partial flights and avoid counting a flight twice', async () => {
  const { result } = await evaluate();
  const clean = validateBenchmarks([{ ...result, scores: { correct: 999 } }])[0];
  assert.equal(clean.scores.correct, 0);
  assert.throws(() => validateBenchmarks([{ ...result, completeFlightReviewed: false }]), /invalid or incomplete/);
  const merged = mergeBenchmarks([clean], [clean]); assert.equal(merged.length, 1);
  const totals = summarizeBenchmarks(merged); assert.equal(totals[0].missed, 1); assert.equal(totals[0].extra, 1);
  const secondVersion = { ...clean, detectorVersion: 'future-detector' };
  assert.equal(summarizeBenchmarks(mergeBenchmarks(merged, [secondVersion])).length, 2);
});
