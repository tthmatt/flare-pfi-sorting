import { getDisplayPath } from './files.js';

export function groupingOrder(analyses, settings) {
  return settings.inferAltitudeTurns || analyses.some((item) => item.markerOverride === 'split') ? 'capture' : settings.sortBy;
}

export function sortAnalyses(analyses, sortBy) {
  return [...analyses].sort((a, b) => {
    if (sortBy === 'capture') {
      const difference = (a.captureDate?.getTime() ?? Number.POSITIVE_INFINITY) - (b.captureDate?.getTime() ?? Number.POSITIVE_INFINITY);
      if (difference) return difference;
    }
    if (sortBy === 'modified' && a.file.lastModified !== b.file.lastModified) return a.file.lastModified - b.file.lastModified;
    return getDisplayPath(a.file).localeCompare(getDisplayPath(b.file), undefined, { numeric: true, sensitivity: 'base' });
  });
}
