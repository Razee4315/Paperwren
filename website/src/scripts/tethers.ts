/** Weighted Verlet rope adapted from the portfolio's LampPullToggle. */
export type Particle = { x: number; y: number; px: number; py: number };
export function createRope(x: number, y: number, length: number): Particle[] {
 return Array.from({ length: 11 }, (_, i) => ({ x, y: y + length * i / 10, px: x, py: y + length * i / 10 }));
}
export function isOverstretched(x: number, y: number, length: number, threshold: number) {
 return Math.hypot(x, length + y) - length > threshold;
}
/** One 60 Hz step: the free endpoint is part of the rope, never a separate spring. */
export function stepRope(ps: Particle[], length: number, held?: { x: number; y: number }) {
 const last = ps[ps.length - 1]!;
 for (const p of ps.slice(1)) {
  const vx = (p.x - p.px) * .94, vy = (p.y - p.py) * .94;
  p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + .45;
 }
 if (held) { last.x = held.x; last.y = held.y; }
 const preX = last.x, preY = last.y;
 for (let iteration = 0; iteration < 18; iteration++) {
  for (let j = 0; j < ps.length - 1; j++) {
   const a = ps[j]!, b = ps[j + 1]!, dx = b.x - a.x, dy = b.y - a.y;
   const distance = Math.hypot(dx, dy) || .0001;
   const correction = (distance - length / (ps.length - 1)) / distance;
   const tip = j === ps.length - 2;
   if (j > 0) { a.x += dx * correction * (tip ? .82 : .5); a.y += dy * correction * (tip ? .82 : .5); }
   if (!(tip && held)) { b.x -= dx * correction * (tip ? .18 : .5); b.y -= dy * correction * (tip ? .18 : .5); }
  }
 }
 if (!held) {
  // Same correction and velocity caps as the portfolio prevent a whip into the mount.
  const dx = last.x - preX, dy = last.y - preY, distance = Math.hypot(dx, dy);
  if (distance > 4) { last.x = preX + dx * 4 / distance; last.y = preY + dy * 4 / distance; }
  const vx = last.x - last.px, vy = last.y - last.py, speed = Math.hypot(vx, vy);
  if (speed > 4) { last.px = last.x - vx * 4 / speed; last.py = last.y - vy * 4 / speed; }
 }
 return ps.slice(1).some(p => Math.abs(p.x - p.px) + Math.abs(p.y - p.py) > .05);
}
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function initTethers(root: HTMLElement) {
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 const paths = root.querySelectorAll<SVGPathElement>('.strings path');
 const nodes = [...root.querySelectorAll<HTMLButtonElement>('[data-file]')].map((el, i) => ({
  el, path: paths[i]!, rope: [] as Particle[], left: 0, top: 0, w: 0, h: 0, length: 0,
  pointer: -1, startX: 0, startY: 0, originX: 0, originY: 0, held: undefined as { x: number; y: number } | undefined,
 }));
 let visible = false, frame = 0, previous = 0, accumulated = 0;
 let width = root.clientWidth;
 const draw = () => {
  for (const n of nodes) {
   n.path.style.display = n.w ? '' : 'none';
   if (!n.w) continue;
   const tip = n.rope[n.rope.length - 1]!, above = n.rope[n.rope.length - 2]!;
   const angle = reduced.matches ? 0 : clamp(-Math.atan2(tip.x - above.x, tip.y - above.y) * 180 / Math.PI, -35, 35);
   n.el.style.transform = `translate3d(${tip.x - n.left - n.w / 2}px, ${tip.y - n.top - 5}px, 0) rotate(${angle}deg)`;
   n.path.setAttribute('d', n.rope.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '));
  }
 };
 const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; accumulated = 0; };
 const wake = () => {
  if (!frame && visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
 };
 const measure = (drop = false) => {
  width = root.clientWidth;
  for (const n of nodes) {
   release(n, true);
   n.left = n.el.offsetLeft; n.top = n.el.offsetTop; n.w = n.el.offsetWidth; n.h = n.el.offsetHeight;
   n.length = n.top + 5;
   n.rope = createRope(n.left + n.w / 2, 0, n.length);
   if (drop && !reduced.matches && n.w) {
    n.rope.forEach((p, i) => { p.y *= .2; p.x += Math.sin(i * .65) * 8; p.px = p.x; p.py = p.y; });
   }
  }
  draw(); wake();
 };
 function tick(now: number) {
  frame = 0;
  if (!visible || document.hidden || reduced.matches) return;
  accumulated += previous ? Math.min((now - previous) / 1000, .05) : 1 / 60;
  previous = now;
  let moving = false, stepped = false;
  while (accumulated >= 1 / 60) {
   accumulated -= 1 / 60; stepped = true; moving = false;
   for (const n of nodes) {
    if (!n.w) continue;
    moving = stepRope(n.rope, n.length, n.held) || moving || n.pointer !== -1;
    const p = n.rope[n.rope.length - 1]!;
    const x = clamp(p.x, n.w / 2 + 8, width - n.w / 2 - 8);
    const y = clamp(p.y, 12, root.clientHeight - n.h - 8);
    if (x !== p.x) p.px = x;
    if (y !== p.y) p.py = y;
    p.x = x; p.y = y;
   }
  }
  draw();
  if (moving || !stepped) frame = requestAnimationFrame(tick);
  else { previous = 0; accumulated = 0; }
 }
 function release(n: typeof nodes[number], cancel = false) {
  if (n.pointer === -1) return;
  const id = n.pointer; n.pointer = -1; n.held = undefined;
  if (cancel) n.el.dataset.dragged = 'true';
  delete n.el.dataset.dragging;
  if (n.el.hasPointerCapture(id)) n.el.releasePointerCapture(id);
  wake();
 }
 for (const n of nodes) {
  n.el.addEventListener('pointerdown', event => {
   if (event.button !== 0 || n.pointer !== -1 || reduced.matches) return;
   const tip = n.rope[n.rope.length - 1]!;
   n.pointer = event.pointerId; n.startX = event.clientX; n.startY = event.clientY;
   n.originX = tip.x; n.originY = tip.y; n.held = { x: tip.x, y: tip.y };
   n.el.dataset.dragged = 'false'; n.el.dataset.dragging = '';
   n.el.setPointerCapture(event.pointerId); n.el.focus({ preventScroll: true }); wake();
  });
  n.el.addEventListener('pointermove', event => {
   if (n.pointer !== event.pointerId) return;
   const dx = event.clientX - n.startX, dy = event.clientY - n.startY;
   if (Math.hypot(dx, dy) > 5) n.el.dataset.dragged = 'true';
   n.held = { x: clamp(n.originX + dx, n.w / 2 + 8, width - n.w / 2 - 8),
    y: clamp(n.originY + dy, 12, root.clientHeight - n.h - 8) };
   const tip = n.rope[n.rope.length - 1]!;
   tip.x = n.held.x; tip.y = n.held.y;
   if (isOverstretched(tip.x - n.rope[0]!.x, tip.y - n.length, n.length, width < 600 ? 48 : 100)) release(n, true);
   wake();
  });
  n.el.addEventListener('pointerup', () => release(n));
  n.el.addEventListener('pointercancel', () => release(n, true));
  n.el.addEventListener('lostpointercapture', () => release(n, true));
  n.el.addEventListener('keydown', event => {
   if (event.key === 'Escape') release(n, true);
   if (event.key === 'Enter' || event.key === ' ') n.el.dataset.dragged = 'false';
   if (!reduced.matches && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const tip = n.rope[n.rope.length - 1]!;
    tip.px -= event.key === 'ArrowLeft' ? -3 : event.key === 'ArrowRight' ? 3 : 0;
    tip.py -= event.key === 'ArrowUp' ? -3 : event.key === 'ArrowDown' ? 3 : 0; wake();
   }
  });
 }
 measure(true);
 new IntersectionObserver(entries => {
  visible = entries[0]?.isIntersecting ?? false;
  if (visible) wake(); else { for (const n of nodes) release(n, true); stop(); }
 }).observe(root);
 new ResizeObserver(() => { if (root.clientWidth !== width) { stop(); measure(); } }).observe(root);
 document.addEventListener('visibilitychange', () => {
  if (document.hidden) { for (const n of nodes) release(n, true); stop(); }
  else { for (const n of nodes) for (const p of n.rope) { p.px = p.x; p.py = p.y; } wake(); }
 });
 reduced.addEventListener('change', () => { stop(); measure(); });
}
