import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeVisualPasses } from './visualAnalysis.js';

const fixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-pitch-adjustment.json', import.meta.url)));
const sweepFixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-camera-sweep.json', import.meta.url)));
const sample = () => fixture.rows.slice(8).map((r) => ({ ...r,
  file: { name: `${r.id}.jpg` }, captureDate: new Date(r.seconds * 1000), altitudeSource: 'relative',
  latitude: r.north / 6371000 * 180 / Math.PI, longitude: r.east / 6371000 * 180 / Math.PI,
}));

test('worker compares compatible photos but the result and acceptance still target the first new-pass photo', async (t) => {
  const original = globalThis.Worker; let jobs; let terminated = false;
  t.after(() => { if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original; });
  globalThis.Worker = class {
    postMessage(value) {
      jobs = value;
      queueMicrotask(() => this.onmessage({ data: { index: 0, visual: { supported: false, reason: 'ambiguous-visual-motion' } } }));
    }
    terminate() { terminated = true; }
  };
  const rows = sample(); const progress = [];
  const result = await analyzeVisualPasses(rows, { markerPitch: -90, tolerance: 2 }, { onProgress: (...values) => progress.push(values) });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].before, rows[1].file); // 0066
  assert.equal(jobs[0].after, rows[5].file); // 0071
  assert.equal(result.proposals[0].file, rows[4].file); // 0070, not the comparison photo
  assert.equal(result.proposals[0].comparisonBeforeFile, rows[1].file);
  assert.equal(result.proposals[0].comparisonAfterFile, rows[5].file);
  assert.equal(result.proposals[0].visual.supported, false);
  assert.deepEqual(progress, [[1, 1]]);
  assert.equal(terminated, true);
});

const sweepSample = () => sweepFixture.rows.map((r) => ({ ...r,
  file: { name: `${r.id}.jpg` }, captureDate: new Date(r.seconds * 1000), altitudeSource: 'relative',
  latitude: r.north / 6371000 * 180 / Math.PI, longitude: r.east / 6371000 * 180 / Math.PI,
}));

function mockWorker(t, responses) {
  const original = globalThis.Worker; const state = { terminated: false, jobs: null };
  t.after(() => { if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original; });
  globalThis.Worker = class {
    postMessage(jobs) {
      state.jobs = jobs;
      responses.forEach((visual, index) => queueMicrotask(() => this.onmessage({ data: { index, visual } })));
    }
    terminate() { state.terminated = true; }
  };
  return state;
}

test('camera sweeps compare the best aligned photos and only suggest the boundary with image support', async (t) => {
  const state = mockWorker(t, [{ supported: true, matches: 24, inliers: 18 }]);
  const rows = sweepSample(); const progress = [];
  const result = await analyzeVisualPasses(rows, {}, { onProgress: (...values) => progress.push(values) });
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].before, rows[0].file);
  assert.equal(state.jobs[0].after, rows[5].file);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].file, rows[3].file);
  assert.equal(result.proposals[0].requiresVisualSupport, true);
  assert.deepEqual(progress, [[1, 1]]);
  assert.equal(state.terminated, true);
});

test('inconclusive camera sweep images complete analysis without a suggestion or a hanging worker', { timeout: 2000 }, async (t) => {
  const state = mockWorker(t, [{ supported: false, reason: 'ambiguous-visual-motion' }]);
  const progress = [];
  const result = await analyzeVisualPasses(sweepSample(), {}, { onProgress: (...values) => progress.push(values) });
  assert.deepEqual(result.proposals, []);
  assert.equal(result.reasons['camera-sweep-visual-inconclusive'], 1);
  assert.equal(result.unchecked, 0);
  assert.deepEqual(progress, [[1, 1]]);
  assert.equal(state.terminated, true);
});

test('mixed sessions count every checked pair and retain ordinary altitude proposals with inconclusive images', { timeout: 2000 }, async (t) => {
  const state = mockWorker(t, [
    { supported: false, reason: 'no-comparable-photos' },
    { supported: false, reason: 'ambiguous-visual-motion' },
  ]);
  const rows = [...sweepSample(), ...sample().map((r) => ({ ...r, captureDate: new Date(r.captureDate.getTime() + 3600000) }))];
  const progress = [];
  const result = await analyzeVisualPasses(rows, {}, { onProgress: (...values) => progress.push(values) });
  assert.equal(state.jobs.length, 2);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].file.name, '0070.jpg');
  assert.equal(result.proposals[0].visual.supported, false);
  assert.equal(result.reasons['camera-sweep-visual-inconclusive'], 1);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.equal(state.terminated, true);
});
