/**
 * The logo's wren leaves the nav a few seconds after the files have fallen
 * and roams the home page: it perches on hanging files, buttons, frames,
 * rules and the tops of heading letters, and follows the reader down the
 * page at its own pace. It flies like a real wren, in bursts of flapping
 * with short tucked-wing dips, and flares to land.
 *
 * The bird lives in a layer that scrolls with the document, so while it sits
 * on something it stays glued to it, even under native touch scrolling.
 * Everything is skipped with prefers-reduced-motion.
 */
import { hangers, type Hanger } from "./tethers.ts";

export type Vec = { x: number; y: number };
export type Path = { pts: Vec[]; len: number[]; total: number };

/** A cubic Bézier sampled into a polyline with cumulative lengths, so it can be walked at a set speed. */
export function bezier(p0: Vec, p1: Vec, p2: Vec, p3: Vec, samples = 48): Path {
 const pts: Vec[] = [], len: number[] = [];
 let total = 0;
 for (let i = 0; i <= samples; i++) {
  const t = i / samples, u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  const p = { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  const prev = pts[i - 1];
  if (prev) total += Math.hypot(p.x - prev.x, p.y - prev.y);
  pts.push(p); len.push(total);
 }
 return { pts, len, total };
}

/** The point `s` pixels along a path. */
export function along(path: Path, s: number): Vec {
 const { pts, len } = path;
 if (s <= 0) return { ...pts[0]! };
 if (s >= path.total) return { ...pts[pts.length - 1]! };
 let lo = 0, hi = len.length - 1;
 while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (len[mid]! < s) lo = mid; else hi = mid; }
 const a = pts[lo]!, b = pts[hi]!, span = len[hi]! - len[lo]! || 1, t = (s - len[lo]!) / span;
 return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Next flight speed: speed up towards cruise, and brake in time to reach `end` speed on arrival. */
export function nextSpeed(v: number, dt: number, remaining: number, cruise: number, end: number, accel = 900, brake = 700) {
 const braking = Math.sqrt(end * end + 2 * brake * Math.max(0, remaining));
 return Math.max(Math.min(v + accel * dt, cruise, braking), Math.min(end, 30));
}

/** Wing lift through one flap: a quick downstroke and a slower recovery. 1 is raised, about -0.85 lowered. */
export function wingLift(phase: number) {
 const p = phase - Math.floor(phase);
 const warped = p < .42 ? p / .42 * .5 : .5 + (p - .42) / .58 * .5;
 return .075 + .925 * Math.cos(warped * 2 * Math.PI);
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const smooth = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const approach = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** The bird is drawn in a 64px box; its feet touch the ground at (32, 59). */
const SIZE = 34, FOOT_X = .5, FOOT_Y = 59 / 64;
/** Letters with a flat enough top to stand on. */
const FLAT_TOPS = /[BDEFHIKLMNPRTUbdhkl1]/;

type Spot =
 | { kind: "edge" | "bottom"; el: HTMLElement; frac: number }
 | { kind: "text"; el: HTMLElement; node: Text; index: number; lift: number }
 | { kind: "hanger"; hanger: Hanger; u: number }
 | { kind: "home"; el: Element }
 | { kind: "air"; at: Vec };
type Place = Vec & { angle: number };
type Flight = {
 path: Path; s: number; speed: number; cruise: number; land: boolean; spot: Spot;
 planned: Vec; age: number; check: number; burst: number; tuck: number; flaps: number;
};

export function initWren(sky: HTMLElement) {
 if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
 const flyer = sky.querySelector<HTMLElement>("[data-flyer]");
 const art = flyer?.querySelector<SVGSVGElement>("svg");
 const logo = document.querySelector<SVGSVGElement>(".nav .brand svg");
 if (!flyer || !art || !logo) return;
 const part = (name: string) => art.querySelector<SVGGElement>(`[data-part=${name}]`)!;
 const near = part("near"), far = part("far"), fold = part("fold"), tailEl = part("tail"), legsEl = part("legs"), eye = part("eye");
 document.body.append(sky);

 const perches = [...document.querySelectorAll<HTMLElement>("[data-perch]")];
 const pine = document.querySelector<HTMLElement>(".download"), foot = document.querySelector<HTMLElement>(".foot");
 const canvas = document.createElement("canvas").getContext("2d");

 // Layer geometry, refreshed every frame: the layer's viewport offset converts
 // between viewport and document space and tells where the reader is looking.
 let origin = { x: 0, y: 0 }, view = { left: 0, top: 0, right: 0, bottom: 0 };
 const measureView = () => {
  const r = sky.getBoundingClientRect();
  origin = { x: r.left, y: r.top };
  view = { left: -r.left, top: -r.top, right: -r.left + document.documentElement.clientWidth, bottom: -r.top + innerHeight };
 };
 const local = (x: number, y: number): Vec => ({ x: x - origin.x, y: y - origin.y });
 // Sized to the page (measured without itself) and clipped, so a bird near the bottom never extends it.
 const fitLayer = () => { sky.style.height = "0px"; sky.style.height = `${document.documentElement.scrollHeight}px`; };

 let pos: Vec = { x: 0, y: 0 }, vel: Vec = { x: 0, y: 0 };
 let mode: "waiting" | "perched" | "crouch" | "flying" = "waiting";
 let spot: Spot = { kind: "home", el: logo }, flight: Flight | undefined;
 let face = 1, faceTarget = 1, pitch = 0, squash = 1, scale = 1, tail = 0, tailV = 0, legs = 1, legTilt = 0;
 let wingPhase = 0, wings = 0, blink = 0, peck = 0;
 let dwell = 0, leaveIn = -1, idle = 1, blinkIn = 2, crouch = 0, hop: { from: number; to: number; t: number } | undefined;
 let flee: Vec | undefined, visits = 0, song = -1, zoneCheck = 0;
 const recent: unknown[] = [];
 let pointer = { x: -1e4, y: -1e4, t: -1 }, scrollDir = 0, lastScroll = scrollY, clock = 0;

 const visible = (el: Element) => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true);
 const identity = (s: Spot): unknown => (s.kind === "hanger" ? s.hanger : s.kind === "air" ? undefined : s.el);

 const where = (s: Spot): Place | undefined => {
  switch (s.kind) {
   case "edge": case "bottom": {
    const r = s.el.getBoundingClientRect();
    if (!r.width) return;
    return { ...local(r.left + s.frac * r.width, s.kind === "edge" ? r.top : r.bottom - .5), angle: 0 };
   }
   case "text": {
    const range = document.createRange();
    range.setStart(s.node, s.index); range.setEnd(s.node, s.index + 1);
    const r = range.getBoundingClientRect();
    if (!r.width) return;
    return { ...local(r.left + r.width / 2, r.top + s.lift), angle: 0 };
   }
   case "hanger": {
    if (!s.hanger.perchable()) return;
    const p = s.hanger.perch(s.u);
    return { ...local(p.x, p.y), angle: s.hanger.angle() };
   }
   case "home": {
    const r = s.el.getBoundingClientRect();
    if (r.bottom < 0) return;
    return { ...local(r.left + r.width * FOOT_X, r.top + r.height * FOOT_Y), angle: 0 };
   }
   case "air": return { ...s.at, angle: 0 };
  }
 };

 /** Glyph tops sit below the line box by the font's ascent less the glyph's own. */
 const letters = (el: HTMLElement) => {
  const out: Spot[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
   const host = node.parentElement;
   if (!host || !canvas) continue;
   const cs = getComputedStyle(host);
   canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
   for (let i = 0; i < node.data.length; i++) {
    const ch = node.data[i]!;
    if (!FLAT_TOPS.test(ch)) continue;
    const m = canvas.measureText(ch);
    out.push({ kind: "text", el, node, index: i, lift: m.fontBoundingBoxAscent - m.actualBoundingBoxAscent });
   }
  }
  return out;
 };

 const inZone = (p: Vec, slack = 0) =>
  p.y > view.top + 96 - slack && p.y < view.bottom - 56 + slack && p.x > view.left + 20 - slack && p.x < view.right - 20 + slack;
 /** The logo sits in the fixed nav, above the zone, and is only home while the page is at the top. */
 const reachable = (s: Spot, p: Vec, slack = 0) => (s.kind === "home" ? view.top < 30 : inZone(p, slack));

 /** Weighted pick of somewhere to land that the reader can see. */
 const choose = (): Spot | undefined => {
  const options: { spot: Spot; w: number }[] = [];
  const consider = (s: Spot, base: number) => {
   const p = where(s);
   if (!p || !reachable(s, p)) return;
   const d = Math.hypot(p.x - pos.x, p.y - pos.y);
   if (d < 70) return;
   let w = base * (.25 + Math.exp(-(((d - 280) / 360) ** 2)));
   const depth = (p.y - view.top) / (view.bottom - view.top);
   if (scrollDir > 0) w *= .5 + 1.6 * depth;
   if (scrollDir < 0) w *= .5 + 1.6 * (1 - depth);
   if (flee) w *= ((p.x - pos.x) * flee.x + (p.y - pos.y) * flee.y) / d > .2 ? 2.5 : .1;
   if (recent.includes(identity(s))) w *= .06;
   options.push({ spot: s, w });
  };
  for (const el of perches) {
   const r = el.getBoundingClientRect(), kind = el.dataset.perch;
   const edgeY = (kind === "bottom" ? r.bottom : r.top) - origin.y;
   if (!r.width || edgeY < view.top + 60 || edgeY > view.bottom - 30 || !visible(el)) continue;
   if (kind === "text") {
    const all = letters(el);
    for (let i = 0; i < 3 && all.length; i++) consider(all[Math.floor(Math.random() * all.length)]!, 1.4 / 3);
    continue;
   }
   const inset = Math.min(.4, 28 / r.width);
   consider({ kind: kind === "bottom" ? "bottom" : "edge", el, frac: rand(inset, 1 - inset) }, 1);
  }
  for (const hanger of hangers) consider({ kind: "hanger", hanger, u: Math.random() }, 1.8);
  if (view.top < 30 && visits >= 4 && Math.random() < .35) consider({ kind: "home", el: logo }, 6);
  const total = options.reduce((sum, o) => sum + o.w, 0);
  let pick = Math.random() * total;
  for (const o of options) if ((pick -= o.w) <= 0) return o.spot;
  return undefined;
 };

 const wander = (): Spot => {
  const w = view.right - view.left, h = view.bottom - view.top;
  let at = { x: view.left + w * rand(.12, .88), y: view.top + h * rand(.22, .68) };
  if (flee) at = { x: clamp(pos.x + flee.x * 260, view.left + 40, view.right - 40), y: clamp(pos.y + flee.y * 200 - 60, view.top + 100, view.bottom - 80) };
  return { kind: "air", at };
 };

 const plan = (target: Spot, land: boolean) => {
  const p = where(target) ?? pos;
  const from = { ...pos }, dx = p.x - from.x, dy = p.y - from.y, d = Math.hypot(dx, dy) || 1;
  const speed = Math.hypot(vel.x, vel.y);
  // Leave along the current heading, or straight up and a little towards the goal from a standstill.
  const p1 = speed > 60
   ? { x: from.x + vel.x / speed * clamp(d * .4, 50, 240), y: from.y + vel.y / speed * clamp(d * .4, 50, 240) }
   : { x: from.x + dx * .18, y: from.y - clamp(40 + d * .22, 50, 130) };
  // Landings come in from above; open-air legs curve off to one side.
  const side = (Math.random() - .5) * d * .6;
  const p2 = land
   ? { x: p.x - dx * .2, y: p.y - clamp(d * .3, 40, 150) }
   : { x: p.x - dx * .35 - dy / d * side, y: p.y - dy * .35 + dx / d * side };
  // Stay under the top of the window, where the bird would vanish behind the page edge.
  const ceiling = view.top + 34;
  if (pos.y > ceiling) { p1.y = Math.max(p1.y, ceiling); p2.y = Math.max(p2.y, ceiling); }
  const off = !inZone(pos, 200);
  flight = {
   path: bezier(from, p1, p2, p), s: 0, speed: Math.max(speed, mode === "crouch" ? 140 : 0),
   cruise: off ? 620 : clamp(d * .75, 200, 420), land, spot: target, planned: { x: p.x, y: p.y },
   age: 0, check: .25, burst: 0, tuck: 0, flaps: Math.round(rand(2, 4)),
  };
  if (target.kind !== "air") { recent.push(identity(target)); if (recent.length > 3) recent.shift(); }
  mode = "flying";
 };

 const next = () => {
  const target = !flee && Math.random() < .1 ? undefined : choose();
  plan(target ?? wander(), !!target);
  flee = undefined;
 };

 const takeoff = (away?: Vec) => {
  if (mode !== "perched" && mode !== "waiting") return;
  flee = away; mode = "crouch"; crouch = .1; hop = undefined; leaveIn = -1;
  if (spot.kind === "hanger") spot.hanger.nudge(-faceTarget * 60, 140);
 };

 const land = () => {
  mode = "perched"; visits++;
  const s = flight!.spot, speed = Math.hypot(vel.x, vel.y);
  spot = s; flight = undefined;
  if (s.kind === "hanger") s.hanger.nudge(vel.x * .3, 220 + speed * .2);
  squash = .8; wings = 0; tailV += 260;
  dwell = s.kind === "home" ? rand(5, 9) : rand(3, 7); idle = rand(.5, 1.2);
  song = Math.random() < .2 ? rand(.6, 1.4) : -1;
 };

 const sing = () => {
  const p = { x: pos.x + face * SIZE * .38 * scale, y: pos.y - SIZE * .72 * scale };
  for (let i = 0; i < 3; i++) {
   const note = document.createElement("span");
   note.className = "note"; note.textContent = i % 2 ? "♫" : "♪";
   if (flyer.dataset.zone) note.style.color = "#e3eee6";
   note.style.transform = `translate(${p.x}px, ${p.y}px)`;
   sky.append(note);
   const drift = face * rand(10, 24);
   note.animate([
    { transform: `translate(${p.x}px, ${p.y}px) scale(.6)`, opacity: 0 },
    { transform: `translate(${p.x + drift * .4}px, ${p.y - 12}px) scale(1)`, opacity: 1, offset: .25 },
    { transform: `translate(${p.x + drift}px, ${p.y - 34}px) scale(.9)`, opacity: 0 },
   ], { duration: 1300, delay: i * 240, easing: "cubic-bezier(.3,.6,.4,1)", fill: "both" }).onfinish = () => note.remove();
  }
 };

 const perched = (dt: number) => {
  const p = where(spot);
  if (!p) { mode = "perched"; takeoff(); return; }
  const tilt = p.angle * .55;
  let y = p.y, x = p.x;
  if (hop && (spot.kind === "edge" || spot.kind === "bottom")) {
   hop.t += dt / .3;
   const t = smooth(hop.t);
   spot.frac = hop.from + (hop.to - hop.from) * t;
   const q = where(spot);
   if (q) { x = q.x; y = q.y - Math.sin(Math.PI * clamp(hop.t, 0, 1)) * 9; }
   if (hop.t >= 1) { hop = undefined; squash = .88; }
  }
  pos = { x, y }; vel = { x: 0, y: 0 };
  pitch = approach(pitch, tilt + Math.sin(Math.PI * clamp(peck, 0, 1)) * 26, 18, dt);
  peck = peck > 0 ? peck - dt / .24 : 0;

  // Leave when the perch scrolls out of view, when it is time, or when disturbed.
  const outOfView = spot.kind === "home" ? view.top > 30 : !inZone(p, 30);
  if (outOfView) { if (leaveIn < 0) leaveIn = rand(.12, .4); }
  else leaveIn = -1;
  if (leaveIn >= 0 && (leaveIn -= dt) < 0) return takeoff();
  if ((dwell -= dt) < 0) return takeoff();
  if (spot.kind === "hanger" && spot.hanger.held()) return takeoff({ x: -face, y: -.4 });
  const head = { x: pos.x, y: pos.y - SIZE * .45 };
  const gap = Math.hypot(pointer.x - head.x, pointer.y - head.y);
  if (clock - pointer.t < .25 && gap < 70) {
   const d = gap || 1;
   return takeoff({ x: (head.x - pointer.x) / d, y: (head.y - pointer.y) / d });
  }

  // Small lives: glances, tail flicks, pecks, hops and the odd song.
  if (song > 0 && (song -= dt) <= 0) sing();
  if ((idle -= dt) < 0 && !hop) {
   idle = rand(.6, 2.2);
   const roll = Math.random();
   if (roll < .36) faceTarget = -faceTarget;
   else if (roll < .56) tailV += rand(200, 320);
   else if (roll < .74) peck = 1;
   else if (roll < .9 && (spot.kind === "edge" || spot.kind === "bottom")) {
    const width = spot.el.getBoundingClientRect().width, inset = Math.min(.4, 28 / width);
    const to = clamp(spot.frac + faceTarget * rand(12, 26) / width, inset, 1 - inset);
    if (Math.abs(to - spot.frac) * width > 6) { hop = { from: spot.frac, to, t: 0 }; squash = .86; }
   }
  }
 };

 const flying = (dt: number) => {
  const f = flight!;
  f.age += dt;
  // Keep up with the reader: a bird left far behind re-enters from the nearest edge.
  const h = view.bottom - view.top;
  if (pos.y < view.top - h * .7 || pos.y > view.bottom + h * .7) {
   pos = { x: clamp(pos.x, view.left + 30, view.right - 30), y: pos.y < view.top ? view.top - 50 : view.bottom + 50 };
   vel = { x: 0, y: pos.y < view.top ? 300 : -300 };
   return plan(f.spot, f.land);
  }
  if ((f.check -= dt) < 0) {
   f.check = .25;
   const t = where(f.spot);
   if (!t || !reachable(f.spot, t, f.spot.kind === "air" ? 60 : 20)) return next();
  }
  const remaining = f.path.total - f.s;
  f.speed = nextSpeed(f.speed, dt, remaining, f.cruise, f.land ? 30 : f.cruise * .75);
  f.s = Math.min(f.path.total, f.s + f.speed * dt);
  const base = along(f.path, f.s);
  if (f.land) {
   // Follow a target that moves (a swinging file) by easing in its drift since take-off.
   const t = where(f.spot);
   if (t) { const k = smooth(f.s / f.path.total); base.x += (t.x - f.planned.x) * k; base.y += (t.y - f.planned.y) * k; }
  }

  // Wing beats: strong on take-off, bursts and tucked dips in cruise, a slow broad flare to land.
  const final = f.land && remaining < 110;
  let bob = 0;
  if (f.age < .32 || final || remaining < 60 || f.speed < 170) {
   wingPhase += dt * (final ? 6.5 : 10.5); wings = 1; f.tuck = 0;
  } else if (f.tuck > 0) {
   f.tuck -= dt; wings = 0;
   bob = -7 * (1 - smooth(1 - f.tuck / .22));
   if (f.tuck <= 0) { f.burst = 0; f.flaps = Math.round(rand(2, 4)); }
  } else {
   wingPhase += dt * 8; wings = 1; f.burst += dt;
   bob = -7 * smooth(f.burst / (f.flaps / 8));
   if (f.burst >= f.flaps / 8) f.tuck = .22;
  }
  const envelope = smooth(f.s / 90) * smooth(remaining / 140);
  const to = { x: base.x, y: base.y + bob * envelope };
  vel = { x: approach(vel.x, (to.x - pos.x) / dt, 20, dt), y: approach(vel.y, (to.y - pos.y) / dt, 20, dt) };
  pos = to;

  if (Math.abs(vel.x) > 30 && !(f.land && remaining < 24)) faceTarget = Math.sign(vel.x);
  const heading = Math.atan2(vel.y, Math.abs(vel.x)) * 180 / Math.PI;
  pitch = approach(pitch, final ? -16 : clamp(heading * .55, -26, 30), 10, dt);
  legs = approach(legs, final || f.age < .12 ? 1 : 0, 14, dt);
  legTilt = approach(legTilt, final ? -24 : 0, 10, dt);
  if (f.s >= f.path.total - .5) {
   if (f.land) land();
   else next();
  }
 };

 const render = () => {
  const sc = scale;
  flyer.style.transform = `translate3d(${pos.x - SIZE * FOOT_X}px, ${pos.y - SIZE * FOOT_Y}px, 0)`;
  const flip = Math.sign(face || 1) * Math.max(.2, Math.abs(face));
  art.style.transform = `rotate(${pitch * Math.sign(face || 1)}deg) scale(${flip * sc * (2 - squash) ** .5}, ${sc * squash})`;
  const open = wings > .5;
  near.style.display = far.style.display = open ? "" : "none";
  fold.style.display = open ? "none" : "";
  if (open) {
   const lift = wingLift(wingPhase), lag = wingLift(wingPhase - .08);
   near.setAttribute("transform", `translate(0 33) scale(1 ${lift.toFixed(3)}) translate(0 -33)`);
   far.setAttribute("transform", `translate(4 -2) translate(0 33) scale(1 ${(lag * .92).toFixed(3)}) translate(0 -33)`);
  }
  tailEl.setAttribute("transform", `rotate(${tail.toFixed(2)} 23 30.5)`);
  legsEl.setAttribute("transform", `rotate(${legTilt.toFixed(2)} 32 53) translate(0 53) scale(1 ${legs.toFixed(3)}) translate(0 -53)`);
  eye.setAttribute("transform", blink > 0 ? "translate(0 19.5) scale(1 .15) translate(0 -19.5)" : "");
 };

 let previous = 0;
 const frame = (now: number) => {
  const dt = previous ? Math.min((now - previous) / 1000, 1 / 20) : 1 / 60;
  previous = now; clock += dt;
  measureView();
  const y = -origin.y;
  if (Math.abs(y - lastScroll) > .5) scrollDir = Math.sign(y - lastScroll);
  else scrollDir = approach(scrollDir, 0, .8, dt);
  lastScroll = y;

  if (mode === "waiting") { const p = where(spot); if (p) pos = p; }
  else if (mode === "perched") perched(dt);
  else if (mode === "crouch") {
   squash = approach(squash, .8, 30, dt);
   const p = where(spot); if (p) pos = p;
   if ((crouch -= dt) <= 0) { squash = 1.08; next(); }
  } else flying(dt);

  // Birds turn in a blink; the brief edge-on frames read as a quick pivot.
  face = approach(face, faceTarget, 38, dt);
  squash = approach(squash, 1, 9, dt);
  scale = approach(scale, mode !== "flying" && spot.kind === "home" ? 1 : 1.12, 4, dt);
  // Tail: cocked when perched, trailing in flight, with a springy flick.
  const tailRest = mode === "flying" ? (wings ? -24 : -18) : 0;
  tailV += ((tailRest - tail) * 160 - tailV * 14) * dt; tail += tailV * dt;
  if (mode !== "flying") { legs = approach(legs, 1, 14, dt); legTilt = approach(legTilt, 0, 12, dt); wings = 0; }
  if ((blinkIn -= dt) < 0) { blink = .09; blinkIn = rand(1.8, 5); }
  blink -= dt;
  if ((zoneCheck -= dt) < 0) {
   zoneCheck = .3;
   const top = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().top - origin.y : Infinity);
   flyer.dataset.zone = pos.y > top(foot) ? "foot" : pos.y > top(pine) ? "pine" : "";
  }
  render();
  requestAnimationFrame(frame);
 };

 document.addEventListener("pointermove", (e) => { pointer = { x: e.clientX - origin.x, y: e.clientY - origin.y, t: clock }; }, { passive: true });
 document.addEventListener("pointerdown", (e) => {
  const x = e.clientX - origin.x, y = e.clientY - origin.y, d = Math.hypot(x - pos.x, y - pos.y + SIZE * .45);
  if (mode === "perched" && d < 90) takeoff({ x: (pos.x - x) / (d || 1), y: -.5 });
 }, { passive: true });
 new ResizeObserver(fitLayer).observe(document.body);
 fitLayer();

 // The logo bird comes alive once the hanging files have settled.
 setTimeout(() => {
  measureView();
  const p = where(spot);
  if (p) pos = p;
  flyer.hidden = false; logo.style.visibility = "hidden";
  mode = "perched"; dwell = .9; idle = .35; faceTarget = 1;
 }, 3600);
 requestAnimationFrame(frame);
}
