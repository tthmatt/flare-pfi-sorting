import JSZip from 'jszip';
import { getDisplayPath, getFileName, safePathPart } from './files.js';

export function makeCsvReport(groups) {
  const rows = [['folder', 'file', 'pitch', 'altitude', 'capture_time', 'starts_new_folder', 'start_reason', 'size_bytes', 'error']];
  for (const group of groups) for (const item of group.files) rows.push([
    group.name, getDisplayPath(item.file), item.pitch ?? '', item.altitude ?? '', item.captureDate ? item.captureDate.toISOString() : '',
    item.startsNewFolder ? 'yes' : 'no', item.startReason ?? '', item.file.size, item.error ?? '',
  ]);
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
}

export async function makeZip(groups, keepFolderPaths, includeCsvReport) {
  const zip = new JSZip();
  const usedPaths = new Map();
  for (const group of groups) for (const item of group.files) {
    const relative = keepFolderPaths ? getDisplayPath(item.file) : getFileName(item.file);
    const basePath = `${group.name}/${relative.split('/').filter(Boolean).map(safePathPart).join('/')}`;
    const count = usedPaths.get(basePath) || 0;
    usedPaths.set(basePath, count + 1);
    const dot = basePath.lastIndexOf('.');
    const zipPath = count === 0 ? basePath : dot === -1 ? `${basePath}_${count + 1}` : `${basePath.slice(0, dot)}_${count + 1}${basePath.slice(dot)}`;
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
  URL.revokeObjectURL(url);
}
