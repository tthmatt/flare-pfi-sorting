import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeVisualPasses } from './visualAnalysis.js';

const fixture = JSON.parse(readFileSync(new URL('../test-support/visual-pass-pitch-adjustment.json', import.meta.url)));
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
