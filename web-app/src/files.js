export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'tif', 'tiff', 'png', 'dng']);
const BROWSER_PREVIEW_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

export function getFileExtension(file) {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

export function isImageFile(file) {
  const extension = getFileExtension(file);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}

export function canPreviewInBrowser(file) {
  return BROWSER_PREVIEW_EXTENSIONS.has(getFileExtension(file));
}

export function getDisplayPath(file) {
  return file.webkitRelativePath || file.name;
}

export function getFileName(file) {
  const path = getDisplayPath(file);
  return path.split('/').filter(Boolean).pop() || file.name;
}

export function safePathPart(value) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[-_.]+|[-_.]+$/g, '') || 'inspection_run';
}
