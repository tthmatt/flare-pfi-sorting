import { useEffect, useRef, useState } from 'react';
import { downloadBlob } from './reports.js';
import { createReviewSession, MAX_REVIEW_BYTES, parseReviewSession, readSavedReview, serializeReviewSession, storeReviewSession } from './reviewSession.js';
import { Icon } from './ui.jsx';

export function useReviewSession({ files, analyses, settings, overrides, isWorking }) {
  const importVersion = useRef(0);
  const [importError, setImportError] = useState('');
  const [saveGeneration, setSaveGeneration] = useState(0);
  const [autoSavePaused, setAutoSavePaused] = useState(false);
  const [initial] = useState(readSavedReview);
  const [savedReview, setSavedReview] = useState(initial.session);
  const [notice, setNotice] = useState(initial.error ?? (initial.session ? 'A saved review is available. Select its original photos, then resume.' : 'Reviews are saved on this device after analysis.'));

  useEffect(() => {
    if (!analyses.length || analyses.length !== files.length || isWorking || autoSavePaused) return undefined;
    let active = true;
    const version = importVersion.current;
    const timer = setTimeout(async () => {
      try {
        setNotice('Saving review on this device…');
        const session = await createReviewSession(files, settings, overrides);
        if (!active || version !== importVersion.current) return;
        setSavedReview(session);
        try {
          storeReviewSession(session);
          setNotice('Review saved on this device. Download a review file to keep another copy.');
        } catch {
          setNotice('This browser could not save the review. Download a review file to keep your decisions.');
        }
      } catch (error) {
        if (active && version === importVersion.current) setNotice(`Review could not be saved: ${error.message}`);
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [files, analyses, settings, overrides, isWorking, autoSavePaused, saveGeneration]);

  async function downloadReview() {
    try {
      const session = await createReviewSession(files, settings, overrides);
      const text = serializeReviewSession(session);
      parseReviewSession(text); // Never offer a backup that this version cannot reopen.
      downloadBlob(new Blob([text], { type: 'application/json' }), 'flare_review.json');
      setNotice('Review file downloaded. Keep it with the original photos.');
    } catch (error) { setNotice(`Review could not be downloaded: ${error.message}`); }
  }

  async function importReview(file) {
    if (!file) return;
    const version = ++importVersion.current;
    setSaveGeneration((value) => value + 1);
    const wasPaused = autoSavePaused;
    setImportError('');
    setAutoSavePaused(true);
    try {
      if (file.size > MAX_REVIEW_BYTES) throw new Error('The review file is too large.');
      const session = parseReviewSession(await file.text());
      if (version !== importVersion.current) return;
      setSavedReview(session);
      setNotice(`Review loaded for ${session.files.length} photos. Select the original photos, then resume.`);
    } catch (error) {
      if (version === importVersion.current) { setImportError(error.message); setAutoSavePaused(wasPaused); }
    }
  }
  function beginReview() { importVersion.current += 1; setAutoSavePaused(false); setImportError(''); }
  return { savedReview, notice, importError, downloadReview, importReview, beginReview };
}

export function ReviewSessionControls({ session, onResume, disabled, hasPhotos, hasAnalysis }) {
  const input = useRef(null);
  return <section className="panel review-session" aria-label="Save and resume review">
    <div className="session-summary">
      <Icon name="history" />
      <div className="session-copy">
        <div className="panel-heading"><h2>Save & resume review</h2><span className="badge">On this device</span></div>
        <p role="status">{session.notice}</p>
        {session.importError && <p role="alert">{session.importError}</p>}
        {session.savedReview && <p className="section-description">Saved review: {session.savedReview.files.length.toLocaleString()} photos · {new Date(session.savedReview.savedAt).toLocaleString()}</p>}
      </div>
    </div>
    <div className="button-row session-actions">
      <button type="button" className="secondary" disabled={disabled || !hasAnalysis} onClick={session.downloadReview}>Save review file</button>
      <button type="button" className="secondary" disabled={disabled} onClick={() => input.current?.click()}>Load review file</button>
      <button type="button" disabled={disabled || !hasPhotos || !session.savedReview} onClick={onResume}>Resume saved review</button>
    </div>
    <input ref={input} className="hidden-input" type="file" accept=".json,application/json" aria-label="Load review file" onChange={(event) => { session.importReview(event.target.files?.[0]); event.target.value = ''; }} />
    <details className="inline-help"><summary>What is saved?</summary><p>Settings and folder decisions, including accepted pass boundaries, are saved automatically. Only the latest review is kept on this device. Analyzing a new selection replaces it. A review file keeps a separate copy.</p><p>Photos are never saved in the review. After reloading, select the same originals using the same folder or file selection method, then choose Resume saved review. Photo paths, sizes, modification times and content fingerprints must match before decisions are restored.</p></details>
  </section>;
}
