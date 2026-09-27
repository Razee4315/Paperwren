import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepSpring, isOverstretched } from '../src/scripts/tethers.ts';

test('a fast release returns to rest without runaway velocity', () => {
 const s = { x: 100, y: 120, vx: 400, vy: 400 };
 for (let i = 0; i < 600; i++) {
  stepSpring(s, 1 / 60);
  assert.ok(Object.values(s).every(Number.isFinite));
  assert.ok(Math.abs(s.x) < 200 && Math.abs(s.y) < 220);
 }
 assert.ok(Math.hypot(s.x, s.y, s.vx, s.vy) < .01);
});
test('drop motion stays consistent across frame rates', () => {
 const states = [30, 60, 120].map(fps => {
  const s = { x: 0, y: -360, vx: 0, vy: 0 };
  for (let i = 0; i < fps; i++) stepSpring(s, 1 / fps);
  return s;
 });
 for (const s of states) assert.ok(Math.abs(s.y - states[0]!.y) < .1);
});
test('a long suspended frame is capped instead of exploding', () => {
 const s = { x: 80, y: -300, vx: 200, vy: 400 };
 stepSpring(s, 30);
 assert.ok(Object.values(s).every(Number.isFinite));
 assert.ok(Math.abs(s.x) < 150 && Math.abs(s.y) < 350);
});

test('over-pull releases in every direction beyond the rope length', () => {
 assert.equal(isOverstretched(0, 96, 160, 95), true);
 assert.equal(isOverstretched(210, 0, 160, 95), true);
 assert.equal(isOverstretched(20, 20, 160, 95), false);
});
