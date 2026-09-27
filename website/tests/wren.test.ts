import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bezier, along, nextSpeed, wingLift } from '../src/scripts/wren.ts';

test('a path is walked by distance from start to end', () => {
 const path = bezier({ x: 0, y: 0 }, { x: 100, y: -80 }, { x: 300, y: -80 }, { x: 400, y: 0 });
 assert.ok(path.total > 400 && path.total < 560);
 assert.deepEqual(along(path, -5), { x: 0, y: 0 });
 assert.deepEqual(along(path, path.total + 5), { x: 400, y: 0 });
 let last = along(path, 0);
 for (let s = 10; s <= path.total; s += 10) {
  const p = along(path, s);
  // Equal steps along the path cover equal ground.
  assert.ok(Math.abs(Math.hypot(p.x - last.x, p.y - last.y) - 10) < .6);
  last = p;
 }
});
test('flight speeds up to cruise and brakes to land softly', () => {
 let v = 0, s = 0, peak = 0, landing = Infinity;
 const total = 900, dt = 1 / 60;
 for (let i = 0; i < 60 * 10 && s < total; i++) {
  v = nextSpeed(v, dt, total - s, 420, 30);
  s = Math.min(total, s + v * dt);
  peak = Math.max(peak, v);
  if (total - s < 2) landing = Math.min(landing, v);
 }
 assert.equal(s, total);
 assert.ok(peak <= 420 && peak > 380);
 assert.ok(landing < 80);
});
test('wings rise, sweep down fast and recover slowly', () => {
 assert.ok(Math.abs(wingLift(0) - 1) < 1e-9);
 assert.ok(Math.abs(wingLift(.42) + .85) < 1e-9);
 assert.ok(Math.abs(wingLift(3.42) - wingLift(.42)) < 1e-9);
 for (let p = 0; p < 1; p += .01) assert.ok(wingLift(p) <= 1 + 1e-9 && wingLift(p) >= -.85 - 1e-9);
});
