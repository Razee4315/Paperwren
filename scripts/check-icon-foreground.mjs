/**
 * Release/CI gate for the Android adaptive-icon foreground
 * (audit section 13): the mark must fill a healthy share of the
 * 512px canvas so it reads at launcher size, and it must stay
 * inside the adaptive safe zone (the central 66/108 circle) under
 * every common mask. A foreground whose non-transparent artwork is
 * implausibly small or implausibly large fails the build.
 *
 * Usage: node scripts/check-icon-foreground.mjs [path.svg]
 */
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "assets/brand/app-icon-foreground.svg";
const svg = readFileSync(path, "utf8");

const fail = (message) => {
	console.error(`icon foreground check failed: ${message}`);
	process.exit(1);
};

// Collect the transform scale of the top-level art group.
const scaleMatch = svg.match(/scale\(([\d.]+)(?:\s|,|,\s|\))?/);
if (!scaleMatch) fail("no scale() transform found on the art group");
const scale = Number.parseFloat(scaleMatch[1]);
if (!(scale >= 0.72 && scale <= 0.92)) {
	fail(
		`art scale ${scale} outside the 0.72..0.92 window (double padding or over-crop)`,
	);
}

// Rough bounding box of the artwork in final canvas coordinates:
// parse rect/path geometry after the group transform.
const translateMatch = svg.match(/translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)/);
if (!translateMatch) fail("no translate() on the art group");
const tx = Number.parseFloat(translateMatch[1]);
const ty = Number.parseFloat(translateMatch[2]);

let minX = Number.POSITIVE_INFINITY;
let minY = Number.POSITIVE_INFINITY;
let maxX = Number.NEGATIVE_INFINITY;
let maxY = Number.NEGATIVE_INFINITY;
for (const m of svg.matchAll(
	/<(?:rect|path)\b[^>]*?\bx="(-?[\d.]+)"[^>]*?\by="(-?[\d.]+)"[^>]*?\bwidth="([\d.]+)"[^>]*?\bheight="([\d.]+)"/g,
)) {
	const [, x, y, w, h] = m.map(Number);
	minX = Math.min(minX, x);
	minY = Math.min(minY, y);
	maxX = Math.max(maxX, x + w);
	maxY = Math.max(maxY, y + h);
}
// Paths without x/y/width/height (the folded-sheet mark): fall back
// to the numeric extremes of the path data so the check still
// bounds the visible mark.
for (const m of svg.matchAll(/\bd="([^"]+)"/g)) {
	for (const n of m[1].matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g)) {
		const x = Number.parseFloat(n[1]);
		const y = Number.parseFloat(n[2]);
		if (x >= 0 && x <= 512 && y >= 0 && y <= 512) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
}
if (!Number.isFinite(minX)) fail("could not derive artwork bounds");

const left = minX * scale + tx;
const top = minY * scale + ty;
const right = maxX * scale + tx;
const bottom = maxY * scale + ty;
const w = right - left;
const h = bottom - top;

// Fill ratio of the canvas: too small reads weakly at launcher size.
const fill = (w * h) / (512 * 512);
if (fill < 0.14 || fill > 0.55) {
	fail(
		`artwork fills ${(fill * 100).toFixed(1)}% of the canvas (want 14..55%)`,
	);
}

// Adaptive safe zone: everything must fit inside the central
// 66dp-of-108dp circle (radius 156px at 512px) centered at 256,256.
const cx = (left + right) / 2;
const cy = (top + bottom) / 2;
const farthest =
	Math.hypot(
		Math.max(Math.abs(left - cx), Math.abs(right - cx)),
		Math.max(Math.abs(top - cy), Math.abs(bottom - cy)),
	) + Math.hypot(cx - 256, cy - 256);
if (farthest > 156) {
	fail(
		`artwork corners reach ${farthest.toFixed(0)}px from center; safe radius is 156px`,
	);
}

// No baked background tile: the adaptive foreground must be
// transparent except the mark itself.
if (/<rect[^>]*width="512"[^>]*>/.test(svg)) {
	fail(
		"full-canvas rect found: adaptive foreground must not bake a background",
	);
}

console.log(
	`icon foreground OK: scale ${scale}, fills ${(fill * 100).toFixed(1)}% of canvas, inside safe zone`,
);
