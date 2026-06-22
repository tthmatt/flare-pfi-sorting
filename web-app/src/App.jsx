import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import flareLogo from './assets/flare-dynamics-logo.svg';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'tif', 'tiff', 'png', 'dng']);
const BROWSER_PREVIEW_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
const METADATA_READ_LIMIT = 2 * 1024 * 1024;

const PITCH_PATTERNS = [
  /(?:drone-dji:)?GimbalPitchDegree\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /(?:drone-dji:)?CameraPitchDegree\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /(?:Camera|Gimbal)Pitch\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /<(?:[^:>]+:)?(?:GimbalPitchDegree|CameraPitchDegree|CameraPitch)>\s*([-+]?\d+(?:\.\d+)?)\s*<\//i,
];

const DATE_PATTERNS = [
  /(?:exif:)?DateTimeOriginal\s*=\s*["']([^"']+)["']/i,
  /<(?:[^:>]+:)?DateTimeOriginal>\s*([^<]+)\s*<\//i,
  /(?:xmp:)?CreateDate\s*=\s*["']([^"']+)["']/i,
];

function getFileExtension(file) {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

function isImageFile(file) {
  const extension = getFileExtension(file);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}

function canPreviewInBrowser(file) {
  return BROWSER_PREVIEW_EXTENSIONS.has(getFileExtension(file));
}

function getDisplayPath(file) {
  return file.webkitRelativePath || file.name;
}

function getFileName(file) {
  const path = getDisplayPath(file);
  return path.split('/').filter(Boolean).pop() || file.name;
}

function safePathPart(value) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[-_.]+|[-_.]+$/g, '') || 'inspection_run';
}

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

function parseCaptureDate(text) {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = match[1].trim();
    const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

async function readMetadataText(file) {
  const blob = file.slice(0, Math.min(file.size, METADATA_READ_LIMIT));
  const buffer = await blob.arrayBuffer();
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

async function readPitchAndDate(file) {
  const text = await readMetadataText(file);
  let pitch = null;
  for (const pattern of PITCH_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed)) {
      pitch = parsed;
      break;
    }
  }
  return { pitch, captureDate: parseCaptureDate(text) };
}

function isMarkerPitch(pitch, markerPitch, tolerance) {
  if (pitch === null || pitch === undefined) return false;
  return Math.abs(pitch - markerPitch) <= tolerance;
}

function sortAnalyses(analyses, sortBy) {
  return [...analyses].sort((a, b) => {
    if (sortBy === 'capture') {
      const aTime = a.captureDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const bTime = b.captureDate?.getTime() ?? Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
    }
    if (sortBy === 'modified') {
      if (a.file.lastModified !== b.file.lastModified) return a.file.lastModified - b.file.lastModified;
    }
    return getDisplayPath(a.file).localeCompare(getDisplayPath(b.file), undefined, { numeric: true, sensitivity: 'base' });
  });
}

function buildGroups(analyses, settings) {
  const ordered = sortAnalyses(analyses, settings.sortBy);
  const prefix = safePathPart(settings.folderPrefix);
  const groups = [];
  let currentGroup = null;
  let pendingNewGroup = false;
  let pendingMarkerPitch = null;
  let skippedMarkerCount = 0;

  for (const item of ordered) {
    const startsNewFolder = isMarkerPitch(item.pitch, settings.markerPitch, settings.tolerance);

    if (settings.skipMarkers && startsNewFolder) {
      skippedMarkerCount += 1;
      if (currentGroup) {
        pendingNewGroup = true;
        if (pendingMarkerPitch === null) pendingMarkerPitch = item.pitch;
      }
      continue;
    }

    if (pendingNewGroup || !currentGroup || startsNewFolder) {
      currentGroup = {
        name: `${prefix}_${String(groups.length + 1).padStart(3, '0')}`,
        files: [],
        markerPitch: pendingNewGroup ? pendingMarkerPitch : startsNewFolder ? item.pitch : null,
        size: 0,
      };
      groups.push(currentGroup);
      pendingNewGroup = false;
      pendingMarkerPitch = null;
    }
    currentGroup.files.push({ ...item, startsNewFolder });
    currentGroup.size += item.file.size;
  }

  return { groups, skippedMarkerCount };
}

async function analyzeFiles(files, settings, onProgress) {
  const images = files.filter(isImageFile);
  const analyses = [];
  for (let index = 0; index < images.length; index += 1) {
    const file = images[index];
    try {
      const metadata = await readPitchAndDate(file);
      analyses.push({ file, ...metadata, error: null });
    } catch (error) {
      analyses.push({ file, pitch: null, captureDate: null, error: error instanceof Error ? error.message : String(error) });
    }
    onProgress?.(index + 1, images.length);
  }
  return buildGroups(analyses, settings);
}

async function makeZip(groups, keepFolderPaths) {
  const zip = new JSZip();
  const usedPaths = new Map();

  for (const group of groups) {
    for (const item of group.files) {
      const relative = keepFolderPaths ? getDisplayPath(item.file) : getFileName(item.file);
      const cleanRelative = relative.split('/').filter(Boolean).map(safePathPart).join('/');
      const basePath = `${group.name}/${cleanRelative}`;
      const count = usedPaths.get(basePath) || 0;
      usedPaths.set(basePath, count + 1);

      let zipPath = basePath;
      if (count > 0) {
        const dotIndex = basePath.lastIndexOf('.');
        zipPath = dotIndex === -1 ? `${basePath}_${count + 1}` : `${basePath.slice(0, dotIndex)}_${count + 1}${basePath.slice(dotIndex)}`;
      }
      zip.file(zipPath, item.file);
    }
  }

  zip.file('sort_report.csv', makeCsvReport(groups));
  return zip.generateAsync({ type: 'blob' });
}

function makeCsvReport(groups) {
  const rows = [['folder', 'file', 'pitch', 'capture_time', 'starts_new_folder', 'size_bytes', 'error']];
  for (const group of groups) {
    for (const item of group.files) {
      rows.push([
        group.name,
        getDisplayPath(item.file),
        item.pitch ?? '',
        item.captureDate ? item.captureDate.toISOString() : '',
        item.startsNewFolder ? 'yes' : 'no',
        item.file.size,
        item.error ?? '',
      ]);
    }
  }
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [groups, setGroups] = useState([]);
  const [skippedMarkerCount, setSkippedMarkerCount] = useState(0);
  const [status, setStatus] = useState('Choose a folder or images to begin.');
  const [isWorking, setIsWorking] = useState(false);
  const [settings, setSettings] = useState({
    tolerance: 2,
    markerPitch: -90,
    folderPrefix: 'flare_inspection',
    sortBy: 'filename',
    keepFolderPaths: false,
    skipMarkers: false,
  });

  const imageFiles = useMemo(() => files.filter(isImageFile), [files]);
  const totalSize = useMemo(() => imageFiles.reduce((sum, file) => sum + file.size, 0), [imageFiles]);
  const unknownPitchCount = useMemo(() => groups.flatMap((group) => group.files).filter((item) => item.pitch === null).length, [groups]);

  useEffect(() => {
    console.log('[PFI Sorter] Current status:', status);
  }, [status]);

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function handleFileList(fileList) {
    const selected = Array.from(fileList || []);
    setFiles(selected);
    setGroups([]);
    setSkippedMarkerCount(0);
    const imageCount = selected.filter(isImageFile).length;
    setStatus(`${imageCount} supported image${imageCount === 1 ? '' : 's'} selected.`);
  }

  async function handleAnalyze() {
    if (!imageFiles.length) {
      setStatus('Select JPG, TIFF, PNG, or DNG images first.');
      return;
    }
    setIsWorking(true);
    setGroups([]);
    setSkippedMarkerCount(0);
    try {
      const result = await analyzeFiles(imageFiles, settings, (done, total) => {
        setStatus(`Analyzing ${done} of ${total} images...`);
      });
      const outputImageCount = result.groups.reduce((sum, group) => sum + group.files.length, 0);
      const skippedText = result.skippedMarkerCount ? ` Skipped ${result.skippedMarkerCount} marker image${result.skippedMarkerCount === 1 ? '' : 's'}.` : '';
      setGroups(result.groups);
      setSkippedMarkerCount(result.skippedMarkerCount);
      setStatus(`Ready: ${outputImageCount} output image${outputImageCount === 1 ? '' : 's'} grouped into ${result.groups.length} folder${result.groups.length === 1 ? '' : 's'}.${skippedText}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWorking(false);
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
      const blob = await makeZip(groups, settings.keepFolderPaths);
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
          <h1>PFI Drone Image Sorter</h1>
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
            <select value={settings.sortBy} onChange={(event) => updateSetting('sortBy', event.target.value)}>
              <option value="filename">Filename / folder order</option>
              <option value="capture">Capture time, then filename</option>
              <option value="modified">Modified time, then filename</option>
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.keepFolderPaths} onChange={(event) => updateSetting('keepFolderPaths', event.target.checked)} />
            Keep original folder paths inside each output folder
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.skipMarkers} onChange={(event) => updateSetting('skipMarkers', event.target.checked)} />
            Skip pitched-down marker photos in output
          </label>

          <h2>Output</h2>
          <button type="button" onClick={handleAnalyze} disabled={isWorking || !imageFiles.length}>Analyze images</button>
          <button type="button" className="download" onClick={handleDownloadZip} disabled={isWorking || !groups.length}>Download ZIP</button>
        </aside>

        <section className="content">
          <section className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFileList(event.dataTransfer.files); }}>
            <div className="illustration">-90°</div>
            <div>
              <h2>Inspection set</h2>
              <p>{settings.skipMarkers ? `Every image near ${settings.markerPitch}° starts a new output folder, but marker photos are skipped in the ZIP.` : `Every image near ${settings.markerPitch}° starts a new output folder. The marker image is placed at the beginning of that new folder.`}</p>
              <p className="status">{status}</p>
            </div>
          </section>

          <div className="metric-grid">
            <div><strong>{imageFiles.length}</strong><span>Ready</span></div>
            <div><strong>{unknownPitchCount}</strong><span>Unknown pitch</span></div>
            <div><strong>{settings.markerPitch}° ± {settings.tolerance}°</strong><span>Marker rule</span></div>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <h2>Folders</h2>
              <span>{groups.length ? 'Ready' : 'Waiting'}</span>
            </div>
            {groups.length ? <FolderTable groups={groups} /> : <EmptyState />}
          </section>

          {groups.length > 0 && <Preview groups={groups} />}
        </section>
      </div>
    </main>
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
            <th>Marker</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.name}>
              <td><span className="folder-pill">{group.name}</span></td>
              <td>{group.files.length}</td>
              <td>{formatPitch(group.markerPitch)}</td>
              <td>{formatBytes(group.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ groups }) {
  const items = groups.flatMap((group) => group.files.map((item) => ({ ...item, groupName: group.name })));
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Preview</h2>
        <span>{items.length} shown</span>
      </div>
      <div className="preview-grid">
        {items.map((item) => (
          <article key={`${item.groupName}-${getDisplayPath(item.file)}`} className="preview-card">
            <ImageThumbnail file={item.file} />
            <strong>{getFileName(item.file)}</strong>
            <span>{item.groupName}</span>
            <span>{formatPitch(item.pitch)}{item.startsNewFolder ? ' • starts folder' : ''}</span>
          </article>
        ))}
      </div>
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
