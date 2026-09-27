import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPendulum, isOverstretched, GRAVITY } from '../src/scripts/tethers.ts';

const settled = (p: { r: number; rv: number; th: number; w: number }, length: number) =>
 Math.abs(p.r - length) < .5 && Math.abs(p.th) < .005 && Math.abs(p.rv) < 1 && Math.abs(p.w) < .01;

test('a hard throw swings out and settles back at rest without runaway', () => {
 const p = { r: 260, rv: 900, th: .9, w: 7 };
 for (let i = 0; i < 60 * 20; i++) {
  stepPendulum(p, 1 / 60, 200);
  assert.ok(Object.values(p).every(Number.isFinite));
  assert.ok(Math.abs(p.th) <= 1.15 && p.r >= 70 && p.r < 400);
 }
 assert.ok(settled(p, 200));
});
test('longer cords swing more slowly, like a real pendulum', () => {
 const period = (length: number) => {
  const p = { r: length, rv: 0, th: .1, w: 0 };
  let t = 0, crossings = 0, last = p.th;
  while (crossings < 2) { stepPendulum(p, 1 / 240, length); t += 1 / 240; if (Math.sign(p.th) !== Math.sign(last)) crossings++; last = p.th; }
  return t;
 };
 const short = period(120), long = period(360);
 assert.ok(Math.abs(long / short - Math.sqrt(3)) < .15);
 assert.ok(Math.abs(short - 1.5 * Math.PI * Math.sqrt(120 / GRAVITY)) < .08);
});
test('a dropped icon falls on a slack cord and bounces when it catches', () => {
 const p = { r: 70, rv: 0, th: 0, w: 0 };
 let lowest = 0;
 for (let i = 0; i < 60 * 4; i++) { stepPendulum(p, 1 / 60, 200); lowest = Math.max(lowest, p.r); }
 assert.ok(lowest > 206, 'the cord stretches on impact');
 assert.ok(settled(p, 200));
});
test('drop motion stays consistent across frame rates', () => {
 const states = [30, 60, 120].map(fps => {
  const p = { r: 70, rv: 0, th: .12, w: 0 };
  for (let i = 0; i < fps; i++) stepPendulum(p, 1 / fps, 200);
  return p;
 });
 for (const p of states) assert.ok(Math.abs(p.r - states[0]!.r) < .5 && Math.abs(p.th - states[0]!.th) < .005);
});
test('a long suspended frame is capped instead of exploding', () => {
 const p = { r: 300, rv: 400, th: 1, w: 5 };
 stepPendulum(p, 30, 200);
 assert.ok(Object.values(p).every(Number.isFinite));
 assert.ok(Math.abs(p.th) <= 1.15 && p.r < 400);
});

test('over-pull releases in every direction beyond the rope length', () => {
 assert.equal(isOverstretched(0, 96, 160, 95), true);
 assert.equal(isOverstretched(210, 0, 160, 95), true);
 assert.equal(isOverstretched(20, 20, 160, 95), false);
});
