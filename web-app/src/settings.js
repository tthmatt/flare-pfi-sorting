export const DEFAULT_SETTINGS = Object.freeze({
  tolerance: 2, inferAltitudeTurns: false, altitudeTolerance: 0.75,
  altitudeMinSteps: 2, altitudeMinSpan: 5, altitudeMarkerSuppression: 2,
  horizontalMinPhotos: 2, horizontalPitchTolerance: 5, markerPitch: -90,
  folderPrefix: 'flare_inspection', sortBy: 'filename', keepFolderPaths: false,
  skipMarkers: false, removeCsvReport: true, proposeGpsTurns: false, splitExports: false,
  gpsWindowSize: 3, gpsMinDisplacementMeters: 4, gpsMaxClusterRadiusMeters: 3,
  gpsMinSignalRatio: 2, gpsMaxGapSeconds: 30,
});

export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review settings.');
  const result = { ...DEFAULT_SETTINGS };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (!Object.hasOwn(value, key)) continue;
    const entry = value[key];
    if (typeof entry !== typeof fallback || (typeof entry === 'number' && !Number.isFinite(entry))) {
      throw new Error(`Invalid review setting: ${key}.`);
    }
    if (typeof entry === 'number' && (key === 'markerPitch' ? Math.abs(entry) > 180 : entry < 0 || entry > 10000)) {
      throw new Error(`Review setting is out of range: ${key}.`);
    }
    if (['altitudeMinSteps', 'horizontalMinPhotos', 'gpsWindowSize'].includes(key) && (!Number.isInteger(entry) || entry < 1 || entry > 100)) throw new Error(`Invalid photo count: ${key}.`);
    if (key === 'horizontalMinPhotos' && entry < 2) throw new Error('A horizontal traverse requires at least two photos.');
    if (key === 'altitudeMarkerSuppression' && !Number.isInteger(entry)) throw new Error('Invalid marker suppression count.');
    if (key === 'sortBy' && !['filename', 'capture', 'modified'].includes(entry)) throw new Error('Invalid review sort order.');
    if (key === 'folderPrefix' && entry.length > 200) throw new Error('Review folder prefix is too long.');
    result[key] = entry;
  }
  return result;
}
