import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { emptyEdits, historyReducer, indexFiles } from './workspace.js';
import { loadSessions, makeManifest, saveSession, SESSION_VERSION, validateSession } from './sessions.js';

export function useWorkspace(files, settings, setSettings) {
  const ids = useMemo(() => indexFiles(files), [files]);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: emptyEdits(), future: [] });
  const [activeId, setActiveId] = useState(null);
  const [flightName, setFlightName] = useState('');
  const [drone, setDrone] = useState('');
  const [manifest, setManifest] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Reselect the same original folder to resume a saved review.');
  const [recent, setRecent] = useState([]);
  const initialSettings = useRef(settings);
  const latest = useRef(null);

  function restore(value, fingerprint) {
    const clean = validateSession(value, fingerprint, initialSettings.current);
    dispatch({ type: 'reset', value: clean.edits });
    setSettings(clean.settings); setActiveId(clean.activeId);
    setFlightName(clean.flightName); setDrone(clean.drone);
  }

  useEffect(() => {
    let cancelled = false;
    latest.current = null; setManifest(null); dispatch({ type: 'reset' });
    setActiveId(null); setFlightName(''); setDrone('');
    setRestoring(Boolean(files.length));
    async function prepare() {
      let sessions = [];
      try { sessions = loadSessions(localStorage); if (!cancelled) setRecent(sessions); }
      catch { if (!cancelled) setSaveStatus('Local saving is unavailable. Download a review backup after editing.'); }
      if (!files.length) return;
      try {
        const fingerprint = await makeManifest(files, ids);
        if (cancelled) return;
        const saved = sessions.find((item) => item.manifest.id === fingerprint.id);
        if (saved) {
          restore(saved, fingerprint);
          setSaveStatus('Saved review restored. Analyze the selected photos to continue.');
        } else setSaveStatus('New selection. Review changes will save on this browser.');
        setManifest(fingerprint);
      } catch (error) { if (!cancelled) setSaveStatus(error.message); }
      finally { if (!cancelled) setRestoring(false); }
    }
    prepare();
    return () => { cancelled = true; };
  }, [files, ids]); // A different selection is a different review, even at the same path.

  const payload = useMemo(() => manifest ? { version: SESSION_VERSION, manifest,
    edits: history.present, settings, activeId, flightName, drone } : null,
  [manifest, history.present, settings, activeId, flightName, drone]);
  latest.current = payload;

  useEffect(() => {
    if (!payload) return;
    const timer = setTimeout(() => {
      try {
        const sessions = saveSession(localStorage, { ...payload, updatedAt: new Date().toISOString() });
        setRecent(sessions); setSaveStatus('Review saved on this browser. Original photos are not stored.');
      } catch { setSaveStatus('Could not save locally. Download a review backup before closing this page.'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [payload]);

  useEffect(() => {
    const flush = () => { if (latest.current) { try { saveSession(localStorage, { ...latest.current, updatedAt: new Date().toISOString() }); } catch { /* The visible save status reports storage errors. */ } } };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  async function importSession(file) {
    if (!manifest) throw new Error('Select the original photos first.');
    if (file.size > 4 * 1024 * 1024) throw new Error('Review backup exceeds the 4 MiB limit.');
    restore(JSON.parse(await file.text()), manifest);
    setSaveStatus('Review backup restored.');
  }

  return { ids, edits: history.present, edit: (value) => dispatch({ type: 'edit', value }),
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    reset: () => dispatch({ type: 'edit', value: emptyEdits() }),
    activeId, setActiveId, flightName, setFlightName, drone, setDrone,
    manifest, restoring, saveStatus, recent, payload, importSession };
}
