import test from 'node:test';
import assert from 'node:assert/strict';
import { indexFiles, emptyEdits } from './workspace.js';
import { cleanSettings, loadSessions, makeManifest, saveSession, validateSession } from './sessions.js';

const defaults = { tolerance: 2, markerPitch: -90, sortBy: 'filename', folderPrefix: 'test', skipMarkers: false };
const file = (name, contents = name) => new File([contents], name, { lastModified: 123 });
test('resume survives selection order changes but rejects replacements with the same name, size and date', async () => {
  const files = [file('a.jpg'), file('b.jpg')]; const ids = indexFiles(files);
  const manifest = await makeManifest(files, ids);
  const saved = { version: 1, manifest, edits: emptyEdits(), settings: { ...defaults, skipMarkers: true }, activeId: ids.get(files[1]), flightName: 'Flight 1', drone: 'Mavic 2' };
  saved.edits.markers[ids.get(files[1])] = 'split'; saved.edits.names[ids.get(files[1])] = 'North';
  const reselected = [...files].reverse(); const fresh = await makeManifest(reselected, indexFiles(reselected));
  const restored = validateSession(JSON.parse(JSON.stringify(saved)), fresh, defaults);
  assert.deepEqual(restored.edits, saved.edits); assert.equal(restored.settings.skipMarkers, true); assert.equal(restored.activeId, saved.activeId);
  const changed = [file('a.jpg', 'c.jpg'), files[1]];
  const mismatch = await makeManifest(changed, indexFiles(changed));
  assert.throws(() => validateSession(saved, mismatch, defaults), /different or changed/);
  assert.throws(() => validateSession({ ...saved, version: 99 }, fresh, defaults), /different or changed/);
});

test('ambiguous duplicate identities do not silently resume decisions onto the wrong file', async () => {
  const files = [file('same.jpg'), file('same.jpg')];
  assert.equal(new Set(indexFiles(files).values()).size, 2);
  await assert.rejects(() => makeManifest(files, indexFiles(files)), /identical paths/);
});

test('saved/imported settings are typed, bounded and versioned', () => {
  assert.deepEqual(cleanSettings({ tolerance: -1, markerPitch: -85, sortBy: 'garbage', skipMarkers: 'false', folderPrefix: 'x'.repeat(500) }, defaults), { ...defaults, markerPitch: -85 });
});

test('local storage keeps five recent reviews, and quota failure leaves previous reviews intact', () => {
  let stored = null; const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
  for (let i = 0; i < 7; i++) saveSession(storage, { version: 1, manifest: { id: String(i), files: [] } });
  assert.deepEqual(loadSessions(storage).map((row) => row.manifest.id), ['6', '5', '4', '3', '2']);
  const before = stored;
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => saveSession(storage, { version: 1, manifest: { id: '8', files: [] } }), /Quota/);
  assert.equal(stored, before);
});
