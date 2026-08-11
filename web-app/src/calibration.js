const DETECTOR_KEYS = [
  'altitudeTolerance', 'altitudeMinSteps', 'altitudeMinSpan', 'altitudeMarkerSuppression',
  'markerPitch', 'tolerance', 'gpsWindowSize', 'gpsMinDisplacementMeters',
  'gpsMaxClusterRadiusMeters', 'gpsMinSignalRatio', 'gpsMaxGapSeconds',
];

const PROPOSAL_KEYS = [
  'boundaryIndex', 'detectedAtIndex', 'boundaryFile', 'detectedAtFile',
  'evidenceStartIndex', 'evidenceEndIndex', 'evidenceStartFile', 'evidenceEndFile',
  'transitionStartIndex', 'transitionEndIndex', 'transitionStartFile', 'transitionEndFile',
  'suppressionStartIndex', 'suppressionEndIndex', 'requiredDisplacementM', 'gpsSignalRatio',
  'reason', 'status',
];
const EVIDENCE_KEYS = [
  'priorDirection', 'nextDirection', 'priorAltitudeSpanM', 'nextAltitudeSpanM',
  'gpsDisplacementM', 'priorClusterRadiusM', 'nextClusterRadiusM', 'priorGpsSamples',
  'nextGpsSamples', 'maximumTimeGapSeconds',
];
const pick = (source, keys) => Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));
export const detectorSettings = (settings) => pick(settings, DETECTOR_KEYS);
export const telemetryCoverage = (analyses) => ({
  gpsCoordinates: analyses.filter((item) => item.latitude != null && item.longitude != null).length,
  captureTime: analyses.filter((item) => item.captureDate != null).length,
  pitch: analyses.filter((item) => item.pitch != null).length,
  relativeAltitude: analyses.filter((item) => item.altitudeSource === 'relative').length,
  absoluteAltitude: analyses.filter((item) => item.altitudeSource === 'absolute').length,
  gpsAltitude: analyses.filter((item) => item.altitudeSource === 'gps').length,
});

export function createCalibrationReport({ appVersion, settings, analyses, proposals, reasonCounts, decisions, missedBoundaries, fullFlightReviewed, exportedAt = new Date() }) {
  const redactedProposals = proposals.map((proposal, index) => ({
    ...pick(proposal, PROPOSAL_KEYS), evidence: pick(proposal.evidence, EVIDENCE_KEYS),
    operatorDecision: decisions[index]?.state ?? 'unreviewed',
    originalBoundaryIndex: proposal.boundaryIndex, originalBoundaryFile: proposal.boundaryFile,
    correctedBoundaryIndex: decisions[index]?.boundaryIndex ?? proposal.boundaryIndex,
    correctedBoundaryFile: decisions[index]?.boundaryFile ?? proposal.boundaryFile,
  }));
  const everyProposalReviewed = proposals.every((_, index) => decisions[index] && decisions[index].state !== 'unreviewed');
  return {
    schemaVersion: 1, appVersion, detectorSettings: detectorSettings(settings), totalImageCount: analyses.length,
    telemetryCoverageCounts: telemetryCoverage(analyses), rejectionReasonCounts: { ...reasonCounts },
    proposals: redactedProposals,
    manuallyRecordedMissedBoundaries: missedBoundaries.map(({ index, fileName }) => ({ boundaryIndex: index, boundaryFile: fileName })),
    reviewComplete: Boolean(fullFlightReviewed && everyProposalReviewed), exportedAt: exportedAt.toISOString(),
  };
}
