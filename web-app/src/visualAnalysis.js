import { findVisualPassCandidates } from './visualPasses.js';

export async function analyzeVisualPasses(records, settings, { signal, onProgress } = {}) {
  const { candidates, reasons } = findVisualPassCandidates(records, settings);
  // Bound a review session. The UI reports any candidates not checked.
  const selected = candidates.slice(0, 200);
  const result = { proposals: [], reasons, unchecked: candidates.length - selected.length };
  if (!selected.length) return result;
  if (signal?.aborted) throw new DOMException('Visual analysis cancelled.', 'AbortError');
  return new Promise((resolve, reject) => {
    let worker; let watchdog;
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
        result.proposals.push({ ...candidate, file: records[candidate.boundaryIndex].file,
          beforeFile: records[candidate.beforeIndex].file, visual: data.visual });
        onProgress?.(result.proposals.length, selected.length);
        if (result.proposals.length === selected.length) { cleanup(); resolve(result); }
        else armWatchdog();
      };
      armWatchdog();
      worker.postMessage(selected.map((candidate) => ({ before: records[candidate.beforeIndex].file,
        after: records[candidate.boundaryIndex].file, lateralMeters: candidate.lateralMeters })));
    } catch (error) { fail(error); }
  });
}
