import { getDisplayPath } from './files.js';
import { validateSettings } from './settings.js';

export const REVIEW_STORAGE_KEY = 'flare-pfi-review-v1';
export const MAX_REVIEW_BYTES = 32 * 1024 * 1024;
const MAX_LOCAL_REVIEW_BYTES = 4 * 1024 * 1024;
const MODES = new Set(['auto', 'normal', 'marker', 'split']);
const fingerprints = new WeakMap();
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

async function describeFile(file) {
  if (!fingerprints.has(file)) fingerprints.set(file, (async () => {
    // Hash every byte in bounded chunks, then hash the ordered chunk digests.
    // This avoids loading a full-resolution photo into memory in one allocation.
    const digests = [];
    for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
      const bytes = await file.slice(offset, offset + HASH_CHUNK_BYTES).arrayBuffer();
      digests.push(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    }
    const combined = new Uint8Array(digests.length * 32);
    digests.forEach((digest, index) => combined.set(digest, index * 32));
    const digest = await crypto.subtle.digest('SHA-256', combined);
    return {
      path: getDisplayPath(file), size: file.size, lastModified: file.lastModified,
      signature: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
    };
  })().catch((error) => { fingerprints.delete(file); throw error; }));
  return fingerprints.get(file);
}

async function describeFiles(files) {
  const result = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (next < files.length) {
      const index = next++;
      result[index] = await describeFile(files[index]);
    }
  }));
  return result;
}

const fileKey = ({ path, size, lastModified, signature }) => JSON.stringify([path, size, lastModified, signature]);

export async function createReviewSession(files, settings, overrides) {
  if (!files.length || files.length > 50000) throw new Error('A review must contain between 1 and 50,000 photos.');
  const descriptions = await describeFiles(files);
  const keys = descriptions.map(fileKey);
  if (new Set(keys).size !== keys.length) throw new Error('These files cannot be distinguished. Select their original folder to save a review.');
  return {
    version: 1, savedAt: new Date().toISOString(), settings: validateSettings(settings),
    files: descriptions.map((description, index) => ({ ...description, decision: overrides.get(files[index]) ?? 'auto' })),
  };
}

export function parseReviewSession(text) {
  if (typeof text !== 'string' || text.length > MAX_REVIEW_BYTES || new TextEncoder().encode(text).length > MAX_REVIEW_BYTES) throw new Error('The review file is too large.');
  let session;
  try { session = JSON.parse(text); } catch { throw new Error('This is not a valid review file.'); }
  if (session?.version !== 1 || !Array.isArray(session.files) || !session.files.length || session.files.length > 50000
      || typeof session.savedAt !== 'string' || !Number.isFinite(Date.parse(session.savedAt))) throw new Error('Unsupported or invalid review file.');
  const settings = validateSettings(session.settings);
  const files = session.files.map((file) => {
    if (!file || typeof file.path !== 'string' || !file.path || file.path.length > 4096
        || !Number.isSafeInteger(file.size) || file.size < 0 || !Number.isSafeInteger(file.lastModified) || file.lastModified < 0
        || typeof file.signature !== 'string' || !/^[a-f0-9]{64}$/.test(file.signature) || !MODES.has(file.decision)) {
      throw new Error('The review contains an invalid photo record.');
    }
    return { path: file.path, size: file.size, lastModified: file.lastModified, signature: file.signature, decision: file.decision };
  });
  if (new Set(files.map(fileKey)).size !== files.length) throw new Error('The review contains ambiguous duplicate photos.');
  return { version: 1, savedAt: session.savedAt, settings, files };
}

export async function restoreReviewSession(session, files) {
  const checked = parseReviewSession(JSON.stringify(session));
  if (checked.files.length !== files.length) throw new Error(`Select all ${checked.files.length} original photos before resuming this review.`);
  const selected = await describeFiles(files);
  const byKey = new Map(checked.files.map((file) => [fileKey(file), file.decision]));
  const keys = selected.map(fileKey);
  if (new Set(keys).size !== keys.length || keys.some((key) => !byKey.has(key))) {
    throw new Error('These photos do not match the saved review. Select the same original files using the same folder or file selection method.');
  }
  return { settings: checked.settings, overrides: new Map(files.flatMap((file, index) => {
    const mode = byKey.get(keys[index]);
    return mode === 'auto' ? [] : [[file, mode]];
  })) };
}

export function readSavedReview() {
  try {
    const text = localStorage.getItem(REVIEW_STORAGE_KEY);
    return { session: text ? parseReviewSession(text) : null, error: null };
  } catch {
    return { session: null, error: 'Saved review unavailable. You can still load a downloaded review file.' };
  }
}

export function serializeReviewSession(session) {
  const text = JSON.stringify(session);
  if (new TextEncoder().encode(text).length > MAX_REVIEW_BYTES) throw new Error('This review is too large. Split the photo selection into smaller reviews.');
  return text;
}

export function storeReviewSession(session) {
  const text = serializeReviewSession(session);
  if (new TextEncoder().encode(text).length > MAX_LOCAL_REVIEW_BYTES) throw new Error('Review is too large for local saving. Download the review file instead.');
  localStorage.setItem(REVIEW_STORAGE_KEY, text);
}
