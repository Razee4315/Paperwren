import { t } from "@/lib/i18n";
import type { Chart } from "@/lib/pptx/parse";

/**
 * Draws a slide chart as plain SVG from the values the file cached.
 * It aims for an honest, readable picture of the data (right shape,
 * right colours, labelled axes), not a pixel copy of PowerPoint's
 * layout.
 */

const INK = "#595959";
const GRID = "#d9d9d9";
const AXIS = "#a6a6a6";

/** Rough text width: enough to place labels without measuring. */
const textWidth = (text: string, size: number) => text.length * size * 0.56;
const clip = (text: string, max = 18) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Round tick positions covering [lo, hi], about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
	if (!(hi > lo)) return [lo];
	const raw = (hi - lo) / count;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
	if (!step) return [lo, hi];
	const first = Math.floor(lo / step) * step;
	const ticks: number[] = [];
	for (let v = first; v < hi + step * 0.999 && ticks.length < 20; v += step)
		ticks.push(Number(v.toPrecision(12)));
	return ticks;
}

const formatValue = (v: number, percent: boolean) =>
	percent
		? `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`
		: v.toLocaleString("en-US", { maximumFractionDigits: 2 });

interface Key {
	label: string;
	color: string;
}

/** Legend rows that fit `width`, centred, at most two of them. */
function layoutLegend(keys: Key[], width: number, size: number) {
	const gap = size * 1.4;
	const swatch = size * 0.9;
	const rows: Array<{ items: Array<Key & { x: number }>; w: number }> = [];
	let row = { items: [] as Array<Key & { x: number }>, w: 0 };
	for (const key of keys) {
		const label = clip(key.label, 24);
		const w = swatch + size * 0.4 + textWidth(label, size);
		if (row.items.length && row.w + gap + w > width) {
			rows.push(row);
			row = { items: [], w: 0 };
		}
		const x = row.items.length ? row.w + gap : 0;
		row.items.push({ label, color: key.color, x });
		row.w = x + w;
	}
	if (row.items.length) rows.push(row);
	return { rows: rows.slice(0, 2), swatch, lineHeight: size * 1.7 };
}

export function SlideChart({
	chart,
	w,
	h,
}: { chart: Chart; w: number; h: number }) {
	const size = Math.max(9, Math.min(15, Math.min(w, h) / 24));
	const pad = size * 0.8;
	const titleH = chart.title ? size * 2.4 : 0;

	const keys: Key[] =
		chart.kind === "pie"
			? chart.slices.map((s) => ({ label: s.label, color: s.color }))
			: chart.series.map((s) => ({ label: s.name, color: s.color }));
	const legend =
		chart.legend && keys.length ? layoutLegend(keys, w - pad * 2, size) : null;
	const legendH = legend ? legend.rows.length * legend.lineHeight + pad / 2 : 0;

	// The area left for the plot itself.
	const top = pad + titleH;
	const bottom = h - pad - legendH;
	const body: JSX.Element[] = [];

	if (chart.kind === "pie") {
		const cx = w / 2;
		const cy = (top + bottom) / 2;
		const r = Math.max(4, Math.min(w - pad * 2, bottom - top) / 2);
		const total = chart.slices.reduce((sum, s) => sum + s.value, 0);
		let angle = -Math.PI / 2;
		chart.slices.forEach((slice, i) => {
			const sweep = (slice.value / total) * Math.PI * 2;
			const end = angle + sweep;
			const at = (a: number, radius: number) =>
				`${cx + Math.cos(a) * radius} ${cy + Math.sin(a) * radius}`;
			const large = sweep > Math.PI ? 1 : 0;
			const inner = r * chart.hole;
			const d =
				chart.slices.length === 1
					? `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}Z`
					: inner
						? `M${at(angle, r)}A${r} ${r} 0 ${large} 1 ${at(end, r)}L${at(end, inner)}A${inner} ${inner} 0 ${large} 0 ${at(angle, inner)}Z`
						: `M${cx} ${cy}L${at(angle, r)}A${r} ${r} 0 ${large} 1 ${at(end, r)}Z`;
			body.push(
				<path key={i} d={d} fill={slice.color} stroke="#fff" strokeWidth={1} />,
			);
			angle = end;
		});
	} else {
		const scatter = chart.kind === "scatter";
		const sideways = chart.kind === "cartesian" && chart.horizontal;
		const percent = chart.kind === "cartesian" && chart.percent;
		const stack = chart.kind === "cartesian" ? chart.stack : "none";
		const count = chart.kind === "cartesian" ? chart.categories.length : 0;
		const stacks = (kind: "bar" | "area") =>
			chart.kind === "cartesian" && stack !== "none"
				? chart.series.filter((s) => s.kind === kind)
				: [];

		// Per-category totals, for stacked scales and 100% charts.
		const totals = Array.from({ length: count }, (_, i) => {
			let pos = 0;
			let neg = 0;
			if (chart.kind === "cartesian")
				for (const s of chart.series) {
					if (s.kind === "line") continue;
					const v = s.values[i] ?? 0;
					if (v >= 0) pos += v;
					else neg += v;
				}
			return { pos, neg, abs: pos - neg };
		});
		const share = (v: number, i: number) =>
			stack === "percent" ? (totals[i].abs ? v / totals[i].abs : 0) : v;

		// Value range.
		let lo = 0;
		let hi = 0;
		if (chart.kind === "scatter") {
			const ys = chart.series.flatMap((s) => s.points.map((p) => p.y));
			lo = Math.min(0, ...ys);
			hi = Math.max(0, ...ys);
		} else if (stack === "percent") {
			hi = 1;
			lo = totals.some((t) => t.neg < 0) ? -1 : 0;
		} else {
			for (const s of chart.series) {
				if (stack !== "none" && s.kind !== "line") continue;
				for (const v of s.values) {
					if (v === null) continue;
					lo = Math.min(lo, v);
					hi = Math.max(hi, v);
				}
			}
			if (stack === "stacked")
				for (const t of totals) {
					lo = Math.min(lo, t.neg);
					hi = Math.max(hi, t.pos);
				}
		}
		if (hi === lo) hi = lo + 1;
		const ticks = niceTicks(lo, hi);
		lo = Math.min(lo, ticks[0]);
		hi = Math.max(hi, ticks[ticks.length - 1]);
		const asPercent = percent || stack === "percent";
		const tickLabels = ticks.map((t) => formatValue(t, asPercent));

		// Scatter charts have a numeric x axis of their own.
		let xLo = 0;
		let xHi = 1;
		let xTicks: number[] = [];
		if (chart.kind === "scatter") {
			const xs = chart.series.flatMap((s) => s.points.map((p) => p.x));
			xLo = Math.min(...xs);
			xHi = Math.max(...xs);
			if (xHi === xLo) xHi = xLo + 1;
			xTicks = niceTicks(Math.min(0, xLo), xHi);
			xLo = xTicks[0];
			xHi = xTicks[xTicks.length - 1];
		}

		const catLabels =
			chart.kind === "cartesian" ? chart.categories.map((c) => clip(c)) : [];
		const widest = (labels: string[]) =>
			Math.max(0, ...labels.map((l) => textWidth(l, size)));
		// Gutters: value labels on one axis, category labels on the other.
		const left =
			pad + (sideways ? widest(catLabels) : widest(tickLabels)) + size * 0.6;
		const right = w - pad - (sideways ? size * 1.5 : 0);
		const base = bottom - size * 1.9;
		const plotW = Math.max(10, right - left);
		const plotH = Math.max(10, base - top - size * 0.5);
		const plotTop = base - plotH;

		/** Value -> position along the value axis. */
		const scale = (v: number) => {
			const t = (v - lo) / (hi - lo);
			return sideways ? left + t * plotW : base - t * plotH;
		};
		const band = count ? (sideways ? plotH : plotW) / count : 0;
		/** Centre of category i along the category axis. PowerPoint lists
		 * sideways bars bottom-up. */
		const centre = (i: number) =>
			sideways ? base - band * (i + 0.5) : left + band * (i + 0.5);

		// Gridlines and value labels.
		ticks.forEach((t, i) => {
			const p = scale(t);
			body.push(
				sideways ? (
					<line
						key={`g${i}`}
						x1={p}
						x2={p}
						y1={plotTop}
						y2={base}
						stroke={GRID}
					/>
				) : (
					<line
						key={`g${i}`}
						x1={left}
						x2={right}
						y1={p}
						y2={p}
						stroke={GRID}
					/>
				),
				sideways ? (
					<text key={`t${i}`} x={p} y={base + size * 1.3} textAnchor="middle">
						{tickLabels[i]}
					</text>
				) : (
					<text
						key={`t${i}`}
						x={left - size * 0.5}
						y={p + size * 0.35}
						textAnchor="end"
					>
						{tickLabels[i]}
					</text>
				),
			);
		});

		if (chart.kind === "cartesian") {
			// Category labels, thinned out when they would collide.
			const every = sideways
				? Math.max(1, Math.ceil((size * 1.3) / band))
				: Math.max(1, Math.ceil((widest(catLabels) + size) / band));
			catLabels.forEach((label, i) => {
				if (i % every) return;
				body.push(
					sideways ? (
						<text
							key={`c${i}`}
							x={left - size * 0.5}
							y={centre(i) + size * 0.35}
							textAnchor="end"
						>
							{label}
						</text>
					) : (
						<text
							key={`c${i}`}
							x={centre(i)}
							y={base + size * 1.3}
							textAnchor="middle"
						>
							{label}
						</text>
					),
				);
			});

			// Areas first, then bars, then lines on top.
			const zero = scale(Math.max(lo, Math.min(hi, 0)));
			const areaBase = Array.from({ length: count }, () => 0);
			const stackedAreas = stacks("area");
			chart.series.forEach((s, si) => {
				if (s.kind !== "area") return;
				const stacked = stackedAreas.includes(s);
				const upper: string[] = [];
				const lower: string[] = [];
				for (let i = 0; i < count; i++) {
					const v = share(s.values[i] ?? 0, i);
					const from = stacked ? areaBase[i] : 0;
					if (stacked) areaBase[i] += v;
					upper.push(`${centre(i)},${scale(from + v)}`);
					lower.unshift(`${centre(i)},${scale(from)}`);
				}
				body.push(
					<polygon
						key={`a${si}`}
						points={[...upper, ...lower].join(" ")}
						fill={s.color}
						fillOpacity={stacked ? 1 : 0.75}
					/>,
				);
			});

			const bars = chart.series.filter((s) => s.kind === "bar");
			const stackedBars = stack !== "none";
			const slots = stackedBars ? 1 : bars.length;
			const thick = (band * 0.7) / Math.max(1, slots);
			const posBase = Array.from({ length: count }, () => 0);
			const negBase = Array.from({ length: count }, () => 0);
			bars.forEach((s, bi) => {
				for (let i = 0; i < count; i++) {
					const raw = s.values[i];
					if (raw === null || raw === undefined) continue;
					const v = share(raw, i);
					let from = 0;
					if (stackedBars) {
						const bases = v >= 0 ? posBase : negBase;
						from = bases[i];
						bases[i] += v;
					}
					const a = scale(from);
					const b = scale(from + v);
					const across =
						centre(i) - (thick * slots) / 2 + (stackedBars ? 0 : bi * thick);
					body.push(
						sideways ? (
							<rect
								key={`b${bi}-${i}`}
								x={Math.min(a, b)}
								y={across}
								width={Math.abs(b - a)}
								height={thick}
								fill={s.color}
							/>
						) : (
							<rect
								key={`b${bi}-${i}`}
								x={across}
								y={Math.min(a, b)}
								width={thick}
								height={Math.abs(b - a)}
								fill={s.color}
							/>
						),
					);
				}
			});

			chart.series.forEach((s, si) => {
				if (s.kind !== "line") return;
				// A gap in the data breaks the line instead of joining over it.
				const runs: string[][] = [[]];
				const dots: JSX.Element[] = [];
				for (let i = 0; i < count; i++) {
					const v = s.values[i];
					if (v === null || v === undefined) {
						runs.push([]);
						continue;
					}
					const x = sideways ? scale(v) : centre(i);
					const y = sideways ? centre(i) : scale(v);
					runs[runs.length - 1].push(`${x},${y}`);
					if (s.markers)
						dots.push(
							<circle key={i} cx={x} cy={y} r={size * 0.28} fill={s.color} />,
						);
				}
				body.push(
					<g key={`l${si}`}>
						{runs
							.filter((run) => run.length > 1)
							.map((run, ri) => (
								<polyline
									key={ri}
									points={run.join(" ")}
									fill="none"
									stroke={s.color}
									strokeWidth={Math.max(1.5, size * 0.18)}
									strokeLinejoin="round"
									strokeLinecap="round"
								/>
							))}
						{dots}
					</g>,
				);
			});

			// The category axis, drawn over the bars' feet.
			body.push(
				sideways ? (
					<line
						key="axis"
						x1={zero}
						x2={zero}
						y1={plotTop}
						y2={base}
						stroke={AXIS}
					/>
				) : (
					<line
						key="axis"
						x1={left}
						x2={right}
						y1={zero}
						y2={zero}
						stroke={AXIS}
					/>
				),
			);
		} else if (scatter) {
			const sx = (x: number) => left + ((x - xLo) / (xHi - xLo)) * plotW;
			xTicks.forEach((t, i) =>
				body.push(
					<text
						key={`x${i}`}
						x={sx(t)}
						y={base + size * 1.3}
						textAnchor="middle"
					>
						{formatValue(t, false)}
					</text>,
				),
			);
			body.push(
				<line
					key="axis"
					x1={left}
					x2={right}
					y1={base}
					y2={base}
					stroke={AXIS}
				/>,
			);
			chart.series.forEach((s, si) =>
				body.push(
					<g key={`s${si}`}>
						{s.line && s.points.length > 1 && (
							<polyline
								points={s.points
									.map((p) => `${sx(p.x)},${scale(p.y)}`)
									.join(" ")}
								fill="none"
								stroke={s.color}
								strokeWidth={Math.max(1.5, size * 0.18)}
							/>
						)}
						{s.points.map((p, i) => (
							<circle
								key={i}
								cx={sx(p.x)}
								cy={scale(p.y)}
								r={size * 0.32}
								fill={s.color}
							/>
						))}
					</g>,
				),
			);
		}
	}

	return (
		<svg
			viewBox={`0 0 ${Math.max(w, 1)} ${Math.max(h, 1)}`}
			role="img"
			aria-label={
				chart.title ? t("Chart: {title}", { title: chart.title }) : t("Chart")
			}
			fontSize={size}
			fill={INK}
			data-testid="slide-chart"
		>
			{chart.title && (
				<text
					x={w / 2}
					y={pad + size * 1.4}
					textAnchor="middle"
					fontSize={size * 1.3}
					fontWeight={600}
				>
					{clip(chart.title, 60)}
				</text>
			)}
			{body}
			{legend?.rows.map((row, ri) => {
				const y = h - pad - (legend.rows.length - ri - 0.5) * legend.lineHeight;
				const x0 = (w - row.w) / 2;
				return (
					<g key={ri}>
						{row.items.map((item, i) => (
							<g key={i}>
								<rect
									x={x0 + item.x}
									y={y - legend.swatch / 2}
									width={legend.swatch}
									height={legend.swatch}
									fill={item.color}
								/>
								<text
									x={x0 + item.x + legend.swatch + size * 0.4}
									y={y + size * 0.35}
								>
									{item.label}
								</text>
							</g>
						))}
					</g>
				);
			})}
		</svg>
	);
}
