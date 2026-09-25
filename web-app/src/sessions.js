import { emptyEdits, fileIdentity } from './workspace.js';

export const SESSION_KEY = 'pfi.review.sessions.v1';
export const SESSION_VERSION = 1;
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const hash = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));

// Bounded content fingerprints catch replacements even when filename/size/date
// match. They are identity checks for resume, not full-file integrity hashes.
export async function makeManifest(files, ids) {
  if (new Set(files.map(fileIdentity)).size !== files.length) throw new Error('Some files have identical paths, sizes and dates. Review works, but automatic resume is disabled for this selection.');
  const manifest = new Array(files.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (next < files.length) {
      const index = next++; const file = files[index];
      const first = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
      const last = new Uint8Array(await file.slice(Math.max(65536, file.size - 65536)).arrayBuffer());
      const bytes = new Uint8Array(first.length + last.length); bytes.set(first); bytes.set(last, first.length);
      manifest[index] = { id: ids.get(file), fingerprint: await hash(bytes) };
    }
  }));
  manifest.sort((a, b) => a.id.localeCompare(b.id));
  return { id: await hash(new TextEncoder().encode(JSON.stringify(manifest))), files: manifest };
}

export function cleanSettings(saved, defaults) {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(defaults)) {
    const candidate = saved?.[key];
    if (typeof candidate !== typeof value) continue;
    if (typeof value === 'number' && (!Number.isFinite(candidate) || Math.abs(candidate) > 10000 || (key !== 'markerPitch' && candidate < 0))) continue;
    if (typeof value === 'string' && candidate.length > 120) continue;
    result[key] = candidate;
  }
  if (!['capture', 'filename', 'modified'].includes(result.sortBy)) result.sortBy = defaults.sortBy;
  return result;
}

export function validateSession(value, manifest, defaults) {
  if (value?.version !== SESSION_VERSION || value.manifest?.id !== manifest.id
    || JSON.stringify(value.manifest.files) !== JSON.stringify(manifest.files)) throw new Error('This review belongs to a different or changed photo selection. Select the original complete folder.');
  const keys = new Set(manifest.files.map((file) => file.id));
  const edits = emptyEdits();
  for (const [id, mode] of Object.entries(value.edits?.markers ?? {})) if (keys.has(id) && ['marker', 'normal', 'split'].includes(mode)) edits.markers[id] = mode;
  for (const kind of ['joins', 'dismissed']) for (const [id, flag] of Object.entries(value.edits?.[kind] ?? {})) if (keys.has(id) && flag === true) edits[kind][id] = true;
  for (const [id, name] of Object.entries(value.edits?.names ?? {})) if (keys.has(id) && typeof name === 'string' && name.length <= 120) edits.names[id] = name;
  for (const [id, flag] of Object.entries(value.edits?.resolved ?? {})) if (typeof id === 'string' && id.length < 4000 && flag === true && [...keys].some((key) => id.includes(key))) edits.resolved[id] = true;
  return { ...value, edits, settings: cleanSettings(value.settings, defaults),
    activeId: keys.has(value.activeId) ? value.activeId : null,
    flightName: typeof value.flightName === 'string' ? value.flightName.slice(0, 100) : '',
    drone: typeof value.drone === 'string' ? value.drone.slice(0, 100) : '' };
}

export function loadSessions(storage) {
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Saved sessions could not be read. You can still review and export photos.');
  return value.filter((item) => item?.version === SESSION_VERSION && typeof item.manifest?.id === 'string').slice(0, 5);
}

export function saveSession(storage, session) {
  const previous = loadSessions(storage);
  const sessions = [session, ...previous.filter((item) => item.manifest.id !== session.manifest.id)].slice(0, 5);
  // Failed writes leave the previous saved reviews intact.
  storage.setItem(SESSION_KEY, JSON.stringify(sessions));
  return sessions;
}
