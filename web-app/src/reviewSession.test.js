import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReviewSession, MAX_REVIEW_BYTES, parseReviewSession, readSavedReview,
  restoreReviewSession, REVIEW_STORAGE_KEY, serializeReviewSession, storeReviewSession,
} from './reviewSession.js';
import { DEFAULT_SETTINGS } from './settings.js';

function photo(path, content = path, options = {}) {
  const file = new File([content], path.split('/').at(-1), {
    type: 'image/jpeg', lastModified: options.lastModified ?? 1_700_000_000_000,
  });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

const copy = (value) => JSON.parse(JSON.stringify(value));

async function exampleSession() {
  const files = [photo('flight/a.jpg'), photo('flight/b.jpg')];
  return createReviewSession(files, DEFAULT_SETTINGS, new Map([[files[1], 'split']]));
}

test('review restores decisions onto new File objects regardless of selection order', async () => {
  const paths = ['flight/left/same.jpg', 'flight/right/same.jpg', 'flight/c.jpg', 'flight/d.jpg'];
  const originals = paths.map((path) => photo(path));
  const settings = { ...DEFAULT_SETTINGS, folderPrefix: 'north_tower', skipMarkers: true, sortBy: 'capture' };
  const overrides = new Map([[originals[0], 'normal'], [originals[1], 'marker'], [originals[2], 'split']]);
  const serialized = JSON.stringify(await createReviewSession(originals, settings, overrides));
  const selected = [paths[2], paths[0], paths[3], paths[1]].map((path) => photo(path));
  const result = await restoreReviewSession(parseReviewSession(serialized), selected);

  assert.deepEqual(result.settings, settings);
  assert.equal(result.overrides.size, 3);
  assert.equal(result.overrides.get(selected[0]), 'split');
  assert.equal(result.overrides.get(selected[1]), 'normal');
  assert.equal(result.overrides.has(selected[2]), false, 'automatic decisions do not create overrides');
  assert.equal(result.overrides.get(selected[3]), 'marker');
  assert.ok(originals.every((file) => !result.overrides.has(file)), 'old File identities must not leak into restored decisions');
  assert.equal(overrides.size, 3, 'creating a session must not mutate the active decisions');
});

test('restore rejects a missing or extra photo before applying any decisions', async () => {
  const session = await exampleSession();
  for (const selected of [[photo('flight/a.jpg')], [photo('flight/a.jpg'), photo('flight/b.jpg'), photo('flight/c.jpg')]]) {
    await assert.rejects(restoreReviewSession(session, selected), /all 2 original photos/i);
  }
});

test('restore rejects changed paths, size, modification time and same-size photo contents', async () => {
  const original = photo('flight/a.jpg', 'original image');
  const session = await createReviewSession([original], DEFAULT_SETTINGS, new Map([[original, 'marker']]));
  const mismatches = [
    photo('other/a.jpg', 'original image'),
    photo('flight/a.jpg', 'original image extra'),
    photo('flight/a.jpg', 'original image', { lastModified: original.lastModified + 1 }),
    photo('flight/a.jpg', 'modified image'),
  ];
  assert.equal(mismatches[3].size, original.size, 'content mismatch fixture must have identical size');
  for (const file of mismatches) {
    await assert.rejects(restoreReviewSession(session, [file]), /do not match/i);
  }
  await assert.rejects(restoreReviewSession(session, [new File(['original image'], 'a.jpg', { lastModified: original.lastModified })]), /do not match/i,
    'folder selection and plain file selection must not be silently conflated');
});

test('a content change in the middle of a large photo cannot inherit another photo’s decisions', async () => {
  const bytes = new Uint8Array(256 * 1024).fill(37);
  const original = photo('flight/a.jpg', bytes);
  const session = await createReviewSession([original], DEFAULT_SETTINGS, new Map([[original, 'split']]));
  const changed = bytes.slice();
  changed[128 * 1024] = 38;
  await assert.rejects(restoreReviewSession(session, [photo('flight/a.jpg', changed)]), /do not match/i);
});

test('complete multi-megabyte photos round-trip and changes near the end are detected', async () => {
  const bytes = new Uint8Array(5 * 1024 * 1024 + 321).fill(91);
  const original = photo('flight/large.jpg', bytes);
  const session = await createReviewSession([original], DEFAULT_SETTINGS, new Map([[original, 'normal']]));
  const reselected = photo('flight/large.jpg', bytes);
  assert.equal((await restoreReviewSession(session, [reselected])).overrides.get(reselected), 'normal');
  const changed = bytes.slice();
  changed[changed.length - 2] = 90;
  await assert.rejects(restoreReviewSession(session, [photo('flight/large.jpg', changed)]), /do not match/i);
});

test('ambiguous duplicate photos are rejected when saving, parsing and restoring', async () => {
  const first = photo('flight/a.jpg', 'identical');
  const duplicate = photo('flight/a.jpg', 'identical');
  await assert.rejects(createReviewSession([first, duplicate], DEFAULT_SETTINGS, new Map()), /cannot be distinguished/i);

  const session = await exampleSession();
  const duplicatedRecord = copy(session);
  duplicatedRecord.files[1] = { ...duplicatedRecord.files[0], decision: 'normal' };
  assert.throws(() => parseReviewSession(JSON.stringify(duplicatedRecord)), /duplicate/i);
  await assert.rejects(restoreReviewSession(session, [photo('flight/a.jpg'), photo('flight/a.jpg')]), /do not match/i);
});

test('malformed, unsupported and oversized review files are rejected', async () => {
  const valid = await exampleSession();
  for (const text of ['{', 'null', '[]', 'null '.repeat(Math.ceil(MAX_REVIEW_BYTES / 5) + 1)]) {
    assert.throws(() => parseReviewSession(text));
  }
  for (const mutation of [
    (session) => { session.version = 2; },
    (session) => { session.savedAt = 'not a date'; },
    (session) => { session.files = []; },
    (session) => { session.files[0].decision = 'delete'; },
    (session) => { session.files[0].signature = 'incorrect'; },
    (session) => { session.files[0].size = -1; },
    (session) => { session.files[0].lastModified = 1.5; },
    (session) => { session.files[0].path = ''; },
  ]) {
    const session = copy(valid);
    mutation(session);
    assert.throws(() => parseReviewSession(JSON.stringify(session)));
  }
});

test('review settings reject invalid types, ranges and unsupported sort orders', async () => {
  const valid = await exampleSession();
  for (const settings of [null, [], 'settings', { skipMarkers: 'false' }, { tolerance: -1 },
    { tolerance: null }, { tolerance: 10001 }, { markerPitch: -181 }, { sortBy: 'random' },
    { folderPrefix: 'x'.repeat(201) }]) {
    assert.throws(() => parseReviewSession(JSON.stringify({ ...valid, settings })));
  }
  const parsed = parseReviewSession(JSON.stringify({ ...valid, settings: { folderPrefix: 'restored' } }));
  assert.deepEqual(parsed.settings, { ...DEFAULT_SETTINGS, folderPrefix: 'restored' });
});

test('review settings reject fractional or unusable photo-count thresholds', async () => {
  const valid = await exampleSession();
  for (const settings of [
    { altitudeMinSteps: 0 }, { altitudeMinSteps: 1.5 },
    { horizontalMinPhotos: 0 }, { horizontalMinPhotos: 1 }, { horizontalMinPhotos: 2.5 },
    { gpsWindowSize: 0 }, { gpsWindowSize: 2.5 }, { altitudeMarkerSuppression: 0.5 },
  ]) {
    assert.throws(() => parseReviewSession(JSON.stringify({ ...valid, settings })), undefined, JSON.stringify(settings));
  }
});

function useStorage(t, storage) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
}

test('saving and reading a valid review preserves settings and decisions', async (t) => {
  const values = new Map();
  useStorage(t, { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  assert.deepEqual(readSavedReview(), { session: null, error: null });
  const session = await exampleSession();
  storeReviewSession(session);
  assert.equal(values.has(REVIEW_STORAGE_KEY), true);
  assert.deepEqual(readSavedReview(), { session, error: null });
});

test('blocked or corrupt local storage leaves downloaded-review recovery available', async (t) => {
  const failure = new Error('Storage access denied');
  useStorage(t, { getItem() { throw failure; }, setItem() { throw failure; } });
  const result = readSavedReview();
  assert.equal(result.session, null);
  assert.match(result.error, /downloaded review file/i);
  const session = await exampleSession();
  assert.throws(() => storeReviewSession(session), (error) => error === failure);
  assert.deepEqual(parseReviewSession(JSON.stringify(session)), session, 'downloaded reviews still work without storage');

  globalThis.localStorage.getItem = () => '{broken';
  assert.equal(readSavedReview().session, null);
  assert.match(readSavedReview().error, /unavailable/i);
});

test('oversized reviews do not attempt a local-storage write', (t) => {
  let writes = 0;
  useStorage(t, { setItem() { writes += 1; } });
  assert.throws(() => storeReviewSession({ data: 'x'.repeat(MAX_REVIEW_BYTES) }), /too large/i);
  assert.equal(writes, 0);
});

test('a review larger than local storage can be downloaded compactly and loaded again', async (t) => {
  const session = await exampleSession();
  const directory = `${'nested-folder-'.padEnd(100, 'x')}/`.repeat(10);
  session.files = Array.from({ length: 5000 }, (_, index) => ({
    ...session.files[0], path: `${directory}${index}.jpg`, decision: index % 2 ? 'split' : 'normal',
  }));
  const text = serializeReviewSession(session);
  const bytes = new TextEncoder().encode(text).length;
  assert.ok(bytes > 4 * 1024 * 1024, 'fixture must exceed the local-saving limit');
  assert.ok(bytes < MAX_REVIEW_BYTES, 'fixture must fit the downloaded-review limit');
  assert.equal(text, JSON.stringify(session), 'downloads should not waste the file budget on indentation');
  const reloaded = parseReviewSession(text);
  assert.deepEqual(reloaded, session);

  let writes = 0;
  useStorage(t, { setItem() { writes += 1; } });
  assert.throws(() => storeReviewSession(session), /download the review file/i);
  assert.equal(writes, 0, 'oversized local data must not replace an existing saved review');
});

test('the downloaded-review limit counts UTF-8 bytes rather than JavaScript characters', async () => {
  const session = await exampleSession();
  // Each path is valid and below the path-length limit. The total JSON is below
  // the character limit but exceeds the byte limit because these names use UTF-8.
  const directory = `${'界'.repeat(80)}/`.repeat(15);
  session.files = Array.from({ length: 10000 }, (_, index) => ({
    ...session.files[0], path: `${directory}${index}.jpg`,
  }));
  const text = JSON.stringify(session);
  assert.ok(text.length < MAX_REVIEW_BYTES);
  assert.ok(new TextEncoder().encode(text).length > MAX_REVIEW_BYTES);
  assert.throws(() => parseReviewSession(text), /too large/i);
  assert.throws(() => serializeReviewSession(session), /too large/i);
});
