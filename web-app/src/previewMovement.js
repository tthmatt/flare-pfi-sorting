import { sortAnalyses } from './ordering.js';
import { cameraDisplacement } from './visualPasses.js';

const captureTime = (item) => item.captureDate?.getTime?.() ?? NaN;

// Compute once over the selected photos, before search, pagination or display
// sorting. File identity keeps duplicate filenames attached to the correct value.
export function buildPreviewMovements(analyses) {
  const movements = new Map(analyses.map((item) => [item.file, { meters: null, reason: 'missing-time' }]));
  const ordered = sortAnalyses(analyses.filter((item) => Number.isFinite(captureTime(item))), 'capture');
  const counts = new Map();
  for (const item of ordered) counts.set(captureTime(item), (counts.get(captureTime(item)) ?? 0) + 1);
  ordered.forEach((item, index) => {
    const previous = ordered[index - 1];
    let reason = null; let meters = null;
    if (counts.get(captureTime(item)) > 1 || (previous && counts.get(captureTime(previous)) > 1)) reason = 'ambiguous-time';
    else if (!previous) reason = 'first-photo';
    else if (!Number.isFinite(previous.gimbalYaw)) reason = 'missing-heading';
    else {
      const displacement = cameraDisplacement(previous, item);
      if (displacement) meters = displacement.lateral;
      else reason = 'missing-gps';
    }
    movements.set(item.file, { meters, reason,
      previousFile: reason === 'ambiguous-time' ? null : previous?.file ?? null });
  });
  return movements;
}
