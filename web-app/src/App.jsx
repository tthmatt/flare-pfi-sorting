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
import { buildPreviewMovements } from './previewMovement.js';
import { Icon, PhotoViewer } from './ui.jsx';

const APP_VERSION = '0.5.0';
const CHANGELOG = [
  {
    version: '0.5.0', date: '2026-09-24',
    changes: ['Redesigned the desktop workspace with a compact settings sidebar and a clear import, review and export workflow.', 'Added folder and review filters, larger photo previews, full-size image viewing and clearer folder-start labels.', 'Kept telemetry, detailed guidance and version history available in collapsible sections.'],
  },
  {
    version: '0.4.6', date: '2026-09-24',
    changes: ['Detect stable, opposing vertical passes despite a moderate camera-heading change or height offset between columns.', 'Explain the heading change and retain inconclusive image checks when camera views do not align.'],
  },
  {
    version: '0.4.5', date: '2026-09-24',
    changes: ['Detect a sideways move from a vertical flight into a tilted return pass, including two inspection photos ending at a separate marker.', 'Keep incompatible camera views explicitly inconclusive and preserve the later marker boundary.'],
  },
  {
    version: '0.4.4', date: '2026-09-24',
    changes: ['Detect reversed camera sweeps at steady height after a persistent sideways move, with image confirmation required for these suggestions.'],
  },
  {
    version: '0.4.3', date: '2026-09-24',
    changes: ['Show GPS-based sideways movement and left/right direction on image previews, with the previous capture-time photo identified.'],
  },
  {
    version: '0.4.2', date: '2026-09-24',
    changes: ['Suggest persistent sideways moves in partial pass sequences and allow camera pitch adjustments.', 'Use nearby photos at similar camera angles for visual comparison, keeping the proposed folder start at the first photo after the move.'],
  },
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
  return pitch === null || pitch === undefined ? 'Unknown' : `${pitch.toFixed(1)}°`;
}

function formatAltitude(altitude) {
  return altitude === null || altitude === undefined ? 'Unknown' : `${altitude.toFixed(1)} m`;
}

const START_REASON_LABELS = {
  'first-image': 'First photo',
  'pitched-down': 'Pitch marker',
  'manual-marker': 'Manual marker',
  'manual-split': 'Inspection pass',
  'altitude-reversal': 'Altitude turn',
  'horizontal-traverse': 'Sideways traverse',
};

function startReasonLabel(reason) {
  return START_REASON_LABELS[reason] ?? reason;
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
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [reviewResetKey, setReviewResetKey] = useState(0);
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
  const previewMovements = useMemo(() => buildPreviewMovements(analyses), [analyses]);
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
    setSelectedFolder('');
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
    setStatus('Looking for sideways moves between inspection columns...');
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
      <header className="app-header">
        <div className="brand-lockup"><img src={flareLogo} alt="Flare Dynamics" /><span className="brand-divider" /><span>Flight operations</span></div>
        <div className="header-meta"><span className="privacy-note"><Icon name="shield" /> Photos stay on your device</span><span className="version-badge">v{APP_VERSION}</span></div>
      </header>

      <div className="workspace-heading">
        <div><p className="eyebrow">Inspection workspace</p><h1>PFI photo sorter<span className="title-dot">.</span></h1><p>Turn a flight’s photos into organized inspection folders.</p></div>
        <ol className="workflow" aria-label="Sorting workflow">
          <li className={analyses.length ? 'complete' : 'current'} aria-current={!analyses.length ? 'step' : undefined}><span>{analyses.length ? <Icon name="check" /> : '01'}</span><div>Add photos<small>Select & analyze</small></div></li>
          <li className={analyses.length ? 'current' : ''} aria-current={analyses.length ? 'step' : undefined}><span>02</span><div>Review folders<small>Check each pass</small></div></li>
          <li><span>03</span><div>Export ZIP<small>Ready for reporting</small></div></li>
        </ol>
      </div>

      <div className="layout">
        <aside className="panel controls" aria-label="Sort settings">
          <div className="panel-heading"><h2><Icon name="settings" /> Sort settings</h2><span className="badge">Local</span></div>
          <p className="section-description">Set up your inspection folders.</p>
          <fieldset disabled={isWorking}>
            <legend className="sr-only">Sorting and export options</legend>
            <label>Folder prefix<input type="text" value={settings.folderPrefix} onChange={(event) => updateSetting('folderPrefix', event.target.value)} /></label>
            <p className="field-hint folder-example">{safePathPart(settings.folderPrefix)}_001</p>
            <label>Sort order
              <select value={hasInspectionSplits ? 'capture' : settings.sortBy} disabled={hasInspectionSplits} onChange={(event) => updateSetting('sortBy', event.target.value)}>
                <option value="filename">Filename / folder order</option>
                <option value="capture">Capture time, then filename</option>
                <option value="modified">Modified time, then filename</option>
              </select>
            </label>
            {hasInspectionSplits && <p className="field-hint">Inspection splits use capture time. Reset those corrections to change the order.</p>}

            <div className="settings-section"><h3>ZIP contents</h3>
              <label className="check-row"><input type="checkbox" checked={settings.skipMarkers} onChange={(event) => updateSetting('skipMarkers', event.target.checked)} /><span>Skip pitched-down marker photos in output<small>Use them to split folders, then leave them out of the ZIP.</small></span></label>
              <label className="check-row"><input type="checkbox" checked={settings.removeCsvReport} onChange={(event) => updateSetting('removeCsvReport', event.target.checked)} /><span>Remove CSV report from sorted ZIP<small>Turn this off to include a record of each folder decision.</small></span></label>
              <label className="check-row"><input type="checkbox" checked={settings.keepFolderPaths} onChange={(event) => updateSetting('keepFolderPaths', event.target.checked)} /><span>Keep original paths<small>Preserve subfolders inside each output folder.</small></span></label>
            </div>

            <details className="advanced-settings">
              <summary>Advanced settings{settings.inferAltitudeTurns && <span className="advanced-active">Altitude fallback on</span>}</summary>
              <div className="field-pair">
                <label>Marker pitch (°)<input type="number" step="0.1" value={settings.markerPitch} onChange={(event) => updateSetting('markerPitch', Number.parseFloat(event.target.value) || -90)} /></label>
                <label>Tolerance (°)<input type="number" min="0" step="0.1" value={settings.tolerance} onChange={(event) => updateSetting('tolerance', Math.max(0, Number.parseFloat(event.target.value) || 0))} /></label>
              </div>
              <p className="field-hint">Altitude fallback can help when GPS or camera direction is missing. Leave it off for Visual pass suggestions, which checks altitude independently.</p>
              <label className="check-row"><input type="checkbox" checked={settings.inferAltitudeTurns} onChange={(event) => updateSetting('inferAltitudeTurns', event.target.checked)} /><span>Infer missed altitude turns</span></label>
              <label>Altitude tolerance (metres)<input type="number" min="0" step="0.05" value={settings.altitudeTolerance} onChange={(event) => updateSetting('altitudeTolerance', Math.max(0, Number.parseFloat(event.target.value) || 0))} /></label>
              <label className="check-row"><input type="checkbox" checked={settings.proposeGpsTurns} onChange={(event) => updateSetting('proposeGpsTurns', event.target.checked)} /><span>Experimental GPS proposals<small>Calibration only. Does not change folders.</small></span></label>
            </details>
          </fieldset>
          <div className="rule-summary"><Icon name="marker" /><div><strong>{settings.markerPitch}° ± {settings.tolerance}°</strong><span>Current pitch marker rule</span></div></div>
        </aside>

        <section className="content">
          <section className={`panel import-panel ${isDragging ? 'is-dragging' : ''} ${imageFiles.length ? 'has-files' : ''}`} aria-label="Add inspection photos"
            onDragOver={(event) => { event.preventDefault(); if (!isWorking) setIsDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setIsDragging(false); handleFileList(event.dataTransfer.files); }}>
            <div className="import-icon"><Icon name={imageFiles.length ? 'images' : 'upload'} /></div>
            <div className="import-copy"><h2>{imageFiles.length ? `${imageFiles.length.toLocaleString()} photos selected` : 'Add your inspection photos'}</h2><p>{imageFiles.length ? `${formatBytes(totalSize)} · ${files.length - imageFiles.length} unsupported files ignored` : 'Drop image files here, or choose a folder to get started.'}</p><span className="file-types">JPG · PNG · TIFF · DNG</span></div>
            <div className="import-actions"><div className="button-row">
              <button type="button" className={imageFiles.length ? 'secondary' : ''} onClick={() => folderInputRef.current?.click()} disabled={isWorking}><Icon name="folder" />{imageFiles.length ? 'Change folder' : 'Choose folder'}</button>
              <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()} disabled={isWorking}>Choose files</button>
            </div>{imageFiles.length > 0 && <button type="button" onClick={handleAnalyze} disabled={isWorking}><Icon name="scan" />{analyses.length ? 'Re-analyze images' : 'Analyze images'}<Icon name="arrow" /></button>}</div>
            <input ref={folderInputRef} className="hidden-input" type="file" aria-label="Choose image folder" webkitdirectory="" directory="" multiple onChange={(event) => handleFileList(event.target.files)} />
            <input ref={fileInputRef} className="hidden-input" type="file" aria-label="Choose image files" multiple accept=".jpg,.jpeg,.tif,.tiff,.png,.dng" onChange={(event) => handleFileList(event.target.files)} />
          </section>

          <div className="status-line" role="status" aria-live="polite" aria-atomic="true"><Icon name={isWorking ? 'loader' : analyses.length ? 'check' : 'info'} className={isWorking ? 'spin' : ''} /><span>{status}</span></div>

          {analyses.length > 0 && <div className="metric-grid" aria-label="Analysis summary">
            <div><Icon name="images" /><strong>{analyses.length.toLocaleString()}</strong><span>Photos analyzed</span></div>
            <div><Icon name="folder" /><strong>{groups.length.toLocaleString()}</strong><span>Output folders</span></div>
            <div><Icon name="marker" /><strong>{skippedMarkerCount.toLocaleString()}</strong><span>Markers skipped</span></div>
            <div className={unknownPitchCount ? 'needs-review' : ''}><Icon name="info" /><strong>{unknownPitchCount.toLocaleString()}</strong><span>Unknown pitch</span></div>
          </div>}

          <section className="panel folder-panel">
            <div className="panel-heading"><div><h2><Icon name="folder" /> Folder plan</h2><p className="section-description">{groups.length ? 'Select a folder to review its photos.' : 'Your inspection passes will appear here.'}</p></div><span className="badge">{groups.length ? `${groups.length} folders` : analyses.length ? 'No output' : 'Waiting for photos'}</span></div>
            {groups.length ? <FolderTable groups={groups} selectedFolder={selectedFolder} onSelect={(name) => { setSelectedFolder(name); setReviewResetKey((key) => key + 1); document.getElementById('photo-review')?.scrollIntoView({ block: 'start' }); }} /> : analyses.length
              ? <p className="empty-state">All photos are skipped markers. Review their folder decisions below or turn off “Skip marker photos”.</p>
              : <EmptyState />}
          </section>

          {analyses.length > 0 && <VisualPassPanel result={visualResult} working={visualWorking} disabled={isWorking}
            analyses={captureOrderedAnalyses} movements={previewMovements} overrides={markerOverrides} onAnalyze={handleVisualAnalyze}
            onCancel={() => visualController.current?.abort()} onOverride={setMarkerOverride} />}

          {analyses.length > 0 && <Preview key={`${selectedFolder}:${reviewResetKey}`} analyses={reviewedAnalyses} groups={groups} settings={settings} movements={previewMovements} onOverride={setMarkerOverride} onReset={resetMarkerOverrides} overrideCount={markerOverrides.size} disabled={isWorking} selectedFolder={selectedFolder} onSelectFolder={setSelectedFolder} />}
          {analyses.length > 0 && <TelemetryCoverage analyses={analyses} />}
          {analyses.length > 0 && settings.proposeGpsTurns && <TurnProposalPanel key={calibrationKey} proposals={turnCandidates} reasons={turnReasonCounts} analyses={captureOrderedAnalyses} movements={previewMovements} settings={settings} />}
          <Changelog />
        </section>
      </div>
      <footer className="export-bar">
        <div className="export-summary"><Icon name="folder" /><div><strong>{groups.length ? `${groups.length} folders · ${groups.reduce((count, group) => count + group.files.length, 0).toLocaleString()} photos in ZIP` : 'Your next inspection, organized.'}</strong><span>{analyses.length ? analysisSummary(groups, skippedMarkerCount, elapsedMs, analyses.length) : 'Add photos and analyze them to build your folder plan.'}</span></div></div>
        <div className="export-actions">{analyses.length > 0 && <span className="export-reminder">Review each pass before exporting</span>}<button type="button" className="download" onClick={handleDownloadZip} disabled={isWorking || !groups.length}><Icon name="download" /> Download ZIP<Icon name="arrow" /></button></div>
      </footer>
      <Analytics />
    </main>
  );
}

const VISUAL_REASON_LABELS = {
  'no-comparable-photos': 'No nearby pair has similar camera angles and height. Review the GPS-based suggestion yourself.',
  'unsupported-format': 'Visual comparison supports JPG and PNG photos.',
  'image-too-large': 'This photo exceeds the 64 MiB visual-analysis limit.',
  'browser-unavailable': 'This browser cannot perform the visual comparison.',
  'image-decode-failed': 'One of these photos could not be decoded.',
  'unsupported-image': 'These image dimensions are not supported.',
  'different-image-dimensions': 'The photos have different shapes or orientations.',
  'insufficient-distinct-matches': 'Too few distinct details could be matched.',
  'ambiguous-visual-motion': 'Matched details do not establish a consistent sideways shift.',
};

function VisualPassPanel({ result, working, disabled, analyses, movements, overrides, onAnalyze, onCancel, onOverride }) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [chosen, setChosen] = useState(null);
  const [applied, setApplied] = useState(() => new Map());
  useEffect(() => { setActive(0); setDismissed(new Set()); setChosen(null); setApplied(new Map()); }, [result]);
  const proposal = result?.proposals[Math.min(active, result.proposals.length - 1)];
  const unconfirmedSweeps = result?.reasons['camera-sweep-visual-inconclusive'] ?? 0;
  const start = proposal ? Math.max(0, Math.min(proposal.boundaryIndex - 2, proposal.comparisonBeforeIndex ?? proposal.boundaryIndex)) : 0;
  const end = proposal ? Math.max(proposal.boundaryIndex + 3, (proposal.comparisonAfterIndex ?? proposal.boundaryIndex) + 1) : 0;
  const window = proposal ? analyses.slice(start, end) : [];
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
    <div className="suggestion-heading"><div><div className="panel-heading"><h2><Icon name="scan" /> Visual pass suggestions</h2><span className="badge">Experimental</span></div><p className="section-description">Missed a marker? Find possible pass boundaries, then review and accept each one.</p></div>
      <div className="button-row"><button type="button" className="secondary" onClick={onAnalyze} disabled={disabled}><Icon name="scan" />{working ? 'Checking photos…' : 'Find pass boundaries'}</button>{working && <button type="button" className="secondary" onClick={onCancel}>Cancel visual analysis</button>}</div>
    </div>
    <details className="inline-help"><summary>How suggestions work & limitations</summary><p>Find one folder per inspection column using sideways movement, photos, GPS, camera direction and altitude. Suggestions never change folders until you accept them.</p><p>Capture time, GPS, gimbal yaw, pitch and altitude are required. Image checks need overlapping JPG/PNG views at similar angles. Repeated windows, large angle changes or missing metadata can leave passes undetected. Review the full flight before export.</p></details>
    {result && !result.proposals.length && <p className="empty-state">No supported transition candidate was found. This does not mean the flight contains only one pass. Use “Start folder here (keep photo)” in Review photos for missed boundaries.</p>}
    {unconfirmedSweeps > 0 && <p>{unconfirmedSweeps} potential camera sweep {unconfirmedSweeps === 1 ? 'transition lacked' : 'transitions lacked'} supporting image matches and {unconfirmedSweeps === 1 ? 'was' : 'were'} not suggested. Review those boundaries manually.</p>}
    {result?.unchecked > 0 && <p role="status">{result.unchecked} further candidates were not checked because this review is limited to 200. Review those photos manually.</p>}
    {proposal && <article className="proposal-item">
      <p><strong>Suggestion {active + 1} of {result.proposals.length}</strong> · {accepted ? 'Accepted' : dismissed.has(proposal.file) ? 'Dismissed' : 'Needs review'}</p>
      <strong>Start next folder at {getFileName(proposal.file)}</strong>
      <p>{proposal.passEvidence === 'camera-sweep' ? `Camera sweep ${proposal.priorDirection} → ${proposal.nextDirection}` : proposal.passEvidence === 'tilted-return' ? `${proposal.priorDirection === 'up' ? 'Ascent' : 'Descent'} → camera tilt ${proposal.nextDirection}` : proposal.priorDirection ? `${proposal.priorDirection} → ${proposal.nextDirection} evidence` : `${proposal.nextDirection === 'up' ? 'Ascent' : 'Descent'} after sideways move`} · sideways GPS shift about {Math.abs(proposal.lateralMeters).toFixed(1)} m · altitude change {proposal.altitudeDelta.toFixed(1)} m.</p>
      {proposal.passEvidence === 'camera-sweep' && <p><strong>Camera sweep at steady height.</strong> This suggestion uses reversed camera tilts, stable GPS positions and supporting image matches. The drone does not need to climb or descend.</p>}
      {proposal.passEvidence === 'tilted-return' && <p><strong>Tilted return pass.</strong> After the sideways move, the camera tilts back along the next column while the drone stays near the same height. Check the photos before accepting; a later marker remains a separate folder boundary.</p>}
      {proposal.passEvidence === 'changed-viewpoint' && <p><strong>Vertical passes at separate positions.</strong> Both passes show sustained vertical motion and stable GPS positions. Camera heading changes by {proposal.headingChangeDegrees.toFixed(1)}°. Check the proposed folder start before accepting.</p>}
      {proposal.passEvidence === 'partial' && <p><strong>Limited altitude evidence.</strong> Nearby photos do not show a complete preceding vertical pass. Check that the sideways move starts a new inspection column before accepting.</p>}
      {proposal.comparisonBeforeFile && (proposal.comparisonBeforeIndex !== proposal.beforeIndex || proposal.comparisonAfterIndex !== proposal.boundaryIndex)
        && <p>Similar-angle photos used for comparison: {getFileName(proposal.comparisonBeforeFile)} and {getFileName(proposal.comparisonAfterFile)}. The suggested folder start remains {getFileName(proposal.file)}.</p>}
      <p>{proposal.visual.supported ? 'Visual check: matching building details support a sideways shift.'
        : `Visual check inconclusive. ${VISUAL_REASON_LABELS[proposal.visual.reason] ?? 'Review the photos yourself before accepting.'}`}</p>
      <div className="preview-grid pass-comparison">{window.map((item, offset) => <article key={start + offset} className={`preview-card ${start + offset === boundaryIndex ? 'chosen-boundary' : ''}`}>
        <span>{start + offset === boundaryIndex ? 'NEW FOLDER START' : start + offset < boundaryIndex ? 'Before boundary' : 'After boundary'}</span>
        <ImageThumbnail file={item.file} /><strong>{getFileName(item.file)}</strong>
        <span>{formatAltitude(item.altitude)} · pitch {formatPitch(item.pitch)}</span>
        <SidewaysMovement movement={movements.get(item.file)} />
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

function TurnProposalPanel({ proposals, reasons, analyses, movements, settings }) {
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
            <SidewaysMovement movement={movements.get(item.file)} />
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
    <details className="panel telemetry-coverage disclosure-panel">
      <summary><span><Icon name="chart" /> Telemetry coverage</span><span className="disclosure-meta">{total} files</span></summary>
      <div className="coverage-grid">
        <span>GPS coordinates available <strong>{analyses.filter((item) => item.latitude !== null && item.longitude !== null).length} / {total}</strong></span>
        <span>Pitch available <strong>{available('pitch')} / {total}</strong></span>
        <span>Capture time available <strong>{available('captureDate')} / {total}</strong></span>
        {sources.map((source) => <span key={source}>{source[0].toUpperCase() + source.slice(1)} altitude <strong>{analyses.filter((item) => item.altitudeSource === source).length}</strong></span>)}
        <span>Flight yaw available <strong>{available('flightYaw')} / {total}</strong></span>
        <span>Gimbal yaw available <strong>{available('gimbalYaw')} / {total}</strong></span>
        <span>Files with metadata warnings <strong>{analyses.filter((item) => item.warnings.length > 0).length}</strong></span>
      </div>
    </details>
  );
}

function Changelog() {
  return (
    <details className="changelog disclosure-panel">
      <summary><span><Icon name="history" /> Version history</span><span className="disclosure-meta">v{APP_VERSION}</span></summary>
      <div className="release-list">{CHANGELOG.map((release) => (
        <article key={release.version} className="release-notes"><div><h3>{release.version}</h3><p>{release.date}</p></div><ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul></article>
      ))}</div>
    </details>
  );
}

function EmptyState() {
  return <div className="folder-empty"><div className="empty-folders" aria-hidden="true"><Icon name="folder" /><Icon name="folder" /><Icon name="folder" /></div><h3>A clear folder for every inspection pass</h3><p>Analyze your photos to detect pitch markers and build a folder plan.<br />You can review and adjust every boundary before exporting.</p><span><Icon name="shield" /> Original files stay unchanged</span></div>;
}

function FolderTable({ groups, selectedFolder, onSelect }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Output folders">
      <table>
        <thead><tr><th scope="col">Output folder</th><th scope="col">Photos</th><th scope="col">Starts with</th><th scope="col">Size</th><th scope="col"><span className="sr-only">Review folder</span></th></tr></thead>
        <tbody>{groups.map((group, index) => (
          <tr key={group.name} className={selectedFolder === group.name ? 'selected-row' : ''}>
            <td><button type="button" className="folder-link" onClick={() => onSelect(group.name)}><span className="folder-number">{String(index + 1).padStart(2, '0')}</span><Icon name="folder" /><span>{group.name}</span></button></td>
            <td className="tabular">{group.files.length}</td><td><span className="reason-badge">{startReasonLabel(group.startReason)}</span></td><td className="table-size tabular">{formatBytes(group.size)}</td>
            <td><button type="button" className="icon-button secondary" aria-label={`Review ${group.name}`} onClick={() => onSelect(group.name)}><Icon name="arrow" /></button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Preview({ analyses, groups, settings, movements, onOverride, onReset, overrideCount, disabled, selectedFolder, onSelectFolder }) {
  const [visibleCount, setVisibleCount] = useState(100);
  const [search, setSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [viewerFile, setViewerFile] = useState(null);
  const viewerTriggerRef = useRef(null);
  const items = useMemo(() => buildReviewItems(analyses, groups, settings), [analyses, groups, settings]);
  const folder = groups.some((group) => group.name === selectedFolder) ? selectedFolder : '';
  const inFolder = folder ? items.filter((item) => item.groupName === folder) : items;
  const filters = [
    { id: 'all', label: 'All photos', matches: () => true },
    { id: 'starts', label: 'Folder starts', matches: (item) => Boolean(item.startReason) },
    { id: 'corrected', label: 'Corrected', matches: (item) => item.markerOverride !== 'auto' },
    { id: 'skipped', label: 'Skipped markers', matches: (item) => !item.groupName },
    { id: 'unknown', label: 'Unknown pitch', matches: (item) => item.pitch === null },
  ];
  const activeFilter = filters.find((filter) => filter.id === reviewFilter);
  const filteredItems = inFolder.filter((item) => activeFilter.matches(item) && getDisplayPath(item.file).toLowerCase().includes(search.trim().toLowerCase()));
  const visibleItems = filteredItems.slice(0, visibleCount);
  const viewerIndex = filteredItems.findIndex((item) => item.file === viewerFile);
  const resetFilters = () => { setSearch(''); onSelectFolder(''); setReviewFilter('all'); setVisibleCount(100); };
  return (
    <section className="panel photo-review" id="photo-review" aria-label="Review photos">
      <div className="panel-heading"><div><h2><Icon name="images" /> Review photos</h2><p className="section-description">Check the sequence. Adjust where each folder starts.</p></div><span className="badge">{visibleItems.length} of {filteredItems.length} shown</span></div>
      <div className="review-toolbar">
        <label className="search-field"><span className="sr-only">Find a photo</span><Icon name="search" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(100); }} placeholder="Search filename or folder path…" /></label>
        <label className="folder-filter"><span className="sr-only">Filter by folder</span><select value={folder} onChange={(event) => onSelectFolder(event.target.value)}><option value="">All folders ({groups.length})</option>{groups.map((group) => <option key={group.name} value={group.name}>{group.name} · {group.files.length} photos</option>)}</select></label>
        <button type="button" className="secondary reset-button" disabled={disabled || !overrideCount} onClick={onReset}><Icon name="reset" />Reset corrections ({overrideCount})</button>
      </div>
      <div className="review-filters" role="group" aria-label="Filter photos by review status">{filters.map((filter) => <button type="button" key={filter.id} aria-pressed={reviewFilter === filter.id} onClick={() => { setReviewFilter(filter.id); setVisibleCount(100); }}>{filter.label}<span>{inFolder.filter(filter.matches).length}</span></button>)}</div>
      <details className="inline-help"><summary>Folder decisions & movement guide</summary><p>Use “Start folder here (keep photo)” for the first inspection photo of a new pass. Use the marker option for a downward marker with incorrect recorded pitch. “Keep in current folder” prevents a split at that photo. Corrections update folders and the ZIP immediately.</p><p>Skipped markers stay visible here. Corrections are kept when you re-analyze, and cleared when you choose new files or reload the page.</p><p>Sideways movement is a GPS estimate from the previous photo with a valid capture time, including skipped markers. Left/right is relative to that photo’s camera heading. Search and display order do not change the comparison.</p></details>
      {!filteredItems.length && <div className="empty-state"><strong>No photos match these filters.</strong><p>Try a different filename, folder or review status.</p><button type="button" className="secondary" onClick={resetFilters}>Clear filters</button></div>}
      <div className="preview-grid review-grid">
        {visibleItems.map((item) => (
          <article key={item.id} className={`preview-card ${item.startReason ? 'folder-start' : ''} ${!item.groupName ? 'skipped-card' : ''}`} aria-label={`Review ${getDisplayPath(item.file)}`}>
            <div className="photo-heading"><strong title={getDisplayPath(item.file)}>{getFileName(item.file)}</strong><span className={`photo-badge ${item.startReason ? 'start-badge' : ''}`}>{!item.groupName ? 'Skipped' : item.startReason ? 'Folder start' : 'Inspection'}</span></div>
            <ImageThumbnail file={item.file} onOpen={canPreviewInBrowser(item.file) ? (event) => { viewerTriggerRef.current = event.currentTarget; setViewerFile(item.file); } : undefined} />
            <div className="photo-body">
              <span className="photo-folder"><Icon name="folder" />{item.groupName ?? 'Marker excluded from ZIP'}</span>
              {getDisplayPath(item.file) !== getFileName(item.file) && <span className="source-path" title={getDisplayPath(item.file)}>{getDisplayPath(item.file)}</span>}
              <div className="photo-telemetry"><div><span>Recorded pitch</span><strong>{formatPitch(item.pitch)}</strong></div><div><span>Altitude</span><strong>{formatAltitude(item.altitude)}</strong></div></div>
              <div className="movement-block"><SidewaysMovement movement={movements.get(item.file)} /></div>
              {item.startReason && <span className="start-reason"><Icon name="marker" />{startReasonLabel(item.startReason)}</span>}
              <label>Folder decision<select aria-label={`Folder decision for ${getDisplayPath(item.file)}`} value={item.markerOverride} disabled={disabled} onChange={(event) => onOverride(item.file, event.target.value)}>
                <option value="auto">Automatic</option><option value="split">Start folder here (keep photo)</option><option value="marker">Start folder here (marker)</option><option value="normal">Keep in current folder (inspection photo)</option>
              </select></label>
              {item.markerOverride !== 'auto' && <span className="manual-label"><Icon name="check" />Manual correction · Automatic to undo</span>}
            </div>
          </article>
        ))}
      </div>
      {visibleCount < filteredItems.length && <div className="preview-controls"><span>{filteredItems.length - visibleItems.length} more photos</span><button type="button" className="secondary" onClick={() => setVisibleCount(Math.min(visibleCount + 100, filteredItems.length))}>Show next 100</button><button type="button" className="secondary" onClick={() => setVisibleCount(filteredItems.length)}>Show all</button></div>}
      {viewerFile && <PhotoViewer file={viewerFile} onClose={() => setViewerFile(null)} returnFocusRef={viewerTriggerRef}
        onPrevious={viewerIndex > 0 ? () => setViewerFile(filteredItems[viewerIndex - 1].file) : undefined}
        onNext={viewerIndex >= 0 && viewerIndex < filteredItems.length - 1 ? () => setViewerFile(filteredItems[viewerIndex + 1].file) : undefined} />}
    </section>
  );
}

const MOVEMENT_REASON_LABELS = {
  'first-photo': 'First photo with capture time',
  'missing-time': 'Unavailable — capture time missing',
  'ambiguous-time': 'Unavailable — capture times are tied',
  'missing-heading': 'Unavailable — previous camera direction missing',
  'missing-gps': 'Unavailable — GPS missing or invalid',
};

function SidewaysMovement({ movement }) {
  let label = MOVEMENT_REASON_LABELS[movement?.reason] ?? 'Unavailable';
  if (Number.isFinite(movement?.meters)) {
    const distance = Math.abs(movement.meters).toFixed(2);
    const direction = Number(distance) === 0 ? '' : movement.meters > 0 ? ' right' : ' left';
    label = `${distance} m${direction} (GPS estimate)`;
  }
  return <>
    <span className="sideways-movement">Sideways movement: {label}</span>
    {movement?.previousFile && <span className="movement-reference">From {getDisplayPath(movement.previousFile)}</span>}
  </>;
}

function ImageThumbnail({ file, onOpen }) {
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
    return <div className="thumb thumb-fallback">{canPreviewInBrowser(file) ? 'Preview unavailable' : 'Preview not supported'}</div>;
  }

  const thumbnail = (
    <img
      className="thumb"
      src={previewUrl}
      alt={`Preview of ${getFileName(file)}`}
      loading="lazy"
      onError={() => setHasPreviewError(true)}
    />
  );
  return onOpen ? <button type="button" className="thumbnail-button" onClick={onOpen} aria-label={`Expand ${getFileName(file)}`}>{thumbnail}<span className="thumb-open"><Icon name="expand" />Expand photo</span></button> : thumbnail;
}
