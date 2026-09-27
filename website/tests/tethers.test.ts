import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRope, stepRope, isOverstretched } from '../src/scripts/tethers.ts';

test('released rope keeps its anchor and settles after a deep diagonal pull', () => {
 const rope = createRope(300, 0, 230);
 for (let i = 0; i < 30; i++) stepRope(rope, 230, { x: 450, y: 330 });
 for (let i = 0; i < 1200; i++) {
  stepRope(rope, 230);
  assert.ok(rope.every(p => Object.values(p).every(Number.isFinite)));
  assert.deepEqual(rope[0], { x: 300, y: 0, px: 300, py: 0 });
  const tip = rope.at(-1)!;
  assert.ok(Math.hypot(tip.x - tip.px, tip.y - tip.py) <= 4.000001);
 }
 const tip = rope.at(-1)!;
 assert.ok(Math.abs(tip.x - 300) < 1);
 assert.ok(Math.abs(tip.y - 230) < 5);
});

test('a sideways release swings around its anchor instead of following a separate spring', () => {
 const rope = createRope(300, 0, 230);
 for (let i = 0; i < 30; i++) stepRope(rope, 230, { x: 440, y: 150 });
 let crossed = false;
 for (let i = 0; i < 600; i++) { stepRope(rope, 230); if (rope.at(-1)!.x < 299) crossed = true; }
 assert.ok(crossed);
});

test('a held endpoint follows the pointer while the cord bends', () => {
 const rope = createRope(300, 0, 230);
 for (let i = 0; i < 30; i++) stepRope(rope, 230, { x: 400, y: 150 });
 assert.equal(rope.at(-1)!.x, 400);
 assert.equal(rope.at(-1)!.y, 150);
 assert.ok(rope.slice(1, -1).some(p => p.x > 300));
});

test('over-pull threshold works in any direction', () => {
 assert.equal(isOverstretched(0, 101, 160, 100), true);
 assert.equal(isOverstretched(210, 0, 160, 100), true);
 assert.equal(isOverstretched(20, 20, 160, 100), false);
});
