import JSZip from 'jszip';
import { getDisplayPath, getFileName, safePathPart } from './files.js';

export function makeCsvReport(groups) {
  const rows = [['folder', 'file', 'pitch', 'altitude', 'capture_time', 'starts_new_folder', 'start_reason', 'size_bytes', 'error', 'marker_override', 'boundary_override']];
  for (const group of groups) for (const item of group.files) rows.push([
    group.name, getDisplayPath(item.file), item.pitch ?? '', item.altitude ?? '', item.captureDate ? item.captureDate.toISOString() : '',
    item.startsNewFolder ? 'yes' : 'no', item.startReason ?? '', item.file.size, item.error ?? '', item.markerOverride ?? 'auto', item.boundaryOverride ?? '',
  ]);
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
}

export async function makeZip(groups, keepFolderPaths, includeCsvReport) {
  const zip = new JSZip();
  const usedPaths = new Set();
  for (const group of groups) for (const item of group.files) {
    const relative = keepFolderPaths ? getDisplayPath(item.file) : getFileName(item.file);
    const basePath = `${group.name}/${relative.split('/').filter(Boolean).map(safePathPart).join('/')}`;
    const dot = basePath.lastIndexOf('.') > basePath.lastIndexOf('/') ? basePath.lastIndexOf('.') : -1;
    let zipPath = basePath; let count = 2;
    while (usedPaths.has(zipPath.toLowerCase())) {
      zipPath = dot === -1 ? `${basePath}_${count++}` : `${basePath.slice(0, dot)}_${count++}${basePath.slice(dot)}`;
    }
    usedPaths.add(zipPath.toLowerCase());
    zip.file(zipPath, item.file);
  }
  if (includeCsvReport) zip.file('sort_report.csv', makeCsvReport(groups));
  return zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Let the browser consume the URL before releasing it. Immediate revocation
  // can race the asynchronous download/navigation in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
