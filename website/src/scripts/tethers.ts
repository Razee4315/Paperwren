/** Small damped springs, with bounded dragging and no background animation work. */
export type Spring = { x: number; y: number; vx: number; vy: number };
export function stepSpring(s: Spring, dt: number, targetX = 0, targetY = 0) {
 const steps = Math.max(1, Math.ceil(Math.min(dt, .05) / (1 / 120)));
 const h = Math.min(dt, .05) / steps;
 for (let i = 0; i < steps; i++) {
  s.vx += ((targetX - s.x) * 32 - s.vx * 7.5) * h;
  s.vy += ((targetY - s.y) * 32 - s.vy * 7.5) * h;
  s.x += s.vx * h;
  s.y += s.vy * h;
 }
}
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function isOverstretched(x: number, y: number, length: number, threshold: number) {
 return Math.hypot(x, length + y) - length > threshold;
}
export function initTethers(root: HTMLElement) {
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 const paths = root.querySelectorAll<SVGPathElement>('.strings path');
 const nodes = [...root.querySelectorAll<HTMLButtonElement>('[data-file]')].map((el, i) => ({
  el, path: paths[i]!, x: 0, y: 0, vx: 0, vy: 0, left: 0, top: 0, w: 0, h: 0,
  pointer: -1, lastX: 0, lastY: 0, startX: 0, startY: 0, lastTime: 0, rope: [] as { x: number; y: number; px: number; py: number }[],
 }));
 let visible = false, frame = 0, previous = 0, elapsed = 0;
 let width = root.clientWidth;
 const measure = () => {
  width = root.clientWidth;
  for (const n of nodes) {
   n.left = n.el.offsetLeft; n.top = n.el.offsetTop;
   n.w = n.el.offsetWidth; n.h = n.el.offsetHeight;
   n.x = 0; n.y = 0; n.vx = 0; n.vy = 0;
   n.rope = Array.from({length: 12}, (_, i) => ({x: n.left + n.w / 2, y: 66 + (n.top + 5 - 66) * i / 11, px: n.left + n.w / 2, py: 66 + (n.top + 5 - 66) * i / 11}));
  }
  draw();
 };
 const limits = (n: typeof nodes[number]) => {
  const travel = width < 600 ? 65 : 220;
  return { minX: Math.max(-travel, 8 - n.left), maxX: Math.min(travel, width - n.left - n.w - 8),
   minY: 72 - n.top, maxY: width < 600 ? 290 - n.top - n.h : Math.min(210, root.clientHeight - n.top - n.h - 20) };
 };
 const draw = () => {
  nodes.forEach((n, i) => {
   if (!n.w) { n.path.style.opacity = "0"; return; }
   const angle = reduced.matches ? 0 : n.x * .11 + clamp(n.vx * .025, -9, 9) + Math.sin(elapsed * .65 + i) * 1.1;
   n.el.style.transform = `translate3d(${n.x}px, ${n.y}px, 0) rotate(${angle}deg)`;
   const ax = n.left + n.w / 2, ay = 66;
   const ex = ax + n.x, ey = n.top + n.y + 5;
   // Segmented rope inspired by the portfolio's LampPullToggle Verlet chain.
   const rope = n.rope, length = Math.max(1, n.top + 5 - ay) / 11;
   for (let j = 1; j < 11; j++) {
    const p = rope[j]!, vx = (p.x - p.px) * .94, vy = (p.y - p.py) * .94;
    p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + .3;
   }
   for (let k = 0; k < 18; k++) {
    rope[0]!.x = ax; rope[0]!.y = ay; rope[11]!.x = ex; rope[11]!.y = ey;
    for (let j = 0; j < 11; j++) {
     const a = rope[j]!, b = rope[j + 1]!, dx = b.x - a.x, dy = b.y - a.y;
     const distance = Math.hypot(dx, dy) || .001, diff = (distance - length) / distance;
     if (j > 0) { a.x += dx * diff * .5; a.y += dy * diff * .5; }
     if (j < 10) { b.x -= dx * diff * .5; b.y -= dy * diff * .5; }
    }
   }
   rope[11]!.x = ex; rope[11]!.y = ey;
   n.path.setAttribute('d', rope.map((p, j) => `${j ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '));
   n.path.style.opacity = ey < ay ? '0' : '1';
  });
 };
 const tick = (now: number) => {
  frame = 0;
  if (!visible || document.hidden || reduced.matches) return;
  const dt = previous ? Math.min((now - previous) / 1000, .033) : 1 / 60;
  previous = now; elapsed += dt;
  nodes.forEach((n, i) => {
   if (n.pointer !== -1) return;
   stepSpring(n, dt, Math.sin(elapsed * .65 + i * 1.7) * 2.5, Math.sin(elapsed * .5 + i) * .5);
   if (elapsed > 2.2) {
    const b = limits(n);
    const x = clamp(n.x, b.minX, b.maxX), y = clamp(n.y, b.minY, b.maxY);
    if (x !== n.x) n.vx *= -.15;
    if (y !== n.y) n.vy *= -.15;
    n.x = x; n.y = y;
   }
  });
  draw(); frame = requestAnimationFrame(tick);
 };
 const start = () => { if (!frame && visible && !document.hidden && !reduced.matches) { previous = 0; frame = requestAnimationFrame(tick); } };
 const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; };
 measure();
 if (!reduced.matches) { nodes.forEach(n => { n.y = -n.top - n.h; }); draw(); }
 for (const n of nodes) {
  n.el.addEventListener('pointerdown', event => {
   if (event.button !== 0 || n.pointer !== -1 || reduced.matches) return;
   n.pointer = event.pointerId;
   n.startX = n.lastX = event.clientX; n.startY = n.lastY = event.clientY;
   n.lastTime = event.timeStamp; n.vx = n.vy = 0;
   n.el.dataset.dragged = 'false'; n.el.dataset.dragging = '';
   n.el.setPointerCapture(event.pointerId);
   n.el.focus({ preventScroll: true });
  });
  n.el.addEventListener('pointermove', event => {
   if (n.pointer !== event.pointerId) return;
   const b = limits(n), oldX = n.x, oldY = n.y;
   n.x = clamp(n.x + event.clientX - n.lastX, b.minX, b.maxX);
   n.y = clamp(n.y + event.clientY - n.lastY, b.minY, b.maxY);
   const dt = Math.max((event.timeStamp - n.lastTime) / 1000, .008);
   n.vx = clamp((n.x - oldX) / dt, -400, 400); n.vy = clamp((n.y - oldY) / dt, -400, 400);
   if (Math.hypot(event.clientX - n.startX, event.clientY - n.startY) > 5) n.el.dataset.dragged = 'true';
   n.lastX = event.clientX; n.lastY = event.clientY; n.lastTime = event.timeStamp;
   if (isOverstretched(n.x, n.y, n.top + 5 - 66, width < 600 ? 48 : 95)) {
    n.el.dataset.dragged = 'true';
    release(true);
   }
   draw();
  });
  const release = (cancel = false) => {
   if (n.pointer === -1) return;
   const pointer = n.pointer; n.pointer = -1;
   if (cancel || performance.now() - n.lastTime > 100) n.vx = n.vy = 0;
   if (cancel) n.el.dataset.dragged = 'true';
   delete n.el.dataset.dragging;
   if (n.el.hasPointerCapture(pointer)) n.el.releasePointerCapture(pointer);
   start();
  };
  n.el.addEventListener('pointerup', () => release());
  n.el.addEventListener('pointercancel', () => release(true));
  n.el.addEventListener('lostpointercapture', () => release(true));
  n.el.addEventListener('keydown', event => {
   if (event.key === 'Escape') release(true);
   if (event.key === 'Enter' || event.key === ' ') n.el.dataset.dragged = 'false';
   if (!reduced.matches && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); n.vx += event.key === 'ArrowLeft' ? -80 : event.key === 'ArrowRight' ? 80 : 0;
    n.vy += event.key === 'ArrowUp' ? -80 : event.key === 'ArrowDown' ? 80 : 0;
    start();
   }
  });
 }
 const observer = new IntersectionObserver(entries => {
  visible = entries[0]?.isIntersecting ?? false;
  if (visible) start(); else stop();
 });
 observer.observe(root);
 let measuredWidth = width;
 new ResizeObserver(() => { if (root.clientWidth !== measuredWidth) { measuredWidth = root.clientWidth; measure(); } }).observe(root);
 document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
 reduced.addEventListener('change', () => { stop(); measure(); if (!reduced.matches) start(); });
}
