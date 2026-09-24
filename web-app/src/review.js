import { sortAnalyses } from './ordering.js';

export function buildReviewItems(analyses, groups, settings) {
  const placements = new Map(groups.flatMap((group) => group.files.map((item) => [item.file, { groupName: group.name, startReason: item.startReason }])));
  // Input indices keep cards stable even when two selected files have the same name.
  const ids = new Map(analyses.map((item, index) => [item.file, index]));
  return sortAnalyses(analyses, settings.inferAltitudeTurns ? 'capture' : settings.sortBy)
    .map((item) => ({ ...item, id: ids.get(item.file), ...placements.get(item.file) }));
}
