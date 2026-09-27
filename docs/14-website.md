# 14 · Website

The marketing site lives in `website/` (Astro, static output). It is
separate from the app build: its own `package.json`, not linted by the
root Biome config, deployed by `.github/workflows/website.yml`.

## Direction: "Reading room"

Editorial and warm, like the app: a desk of paper under daylight.
Flat colour, hairlines, no gradients, no glow, no blur, no soft shadows.
Not white and not dark: the page sits in the middle of the range.

| Token | Value | Role |
|---|---|---|
| `--paper` | `#E7E0D2` | Page background (warm stone, mid-tone) |
| `--paper-2` | `#DCD3C2` | Alternate bands |
| `--card` | `#F1ECE2` | Tables, cards |
| `--ink` | `#1F1E1B` | Text |
| `--ink-2` | `#57534A` | Secondary text (6.2:1 on paper) |
| `--line` | `#C6BCA9` | Hairlines |
| `--pine` | `#2B6E66` | Accent: buttons, links (the app's Paper accent) |
| `--clay` | `#B0502C` | Strike-through marks only |

Type: **Instrument Serif** for display (400 and italic, -0.02em),
**Manrope** for text (the app's own face), **JetBrains Mono** for small
labels (uppercase, +0.08em). Hero display is `clamp(3.6rem, 10.5vw,
10.5rem)` against 18px body, about 9.5x. All fonts are self-hosted:
the site makes no third-party requests.

Radius 3px on controls; device frames use the device's own radius.
Easing `cubic-bezier(0.16, 1, 0.3, 1)` (expo out) everywhere; exits use
`cubic-bezier(0.76, 0, 0.24, 1)`.

Texture: the page carries the app's paper-fibre texture; the themes
section uses the app's exact Paper, Sand and Ink textures
(`website/src/styles/textures.css`, copied from `src/styles/global.css`).

## Signature move: the strike-through

A pinned, scroll-scrubbed list of the steps other document apps put
between you and your file (create an account, allow access, accept
ads, start a trial...). Each is struck through by a hand-drawn clay
line as you scroll, the list falls away, and one line is left:
"Open the file." It is the whole product argument in one gesture.

## Motion inventory (Crafted tier)

1. Reveal on scroll with stagger (`[data-reveal]`)
2. Hover transforms on all controls
3. Press feedback (scale 0.98)
4. Underline wipe on text links
5. Lenis smooth scroll on fine pointers, wired to the GSAP ticker
6. SplitText masked line reveals on headings
7. Pinned scrubbed section: the strike-through
8. Scroll-linked parallax: hero format sheets, format phones, Windows frame
9. Choreographed hero load (lines, then copy, then phone, then sheets)
10. Hanging files on strings: pendulum physics, drag and throw, drop on load
11. The flying wren: leaves the nav logo, perches around the page and follows the scroll

Items 10 and 11 are explained in [15-website-wren-and-strings.md](15-website-wren-and-strings.md).

With `prefers-reduced-motion: reduce`, no JS animation runs: every
element renders in its final state and the strike-through shows all
lines already struck.

## Pages

| Path | Purpose |
|---|---|
| `/` | Product story, formats, themes, Windows, comparison teaser, FAQ, download |
| `/compare/` | Hub of comparisons |
| `/compare/<app>/` | Short intro, then a table: WPS Office, Microsoft 365 Copilot, Adobe Acrobat Reader, MobiOffice, Google Drive |
| `/privacy/` | The privacy policy |
| `/security/` | How the app is built so the privacy claims are true |

Competitor facts come only from each app's Google Play listing (the
header labels and the Data safety section), checked 27 September 2026,
and every comparison page says so. Update `website/src/data/competitors.ts`
when listings change.

## SEO

Static HTML, one `h1` per page, canonical URLs, Open Graph and Twitter
cards, `sitemap-index.xml`, `robots.txt`, JSON-LD (`SoftwareApplication`
on the home page, `BreadcrumbList` and `FAQPage` where relevant).
Screenshots go through `astro:assets` (AVIF/WebP, explicit sizes).

`SITE_URL` and `BASE_PATH` set the deployed origin and path; they
default to GitHub Pages (`https://razee4315.github.io/Paperwren/`).
