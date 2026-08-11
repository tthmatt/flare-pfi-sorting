export function logStatus(status) {
  console.log('[PFI Sorter] Current status:', status);
}

export function analysisProgress(done, total) {
  return `Analyzing ${done} of ${total} images...`;
}

export function analysisSummary(groups, skippedMarkerCount, elapsedMs = 0, analyzedCount = null) {
  const outputCount = groups.reduce((sum, group) => sum + group.files.length, 0);
  const count = analyzedCount ?? outputCount;
  const skipped = skippedMarkerCount ? ` Skipped ${skippedMarkerCount} marker image${skippedMarkerCount === 1 ? '' : 's'}.` : '';
  const seconds = elapsedMs / 1000;
  const throughput = seconds > 0 ? count / seconds : 0;
  return `Ready: ${count} image${count === 1 ? '' : 's'} in ${seconds.toFixed(1)}s (${throughput.toFixed(1)} images/sec), grouped into ${groups.length} folder${groups.length === 1 ? '' : 's'}.${skipped}`;
}
