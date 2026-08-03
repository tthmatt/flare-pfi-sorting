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
