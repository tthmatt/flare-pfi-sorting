export function logStatus(status) {
  console.log('[PFI Sorter] Current status:', status);
}

export function analysisProgress(done, total) {
  return `Analyzing ${done} of ${total} images...`;
}

export function analysisSummary(groups, skippedMarkerCount) {
  const count = groups.reduce((sum, group) => sum + group.files.length, 0);
  const skipped = skippedMarkerCount ? ` Skipped ${skippedMarkerCount} marker image${skippedMarkerCount === 1 ? '' : 's'}.` : '';
  return `Ready: ${count} output image${count === 1 ? '' : 's'} grouped into ${groups.length} folder${groups.length === 1 ? '' : 's'}.${skipped}`;
}
