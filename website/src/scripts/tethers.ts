/**
 * Icons hang from elastic cords as real pendulums: longer cords swing slower,
 * and a dropped icon falls on a slack cord and bounces when it goes taut.
 * Polar state keeps every swing bounded.
 */
export type Pendulum = { r: number; rv: number; th: number; w: number };
export const GRAVITY = 2400;
const STIFFNESS = 1400, CORD_DAMPING = 26, SWING_DAMPING = .55;
const MAX_ANGLE = 1.15, MAX_SPIN = 7, MAX_RADIAL = 900;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Advances one pendulum of rest length `length` by `dt` seconds; `wind` is a sideways push in px/s². */
export function stepPendulum(p: Pendulum, dt: number, length: number, wind = 0) {
 const time = Math.min(dt, .05), steps = Math.max(1, Math.ceil(time * 240)), h = time / steps;
 const natural = length - GRAVITY / STIFFNESS, shortest = length * .35;
 for (let i = 0; i < steps; i++) {
  const sin = Math.sin(p.th), cos = Math.cos(p.th);
  // A cord pulls but never pushes: below its natural length it is slack.
  const tension = p.r > natural ? STIFFNESS * (p.r - natural) + CORD_DAMPING * p.rv : 0;
  p.rv += (p.r * p.w * p.w + GRAVITY * cos - Math.max(0, tension)) * h;
  p.w += ((wind * cos - GRAVITY * sin - 2 * p.rv * p.w) / p.r - SWING_DAMPING * p.w) * h;
  p.rv = clamp(p.rv, -MAX_RADIAL, MAX_RADIAL); p.w = clamp(p.w, -MAX_SPIN, MAX_SPIN);
  p.r += p.rv * h; p.th += p.w * h;
  if (p.r < shortest) { p.r = shortest; p.rv = Math.max(0, p.rv); }
  if (Math.abs(p.th) > MAX_ANGLE) { p.th = Math.sign(p.th) * MAX_ANGLE; p.w *= -.3; }
 }
}

export function isOverstretched(x: number, y: number, length: number, threshold: number) {
 return Math.hypot(x, length + y) - length > threshold;
}

const ANCHOR_Y = 66;
export function initTethers(root: HTMLElement) {
 const reduced = matchMedia('(prefers-reduced-motion: reduce)');
 const cords = root.querySelectorAll<SVGGElement>('.strings g');
 const nodes = [...root.querySelectorAll<HTMLButtonElement>('[data-file]')].map((el, i) => ({
  el, paths: [...cords[i]!.querySelectorAll('path')], r: 0, rv: 0, th: 0, w: 0, length: 1, delay: 0, falling: false, fallV: 0,
  left: 0, top: 0, w0: 0, h: 0, x: 0, y: 0, dragVX: 0, dragVY: 0,
  pointer: -1, lastX: 0, lastY: 0, startX: 0, startY: 0, lastTime: 0, rope: [] as { x: number; y: number; px: number; py: number }[],
 }));
 let visible = false, frame = 0, previous = 0, elapsed = 0;
 let width = root.clientWidth;
 const syncXY = (n: typeof nodes[number]) => { n.x = n.r * Math.sin(n.th); n.y = n.r * Math.cos(n.th) - n.length; };
 const measure = () => {
  width = root.clientWidth;
  nodes.forEach(n => {
   n.left = n.el.offsetLeft; n.top = n.el.offsetTop;
   n.w0 = n.el.offsetWidth; n.h = n.el.offsetHeight;
   n.length = Math.max(1, n.top + 5 - ANCHOR_Y);
   n.r = n.length; n.rv = 0; n.th = 0; n.w = 0; n.delay = 0; n.falling = false;
   const ax = n.left + n.w0 / 2;
   n.rope = Array.from({length: 12}, (_, j) => ({x: ax, y: ANCHOR_Y + n.length * j / 11, px: ax, py: ANCHOR_Y + n.length * j / 11}));
   syncXY(n);
  });
  draw();
 };
 const limits = (n: typeof nodes[number]) => {
  const travel = width < 600 ? 65 : 220;
  return { minX: Math.max(-travel, 8 - n.left), maxX: Math.min(travel, width - n.left - n.w0 - 8),
   minY: 72 - n.top, maxY: width < 600 ? 290 - n.top - n.h : Math.min(210, root.clientHeight - n.top - n.h - 20) };
 };
 const draw = () => {
  nodes.forEach(n => {
   if (!n.w0) { n.paths.forEach(p => { p.style.opacity = '0'; }); return; }
   const held = n.pointer !== -1;
   const angle = reduced.matches ? 0 : held
    ? -Math.atan2(n.x, n.length + n.y) * 50 + clamp(n.dragVX * .02, -12, 12)
    : -n.th * 180 / Math.PI * .85 + clamp(n.w * 4, -10, 10);
   n.el.style.transform = `translate3d(${n.x}px, ${n.y}px, 0) rotate(${angle}deg)`;
   // Light comes from above, so the shadow stays put while the icon turns.
   const rad = -angle * Math.PI / 180, lift = held ? 1.6 : 1;
   n.el.style.setProperty('--sx', `${(4 * Math.cos(rad) - 11 * Math.sin(rad)) * lift}`);
   n.el.style.setProperty('--sy', `${(4 * Math.sin(rad) + 11 * Math.cos(rad)) * lift}`);
   const ax = n.left + n.w0 / 2, ay = ANCHOR_Y;
   const ex = ax + n.x, ey = n.top + n.y + 5;
   const rope = n.rope, segment = n.length / 11;
   for (let j = 1; j < 11; j++) {
    const p = rope[j]!, vx = (p.x - p.px) * .94, vy = (p.y - p.py) * .94;
    p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + .35;
   }
   for (let k = 0; k < 18; k++) {
    rope[0]!.x = ax; rope[0]!.y = ay; rope[11]!.x = ex; rope[11]!.y = ey;
    for (let j = 0; j < 11; j++) {
     const a = rope[j]!, b = rope[j + 1]!, dx = b.x - a.x, dy = b.y - a.y;
     const distance = Math.hypot(dx, dy) || .001;
     // Only a stretched segment pulls; a slack one is left to sag.
     const diff = Math.max(0, distance - segment) / distance;
     if (j > 0) { a.x += dx * diff * .5; a.y += dy * diff * .5; }
     if (j < 10) { b.x -= dx * diff * .5; b.y -= dy * diff * .5; }
    }
   }
   rope[11]!.x = ex; rope[11]!.y = ey;
   let d = `M ${rope[0]!.x} ${rope[0]!.y}`;
   for (let j = 1; j < 11; j++) {
    const a = rope[j]!, b = rope[j + 1]!;
    d += ` Q ${a.x} ${a.y} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
   }
   d += ` L ${ex} ${ey}`;
   n.paths.forEach(p => { p.setAttribute('d', d); p.style.opacity = n.falling || ey < ay ? '0' : '1'; });
  });
 };
 const tick = (now: number) => {
  frame = 0;
  if (!visible || document.hidden || reduced.matches) return;
  const dt = previous ? Math.min((now - previous) / 1000, .033) : 1 / 60;
  previous = now; elapsed += dt;
  nodes.forEach((n, i) => {
   if (n.pointer !== -1 || !n.w0) return;
   if (n.delay > 0) { n.delay -= dt; return; }
   if (n.falling) {
    n.fallV += GRAVITY * dt; n.y += n.fallV * dt;
    // Once the icon drops past the ceiling its cord pays out behind it, slack until it catches.
    if (n.top + n.y + 5 > ANCHOR_Y + 12) {
     n.falling = false;
     n.r = n.length + n.y; n.rv = n.fallV; n.w = 0;
     n.th = (n.left + n.w0 / 2 < width / 2 ? 1 : -1) * (.04 + (i % 3) * .025);
     const ax = n.left + n.w0 / 2, ey = n.top + n.y + 5;
     n.rope.forEach((p, j) => { p.x = p.px = ax; p.y = p.py = ANCHOR_Y + (ey - ANCHOR_Y) * j / 11; });
     syncXY(n);
    }
    return;
   }
   // Two slow gusts per icon, out of phase, read as a draught rather than a loop.
   const wind = 55 * Math.sin(elapsed * .37 + i * 1.9) + 30 * Math.sin(elapsed * .83 + i * .7);
   stepPendulum(n, dt, n.length, wind);
   syncXY(n);
   // The page edges are walls: an icon knocks against them and swings back.
   const b = limits(n), edge = n.x < b.minX ? b.minX : n.x > b.maxX ? b.maxX : undefined;
   if (edge !== undefined) {
    n.th = Math.asin(clamp(edge / n.r, -.9, .9)); n.w = -Math.sign(edge) * Math.abs(n.w) * .4;
    syncXY(n);
   }
  });
  draw(); frame = requestAnimationFrame(tick);
 };
 const start = () => { if (!frame && visible && !document.hidden && !reduced.matches) { previous = 0; frame = requestAnimationFrame(tick); } };
 const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; };
 measure();
 if (!reduced.matches) {
  // Icons fall in from above the page, one after another, and bounce when their cords catch.
  nodes.forEach((n, i) => { n.falling = true; n.fallV = 0; n.x = 0; n.y = -n.top - n.h - 10; n.delay = .2 + [2, 0, 3, 1, 4, 5][i]! * .11; });
  draw();
 }
 for (const n of nodes) {
  n.el.addEventListener('pointerdown', event => {
   if (event.button !== 0 || n.pointer !== -1 || reduced.matches) return;
   n.pointer = event.pointerId; n.delay = 0; n.falling = false;
   n.startX = n.lastX = event.clientX; n.startY = n.lastY = event.clientY;
   n.lastTime = event.timeStamp; n.dragVX = n.dragVY = 0;
   n.el.dataset.dragged = 'false'; n.el.dataset.dragging = '';
   n.el.setPointerCapture(event.pointerId);
   start();
  });
  n.el.addEventListener('pointermove', event => {
   if (n.pointer !== event.pointerId) return;
   const b = limits(n), oldX = n.x, oldY = n.y;
   n.x = clamp(n.x + event.clientX - n.lastX, b.minX, b.maxX);
   n.y = clamp(n.y + event.clientY - n.lastY, b.minY, b.maxY);
   const dt = Math.max((event.timeStamp - n.lastTime) / 1000, .008);
   n.dragVX = clamp((n.x - oldX) / dt, -1400, 1400); n.dragVY = clamp((n.y - oldY) / dt, -1400, 1400);
   if (Math.hypot(event.clientX - n.startX, event.clientY - n.startY) > 5) n.el.dataset.dragged = 'true';
   n.lastX = event.clientX; n.lastY = event.clientY; n.lastTime = event.timeStamp;
   if (isOverstretched(n.x, n.y, n.length, width < 600 ? 48 : 95)) {
    n.el.dataset.dragged = 'true';
    release(true);
   }
   draw();
  });
  const release = (cancel = false) => {
   if (n.pointer === -1) return;
   const pointer = n.pointer; n.pointer = -1;
   if (performance.now() - n.lastTime > 100) n.dragVX = n.dragVY = 0;
   // Hand the throw to the pendulum: split the release velocity into swing and stretch.
   n.r = Math.max(n.length * .35, Math.hypot(n.x, n.length + n.y));
   n.th = clamp(Math.atan2(n.x, n.length + n.y), -1.15, 1.15);
   const sin = Math.sin(n.th), cos = Math.cos(n.th);
   n.rv = n.dragVX * sin + n.dragVY * cos;
   n.w = (n.dragVX * cos - n.dragVY * sin) / n.r;
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
    event.preventDefault();
    n.w += event.key === 'ArrowLeft' ? -1.2 : event.key === 'ArrowRight' ? 1.2 : 0;
    n.rv += event.key === 'ArrowUp' ? -500 : event.key === 'ArrowDown' ? 300 : 0;
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
