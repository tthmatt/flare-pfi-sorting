import { useEffect, useMemo, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import flareLogo from './assets/flare-dynamics-logo.svg';
import { analyzeFiles, buildGroups } from './grouping.js';
import { sortAnalyses } from './ordering.js';
import { analyzeGpsTurns } from './turnDetection.js';
import { buildReviewItems } from './review.js';
import { canPreviewInBrowser, getDisplayPath, getFileName, isImageFile, safePathPart } from './files.js';
import { downloadBlob, makeZip } from './reports.js';
import { createCalibrationReport } from './calibration.js';
import { analysisProgress, analysisSummary, logStatus } from './telemetry.js';
import { analyzeVisualPasses } from './visualAnalysis.js';

const APP_VERSION = '0.4.1';
const CHANGELOG = [
  {
    version: '0.4.1', date: '2026-09-24',
    changes: ['Moved the optional altitude fallback and tolerance into collapsed Advanced settings, with the fallback off by default.'],
  },
  {
    version: '0.4.0', date: '2026-09-24',
    changes: ['Added optional, local visual pass suggestions with accept, move, dismiss and undo controls.', 'Added folder starts that retain inspection photos when marker photos are skipped.'],
  },
  {
    version: '0.3.7', date: '2026-09-24',
    changes: ['Added reversible folder-start corrections for photos with unreliable gimbal pitch, including skipped markers.', 'Read original EXIF capture times before DJI placeholder dates.'],
  },
  {
    version: '0.3.6', date: '2026-08-11',
    changes: ['Hardened capture-order GPS evidence and transition-wide marker suppression.', 'Added a bounded, local-only calibration reviewer and redacted JSON report.'],
  },
  {
    version: '0.3.5', date: '2026-08-11',
    changes: ['Accelerated large browser analyses with single-pass metadata parsing, four bounded readers, and throttled progress.', 'Limited initial thumbnails to 100 while keeping every image in folder tables and exports.'],
  },
  {
    version: '0.3.4', date: '2026-08-11',
    changes: ['Added conservative GPS-backed horizontal-turn proposals for review and real-flight calibration.', 'GPS proposals are experimental, never change folders, and are not included in ZIP exports.'],
  },
  {
    version: '0.3.3',
    date: '2026-08-11',
    changes: [
      'Added normalized pitch, time, altitude, GPS, and yaw telemetry with stable metadata warnings.',
      'Added a local-only telemetry coverage summary without displaying raw coordinates.',
    ],
  },
  {
    version: '0.3.2',
    date: '2026-08-11',
    changes: [
      'Refactored metadata, ordering, grouping, telemetry, file helpers, and report generation into focused modules.',
      'Standardized metadata reads at 2 MiB and added shared Python/JavaScript golden vectors for v0.3.1 grouping behavior.',
    ],
  },
  {
    version: '0.3.1',
    date: '2026-08-03',
    changes: [
      'Added confirmed horizontal-traverse folder starts after the first level photo between opposite vertical facade passes.',
      'Kept pitched-down markers primary and rejected same-direction level pauses to avoid false splits.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-10',
    changes: [
      'Added altitude-reversal fallback splitting for missed pitched-down marker photos.',
      'Recorded the reason each output folder was started so previews and reports are easier to audit.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-10',
    changes: [
      'Avoid creating extra empty folders when duplicate pitched-down marker photos appear in a row.',
      'Added an option to remove the CSV report from the downloaded sorted ZIP.',
      'Added status logging to the browser console for easier troubleshooting.',
      'Added browser and local UI controls for skipping pitched-down marker photos while still using them as split points.',
      'Expanded the browser preview so all grouped photos can be reviewed with thumbnails when supported.',
      'Branded the web app with Flare Dynamics naming and logo treatment.',
    ],
  },
  {
    version: '0.1.0',
    date: 'Initial release',
    changes: [
      'Created the Python CLI and local web GUI for sorting drone inspection images by pitch metadata.',
      'Added the browser-only Vercel web app with folder/file selection, local image processing, ZIP export, and CSV audit reporting.',
    ],
  },
];

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPitch(pitch) {
  return pitch === null || pitch === undefined ? 'Unknown' : `${pitch.toFixed(1)} deg`;
}

function formatAltitude(altitude) {
  return altitude === null || altitude === undefined ? 'Unknown' : `${altitude.toFixed(1)} m`;
}

export default function App() {
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const visualController = useRef(null);
  const [files, setFiles] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [markerOverrides, setMarkerOverrides] = useState(() => new Map());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [calibrationKey, setCalibrationKey] = useState(0);
  const [status, setStatus] = useState('Choose a folder or images to begin.');
  const [isWorking, setIsWorking] = useState(false);
  const [visualResult, setVisualResult] = useState(null);
  const [visualWorking, setVisualWorking] = useState(false);
  const [settings, setSettings] = useState({
    tolerance: 2,
    inferAltitudeTurns: false,
    altitudeTolerance: 0.75,
    altitudeMinSteps: 2,
    altitudeMinSpan: 5,
    altitudeMarkerSuppression: 2,
    horizontalMinPhotos: 2,
    horizontalPitchTolerance: 5,
    markerPitch: -90,
    folderPrefix: 'flare_inspection',
    sortBy: 'filename',
    keepFolderPaths: false,
    skipMarkers: false,
    removeCsvReport: true,
    proposeGpsTurns: false,
    gpsWindowSize: 3,
    gpsMinDisplacementMeters: 4,
    gpsMaxClusterRadiusMeters: 3,
    gpsMinSignalRatio: 2,
    gpsMaxGapSeconds: 30,
  });

  const imageFiles = useMemo(() => files.filter(isImageFile), [files]);
  const totalSize = useMemo(() => imageFiles.reduce((sum, file) => sum + file.size, 0), [imageFiles]);
  const reviewedAnalyses = useMemo(() => analyses.map((item) => ({ ...item, markerOverride: markerOverrides.get(item.file) ?? 'auto' })), [analyses, markerOverrides]);
  const { groups, skippedMarkerCount } = useMemo(() => buildGroups(reviewedAnalyses, settings), [reviewedAnalyses, settings]);
  const captureOrderedAnalyses = useMemo(() => sortAnalyses(reviewedAnalyses, 'capture'), [reviewedAnalyses]);
  const { proposals: turnCandidates, reasonCounts: turnReasonCounts } = useMemo(() => settings.proposeGpsTurns
    ? analyzeGpsTurns(captureOrderedAnalyses, settings) : { proposals: [], reasonCounts: {} }, [captureOrderedAnalyses, settings]);
  const unknownPitchCount = useMemo(() => analyses.filter((item) => item.pitch === null).length, [analyses]);
  const hasInspectionSplits = reviewedAnalyses.some((item) => item.markerOverride === 'split');

  useEffect(() => () => visualController.current?.abort(), []);

  useEffect(() => {
    logStatus(status);
  }, [status]);

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
    setCalibrationKey((keyValue) => keyValue + 1);
  }

  function handleFileList(fileList) {
    if (isWorking) return;
    const selected = Array.from(fileList || []);
    setFiles(selected);
    setAnalyses([]);
    setVisualResult(null);
    setMarkerOverrides(new Map());
    setElapsedMs(0);
    setCalibrationKey((key) => key + 1);
    const imageCount = selected.filter(isImageFile).length;
    setStatus(`${imageCount} supported image${imageCount === 1 ? '' : 's'} selected.`);
  }

  function setMarkerOverride(file, mode) {
    if (mode === 'split') setSettings((current) => ({ ...current, sortBy: 'capture' }));
    setMarkerOverrides((current) => {
      const next = new Map(current);
      if (mode === 'auto') next.delete(file);
      else next.set(file, mode);
      return next;
    });
    setCalibrationKey((key) => key + 1);
    setStatus('Correction applied. Folder preview and ZIP are updated.');
  }

  function resetMarkerOverrides() {
    setMarkerOverrides(new Map());
    setCalibrationKey((key) => key + 1);
    setStatus('Corrections reset. Automatic sorting restored.');
  }

  async function handleAnalyze() {
    if (!imageFiles.length) {
      setStatus('Select JPG, TIFF, PNG, or DNG images first.');
      return;
    }
    setIsWorking(true);
    setAnalyses([]);
    setVisualResult(null);
    setCalibrationKey((key) => key + 1);
    try {
      const result = await analyzeFiles(imageFiles, settings, (done, total) => {
        setStatus(analysisProgress(done, total));
      });
      setAnalyses(result.analyses);
      setElapsedMs(result.elapsedMs);
      setStatus('Analysis complete. Review the photos and correct any missed markers below.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleVisualAnalyze() {
    const controller = new AbortController();
    visualController.current = controller;
    setIsWorking(true); setVisualWorking(true); setVisualResult(null);
    setStatus('Looking for sideways moves between vertical passes...');
    try {
      const result = await analyzeVisualPasses(captureOrderedAnalyses, settings, {
        signal: controller.signal,
        onProgress: (done, total) => setStatus(`Checking visual evidence ${done} of ${total}...`),
      });
      setVisualResult(result);
      setStatus(`${result.proposals.length} pass suggestion${result.proposals.length === 1 ? '' : 's'} ready for review. Accept a boundary to update folders.`);
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Visual analysis cancelled. Folder decisions are unchanged.' : error.message);
    } finally {
      visualController.current = null; setVisualWorking(false); setIsWorking(false);
    }
  }

  async function handleDownloadZip() {
    if (!groups.length) {
      setStatus('Analyze images before downloading the ZIP.');
      return;
    }
    setIsWorking(true);
    try {
      setStatus('Creating ZIP file...');
      const blob = await makeZip(groups, settings.keepFolderPaths, !settings.removeCsvReport);
      downloadBlob(blob, `${safePathPart(settings.folderPrefix)}_sorted.zip`);
      setStatus('ZIP download started.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="brand-lockup">
          <img src={flareLogo} alt="Flare Dynamics" />
        </div>
        <div>
          <p className="eyebrow">Flare Dynamics</p>
          <div className="title-row">
            <h1>PFI Drone Image Sorter</h1>
            <span className="version-badge">v{APP_VERSION}</span>
          </div>
          <p>Flare Dynamics inspection photo grouping. Images are processed locally in your browser and exported as a ZIP.</p>
        </div>
      </section>

      <section className="stats-bar" aria-label="Selected image summary">
        <span>{imageFiles.length} files</span>
        <span>{groups.length} folders</span>
        <span>{formatBytes(totalSize)}</span>
        {skippedMarkerCount > 0 && <span>{skippedMarkerCount} skipped markers</span>}
      </section>

      <div className="layout">
        <aside className="panel controls">
          <fieldset disabled={isWorking}>
          <h2>Input</h2>
          <div className="button-grid">
            <button type="button" onClick={() => folderInputRef.current?.click()} disabled={isWorking}>Folder</button>
            <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()} disabled={isWorking}>Files</button>
          </div>
          <input ref={folderInputRef} className="hidden-input" type="file" webkitdirectory="" directory="" multiple onChange={(event) => handleFileList(event.target.files)} />
          <input ref={fileInputRef} className="hidden-input" type="file" multiple accept=".jpg,.jpeg,.tif,.tiff,.png,.dng" onChange={(event) => handleFileList(event.target.files)} />

          <h2>Sort</h2>
          <label>
            Marker pitch
            <input type="number" step="0.1" value={settings.markerPitch} onChange={(event) => updateSetting('markerPitch', Number.parseFloat(event.target.value) || -90)} />
          </label>
          <label>
            Pitch tolerance
            <input type="number" min="0" step="0.1" value={settings.tolerance} onChange={(event) => updateSetting('tolerance', Math.max(0, Number.parseFloat(event.target.value) || 0))} />
          </label>
          <label>
            Folder prefix
            <input type="text" value={settings.folderPrefix} onChange={(event) => updateSetting('folderPrefix', event.target.value)} />
          </label>
          <label>
            Sort order
            <select value={hasInspectionSplits ? 'capture' : settings.sortBy} disabled={hasInspectionSplits} onChange={(event) => updateSetting('sortBy', event.target.value)}>
              <option value="filename">Filename / folder order</option>
              <option value="capture">Capture time, then filename</option>
              <option value="modified">Modified time, then filename</option>
            </select>
          </label>
          {hasInspectionSplits && <p className="review-help">Inspection splits use capture-time order. Reset those corrections to choose another order.</p>}
          <label className="check-row">
            <input type="checkbox" checked={settings.proposeGpsTurns} onChange={(event) => updateSetting('proposeGpsTurns', event.target.checked)} />
            Show experimental GPS turn proposals — does not change folders
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.keepFolderPaths} onChange={(event) => updateSetting('keepFolderPaths', event.target.checked)} />
            Keep original folder paths inside each output folder
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.skipMarkers} onChange={(event) => updateSetting('skipMarkers', event.target.checked)} />
            Skip pitched-down marker photos in output
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.removeCsvReport} onChange={(event) => updateSetting('removeCsvReport', event.target.checked)} />
            Remove CSV report from sorted ZIP
          </label>

          <details className="advanced-settings">
            <summary>Advanced settings{settings.inferAltitudeTurns && <span className="advanced-active">Altitude fallback on</span>}</summary>
            <p className="review-help">Automatically split folders using altitude patterns. This fallback can help when GPS or camera-direction data is missing.</p>
            <p className="review-help">Leave this option off when using Visual pass suggestions. Visual mode checks altitude independently.</p>
            <label className="check-row">
              <input type="checkbox" checked={settings.inferAltitudeTurns} onChange={(event) => updateSetting('inferAltitudeTurns', event.target.checked)} />
              Infer missed altitude turns
            </label>
            <label>
              Altitude reversal tolerance (metres)
              <input type="number" min="0" step="0.05" value={settings.altitudeTolerance} onChange={(event) => updateSetting('altitudeTolerance', Math.max(0, Number.parseFloat(event.target.value) || 0))} />
            </label>
          </details>

          <h2>Output</h2>
          <div className="button-grid">
            <button type="button" onClick={handleAnalyze} disabled={isWorking || !imageFiles.length}>Analyze images</button>
            <button type="button" className="download" onClick={handleDownloadZip} disabled={isWorking || !groups.length}>Download ZIP</button>
          </div>
          </fieldset>
        </aside>

        <section className="content">
          <section className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFileList(event.dataTransfer.files); }}>
            <div className="illustration">-90°</div>
            <div>
              <h2>Inspection set</h2>
              <p>{settings.skipMarkers ? `Every image near ${settings.markerPitch}° starts a new output folder, but marker photos are skipped in the ZIP.` : `Every image near ${settings.markerPitch}° starts a new output folder. The marker image is placed at the beginning of that new folder. If enabled, a sustained altitude reversal or confirmed horizontal traverse can start a fallback folder when a marker is missed.`}</p>
              <p className="status">{status}</p>
              {analyses.length > 0 && <p role="status">{analysisSummary(groups, skippedMarkerCount, elapsedMs, analyses.length)}</p>}
            </div>
          </section>

          <div className="metric-grid">
            <div><strong>{imageFiles.length}</strong><span>Ready</span></div>
            <div><strong>{unknownPitchCount}</strong><span>Unknown pitch</span></div>
            <div><strong>{settings.markerPitch}° ± {settings.tolerance}°</strong><span>Primary marker rule</span></div>
            <div><strong>{settings.inferAltitudeTurns ? 'On' : 'Off'}</strong><span>Altitude fallback</span></div>
          </div>

          {analyses.length > 0 && <TelemetryCoverage analyses={analyses} />}
          {analyses.length > 0 && <VisualPassPanel result={visualResult} working={visualWorking} disabled={isWorking}
            analyses={captureOrderedAnalyses} overrides={markerOverrides} onAnalyze={handleVisualAnalyze}
            onCancel={() => visualController.current?.abort()} onOverride={setMarkerOverride} />}
          {analyses.length > 0 && settings.proposeGpsTurns && <TurnProposalPanel key={calibrationKey} proposals={turnCandidates} reasons={turnReasonCounts} analyses={captureOrderedAnalyses} settings={settings} />}

          <section className="panel">
            <div className="panel-heading">
              <h2>Folders</h2>
              <span>{groups.length ? 'Ready' : analyses.length ? 'No output' : 'Waiting'}</span>
            </div>
            {groups.length ? <FolderTable groups={groups} /> : analyses.length
              ? <p className="empty-state">All photos are skipped markers. Review their folder decisions below or turn off “Skip pitched-down marker photos in output”.</p>
              : <EmptyState />}
          </section>

          {analyses.length > 0 && <Preview analyses={reviewedAnalyses} groups={groups} settings={settings} onOverride={setMarkerOverride} onReset={resetMarkerOverrides} overrideCount={markerOverrides.size} disabled={isWorking} />}

          <Changelog />
        </section>
      </div>
      <Analytics />
    </main>
  );
}

const VISUAL_REASON_LABELS = {
  'unsupported-format': 'Visual comparison supports JPG and PNG photos.',
  'image-too-large': 'This photo exceeds the 64 MiB visual-analysis limit.',
  'browser-unavailable': 'This browser cannot perform the visual comparison.',
  'image-decode-failed': 'One of these photos could not be decoded.',
  'unsupported-image': 'These image dimensions are not supported.',
  'different-image-dimensions': 'The photos have different shapes or orientations.',
  'insufficient-distinct-matches': 'Too few distinct details could be matched.',
  'ambiguous-visual-motion': 'Matched details do not establish a consistent sideways shift.',
};

function VisualPassPanel({ result, working, disabled, analyses, overrides, onAnalyze, onCancel, onOverride }) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [chosen, setChosen] = useState(null);
  const [applied, setApplied] = useState(() => new Map());
  useEffect(() => { setActive(0); setDismissed(new Set()); setChosen(null); setApplied(new Map()); }, [result]);
  const proposal = result?.proposals[Math.min(active, result.proposals.length - 1)];
  const start = proposal ? Math.max(0, proposal.boundaryIndex - 2) : 0;
  const window = proposal ? analyses.slice(start, proposal.boundaryIndex + 3) : [];
  const appliedDecision = proposal && applied.get(proposal.file);
  const accepted = appliedDecision && overrides.get(appliedDecision.file) === 'split';
  const boundaryIndex = accepted ? analyses.findIndex((item) => item.file === appliedDecision.file) : chosen ?? proposal?.boundaryIndex;
  const accept = () => {
    const file = analyses[boundaryIndex]?.file;
    if (!file) return;
    const priorMode = overrides.get(file) ?? 'auto';
    onOverride(file, 'split');
    setApplied((current) => new Map(current).set(proposal.file, { file, priorMode }));
  };
  return <section className="panel visual-pass-panel" aria-label="Visual pass suggestions">
    <div className="panel-heading"><h2>Visual pass suggestions</h2><span>Experimental</span></div>
    <p className="review-help">One folder per vertical up/down pass. Check sideways movement using photos, GPS, camera direction and altitude. Photos stay on this device. Each suggestion needs your review.</p>
    <p className="review-help">This first version needs overlapping JPG/PNG photos and reliable capture time, GPS, gimbal yaw, pitch and altitude. Repeated windows, large angle changes or missing metadata can leave passes undetected. Review the full flight before export.</p>
    <div className="button-grid">
      <button type="button" onClick={onAnalyze} disabled={disabled}>Find pass boundaries</button>
      {working && <button type="button" className="secondary" onClick={onCancel}>Cancel visual analysis</button>}
    </div>
    {result && !result.proposals.length && <p className="empty-state">No supported transition candidate was found. This does not mean the flight contains only one pass. Use “Start folder here (keep photo)” in Review photos for missed boundaries.</p>}
    {result?.unchecked > 0 && <p role="status">{result.unchecked} further candidates were not checked because this review is limited to 200. Review those photos manually.</p>}
    {proposal && <article className="proposal-item">
      <p><strong>Suggestion {active + 1} of {result.proposals.length}</strong> · {accepted ? 'Accepted' : dismissed.has(proposal.file) ? 'Dismissed' : 'Needs review'}</p>
      <strong>Start next folder at {getFileName(proposal.file)}</strong>
      <p>{proposal.priorDirection} → {proposal.nextDirection} evidence · sideways GPS shift about {Math.abs(proposal.lateralMeters).toFixed(1)} m · altitude change {proposal.altitudeDelta.toFixed(1)} m.</p>
      <p>{proposal.visual.supported ? 'Visual check: matching building details support a sideways shift.'
        : `Visual check inconclusive. ${VISUAL_REASON_LABELS[proposal.visual.reason] ?? 'Review the photos yourself before accepting.'}`}</p>
      <div className="preview-grid pass-comparison">{window.map((item, offset) => <article key={start + offset} className={`preview-card ${start + offset === boundaryIndex ? 'chosen-boundary' : ''}`}>
        <span>{start + offset === boundaryIndex ? 'NEW FOLDER START' : start + offset < boundaryIndex ? 'Before boundary' : 'After boundary'}</span>
        <ImageThumbnail file={item.file} /><strong>{getFileName(item.file)}</strong>
        <span>{formatAltitude(item.altitude)} · pitch {formatPitch(item.pitch)}</span>
      </article>)}</div>
      <label>First inspection photo of the new pass
        <select aria-label="First inspection photo of the new pass" value={boundaryIndex} disabled={disabled || accepted} onChange={(event) => setChosen(Number(event.target.value))}>
          {window.map((item, offset) => <option key={start + offset} value={start + offset}>{getFileName(item.file)}</option>)}
        </select>
      </label>
      {accepted ? <div><p>Accepted: {getFileName(appliedDecision.file)}. The photo stays in the ZIP.</p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => {
          onOverride(appliedDecision.file, appliedDecision.priorMode);
          setApplied((current) => { const next = new Map(current); next.delete(proposal.file); return next; });
        }}>Undo accepted boundary</button></div> : <div className="button-grid">
        <button type="button" disabled={disabled} onClick={accept}>Accept boundary · keep photo</button>
        <button type="button" className="secondary" disabled={disabled} onClick={() => setDismissed((current) => new Set(current).add(proposal.file))}>Dismiss suggestion</button>
      </div>}
      <div className="button-grid">
        <button type="button" className="secondary" disabled={disabled || active === 0} onClick={() => { setActive(active - 1); setChosen(null); }}>Previous suggestion</button>
        <button type="button" className="secondary" disabled={disabled || active >= result.proposals.length - 1} onClick={() => { setActive(active + 1); setChosen(null); }}>Next suggestion</button>
      </div>
    </article>}
  </section>;
}

function TurnProposalPanel({ proposals, reasons, analyses, settings }) {
  const [active, setActive] = useState(0); const [decisions, setDecisions] = useState({});
  const [moveIndex, setMoveIndex] = useState(null); const [missedIndex, setMissedIndex] = useState('');
  const [missed, setMissed] = useState([]); const [fullReview, setFullReview] = useState(false);
  const proposal = proposals[active];
  const start = proposal ? Math.max(0, proposal.boundaryIndex - 3) : 0;
  const end = proposal ? Math.min(analyses.length - 1, proposal.boundaryIndex + 3) : -1;
  const window = analyses.slice(start, end + 1);
  const decide = (state, index = proposal.boundaryIndex) => {
    setDecisions((current) => ({ ...current, [active]: { state, boundaryIndex: index, boundaryFile: analyses[index]?.file?.name ?? proposal.boundaryFile } }));
    setMoveIndex(null);
  };
  const downloadReport = () => {
    const report = createCalibrationReport({ appVersion: APP_VERSION, settings, analyses, proposals, reasonCounts: reasons, decisions, missedBoundaries: missed, fullFlightReviewed: fullReview });
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'gps_turn_calibration.json');
  };
  return (
    <section className="panel proposal-panel">
      <div className="panel-heading"><h2>Experimental GPS turn proposals</h2><span>Review only</span></div>
      <p>These calibration candidates do not change folders and are not included in the ZIP. Raw coordinates are never displayed.</p>
      <h3>Capture-time flight order</h3>
      {!proposals.length && <p className="empty-state">No qualifying turn was found.</p>}
      {Object.entries(reasons).filter(([, count]) => count > 0).map(([reason, count]) => <p key={reason}>{reason}: <strong>{count}</strong></p>)}
      {proposal && (() => {
        const evidence = proposal.evidence;
        return <article className="proposal-item" key={`${proposal.boundaryIndex}-${proposal.detectedAtIndex}`}>
          <span>Proposal {active + 1} of {proposals.length} • {decisions[active]?.state ?? 'unreviewed'}</span>
          <strong>{proposal.boundaryFile}: {evidence.priorDirection}→{evidence.nextDirection}</strong>
          <span>GPS displacement {evidence.gpsDisplacementM.toFixed(2)} m • cluster radii {evidence.priorClusterRadiusM.toFixed(2)} / {evidence.nextClusterRadiusM.toFixed(2)} m</span>
          <span>Evidence {proposal.evidenceStartFile}→{proposal.evidenceEndFile} • detected at {proposal.detectedAtFile}</span>
          <div className="preview-grid">{window.map((item, offset) => { const index = start + offset; return <article className="preview-card" key={item.file.name}>
            <ImageThumbnail file={item.file} /><strong>{item.file.name}</strong><span>#{index} • {formatPitch(item.pitch)}</span><span>{formatAltitude(item.altitude)} • {item.altitudeSource ?? 'unknown source'}</span>
          </article>; })}</div>
          <div className="button-grid"><button type="button" onClick={() => decide('confirmed')}>Correct boundary</button><button type="button" className="secondary" onClick={() => decide('rejected')}>Wrong proposal</button><button type="button" className="secondary" onClick={() => setMoveIndex(proposal.boundaryIndex)}>Move boundary</button></div>
          {moveIndex !== null && <div><select value={moveIndex} onChange={(event) => setMoveIndex(Number(event.target.value))}>{window.map((item, offset) => <option key={item.file.name} value={start + offset}>{item.file.name}</option>)}</select><button type="button" onClick={() => decide('moved', moveIndex)}>Save moved boundary</button></div>}
          <div className="button-grid"><button type="button" className="secondary" disabled={active === 0} onClick={() => setActive(active - 1)}>Previous</button><button type="button" className="secondary" disabled={active === proposals.length - 1} onClick={() => setActive(active + 1)}>Next</button></div>
        </article>;
      })()}
      <label>Missed GPS proposal <select value={missedIndex} onChange={(event) => setMissedIndex(event.target.value)}><option value="">Choose capture-order filename</option>{analyses.map((item, index) => <option value={index} key={`${index}-${item.file.name}`}>{item.file.name}</option>)}</select></label>
      <button type="button" className="secondary" disabled={missedIndex === ''} onClick={() => { const index = Number(missedIndex); setMissed((current) => [...current, { index, fileName: analyses[index].file.name }]); setMissedIndex(''); }}>Record missed boundary</button>
      {missed.map((item) => <span key={`${item.index}-${item.fileName}`}>Missed: {item.fileName}</span>)}
      <label className="check-row"><input type="checkbox" checked={fullReview} onChange={(event) => setFullReview(event.target.checked)} />I reviewed the full flight for missed boundaries.</label>
      <button type="button" className="download" onClick={downloadReport}>Download GPS calibration report</button>
    </section>
  );
}


function TelemetryCoverage({ analyses }) {
  const total = analyses.length;
  const available = (key) => analyses.filter((item) => item[key] !== null && item[key] !== undefined).length;
  const sources = ['relative', 'absolute', 'gps'];
  return (
    <section className="panel telemetry-coverage">
      <div className="panel-heading"><h2>Telemetry coverage</h2><span>{total} files</span></div>
      <div className="coverage-grid">
        <span>GPS coordinates available <strong>{analyses.filter((item) => item.latitude !== null && item.longitude !== null).length} / {total}</strong></span>
        <span>Pitch available <strong>{available('pitch')} / {total}</strong></span>
        <span>Capture time available <strong>{available('captureDate')} / {total}</strong></span>
        {sources.map((source) => <span key={source}>{source[0].toUpperCase() + source.slice(1)} altitude <strong>{analyses.filter((item) => item.altitudeSource === source).length}</strong></span>)}
        <span>Flight yaw available <strong>{available('flightYaw')} / {total}</strong></span>
        <span>Gimbal yaw available <strong>{available('gimbalYaw')} / {total}</strong></span>
        <span>Files with metadata warnings <strong>{analyses.filter((item) => item.warnings.length > 0).length}</strong></span>
      </div>
    </section>
  );
}

function Changelog() {
  return (
    <section className="panel changelog">
      <div className="panel-heading">
        <h2>Version history</h2>
        <span>v{APP_VERSION}</span>
      </div>
      {CHANGELOG.map((release) => (
        <article key={release.version} className="release-notes">
          <h3>{release.version}</h3>
          <p>{release.date}</p>
          <ul>
            {release.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function EmptyState() {
  return (
    <p className="empty-state">Select images, then click Analyze images. The app will create a new folder each time it finds a pitch close to -90° by default.</p>
  );
}

function FolderTable({ groups }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Folder</th>
            <th>Images</th>
            <th>Start reason</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.name}>
              <td><span className="folder-pill">{group.name}</span></td>
              <td>{group.files.length}</td>
              <td>{group.startReason}</td>
              <td>{formatBytes(group.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ analyses, groups, settings, onOverride, onReset, overrideCount, disabled }) {
  const [visibleCount, setVisibleCount] = useState(100);
  const [search, setSearch] = useState('');
  const items = useMemo(() => buildReviewItems(analyses, groups, settings), [analyses, groups, settings]);
  const filteredItems = items.filter((item) => getDisplayPath(item.file).toLowerCase().includes(search.trim().toLowerCase()));
  const visibleItems = filteredItems.slice(0, visibleCount);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Review photos</h2>
        <span>{visibleItems.length} of {filteredItems.length} shown</span>
      </div>
      <p className="review-help">Use “Start folder here (keep photo)” for the first inspection photo of a new pass. Use the marker option for a downward marker with incorrect recorded pitch. “Keep in current folder” prevents a split at that photo. Corrections update folders and the ZIP immediately.</p>
      <p className="review-help">Skipped markers stay visible here. Corrections are kept when you re-analyze, and cleared when you choose new files or reload the page.</p>
      <div className="review-toolbar">
        <label>Find a photo<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(100); }} placeholder="Filename or folder path" /></label>
        <button type="button" className="secondary" disabled={disabled || !overrideCount} onClick={onReset}>Reset all corrections ({overrideCount})</button>
      </div>
      {!filteredItems.length && <p className="empty-state">No photos match this search.</p>}
      <div className="preview-grid review-grid">
        {visibleItems.map((item) => (
          <article key={item.id} className="preview-card" aria-label={`Review ${getDisplayPath(item.file)}`}>
            <ImageThumbnail file={item.file} />
            <strong>{getFileName(item.file)}</strong>
            {getDisplayPath(item.file) !== getFileName(item.file) && <span>{getDisplayPath(item.file)}</span>}
            <span>{item.groupName ?? 'Skipped marker — excluded from ZIP'}</span>
            <span>Recorded pitch: {formatPitch(item.pitch)} • altitude {formatAltitude(item.altitude)}</span>
            {item.startReason && <span>Folder start: {item.startReason}</span>}
            <label>Folder decision
              <select aria-label={`Folder decision for ${getDisplayPath(item.file)}`} value={item.markerOverride} disabled={disabled} onChange={(event) => onOverride(item.file, event.target.value)}>
                <option value="auto">Automatic</option>
                <option value="split">Start folder here (keep photo)</option>
                <option value="marker">Start folder here (marker)</option>
                <option value="normal">Keep in current folder (inspection photo)</option>
              </select>
            </label>
            {item.markerOverride !== 'auto' && <span className="manual-label">Manual correction • select Automatic to undo</span>}
          </article>
        ))}
      </div>
      {visibleCount < filteredItems.length && <div className="preview-controls">
        <button type="button" onClick={() => setVisibleCount(Math.min(visibleCount + 100, filteredItems.length))}>Show next 100</button>
        <button type="button" className="secondary" onClick={() => setVisibleCount(filteredItems.length)}>Show all</button>
      </div>}
    </section>
  );
}

function ImageThumbnail({ file }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [hasPreviewError, setHasPreviewError] = useState(false);

  useEffect(() => {
    setHasPreviewError(false);

    if (!canPreviewInBrowser(file)) {
      setPreviewUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (!previewUrl || hasPreviewError) {
    return <div className="thumb thumb-fallback">IMG</div>;
  }

  return (
    <img
      className="thumb"
      src={previewUrl}
      alt={`Preview of ${getFileName(file)}`}
      loading="lazy"
      onError={() => setHasPreviewError(true)}
    />
  );
}
