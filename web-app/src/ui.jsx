import { useEffect, useRef, useState } from 'react';
import { getDisplayPath, getFileName } from './files.js';

const ICONS = {
  folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />,
  images: <><rect x="6" y="3" width="15" height="15" rx="2" /><path d="m7 14 4-4 5 5 3-3 2 2M3 7v13a1 1 0 0 0 1 1h13" /><circle cx="16" cy="7" r="1" /></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
  download: <path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  settings: <><path d="M4 6h7m5 0h4M4 12h2m5 0h9M4 18h9m5 0h2" /><circle cx="13.5" cy="6" r="2.5" /><circle cx="8.5" cy="12" r="2.5" /><circle cx="15.5" cy="18" r="2.5" /></>,
  marker: <><path d="M5 21V3h14l-3 5 3 5H5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.01" /></>,
  loader: <path d="M21 12a9 9 0 1 1-6-8.5" />,
  scan: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 12h18" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
  expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  history: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2" /></>,
  chart: <path d="M4 3v18h17M8 16v-4m5 4V6m5 10V9" />,
};

export function Icon({ name, className = '' }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[name]}</svg>;
}

export function PhotoViewer({ file, onClose, onPrevious, onNext, returnFocusRef }) {
  const dialogRef = useRef(null);
  const [source, setSource] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    setFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const closeViewer = () => {
    // Close before unmounting so the browser can release its modal focus trap.
    dialogRef.current.close();
    returnFocusRef.current?.focus({ preventScroll: true });
    onClose();
  };

  return <dialog className="photo-viewer" ref={dialogRef} aria-labelledby="viewer-title" onCancel={(event) => { event.preventDefault(); closeViewer(); }}
    onKeyDown={(event) => {
      if (event.key === 'ArrowLeft' && onPrevious) { event.preventDefault(); onPrevious(); }
      if (event.key === 'ArrowRight' && onNext) { event.preventDefault(); onNext(); }
    }}>
    <div className="viewer-header"><div><h2 id="viewer-title">{getFileName(file)}</h2><p title={getDisplayPath(file)}>{getDisplayPath(file)}</p></div><button type="button" className="icon-button secondary" onClick={closeViewer} aria-label="Close photo viewer" autoFocus><Icon name="close" /></button></div>
    <div className="viewer-image">{failed ? <p>This photo could not be displayed in the browser.</p> : source && <img src={source} alt={`Full preview of ${getFileName(file)}`} onError={() => setFailed(true)} />}</div>
    <div className="viewer-footer"><span>← → to browse · Esc to close</span><div className="button-row"><button type="button" className="secondary" disabled={!onPrevious} onClick={onPrevious}>Previous photo</button><button type="button" className="secondary" disabled={!onNext} onClick={onNext}>Next photo</button></div></div>
  </dialog>;
}
