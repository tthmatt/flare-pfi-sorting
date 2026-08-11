import { isImageFile, safePathPart } from './files.js';
import { readImageMetadata } from './metadata.js';
import { sortAnalyses } from './ordering.js';
import { analyzeGpsTurns } from './turnDetection.js';

export function isMarkerPitch(pitch, markerPitch, tolerance) {
  return pitch !== null && pitch !== undefined && Math.abs(Math.abs(pitch) - Math.abs(markerPitch)) <= tolerance;
}

export function buildGroups(analyses, settings) {
  const ordered = sortAnalyses(analyses, settings.inferAltitudeTurns ? 'capture' : settings.sortBy);
  const groups = [];
  let currentGroup = null;
  let pendingNewGroup = false;
  let pendingStartReason = null;
  let skippedMarkerCount = 0;
  const pitchStarts = ordered.map((item) => isMarkerPitch(item.pitch, settings.markerPitch, settings.tolerance));
  for (let index = 1; index < pitchStarts.length; index += 1) {
    if (pitchStarts[index] && pitchStarts[index - 1]) pitchStarts[index] = false;
  }
  const { reversalStarts, horizontalStarts } = settings.inferAltitudeTurns
    ? inferAltitudeStarts(ordered, pitchStarts, settings)
    : { reversalStarts: new Set(), horizontalStarts: new Set() };

  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    const marker = isMarkerPitch(item.pitch, settings.markerPitch, settings.tolerance);
    let startReason = pitchStarts[index] ? 'pitched-down' : horizontalStarts.has(index) ? 'horizontal-traverse' : reversalStarts.has(index) ? 'altitude-reversal' : null;
    let startsNewFolder = startReason !== null;
    if (settings.skipMarkers && marker) {
      skippedMarkerCount += 1;
      if (pitchStarts[index]) {
        pendingNewGroup = true;
        pendingStartReason = 'pitched-down';
      }
      continue;
    }
    if (pendingNewGroup || !currentGroup || startsNewFolder) {
      if (pendingNewGroup) {
        startReason = pendingStartReason;
        startsNewFolder = true;
      }
      currentGroup = {
        name: `${safePathPart(settings.folderPrefix)}_${String(groups.length + 1).padStart(3, '0')}`,
        files: [], startReason: startReason ?? 'first-image', size: 0,
      };
      groups.push(currentGroup);
      pendingNewGroup = false;
      pendingStartReason = null;
    }
    currentGroup.files.push({ ...item, startsNewFolder, startReason: startReason ?? (!currentGroup.files.length && groups.length === 1 ? 'first-image' : null) });
    currentGroup.size += item.file.size;
  }
  return { groups, skippedMarkerCount };
}

export async function analyzeFiles(files, settings, onProgress, options = {}) {
  const images = files.filter(isImageFile);
  const analyses = new Array(images.length);
  const readMetadata = options.readMetadata || readImageMetadata;
  const now = options.now || (() => performance.now());
  const startedAt = now();
  let nextIndex = 0;
  let completed = 0;
  let lastProgressAt = -Infinity;
  let lastReported = 0;

  function reportProgress(force = false) {
    const timestamp = now();
    if (force || timestamp - lastProgressAt >= 100) {
      lastProgressAt = timestamp;
      lastReported = completed;
      onProgress?.(completed, images.length);
    }
  }

  async function worker() {
    while (nextIndex < images.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = images[index];
      try {
        analyses[index] = { file, ...await readMetadata(file), error: null };
      } catch (error) {
        analyses[index] = { file, pitch: null, captureDate: null, altitude: null, altitudeSource: null, latitude: null, longitude: null, flightYaw: null, gimbalYaw: null, warnings: ['missing-pitch', 'missing-capture-time', 'missing-altitude', 'missing-gps'], error: error instanceof Error ? error.message : String(error) };
      }
      completed += 1;
      reportProgress();
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, images.length) }, () => worker()));
  if (lastReported !== images.length) reportProgress(true);
  const elapsedMs = Math.max(0, now() - startedAt);
  // GPS proposal indices are always and exclusively capture-time flight-order
  // indices. This second view reuses the metadata objects read above.
  const captureOrderedAnalyses = sortAnalyses(analyses, 'capture');
  const turnAnalysis = settings.proposeGpsTurns
    ? analyzeGpsTurns(captureOrderedAnalyses, settings)
    : { proposals: [], reasonCounts: {} };
  return { ...buildGroups(analyses, settings), analyses, captureOrderedAnalyses, turnCandidates: turnAnalysis.proposals, turnCandidateReasonCounts: turnAnalysis.reasonCounts, elapsedMs };
}

export function altitudeDirection(previous, current, tolerance) {
  if (previous === null || previous === undefined || current === null || current === undefined) return 0;
  const delta = current - previous;
  if (Math.abs(delta) <= tolerance) return 0;
  return delta > 0 ? 1 : -1;
}

export function inferAltitudeStarts(ordered, pitchStarts, settings) {
  const reversalStarts = inferAltitudeReversalStarts(ordered, pitchStarts, settings);
  const { starts: horizontalStarts, replacedReversals } = inferHorizontalTraverseStarts(ordered, pitchStarts, settings);
  for (const index of replacedReversals) reversalStarts.delete(index);
  return { reversalStarts, horizontalStarts };
}

export function inferAltitudeReversalStarts(ordered, pitchStarts, settings) {
  const starts = new Set();
  let previousAltitude = null;
  let runDirection = 0;
  let runSteps = 0;
  let runStartAltitude = null;
  let candidateDirection = 0;
  let candidateSteps = 0;
  let candidateStartIndex = null;
  let candidateStartAltitude = null;
  let suppressNormals = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const altitude = ordered[index].altitude;
    if (pitchStarts[index]) {
      previousAltitude = altitude;
      runDirection = 0;
      runSteps = 0;
      runStartAltitude = null;
      candidateDirection = 0;
      candidateSteps = 0;
      candidateStartIndex = null;
      candidateStartAltitude = null;
      suppressNormals = settings.altitudeMarkerSuppression;
      continue;
    }
    if (suppressNormals > 0) {
      if (altitude !== null && altitude !== undefined) previousAltitude = altitude;
      suppressNormals -= 1;
      continue;
    }
    const direction = altitudeDirection(previousAltitude, altitude, settings.altitudeTolerance);
    if (altitude === null || altitude === undefined) continue;
    if (previousAltitude === null || previousAltitude === undefined || direction === 0) {
      previousAltitude = altitude;
      continue;
    }
    if (runDirection === 0) {
      runDirection = direction;
      runSteps = 1;
      runStartAltitude = previousAltitude;
    } else if (direction === runDirection) {
      runSteps += 1;
      candidateDirection = 0;
      candidateSteps = 0;
      candidateStartIndex = null;
      candidateStartAltitude = null;
    } else {
      const previousRunSpan = runStartAltitude === null ? 0 : Math.abs(previousAltitude - runStartAltitude);
      const sustained = runSteps >= settings.altitudeMinSteps && previousRunSpan >= settings.altitudeMinSpan;
      if (!sustained) {
        runDirection = direction;
        runSteps = 1;
        runStartAltitude = previousAltitude;
      } else if (candidateDirection !== direction) {
        candidateDirection = direction;
        candidateSteps = 1;
        candidateStartIndex = index;
        candidateStartAltitude = previousAltitude;
      } else {
        candidateSteps += 1;
      }
      const candidateSpan = candidateStartAltitude === null ? 0 : Math.abs(altitude - candidateStartAltitude);
      if (candidateSteps >= settings.altitudeMinSteps && candidateSpan >= settings.altitudeMinSpan) {
        if (candidateStartIndex !== null) starts.add(candidateStartIndex);
        runDirection = candidateDirection;
        runSteps = candidateSteps;
        runStartAltitude = candidateStartAltitude;
        candidateDirection = 0;
        candidateSteps = 0;
        candidateStartIndex = null;
        candidateStartAltitude = null;
      }
    }
    previousAltitude = altitude;
  }
  return starts;
}

export function inferHorizontalTraverseStarts(ordered, pitchStarts, settings) {
  const starts = new Set();
  const replacedReversals = new Set();
  let previousAltitude = null;
  let runDirection = 0;
  let runSteps = 0;
  let runStartAltitude = null;
  let traverse = null;
  let suppressNormals = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const { altitude, pitch } = ordered[index];
    if (pitchStarts[index]) {
      previousAltitude = altitude;
      runDirection = 0;
      runSteps = 0;
      runStartAltitude = null;
      traverse = null;
      suppressNormals = settings.altitudeMarkerSuppression;
      continue;
    }
    if (suppressNormals > 0) {
      if (altitude !== null && altitude !== undefined) previousAltitude = altitude;
      suppressNormals -= 1;
      continue;
    }
    const isHorizontal = altitude !== null && altitude !== undefined && pitch !== null && pitch !== undefined
      && Math.abs(pitch) <= settings.horizontalPitchTolerance;
    const runSpan = runStartAltitude === null || previousAltitude === null ? 0 : Math.abs(previousAltitude - runStartAltitude);
    const sustained = runSteps >= settings.altitudeMinSteps && runSpan >= settings.altitudeMinSpan;

    if (!traverse && isHorizontal && sustained) {
      traverse = { start: index, boundary: null, count: 1, firstAltitude: altitude, lastAltitude: altitude, priorDirection: runDirection, nextDirection: 0, nextSteps: 0, nextFirstIndex: null };
      previousAltitude = altitude;
      continue;
    }
    if (traverse) {
      if (isHorizontal) {
        const level = Math.abs(altitude - traverse.firstAltitude) <= settings.altitudeTolerance
          && Math.abs(altitude - traverse.lastAltitude) <= settings.altitudeTolerance;
        if (level) {
          traverse.count += 1;
          if (traverse.count === settings.horizontalMinPhotos) traverse.boundary = index;
          traverse.lastAltitude = altitude;
          previousAltitude = altitude;
          continue;
        }
        traverse = null;
      }
      if (traverse && traverse.count >= settings.horizontalMinPhotos) {
        const direction = altitudeDirection(traverse.lastAltitude, altitude, settings.altitudeTolerance);
        if (altitude === null || altitude === undefined || direction === 0) {
          if (altitude !== null && altitude !== undefined) {
            previousAltitude = altitude;
            traverse.lastAltitude = altitude;
          }
          continue;
        }
        if (direction === -traverse.priorDirection) {
          if (traverse.nextDirection === 0) {
            traverse.nextDirection = direction;
            traverse.nextSteps = 1;
            traverse.nextFirstIndex = index;
          } else if (direction === traverse.nextDirection) {
            traverse.nextSteps += 1;
          } else {
            traverse = null;
          }
          if (traverse) {
            const nextSpan = Math.abs(altitude - traverse.lastAltitude);
            if (traverse.nextSteps >= settings.altitudeMinSteps && nextSpan >= settings.altitudeMinSpan) {
              starts.add(traverse.boundary);
              replacedReversals.add(traverse.nextFirstIndex);
              runDirection = direction;
              runSteps = traverse.nextSteps;
              runStartAltitude = traverse.lastAltitude;
              traverse = null;
            }
            previousAltitude = altitude;
            continue;
          }
        } else {
          traverse = null;
        }
      } else {
        traverse = null;
      }
    }
    const direction = altitudeDirection(previousAltitude, altitude, settings.altitudeTolerance);
    if (altitude === null || altitude === undefined) continue;
    if (previousAltitude === null || previousAltitude === undefined || direction === 0) {
      previousAltitude = altitude;
      continue;
    }
    if (runDirection === direction) runSteps += 1;
    else {
      runDirection = direction;
      runSteps = 1;
      runStartAltitude = previousAltitude;
    }
    previousAltitude = altitude;
  }
  return { starts, replacedReversals };
}
