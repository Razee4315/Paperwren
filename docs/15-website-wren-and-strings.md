# The hanging files and the flying wren

How the two living pieces of the website home page work, how to tune
them, and how to build something like them elsewhere.

- **Hanging files:** six file icons hang from strings in the hero. They
  drop in on load, swing like pendulums and can be dragged and thrown.
- **Flying wren:** a few seconds after load, the wren in the nav logo
  takes off. It lands on the hanging files, buttons, frames, rules and
  the tops of heading letters, and it follows the reader down the page.

Both are plain TypeScript with no animation library, and both switch off
entirely under `prefers-reduced-motion`.

| File | What it holds |
|---|---|
| `website/src/scripts/tethers.ts` | String physics, dragging, the drop on load, and the `hangers` API the bird uses |
| `website/src/components/Hero.astro` | Hanging-file markup, the string SVG, the knotted tie and eyelet, and their positions |
| `website/src/scripts/wren.ts` | The bird: perch finding, flight paths, wing and body animation, and behaviour |
| `website/src/components/FlyingWren.astro` | The bird artwork with moving parts, its layer, and its colour zones |
| `website/tests/tethers.test.ts`, `website/tests/wren.test.ts` | Unit tests for the physics and flight maths |

Run the tests with `node --test website/tests/tethers.test.ts website/tests/wren.test.ts`.

---

## Part 1: the hanging files

### A pendulum in polar coordinates

Each icon is a weight on an elastic cord. Its state is polar, measured
from the point where the string meets the nav:

```ts
type Pendulum = { r: number; rv: number; th: number; w: number };
// r: cord length   rv: stretch speed   th: swing angle   w: swing speed
```

`stepPendulum` integrates it at 240 steps per second with semi-implicit
Euler steps. It uses the standard polar equations:

- **Swing:** `w' = (wind·cos th − g·sin th − 2·rv·w) / r − damping·w`
- **Stretch:** `rv' = r·w² + g·cos th − tension`

Why polar state and not x/y:

- **Real pendulum timing comes for free.** The swing period grows with
  the square root of the length, so long strings sway slowly and short
  ones quickly. A test checks the period against `2π√(L/g)`.
- **Swings can't run away.** The angle is clamped (`MAX_ANGLE`), and
  so are speeds (`MAX_SPIN`, `MAX_RADIAL`). Hard throws stay on screen.
- **The cord pulls but never pushes.** Tension only applies when
  `r` exceeds the cord's natural length. That makes the drop on load
  work: an icon falls freely on a slack cord, then bounces when the cord
  catches it.

The natural length is `length − GRAVITY / STIFFNESS`, so an icon at
rest sits exactly where CSS placed it.

### Turning a drag into a throw

While held, the icon follows the pointer in x/y. On release, the
pointer velocity is split into polar parts and handed to the pendulum:

```ts
n.rv = vx * sin(th) + vy * cos(th);          // along the cord
n.w  = (vx * cos(th) - vy * sin(th)) / n.r;  // across it
```

Pulling too far (`isOverstretched`) lets go on its own, and the cord
snaps back.

### Drawing the string

- **Drawing:** each string is a 12-point Verlet rope, drawn as a smooth
  quadratic curve through the points. Its ends are pinned to the anchor
  and the icon.
- **Slack:** segments only pull when stretched, so a slack cord sags
  naturally (see the drop).
- **Style:** one thin stroke (`.strings .cord`, 1.1px). Dashes or a
  second texture stroke read as a chain, not a string.

### The tie

Each file hangs like a luggage tag. The string loops through a punched
hole with a metal eyelet and is knotted just above the page. It's drawn
as two SVGs inside the button:

- **Back strand:** `.tie.back`, drawn *under* the file art, so the page
  hides it below its top edge. It reads as the strand passing behind.
- **Front strand, eyelet and knot:** `.tie`, drawn over the file art.

The knot sits exactly on the cord's attach point (5px below the top of
the button). Smaller icons scale the tie and shift it so the knot still
lands there.

### The drop on load

- **Start:** each icon starts just above the page and falls in, one
  after another in a shuffled order.
- **String appears:** once it passes the nav, its string appears and
  pays out behind it.
- **Catch:** the fall then hands over to the pendulum as a slack cord,
  which catches it with a bounce.

### Tuning the files

| Knob | Where | Effect |
|---|---|---|
| `GRAVITY` | tethers.ts | Speed of the whole system: fall speed and swing period |
| `STIFFNESS`, `CORD_DAMPING` | tethers.ts | Stretchiness and bounce of the cord |
| `SWING_DAMPING` | tethers.ts | How long a swing lasts |
| `wind` in `tick` | tethers.ts | The idle draught (two slow sines per icon) |
| `.file-N { left; top }` | Hero.astro | Positions and string lengths. Keep columns staggered so no string crosses another icon |

---

## Part 2: the flying wren

### It lives in the document, not the viewport

The bird is drawn in `.wren-sky`, an absolutely positioned layer the
size of the whole page. The layer is moved to `<body>` and sits above
the nav (z-index 60). It has `overflow: clip` and is sized to the page
height, so a bird near the bottom can never make the page taller.

This is the most important decision in the design:

- **Perched birds stay glued.** A bird sitting on a button moves with
  it under every kind of scrolling, including native momentum scrolling
  on phones. A `position: fixed` bird repositioned from JavaScript would
  visibly lag and jitter there.
- **Following the reader is just flying.** When the page scrolls, the
  bird is carried with it, then flies back into view at its own speed.

Each frame reads the layer's `getBoundingClientRect()` once. That single
offset converts between viewport and page coordinates and gives the
visible area (`view`).

### Perches

Any element on the home page can be a perch through an attribute:

| Markup | The bird stands on |
|---|---|
| `data-perch` | The element's top edge (buttons, frames, cards) |
| `data-perch="bottom"` | Its bottom border (FAQ rules, list lines) |
| `data-perch="text"` | The top of a flat-topped letter in it (headings, labels) |

Two more perches come from code:

- **Hanging files:** through the `hangers` API that `tethers.ts`
  exports. The bird stands on the flat top edge of the page, left of the
  string, and tilts with the swing.
- **Home:** the nav logo, but only while the page is at the top and
  after a few visits.

**Letter perches** need the top of the glyph, not of the line box. A
`Range` around one character gives its content-area box, and a canvas
`measureText` gives the rest:

```ts
glyphTop = rangeRect.top + (m.fontBoundingBoxAscent - m.actualBoundingBoxAscent);
```

Only letters with flat tops qualify (`FLAT_TOPS`: B D E F H I K L M N P
R T U b d h k l 1), so the bird never balances on an "A" or an "o".

**Positions are recomputed every frame** from the live DOM. A perch
that moves (a swinging file, a heading still revealing, a parallax
frame) keeps the bird on it.

### Choosing where to go

`choose()` scores every perch currently in the visible area and picks
one at random, weighted by score:

- **Distance:** it prefers hops of about 280px, so it stops often.
- **Scroll direction:** it favours perches lower on screen while you
  scroll down, and higher while you scroll up, so it travels with you.
- **Variety:** perches visited in the last three trips are mostly avoided.
- **Fleeing:** when startled, it favours perches away from the cursor.
- **Hanging files** get a bonus, because landing on one makes it swing.

About 1 flight in 10 is an open-air loop to a random point instead of a
landing. That also happens when nothing is in view.

### Flight paths

Each flight is a cubic Bézier, sampled into 48 points with cumulative
lengths (`bezier`), so the bird can be walked along it at an exact speed
(`along`).

- **Leaving:** it leaves along its current heading. From a standstill,
  it goes up and slightly towards the goal.
- **Landing:** it comes in from above, the way small birds drop onto a
  perch.
- **Open-air legs:** these bend off to a random side, so loops never
  look straight.
- **Screen top:** control points are kept below the top of the window,
  so it never vanishes off the top edge.

**Speed** (`nextSpeed`) speeds up to a cruise speed and brakes in time
to arrive gently:

```ts
v = min(v + accel·dt, cruise, √(end² + 2·brake·remaining))
```

**Cruise speed** is `clamp(distance × 0.75, 200, 420)` px/s. It rises to
620 px/s only when the bird is off screen and catching up.

**Moving targets:** for a target that moves during the flight, the path
stays fixed. The target's drift since takeoff is blended in with a
smoothstep, so the landing lines up without a kink.

### Body and wings

The artwork (`FlyingWren.astro`) is the logo wren split into parts that
can move: far wing, tail, legs, body, belly, folded wing, near wing,
beak and eye. When perched it's identical to the logo, which is why the
handover from the nav is seamless.

- **Wings flap as a vertical scale** of a raised-wing shape about the
  shoulder line. Scale 1 is up, about −0.85 is down under the belly, and
  0 is edge-on. In side view this reads as a real wingbeat.
- **Downstroke is quicker than upstroke.** `wingLift` warps the phase so
  the downstroke takes 42% of each beat. The far wing lags slightly and
  sits a few units off, so both wings show.
- **Bounding flight.** Small songbirds flap in short bursts, then fold
  their wings for a moment and dip. In cruise the bird flaps 2 to 4
  times at 8 Hz, then tucks for 0.22 s. A 7px rise-and-dip offset follows
  that rhythm and fades out near takeoff and landing.
- **Takeoff:** a quick crouch (squash), fast 10.5 Hz flaps, and the legs
  tuck after a moment.
- **Landing flare:** in the last 110px it flaps slowly (6.5 Hz), lifts
  its nose 16°, and swings its legs forward. It squashes on touchdown.
- **Pitch** follows the flight direction, **facing** flips with the
  horizontal direction in two frames, and the **tail** is a damped
  spring: cocked when perched, trailing in flight.

### While perched

Every 0.6 to 2.2 s it picks one small action:

- glance the other way
- flick its tail (a push on the tail spring)
- peck (a lean forward and back)
- hop 12 to 26px along a flat edge

It also:

- blinks every 2 to 5 s
- sometimes sings three floating ♪ notes after landing
- stays 3 to 7 s before moving on

It leaves early when:

- its perch scrolls out of view (after a short, random reaction delay)
- the cursor comes within 70px, or someone taps near it
- someone grabs the file it's standing on

### Following the reader

- **Carried away:** scrolling carries a perched or flying bird with the
  page. When its perch leaves the visible area, it takes off and picks a
  perch in the new view.
- **Retargeting:** a flying bird checks its target 4 times a second and
  picks a new one if the target has scrolled away.
- **Left far behind:** if the bird ends up more than 70% of a screen
  outside the view (after a fast scroll or a jump to the top), it is
  moved to just past the nearest edge. It then swoops in, instead of
  making a long chase.

### Colour zones

Over the green Download section and the dark footer, the bird switches
to the lighter plumage those sections' own wrens use. It sets
`data-zone` on `.flyer`, and CSS fills fade between palettes.

### Tuning the bird

| Knob | Where | Effect |
|---|---|---|
| `cruise` in `plan()` | wren.ts | Normal and catch-up flight speed |
| `accel`, `brake` in `nextSpeed` | wren.ts | How quickly it gets going and slows to land |
| `d - 280` in `choose()` | wren.ts | Preferred hop length. Lower means more, shorter stops |
| `Math.random() < .1` in `next()` | wren.ts | How often it flies a loop instead of landing |
| `dwell` in `land()` | wren.ts | How long it sits |
| `3600` in the final `setTimeout` | wren.ts | Delay before it first leaves the logo |
| Flap rates `10.5`, `8`, `6.5` and tuck `.22` | `flying()` in wren.ts | Wingbeat feel |
| `inZone` margins | wren.ts | The screen area it considers visible |

To add a perch, add `data-perch` (or `="bottom"`, `="text"`) to any
element that's on the home page.

---

## Building something similar

A recipe that works for any creature or object that has to feel alive
on a page: a bird, a paper plane, a bee, a leaf.

1. **Keep state in physical terms and derive everything else.**
   - For something swinging or tethered, use polar state (length, angle
     and their speeds), not x/y.
   - For something flying, use a path plus a distance along it and a
     speed.
   - Draw positions and angles from that state each frame.
   - Clamp speeds and angles, so no input can make it explode.
2. **Use a fixed physics step.** Split each frame into small steps
   (tethers.ts uses 240 per second) and cap the frame time. The motion
   is then the same at 30, 60 and 120 fps, and after a tab wakes up.
   There's a test for this.
3. **Put it in the layer that moves the way it should.** Anything that
   should stick to content goes in page coordinates, inside the page
   (an absolute layer), never `position: fixed` plus JavaScript. Clip
   the layer so it can't change the page size.
4. **Find targets through markup, not selectors.** A `data-*` attribute
   on the target elements keeps the script generic. Re-read their
   positions every frame, so layout changes, reveals and parallax never
   break it.
5. **Plan paths, don't steer.** A Bézier from the current heading to the
   goal, walked by distance with an accelerate-and-brake speed profile,
   gives graceful arcs and soft arrivals. Pure steering tends to orbit
   and overshoot.
6. **Layer the motion.** Build it in this order:
   - the path
   - a small rhythmic offset (bounding flight)
   - body pitch from the velocity
   - a quick turn when the direction flips
   - squash and stretch on takeoff and landing
   - part animation (wings, tail spring, legs, blink)

   Each layer is simple on its own, and together they read as alive.
7. **Borrow from the real animal.** The details that sell it are
   observed ones:
   - bounding flight
   - a faster downstroke than upstroke
   - a landing flare with the legs forward
   - a cocked tail that flicks
   - quick head turns
   - fleeing an approaching hand
8. **Let the world react.** A file that swings when the bird lands on it
   is worth more than any extra flourish on the bird itself. Give the
   systems a small API to talk to each other (`hangers.nudge`).
9. **Give it variety within limits.** Randomise:
   - durations
   - hop sizes
   - which letter it picks
   - the order of idle actions

   Weight the choices so behaviour stays purposeful (following the
   scroll, fleeing away from the cursor).
10. **Respect the reader.** Keep the creature `pointer-events: none` so
    it never blocks a click, and turn it off under
    `prefers-reduced-motion`. Keep speeds calm: on a reading site,
    slower looks better.

### How we checked the motion

Screenshots can't show motion quality, so we filmed it in slow motion
with Playwright:

- **Slowing time:** an init script wraps `requestAnimationFrame` (and
  `setTimeout`) so every timestamp is multiplied by 0.2. The page then
  runs 5× slower.
- **Filmstrip:** 40 small screenshots cropped around the bird were laid
  out in a grid. That made problems obvious: the bird leaving the top of
  the window, slow turns showing an edge-on sliver.

Scripted scrolling with position logs checked the scroll-following, and
separate runs checked phone width, reduced motion and fleeing the
cursor.
