import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
const names = ['a b.png', 'a_b.png', 'a_b_2.png'];
let directory;
let photos;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'flare-browser-'));
  photos = await Promise.all(names.map(async (name, index) => {
    const path = join(directory, name);
    await writeFile(path, Buffer.concat([png, Buffer.from(`\n<x drone-dji:GimbalPitchDegree="0" drone-dji:RelativeAltitude="${index * 8}" DateTimeOriginal="2026-09-28T08:00:0${index}Z" />`)]));
    return path;
  }));
});
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

async function selectPhotos(page) {
  await page.getByLabel('Choose image files', { exact: true }).setInputFiles(photos);
}
async function analyze(page) {
  await selectPhotos(page);
  await page.getByRole('button', { name: 'Analyze images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeEnabled();
}
async function download(page, button) {
  const event = page.waitForEvent('download');
  await button.click();
  const result = await event;
  return readFile(await result.path());
}

test('ZIP preserves all colliding photo names and original bytes through the real worker', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await analyze(page);
  await page.getByLabel('Remove CSV report from sorted ZIP').uncheck();
  await expect(page.getByLabel('Split large exports into smaller ZIPs')).not.toBeChecked();
  const data = await download(page, page.getByRole('button', { name: 'Download ZIP', exact: true }));
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.endsWith('.png'));
  expect(entries).toHaveLength(3);
  const actual = await Promise.all(entries.map(async (entry) => (await entry.async('nodebuffer')).toString('base64')));
  const expected = await Promise.all(photos.map(async (path) => (await readFile(path)).toString('base64')));
  expect(actual.sort()).toEqual(expected.sort());
  expect(await zip.file('sort_report.csv').async('string')).toContain('output_path');
  expect(errors).toEqual([]);
});

test('corrections and settings survive reload and a portable review restores in a fresh session', async ({ page }) => {
  await page.goto('/');
  await analyze(page);
  await page.getByLabel('Folder prefix', { exact: true }).fill('resumed');
  await page.getByLabel('Folder decision for a_b.png', { exact: true }).selectOption('split');
  await page.getByLabel('Skip pitched-down marker photos in output').check();
  await expect(page.getByText('Review saved on this device. Download a review file to keep another copy.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('flare-pfi-review-v1'))?.files.filter((file) => file.decision === 'split').length)).toBe(1);
  const portable = await download(page, page.getByRole('button', { name: 'Save review file', exact: true }));
  await page.reload();
  await selectPhotos(page);
  await page.getByRole('button', { name: 'Resume saved review', exact: true }).click();
  await expect(page.getByLabel('Folder decision for a_b.png', { exact: true })).toHaveValue('split');
  await expect(page.getByLabel('Folder prefix', { exact: true })).toHaveValue('resumed');
  await expect(page.getByLabel('Skip pitched-down marker photos in output')).toBeChecked();
  const zip = await JSZip.loadAsync(await download(page, page.getByRole('button', { name: 'Download ZIP', exact: true })));
  expect(Object.values(zip.files).filter((entry) => !entry.dir)).toHaveLength(3);
  expect(zip.file('resumed_002/a_b.png')).not.toBeNull();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByLabel('Load review file', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: portable });
  await selectPhotos(page);
  await page.getByRole('button', { name: 'Resume saved review', exact: true }).click();
  await expect(page.getByLabel('Folder decision for a_b.png', { exact: true })).toHaveValue('split');
});

test('a loaded review is not replaced by the current review autosave and wrong photos are rejected', async ({ page }) => {
  await page.goto('/');
  await analyze(page);
  const portable = await download(page, page.getByRole('button', { name: 'Save review file', exact: true }));
  const imported = JSON.parse(portable.toString());
  imported.settings.folderPrefix = 'imported';
  imported.files[0].decision = 'marker';
  await page.getByLabel('Folder prefix', { exact: true }).fill('current');
  await page.getByLabel('Load review file', { exact: true }).setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  // A user can inspect the imported review before resuming; a pending save must not replace it.
  await expect(page.getByText('Review loaded for 3 photos. Select the original photos, then resume.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume saved review', exact: true }).click();
  await expect(page.getByLabel('Folder prefix', { exact: true })).toHaveValue('imported');
  await expect(page.getByLabel('Folder decision for a b.png', { exact: true })).toHaveValue('marker');
  await page.getByLabel('Choose image files', { exact: true }).setInputFiles(photos.slice(0, 2));
  await page.getByRole('button', { name: 'Resume saved review', exact: true }).click();
  await expect(page.getByText('Select all 3 original photos before resuming this review.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
});

test('storage failure leaves portable review download available', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await page.goto('/');
  await analyze(page);
  await expect(page.getByText('This browser could not save the review. Download a review file to keep your decisions.', { exact: true })).toBeVisible();
  const portable = JSON.parse((await download(page, page.getByRole('button', { name: 'Save review file', exact: true }))).toString());
  expect(portable.files).toHaveLength(3);
});

test('cancel export stops a pending worker without starting a download', async ({ page }) => {
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const downloads = [];
  page.on('download', (item) => downloads.push(item));
  await page.route('**/exportWorker.js*', async (route) => { await hold; await route.continue().catch(() => {}); });
  await page.goto('/');
  await analyze(page);
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
  release();
  await expect(page.getByText('ZIP export cancelled. Your review is unchanged.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeEnabled();
  expect(downloads).toHaveLength(0);
});


test('an invalid review import does not stop saving subsequent corrections', async ({ page }) => {
  await page.goto('/');
  await analyze(page);
  await page.getByLabel('Load review file', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByRole('alert')).toHaveText('This is not a valid review file.');
  await page.getByLabel('Folder prefix', { exact: true }).fill('after_invalid_import');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('flare-pfi-review-v1'))?.settings.folderPrefix)).toBe('after_invalid_import');
});
