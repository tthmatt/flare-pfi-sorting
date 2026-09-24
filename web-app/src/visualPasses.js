import { isMarkerImage } from './markers.js';

const radians = (n) => n * Math.PI / 180;
const angleDifference = (a, b) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);
const hasPosition = (r) => Number.isFinite(r?.latitude) && Math.abs(r.latitude) <= 90
  && Number.isFinite(r.longitude) && Math.abs(r.longitude) <= 180;
const time = (r) => r.captureDate?.getTime?.() ?? NaN;
const gap = (a, b) => (time(b) - time(a)) / 1000;
const sameAltitudeSource = (a, b) => ['relative', 'absolute'].includes(a.altitudeSource)
  && a.altitudeSource === b.altitudeSource && Number.isFinite(a.altitude) && Number.isFinite(b.altitude);

export function cameraDisplacement(a, b) {
  if (!hasPosition(a) || !hasPosition(b) || !Number.isFinite(a.gimbalYaw)) return null;
  const north = radians(b.latitude - a.latitude) * 6371000;
  const longitudeDelta = ((b.longitude - a.longitude + 540) % 360) - 180;
  const east = radians(longitudeDelta) * 6371000 * Math.cos(radians((a.latitude + b.latitude) / 2));
  const heading = radians(a.gimbalYaw);
  return { lateral: east * Math.cos(heading) - north * Math.sin(heading),
    forward: east * Math.sin(heading) + north * Math.cos(heading) };
}

// All indices are capture-order indices. Labels and filenames are never evidence.
export function findVisualPassCandidates(records, settings = {}) {
  const candidates = []; const reasons = {};
  const reject = (reason) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1]; const next = records[index];
    if (next.markerOverride && next.markerOverride !== 'auto') { reject('already-reviewed'); continue; }
    if (records.slice(Math.max(0, index - 2), index + 1).some((item) => isMarkerImage(item, settings))) { reject('existing-marker'); continue; }
    const movement = cameraDisplacement(previous, next);
    if (!movement || !Number.isFinite(next.gimbalYaw) || !sameAltitudeSource(previous, next)
      || !Number.isFinite(previous.pitch) || !Number.isFinite(next.pitch)
      || !Number.isFinite(gap(previous, next))) { reject('missing-metadata'); continue; }
    if (gap(previous, next) <= 0 || gap(previous, next) > 60) { reject('capture-time-gap'); continue; }
    if (angleDifference(previous.gimbalYaw, next.gimbalYaw) > 8 || Math.abs(next.pitch - previous.pitch) > 8
      || Math.max(Math.abs(next.pitch), Math.abs(previous.pitch)) > 60) { reject('camera-rotation'); continue; }
    if (Math.abs(movement.lateral) < 2 || Math.abs(movement.lateral) < 2 * Math.abs(movement.forward)
      || Math.abs(next.altitude - previous.altitude) > 2) { reject('not-level-sideways-movement'); continue; }

    const before = []; const after = [];
    // Stop at metadata gaps/markers; do not join separate flights or altitude datums.
    for (const [direction, start, target, limit] of [[-1, index - 1, before, 4], [1, index, after, 4]]) {
      for (let j = start; j >= 0 && j < records.length && target.length < limit; j += direction) {
        const item = records[j]; const neighbor = records[j - direction];
        if (!hasPosition(item) || !sameAltitudeSource(previous, item) || !Number.isFinite(time(item))
          || !Number.isFinite(item.gimbalYaw) || angleDifference(previous.gimbalYaw, item.gimbalYaw) > 8
          || isMarkerImage(item, settings)) break;
        if (target.length && (Math.abs(time(item) - time(neighbor)) / 1000 > 60 || time(item) === time(neighbor))) break;
        target.push(item);
      }
    }
    if (before.length < 3 || after.length < 2) { reject('insufficient-surrounding-photos'); continue; }
    const priorSteps = before.slice(1).map((item, i) => before[i].altitude - item.altitude).filter((d) => Math.abs(d) > 0.75);
    const priorSpan = before[0].altitude - before.at(-1).altitude;
    if (priorSteps.length < 2 || Math.abs(priorSpan) < 3 || priorSteps.some((d) => Math.sign(d) !== Math.sign(priorSpan))) { reject('no-established-vertical-pass'); continue; }
    const nextSteps = after.slice(1).map((item, i) => item.altitude - after[i].altitude);
    // Allow a small setup adjustment before the next pass (e.g. approaching a roof).
    if (!nextSteps.some((d) => d * Math.sign(priorSpan) < -1)) { reject('no-return-pass-evidence'); continue; }
    const priorNoise = Math.max(...before.map((item) => Math.abs(cameraDisplacement(previous, item).lateral)));
    const nextNoise = Math.max(...after.map((item) => Math.abs(cameraDisplacement(next, item).lateral)));
    if (Math.max(priorNoise, nextNoise) > Math.abs(movement.lateral) / 3) { reject('unstable-lateral-position'); continue; }
    candidates.push({ boundaryIndex: index, beforeIndex: index - 1, lateralMeters: movement.lateral,
      forwardMeters: movement.forward, altitudeDelta: next.altitude - previous.altitude,
      priorDirection: priorSpan > 0 ? 'up' : 'down', nextDirection: priorSpan > 0 ? 'down' : 'up' });
  }
  return { candidates, reasons };
}
