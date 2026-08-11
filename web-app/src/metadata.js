export const METADATA_READ_LIMIT = 2 * 1024 * 1024;

const METADATA_NAMES = new Set([
  'gimbalpitchdegree', 'camerapitchdegree', 'camerapitch',
  'relativealtitude', 'absolutealtitude', 'gpsaltitude',
  'gpslatitude', 'gpslongitude', 'flightyawdegree', 'gimbalyawdegree',
  'datetimeoriginal', 'createdate',
]);
const decoder = new TextDecoder('utf-8', { fatal: false });
const NAME_PATTERN = 'GimbalPitchDegree|CameraPitchDegree|CameraPitch|RelativeAltitude|AbsoluteAltitude|GPSAltitude|GPSLatitude|GPSLongitude|FlightYawDegree|GimbalYawDegree|DateTimeOriginal|CreateDate';
const tagPattern = new RegExp(`(?:^|[<\\s])(?:[\\w-]+:)?(${NAME_PATTERN})\\s*=\\s*["']([^"']*)["']|<(?:[^:>\\s]+:)?(${NAME_PATTERN})(?:\\s[^>]*)?>\\s*([^<]*)\\s*</`, 'gi');

// One scan collects the first attribute and element occurrence independently.
// Keeping the two forms separate preserves the historical attribute-first lookup.
function collectMetadata(text) {
  const attributes = new Map();
  const elements = new Map();
  tagPattern.lastIndex = 0;
  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    const name = (match[1] || match[3]).toLowerCase();
    if (!METADATA_NAMES.has(name)) continue;
    const target = match[1] ? attributes : elements;
    if (!target.has(name)) target.set(name, (match[2] ?? match[4]).trim());
  }
  return { attributes, elements };
}

function firstValue(metadata, names) {
  for (const name of names) {
    const key = name.toLowerCase();
    if (metadata.attributes.has(key)) return metadata.attributes.get(key);
    if (metadata.elements.has(key)) return metadata.elements.get(key);
  }
  return null;
}

function firstFloat(metadata, names) {
  const raw = firstValue(metadata, names);
  if (raw === null || !/^[-+]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function captureDateFromMetadata(metadata) {
  for (const name of ['DateTimeOriginal', 'CreateDate']) {
    const key = name.toLowerCase();
    for (const values of [metadata.attributes, metadata.elements]) {
      const raw = values.get(key);
      if (raw === undefined) continue;
      let normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
      if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += 'Z';
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

export function parseCaptureDate(text) {
  return captureDateFromMetadata(collectMetadata(text));
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

export function parseImageMetadataText(text) {
  const metadata = collectMetadata(text);
  const pitch = firstFloat(metadata, ['GimbalPitchDegree', 'CameraPitchDegree', 'CameraPitch']);
  const captureDate = captureDateFromMetadata(metadata);
  const relative = firstFloat(metadata, ['RelativeAltitude']);
  const absolute = firstFloat(metadata, ['AbsoluteAltitude']);
  const gps = firstFloat(metadata, ['GPSAltitude']);
  const altitude = relative ?? absolute ?? gps;
  const altitudeSource = relative !== null ? 'relative' : absolute !== null ? 'absolute' : gps !== null ? 'gps' : null;
  const latitude = parseCoordinate(firstValue(metadata, ['GPSLatitude']), 90);
  const longitude = parseCoordinate(firstValue(metadata, ['GPSLongitude']), 180);
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
    flightYaw: firstFloat(metadata, ['FlightYawDegree']),
    gimbalYaw: firstFloat(metadata, ['GimbalYawDegree']), warnings,
  };
}

export async function readImageMetadata(file) {
  let buffer = await file.slice(0, Math.min(file.size, METADATA_READ_LIMIT)).arrayBuffer();
  let text = decoder.decode(buffer);
  buffer = null;
  const metadata = parseImageMetadataText(text);
  text = null;
  return metadata;
}
