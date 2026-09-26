"""Generate the per-theme page textures in src/styles/global.css.

Paper fibre, sand grain with wind ripples, and ink splatter, as inline
SVG data URIs (feTurbulence noise plus seeded shapes). The output goes
between the "Textures" markers; re-run after editing:

    python scripts/make-textures.py
"""

import math
import random
import re
from urllib.parse import quote

CSS = "src/styles/global.css"


def uri(svg: str) -> str:
    svg = re.sub(r"\s+", " ", svg).strip()
    return 'url("data:image/svg+xml,' + quote(svg, safe=" =:/'.,;()-") + '")'


def noise(size, freq, octaves, seed, rgb, a_mul, a_add):
    """A tile of fractal noise mapped to one colour; alpha is
    a_mul * noise + a_add (a steep a_mul thresholds it into specks)."""
    r, g, b = rgb
    return f"""<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}'>
<filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='{freq}'
numOctaves='{octaves}' seed='{seed}' stitchTiles='stitch'/>
<feColorMatrix values='0 0 0 0 {r} 0 0 0 0 {g} 0 0 0 0 {b} 0 0 0 {a_mul} {a_add}'/></filter>
<rect width='100%' height='100%' filter='url(#n)'/></svg>"""


def fibres(size, seed, count, colours):
    """Short curved paper fibres that wrap around the tile edges,
    batched into one path per style to keep the data URI small."""
    rnd = random.Random(seed)
    groups = {}
    for _ in range(count):
        x, y = rnd.uniform(0, size), rnd.uniform(0, size)
        a = rnd.uniform(0, math.pi)
        length = rnd.uniform(6, 26)
        bend = rnd.uniform(-5, 5)
        x2, y2 = x + math.cos(a) * length, y + math.sin(a) * length
        cx = (x + x2) / 2 + math.cos(a + math.pi / 2) * bend
        cy = (y + y2) / 2 + math.sin(a + math.pi / 2) * bend
        style = (*rnd.choice(colours), rnd.choice((0.45, 0.8)))
        for dx in (-size, 0, size):
            for dy in (-size, 0, size):
                ox, oy = x + dx, y + dy
                if (dx or dy) and not (-30 < ox < size + 30 and -30 < oy < size + 30):
                    continue
                groups.setdefault(style, []).append(
                    f"M{ox:.0f} {oy:.0f}Q{cx + dx:.0f} {cy + dy:.0f} {x2 + dx:.0f} {y2 + dy:.0f}"
                )
    paths = "".join(
        f"<path d='{''.join(ds)}' stroke='{c}' stroke-opacity='{o}' stroke-width='{w}'/>"
        for (c, o, w), ds in groups.items()
    )
    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}'>"
        f"<g fill='none' stroke-linecap='round'>{paths}</g></svg>"
    )


def ripples(size, seed):
    """Wind ripples: long irregular crests, each a lit edge over a soft
    shadow. Every wave is a sum of whole-period harmonics and the rows
    fill the tile exactly, so it tiles seamlessly."""
    rnd = random.Random(seed)
    rows = []
    y = 0.0
    while y < size - 14:
        y += rnd.uniform(16, 30)
        rows.append(y)
    scale = size / (rows[-1] + rnd.uniform(16, 30))
    rows = [r * scale for r in rows]
    crests = []
    for y0 in rows:
        terms = [(k, rnd.uniform(1.5, 5.5) / k, rnd.uniform(0, 2 * math.pi)) for k in (1, 2, 3, 5)]
        pts = []
        for step in range(0, size + 1, 28):
            t = step / size * 2 * math.pi
            pts.append((step, y0 + sum(a * math.sin(k * t + ph) for k, a, ph in terms)))
        crests.append("M" + " L".join(f"{x} {yy:.1f}" for x, yy in pts))
    d = "".join(crests)
    return f"""<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}'>
<filter id='r' x='0' y='-5%' width='100%' height='110%'>
<feTurbulence type='fractalNoise' baseFrequency='0.03' numOctaves='2' seed='{seed}' stitchTiles='stitch'/>
<feDisplacementMap in='SourceGraphic' scale='5'/></filter>
<filter id='s' x='0' y='-10%' width='100%' height='120%'><feGaussianBlur stdDeviation='1.6'/></filter>
<path d='{d}' transform='translate(0 2)' stroke='#6b4a26' stroke-opacity='0.2' stroke-width='5' fill='none' filter='url(#s)'/>
<g filter='url(#r)'><path d='{d}' stroke='#fffbf2' stroke-opacity='0.55' stroke-width='1.3' fill='none'/></g></svg>"""


def splat(seed, size, ink, pool, spray):
    """An ink splatter: a ragged core with lobes, flung streaks ending
    in beads, and a halo of fine spray. The core is roughened with a
    displacement map so its edge looks wet, not geometric."""
    rnd = random.Random(seed)
    c = size / 2
    core = [f"<circle cx='{c}' cy='{c}' r='{size * 0.17:.1f}'/>"]
    for _ in range(14):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(size * 0.06, size * 0.19)
        r = rnd.uniform(size * 0.035, size * 0.09)
        core.append(f"<circle cx='{c + math.cos(a) * d:.1f}' cy='{c + math.sin(a) * d:.1f}' r='{r:.1f}'/>")
    streaks = []
    for _ in range(9):
        a = rnd.uniform(0, 2 * math.pi)
        l = rnd.uniform(size * 0.2, size * 0.4)
        w = rnd.uniform(size * 0.008, size * 0.022)
        x2, y2 = c + math.cos(a) * l, c + math.sin(a) * l
        # A tapered streak: wide at the core, thin at the bead.
        px, py = math.cos(a + math.pi / 2), math.sin(a + math.pi / 2)
        wb = w * 2.4
        streaks.append(
            f"<path d='M{c + px * wb:.1f} {c + py * wb:.1f} L{x2 + px * w * 0.4:.1f} {y2 + py * w * 0.4:.1f} "
            f"L{x2 - px * w * 0.4:.1f} {y2 - py * w * 0.4:.1f} L{c - px * wb:.1f} {c - py * wb:.1f} Z'/>"
        )
        streaks.append(f"<circle cx='{x2:.1f}' cy='{y2:.1f}' r='{w * 1.5:.1f}'/>")
    pools = []
    for _ in range(5):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(0, size * 0.1)
        r = rnd.uniform(size * 0.03, size * 0.07)
        pools.append(f"<circle cx='{c + math.cos(a) * d:.1f}' cy='{c + math.sin(a) * d:.1f}' r='{r:.1f}'/>")
    drops = []
    for _ in range(70):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(size * 0.24, size * 0.5) ** 1.0
        r = rnd.uniform(size * 0.002, size * 0.012)
        drops.append(f"<circle cx='{c + math.cos(a) * d:.1f}' cy='{c + math.sin(a) * d:.1f}' r='{r:.1f}'/>")
    return f"""<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}' viewBox='0 0 {size} {size}'>
<filter id='w' x='-10%' y='-10%' width='120%' height='120%'>
<feTurbulence type='fractalNoise' baseFrequency='0.045' numOctaves='3' seed='{seed}'/>
<feDisplacementMap in='SourceGraphic' scale='{size * 0.05:.0f}'/></filter>
<g fill='{ink}' filter='url(#w)'>{''.join(core)}{''.join(streaks)}</g>
<g fill='{pool}' filter='url(#w)'>{''.join(pools)}</g>
<g fill='{spray}'>{''.join(drops)}</g></svg>"""


# ---------- Paper: fibres over a cloudy, grainy sheet ----------
paper_fibres = fibres(
    260, 11, 170,
    [("#8a7a5c", 0.22), ("#8a7a5c", 0.14), ("#ffffff", 0.7), ("#b8a888", 0.25)],
)
paper_cloud = noise(320, "0.012", 3, 7, (0.55, 0.48, 0.36), 0.32, -0.08)
paper_grain = noise(180, "0.9", 2, 13, (0.3, 0.26, 0.2), 0.16, -0.03)

# ---------- Sand: three-tone grains on wind ripples ----------
sand_dark = noise(150, "1.15", 2, 3, (0.38, 0.27, 0.16), 5, -3.35)
sand_rust = noise(170, "1.05", 2, 29, (0.62, 0.33, 0.18), 5, -3.45)
sand_light = noise(160, "1.25", 2, 19, (1, 0.98, 0.92), 5, -3.2)
sand_ripples = ripples(420, 5)
sand_mottle = noise(300, "0.01 0.03", 2, 5, (0.6, 0.44, 0.25), 0.55, -0.22)

# ---------- Ink: splatters in the corners over a faint grain ----------
ink_a = splat(4, 420, "#223331", "#284240", "#243634")
ink_b = splat(9, 340, "#1f2e2f", "#253b3b", "#223233")
ink_c = splat(21, 170, "#1f2d2e", "#243838", "#213031")
ink_grain = noise(200, "0.9", 2, 2, (0.9, 0.95, 0.93), 0.08, 0)

block = f"""/* ---------- Textures (generated by scripts/make-textures.py) ----------
 * Page backgrounds only; cards and the reading canvas stay plain so
 * text contrast never changes. Paper fibre, sand grain, ink splatter. */

[data-theme="light"],
:root {{
	--page-bg: {uri(paper_fibres)}, {uri(paper_grain)}, {uri(paper_cloud)}, var(--bg);
}}
[data-theme="sepia"] {{
	--page-bg: {uri(sand_dark)}, {uri(sand_rust)}, {uri(sand_light)},
		{uri(sand_ripples)}, {uri(sand_mottle)}, var(--bg);
}}
[data-theme="dark"] {{
	--page-bg: {uri(ink_a)} right -150px top -130px / 420px 420px no-repeat,
		{uri(ink_b)} left -130px bottom 6% / 340px 340px no-repeat,
		{uri(ink_c)} left 62% top 44% / 170px 170px no-repeat,
		{uri(ink_grain)}, var(--bg);
}}
/* ---------- /Textures ---------- */
"""

s = open(CSS, encoding="utf-8").read()
s = re.sub(r"/\* ---------- Textures.*?/\* ---------- /Textures ---------- \*/\n\n?", "", s, flags=re.S)
s = s.replace("/* ---------- Base ---------- */", block + "\n/* ---------- Base ---------- */")
open(CSS, "w", encoding="utf-8", newline="\n").write(s)
print(f"wrote textures ({len(block) // 1024} KB)")
