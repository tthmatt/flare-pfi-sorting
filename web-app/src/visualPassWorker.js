import { matchLateralMotion } from './visualMatching.js';

async function thumbnail(file) {
  if (!/\.(jpe?g|png)$/i.test(file.name)) throw new Error('unsupported-format');
  if (file.size > 64 * 1024 * 1024) throw new Error('image-too-large');
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('browser-unavailable');
  const bitmap = await createImageBitmap(file, { resizeWidth: 480, resizeQuality: 'high', imageOrientation: 'from-image' });
  try {
    const scale = Math.min(480 / bitmap.width, 480 / bitmap.height, 1);
    const width = Math.round(bitmap.width * scale); const height = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('browser-unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.round(pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114);
    return { width, height, data };
  } finally { bitmap.close(); }
}

self.onmessage = async ({ data: jobs }) => {
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]; let visual;
    try {
      if (!job.before || !job.after) throw new Error('no-comparable-photos');
      // Decode at most one full image at a time; retain only two small thumbnails.
      const before = await thumbnail(job.before);
      const after = await thumbnail(job.after);
      visual = matchLateralMotion(before, after, Math.sign(job.lateralMeters));
    } catch (error) {
      const known = ['unsupported-format', 'image-too-large', 'browser-unavailable', 'no-comparable-photos'];
      visual = { supported: false, reason: known.includes(error.message) ? error.message : 'image-decode-failed', matches: 0 };
    }
    self.postMessage({ index, visual });
  }
};
