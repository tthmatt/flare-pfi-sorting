export const GPS_TURN_DEFAULTS = Object.freeze({
  gpsWindowSize: 3, gpsMinDisplacementMeters: 4, gpsMaxClusterRadiusMeters: 3,
  gpsMinSignalRatio: 2, gpsMaxGapSeconds: 30,
});

export function haversineMeters(a, b) {
  const toRad = (value) => value * Math.PI / 180;
  const [lat1, lon1, lat2, lon2] = [...a, ...b].map(toRad);
  const value = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(value));
}

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
function cluster(points) {
  const centre = [median(points.map((point) => point[0])), median(points.map((point) => point[1]))];
  return [centre, Math.max(...points.map((point) => haversineMeters(centre, point)))];
}
function altitudeRuns(records, tolerance) {
  const runs = []; let current = null;
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1]; const item = records[index];
    const eligible = ['relative', 'absolute'].includes(item.altitudeSource) && item.altitudeSource === previous.altitudeSource && item.altitude != null && previous.altitude != null;
    const delta = eligible ? item.altitude - previous.altitude : 0;
    const direction = delta > tolerance ? 1 : delta < -tolerance ? -1 : 0;
    if (direction && current && current.direction === direction && current.source === item.altitudeSource && current.end === index - 1) { current.end = index; current.steps += 1; }
    else if (direction) { current = { start: index - 1, end: index, steps: 1, direction, source: item.altitudeSource }; runs.push(current); }
    else current = null;
  }
  return runs;
}
const fileName = (record) => record.fileName ?? record.filename ?? record.file?.name ?? '';
const timeMs = (record) => record.captureTime ?? record.captureDate?.getTime?.() ?? null;
const addReason = (counts, reason) => { counts[reason] = (counts[reason] ?? 0) + 1; };

export function analyzeGpsTurns(records, settings = {}) {
  // Every index returned by this function refers exclusively to the supplied
  // capture-time flight order. Callers must sort once before invoking it.
  const options = { ...GPS_TURN_DEFAULTS, ...settings }; const reasonCounts = {}; const proposals = [];
  const runs = altitudeRuns(records, options.altitudeTolerance ?? 0.75).filter((run) => run.steps >= (options.altitudeMinSteps ?? 2) && Math.abs(records[run.end].altitude - records[run.start].altitude) >= (options.altitudeMinSpan ?? 5));
  if (runs.length < 2) addReason(reasonCounts, 'insufficient-altitude');
  for (let pair = 1; pair < runs.length; pair += 1) {
    const prior = runs[pair - 1]; const next = runs[pair];
    if (prior.direction === next.direction) { addReason(reasonCounts, 'same-direction'); continue; }
    if (prior.source !== next.source || prior.end >= next.start) { addReason(reasonCounts, 'inconsistent-altitude-source'); continue; }
    const boundaryIndex = next.start; const suppression = options.altitudeMarkerSuppression ?? 2;
    const transitionStartIndex = prior.end; const transitionEndIndex = next.start;
    const suppressionStartIndex = Math.max(0, transitionStartIndex - suppression);
    const suppressionEndIndex = Math.min(records.length - 1, transitionEndIndex + suppression);
    const markerPitch = Math.abs(options.markerPitch ?? -90); const pitchTolerance = options.tolerance ?? 2;
    if (records.slice(suppressionStartIndex, suppressionEndIndex + 1).some((record) => record.pitch != null && Math.abs(Math.abs(record.pitch) - markerPitch) <= pitchTolerance)) { addReason(reasonCounts, 'nearby-pitched-down-marker'); continue; }
    const validGps = (index) => records[index].latitude != null && records[index].longitude != null;
    const priorIndices = Array.from({ length: prior.end - prior.start + 1 }, (_, offset) => prior.start + offset).filter(validGps).slice(-options.gpsWindowSize);
    const nextIndices = Array.from({ length: next.end - next.start + 1 }, (_, offset) => next.start + offset).filter(validGps).slice(0, options.gpsWindowSize);
    if (priorIndices.length < options.gpsWindowSize || nextIndices.length < options.gpsWindowSize) { addReason(reasonCounts, 'insufficient-gps'); continue; }
    const times = records.slice(prior.start, next.end + 1).map(timeMs);
    if (times.some((value) => value == null)) { addReason(reasonCounts, 'missing-time'); continue; }
    const gaps = times.slice(1).map((value, index) => (value - times[index]) / 1000);
    if (gaps.some((gap) => gap <= 0)) { addReason(reasonCounts, 'non-increasing-time'); continue; }
    const maximumTimeGapSeconds = Math.max(0, ...gaps);
    if (maximumTimeGapSeconds > options.gpsMaxGapSeconds) { addReason(reasonCounts, 'excessive-time-gap'); continue; }
    const points = (indices) => indices.map((index) => [records[index].latitude, records[index].longitude]);
    const [priorCentre, priorClusterRadiusM] = cluster(points(priorIndices)); const [nextCentre, nextClusterRadiusM] = cluster(points(nextIndices));
    if (Math.max(priorClusterRadiusM, nextClusterRadiusM) > options.gpsMaxClusterRadiusMeters) { addReason(reasonCounts, 'noisy-gps-cluster'); continue; }
    const gpsDisplacementM = haversineMeters(priorCentre, nextCentre);
    const noiseFloorM = Math.max(priorClusterRadiusM, nextClusterRadiusM, 0.5);
    const requiredDisplacementM = Math.max(options.gpsMinDisplacementMeters, options.gpsMinSignalRatio * noiseFloorM);
    const gpsSignalRatio = gpsDisplacementM / noiseFloorM;
    if (gpsDisplacementM < requiredDisplacementM) { addReason(reasonCounts, 'insufficient-displacement'); continue; }
    const detectedAtIndex = Math.max(next.end, nextIndices.at(-1));
    const evidenceStartIndex = prior.start; const evidenceEndIndex = next.end;
    proposals.push({ boundaryIndex, detectedAtIndex, boundaryFile: fileName(records[boundaryIndex]), detectedAtFile: fileName(records[detectedAtIndex]),
      evidenceStartIndex, evidenceEndIndex, evidenceStartFile: fileName(records[evidenceStartIndex]), evidenceEndFile: fileName(records[evidenceEndIndex]),
      transitionStartIndex, transitionEndIndex, transitionStartFile: fileName(records[transitionStartIndex]), transitionEndFile: fileName(records[transitionEndIndex]),
      suppressionStartIndex, suppressionEndIndex, requiredDisplacementM, gpsSignalRatio,
      reason: 'gps-horizontal-turn', status: 'proposed', evidence: {
      priorDirection: prior.direction > 0 ? 'up' : 'down', nextDirection: next.direction > 0 ? 'up' : 'down',
      priorAltitudeSpanM: Math.abs(records[prior.end].altitude - records[prior.start].altitude), nextAltitudeSpanM: Math.abs(records[next.end].altitude - records[next.start].altitude),
      gpsDisplacementM, priorClusterRadiusM, nextClusterRadiusM, priorGpsSamples: priorIndices.length, nextGpsSamples: nextIndices.length, maximumTimeGapSeconds,
    } });
  }
  return { proposals, reasonCounts };
}

export const proposeGpsTurns = (records, settings = {}) => analyzeGpsTurns(records, settings).proposals;
