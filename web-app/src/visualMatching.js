// Small, bounded patch matcher for review suggestions, not object recognition.
// Runs in a worker on thumbnails; no model downloads or photo uploads.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const RADIUS = 6;
const LENGTH = 49;

function patch(image, x, y) {
  const values = new Float32Array(LENGTH);
  let sum = 0; let squares = 0; let i = 0; let gx = 0; let gy = 0; let cross = 0;
  for (let dy = -RADIUS; dy <= RADIUS; dy += 2) {
    for (let dx = -RADIUS; dx <= RADIUS; dx += 2) {
      const p = (y + dy) * image.width + x + dx;
      const v = image.data[p];
      values[i++] = v; sum += v; squares += v * v;
      const a = image.data[p + 1] - image.data[p - 1];
      const b = image.data[p + image.width] - image.data[p - image.width];
      gx += a * a; gy += b * b; cross += a * b;
    }
  }
  const variance = squares - sum * sum / LENGTH;
  if (variance < LENGTH * 100) return null;
  const strength = (gx + gy - Math.sqrt((gx - gy) ** 2 + 4 * cross ** 2)) / 2;
  if (strength < 1000) return null; // Reject flat walls and isolated straight edges.
  const norm = Math.sqrt(variance); const mean = sum / LENGTH;
  for (let j = 0; j < LENGTH; j += 1) values[j] = (values[j] - mean) / norm;
  return { x, y, values, strength };
}

function descriptors(image, step) {
  const result = [];
  // The upper part often contains distant buildings/sky that dominate matches.
  // This is a heuristic, not a foreground segmentation model.
  for (let y = Math.max(RADIUS + 1, Math.ceil(image.height * 0.36)); y < image.height - RADIUS - 1; y += step) {
    for (let x = RADIUS + 1; x < image.width - RADIUS - 1; x += step) {
      const value = patch(image, x, y);
      if (value) result.push(value);
    }
  }
  return result;
}

export function matchLateralMotion(before, after, lateralDirection) {
  const unavailable = (reason) => ({ supported: false, reason, matches: 0 });
  if (![before, after].every((im) => im && Number.isInteger(im.width) && Number.isInteger(im.height)
    && im.width >= 80 && im.width <= 480 && im.height >= 60 && im.height <= 480
    && im.data?.length === im.width * im.height)) return unavailable('unsupported-image');
  if (before.width !== after.width || before.height !== after.height) return unavailable('different-image-dimensions');
  if (![1, -1].includes(lateralDirection)) return unavailable('missing-direction');
  const width = before.width; const height = before.height;
  // Keep useful points spread over the inspected area rather than one window.
  const cells = new Map();
  for (const feature of descriptors(before, 4).sort((a, b) => b.strength - a.strength)) {
    const key = `${Math.floor(feature.x / 16)},${Math.floor(feature.y / 16)}`;
    if (!cells.has(key)) cells.set(key, feature);
  }
  const sources = [...cells.values()].slice(0, 400);
  const targets = descriptors(after, 2);
  const matches = [];
  for (const source of sources) {
    let best = null; let score = -1; let second = -1;
    for (const target of targets) {
      const dx = target.x - source.x; const dy = target.y - source.y;
      // Scene features move opposite to the camera's lateral movement.
      if (dx * lateralDirection > -width * 0.06 || Math.abs(dx) > width * 0.8 || Math.abs(dy) > height * 0.2) continue;
      let similarity = 0;
      for (let k = 0; k < LENGTH; k += 1) similarity += source.values[k] * target.values[k];
      if (similarity > score) {
        if (best && Math.hypot(target.x - best.x, target.y - best.y) > 12) second = Math.max(second, score);
        best = target; score = similarity;
      } else if (best && Math.hypot(target.x - best.x, target.y - best.y) > 12) second = Math.max(second, similarity);
    }
    if (best && score >= 0.88 && score - second >= 0.04) {
      matches.push({ x: source.x, y: source.y, dx: best.x - source.x, dy: best.y - source.y });
    }
  }
  if (matches.length < 6) return { ...unavailable('insufficient-distinct-matches'), matches: matches.length };
  // Translation consensus removes mismatches on repetitive windows/roof tiles.
  let consensus = [];
  for (const match of matches) {
    const nearby = matches.filter((other) => Math.abs(other.dx - match.dx) <= 10 && Math.abs(other.dy - match.dy) <= 8);
    if (nearby.length > consensus.length) consensus = nearby;
  }
  const xSpan = (Math.max(...consensus.map((p) => p.x)) - Math.min(...consensus.map((p) => p.x))) / width;
  const ySpan = (Math.max(...consensus.map((p) => p.y)) - Math.min(...consensus.map((p) => p.y))) / height;
  const dx = median(consensus.map((p) => p.dx)); const dy = median(consensus.map((p) => p.dy));
  const supported = consensus.length >= 6 && consensus.length / matches.length >= 0.5
    && xSpan >= 0.15 && ySpan >= 0.1 && Math.abs(dx) >= width * 0.1
    && Math.abs(dx) >= 2 * Math.abs(dy);
  return { supported, reason: supported ? 'consistent-sideways-matches' : 'ambiguous-visual-motion',
    matches: matches.length, inliers: consensus.length, dxFraction: dx / width, dyFraction: dy / height, xSpan, ySpan };
}
