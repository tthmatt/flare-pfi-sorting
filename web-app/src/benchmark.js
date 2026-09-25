import { buildGroups } from './grouping.js';
import { analyzeVisualPasses } from './visualAnalysis.js';

export const BENCHMARK_KEY = 'pfi.flight-benchmarks.v1';
export const DETECTOR_VERSION = 'visual-pass-0.4.6';
const CONFIG_KEYS = ['markerPitch', 'tolerance', 'inferAltitudeTurns', 'altitudeTolerance', 'altitudeMinSteps',
  'altitudeMinSpan', 'altitudeMarkerSuppression', 'horizontalMinPhotos', 'horizontalPitchTolerance'];

export function scoreBoundaries(expected, predicted) {
  const truth = new Set(expected); const found = new Set(predicted);
  const matched = [...truth].filter((id) => found.has(id));
  const missed = [...truth].filter((id) => !found.has(id));
  const extra = [...found].filter((id) => !truth.has(id));
  return { expected: truth.size, predicted: found.size, correct: matched.length,
    missed, extra, precision: found.size ? matched.length / found.size : null,
    recall: truth.size ? matched.length / truth.size : null };
}

export function labelPlan(groups, records, ids) {
  const retained = new Set(groups.flatMap((group) => group.files.map((item) => ids.get(item.file))));
  return { expected: groups.slice(1).map((group) => ids.get(group.files[0].file)),
    retained: records.map((item) => ids.get(item.file)).filter((id) => retained.has(id)) };
}

export async function evaluateFlight({ records, settings, labels, ids, manifest, flightName, drone, appVersion, signal, onProgress, analyze = analyzeVisualPasses }) {
  if (!labels.retained.length || !manifest || !flightName.trim() || !drone.trim()) throw new Error('Name the flight and drone, and confirm a folder plan with retained photos.');
  // Always run the uncorrected detector. The reviewed plan supplies truth only;
  // accepting a suggestion cannot turn it into its own successful prediction.
  const raw = records.map(({ markerOverride, boundaryOverride, ...record }) => record);
  const config = Object.fromEntries(CONFIG_KEYS.map((key) => [key, settings[key]]));
  const baseline = buildGroups(raw, { ...settings, folderPrefix: 'benchmark', sortBy: 'capture', skipMarkers: true });
  const visual = await analyze(raw, settings, { signal, onProgress });
  if (visual.unchecked) throw new Error(`${visual.unchecked} candidates were not checked. This is a partial run and cannot be saved as a complete-flight benchmark.`);
  const retained = new Set(labels.retained);
  const rawStarts = new Set([...baseline.groups.slice(1).map((group) => group.files[0].file), ...visual.proposals.map((proposal) => proposal.file)]);
  const predicted = new Set();
  let pending = false;
  for (const item of raw) {
    if (rawStarts.has(item.file)) pending = true;
    const id = ids.get(item.file);
    if (pending && retained.has(id)) { if (id !== labels.retained[0]) predicted.add(id); pending = false; }
  }
  const expected = [...new Set(labels.expected)];
  return { version: 1, detectorVersion: DETECTOR_VERSION, appVersion, datasetId: manifest.id,
    flightName: flightName.trim().slice(0, 100), drone: drone.trim().slice(0, 100),
    createdAt: new Date().toISOString(), completeFlightReviewed: true, photoCount: records.length,
    config, expected, predicted: [...predicted], scores: scoreBoundaries(expected, predicted) };
}

export function validateBenchmarks(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Choose a benchmark JSON containing at most 100 flight results.');
  return value.map((row) => {
    if (row?.version !== 1 || row.completeFlightReviewed !== true || !/^[a-f0-9]{64}$/.test(row.datasetId)
      || !Number.isInteger(row.photoCount) || row.photoCount < 1 || row.photoCount > 100000
      || ![row.flightName, row.drone, row.detectorVersion, row.appVersion].every((s) => typeof s === 'string' && s.length > 0 && s.length <= 100)
      || ![row.expected, row.predicted].every((list) => Array.isArray(list) && list.length < row.photoCount && list.every((id) => typeof id === 'string' && id.length <= 2000))
      || !row.config || typeof row.config !== 'object') throw new Error('This file contains an invalid or incomplete flight result.');
    const config = Object.fromEntries(CONFIG_KEYS.filter((key) => typeof row.config[key] === 'boolean' || (typeof row.config[key] === 'number' && Number.isFinite(row.config[key]))).map((key) => [key, row.config[key]]));
    return { version: 1, detectorVersion: row.detectorVersion, appVersion: row.appVersion, datasetId: row.datasetId,
      flightName: row.flightName, drone: row.drone, photoCount: row.photoCount, completeFlightReviewed: true,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt.slice(0, 40) : '', config,
      expected: [...new Set(row.expected)], predicted: [...new Set(row.predicted)], scores: scoreBoundaries(row.expected, row.predicted) };
  });
}

export const benchmarkKey = (row) => JSON.stringify([row.datasetId, row.detectorVersion, row.config]);
export function mergeBenchmarks(existing, incoming) {
  const rows = new Map(existing.map((row) => [benchmarkKey(row), row]));
  for (const row of incoming) rows.set(benchmarkKey(row), row);
  return [...rows.values()].slice(-100);
}

export function summarizeBenchmarks(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.drone, row.detectorVersion, row.config]);
    const group = groups.get(key) ?? { key, drone: row.drone, detectorVersion: row.detectorVersion, flights: 0, correct: 0, expected: 0, predicted: 0 };
    group.flights++; group.correct += row.scores.correct; group.expected += row.scores.expected; group.predicted += row.scores.predicted;
    groups.set(key, group);
  }
  return [...groups.values()].map((row) => ({ ...row, missed: row.expected - row.correct, extra: row.predicted - row.correct,
    precision: row.predicted ? row.correct / row.predicted : null, recall: row.expected ? row.correct / row.expected : null }));
}
