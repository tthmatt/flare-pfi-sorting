import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLateralMotion } from './visualMatching.js';

function texture(seed = 123) {
  let n = seed;
  const data = Uint8Array.from({ length: 240 * 160 }, () => {
    n = (1664525 * n + 1013904223) >>> 0; return n >>> 24;
  });
  return { width: 240, height: 160, data };
}
function shift(image, dx, dy, exposure = 1) {
  const result = texture(987);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (x - dx >= 0 && x - dx < image.width && y - dy >= 0 && y - dy < image.height) {
      result.data[y * image.width + x] = Math.min(255, image.data[(y - dy) * image.width + x - dx] * exposure);
    }
  }
  return result;
}

test('supports consistent sideways translation across distinct details, including exposure changes', () => {
  const before = texture();
  for (const [dx, direction] of [[-60, 1], [60, -1]]) {
    const result = matchLateralMotion(before, shift(before, dx, 2, 0.85), direction);
    assert.equal(result.supported, true);
    assert.ok(Math.abs(result.dxFraction - dx / 240) < 0.01);
  }
});

test('one-pixel changes in horizontal or vertical translation retain the same evidence', () => {
  const before = texture();
  for (const [dx, dy] of [[-60, 2], [-61, 2], [-60, 3], [-61, 3], [61, -3]]) {
    const result = matchLateralMotion(before, shift(before, dx, dy, 0.85), -Math.sign(dx));
    assert.equal(result.supported, true, `translation ${dx}, ${dy}`);
    assert.ok(Math.abs(result.dxFraction - dx / before.width) < 0.01);
    assert.ok(Math.abs(result.dyFraction - dy / before.height) < 0.01);
  }
});

test('does not claim a sideways pass for vertical movement, a stationary view or unrelated images', () => {
  const before = texture();
  for (const after of [shift(before, 0, 20), shift(before, 1, 21), before, texture(789)]) {
    assert.equal(matchLateralMotion(before, after, 1).supported, false);
  }
});

test('flat surfaces and repeating texture produce insufficient or ambiguous evidence', () => {
  const flat = { width: 240, height: 160, data: new Uint8Array(240 * 160).fill(130) };
  assert.equal(matchLateralMotion(flat, flat, 1).supported, false);
  const repeat = { ...flat, data: Uint8Array.from(flat.data, (_, i) => ((Math.floor(i / 240) % 16 < 8) !== (i % 16 < 8)) ? 30 : 220) };
  for (const [dx, dy] of [[-48, 0], [-49, 1]]) {
    assert.equal(matchLateralMotion(repeat, shift(repeat, dx, dy), 1).supported, false);
  }
});

test('unsupported sizes and mismatched image shapes are explicit, bounded failures', () => {
  const before = texture();
  assert.equal(matchLateralMotion(before, { ...before, height: 100 }, 1).supported, false);
  assert.equal(matchLateralMotion({ ...before, width: 5000 }, before, 1).reason, 'unsupported-image');
});
