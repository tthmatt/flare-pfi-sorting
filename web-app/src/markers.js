export function isMarkerPitch(pitch, markerPitch, tolerance) {
  return Number.isFinite(pitch) && Math.abs(Math.abs(pitch) - Math.abs(markerPitch)) <= tolerance;
}

export function isMarkerImage(item, settings) {
  if (item.markerOverride === 'marker') return true;
  if (item.markerOverride === 'normal' || item.markerOverride === 'split') return false;
  return isMarkerPitch(item.pitch, settings.markerPitch ?? -90, settings.tolerance ?? 2);
}
