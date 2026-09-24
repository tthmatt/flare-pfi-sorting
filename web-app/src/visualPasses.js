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

// Keep the proposed boundary separate from the photos used to check it. A pilot
// may tilt at the bottom of a pass, then restore the camera after moving sideways.
function comparisonPair(before, after, boundaryIndex, lateralDirection) {
  const pairs = [];
  before.forEach((a, i) => after.forEach((b, j) => {
    if (!Number.isFinite(a.pitch) || !Number.isFinite(b.pitch)
      || Math.max(Math.abs(a.pitch), Math.abs(b.pitch)) > 60
      || Math.abs(a.pitch - b.pitch) > 8 || angleDifference(a.gimbalYaw, b.gimbalYaw) > 8
      || Math.abs(a.altitude - b.altitude) > 2 || gap(a, b) <= 0 || gap(a, b) > 60) return;
    const move = cameraDisplacement(a, b);
    if (Math.sign(move.lateral) !== lateralDirection || Math.abs(move.lateral) < 2
      || Math.abs(move.lateral) < 2 * Math.abs(move.forward)) return;
    pairs.push({ beforeIndex: boundaryIndex - 1 - i, afterIndex: boundaryIndex + j,
      pitchDelta: Math.abs(a.pitch - b.pitch), altitudeDelta: Math.abs(a.altitude - b.altitude), distance: i + j });
  }));
  // Preserve the adjacent comparison whenever it is compatible. Otherwise prefer
  // matching camera angles, similar height and then proximity to the boundary.
  return pairs.find((pair) => pair.distance === 0) ?? pairs.sort((a, b) =>
    a.pitchDelta - b.pitchDelta || a.altitudeDelta - b.altitudeDelta || a.distance - b.distance)[0] ?? null;
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
    if (angleDifference(previous.gimbalYaw, next.gimbalYaw) > 8
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
    if (priorSteps.some((d) => Math.sign(d) !== Math.sign(priorSpan))) { reject('conflicting-prior-motion'); continue; }
    const established = priorSteps.length >= 2 && Math.abs(priorSpan) >= 3;
    const priorSign = priorSteps.length ? Math.sign(priorSpan) : null;
    const nextSteps = after.slice(1).map((item, i) => item.altitude - after[i].altitude);
    // Allow a small setup adjustment before the next pass (e.g. approaching a roof).
    const verticalSteps = nextSteps.filter((d) => Math.abs(d) > 1);
    if (!verticalSteps.length || (priorSign !== null && !verticalSteps.some((d) => Math.sign(d) === -priorSign))
      || (priorSign === null && verticalSteps.some((d) => Math.sign(d) !== Math.sign(verticalSteps[0])))) {
      reject('no-return-pass-evidence'); continue;
    }
    // A cropped sequence or several level detail photos may hide the previous
    // ascent/descent. Require three stable photos after the move for this weaker
    // review suggestion, and never invent a previous pass direction.
    if (!established && after.length < 3) { reject('insufficient-surrounding-photos'); continue; }
    const priorNoise = Math.max(...before.map((item) => Math.abs(cameraDisplacement(previous, item).lateral)));
    const nextNoise = Math.max(...after.map((item) => Math.abs(cameraDisplacement(next, item).lateral)));
    if (Math.max(priorNoise, nextNoise) > Math.abs(movement.lateral) / 3) { reject('unstable-lateral-position'); continue; }
    const comparison = comparisonPair(before, after, index, Math.sign(movement.lateral));
    const nextSign = priorSign === null ? Math.sign(verticalSteps[0]) : -priorSign;
    candidates.push({ boundaryIndex: index, beforeIndex: index - 1, lateralMeters: movement.lateral,
      forwardMeters: movement.forward, altitudeDelta: next.altitude - previous.altitude,
      priorDirection: priorSign === null ? null : priorSign > 0 ? 'up' : 'down', nextDirection: nextSign > 0 ? 'up' : 'down',
      passEvidence: established ? 'established' : 'partial',
      comparisonBeforeIndex: comparison?.beforeIndex ?? null, comparisonAfterIndex: comparison?.afterIndex ?? null });
  }
  return { candidates, reasons };
}
