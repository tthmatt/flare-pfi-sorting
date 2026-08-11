export const METADATA_READ_LIMIT = 2 * 1024 * 1024;

const patterns = (name) => [
  new RegExp(`(?:[\\w-]+:)?${name}\\s*=\\s*["']([^"']*)["']`, 'i'),
  new RegExp(`<(?:[^:>]+:)?${name}>\\s*([^<]*)\\s*</`, 'i'),
];
const PITCH_PATTERNS = [...patterns('GimbalPitchDegree'), ...patterns('CameraPitchDegree'), ...patterns('CameraPitch')];
const RELATIVE_ALTITUDE_PATTERNS = patterns('RelativeAltitude');
const ABSOLUTE_ALTITUDE_PATTERNS = patterns('AbsoluteAltitude');
const GPS_ALTITUDE_PATTERNS = patterns('GPSAltitude');
const ALTITUDE_FALLBACK_PATTERNS = [...ABSOLUTE_ALTITUDE_PATTERNS, ...GPS_ALTITUDE_PATTERNS];
const LATITUDE_PATTERNS = patterns('GPSLatitude');
const LONGITUDE_PATTERNS = patterns('GPSLongitude');
const FLIGHT_YAW_PATTERNS = patterns('FlightYawDegree');
const GIMBAL_YAW_PATTERNS = patterns('GimbalYawDegree');
const DATE_PATTERNS = [...patterns('DateTimeOriginal'), ...patterns('CreateDate')];

function firstTextMatch(text, candidates) {
  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function firstFloatMatch(text, candidates) {
  const raw = firstTextMatch(text, candidates);
  if (raw === null || !/^[-+]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseCaptureDate(text) {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    let normalized = match[1].trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += 'Z';
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function parseCoordinate(raw, maximum) {
  if (raw === null) return { value: null, invalid: false };
  const match = raw.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*([NSEW])?\s*$/i);
  if (!match) return { value: null, invalid: true };
  let value = Number(match[1]);
  const hemisphere = (match[2] || '').toUpperCase();
  if (hemisphere === 'S' || hemisphere === 'W') value = -Math.abs(value);
  else if (hemisphere === 'N' || hemisphere === 'E') value = Math.abs(value);
  return Math.abs(value) <= maximum ? { value, invalid: false } : { value: null, invalid: true };
}

void ALTITUDE_FALLBACK_PATTERNS;

export function parseImageMetadataText(text) {
  const pitch = firstFloatMatch(text, PITCH_PATTERNS);
  const captureDate = parseCaptureDate(text);
  const relative = firstFloatMatch(text, RELATIVE_ALTITUDE_PATTERNS);
  const absolute = firstFloatMatch(text, ABSOLUTE_ALTITUDE_PATTERNS);
  const gps = firstFloatMatch(text, GPS_ALTITUDE_PATTERNS);
  const altitude = relative ?? absolute ?? gps;
  const altitudeSource = relative !== null ? 'relative' : absolute !== null ? 'absolute' : gps !== null ? 'gps' : null;
  const latitude = parseCoordinate(firstTextMatch(text, LATITUDE_PATTERNS), 90);
  const longitude = parseCoordinate(firstTextMatch(text, LONGITUDE_PATTERNS), 180);
  const warnings = [];
  if (pitch === null) warnings.push('missing-pitch');
  if (captureDate === null) warnings.push('missing-capture-time');
  if (altitude === null) warnings.push('missing-altitude');
  if (latitude.value === null || longitude.value === null) warnings.push('missing-gps');
  if (latitude.invalid) warnings.push('invalid-latitude');
  if (longitude.invalid) warnings.push('invalid-longitude');
  return {
    pitch, captureDate, altitude, altitudeSource,
    latitude: latitude.value, longitude: longitude.value,
    flightYaw: firstFloatMatch(text, FLIGHT_YAW_PATTERNS),
    gimbalYaw: firstFloatMatch(text, GIMBAL_YAW_PATTERNS), warnings,
  };
}

export async function readImageMetadata(file) {
  const buffer = await file.slice(0, Math.min(file.size, METADATA_READ_LIMIT)).arrayBuffer();
  return parseImageMetadataText(new TextDecoder('utf-8', { fatal: false }).decode(buffer));
}
