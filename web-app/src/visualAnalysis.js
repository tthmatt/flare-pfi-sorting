import { findVisualPassCandidates } from './visualPasses.js';

export async function analyzeVisualPasses(records, settings, { signal, onProgress } = {}) {
  const { candidates, reasons } = findVisualPassCandidates(records, settings);
  // Bound a review session. The UI reports any candidates not checked.
  const selected = candidates.slice(0, 200);
  const result = { proposals: [], reasons, unchecked: candidates.length - selected.length,
    reviewCandidates: candidates.slice(200).map((candidate) => ({ boundaryIndex: candidate.boundaryIndex, reason: 'not-checked' })) };
  if (!selected.length) return result;
  if (signal?.aborted) throw new DOMException('Visual analysis cancelled.', 'AbortError');
  return new Promise((resolve, reject) => {
    let worker; let watchdog; let checked = 0;
    const cleanup = () => { clearTimeout(watchdog); worker?.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (error) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Visual analysis cancelled.', 'AbortError'));
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => fail(new Error('Visual analysis timed out. Use the photo review to set boundaries manually.')), 45000);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('./visualPassWorker.js', import.meta.url), { type: 'module' });
      worker.onerror = () => fail(new Error('Visual analysis is unavailable in this browser. Use “Start folder here (keep photo)” in the photo review.'));
      worker.onmessage = ({ data }) => {
        const candidate = selected[data.index];
        if (candidate.requiresVisualSupport && !data.visual.supported) {
          result.reasons['camera-sweep-visual-inconclusive'] = (result.reasons['camera-sweep-visual-inconclusive'] ?? 0) + 1;
          result.reviewCandidates.push({ boundaryIndex: candidate.boundaryIndex, reason: data.visual.reason });
        } else {
          result.proposals.push({ ...candidate, file: records[candidate.boundaryIndex].file,
            beforeFile: records[candidate.beforeIndex].file,
            comparisonBeforeFile: records[candidate.comparisonBeforeIndex]?.file ?? null,
            comparisonAfterFile: records[candidate.comparisonAfterIndex]?.file ?? null, visual: data.visual });
        }
        checked += 1;
        onProgress?.(checked, selected.length);
        if (checked === selected.length) { cleanup(); resolve(result); }
        else armWatchdog();
      };
      armWatchdog();
      worker.postMessage(selected.map((candidate) => ({ before: records[candidate.comparisonBeforeIndex]?.file,
        after: records[candidate.comparisonAfterIndex]?.file, lateralMeters: candidate.lateralMeters })));
    } catch (error) { fail(error); }
  });
}
