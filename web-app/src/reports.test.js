import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildGroups } from './grouping.js';
import { makeCsvReport, makeZip, makeZipBatch, planZipBatches, planZipEntries } from './reports.js';

function photo(name, content, relativePath = '') {
  const bytes = Buffer.from(content);
  return { file: Object.assign(bytes, { name, size: bytes.length, webkitRelativePath: relativePath }) };
}

async function unzip(blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

test('duplicates, pre-suffixed names, sanitation and case collisions retain every original byte', async () => {
  for (const names of [
    ['a.jpg', 'a.jpg', 'a_2.jpg'],
    ['a.jpg', 'a_2.jpg', 'a.jpg'],
    ['a b.jpg', 'a_b.jpg', 'a_b_2.jpg'],
    ['PHOTO.jpg', 'photo.jpg', 'photo_2.jpg'],
    ['café.jpg', 'cafe\u0301.jpg'],
  ]) {
    const groups = [{ name: 'run_001', files: names.map((name, index) => photo(name, `bytes-${index}`)) }];
    const plan = planZipEntries(groups);
    const zip = await unzip(await makeZip(groups, false, true));
    const files = Object.values(zip.files).filter((file) => !file.dir && file.name !== 'sort_report.csv');
    assert.equal(files.length, names.length, names.join(', '));
    assert.equal(new Set(files.map((file) => file.name.normalize('NFC').toLowerCase())).size, names.length);
    for (const [index, entry] of plan.entries()) assert.deepEqual(await zip.file(entry.outputPath).async('nodebuffer'), Buffer.from(`bytes-${index}`));
    const csv = await zip.file('sort_report.csv').async('string');
    assert.match(csv, /"output_path"/);
    for (const entry of plan) assert.ok(csv.includes(`"${entry.outputPath}"`));
  }
});

test('preserved paths cannot overwrite files with folders, escape the ZIP root or replace the CSV', async () => {
  for (const paths of [['camera.jpg', 'camera.jpg/b.jpg', 'camera_2.jpg'], ['camera.jpg/b.jpg', 'camera.jpg']]) {
    const groups = [{ name: 'sort_report.csv', files: paths.map((path, index) => photo(path.split('/').at(-1), `image-${index}`, path)) }];
    groups[0].files.push(photo('c.jpg', 'safe', '../../c.jpg'));
    const plan = planZipEntries(groups, true);
    const zip = await unzip(await makeZip(groups, true, true));
    assert.equal(Object.values(zip.files).filter((file) => !file.dir).length, groups[0].files.length + 1);
    for (const entry of plan) {
      assert.ok(!entry.outputPath.split('/').includes('..'));
      assert.deepEqual(await zip.file(entry.outputPath).async('nodebuffer'), Buffer.from(entry.item.file));
    }
    assert.match(await zip.file('sort_report.csv').async('string'), /"output_path"/);
  }
});

test('batches retain whole groups when possible and split large groups within the source-byte budget', async () => {
  const groups = [
    { name: 'run_001', files: [photo('a.jpg', '1234'), photo('a.jpg', '5678')] },
    { name: 'run_002', files: [photo('a.jpg', '1234'), photo('a.jpg', '5678')] },
    { name: 'run_003', files: [photo('a.jpg', '123456'), photo('a.jpg', 'abcdef'), photo('a_2.jpg', 'z')] },
  ];
  const batches = planZipBatches(groups, false, 10);
  assert.deepEqual(batches.map(({ sizeBytes, fileCount }) => [sizeBytes, fileCount]), [[8, 2], [8, 2], [6, 1], [7, 2]]);
  assert.deepEqual(batches.map(({ index, total }) => [index, total]), [[0, 4], [1, 4], [2, 4], [3, 4]]);
  assert.deepEqual(batches.flatMap((batch) => batch.entries.map((entry) => entry.outputPath)), planZipEntries(groups).map((entry) => entry.outputPath));
  let count = 0;
  for (const batch of batches) {
    assert.equal(batch.oversized, false);
    const zip = await unzip(await makeZipBatch(batch, true));
    const csv = await zip.file('sort_report.csv').async('string');
    assert.equal(Object.values(zip.files).filter((file) => !file.dir).length, batch.fileCount + 1);
    assert.equal(csv.split('\n').length, batch.allEntries.length + 1);
    for (const entry of batch.entries) {
      assert.deepEqual(await zip.file(entry.outputPath).async('nodebuffer'), Buffer.from(entry.item.file));
      assert.ok(csv.includes(`"${entry.outputPath}"`));
      count += 1;
    }
  }
  assert.equal(count, 7);
});

test('each ZIP part has the identical complete manifest while containing only its own photo bytes', async () => {
  const groups = [{ name: 'run', files: [photo('a.jpg', '1234'), photo('a.jpg', '5678'), photo('a_2.jpg', 'abcd')] }];
  const batches = planZipBatches(groups, false, 8);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].allEntries, batches[1].allEntries);
  const reports = [];
  for (const batch of batches) {
    const zip = await unzip(await makeZipBatch(batch, true));
    reports.push(await zip.file('sort_report.csv').async('string'));
    assert.equal(Object.values(zip.files).filter((entry) => !entry.dir && entry.name !== 'sort_report.csv').length, batch.fileCount);
    for (const entry of batch.entries) assert.deepEqual(await zip.file(entry.outputPath).async('nodebuffer'), Buffer.from(entry.item.file));
    for (const entry of batch.allEntries.filter((entry) => !batch.entries.includes(entry))) assert.equal(zip.file(entry.outputPath), null);
  }
  assert.equal(reports[0], reports[1]);
  assert.equal(reports[0], makeCsvReport(groups));
  assert.equal(reports[0].split('\n').length, 4);
  for (const entry of batches[0].allEntries) assert.ok(reports[0].includes(`"${entry.outputPath}"`));
});

test('ZIP validation rejects a corrupted export plan that would silently lose a photo', async () => {
  const batch = planZipBatches([{ name: 'run', files: [photo('a.jpg', 'first'), photo('b.jpg', 'second')] }])[0];
  batch.entries[1].outputPath = batch.entries[0].outputPath;
  await assert.rejects(makeZipBatch(batch, true), /expected 2 photos but the archive contains 1/);
});

test('a single oversized photo is isolated and flagged, and invalid batch limits are rejected', () => {
  const groups = [{ name: 'run', files: [photo('big.jpg', '12345678901'), photo('small.jpg', '1')] }];
  const batches = planZipBatches(groups, false, 10);
  assert.deepEqual(batches.map(({ sizeBytes, oversized }) => [sizeBytes, oversized]), [[11, true], [1, false]]);
  for (const limit of [0, -1, NaN, Infinity]) assert.throws(() => planZipBatches(groups, false, limit), RangeError);
  assert.deepEqual(planZipBatches([], false, 10), []);
});

test('Blob photo inputs produce progress and preserve bytes', async () => {
  const file = Object.assign(new Blob(['original bytes']), { name: 'photo.jpg' });
  const progress = [];
  const zip = await unzip(await makeZip([{ name: 'run', files: [{ file }] }], false, false, { onProgress: (value) => progress.push(value) }));
  assert.equal(await zip.file('run/photo.jpg').async('string'), 'original bytes');
  assert.equal(progress[0].percent, 0);
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).completedFiles, 1);
  assert.ok(progress.some((value) => value.phase === 'packing'));
  assert.ok(progress.every((value, index) => !index || value.percent >= progress[index - 1].percent));
});

test('cancelling an active file read cancels the underlying reader and rejects the export', async () => {
  const controller = new AbortController();
  let cancelled = false;
  let started;
  const reading = new Promise((resolve) => { started = resolve; });
  const file = { name: 'slow.jpg', size: 100, stream: () => new ReadableStream({
    pull() { started(); },
    cancel() { cancelled = true; },
  }) };
  const promise = makeZip([{ name: 'run', files: [{ file }] }], false, false, { signal: controller.signal });
  await reading;
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('cancelling during ZIP generation pauses the active ZIP stream', async (t) => {
  const controller = new AbortController();
  const original = JSZip.prototype.generateInternalStream;
  let paused = false;
  t.mock.method(JSZip.prototype, 'generateInternalStream', function (options) {
    const stream = original.call(this, options);
    const pause = stream.pause;
    stream.pause = function () { paused = true; return pause.call(this); };
    return stream;
  });
  const promise = makeZip([{ name: 'run', files: [photo('a.jpg', 'a'.repeat(100_000))] }], false, false, {
    signal: controller.signal,
    onProgress(value) { if (value.phase === 'packing') controller.abort(); },
  });
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(paused, true);
});

test('an already cancelled export never reads input or starts a worker', async () => {
  const controller = new AbortController();
  controller.abort();
  let read = false;
  const file = { name: 'a.jpg', size: 1, stream() { read = true; throw new Error('Unexpected read'); } };
  await assert.rejects(makeZip([{ name: 'run', files: [{ file }] }], false, false, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(read, false);
});

test('browser cancellation terminates the export worker instead of merely discarding its result', async (t) => {
  const oldWorker = globalThis.Worker;
  t.after(() => { if (oldWorker === undefined) delete globalThis.Worker; else globalThis.Worker = oldWorker; });
  let worker;
  globalThis.Worker = class {
    constructor() { worker = this; this.terminated = false; }
    postMessage(payload) { this.payload = payload; }
    terminate() { this.terminated = true; }
  };
  const controller = new AbortController();
  const progress = [];
  const promise = makeZip([{ name: 'run', files: [photo('a.jpg', 'original')] }], false, true, {
    signal: controller.signal, onProgress: (value) => progress.push(value),
  });
  assert.equal(worker.payload.files[0].path, 'run/a.jpg');
  worker.onmessage({ data: { type: 'progress', progress: { percent: 25 } } });
  assert.deepEqual(progress, [{ percent: 25 }]);
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
  assert.equal(worker.onmessage, null);
});

test('accepted inspection boundary retains the original photo and records manual-split even when skipping markers', async () => {
  const items = [-10, -90, 0, -10].map((pitch, index) => ({
    file: Object.assign(Buffer.from(`unchanged-${index}`), { name: `${index}.jpg`, size: 11 }),
    pitch, captureDate: new Date(1000 * index), markerOverride: index === 2 ? 'split' : 'auto',
  }));
  const { groups, skippedMarkerCount } = buildGroups(items, { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers: true });
  assert.equal(skippedMarkerCount, 1);
  assert.equal(groups[1].startReason, 'manual-split');
  const zip = await JSZip.loadAsync(await (await makeZip(groups, false, true)).arrayBuffer());
  assert.equal(await zip.file('test_002/2.jpg').async('string'), 'unchanged-2');
  assert.equal(zip.file('test_002/1.jpg'), null);
  assert.match(await zip.file('sort_report.csv').async('string'), /manual-split/);
  // An explicit keep-photo split also preserves a photo recorded at -90 degrees.
  items[2].pitch = -90;
  assert.equal(buildGroups(items, { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers: true }).groups[1].files[0].file, items[2].file);
});

test('corrected folders and CSV reach the ZIP while original file bytes remain unchanged', async () => {
  const items = [-10, 0, -20].map((pitch, index) => ({
    file: Object.assign(Buffer.from(`original-photo-${index}`), { name: `${index}.jpg`, size: 16 }),
    pitch, altitude: 9.1, captureDate: new Date('2026-07-15T16:58:22Z'), markerOverride: index === 1 ? 'marker' : 'auto',
  }));
  for (const skipMarkers of [false, true]) {
    const { groups } = buildGroups(items, { markerPitch: -90, tolerance: 2, sortBy: 'filename', folderPrefix: 'test', skipMarkers });
    const blob = await makeZip(groups, false, true);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
    assert.deepEqual(paths, skipMarkers
      ? ['test_001/0.jpg', 'test_002/2.jpg', 'sort_report.csv']
      : ['test_001/0.jpg', 'test_002/1.jpg', 'test_002/2.jpg', 'sort_report.csv']);
    assert.equal(await zip.file('test_002/2.jpg').async('string'), 'original-photo-2');
    const csv = await zip.file('sort_report.csv').async('string');
    assert.equal(csv, makeCsvReport(groups));
    assert.match(csv, /manual-marker/);
    assert.match(csv, /2026-07-15T16:58:22.000Z/);
    if (!skipMarkers) {
      assert.match(csv, /"1.jpg","0"/);
      assert.equal(await zip.file('test_002/1.jpg').async('string'), 'original-photo-1');
    }
  }
});
