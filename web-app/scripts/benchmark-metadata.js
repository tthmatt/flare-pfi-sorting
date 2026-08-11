import { performance } from 'node:perf_hooks';
import { parseImageMetadataText } from '../src/metadata.js';

const fullTelemetry = `${'JPEG'.repeat(250)}<rdf:Description drone-dji:GimbalPitchDegree="-89.4" drone-dji:RelativeAltitude="42.1" drone-dji:AbsoluteAltitude="142.1" exif:GPSLatitude="51.501" exif:GPSLongitude="-0.142" drone-dji:FlightYawDegree="91.2" drone-dji:GimbalYawDegree="90.8" exif:DateTimeOriginal="2026:08:11 10:11:12" />`;
const sparseMetadata = `${'JPEG'.repeat(250)}<rdf:Description drone-dji:GimbalPitchDegree="-12.5" />`;

function legacyParse(text) {
  const names = ['GimbalPitchDegree', 'CameraPitchDegree', 'CameraPitch', 'RelativeAltitude', 'AbsoluteAltitude', 'GPSAltitude', 'GPSLatitude', 'GPSLongitude', 'FlightYawDegree', 'GimbalYawDegree', 'DateTimeOriginal', 'CreateDate'];
  for (const name of names) {
    new RegExp(`(?:[\\w-]+:)?${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(text);
    new RegExp(`<(?:[^:>]+:)?${name}>\\s*([^<]*)\\s*</`, 'i').exec(text);
  }
}

function measure(label, parser, text, iterations = 250) {
  for (let index = 0; index < 10; index += 1) parser(text);
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) parser(text);
  const elapsed = performance.now() - start;
  console.log(`${label}: ${iterations} parses in ${elapsed.toFixed(1)} ms (${(iterations / elapsed * 1000).toFixed(0)} parses/sec)`);
}

console.log('Metadata benchmark (non-gating; timings vary by machine)');
measure('legacy/full DJI telemetry', legacyParse, fullTelemetry);
measure('single-pass/full DJI telemetry', parseImageMetadataText, fullTelemetry);
measure('legacy/sparse metadata', legacyParse, sparseMetadata);
measure('single-pass/sparse metadata', parseImageMetadataText, sparseMetadata);
