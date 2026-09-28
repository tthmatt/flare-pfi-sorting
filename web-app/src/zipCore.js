import JSZip from 'jszip';

export function abortError() {
  return Object.assign(new Error('ZIP export cancelled.'), { name: 'AbortError' });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function readBlob(blob, signal) {
  // A cancellable reader avoids leaving a large file read running after cancel.
  const reader = blob.stream().getReader();
  const chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    throwIfAborted(signal);
    while (true) {
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return data;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function generateZipFiles({ files, report }, { signal, onProgress } = {}) {
  throwIfAborted(signal);
  const zip = new JSZip();
  let lastProgressTime = 0;
  let lastPhase = '';
  const progress = (value, force = false) => {
    const now = Date.now();
    if (force || value.phase !== lastPhase || now - lastProgressTime >= 75) {
      onProgress?.(value);
      lastProgressTime = now;
      lastPhase = value.phase;
    }
  };
  progress({ phase: 'preparing', percent: 0, currentFile: '', completedFiles: 0, totalFiles: files.length }, true);
  for (let index = 0; index < files.length; index += 1) {
    throwIfAborted(signal);
    const { path, data } = files[index];
    const bytes = typeof data.stream === 'function' ? await readBlob(data, signal) : data;
    throwIfAborted(signal);
    zip.file(path, bytes);
    progress({ phase: 'preparing', percent: 10 * (index + 1) / Math.max(1, files.length), currentFile: path, completedFiles: 0, totalFiles: files.length });
  }
  if (report !== null && report !== undefined) zip.file('sort_report.csv', report);
  const photoCount = Object.values(zip.files).filter((entry) => !entry.dir && entry.name !== 'sort_report.csv').length;
  if (photoCount !== files.length || files.some(({ path }) => !zip.files[path] || zip.files[path].dir)) {
    throw new Error(`ZIP export validation failed: expected ${files.length} photos but the archive contains ${photoCount}.`);
  }
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const stream = zip.generateInternalStream({ type: 'uint8array', streamFiles: true, compression: 'STORE' });
    const chunks = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      stream.pause();
      chunks.length = 0;
      signal?.removeEventListener('abort', cancel);
      reject(error);
    };
    const cancel = () => fail(abortError());
    signal?.addEventListener('abort', cancel, { once: true });
    stream.on('data', (chunk, metadata) => {
      if (settled) return;
      chunks.push(chunk);
      try {
        progress({ phase: 'packing', percent: 10 + metadata.percent * 0.9, currentFile: metadata.currentFile || '', completedFiles: Math.min(files.length, Math.floor(metadata.percent / 100 * files.length)), totalFiles: files.length });
      } catch (error) { fail(error); }
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      signal?.removeEventListener('abort', cancel);
      try {
        throwIfAborted(signal);
        progress({ phase: 'packing', percent: 100, currentFile: '', completedFiles: files.length, totalFiles: files.length }, true);
        throwIfAborted(signal);
        const blob = new Blob(chunks, { type: 'application/zip' });
        chunks.length = 0;
        settled = true;
        resolve(blob);
      } catch (error) { fail(error); }
    });
    if (signal?.aborted) cancel();
    else stream.resume();
  });
}
