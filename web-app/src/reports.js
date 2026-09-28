import { getDisplayPath, getFileName, safePathPart } from './files.js';
const abortError = () => Object.assign(new Error('ZIP export cancelled.'), { name: 'AbortError' });

export const DEFAULT_ZIP_BATCH_BYTES = 250 * 1024 * 1024;
const canonicalPath = (path) => path.normalize('NFC').toLowerCase();

function suffixedName(name, suffix) {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? `${name}_${suffix}` : `${name.slice(0, dot)}_${suffix}${name.slice(dot)}`;
}

// Allocate once for the entire export, so batch boundaries cannot change names.
// Reserve directories too: a photo called "camera.jpg" cannot also be a folder.
export function planZipEntries(groups, keepFolderPaths = false) {
  const files = new Set([canonicalPath('sort_report.csv')]);
  const directories = new Map();
  const directoryAliases = new Map();
  const entries = [];
  for (const group of groups) for (const item of group.files) {
    const relative = keepFolderPaths ? getDisplayPath(item.file) : getFileName(item.file);
    const parts = [safePathPart(group.name), ...relative.split('/').filter(Boolean).map(safePathPart)];
    if (parts.length === 1) parts.push('inspection_run');
    let parent = '';
    let sourceDirectory = '';
    for (const part of parts.slice(0, -1)) {
      sourceDirectory = `${sourceDirectory}/${part}`;
      if (directoryAliases.has(sourceDirectory)) {
        parent = directoryAliases.get(sourceDirectory);
        continue;
      }
      const prefix = parent ? `${parent}/` : '';
      let candidate = `${prefix}${part}`;
      for (let suffix = 2; files.has(canonicalPath(candidate)); suffix += 1) candidate = `${prefix}${suffixedName(part, suffix)}`;
      const key = canonicalPath(candidate);
      parent = directories.get(key) || candidate;
      directories.set(key, parent);
      directoryAliases.set(sourceDirectory, parent);
    }
    const name = parts.at(-1);
    let outputPath = `${parent}/${name}`;
    for (let suffix = 2; files.has(canonicalPath(outputPath)) || directories.has(canonicalPath(outputPath)); suffix += 1) {
      outputPath = `${parent}/${suffixedName(name, suffix)}`;
    }
    files.add(canonicalPath(outputPath));
    entries.push({ outputPath, groupName: group.name, item, group });
  }
  return entries;
}

function makeEntriesCsv(entries) {
  const rows = [['folder', 'file', 'pitch', 'altitude', 'capture_time', 'starts_new_folder', 'start_reason', 'size_bytes', 'error', 'marker_override', 'output_path']];
  for (const { groupName, item, outputPath } of entries) rows.push([
    groupName, getDisplayPath(item.file), item.pitch ?? '', item.altitude ?? '', item.captureDate ? item.captureDate.toISOString() : '',
    item.startsNewFolder ? 'yes' : 'no', item.startReason ?? '', item.file.size, item.error ?? '', item.markerOverride ?? 'auto', outputPath,
  ]);
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
}

export function makeCsvReport(groups, keepFolderPaths = false) {
  return makeEntriesCsv(planZipEntries(groups, keepFolderPaths));
}

// This bounds source bytes per archive, not total browser memory: ZIP chunks,
// metadata and the resulting Blob also use memory. One file cannot be split.
export function planZipBatches(groups, keepFolderPaths = false, maxBytes = DEFAULT_ZIP_BATCH_BYTES) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('ZIP batch size must be a positive number of bytes.');
  const entries = planZipEntries(groups, keepFolderPaths);
  const batches = [];
  let current = { entries: [], sizeBytes: 0, fileCount: 0, oversized: false };
  const finish = () => {
    if (current.entries.length) batches.push(current);
    current = { entries: [], sizeBytes: 0, fileCount: 0, oversized: false };
  };
  const add = (entry) => {
    const size = Number(entry.item.file.size);
    if (!Number.isFinite(size) || size < 0) throw new RangeError('Every exported photo must have a valid file size.');
    current.entries.push(entry);
    current.sizeBytes += size;
    current.fileCount += 1;
    current.oversized ||= size > maxBytes;
  };
  for (let start = 0; start < entries.length;) {
    let end = start + 1;
    while (end < entries.length && entries[end].group === entries[start].group) end += 1;
    const groupEntries = entries.slice(start, end);
    const groupSize = groupEntries.reduce((sum, entry) => sum + Number(entry.item.file.size), 0);
    if (groupSize <= maxBytes) {
      if (current.sizeBytes + groupSize > maxBytes) finish();
      groupEntries.forEach(add);
    } else {
      finish();
      for (const entry of groupEntries) {
        if (current.entries.length && current.sizeBytes + Number(entry.item.file.size) > maxBytes) finish();
        add(entry);
        if (current.sizeBytes >= maxBytes) finish();
      }
      finish();
    }
    start = end;
  }
  finish();
  return batches.map((batch, index) => ({ ...batch, allEntries: entries, index, total: batches.length }));
}

function buildZip(entries, includeCsvReport, { signal, onProgress } = {}, reportEntries = entries) {
  if (signal?.aborted) return Promise.reject(abortError());
  const payload = {
    files: entries.map(({ outputPath, item }) => ({ path: outputPath, data: item.file })),
    report: includeCsvReport ? makeEntriesCsv(reportEntries) : null,
  };
  if (typeof Worker === 'undefined') return import('./zipCore.js').then(({ generateZipFiles }) => generateZipFiles(payload, { signal, onProgress }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./exportWorker.js', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error, blob) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      error ? reject(error) : resolve(blob);
    };
    const cancel = () => finish(abortError());
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        try { onProgress?.(data.progress); } catch (error) { finish(error); }
      } else if (data.type === 'result') finish(null, data.blob);
      else if (data.type === 'error') finish(Object.assign(new Error(data.message), { name: data.name || 'Error' }));
    };
    worker.onerror = (event) => finish(new Error(event.message || 'The ZIP export worker failed.'));
    worker.onmessageerror = () => finish(new Error('The ZIP export worker returned an unreadable result.'));
    if (signal?.aborted) cancel();
    else try { worker.postMessage(payload); } catch (error) { finish(error); }
  });
}

export function makeZip(groups, keepFolderPaths, includeCsvReport, options = {}) {
  return buildZip(planZipEntries(groups, keepFolderPaths), includeCsvReport, options);
}

export function makeZipBatch(batch, includeCsvReport, options = {}) {
  // Every part carries the identical full manifest, so extracting parts into
  // one folder cannot replace the audit with a report for only the last part.
  return buildZip(batch.entries, includeCsvReport, options, batch.allEntries || batch.entries);
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
