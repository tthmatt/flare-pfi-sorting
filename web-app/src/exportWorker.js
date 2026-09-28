import { generateZipFiles } from './zipCore.js';

self.onmessage = async ({ data }) => {
  try {
    const blob = await generateZipFiles(data, {
      onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
    });
    self.postMessage({ type: 'result', blob });
  } catch (error) {
    self.postMessage({ type: 'error', name: error.name, message: error.message || 'ZIP export failed.' });
  }
};
