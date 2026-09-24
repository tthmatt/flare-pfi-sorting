import { isMarkerImage } from './markers.js';

const radians = (n) => n * Math.PI / 180;
const angleDelta = (a, b) => ((b - a + 540) % 360 + 360) % 360 - 180;
const angleDifference = (a, b) => Math.abs(angleDelta(a, b));
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
function comparisonPair(before, after, boundaryIndex, lateralDirection, cameraSweep = false) {
  const pairs = [];
  before.forEach((a, i) => after.forEach((b, j) => {
    if (!Number.isFinite(a.pitch) || !Number.isFinite(b.pitch)
      || Math.max(Math.abs(a.pitch), Math.abs(b.pitch)) > 60
      || Math.abs(a.pitch - b.pitch) > 8 || angleDifference(a.gimbalYaw, b.gimbalYaw) > 8
      || Math.abs(a.altitude - b.altitude) > 2 || gap(a, b) <= 0 || gap(a, b) > 60) return;
    const move = cameraDisplacement(a, b);
    if (Math.sign(move.lateral) !== lateralDirection || Math.abs(move.lateral) < (cameraSweep ? 1 : 2)
      || Math.abs(move.lateral) < 2 * Math.abs(move.forward)) return;
    pairs.push({ beforeIndex: boundaryIndex - 1 - i, afterIndex: boundaryIndex + j,
      pitchDelta: Math.abs(a.pitch - b.pitch), altitudeDelta: Math.abs(a.altitude - b.altitude), distance: i + j });
  }));
  // Level camera sweeps need the most closely aligned angles for their required
  // visual confirmation. Ordinary altitude passes keep the adjacent comparison.
  const adjacent = pairs.find((pair) => pair.distance === 0);
  if (!cameraSweep && adjacent) return adjacent;
  return pairs.sort((a, b) =>
    a.pitchDelta - b.pitchDelta || a.altitudeDelta - b.altitudeDelta || a.distance - b.distance)[0] ?? null;
}

function pitchSweepDirection(photos, minSpan = 20, minSteps = 2) {
  if (photos.some((item) => !Number.isFinite(item.pitch) || Math.abs(item.pitch) > 60)) return null;
  const span = photos.at(-1).pitch - photos[0].pitch;
  const steps = photos.slice(1).map((item, i) => item.pitch - photos[i].pitch);
  // Deliberate tilt steps, not gimbal jitter; allow at most two degrees of backtrack.
  if (Math.abs(span) < minSpan || steps.filter((d) => Math.abs(d) >= 5).length < minSteps
    || steps.some((d) => d * Math.sign(span) < -2)) return null;
  return Math.sign(span);
}

function cameraSweepEvidence(before, after) {
  if (before.length < 3 || after.length < 3) return null;
  // Use the shortest complete sweep beside the boundary. A fourth photo may
  // already belong to the next climb/descent or be a setup adjustment.
  for (let b = 3; b <= before.length; b += 1) for (let a = 3; a <= after.length; a += 1) {
    const prior = before.slice(0, b); const next = after.slice(0, a); const items = [...prior, ...next];
    if (items.some((item) => !Number.isFinite(item.pitch) || Math.abs(item.pitch) > 60)
      || Math.max(...items.map((item) => item.altitude)) - Math.min(...items.map((item) => item.altitude)) > 0.75) continue;
    const priorSign = pitchSweepDirection([...prior].reverse()); const nextSign = pitchSweepDirection(next);
    if (priorSign && nextSign === -priorSign) return { priorSign, nextSign, before: prior, after: next };
  }
  return null;
}

// A vertical flight can return down/up the next column by tilting the camera.
// Two inspection photos suffice only when a separate marker ends that short pass.
// The marker verifies its endpoint, never supplies an inspection tilt step.
function tiltedReturnEvidence(after, following, settings, lateralMeters) {
  if (after.length < 2) return null;
  const short = after.length === 2;
  if (short && (!following || !isMarkerImage(following, settings) || !hasPosition(following)
    || !sameAltitudeSource(after[0], following) || !Number.isFinite(following.gimbalYaw)
    || angleDifference(after[0].gimbalYaw, following.gimbalYaw) > 8
    || !Number.isFinite(gap(after.at(-1), following))
    || gap(after.at(-1), following) <= 0 || gap(after.at(-1), following) > 60)) return null;
  for (let length = short ? 2 : 3; length <= after.length; length += 1) {
    const photos = after.slice(0, length);
    const positions = short ? [...photos, following] : photos;
    if (Math.max(...positions.map((item) => item.altitude)) - Math.min(...positions.map((item) => item.altitude)) > 0.75) continue;
    const direction = pitchSweepDirection(photos, short ? 10 : 20, short ? 1 : 2);
    if (!direction) continue;
    const drift = positions.map((item) => {
      const move = cameraDisplacement(after[0], item); return Math.hypot(move.lateral, move.forward);
    });
    if (Math.max(...drift) <= Math.abs(lateralMeters) / 6) return { direction, photos };
  }
  return null;
}

// A pilot may turn the camera or change height while moving to the next column.
// Require two complete, stable vertical passes before relaxing the adjacent-view
// limits. These records remain a review suggestion, not an aligned image match.
function changedViewpointEvidence(before, after) {
  if (before.length < 3 || after.length < 3) return null;
  const direction = (photos) => {
    if (photos.some((item) => !Number.isFinite(item.pitch) || Math.abs(item.pitch) > 60)) return null;
    const span = photos.at(-1).altitude - photos[0].altitude;
    const steps = photos.slice(1).map((item, i) => item.altitude - photos[i].altitude).filter((d) => Math.abs(d) > 0.75);
    if (Math.abs(span) < 3 || steps.length < 2 || steps.some((d) => Math.sign(d) !== Math.sign(span))) return null;
    return Math.sign(span);
  };
  const priorSign = direction([...before].reverse()); const nextSign = direction(after);
  if (!priorSign || nextSign !== -priorSign) return null;
  const heightsBefore = before.map((item) => item.altitude); const heightsAfter = after.map((item) => item.altitude);
  if (Math.min(Math.max(...heightsBefore), Math.max(...heightsAfter))
    - Math.max(Math.min(...heightsBefore), Math.min(...heightsAfter)) < 3) return null;

  const previous = before[0]; const next = after[0];
  const turn = angleDelta(previous.gimbalYaw, next.gimbalYaw);
  const moves = [previous.gimbalYaw, next.gimbalYaw, previous.gimbalYaw + turn / 2]
    .map((gimbalYaw) => cameraDisplacement({ ...previous, gimbalYaw }, next));
  const middle = moves[2];
  // Lateral in both camera frames, predominantly lateral at their midpoint.
  // Do not reinterpret a forward approach as sideways just because yaw changed.
  if (moves.slice(0, 2).some((move) => Math.sign(move.lateral) !== Math.sign(middle.lateral)
    || Math.abs(move.lateral) < 4 || Math.abs(move.lateral) < Math.abs(move.forward))
    || Math.abs(middle.lateral) < 2 * Math.abs(middle.forward)) return null;
  const heightChange = Math.abs(next.altitude - previous.altitude);
  if (heightChange > 5 || heightChange > Math.abs(middle.lateral) / 2) return null;
  const drift = (anchor, items) => items.map((item) => {
    const move = cameraDisplacement(anchor, item); return Math.hypot(move.lateral, move.forward);
  });
  const noise = Math.max(...drift(previous, before), ...drift(next, after));
  if (noise > Math.min(Math.abs(moves[0].lateral), Math.abs(moves[1].lateral)) / 6) return null;
  return { priorSign, nextSign };
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
    const headingChangeDegrees = angleDifference(previous.gimbalYaw, next.gimbalYaw);
    const changedViewpoint = headingChangeDegrees > 8 || Math.abs(next.altitude - previous.altitude) > 2;
    if (headingChangeDegrees > 45
      || Math.max(Math.abs(next.pitch), Math.abs(previous.pitch)) > 60) { reject('camera-rotation'); continue; }
    // Changed viewpoints need a larger move and complete passes on both sides.
    // Moves below 2 m still require the image-supported camera-sweep path.
    if (Math.abs(movement.lateral) < (changedViewpoint ? 4 : 1)
      || (!changedViewpoint && Math.abs(movement.lateral) < 2 * Math.abs(movement.forward))) {
      reject('not-level-sideways-movement'); continue;
    }

    const before = []; const after = [];
    // Stop at metadata gaps/markers; do not join separate flights or altitude datums.
    for (const [direction, start, target, limit] of [[-1, index - 1, before, 4], [1, index, after, 4]]) {
      // A turn between passes is allowed only when each pass has its own stable heading.
      const headingAnchor = changedViewpoint ? records[start] : previous;
      for (let j = start; j >= 0 && j < records.length && target.length < limit; j += direction) {
        const item = records[j]; const neighbor = records[j - direction];
        if (!hasPosition(item) || !sameAltitudeSource(previous, item) || !Number.isFinite(time(item))
          || !Number.isFinite(item.gimbalYaw) || angleDifference(headingAnchor.gimbalYaw, item.gimbalYaw) > 8
          || isMarkerImage(item, settings)) break;
        if (target.length && (Math.abs(time(item) - time(neighbor)) / 1000 > 60 || time(item) === time(neighbor))) break;
        target.push(item);
      }
    }
    if (before.length < 3 || after.length < 2) { reject('insufficient-surrounding-photos'); continue; }
    const changedView = changedViewpoint ? changedViewpointEvidence(before, after) : null;
    if (changedViewpoint && !changedView) { reject('no-stable-vertical-columns'); continue; }
    const sweep = changedViewpoint ? null : cameraSweepEvidence(before, after);
    let priorSign; let nextSign; let passEvidence; let tiltedReturn;
    if (changedView) {
      ({ priorSign, nextSign } = changedView); passEvidence = 'changed-viewpoint';
    } else if (sweep) {
      ({ priorSign, nextSign } = sweep); passEvidence = 'camera-sweep';
      // Small GPS shifts alone are insufficient: both complete camera sweeps
      // must stay in tight horizontal clusters and later pass the image check.
      const drift = (anchor, item) => {
        const d = cameraDisplacement(anchor, item); return Math.hypot(d.lateral, d.forward);
      };
      const noise = Math.max(...sweep.before.map((item) => drift(previous, item)), ...sweep.after.map((item) => drift(next, item)));
      if (noise > Math.abs(movement.lateral) / 6) { reject('unstable-camera-sweep-position'); continue; }
    } else {
      if (Math.abs(movement.lateral) < 2) { reject('not-level-sideways-movement'); continue; }
      const priorSteps = before.slice(1).map((item, i) => before[i].altitude - item.altitude).filter((d) => Math.abs(d) > 0.75);
      const priorSpan = before[0].altitude - before.at(-1).altitude;
      if (priorSteps.some((d) => Math.sign(d) !== Math.sign(priorSpan))) { reject('conflicting-prior-motion'); continue; }
      const established = priorSteps.length >= 2 && Math.abs(priorSpan) >= 3;
      priorSign = priorSteps.length ? Math.sign(priorSpan) : null;
      const nextSteps = after.slice(1).map((item, i) => item.altitude - after[i].altitude);
      // Allow a small setup adjustment before the next pass (e.g. approaching a roof).
      const verticalSteps = nextSteps.filter((d) => Math.abs(d) > 1);
      tiltedReturn = established && !verticalSteps.length
        ? tiltedReturnEvidence(after, records[index + after.length], settings, movement.lateral) : null;
      if (tiltedReturn?.direction === -priorSign) {
        nextSign = tiltedReturn.direction; passEvidence = 'tilted-return';
      } else {
        tiltedReturn = null;
        if (!verticalSteps.length || (priorSign !== null && !verticalSteps.some((d) => Math.sign(d) === -priorSign))
          || (priorSign === null && verticalSteps.some((d) => Math.sign(d) !== Math.sign(verticalSteps[0])))) {
          reject('no-return-pass-evidence'); continue;
        }
        // A cropped sequence or level detail photos can hide the previous pass.
        // Require three following photos and never invent the previous direction.
        if (!established && after.length < 3) { reject('insufficient-surrounding-photos'); continue; }
        nextSign = priorSign === null ? Math.sign(verticalSteps[0]) : -priorSign;
        passEvidence = established ? 'established' : 'partial';
      }
    }
    const priorPhotos = sweep?.before ?? before; const nextPhotos = sweep?.after ?? tiltedReturn?.photos ?? after;
    const priorNoise = Math.max(...priorPhotos.map((item) => Math.abs(cameraDisplacement(previous, item).lateral)));
    const nextNoise = Math.max(...nextPhotos.map((item) => Math.abs(cameraDisplacement(next, item).lateral)));
    if (Math.max(priorNoise, nextNoise) > Math.abs(movement.lateral) / 3) { reject('unstable-lateral-position'); continue; }
    const comparison = comparisonPair(priorPhotos, nextPhotos, index, Math.sign(movement.lateral), Boolean(sweep));
    candidates.push({ boundaryIndex: index, beforeIndex: index - 1, lateralMeters: movement.lateral,
      forwardMeters: movement.forward, altitudeDelta: next.altitude - previous.altitude,
      priorDirection: priorSign === null ? null : priorSign > 0 ? 'up' : 'down', nextDirection: nextSign > 0 ? 'up' : 'down',
      passEvidence, headingChangeDegrees, requiresVisualSupport: Boolean(sweep),
      comparisonBeforeIndex: comparison?.beforeIndex ?? null, comparisonAfterIndex: comparison?.afterIndex ?? null });
  }
  return { candidates, reasons };
}
