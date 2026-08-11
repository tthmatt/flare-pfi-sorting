export const METADATA_READ_LIMIT = 2 * 1024 * 1024;

const PITCH_PATTERNS = [
  /(?:drone-dji:)?GimbalPitchDegree\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /(?:drone-dji:)?CameraPitchDegree\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /(?:Camera|Gimbal)Pitch\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /<(?:[^:>]+:)?(?:GimbalPitchDegree|CameraPitchDegree|CameraPitch)>\s*([-+]?\d+(?:\.\d+)?)\s*<\//i,
];
const RELATIVE_ALTITUDE_PATTERNS = [
  /(?:drone-dji:)?RelativeAltitude\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /<(?:[^:>]+:)?RelativeAltitude>\s*([-+]?\d+(?:\.\d+)?)\s*<\//i,
];
const ALTITUDE_FALLBACK_PATTERNS = [
  /(?:drone-dji:)?AbsoluteAltitude\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /<(?:[^:>]+:)?AbsoluteAltitude>\s*([-+]?\d+(?:\.\d+)?)\s*<\//i,
  /(?:exif:)?GPSAltitude\s*=\s*["']([-+]?\d+(?:\.\d+)?)["']/i,
  /<(?:[^:>]+:)?GPSAltitude>\s*([-+]?\d+(?:\.\d+)?)\s*<\//i,
];
const DATE_PATTERNS = [
  /(?:exif:)?DateTimeOriginal\s*=\s*["']([^"']+)["']/i,
  /<(?:[^:>]+:)?DateTimeOriginal>\s*([^<]+)\s*<\//i,
  /(?:xmp:)?CreateDate\s*=\s*["']([^"']+)["']/i,
];

function firstFloatMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function parseCaptureDate(text) {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const normalized = match[1].trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export async function readImageMetadata(file) {
  const buffer = await file.slice(0, Math.min(file.size, METADATA_READ_LIMIT)).arrayBuffer();
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  return {
    pitch: firstFloatMatch(text, PITCH_PATTERNS),
    altitude: firstFloatMatch(text, RELATIVE_ALTITUDE_PATTERNS) ?? firstFloatMatch(text, ALTITUDE_FALLBACK_PATTERNS),
    captureDate: parseCaptureDate(text),
  };
}
